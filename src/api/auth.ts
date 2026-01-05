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
  cookie.session.set({
    value: sessionId,
    httpOnly: true,
    secure: config.origin.startsWith("https"),
    sameSite: "strict",
    maxAge: config.sessionMaxAge / 1000,
    path: "/",
  });
}

// ============================================================================
// Auth User Helper (exported for use by other modules)
// ============================================================================

/**
 * Get the authenticated user from a session cookie
 *
 * @description Validates the session and returns the user info if valid.
 * Automatically cleans up expired sessions.
 *
 * @param sessionId - The session ID from the cookie
 * @returns The authenticated user or null if not authenticated
 *
 * @example
 * ```typescript
 * const user = getAuthUser(cookie.session.value);
 * if (!user) {
 *   return { success: false, error: "Unauthorized" };
 * }
 * ```
 */
export function getAuthUser(sessionId: string | undefined): AuthUser | null {
  if (!sessionId) return null;

  const session = sessionRepository.findById(sessionId);
  if (!session) return null;

  // Check if session is expired
  if (session.expires_at < now()) {
    sessionRepository.delete(sessionId);
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
   * Get login options
   * @route POST /api/auth/login/options
   * @param body.username - The username to authenticate
   * @returns Authentication options for WebAuthn or error
   */
  .post(
    "/login/options",
    async ({ body }) => {
      const { username } = body;

      // Find the user
      const user = userRepository.findByUsername(username);
      if (!user) {
        return { success: false, error: ERROR_MESSAGES.USER_NOT_FOUND };
      }

      // Get user's credentials
      const credentials = credentialRepository.findByUserId(user.id);
      if (credentials.length === 0) {
        return { success: false, error: ERROR_MESSAGES.NO_CREDENTIALS };
      }

      // Generate authentication options
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

      // Store challenge
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
    },
    {
      body: t.Object({
        username: t.String(),
      }),
    }
  )

  /**
   * Verify login response
   * @route POST /api/auth/login/verify
   * @param body.userId - The user ID from options request
   * @param body.response - WebAuthn response from authenticator
   * @returns User info and sets session cookie on success
   */
  .post(
    "/login/verify",
    async ({ body, cookie }) => {
      const { userId, response } = body;

      // Find the user
      const user = userRepository.findById(userId);
      if (!user) {
        return { success: false, error: ERROR_MESSAGES.USER_NOT_FOUND };
      }

      // Find and validate the challenge
      const challengeRecord = challengeRepository.findByUserIdAndType(userId, "authentication");
      if (!challengeRecord) {
        return { success: false, error: ERROR_MESSAGES.CHALLENGE_NOT_FOUND };
      }

      if (challengeRecord.expires_at < now()) {
        challengeRepository.delete(challengeRecord.id);
        return { success: false, error: ERROR_MESSAGES.CHALLENGE_EXPIRED };
      }

      // Find the credential
      const credential = credentialRepository.findById(response.id);
      if (!credential || credential.user_id !== userId) {
        return { success: false, error: ERROR_MESSAGES.CREDENTIAL_NOT_FOUND };
      }

      try {
        // Verify the authentication response
        const verification = await verifyAuthenticationResponse({
          response: response as AuthenticationResponseJSON,
          expectedChallenge: challengeRecord.challenge,
          expectedOrigin: config.allowedOrigins,
          expectedRPID: config.rpID,
          credential: {
            id: credential.id,
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
        const sessionId = createSession(userId);
        setSessionCookie(cookie, sessionId);

        return {
          success: true,
          user: { id: userId, username: user.username },
        };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
    {
      body: t.Object({
        userId: t.String(),
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
  .get("/me", ({ cookie }) => {
    const user = getAuthUser(cookie.session.value);
    if (!user) {
      return { success: false, error: ERROR_MESSAGES.UNAUTHORIZED };
    }

    return {
      success: true,
      user,
    };
  });
