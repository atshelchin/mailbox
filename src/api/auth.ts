/**
 * @fileoverview Authentication API routes
 * @description Handles user registration and authentication using WebAuthn/Passkeys.
 *
 * ## Overview
 * This module implements passwordless authentication using the WebAuthn standard:
 * - Registration: Users create an account with a username and register a Passkey
 * - Login: Users authenticate using their registered Passkey
 * - Sessions: Cookie-based sessions maintain authenticated state
 *
 * ## Authentication Flow
 * 1. Registration: POST /options → User creates Passkey → POST /verify
 * 2. Login: POST /options → User uses Passkey → POST /verify
 * 3. Session cookie is set on successful authentication
 *
 * @module api/auth
 */

import { Elysia, t } from "elysia";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticatorTransportFuture,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from "@simplewebauthn/types";

import { config } from "../config";
import { validateUsername } from "../utils/validation";
import {
  userRepository,
  credentialRepository,
  challengeRepository,
  sessionRepository,
} from "../db";
import type { AuthUser } from "../types";
import { LIMITS, ERROR_MESSAGES } from "../constants";

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert Uint8Array to base64url string
 * @param arr - The byte array to encode
 * @returns Base64url encoded string
 */
function uint8ArrayToBase64(arr: Uint8Array): string {
  return Buffer.from(arr).toString("base64url");
}

/**
 * Convert base64url credential ID to database format
 * @description The credential ID from WebAuthn response is already base64url encoded.
 * We store it by encoding again to ensure consistent format with registration.
 * @param id - The base64url credential ID from WebAuthn response
 * @returns The credential ID in database storage format
 */
function credentialIdToDbFormat(id: string): string {
  return Buffer.from(id).toString("base64url");
}

/**
 * Get the current Unix timestamp in seconds
 * @returns Current timestamp
 */
function now(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Create a new session for a user
 * @param userId - The user ID
 * @returns The session ID
 */
function createSession(userId: string): string {
  const sessionId = crypto.randomUUID();
  const expiresAt = now() + config.sessionMaxAge / 1000;
  sessionRepository.create(sessionId, userId, expiresAt);
  return sessionId;
}

/**
 * Set the session cookie
 * @param cookie - Elysia cookie object
 * @param sessionId - The session ID to set
 */
function setSessionCookie(cookie: { session: { set: (opts: object) => void } }, sessionId: string): void {
  const isProduction = process.env.NODE_ENV === "production";
  cookie.session.set({
    value: sessionId,
    httpOnly: true,
    secure: isProduction, // HTTPS required in production
    sameSite: isProduction ? "none" : "lax", // "none" for cross-site cookies in production
    maxAge: config.sessionMaxAge / 1000,
    path: "/",
  });
}

// ============================================================================
// Auth User Helper (exported for use by other modules)
// ============================================================================

/**
 * Extract token from Authorization header
 * @param authHeader - The Authorization header value
 * @returns The token or null
 */
function extractBearerToken(authHeader: string | null | undefined): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

/**
 * Get the authenticated user from session cookie or Authorization header
 *
 * @description Validates the session and returns the user info if valid.
 * Supports both cookie-based sessions and Bearer token authentication.
 * Automatically cleans up expired sessions.
 *
 * @param sessionId - The session ID from the cookie (optional)
 * @param authHeader - The Authorization header value (optional)
 * @returns The authenticated user or null if not authenticated
 *
 * @example
 * ```typescript
 * // Cookie-based auth
 * const user = getAuthUser(cookie.session.value);
 *
 * // Token-based auth
 * const user = getAuthUser(undefined, headers.authorization);
 *
 * // Both (cookie takes precedence)
 * const user = getAuthUser(cookie.session.value, headers.authorization);
 * ```
 */
export function getAuthUser(sessionId: string | undefined, authHeader?: string | null): AuthUser | null {
  // Try cookie first, then Authorization header
  const token = sessionId || extractBearerToken(authHeader);
  if (!token) return null;

  const session = sessionRepository.findById(token);
  if (!session) return null;

  // Check if session is expired
  if (session.expires_at < now()) {
    sessionRepository.delete(token);
    return null;
  }

  return { id: session.user_id, username: session.username };
}

// ============================================================================
// Route Definitions
// ============================================================================

/**
 * Authentication routes
 *
 * @description Provides WebAuthn-based passwordless authentication:
 *
 * - `POST /register/options` - Get registration options for a new user
 * - `POST /register/verify` - Complete registration with the Passkey response
 * - `POST /login/options` - Get login options for an existing user
 * - `POST /login/verify` - Complete login with the Passkey response
 * - `POST /logout` - End the current session
 * - `GET /me` - Get the current authenticated user
 */
export const authRoutes = new Elysia({ prefix: "/auth" })

  // ============================================================================
  // Registration
  // ============================================================================

  /**
   * Get registration options
   * @route POST /api/auth/register/options
   * @param body.username - Desired username (3-32 chars, alphanumeric with _ and -)
   * @returns Registration options for WebAuthn or error
   */
  .post(
    "/register/options",
    async ({ body }) => {
      const { username } = body;

      // Validate username format
      const validation = validateUsername(username);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      // Check if username is taken
      const existingUser = userRepository.findByUsername(username);
      if (existingUser) {
        return { success: false, error: ERROR_MESSAGES.USERNAME_EXISTS };
      }

      // Generate temporary user ID for the challenge
      const tempUserId = crypto.randomUUID();

      // Generate WebAuthn registration options
      const options = await generateRegistrationOptions({
        rpName: config.rpName,
        rpID: config.rpID,
        userName: username,
        userDisplayName: username,
        attestationType: "none",
        authenticatorSelection: {
          residentKey: "preferred",
          userVerification: "preferred",
        },
      });

      // Store challenge with expiration
      const challengeExpires = now() + LIMITS.CHALLENGE_EXPIRATION_SECONDS;
      challengeRepository.create(
        crypto.randomUUID(),
        tempUserId,
        options.challenge,
        "registration",
        challengeExpires
      );

      return {
        success: true,
        options,
        tempUserId,
      };
    },
    {
      body: t.Object({
        username: t.String(),
      }),
    }
  )

  /**
   * Verify registration response
   * @route POST /api/auth/register/verify
   * @param body.username - The username
   * @param body.tempUserId - Temporary user ID from options request
   * @param body.response - WebAuthn response from authenticator
   * @returns User info and sets session cookie on success
   */
  .post(
    "/register/verify",
    async ({ body, cookie }) => {
      const { username, tempUserId, response } = body;

      // Find and validate the challenge
      const challengeRecord = challengeRepository.findByUserIdAndType(tempUserId, "registration");
      if (!challengeRecord) {
        return { success: false, error: ERROR_MESSAGES.CHALLENGE_NOT_FOUND };
      }

      if (challengeRecord.expires_at < now()) {
        challengeRepository.delete(challengeRecord.id);
        return { success: false, error: ERROR_MESSAGES.CHALLENGE_EXPIRED };
      }

      try {
        // Verify the WebAuthn response
        const verification = await verifyRegistrationResponse({
          response: response as RegistrationResponseJSON,
          expectedChallenge: challengeRecord.challenge,
          expectedOrigin: config.allowedOrigins,
          expectedRPID: config.rpID,
        });

        if (!verification.verified || !verification.registrationInfo) {
          return { success: false, error: ERROR_MESSAGES.VERIFICATION_FAILED };
        }

        // Clean up the challenge
        challengeRepository.delete(challengeRecord.id);

        // Create the user
        const userId = crypto.randomUUID();
        userRepository.create(userId, username);

        // Store the credential
        const { credential } = verification.registrationInfo;
        credentialRepository.create(
          uint8ArrayToBase64(credential.id),
          userId,
          Buffer.from(credential.publicKey),
          credential.counter,
          JSON.stringify(credential.transports || [])
        );

        // Create session and set cookie
        const sessionId = createSession(userId);
        setSessionCookie(cookie, sessionId);

        return {
          success: true,
          user: { id: userId, username },
          token: sessionId, // Return token for clients that can't use cookies
        };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
    {
      body: t.Object({
        username: t.String(),
        tempUserId: t.String(),
        response: t.Any(),
      }),
    }
  )

  // ============================================================================
  // Login
  // ============================================================================

  /**
   * Get login options (discoverable credentials - no username required)
   * @route POST /api/auth/login/options
   * @param body.username - Optional username (for backward compatibility)
   * @returns Authentication options for WebAuthn
   */
  .post(
    "/login/options",
    async ({ body }) => {
      const { username } = body;

      // If username is provided, use traditional flow
      if (username) {
        const user = userRepository.findByUsername(username);
        if (!user) {
          return { success: false, error: ERROR_MESSAGES.USER_NOT_FOUND };
        }

        const credentials = credentialRepository.findByUserId(user.id);
        if (credentials.length === 0) {
          return { success: false, error: ERROR_MESSAGES.NO_CREDENTIALS };
        }

        const options = await generateAuthenticationOptions({
          rpID: config.rpID,
          allowCredentials: credentials.map((cred) => ({
            id: cred.id,
            transports: cred.transports
              ? (JSON.parse(cred.transports) as AuthenticatorTransportFuture[])
              : undefined,
          })),
          userVerification: "preferred",
        });

        const challengeExpires = now() + LIMITS.CHALLENGE_EXPIRATION_SECONDS;
        challengeRepository.create(
          crypto.randomUUID(),
          user.id,
          options.challenge,
          "authentication",
          challengeExpires
        );

        return {
          success: true,
          options,
          userId: user.id,
        };
      }

      // Discoverable credentials flow - no username required
      const options = await generateAuthenticationOptions({
        rpID: config.rpID,
        userVerification: "preferred",
        // Empty allowCredentials enables discoverable credentials
      });

      // Store challenge without user_id (will be resolved from credential)
      const challengeId = crypto.randomUUID();
      const challengeExpires = now() + LIMITS.CHALLENGE_EXPIRATION_SECONDS;
      challengeRepository.create(
        challengeId,
        null, // No user_id for discoverable credentials
        options.challenge,
        "authentication",
        challengeExpires
      );

      return {
        success: true,
        options,
        challengeId, // Return challengeId instead of userId
      };
    },
    {
      body: t.Object({
        username: t.Optional(t.String()),
      }),
    }
  )

  /**
   * Verify login response
   * @route POST /api/auth/login/verify
   * @param body.userId - The user ID (for traditional flow)
   * @param body.challengeId - The challenge ID (for discoverable credentials flow)
   * @param body.response - WebAuthn response from authenticator
   * @returns User info and sets session cookie on success
   */
  .post(
    "/login/verify",
    async ({ body, cookie }) => {
      const { userId, challengeId, response } = body;

      // Find the credential first (needed for both flows)
      // Convert the credential ID to database format (response.id is base64url, we store it encoded again)
      const dbCredentialId = credentialIdToDbFormat(response.id);
      const credential = credentialRepository.findById(dbCredentialId);
      if (!credential) {
        return { success: false, error: ERROR_MESSAGES.CREDENTIAL_NOT_FOUND };
      }

      // Determine the user - from credential for discoverable, from userId for traditional
      const resolvedUserId = userId || credential.user_id;
      const user = userRepository.findById(resolvedUserId);
      if (!user) {
        return { success: false, error: ERROR_MESSAGES.USER_NOT_FOUND };
      }

      // Verify credential belongs to user (for traditional flow)
      if (userId && credential.user_id !== userId) {
        return { success: false, error: ERROR_MESSAGES.CREDENTIAL_NOT_FOUND };
      }

      // Find and validate the challenge
      let challengeRecord;
      if (challengeId) {
        // Discoverable credentials flow - find by challengeId
        challengeRecord = challengeRepository.findById(challengeId);
      } else if (userId) {
        // Traditional flow - find by userId
        challengeRecord = challengeRepository.findByUserIdAndType(userId, "authentication");
      }

      if (!challengeRecord) {
        return { success: false, error: ERROR_MESSAGES.CHALLENGE_NOT_FOUND };
      }

      if (challengeRecord.expires_at < now()) {
        challengeRepository.delete(challengeRecord.id);
        return { success: false, error: ERROR_MESSAGES.CHALLENGE_EXPIRED };
      }

      try {
        // Verify the authentication response
        // Note: verifyAuthenticationResponse expects credential.id in base64url format (same as response.id)
        const verification = await verifyAuthenticationResponse({
          response: response as AuthenticationResponseJSON,
          expectedChallenge: challengeRecord.challenge,
          expectedOrigin: config.allowedOrigins,
          expectedRPID: config.rpID,
          credential: {
            id: response.id, // Use the original response.id (base64url format)
            publicKey: credential.public_key,
            counter: credential.counter,
            transports: credential.transports
              ? (JSON.parse(credential.transports) as AuthenticatorTransportFuture[])
              : undefined,
          },
        });

        if (!verification.verified) {
          return { success: false, error: ERROR_MESSAGES.VERIFICATION_FAILED };
        }

        // Clean up challenge and update counter
        challengeRepository.delete(challengeRecord.id);
        credentialRepository.updateCounter(credential.id, verification.authenticationInfo.newCounter);

        // Create session and set cookie
        const sessionId = createSession(resolvedUserId);
        setSessionCookie(cookie, sessionId);

        return {
          success: true,
          user: { id: resolvedUserId, username: user.username },
          token: sessionId, // Return token for clients that can't use cookies
        };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
    {
      body: t.Object({
        userId: t.Optional(t.String()),
        challengeId: t.Optional(t.String()),
        response: t.Any(),
      }),
    }
  )

  // ============================================================================
  // Session Management
  // ============================================================================

  /**
   * Logout - end current session
   * @route POST /api/auth/logout
   * @returns Success status
   */
  .post("/logout", ({ cookie }) => {
    const sessionId = cookie.session.value;
    if (sessionId) {
      sessionRepository.delete(sessionId);
      cookie.session.remove();
    }
    return { success: true };
  })

  /**
   * Get current user info
   * @route GET /api/auth/me
   * @returns Current user info or error if not authenticated
   */
  .get("/me", ({ cookie, headers }) => {
    const user = getAuthUser(cookie.session.value, headers.authorization);
    if (!user) {
      return { success: false, error: ERROR_MESSAGES.UNAUTHORIZED };
    }

    return {
      success: true,
      user,
    };
  });
