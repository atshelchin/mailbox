export const config = {
  // 服务配置
  host: process.env.HOST || "0.0.0.0",
  httpPort: parseInt(process.env.HTTP_PORT || "3000"),
  smtpPort: parseInt(process.env.SMTP_PORT || "25"),

  // 域名配置
  serviceDomain: process.env.SERVICE_DOMAIN || "mailbox.0x0.run",
  officialDomains: (process.env.OFFICIAL_DOMAINS || "test1.0x0.run,test2.0x0.run").split(","),

  // WebAuthn 配置
  // 注意: Passkeys 需要配置为前端 WebUI 的域名，而不是后端 API 域名
  // RP_ID: 前端网站的域名 (不含协议和端口)
  // ORIGIN: 前端网站的完整 URL (含协议)
  // 如果前端是 https://mail.example.com，后端 API 是 https://api.mail.example.com
  // 则 RP_ID=mail.example.com, ORIGIN=https://mail.example.com
  rpName: process.env.RP_NAME || "Mailbox",
  rpID: process.env.RP_ID || "mailbox.0x0.run",
  origin: process.env.ORIGIN || "https://mailbox.0x0.run",
  // 支持多个 origin (前端可能有多个域名访问)
  allowedOrigins: (process.env.ALLOWED_ORIGINS || process.env.ORIGIN || "https://mailbox.0x0.run").split(","),

  // 邮件配置
  maxEmailSize: parseInt(process.env.MAX_EMAIL_SIZE || String(100 * 1024 * 1024)), // 100MB
  emailRetentionHours: parseInt(process.env.EMAIL_RETENTION_HOURS || "24"),

  // 数据库
  dbPath: process.env.DB_PATH || "./mailbox.db",

  // Session 配置
  sessionSecret: process.env.SESSION_SECRET || "change-this-secret-in-production",
  sessionMaxAge: parseInt(process.env.SESSION_MAX_AGE || String(7 * 24 * 60 * 60 * 1000)), // 7 days

  // CORS 配置 (允许前端跨域访问)
  corsOrigins: (process.env.CORS_ORIGINS || process.env.ORIGIN || "https://mailbox.0x0.run").split(","),
};
