import { Database } from "bun:sqlite";
import { config } from "../config";

export const db = new Database(config.dbPath);

// 启用 WAL 模式以提高并发性能
db.exec("PRAGMA journal_mode = WAL");

// 初始化数据库 schema - 在模块加载时立即执行
function initSchema() {
  db.exec(`
    -- 用户表
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      created_at INTEGER DEFAULT (unixepoch())
    );

    -- Passkey 凭证表
    CREATE TABLE IF NOT EXISTS credentials (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      public_key BLOB NOT NULL,
      counter INTEGER DEFAULT 0,
      transports TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    );

    -- 用户挑战表 (用于 WebAuthn 注册/登录)
    CREATE TABLE IF NOT EXISTS challenges (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      challenge TEXT NOT NULL,
      type TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER DEFAULT (unixepoch())
    );

    -- Session 表
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      created_at INTEGER DEFAULT (unixepoch())
    );

    -- 域名表
    CREATE TABLE IF NOT EXISTS domains (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      txt_record TEXT,
      verified INTEGER DEFAULT 0,
      is_official INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch())
    );

    -- 邮箱地址表
    CREATE TABLE IF NOT EXISTS mailboxes (
      id TEXT PRIMARY KEY,
      local_part TEXT NOT NULL,
      domain_id TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER DEFAULT (unixepoch()),
      UNIQUE(local_part, domain_id)
    );

    -- 邮件表
    CREATE TABLE IF NOT EXISTS emails (
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
    );

    -- 附件表
    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      email_id TEXT NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
      filename TEXT,
      content_type TEXT,
      size INTEGER,
      content BLOB
    );

    -- 索引
    CREATE INDEX IF NOT EXISTS idx_credentials_user ON credentials(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_challenges_expires ON challenges(expires_at);
    CREATE INDEX IF NOT EXISTS idx_domains_user ON domains(user_id);
    CREATE INDEX IF NOT EXISTS idx_domains_name ON domains(name);
    CREATE INDEX IF NOT EXISTS idx_mailboxes_user ON mailboxes(user_id);
    CREATE INDEX IF NOT EXISTS idx_mailboxes_domain ON mailboxes(domain_id);
    CREATE INDEX IF NOT EXISTS idx_mailboxes_local_domain ON mailboxes(local_part, domain_id);
    CREATE INDEX IF NOT EXISTS idx_emails_mailbox ON emails(mailbox_id);
    CREATE INDEX IF NOT EXISTS idx_emails_received ON emails(received_at);
    CREATE INDEX IF NOT EXISTS idx_attachments_email ON attachments(email_id);
  `);

  // 初始化官方域名
  initOfficialDomains();
}

function initOfficialDomains() {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO domains (id, name, is_official, verified)
    VALUES (?, ?, 1, 1)
  `);

  for (const domain of config.officialDomains) {
    stmt.run(crypto.randomUUID(), domain.trim());
  }
}

// 清理过期数据
export function cleanupExpiredData() {
  const now = Math.floor(Date.now() / 1000);

  // 清理过期 session
  db.exec(`DELETE FROM sessions WHERE expires_at < ${now}`);

  // 清理过期挑战
  db.exec(`DELETE FROM challenges WHERE expires_at < ${now}`);

  // 清理过期邮件 (24小时)
  const retentionSeconds = config.emailRetentionHours * 60 * 60;
  db.exec(`DELETE FROM emails WHERE received_at < ${now - retentionSeconds}`);
}

// 导出初始化函数
export function initDatabase() {
  initSchema();
}

// 模块加载时立即初始化
initSchema();
