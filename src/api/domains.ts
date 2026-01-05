/**
 * @fileoverview Domain Management API routes
 * @description Handles domain registration, verification, and management.
 *
 * ## Overview
 * This module manages email domains:
 * - Official domains: Pre-configured domains anyone can use
 * - User domains: Custom domains verified via DNS TXT records
 *
 * ## Domain Verification Flow
 * 1. User adds a domain: POST /domains
 * 2. System returns a TXT record value
 * 3. User adds TXT record to their DNS
 * 4. User triggers verification: POST /domains/:id/verify
 * 5. System checks DNS and marks domain as verified
 *
 * @module api/domains
 */

import { Elysia, t } from "elysia";
import { config } from "../config";
import { getAuthUser } from "./auth";
import { validateDomain } from "../utils/validation";
import { verifyTxtRecord, generateTxtRecord } from "../utils/dns";
import { domainRepository } from "../db";
import { ERROR_MESSAGES } from "../constants";

// ============================================================================
// Route Definitions
// ============================================================================

/**
 * Domain management routes
 *
 * @description Provides domain management functionality:
 *
 * - `GET /domains` - List all available domains (official + verified)
 * - `GET /domains/mine` - List user's own domains
 * - `POST /domains` - Add a new custom domain
 * - `GET /domains/:id/verify` - Get verification instructions
 * - `POST /domains/:id/verify` - Verify domain ownership via DNS
 * - `DELETE /domains/:id` - Delete a custom domain
 */
export const domainRoutes = new Elysia({ prefix: "/domains" })

  // ============================================================================
  // List Domains
  // ============================================================================

  /**
   * Get all available domains
   * @route GET /api/domains
   * @description Returns all official domains and verified user domains.
   * Used to populate domain selection dropdowns.
   * @returns List of available domains with ownership info
   */
  .get("/", ({ cookie }) => {
    const user = getAuthUser(cookie.session.value as string | undefined);
    if (!user) {
      return { success: false, error: ERROR_MESSAGES.UNAUTHORIZED };
    }

    const domains = domainRepository.findAllAvailable();
    return {
      success: true,
      domains: domains.map((d) => ({
        id: d.id,
        name: d.name,
        isOfficial: d.is_official === 1,
        isMine: d.user_id === user.id,
      })),
    };
  })

  /**
   * Get user's own domains
   * @route GET /api/domains/mine
   * @description Returns all domains owned by the current user,
   * including pending verification status.
   * @returns List of user's domains with verification details
   */
  .get("/mine", ({ cookie }) => {
    const user = getAuthUser(cookie.session.value as string | undefined);
    if (!user) {
      return { success: false, error: ERROR_MESSAGES.UNAUTHORIZED };
    }

    const domains = domainRepository.findByUserId(user.id);
    return {
      success: true,
      domains: domains.map((d) => ({
        id: d.id,
        name: d.name,
        txtRecord: d.txt_record,
        verified: d.verified === 1,
        createdAt: d.created_at,
      })),
    };
  })

  // ============================================================================
  // Add Domain
  // ============================================================================

  /**
   * Add a custom domain
   * @route POST /api/domains
   * @param body.name - The domain name to add
   * @description Registers a new custom domain. The domain must be verified
   * via DNS TXT record before it can be used to create mailboxes.
   * @returns Domain details with verification instructions
   */
  .post(
    "/",
    ({ body, cookie }) => {
      const user = getAuthUser(cookie.session.value as string | undefined);
      if (!user) {
        return { success: false, error: ERROR_MESSAGES.UNAUTHORIZED };
      }

      const { name } = body;
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

      // Generate TXT record for verification
      const txtRecord = generateTxtRecord();
      const domainId = crypto.randomUUID();

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
   * the required DNS TXT record.
   * @returns Verification status and DNS instructions
   */
  .get("/:id/verify", ({ params, cookie }) => {
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
      return { success: true, verified: true };
    }

    return {
      success: true,
      verified: false,
      domain: domain.name,
      txtRecord: domain.txt_record,
      instructions: `Add a TXT record to your domain:\n\nHost: _mailbox-verify.${domain.name}\nValue: ${domain.txt_record}\n\nOr:\n\nHost: ${domain.name}\nValue: ${domain.txt_record}`,
    };
  })

  /**
   * Verify domain ownership
   * @route POST /api/domains/:id/verify
   * @param params.id - The domain ID
   * @description Checks DNS for the required TXT record. Supports two formats:
   * - `_mailbox-verify.domain.com` (subdomain record)
   * - `domain.com` (root domain record)
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
      return { success: true, verified: true };
    }

    if (!domain.txt_record) {
      return { success: false, error: ERROR_MESSAGES.TXT_RECORD_NOT_FOUND };
    }

    // Try both verification methods
    const verified =
      (await verifyTxtRecord(`_mailbox-verify.${domain.name}`, domain.txt_record)) ||
      (await verifyTxtRecord(domain.name, domain.txt_record));

    if (verified) {
      domainRepository.setVerified(domain.id);
      return { success: true, verified: true };
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
  });
