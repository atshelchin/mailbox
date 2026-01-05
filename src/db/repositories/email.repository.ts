/**
 * @fileoverview Email repository
 * @description Data access layer for email-related database operations.
 * @module db/repositories/email
 */

import { db } from "../connection";
import type { Email, Attachment, MailboxWithDomain } from "../../types";
import { LIMITS } from "../../constants";

// ============================================================================
// Prepared Statements
// ============================================================================

const statements = {
  // Mailbox queries
  getMailboxById: db.prepare<MailboxWithDomain, [string]>(`
    SELECT m.id, m.user_id, m.local_part, d.name as domain_name
    FROM mailboxes m
    JOIN domains d ON m.domain_id = d.id
    WHERE m.id = ?
  `),

  // Email queries
  findByMailboxId: db.prepare<Email, [string]>(`
    SELECT id, mailbox_id, from_address, to_address, subject, size, received_at
    FROM emails
    WHERE mailbox_id = ?
    ORDER BY received_at DESC
    LIMIT ${LIMITS.MAX_EMAILS_PER_PAGE}
  `),
  findById: db.prepare<Email, [string]>(
    "SELECT * FROM emails WHERE id = ?"
  ),
  getOwner: db.prepare<{ user_id: string }, [string]>(`
    SELECT m.user_id FROM emails e
    JOIN mailboxes m ON e.mailbox_id = m.id
    WHERE e.id = ?
  `),
  countByMailboxId: db.prepare<{ count: number }, [string]>(
    "SELECT COUNT(*) as count FROM emails WHERE mailbox_id = ?"
  ),
  create: db.prepare(`
    INSERT INTO emails (id, mailbox_id, from_address, to_address, subject, text_body, html_body, raw_email, size)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  delete: db.prepare(
    "DELETE FROM emails WHERE id = ?"
  ),

  // Attachment queries
  findAttachmentsByEmailId: db.prepare<Attachment, [string]>(
    "SELECT id, email_id, filename, content_type, size FROM attachments WHERE email_id = ?"
  ),
  findAttachmentById: db.prepare<Attachment, [string]>(
    "SELECT * FROM attachments WHERE id = ?"
  ),
  createAttachment: db.prepare(`
    INSERT INTO attachments (id, email_id, filename, content_type, size, content)
    VALUES (?, ?, ?, ?, ?, ?)
  `),
};

// ============================================================================
// Email Repository
// ============================================================================

/**
 * Repository for email-related database operations
 */
export const emailRepository = {
  /**
   * Get mailbox info by ID
   * @param id - Mailbox ID
   * @returns Mailbox with domain info or null
   */
  getMailboxById(id: string): MailboxWithDomain | null {
    return statements.getMailboxById.get(id) ?? null;
  },

  /**
   * Find emails for a mailbox
   * @param mailboxId - The mailbox ID
   * @returns Array of emails (limited to MAX_EMAILS_PER_PAGE)
   */
  findByMailboxId(mailboxId: string): Email[] {
    return statements.findByMailboxId.all(mailboxId);
  },

  /**
   * Find an email by ID
   * @param id - The email ID
   * @returns The email or null
   */
  findById(id: string): Email | null {
    return statements.findById.get(id) ?? null;
  },

  /**
   * Get the owner user ID of an email
   * @param emailId - The email ID
   * @returns The user ID or null
   */
  getOwnerUserId(emailId: string): string | null {
    const result = statements.getOwner.get(emailId);
    return result?.user_id ?? null;
  },

  /**
   * Count emails in a mailbox
   * @param mailboxId - The mailbox ID
   * @returns The count
   */
  countByMailboxId(mailboxId: string): number {
    const result = statements.countByMailboxId.get(mailboxId);
    return result?.count ?? 0;
  },

  /**
   * Store a new email
   * @param email - Email data to store
   */
  create(email: {
    id: string;
    mailboxId: string;
    fromAddress: string;
    toAddress: string;
    subject: string | null;
    textBody: string | null;
    htmlBody: string | null;
    rawEmail: Buffer;
    size: number;
  }): void {
    statements.create.run(
      email.id,
      email.mailboxId,
      email.fromAddress,
      email.toAddress,
      email.subject,
      email.textBody,
      email.htmlBody,
      email.rawEmail,
      email.size
    );
  },

  /**
   * Delete an email
   * @param id - Email ID
   */
  delete(id: string): void {
    statements.delete.run(id);
  },

  /**
   * Find attachments for an email
   * @param emailId - The email ID
   * @returns Array of attachments (metadata only)
   */
  findAttachmentsByEmailId(emailId: string): Attachment[] {
    return statements.findAttachmentsByEmailId.all(emailId);
  },

  /**
   * Find an attachment by ID
   * @param id - The attachment ID
   * @returns The attachment with content or null
   */
  findAttachmentById(id: string): Attachment | null {
    return statements.findAttachmentById.get(id) ?? null;
  },

  /**
   * Store an attachment
   * @param attachment - Attachment data to store
   */
  createAttachment(attachment: {
    id: string;
    emailId: string;
    filename: string | null;
    contentType: string | null;
    size: number;
    content: Buffer;
  }): void {
    statements.createAttachment.run(
      attachment.id,
      attachment.emailId,
      attachment.filename,
      attachment.contentType,
      attachment.size,
      attachment.content
    );
  },
};
