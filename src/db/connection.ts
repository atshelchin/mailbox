/**
 * @fileoverview Database connection
 * @description Initializes and exports the SQLite database connection.
 * Uses Bun's built-in SQLite driver with WAL mode for better concurrency.
 * @module db/connection
 */

import { Database } from "bun:sqlite";
import { config } from "../config";

/**
 * SQLite database connection instance
 * @description Singleton database connection used throughout the application.
 * WAL (Write-Ahead Logging) mode is enabled for better concurrent read/write performance.
 */
export const db = new Database(config.dbPath);

// Enable WAL mode for better concurrent performance
db.exec("PRAGMA journal_mode = WAL");

/**
 * SQL schema statements
 * @description Creates all tables and indexes if they don't exist.
 * Each statement is executed separately for better error handling.
 */
const SCHEMA_STATEMENTS = [
  // User Management Tables
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    created_at INTEGER DEFAULT (unixepoch())
  )`,

  `CREATE TABLE IF NOT EXISTS credentials (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    public_key BLOB NOT NULL,
    counter INTEGER DEFAULT 0,
    transports TEXT,
    created_at INTEGER DEFAULT (unixepoch())
  )`,

  `CREATE TABLE IF NOT EXISTS challenges (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    challenge TEXT NOT NULL,
    type TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER DEFAULT (unixepoch())
  )`,

  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER DEFAULT (unixepoch())
  )`,

  // Domain and Mailbox Tables
  `CREATE TABLE IF NOT EXISTS domains (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    txt_record TEXT,
    verified INTEGER DEFAULT 0,
    verified_by TEXT,
    is_official INTEGER DEFAULT 0,
    visibility INTEGER DEFAULT 0,
    auto_discovered INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (unixepoch())
  )`,

  `CREATE TABLE IF NOT EXISTS domain_allowed_users (
    id TEXT PRIMARY KEY,
    domain_id TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER DEFAULT (unixepoch()),
    UNIQUE(domain_id, user_id)
  )`,

  `CREATE TABLE IF NOT EXISTS mailboxes (
    id TEXT PRIMARY KEY,
    local_part TEXT NOT NULL,
    domain_id TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER DEFAULT (unixepoch()),
    UNIQUE(local_part, domain_id)
  )`,

  // Email Storage Tables
  `CREATE TABLE IF NOT EXISTS emails (
    id TEXT PRIMARY KEY,
    mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
    from_address TEXT NOT NULL,
    to_address TEXT NOT NULL,
    subject TEXT,
    text_body TEXT,
    html_body TEXT,
    raw_email BLOB,
    size INTEGER,
    received_at INTEGER DEFAULT (unixepoch())
  )`,

  `CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    email_id TEXT NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
    filename TEXT,
    content_type TEXT,
    size INTEGER,
    content BLOB
  )`,

  // Indexes
  "CREATE INDEX IF NOT EXISTS idx_credentials_user ON credentials(user_id)",
  "CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)",
  "CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)",
  "CREATE INDEX IF NOT EXISTS idx_challenges_expires ON challenges(expires_at)",
  "CREATE INDEX IF NOT EXISTS idx_domains_user ON domains(user_id)",
  "CREATE INDEX IF NOT EXISTS idx_domains_name ON domains(name)",
  "CREATE INDEX IF NOT EXISTS idx_domain_allowed_users_domain ON domain_allowed_users(domain_id)",
  "CREATE INDEX IF NOT EXISTS idx_domain_allowed_users_user ON domain_allowed_users(user_id)",
  "CREATE INDEX IF NOT EXISTS idx_mailboxes_user ON mailboxes(user_id)",
  "CREATE INDEX IF NOT EXISTS idx_mailboxes_domain ON mailboxes(domain_id)",
  "CREATE INDEX IF NOT EXISTS idx_mailboxes_local_domain ON mailboxes(local_part, domain_id)",
  "CREATE INDEX IF NOT EXISTS idx_emails_mailbox ON emails(mailbox_id)",
  "CREATE INDEX IF NOT EXISTS idx_emails_received ON emails(received_at)",
  "CREATE INDEX IF NOT EXISTS idx_attachments_email ON attachments(email_id)",
];

// Initialize schema immediately when module is loaded
for (const sql of SCHEMA_STATEMENTS) {
  db.exec(sql);
}
