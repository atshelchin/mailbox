/**
 * @fileoverview Domain Management API routes
 * @description Handles domain registration, verification, and management.
 *
 * ## Overview
 * This module manages email domains:
 * - Official domains: Pre-configured domains anyone can use
 * - User domains: Custom domains verified via DNS TXT or MX records
 * - Auto-discovered domains: Domains verified via MX pointing to our server
 *
 * ## Domain Verification Flow
 * Method A (TXT Record):
 * 1. User adds a domain: POST /domains
 * 2. System returns a TXT record value
 * 3. User adds TXT record to their DNS
 * 4. User triggers verification: POST /domains/:id/verify
 * 5. System checks DNS and marks domain as verified
 *
 * Method B (MX Record):
 * 1. User adds a domain with verifyByMx=true: POST /domains
 * 2. User points MX record to our mail server
 * 3. User triggers verification: POST /domains/:id/verify
 * 4. System checks MX and marks domain as verified
 *
 * ## Domain Visibility
 * - Private (0): Only owner can create mailboxes
 * - Partial (1): Owner and allowed users can create mailboxes
 * - Public (2): Anyone can create mailboxes
 *
 * @module api/domains
 */

import { Elysia, t } from "elysia";
import { config } from "../config";
import { getAuthUser } from "./auth";
import { validateDomain } from "../utils/validation";
import {
  verifyTxtRecord,
  generateTxtRecord,
  verifyMxRecord,
  getMxRecords,
} from "../utils/dns";
import { domainRepository, userRepository } from "../db";
import { ERROR_MESSAGES, LIMITS } from "../constants";
import { DomainVisibility } from "../types";

// ============================================================================
// Route Definitions
// ============================================================================

/**
 * Domain management routes
 *
 * @description Provides domain management functionality:
 *
 * - `GET /domains` - List domains accessible to current user
 * - `GET /domains/mine` - List user's own domains
 * - `POST /domains` - Add a new custom domain
 * - `GET /domains/:id/verify` - Get verification instructions
 * - `POST /domains/:id/verify` - Verify domain ownership via DNS
 * - `PATCH /domains/:id/visibility` - Update domain visibility
 * - `POST /domains/:id/allowed-users` - Add allowed user
 * - `DELETE /domains/:id/allowed-users/:userId` - Remove allowed user
 * - `DELETE /domains/:id` - Delete a custom domain
 */
export const domainRoutes = new Elysia({ prefix: "/domains" })

  // ============================================================================
  // List Domains
  // ============================================================================

  /**
   * Get all domains accessible to current user
   * @route GET /api/domains
   * @description Returns domains the user can use:
   * - Official domains (public)
   * - Public verified domains
   * - User's own domains
   * - Domains where user is in allowed list
   * @returns List of accessible domains with ownership info
   */
  .get("/", ({ cookie }) => {
    const user = getAuthUser(cookie.session.value as string | undefined);
    if (!user) {
      return { success: false, error: ERROR_MESSAGES.UNAUTHORIZED };
    }

    const domains = domainRepository.findAccessibleByUserId(user.id);
    return {
      success: true,
      domains: domains.map((d) => ({
        id: d.id,
        name: d.name,
        isOfficial: d.is_official === 1,
        isMine: d.user_id === user.id,
        visibility: d.visibility,
        verifiedBy: d.verified_by,
      })),
    };
  })

  /**
   * Get user's own domains
   * @route GET /api/domains/mine
   * @description Returns domains owned by the current user with pagination,
   * including pending verification status and visibility settings.
   * @param query.page - Page number (default 1)
   * @param query.pageSize - Items per page (default 20, max 100)
   * @returns List of user's domains with full details and pagination info
   */
  .get(
    "/mine",
    ({ cookie, query }) => {
      const user = getAuthUser(cookie.session.value as string | undefined);
      if (!user) {
        return { success: false, error: ERROR_MESSAGES.UNAUTHORIZED };
      }

      // Pagination
      const page = Math.max(1, query.page || 1);
      const pageSize = Math.min(LIMITS.MAX_DOMAINS_PER_PAGE, Math.max(1, query.pageSize || 20));
      const offset = (page - 1) * pageSize;

      const domains = domainRepository.findByUserId(user.id, pageSize, offset);
      const total = domainRepository.countByUserId(user.id);
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
        domains: domains.map((d) => ({
          id: d.id,
          name: d.name,
          txtRecord: d.txt_record,
          verified: d.verified === 1,
          verifiedBy: d.verified_by,
          visibility: d.visibility,
          autoDiscovered: d.auto_discovered === 1,
          allowedUsers: domainRepository.findAllowedUsers(d.id).length,
          createdAt: d.created_at,
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
  // Add Domain
  // ============================================================================

  /**
   * Add a custom domain
   * @route POST /api/domains
   * @param body.name - The domain name to add
   * @param body.verifyByMx - If true, verify via MX record instead of TXT
   * @description Registers a new custom domain. The domain must be verified
   * via DNS TXT record or MX record before it can be used to create mailboxes.
   * @returns Domain details with verification instructions
   */
  .post(
    "/",
    ({ body, cookie }) => {
      const user = getAuthUser(cookie.session.value as string | undefined);
      if (!user) {
        return { success: false, error: ERROR_MESSAGES.UNAUTHORIZED };
      }

      const { name, verifyByMx } = body;
      const domainName = name.toLowerCase().trim();

      // Validate domain format
      const validation = validateDomain(domainName);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      // Check if it's an official domain
      if (config.officialDomains.includes(domainName)) {
        return { success: false, error: ERROR_MESSAGES.CANNOT_ADD_OFFICIAL };
      }

      // Check if domain already exists
      const existing = domainRepository.findByName(domainName);
      if (existing) {
        return { success: false, error: ERROR_MESSAGES.DOMAIN_EXISTS };
      }

      const domainId = crypto.randomUUID();

      if (verifyByMx) {
        // MX verification mode - no TXT record needed
        domainRepository.create(domainId, domainName, user.id, "");
        return {
          success: true,
          domain: {
            id: domainId,
            name: domainName,
            verifyByMx: true,
            mxTarget: config.mxTargetHost,
            verified: false,
          },
        };
      }

      // TXT record verification mode
      const txtRecord = generateTxtRecord();
      domainRepository.create(domainId, domainName, user.id, txtRecord);

      return {
        success: true,
        domain: {
          id: domainId,
          name: domainName,
          txtRecord,
          verified: false,
        },
      };
    },
    {
      body: t.Object({
        name: t.String(),
        verifyByMx: t.Optional(t.Boolean()),
      }),
    }
  )

  // ============================================================================
  // Domain Verification
  // ============================================================================

  /**
   * Get domain verification info
   * @route GET /api/domains/:id/verify
   * @param params.id - The domain ID
   * @description Returns verification status and instructions for adding
   * the required DNS TXT or MX record.
   * @returns Verification status and DNS instructions
   */
  .get("/:id/verify", async ({ params, cookie }) => {
    const user = getAuthUser(cookie.session.value as string | undefined);
    if (!user) {
      return { success: false, error: ERROR_MESSAGES.UNAUTHORIZED };
    }

    const domain = domainRepository.findById(params.id);
    if (!domain) {
      return { success: false, error: ERROR_MESSAGES.DOMAIN_NOT_FOUND };
    }

    if (domain.user_id !== user.id) {
      return { success: false, error: ERROR_MESSAGES.NOT_YOUR_DOMAIN };
    }

    if (domain.verified === 1) {
      return {
        success: true,
        verified: true,
        verifiedBy: domain.verified_by,
      };
    }

    // Check if MX verification mode (no TXT record set)
    const isMxMode = !domain.txt_record;

    if (isMxMode) {
      const currentMx = await getMxRecords(domain.name);
      return {
        success: true,
        verified: false,
        verifyByMx: true,
        domain: domain.name,
        mxTarget: config.mxTargetHost,
        currentMx,
        instructions: `Add an MX record to your domain:\n\nHost: ${domain.name}\nType: MX\nPriority: 10\nValue: ${config.mxTargetHost}`,
      };
    }

    return {
      success: true,
      verified: false,
      verifyByMx: false,
      domain: domain.name,
      txtRecord: domain.txt_record,
      instructions: `Add a TXT record to your domain:\n\nHost: _mailbox-verify.${domain.name}\nValue: ${domain.txt_record}\n\nOr:\n\nHost: ${domain.name}\nValue: ${domain.txt_record}`,
    };
  })

  /**
   * Verify domain ownership
   * @route POST /api/domains/:id/verify
   * @param params.id - The domain ID
   * @description Checks DNS for the required TXT or MX record.
   * TXT verification supports two formats:
   * - `_mailbox-verify.domain.com` (subdomain record)
   * - `domain.com` (root domain record)
   * MX verification checks if MX points to our mail server.
   * @returns Verification result
   */
  .post("/:id/verify", async ({ params, cookie }) => {
    const user = getAuthUser(cookie.session.value as string | undefined);
    if (!user) {
      return { success: false, error: ERROR_MESSAGES.UNAUTHORIZED };
    }

    const domain = domainRepository.findById(params.id);
    if (!domain) {
      return { success: false, error: ERROR_MESSAGES.DOMAIN_NOT_FOUND };
    }

    if (domain.user_id !== user.id) {
      return { success: false, error: ERROR_MESSAGES.NOT_YOUR_DOMAIN };
    }

    if (domain.verified === 1) {
      return { success: true, verified: true, verifiedBy: domain.verified_by };
    }

    // Check if MX verification mode (no TXT record set)
    const isMxMode = !domain.txt_record;

    if (isMxMode) {
      // MX verification
      const verified = await verifyMxRecord(domain.name);
      if (verified) {
        domainRepository.setVerified(domain.id, "mx");
        return { success: true, verified: true, verifiedBy: "mx" };
      }

      const currentMx = await getMxRecords(domain.name);
      return {
        success: false,
        verified: false,
        error: ERROR_MESSAGES.MX_RECORD_NOT_FOUND,
        currentMx,
        expectedMx: config.mxTargetHost,
      };
    }

    // TXT verification - try both formats
    const verified =
      (await verifyTxtRecord(
        `_mailbox-verify.${domain.name}`,
        domain.txt_record!
      )) || (await verifyTxtRecord(domain.name, domain.txt_record!));

    if (verified) {
      domainRepository.setVerified(domain.id, "txt");
      return { success: true, verified: true, verifiedBy: "txt" };
    }

    return {
      success: false,
      verified: false,
      error: ERROR_MESSAGES.TXT_RECORD_NOT_FOUND,
    };
  })

  // ============================================================================
  // Delete Domain
  // ============================================================================

  /**
   * Delete a custom domain
   * @route DELETE /api/domains/:id
   * @param params.id - The domain ID
   * @description Deletes a user's custom domain. Official domains cannot be deleted.
   * Deleting a domain will cascade delete all associated mailboxes.
   * @returns Success status
   */
  .delete("/:id", ({ params, cookie }) => {
    const user = getAuthUser(cookie.session.value as string | undefined);
    if (!user) {
      return { success: false, error: ERROR_MESSAGES.UNAUTHORIZED };
    }

    const domain = domainRepository.findById(params.id);
    if (!domain) {
      return { success: false, error: ERROR_MESSAGES.DOMAIN_NOT_FOUND };
    }

    if (domain.user_id !== user.id) {
      return { success: false, error: ERROR_MESSAGES.NOT_YOUR_DOMAIN };
    }

    if (domain.is_official === 1) {
      return { success: false, error: ERROR_MESSAGES.CANNOT_DELETE_OFFICIAL };
    }

    domainRepository.delete(domain.id);
    return { success: true };
  })

  // ============================================================================
  // Visibility Management
  // ============================================================================

  /**
   * Update domain visibility
   * @route PATCH /api/domains/:id/visibility
   * @param params.id - The domain ID
   * @param body.visibility - New visibility level (0=private, 1=partial, 2=public)
   * @description Updates the visibility setting for a domain.
   * - Private (0): Only owner can create mailboxes
   * - Partial (1): Owner and allowed users can create mailboxes
   * - Public (2): Anyone can create mailboxes
   * @returns Success status with new visibility
   */
  .patch(
    "/:id/visibility",
    ({ params, body, cookie }) => {
      const user = getAuthUser(cookie.session.value as string | undefined);
      if (!user) {
        return { success: false, error: ERROR_MESSAGES.UNAUTHORIZED };
      }

      const domain = domainRepository.findById(params.id);
      if (!domain) {
        return { success: false, error: ERROR_MESSAGES.DOMAIN_NOT_FOUND };
      }

      if (domain.user_id !== user.id) {
        return { success: false, error: ERROR_MESSAGES.NOT_YOUR_DOMAIN };
      }

      // Validate visibility value
      if (![0, 1, 2].includes(body.visibility)) {
        return { success: false, error: "Invalid visibility value" };
      }

      domainRepository.setVisibility(domain.id, body.visibility);

      return {
        success: true,
        visibility: body.visibility,
        visibilityLabel: ["private", "partial", "public"][body.visibility],
      };
    },
    {
      body: t.Object({
        visibility: t.Number(),
      }),
    }
  )

  // ============================================================================
  // Allowed Users Management
  // ============================================================================

  /**
   * Get allowed users for a domain
   * @route GET /api/domains/:id/allowed-users
   * @param params.id - The domain ID
   * @description Returns the list of users who are allowed to create mailboxes
   * on this domain (when visibility is set to partial).
   * @returns List of allowed users
   */
  .get("/:id/allowed-users", ({ params, cookie }) => {
    const user = getAuthUser(cookie.session.value as string | undefined);
    if (!user) {
      return { success: false, error: ERROR_MESSAGES.UNAUTHORIZED };
    }

    const domain = domainRepository.findById(params.id);
    if (!domain) {
      return { success: false, error: ERROR_MESSAGES.DOMAIN_NOT_FOUND };
    }

    if (domain.user_id !== user.id) {
      return { success: false, error: ERROR_MESSAGES.NOT_YOUR_DOMAIN };
    }

    const allowedUsers = domainRepository.findAllowedUsers(domain.id);

    // Get user details for each allowed user
    const usersWithDetails = allowedUsers.map((au) => {
      const allowedUser = userRepository.findById(au.user_id);
      return {
        id: au.user_id,
        username: allowedUser?.username || "Unknown",
        addedAt: au.created_at,
      };
    });

    return {
      success: true,
      allowedUsers: usersWithDetails,
    };
  })

  /**
   * Add allowed user to domain
   * @route POST /api/domains/:id/allowed-users
   * @param params.id - The domain ID
   * @param body.username - Username to add
   * @description Adds a user to the domain's allowed users list.
   * This user will be able to create mailboxes on the domain when
   * visibility is set to partial.
   * @returns Success status
   */
  .post(
    "/:id/allowed-users",
    ({ params, body, cookie }) => {
      const user = getAuthUser(cookie.session.value as string | undefined);
      if (!user) {
        return { success: false, error: ERROR_MESSAGES.UNAUTHORIZED };
      }

      const domain = domainRepository.findById(params.id);
      if (!domain) {
        return { success: false, error: ERROR_MESSAGES.DOMAIN_NOT_FOUND };
      }

      if (domain.user_id !== user.id) {
        return { success: false, error: ERROR_MESSAGES.NOT_YOUR_DOMAIN };
      }

      // Find user by username
      const targetUser = userRepository.findByUsername(body.username);
      if (!targetUser) {
        return { success: false, error: ERROR_MESSAGES.USER_NOT_FOUND };
      }

      // Check if already allowed
      if (domainRepository.isUserAllowed(domain.id, targetUser.id)) {
        return { success: false, error: ERROR_MESSAGES.USER_ALREADY_ALLOWED };
      }

      domainRepository.addAllowedUser(domain.id, targetUser.id);

      return {
        success: true,
        user: {
          id: targetUser.id,
          username: targetUser.username,
        },
      };
    },
    {
      body: t.Object({
        username: t.String(),
      }),
    }
  )

  /**
   * Remove allowed user from domain
   * @route DELETE /api/domains/:id/allowed-users/:userId
   * @param params.id - The domain ID
   * @param params.userId - User ID to remove
   * @description Removes a user from the domain's allowed users list.
   * @returns Success status
   */
  .delete("/:id/allowed-users/:userId", ({ params, cookie }) => {
    const user = getAuthUser(cookie.session.value as string | undefined);
    if (!user) {
      return { success: false, error: ERROR_MESSAGES.UNAUTHORIZED };
    }

    const domain = domainRepository.findById(params.id);
    if (!domain) {
      return { success: false, error: ERROR_MESSAGES.DOMAIN_NOT_FOUND };
    }

    if (domain.user_id !== user.id) {
      return { success: false, error: ERROR_MESSAGES.NOT_YOUR_DOMAIN };
    }

    // Check if user is in the allowed list
    if (!domainRepository.isUserAllowed(domain.id, params.userId)) {
      return { success: false, error: ERROR_MESSAGES.USER_NOT_ALLOWED };
    }

    domainRepository.removeAllowedUser(domain.id, params.userId);

    return { success: true };
  });
