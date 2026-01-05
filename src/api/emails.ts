/**
 * @fileoverview Email Management API routes
 * @description Handles email retrieval, viewing, and deletion.
 *
 * ## Overview
 * This module provides read-only access to received emails:
 * - List emails in a mailbox
 * - View email details (text/HTML body)
 * - Download raw email (.eml format)
 * - Download attachments
 * - Delete emails
 *
 * ## Security
 * All endpoints require authentication and verify mailbox ownership.
 * Users can only access emails in their own mailboxes.
 *
 * @module api/emails
 */

import { Elysia, t } from "elysia";
import { getAuthUser } from "./auth";
import { emailRepository } from "../db";
import { ERROR_MESSAGES, LIMITS } from "../constants";

// ============================================================================
// Route Definitions
// ============================================================================

/**
 * Email management routes
 *
 * @description Provides email access functionality:
 *
 * - `GET /emails/mailbox/:mailboxId` - List emails in a mailbox
 * - `GET /emails/:id` - Get email details
 * - `GET /emails/:id/raw` - Download raw email (.eml)
 * - `DELETE /emails/:id` - Delete an email
 */
export const emailRoutes = new Elysia({ prefix: "/emails" })

  // ============================================================================
  // List Emails
  // ============================================================================

  /**
   * Get emails in a mailbox
   * @route GET /api/emails/mailbox/:mailboxId
   * @param params.mailboxId - The mailbox ID
   * @param query.page - Page number (default 1)
   * @param query.pageSize - Items per page (default 20, max 100)
   * @description Returns a paginated list of emails in the specified mailbox,
   * sorted by received date (newest first).
   * @returns Paginated list of emails with metadata
   */
  .get(
    "/mailbox/:mailboxId",
    ({ params, query, cookie }) => {
      const user = getAuthUser(cookie.session.value as string | undefined);
      if (!user) {
        return { success: false, error: ERROR_MESSAGES.UNAUTHORIZED };
      }

      const mailbox = emailRepository.getMailboxById(params.mailboxId);
      if (!mailbox) {
        return { success: false, error: ERROR_MESSAGES.MAILBOX_NOT_FOUND };
      }

      if (mailbox.user_id !== user.id) {
        return { success: false, error: ERROR_MESSAGES.NOT_YOUR_MAILBOX };
      }

      // Pagination
      const page = Math.max(1, query.page || 1);
      const pageSize = Math.min(LIMITS.MAX_EMAILS_PER_PAGE, Math.max(1, query.pageSize || 20));
      const offset = (page - 1) * pageSize;

      const emails = emailRepository.findByMailboxId(params.mailboxId, pageSize, offset);
      const total = emailRepository.countByMailboxId(params.mailboxId);
      const totalPages = Math.ceil(total / pageSize);

      return {
        success: true,
        mailbox: {
          id: mailbox.id,
          address: `${mailbox.local_part}@${mailbox.domain_name}`,
        },
        pagination: {
          page,
          pageSize,
          total,
          totalPages,
          hasMore: page < totalPages,
        },
        emails: emails.map((e) => ({
          id: e.id,
          from: e.from_address,
          to: e.to_address,
          subject: e.subject || "(No Subject)",
          size: e.size,
          receivedAt: e.received_at,
        })),
      };
    },
    {
      query: t.Object({
        page: t.Optional(t.Number()),
        pageSize: t.Optional(t.Number()),
      }),
    }
  )

  // ============================================================================
  // Get Email Details
  // ============================================================================

  /**
   * Get email details
   * @route GET /api/emails/:id
   * @param params.id - The email ID
   * @description Returns full email details including body content
   * and attachment metadata. Does not include attachment content.
   * @returns Email details with body and attachments list
   */
  .get("/:id", ({ params, cookie }) => {
    const user = getAuthUser(cookie.session.value as string | undefined);
    if (!user) {
      return { success: false, error: ERROR_MESSAGES.UNAUTHORIZED };
    }

    const ownerUserId = emailRepository.getOwnerUserId(params.id);
    if (!ownerUserId) {
      return { success: false, error: ERROR_MESSAGES.EMAIL_NOT_FOUND };
    }

    if (ownerUserId !== user.id) {
      return { success: false, error: ERROR_MESSAGES.NOT_YOUR_EMAIL };
    }

    const email = emailRepository.findById(params.id);
    if (!email) {
      return { success: false, error: ERROR_MESSAGES.EMAIL_NOT_FOUND };
    }

    const attachments = emailRepository.findAttachmentsByEmailId(params.id);

    return {
      success: true,
      email: {
        id: email.id,
        from: email.from_address,
        to: email.to_address,
        subject: email.subject || "(No Subject)",
        textBody: email.text_body,
        htmlBody: email.html_body,
        size: email.size,
        receivedAt: email.received_at,
        attachments: attachments.map((a) => ({
          id: a.id,
          filename: a.filename || "attachment",
          contentType: a.content_type,
          size: a.size,
        })),
      },
    };
  })

  // ============================================================================
  // Download Raw Email
  // ============================================================================

  /**
   * Download raw email
   * @route GET /api/emails/:id/raw
   * @param params.id - The email ID
   * @description Downloads the original raw email in .eml format.
   * This is the complete email as received by the SMTP server.
   * @returns Raw email file (message/rfc822)
   */
  .get("/:id/raw", ({ params, cookie, set }) => {
    const user = getAuthUser(cookie.session.value as string | undefined);
    if (!user) {
      set.status = 401;
      return { success: false, error: ERROR_MESSAGES.UNAUTHORIZED };
    }

    const ownerUserId = emailRepository.getOwnerUserId(params.id);
    if (!ownerUserId) {
      set.status = 404;
      return { success: false, error: ERROR_MESSAGES.EMAIL_NOT_FOUND };
    }

    if (ownerUserId !== user.id) {
      set.status = 403;
      return { success: false, error: ERROR_MESSAGES.NOT_YOUR_EMAIL };
    }

    const email = emailRepository.findById(params.id);
    if (!email || !email.raw_email) {
      set.status = 404;
      return { success: false, error: ERROR_MESSAGES.RAW_EMAIL_NOT_FOUND };
    }

    set.headers["Content-Type"] = "message/rfc822";
    set.headers["Content-Disposition"] = `attachment; filename="email-${params.id}.eml"`;

    return new Response(Buffer.from(email.raw_email));
  })

  // ============================================================================
  // Delete Email
  // ============================================================================

  /**
   * Delete an email
   * @route DELETE /api/emails/:id
   * @param params.id - The email ID
   * @description Permanently deletes an email and all its attachments.
   * This action is irreversible.
   * @returns Success status
   */
  .delete("/:id", ({ params, cookie }) => {
    const user = getAuthUser(cookie.session.value as string | undefined);
    if (!user) {
      return { success: false, error: ERROR_MESSAGES.UNAUTHORIZED };
    }

    const ownerUserId = emailRepository.getOwnerUserId(params.id);
    if (!ownerUserId) {
      return { success: false, error: ERROR_MESSAGES.EMAIL_NOT_FOUND };
    }

    if (ownerUserId !== user.id) {
      return { success: false, error: ERROR_MESSAGES.NOT_YOUR_EMAIL };
    }

    emailRepository.delete(params.id);
    return { success: true };
  });

// ============================================================================
// Attachment Routes
// ============================================================================

/**
 * Attachment download routes
 *
 * @description Separated from email routes to avoid parameter conflicts.
 *
 * - `GET /attachments/:id` - Download an attachment
 */
export const attachmentRoutes = new Elysia({ prefix: "/attachments" })

  /**
   * Download an attachment
   * @route GET /api/attachments/:id
   * @param params.id - The attachment ID
   * @description Downloads an email attachment. Verifies that the user
   * owns the mailbox containing the email with this attachment.
   * @returns Attachment file with appropriate content type
   */
  .get("/:id", ({ params, cookie, set }) => {
    const user = getAuthUser(cookie.session.value as string | undefined);
    if (!user) {
      set.status = 401;
      return { success: false, error: ERROR_MESSAGES.UNAUTHORIZED };
    }

    const attachment = emailRepository.findAttachmentById(params.id);
    if (!attachment) {
      set.status = 404;
      return { success: false, error: ERROR_MESSAGES.ATTACHMENT_NOT_FOUND };
    }

    // Verify email ownership
    const ownerUserId = emailRepository.getOwnerUserId(attachment.email_id);
    if (!ownerUserId || ownerUserId !== user.id) {
      set.status = 403;
      return { success: false, error: ERROR_MESSAGES.NOT_YOUR_ATTACHMENT };
    }

    if (!attachment.content) {
      set.status = 404;
      return { success: false, error: ERROR_MESSAGES.ATTACHMENT_CONTENT_NOT_FOUND };
    }

    set.headers["Content-Type"] = attachment.content_type || "application/octet-stream";
    set.headers["Content-Disposition"] = `attachment; filename="${attachment.filename || "attachment"}"`;

    return new Response(Buffer.from(attachment.content));
  });
