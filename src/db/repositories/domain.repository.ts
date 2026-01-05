/**
 * @fileoverview Domain repository
 * @description Data access layer for domain-related database operations.
 * @module db/repositories/domain
 */

import { db } from "../connection";
import type { Domain, DomainAllowedUser } from "../../types";
import { DomainVisibility } from "../../types";

// ============================================================================
// Prepared Statements
// ============================================================================

const statements = {
  // Domain queries
  findAll: db.prepare<Domain, []>(
    "SELECT * FROM domains WHERE is_official = 1 OR verified = 1 ORDER BY is_official DESC, name ASC"
  ),
  findPublic: db.prepare<Domain, []>(
    "SELECT * FROM domains WHERE (is_official = 1 OR verified = 1) AND visibility = 2 ORDER BY is_official DESC, name ASC"
  ),
  findByUserIdPaginated: db.prepare<Domain, [string, number, number]>(
    "SELECT * FROM domains WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?"
  ),
  countByUserId: db.prepare<{ count: number }, [string]>(
    "SELECT COUNT(*) as count FROM domains WHERE user_id = ?"
  ),
  findById: db.prepare<Domain, [string]>("SELECT * FROM domains WHERE id = ?"),
  findByName: db.prepare<Domain, [string]>(
    "SELECT * FROM domains WHERE name = ?"
  ),

  // Domain creation/update
  create: db.prepare(
    "INSERT INTO domains (id, name, user_id, txt_record, visibility) VALUES (?, ?, ?, ?, ?)"
  ),
  createAutoDiscovered: db.prepare(
    "INSERT INTO domains (id, name, verified, verified_by, visibility, auto_discovered) VALUES (?, ?, 1, 'mx', 2, 1)"
  ),
  createOfficial: db.prepare(
    "INSERT OR IGNORE INTO domains (id, name, is_official, verified, visibility) VALUES (?, ?, 1, 1, 2)"
  ),
  updateVerified: db.prepare(
    "UPDATE domains SET verified = 1, verified_by = ? WHERE id = ?"
  ),
  updateVisibility: db.prepare("UPDATE domains SET visibility = ? WHERE id = ?"),
  delete: db.prepare("DELETE FROM domains WHERE id = ?"),

  // Domain allowed users (for partial visibility)
  findAllowedUsers: db.prepare<DomainAllowedUser, [string]>(
    "SELECT * FROM domain_allowed_users WHERE domain_id = ?"
  ),
  findAllowedUser: db.prepare<DomainAllowedUser, [string, string]>(
    "SELECT * FROM domain_allowed_users WHERE domain_id = ? AND user_id = ?"
  ),
  addAllowedUser: db.prepare(
    "INSERT OR IGNORE INTO domain_allowed_users (id, domain_id, user_id) VALUES (?, ?, ?)"
  ),
  removeAllowedUser: db.prepare(
    "DELETE FROM domain_allowed_users WHERE domain_id = ? AND user_id = ?"
  ),
  removeAllAllowedUsers: db.prepare(
    "DELETE FROM domain_allowed_users WHERE domain_id = ?"
  ),

  // Access check: domains user can use (owns, is allowed, or public)
  findAccessibleByUserId: db.prepare<Domain, [string, string]>(`
    SELECT d.* FROM domains d
    WHERE (d.is_official = 1 OR d.verified = 1)
    AND (
      d.visibility = 2
      OR d.user_id = ?
      OR EXISTS (SELECT 1 FROM domain_allowed_users dau WHERE dau.domain_id = d.id AND dau.user_id = ?)
    )
    ORDER BY d.is_official DESC, d.name ASC
  `),
};

// ============================================================================
// Domain Repository
// ============================================================================

/**
 * Repository for domain-related database operations
 */
export const domainRepository = {
  // ==========================================================================
  // Query Methods
  // ==========================================================================

  /**
   * Find all available domains (official + verified user domains)
   * @returns Array of domains
   */
  findAllAvailable(): Domain[] {
    return statements.findAll.all();
  },

  /**
   * Find all public domains (visibility = 2)
   * @returns Array of public domains
   */
  findAllPublic(): Domain[] {
    return statements.findPublic.all();
  },

  /**
   * Find all domains accessible by a user (owns, is allowed, or public)
   * @param userId - The user ID
   * @returns Array of domains the user can use
   */
  findAccessibleByUserId(userId: string): Domain[] {
    return statements.findAccessibleByUserId.all(userId, userId);
  },

  /**
   * Find domains owned by a user with pagination
   * @param userId - The user ID
   * @param limit - Number of domains per page (default 20)
   * @param offset - Number of domains to skip (default 0)
   * @returns Array of domains
   */
  findByUserId(userId: string, limit: number = 20, offset: number = 0): Domain[] {
    return statements.findByUserIdPaginated.all(userId, limit, offset);
  },

  /**
   * Count domains owned by a user
   * @param userId - The user ID
   * @returns The count
   */
  countByUserId(userId: string): number {
    const result = statements.countByUserId.get(userId);
    return result?.count ?? 0;
  },

  /**
   * Find a domain by ID
   * @param id - The domain ID
   * @returns The domain or null
   */
  findById(id: string): Domain | null {
    return statements.findById.get(id) ?? null;
  },

  /**
   * Find a domain by name
   * @param name - The domain name
   * @returns The domain or null
   */
  findByName(name: string): Domain | null {
    return statements.findByName.get(name) ?? null;
  },

  // ==========================================================================
  // Create/Update Methods
  // ==========================================================================

  /**
   * Create a new user domain
   * @param id - Domain ID
   * @param name - Domain name
   * @param userId - Owner user ID
   * @param txtRecord - TXT record for verification
   * @param visibility - Domain visibility (default: private)
   */
  create(
    id: string,
    name: string,
    userId: string,
    txtRecord: string,
    visibility: number = DomainVisibility.Private
  ): void {
    statements.create.run(id, name, userId, txtRecord, visibility);
  },

  /**
   * Create an auto-discovered domain (verified via MX, public by default)
   * @param id - Domain ID
   * @param name - Domain name
   */
  createAutoDiscovered(id: string, name: string): void {
    statements.createAutoDiscovered.run(id, name);
  },

  /**
   * Create or update an official domain
   * @param id - Domain ID
   * @param name - Domain name
   */
  createOfficial(id: string, name: string): void {
    statements.createOfficial.run(id, name);
  },

  /**
   * Mark a domain as verified
   * @param id - Domain ID
   * @param verifiedBy - Verification method ('txt' or 'mx')
   */
  setVerified(id: string, verifiedBy: "txt" | "mx" = "txt"): void {
    statements.updateVerified.run(verifiedBy, id);
  },

  /**
   * Update domain visibility
   * @param id - Domain ID
   * @param visibility - New visibility level
   */
  setVisibility(id: string, visibility: number): void {
    statements.updateVisibility.run(visibility, id);
  },

  /**
   * Delete a domain
   * @param id - Domain ID
   */
  delete(id: string): void {
    statements.delete.run(id);
  },

  // ==========================================================================
  // Access Control Methods
  // ==========================================================================

  /**
   * Get all allowed users for a domain
   * @param domainId - Domain ID
   * @returns Array of allowed user records
   */
  findAllowedUsers(domainId: string): DomainAllowedUser[] {
    return statements.findAllowedUsers.all(domainId);
  },

  /**
   * Check if a user is allowed to use a domain
   * @param domainId - Domain ID
   * @param userId - User ID
   * @returns True if user is allowed
   */
  isUserAllowed(domainId: string, userId: string): boolean {
    return statements.findAllowedUser.get(domainId, userId) != null;
  },

  /**
   * Add a user to domain's allowed users list
   * @param domainId - Domain ID
   * @param userId - User ID to allow
   */
  addAllowedUser(domainId: string, userId: string): void {
    statements.addAllowedUser.run(crypto.randomUUID(), domainId, userId);
  },

  /**
   * Remove a user from domain's allowed users list
   * @param domainId - Domain ID
   * @param userId - User ID to remove
   */
  removeAllowedUser(domainId: string, userId: string): void {
    statements.removeAllowedUser.run(domainId, userId);
  },

  /**
   * Remove all allowed users from a domain
   * @param domainId - Domain ID
   */
  removeAllAllowedUsers(domainId: string): void {
    statements.removeAllAllowedUsers.run(domainId);
  },

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  /**
   * Check if a domain is available for email reception
   * @param name - Domain name
   * @returns True if the domain exists and is verified/official
   */
  isAvailable(name: string): boolean {
    const domain = this.findByName(name);
    return (
      domain !== null && (domain.is_official === 1 || domain.verified === 1)
    );
  },

  /**
   * Check if a user can create mailboxes on a domain
   * @param domain - The domain
   * @param userId - The user ID
   * @returns True if user can create mailboxes
   */
  canUserCreateMailbox(domain: Domain, userId: string): boolean {
    // Official domains and public domains: anyone can use
    if (domain.is_official === 1 || domain.visibility === DomainVisibility.Public) {
      return true;
    }

    // Domain owner can always use their own domain
    if (domain.user_id === userId) {
      return true;
    }

    // Partial visibility: check allowed users
    if (domain.visibility === DomainVisibility.Partial) {
      return this.isUserAllowed(domain.id, userId);
    }

    // Private: only owner
    return false;
  },
};
