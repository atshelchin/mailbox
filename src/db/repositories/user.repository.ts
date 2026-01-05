/**
 * @fileoverview User repository
 * @description Data access layer for user-related database operations.
 * Follows the Repository pattern to separate data access from business logic.
 * @module db/repositories/user
 */

import { db } from "../connection";
import type { User, Credential, Challenge, Session, SessionWithUser } from "../../types";

// ============================================================================
// Prepared Statements
// ============================================================================

const statements = {
  // User queries
  findByUsername: db.prepare<User, [string]>(
    "SELECT * FROM users WHERE username = ?"
  ),
  findById: db.prepare<User, [string]>(
    "SELECT * FROM users WHERE id = ?"
  ),
  create: db.prepare(
    "INSERT INTO users (id, username) VALUES (?, ?)"
  ),

  // Credential queries
  findCredentialsByUserId: db.prepare<Credential, [string]>(
    "SELECT * FROM credentials WHERE user_id = ?"
  ),
  findCredentialById: db.prepare<Credential, [string]>(
    "SELECT * FROM credentials WHERE id = ?"
  ),
  createCredential: db.prepare(
    "INSERT INTO credentials (id, user_id, public_key, counter, transports) VALUES (?, ?, ?, ?, ?)"
  ),
  updateCredentialCounter: db.prepare(
    "UPDATE credentials SET counter = ? WHERE id = ?"
  ),

  // Challenge queries
  createChallenge: db.prepare(
    "INSERT INTO challenges (id, user_id, challenge, type, expires_at) VALUES (?, ?, ?, ?, ?)"
  ),
  findChallengeById: db.prepare<Challenge, [string]>(
    "SELECT * FROM challenges WHERE id = ?"
  ),
  findChallenge: db.prepare<Challenge, [string, string]>(
    "SELECT * FROM challenges WHERE user_id = ? AND type = ? ORDER BY created_at DESC LIMIT 1"
  ),
  findChallengeByValue: db.prepare<Challenge, [string, string]>(
    "SELECT * FROM challenges WHERE challenge = ? AND type = ? ORDER BY created_at DESC LIMIT 1"
  ),
  deleteChallenge: db.prepare(
    "DELETE FROM challenges WHERE id = ?"
  ),

  // Session queries
  createSession: db.prepare(
    "INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)"
  ),
  findSession: db.prepare<SessionWithUser, [string]>(
    "SELECT s.*, u.username FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.id = ?"
  ),
  deleteSession: db.prepare(
    "DELETE FROM sessions WHERE id = ?"
  ),
};

// ============================================================================
// User Repository
// ============================================================================

/**
 * Repository for user-related database operations
 */
export const userRepository = {
  /**
   * Find a user by username
   * @param username - The username to search for
   * @returns The user or null if not found
   */
  findByUsername(username: string): User | null {
    return statements.findByUsername.get(username) ?? null;
  },

  /**
   * Find a user by ID
   * @param id - The user ID
   * @returns The user or null if not found
   */
  findById(id: string): User | null {
    return statements.findById.get(id) ?? null;
  },

  /**
   * Create a new user
   * @param id - The user ID (UUID)
   * @param username - The username
   */
  create(id: string, username: string): void {
    statements.create.run(id, username);
  },
};

// ============================================================================
// Credential Repository
// ============================================================================

/**
 * Repository for WebAuthn credential operations
 */
export const credentialRepository = {
  /**
   * Find all credentials for a user
   * @param userId - The user ID
   * @returns Array of credentials
   */
  findByUserId(userId: string): Credential[] {
    return statements.findCredentialsByUserId.all(userId);
  },

  /**
   * Find a credential by ID
   * @param id - The credential ID
   * @returns The credential or null if not found
   */
  findById(id: string): Credential | null {
    return statements.findCredentialById.get(id) ?? null;
  },

  /**
   * Create a new credential
   * @param id - Base64url-encoded credential ID
   * @param userId - The user ID
   * @param publicKey - COSE public key
   * @param counter - Initial counter value
   * @param transports - JSON array of transport types
   */
  create(
    id: string,
    userId: string,
    publicKey: Buffer,
    counter: number,
    transports: string
  ): void {
    statements.createCredential.run(id, userId, publicKey, counter, transports);
  },

  /**
   * Update the counter for a credential
   * @param id - The credential ID
   * @param counter - The new counter value
   */
  updateCounter(id: string, counter: number): void {
    statements.updateCredentialCounter.run(counter, id);
  },
};

// ============================================================================
// Challenge Repository
// ============================================================================

/**
 * Repository for WebAuthn challenge operations
 */
export const challengeRepository = {
  /**
   * Create a new challenge
   * @param id - Challenge ID
   * @param userId - Associated user ID
   * @param challenge - The challenge string
   * @param type - Challenge type
   * @param expiresAt - Expiration timestamp
   */
  create(
    id: string,
    userId: string | null,
    challenge: string,
    type: string,
    expiresAt: number
  ): void {
    statements.createChallenge.run(id, userId, challenge, type, expiresAt);
  },

  /**
   * Find a challenge by ID
   * @param id - The challenge ID
   * @returns The challenge or null
   */
  findById(id: string): Challenge | null {
    return statements.findChallengeById.get(id) ?? null;
  },

  /**
   * Find the latest challenge for a user and type
   * @param userId - The user ID
   * @param type - Challenge type
   * @returns The challenge or null
   */
  findByUserIdAndType(userId: string, type: string): Challenge | null {
    return statements.findChallenge.get(userId, type) ?? null;
  },

  /**
   * Find a challenge by its value
   * @param challenge - The challenge string
   * @param type - Challenge type
   * @returns The challenge or null
   */
  findByValue(challenge: string, type: string): Challenge | null {
    return statements.findChallengeByValue.get(challenge, type) ?? null;
  },

  /**
   * Delete a challenge
   * @param id - The challenge ID
   */
  delete(id: string): void {
    statements.deleteChallenge.run(id);
  },
};

// ============================================================================
// Session Repository
// ============================================================================

/**
 * Repository for session operations
 */
export const sessionRepository = {
  /**
   * Create a new session
   * @param id - Session ID
   * @param userId - User ID
   * @param expiresAt - Expiration timestamp
   */
  create(id: string, userId: string, expiresAt: number): void {
    statements.createSession.run(id, userId, expiresAt);
  },

  /**
   * Find a session by ID with user information
   * @param id - Session ID
   * @returns The session with username or null
   */
  findById(id: string): SessionWithUser | null {
    return statements.findSession.get(id) ?? null;
  },

  /**
   * Delete a session
   * @param id - Session ID
   */
  delete(id: string): void {
    statements.deleteSession.run(id);
  },
};
