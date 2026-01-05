/**
 * @fileoverview Database module entry point
 * @description Re-exports database connection, schema utilities, and repositories.
 * This is the main entry point for all database-related imports.
 * @module db
 */

// Connection
export { db } from "./connection";

// Schema and initialization
export { initDatabase, cleanupExpiredData } from "./schema";

// Repositories
export {
  userRepository,
  credentialRepository,
  challengeRepository,
  sessionRepository,
  domainRepository,
  mailboxRepository,
  emailRepository,
} from "./repositories";
