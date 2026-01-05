/**
 * @fileoverview DNS utilities
 * @description Provides DNS-related functionality for domain verification.
 * @module utils/dns
 */

import { resolve, resolveMx } from "dns/promises";
import { config } from "../config";

/**
 * Verify a TXT record exists for a domain
 *
 * @description Queries DNS TXT records and checks if any matches the expected value.
 * This is used for domain ownership verification.
 *
 * @param domain - The domain to query (can be _mailbox-verify.domain or just domain)
 * @param expectedValue - The expected TXT record value
 * @returns True if a matching TXT record is found, false otherwise
 *
 * @example
 * ```typescript
 * // Check for verification record
 * const verified = await verifyTxtRecord(
 *   "_mailbox-verify.example.com",
 *   "mailbox-verify=abc123"
 * );
 * ```
 */
export async function verifyTxtRecord(domain: string, expectedValue: string): Promise<boolean> {
  try {
    const records = await resolve(domain, "TXT");

    for (const record of records) {
      // TXT records can be arrays of strings that need to be joined
      const txt = Array.isArray(record) ? record.join("") : record;
      if (txt === expectedValue) {
        return true;
      }
    }

    return false;
  } catch {
    // DNS lookup failed - record doesn't exist or DNS error
    return false;
  }
}

/**
 * Generate a unique TXT record value for domain verification
 *
 * @description Creates a unique verification token that the domain owner must add as a TXT record.
 * The format is "mailbox-verify=<uuid>" for easy identification.
 *
 * @returns The TXT record value to be added by the domain owner
 *
 * @example
 * ```typescript
 * const txtRecord = generateTxtRecord();
 * // Returns: "mailbox-verify=550e8400-e29b-41d4-a716-446655440000"
 * ```
 */
export function generateTxtRecord(): string {
  return `mailbox-verify=${crypto.randomUUID()}`;
}

/**
 * Verify that a domain's MX record points to our mail server
 *
 * @description Queries DNS MX records and checks if any of them point to
 * our configured mail server (config.mxTargetHost). This is used for
 * domain ownership verification via MX records.
 *
 * @param domain - The domain to query
 * @returns True if an MX record points to our server, false otherwise
 *
 * @example
 * ```typescript
 * // Check if domain's MX points to us
 * const verified = await verifyMxRecord("example.com");
 * // Returns true if MX record contains mail.appsdata.xyz
 * ```
 */
export async function verifyMxRecord(domain: string): Promise<boolean> {
  try {
    const mxRecords = await resolveMx(domain);

    // Check if any MX record points to our mail server
    for (const mx of mxRecords) {
      // Normalize the exchange hostname (remove trailing dot if present)
      const exchange = mx.exchange.toLowerCase().replace(/\.$/, "");
      const targetHost = config.mxTargetHost.toLowerCase();

      if (exchange === targetHost) {
        return true;
      }
    }

    return false;
  } catch {
    // DNS lookup failed - record doesn't exist or DNS error
    return false;
  }
}

/**
 * Get all MX records for a domain
 *
 * @description Queries DNS MX records and returns them sorted by priority.
 * Useful for debugging and showing users their current MX configuration.
 *
 * @param domain - The domain to query
 * @returns Array of MX records with priority and exchange, or empty array on error
 *
 * @example
 * ```typescript
 * const mxRecords = await getMxRecords("example.com");
 * // Returns: [{ priority: 10, exchange: "mail.example.com" }, ...]
 * ```
 */
export async function getMxRecords(
  domain: string
): Promise<Array<{ priority: number; exchange: string }>> {
  try {
    const mxRecords = await resolveMx(domain);
    return mxRecords
      .map((mx) => ({
        priority: mx.priority,
        exchange: mx.exchange.toLowerCase().replace(/\.$/, ""),
      }))
      .sort((a, b) => a.priority - b.priority);
  } catch {
    return [];
  }
}
