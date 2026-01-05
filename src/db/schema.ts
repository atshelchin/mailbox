/**
 * @fileoverview Database initialization and maintenance
 * @description Provides database initialization and cleanup utilities.
 * Schema is created in connection.ts to ensure it exists before prepared statements.
 * @module db/schema
 */

import { db } from "./connection";
import { config } from "../config";

// Prepared statement for inserting official domains
const insertOfficialDomain = db.prepare(
  "INSERT OR IGNORE INTO domains (id, name, is_official, verified) VALUES (?, ?, 1, 1)"
);

/**
 * Initialize official domains from configuration
 * @description Ensures all configured official domains exist in the database.
 */
function initOfficialDomains(): void {
  for (const domain of config.officialDomains) {
    const trimmedDomain = domain.trim();
    if (trimmedDomain) {
      insertOfficialDomain.run(crypto.randomUUID(), trimmedDomain);
    }
  }
}

/**
 * Initialize the complete database
 * @description Seeds initial data (official domains).
 * Schema is already created in connection.ts.
 * Should be called once at application startup.
 */
export function initDatabase(): void {
  initOfficialDomains();
}

/**
 * Clean up expired data
 * @description Removes expired sessions, challenges, and old emails.
 * Should be called periodically by a cleanup job.
 *
 * @example
 * ```typescript
 * // Call in a periodic cleanup job
 * setInterval(() => {
 *   cleanupExpiredData();
 * }, 60 * 60 * 1000); // Every hour
 * ```
 */
export function cleanupExpiredData(): void {
  const now = Math.floor(Date.now() / 1000);
  const retentionSeconds = config.emailRetentionHours * 60 * 60;

  // Delete expired sessions
  db.exec(`DELETE FROM sessions WHERE expires_at < ${now}`);

  // Delete expired challenges
  db.exec(`DELETE FROM challenges WHERE expires_at < ${now}`);

  // Delete expired emails (cascades to attachments)
  db.exec(`DELETE FROM emails WHERE received_at < ${now - retentionSeconds}`);
}

// Initialize official domains on module load
initOfficialDomains();
