/**
 * @fileoverview Application constants
 * @description Centralized configuration of magic numbers, limits, and reserved values.
 * This helps avoid scattered literals and makes maintenance easier.
 * @module constants
 */

// ============================================================================
// Validation Constants
// ============================================================================

/**
 * Email local part validation
 */
export const LOCAL_PART = {
  /** Regex pattern for valid local parts (RFC 5321 compliant subset) */
  PATTERN: /^[a-zA-Z0-9]([a-zA-Z0-9._+-]*[a-zA-Z0-9])?$/,
  /** Minimum length for local part */
  MIN_LENGTH: 1,
  /** Maximum length for local part (RFC 5321) */
  MAX_LENGTH: 64,
} as const;

/**
 * Domain name validation
 */
export const DOMAIN = {
  /** Regex pattern for valid domain names */
  PATTERN: /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/,
  /** Maximum domain length (RFC 1035) */
  MAX_LENGTH: 253,
} as const;

/**
 * Username validation
 */
export const USERNAME = {
  /** Regex pattern for valid usernames */
  PATTERN: /^[a-zA-Z0-9_-]+$/,
  /** Minimum length for username */
  MIN_LENGTH: 3,
  /** Maximum length for username */
  MAX_LENGTH: 32,
} as const;

// ============================================================================
// Reserved Values
// ============================================================================

/**
 * Reserved email local parts that cannot be registered
 * @description These are commonly used system addresses that should remain available
 * for the domain owner or system use.
 */
export const RESERVED_LOCAL_PARTS = [
  "admin",
  "administrator",
  "postmaster",
  "hostmaster",
  "webmaster",
  "abuse",
  "noreply",
  "no-reply",
  "mailer-daemon",
  "root",
  "support",
  "info",
  "contact",
  "security",
  "ssl",
  "ftp",
  "mail",
  "www",
  "ns1",
  "ns2",
  "localhost",
  "test",
] as const;

// ============================================================================
// Business Limits
// ============================================================================

/**
 * Application limits
 */
export const LIMITS = {
  /** Maximum mailboxes per user */
  MAX_MAILBOXES_PER_USER: 100,
  /** Maximum emails returned in a list query */
  MAX_EMAILS_PER_PAGE: 100,
  /** Challenge expiration time in seconds (5 minutes) */
  CHALLENGE_EXPIRATION_SECONDS: 300,
} as const;

// ============================================================================
// Time Constants
// ============================================================================

/**
 * Time-related constants
 */
export const TIME = {
  /** Milliseconds in one second */
  SECOND_MS: 1000,
  /** Milliseconds in one minute */
  MINUTE_MS: 60 * 1000,
  /** Milliseconds in one hour */
  HOUR_MS: 60 * 60 * 1000,
  /** Milliseconds in one day */
  DAY_MS: 24 * 60 * 60 * 1000,
  /** Seconds in one hour */
  HOUR_SECONDS: 60 * 60,
} as const;

// ============================================================================
// Error Messages
// ============================================================================

/**
 * Standardized error messages
 */
export const ERROR_MESSAGES = {
  // Authentication
  UNAUTHORIZED: "Unauthorized",
  SESSION_NOT_FOUND: "Session not found",
  SESSION_EXPIRED: "Session expired",
  USER_NOT_FOUND: "User not found",
  USERNAME_EXISTS: "Username already exists",
  CHALLENGE_NOT_FOUND: "Challenge not found or expired",
  CHALLENGE_EXPIRED: "Challenge expired",
  VERIFICATION_FAILED: "Verification failed",
  NO_CREDENTIALS: "No credentials found",
  CREDENTIAL_NOT_FOUND: "Credential not found",

  // Domains
  DOMAIN_NOT_FOUND: "Domain not found",
  DOMAIN_EXISTS: "Domain already exists",
  DOMAIN_NOT_VERIFIED: "Domain not verified",
  CANNOT_ADD_OFFICIAL: "Cannot add official domain",
  CANNOT_DELETE_OFFICIAL: "Cannot delete official domain",
  NOT_YOUR_DOMAIN: "Not your domain",
  TXT_RECORD_NOT_FOUND: "TXT record not found. Please make sure you have added the TXT record and wait for DNS propagation.",
  MX_RECORD_NOT_FOUND: "MX record not found. Please make sure your MX record points to our mail server and wait for DNS propagation.",
  DOMAIN_ACCESS_DENIED: "You don't have permission to create mailboxes on this domain",
  USER_ALREADY_ALLOWED: "User is already allowed on this domain",
  USER_NOT_ALLOWED: "User is not in the allowed list",

  // Mailboxes
  MAILBOX_NOT_FOUND: "Mailbox not found",
  MAILBOX_TAKEN: "This email address is already taken",
  NOT_YOUR_MAILBOX: "Not your mailbox",
  MAX_MAILBOXES_REACHED: "Maximum mailboxes per user reached",
  OWN_DOMAIN_ONLY: "You can only create mailboxes on your own domains",

  // Emails
  EMAIL_NOT_FOUND: "Email not found",
  NOT_YOUR_EMAIL: "Not your email",
  RAW_EMAIL_NOT_FOUND: "Raw email not found",

  // Attachments
  ATTACHMENT_NOT_FOUND: "Attachment not found",
  NOT_YOUR_ATTACHMENT: "Not your attachment",
  ATTACHMENT_CONTENT_NOT_FOUND: "Attachment content not found",

  // Validation
  LOCAL_PART_REQUIRED: "Local part is required",
  DOMAIN_REQUIRED: "Domain is required",
  USERNAME_REQUIRED: "Username is required",
  INVALID_DOMAIN_FORMAT: "Invalid domain format",
  ADDRESS_RESERVED: "This email address is reserved",

  // SMTP
  INVALID_RECIPIENT: "Invalid recipient address",
  MESSAGE_TOO_LARGE: "Message too large",
  NO_VALID_RECIPIENTS: "No valid recipients",
  INTERNAL_ERROR: "Internal server error",
} as const;

// ============================================================================
// HTTP Status Codes
// ============================================================================

/**
 * Common HTTP status codes used in the application
 */
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INTERNAL_ERROR: 500,
} as const;
