/**
 * @fileoverview Domain repository
 * @description Data access layer for domain-related database operations.
 * @module db/repositories/domain
 */

import { db } from "../connection";
import type { Domain } from "../../types";

// ============================================================================
// Prepared Statements
// ============================================================================

const statements = {
  findAll: db.prepare<Domain, []>(
    "SELECT * FROM domains WHERE is_official = 1 OR verified = 1 ORDER BY is_official DESC, name ASC"
  ),
  findByUserId: db.prepare<Domain, [string]>(
    "SELECT * FROM domains WHERE user_id = ? ORDER BY created_at DESC"
  ),
  findById: db.prepare<Domain, [string]>(
    "SELECT * FROM domains WHERE id = ?"
  ),
  findByName: db.prepare<Domain, [string]>(
    "SELECT * FROM domains WHERE name = ?"
  ),
  create: db.prepare(
    "INSERT INTO domains (id, name, user_id, txt_record) VALUES (?, ?, ?, ?)"
  ),
  createOfficial: db.prepare(
    "INSERT OR IGNORE INTO domains (id, name, is_official, verified) VALUES (?, ?, 1, 1)"
  ),
  updateVerified: db.prepare(
    "UPDATE domains SET verified = 1 WHERE id = ?"
  ),
  delete: db.prepare(
    "DELETE FROM domains WHERE id = ?"
  ),
};

// ============================================================================
// Domain Repository
// ============================================================================

/**
 * Repository for domain-related database operations
 */
export const domainRepository = {
  /**
   * Find all available domains (official + verified user domains)
   * @returns Array of domains
   */
  findAllAvailable(): Domain[] {
    return statements.findAll.all();
  },

  /**
   * Find all domains owned by a user
   * @param userId - The user ID
   * @returns Array of domains
   */
  findByUserId(userId: string): Domain[] {
    return statements.findByUserId.all(userId);
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

  /**
   * Create a new user domain
   * @param id - Domain ID
   * @param name - Domain name
   * @param userId - Owner user ID
   * @param txtRecord - TXT record for verification
   */
  create(id: string, name: string, userId: string, txtRecord: string): void {
    statements.create.run(id, name, userId, txtRecord);
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
   */
  setVerified(id: string): void {
    statements.updateVerified.run(id);
  },

  /**
   * Delete a domain
   * @param id - Domain ID
   */
  delete(id: string): void {
    statements.delete.run(id);
  },

  /**
   * Check if a domain is available for email reception
   * @param name - Domain name
   * @returns True if the domain exists and is verified/official
   */
  isAvailable(name: string): boolean {
    const domain = this.findByName(name);
    return domain !== null && (domain.is_official === 1 || domain.verified === 1);
  },
};
