/**
 * @fileoverview DNS utilities
 * @description Provides DNS-related functionality for domain verification.
 * @module utils/dns
 */

import { resolve } from "dns/promises";

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
