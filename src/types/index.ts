/**
 * @fileoverview Shared type definitions for the Mailbox Service
 * @description This module contains all TypeScript interfaces and types used across the application.
 * Centralizing types ensures consistency and enables better type safety throughout the codebase.
 * @module types
 */

// ============================================================================
// Database Entity Types
// ============================================================================

/**
 * User entity from the database
 * @description Represents a registered user in the system who can authenticate via Passkeys
 */
export interface User {
  /** Unique identifier (UUID v4) */
  id: string;
  /** Unique username for display and login */
  username: string;
  /** Unix timestamp of account creation */
  created_at: number;
}

/**
 * WebAuthn credential stored in the database
 * @description Represents a Passkey credential associated with a user
 */
export interface Credential {
  /** Base64url-encoded credential ID */
  id: string;
  /** Reference to the owning user */
  user_id: string;
  /** COSE public key in binary format */
  public_key: Uint8Array;
  /** Signature counter for replay attack prevention */
  counter: number;
  /** JSON array of transport types (e.g., "usb", "nfc", "ble", "internal") */
  transports: string | null;
  /** Unix timestamp of credential creation */
  created_at: number;
}

/**
 * WebAuthn challenge for registration/authentication
 * @description Temporary storage for challenges during the WebAuthn ceremony
 */
export interface Challenge {
  /** Unique identifier */
  id: string;
  /** Associated user ID (null for registration) */
  user_id: string | null;
  /** Base64url-encoded challenge string */
  challenge: string;
  /** Challenge type: "registration" or "authentication" */
  type: "registration" | "authentication";
  /** Unix timestamp when this challenge expires */
  expires_at: number;
  /** Unix timestamp of creation */
  created_at: number;
}

/**
 * User session for maintaining authentication state
 * @description Sessions are cookie-based and expire after a configurable period
 */
export interface Session {
  /** Session ID stored in cookie */
  id: string;
  /** Reference to the authenticated user */
  user_id: string;
  /** Unix timestamp when this session expires */
  expires_at: number;
  /** Unix timestamp of session creation */
  created_at: number;
}

/**
 * Extended session with username for convenience
 */
export interface SessionWithUser extends Session {
  username: string;
}

/**
 * Email domain entity
 * @description Represents both official and user-added custom domains
 */
export interface Domain {
  /** Unique identifier (UUID v4) */
  id: string;
  /** Fully qualified domain name (lowercase) */
  name: string;
  /** Owner user ID (null for official domains) */
  user_id: string | null;
  /** TXT record value for domain verification */
  txt_record: string | null;
  /** Whether the domain ownership is verified (0 or 1) */
  verified: number;
  /** Whether this is an official/system domain (0 or 1) */
  is_official: number;
  /** Unix timestamp of domain creation */
  created_at: number;
}

/**
 * Mailbox entity representing an email address
 * @description A mailbox is the combination of local_part@domain
 */
export interface Mailbox {
  /** Unique identifier (UUID v4) */
  id: string;
  /** Local part of email (before @) */
  local_part: string;
  /** Reference to the domain */
  domain_id: string;
  /** Reference to the owning user */
  user_id: string;
  /** Unix timestamp of mailbox creation */
  created_at: number;
}

/**
 * Extended mailbox with domain name
 */
export interface MailboxWithDomain extends Mailbox {
  domain_name: string;
}

/**
 * Email message entity
 * @description Represents a received email stored in the database
 */
export interface Email {
  /** Unique identifier (UUID v4) */
  id: string;
  /** Reference to the receiving mailbox */
  mailbox_id: string;
  /** Sender's email address */
  from_address: string;
  /** Recipient's email address */
  to_address: string;
  /** Email subject line */
  subject: string | null;
  /** Plain text body content */
  text_body: string | null;
  /** HTML body content */
  html_body: string | null;
  /** Complete raw email in RFC 5322 format */
  raw_email: Uint8Array | null;
  /** Size in bytes */
  size: number | null;
  /** Unix timestamp when the email was received */
  received_at: number;
}

/**
 * Email attachment entity
 */
export interface Attachment {
  /** Unique identifier (UUID v4) */
  id: string;
  /** Reference to the parent email */
  email_id: string;
  /** Original filename */
  filename: string | null;
  /** MIME content type */
  content_type: string | null;
  /** Size in bytes */
  size: number | null;
  /** Binary content of the attachment */
  content: Uint8Array | null;
}

// ============================================================================
// API Response Types
// ============================================================================

/**
 * Base API response structure
 */
export interface ApiResponse<T = unknown> {
  /** Indicates if the operation was successful */
  success: boolean;
  /** Error message if success is false */
  error?: string;
  /** Response data if success is true */
  data?: T;
}

/**
 * Authenticated user context
 */
export interface AuthUser {
  id: string;
  username: string;
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
}

// ============================================================================
// DTO Types (Data Transfer Objects)
// ============================================================================

/**
 * Domain response DTO
 */
export interface DomainDTO {
  id: string;
  name: string;
  isOfficial: boolean;
  isMine?: boolean;
  verified?: boolean;
  txtRecord?: string;
  createdAt?: number;
}

/**
 * Mailbox response DTO
 */
export interface MailboxDTO {
  id: string;
  address: string;
  localPart: string;
  domain: string;
  createdAt?: number;
}

/**
 * Email list item DTO
 */
export interface EmailListItemDTO {
  id: string;
  from: string;
  to: string;
  subject: string;
  size: number | null;
  receivedAt: number;
}

/**
 * Email detail DTO
 */
export interface EmailDetailDTO extends EmailListItemDTO {
  textBody: string | null;
  htmlBody: string | null;
  attachments: AttachmentDTO[];
}

/**
 * Attachment DTO
 */
export interface AttachmentDTO {
  id: string;
  filename: string;
  contentType: string | null;
  size: number | null;
}

// ============================================================================
// SMTP Types
// ============================================================================

/**
 * Parsed email address
 */
export interface ParsedEmailAddress {
  localPart: string;
  domain: string;
}

/**
 * Email processing result
 */
export interface EmailProcessingResult {
  accepted: string[];
  rejected: string[];
}
