/**
 * @fileoverview Mailbox repository
 * @description Data access layer for mailbox-related database operations.
 * @module db/repositories/mailbox
 */

import { db } from "../connection";
import type { Mailbox, MailboxWithDomain, Domain } from "../../types";

// ============================================================================
// Prepared Statements
// ============================================================================

const statements = {
  findByUserId: db.prepare<MailboxWithDomain, [string]>(`
    SELECT m.*, d.name as domain_name
    FROM mailboxes m
    JOIN domains d ON m.domain_id = d.id
    WHERE m.user_id = ?
    ORDER BY m.created_at DESC
  `),
  findById: db.prepare<MailboxWithDomain, [string]>(`
    SELECT m.*, d.name as domain_name
    FROM mailboxes m
    JOIN domains d ON m.domain_id = d.id
    WHERE m.id = ?
  `),
  findByAddress: db.prepare<Mailbox, [string, string]>(`
    SELECT m.* FROM mailboxes m
    JOIN domains d ON m.domain_id = d.id
    WHERE m.local_part = ? AND d.name = ?
  `),
  checkExists: db.prepare<{ count: number }, [string, string]>(
    "SELECT COUNT(*) as count FROM mailboxes WHERE local_part = ? AND domain_id = ?"
  ),
  countByUserId: db.prepare<{ count: number }, [string]>(
    "SELECT COUNT(*) as count FROM mailboxes WHERE user_id = ?"
  ),
  getDomainById: db.prepare<Domain, [string]>(
    "SELECT * FROM domains WHERE id = ?"
  ),
  create: db.prepare(
    "INSERT INTO mailboxes (id, local_part, domain_id, user_id) VALUES (?, ?, ?, ?)"
  ),
  delete: db.prepare(
    "DELETE FROM mailboxes WHERE id = ?"
  ),
};

// ============================================================================
// Mailbox Repository
// ============================================================================

/**
 * Repository for mailbox-related database operations
 */
export const mailboxRepository = {
  /**
   * Find all mailboxes for a user
   * @param userId - The user ID
   * @returns Array of mailboxes with domain info
   */
  findByUserId(userId: string): MailboxWithDomain[] {
    return statements.findByUserId.all(userId);
  },

  /**
   * Find a mailbox by ID
   * @param id - The mailbox ID
   * @returns The mailbox with domain info or null
   */
  findById(id: string): MailboxWithDomain | null {
    return statements.findById.get(id) ?? null;
  },

  /**
   * Find a mailbox by email address
   * @param localPart - The local part (before @)
   * @param domain - The domain name
   * @returns The mailbox or null
   */
  findByAddress(localPart: string, domain: string): Mailbox | null {
    return statements.findByAddress.get(localPart.toLowerCase(), domain.toLowerCase()) ?? null;
  },

  /**
   * Check if a mailbox exists
   * @param localPart - The local part
   * @param domainId - The domain ID
   * @returns True if exists
   */
  exists(localPart: string, domainId: string): boolean {
    const result = statements.checkExists.get(localPart, domainId);
    return result !== null && result.count > 0;
  },

  /**
   * Count mailboxes for a user
   * @param userId - The user ID
   * @returns The count
   */
  countByUserId(userId: string): number {
    const result = statements.countByUserId.get(userId);
    return result?.count ?? 0;
  },

  /**
   * Get a domain by ID
   * @param id - The domain ID
   * @returns The domain or null
   */
  getDomainById(id: string): Domain | null {
    return statements.getDomainById.get(id) ?? null;
  },

  /**
   * Create a new mailbox
   * @param id - Mailbox ID
   * @param localPart - Local part
   * @param domainId - Domain ID
   * @param userId - Owner user ID
   */
  create(id: string, localPart: string, domainId: string, userId: string): void {
    statements.create.run(id, localPart, domainId, userId);
  },

  /**
   * Delete a mailbox
   * @param id - Mailbox ID
   */
  delete(id: string): void {
    statements.delete.run(id);
  },
};
