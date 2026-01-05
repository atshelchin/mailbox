/**
 * @fileoverview Mailbox Management API routes
 * @description Handles mailbox registration and management.
 *
 * ## Overview
 * This module manages email mailboxes (addresses):
 * - Users can "claim" email addresses on available domains
 * - Each mailbox is a combination of local_part@domain
 * - Mailboxes on official domains are first-come-first-served
 * - Mailboxes on custom domains are only for the domain owner
 *
 * ## Business Rules
 * - Maximum 100 mailboxes per user
 * - Local parts are case-insensitive (stored lowercase)
 * - Reserved local parts (admin, postmaster, etc.) are blocked
 * - Custom domain mailboxes require domain ownership
 *
 * @module api/mailboxes
 */

import { Elysia, t } from "elysia";
import { getAuthUser } from "./auth";
import { validateLocalPart } from "../utils/validation";
import { domainRepository, mailboxRepository, emailRepository } from "../db";
import { ERROR_MESSAGES, LIMITS } from "../constants";
import type { Mailbox } from "../types";

// ============================================================================
// Route Definitions
// ============================================================================

/**
 * Mailbox management routes
 *
 * @description Provides mailbox management functionality:
 *
 * - `GET /mailboxes` - List user's mailboxes
 * - `POST /mailboxes` - Register a new mailbox
 * - `GET /mailboxes/:id` - Get mailbox details
 * - `DELETE /mailboxes/:id` - Delete a mailbox
 */
export const mailboxRoutes = new Elysia({ prefix: "/mailboxes" })

  // ============================================================================
  // List Mailboxes
  // ============================================================================

  /**
   * Get user's mailboxes
   * @route GET /api/mailboxes
   * @description Returns mailboxes owned by the current user with pagination.
   * @param query.page - Page number (default 1)
   * @param query.pageSize - Items per page (default 20, max 100)
   * @returns List of mailboxes with full email addresses and pagination info
   */
  .get(
    "/",
    ({ cookie, query, headers }) => {
      const user = getAuthUser(cookie.session.value as string | undefined, headers.authorization);
      if (!user) {
        return { success: false, error: ERROR_MESSAGES.UNAUTHORIZED };
      }

      // Pagination
      const page = Math.max(1, query.page || 1);
      const pageSize = Math.min(LIMITS.MAX_MAILBOXES_PER_PAGE, Math.max(1, query.pageSize || 20));
      const offset = (page - 1) * pageSize;

      const mailboxes = mailboxRepository.findByUserId(user.id, pageSize, offset);
      const total = mailboxRepository.countByUserId(user.id);
      const totalPages = Math.ceil(total / pageSize);

      return {
        success: true,
        pagination: {
          page,
          pageSize,
          total,
          totalPages,
          hasMore: page < totalPages,
        },
        mailboxes: mailboxes.map((m) => ({
          id: m.id,
          address: `${m.local_part}@${m.domain_name}`,
          localPart: m.local_part,
          domain: m.domain_name,
          emailCount: emailRepository.countByMailboxId(m.id),
          createdAt: m.created_at,
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
  // Register Mailbox
  // ============================================================================

  /**
   * Register a new mailbox
   * @route POST /api/mailboxes
   * @param body.localPart - The local part of the email (before @)
   * @param body.domainId - The domain ID to use
   * @description Claims a new email address. For official domains, addresses are
   * first-come-first-served. For custom domains, only the domain owner can create mailboxes.
   * @returns The created mailbox details
   */
  .post(
    "/",
    ({ body, cookie, headers }) => {
      const user = getAuthUser(cookie.session.value as string | undefined, headers.authorization);
      if (!user) {
        return { success: false, error: ERROR_MESSAGES.UNAUTHORIZED };
      }

      const { localPart, domainId } = body;
      const normalizedLocalPart = localPart.toLowerCase().trim();

      // Validate local part format
      const validation = validateLocalPart(normalizedLocalPart);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      // Check if domain exists and is available
      const domain = domainRepository.findById(domainId);
      if (!domain) {
        return { success: false, error: ERROR_MESSAGES.DOMAIN_NOT_FOUND };
      }

      // Domain must be official or verified
      if (domain.is_official !== 1 && domain.verified !== 1) {
        return { success: false, error: ERROR_MESSAGES.DOMAIN_NOT_VERIFIED };
      }

      // Check if user can create mailboxes on this domain
      if (!domainRepository.canUserCreateMailbox(domain, user.id)) {
        return { success: false, error: ERROR_MESSAGES.DOMAIN_ACCESS_DENIED };
      }

      // Check user mailbox limit
      const count = mailboxRepository.countByUserId(user.id);
      if (count >= LIMITS.MAX_MAILBOXES_PER_USER) {
        return { success: false, error: ERROR_MESSAGES.MAX_MAILBOXES_REACHED };
      }

      // Check if mailbox already exists
      if (mailboxRepository.exists(normalizedLocalPart, domainId)) {
        return { success: false, error: ERROR_MESSAGES.MAILBOX_TAKEN };
      }

      // Create the mailbox
      const mailboxId = crypto.randomUUID();
      mailboxRepository.create(mailboxId, normalizedLocalPart, domainId, user.id);

      return {
        success: true,
        mailbox: {
          id: mailboxId,
          address: `${normalizedLocalPart}@${domain.name}`,
          localPart: normalizedLocalPart,
          domain: domain.name,
        },
      };
    },
    {
      body: t.Object({
        localPart: t.String(),
        domainId: t.String(),
      }),
    }
  )

  // ============================================================================
  // Get Mailbox Details
  // ============================================================================

  /**
   * Get mailbox details
   * @route GET /api/mailboxes/:id
   * @param params.id - The mailbox ID
   * @description Returns detailed information about a specific mailbox.
   * @returns Mailbox details
   */
  .get("/:id", ({ params, cookie, headers }) => {
    const user = getAuthUser(cookie.session.value as string | undefined, headers.authorization);
    if (!user) {
      return { success: false, error: ERROR_MESSAGES.UNAUTHORIZED };
    }

    const mailbox = mailboxRepository.findById(params.id);
    if (!mailbox) {
      return { success: false, error: ERROR_MESSAGES.MAILBOX_NOT_FOUND };
    }

    if (mailbox.user_id !== user.id) {
      return { success: false, error: ERROR_MESSAGES.NOT_YOUR_MAILBOX };
    }

    return {
      success: true,
      mailbox: {
        id: mailbox.id,
        address: `${mailbox.local_part}@${mailbox.domain_name}`,
        localPart: mailbox.local_part,
        domain: mailbox.domain_name,
        createdAt: mailbox.created_at,
      },
    };
  })

  // ============================================================================
  // Delete Mailbox
  // ============================================================================

  /**
   * Delete a mailbox
   * @route DELETE /api/mailboxes/:id
   * @param params.id - The mailbox ID
   * @description Deletes a mailbox and all associated emails.
   * This action is irreversible.
   * @returns Success status
   */
  .delete("/:id", ({ params, cookie, headers }) => {
    const user = getAuthUser(cookie.session.value as string | undefined, headers.authorization);
    if (!user) {
      return { success: false, error: ERROR_MESSAGES.UNAUTHORIZED };
    }

    const mailbox = mailboxRepository.findById(params.id);
    if (!mailbox) {
      return { success: false, error: ERROR_MESSAGES.MAILBOX_NOT_FOUND };
    }

    if (mailbox.user_id !== user.id) {
      return { success: false, error: ERROR_MESSAGES.NOT_YOUR_MAILBOX };
    }

    mailboxRepository.delete(params.id);
    return { success: true };
  });

// ============================================================================
// Exported Functions for SMTP Server
// ============================================================================

/**
 * Find a mailbox by email address
 *
 * @description Used by the SMTP server to validate recipients and store emails.
 *
 * @param localPart - The local part of the email (before @)
 * @param domain - The domain name
 * @returns The mailbox or null if not found
 *
 * @example
 * ```typescript
 * const mailbox = findMailboxByAddress("john", "example.com");
 * if (mailbox) {
 *   // Store email for this mailbox
 * }
 * ```
 */
export function findMailboxByAddress(localPart: string, domain: string): Mailbox | null {
  return mailboxRepository.findByAddress(localPart.toLowerCase(), domain.toLowerCase());
}

/**
 * Get the owner of a mailbox
 *
 * @description Used to verify ownership for email access control.
 *
 * @param mailboxId - The mailbox ID
 * @returns The user ID of the owner or null
 */
export function getMailboxOwner(mailboxId: string): string | null {
  const mailbox = mailboxRepository.findById(mailboxId);
  return mailbox?.user_id || null;
}
