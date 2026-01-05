/**
 * @fileoverview Input validation utilities
 * @description Provides validation functions for email addresses, domains, and usernames.
 * All validators return a consistent ValidationResult structure.
 * @module utils/validation
 */

import type { ValidationResult } from "../types";
import { LOCAL_PART, DOMAIN, USERNAME, RESERVED_LOCAL_PARTS } from "../constants";

// ============================================================================
// Email Local Part Validation
// ============================================================================

/**
 * Validate an email local part (the part before @)
 *
 * @description Validates according to a subset of RFC 5321:
 * - Allowed characters: letters, numbers, dots, hyphens, underscores, plus signs
 * - Must start and end with alphanumeric character
 * - No consecutive dots allowed
 * - Length: 1-64 characters
 * - Cannot be a reserved system address
 *
 * @param localPart - The local part to validate
 * @returns Validation result with error message if invalid
 *
 * @example
 * ```typescript
 * validateLocalPart("john.doe");    // { valid: true }
 * validateLocalPart("admin");        // { valid: false, error: "This email address is reserved" }
 * validateLocalPart("a..b");         // { valid: false, error: "Local part cannot contain consecutive dots" }
 * ```
 */
export function validateLocalPart(localPart: string): ValidationResult {
  if (!localPart) {
    return { valid: false, error: "Local part is required" };
  }

  if (localPart.length < LOCAL_PART.MIN_LENGTH) {
    return {
      valid: false,
      error: `Local part must be at least ${LOCAL_PART.MIN_LENGTH} character`,
    };
  }

  if (localPart.length > LOCAL_PART.MAX_LENGTH) {
    return {
      valid: false,
      error: `Local part must be at most ${LOCAL_PART.MAX_LENGTH} characters`,
    };
  }

  if (!LOCAL_PART.PATTERN.test(localPart)) {
    return {
      valid: false,
      error: "Local part can only contain letters, numbers, dots, hyphens, underscores, and plus signs",
    };
  }

  if (localPart.includes("..")) {
    return { valid: false, error: "Local part cannot contain consecutive dots" };
  }

  if (RESERVED_LOCAL_PARTS.includes(localPart.toLowerCase() as typeof RESERVED_LOCAL_PARTS[number])) {
    return { valid: false, error: "This email address is reserved" };
  }

  return { valid: true };
}

// ============================================================================
// Domain Validation
// ============================================================================

/**
 * Validate a domain name
 *
 * @description Validates domain format according to RFC 1035:
 * - Labels separated by dots
 * - Each label starts/ends with alphanumeric
 * - Hyphens allowed in the middle of labels
 * - Maximum 253 characters total
 *
 * @param domain - The domain name to validate
 * @returns Validation result with error message if invalid
 *
 * @example
 * ```typescript
 * validateDomain("example.com");     // { valid: true }
 * validateDomain("sub.example.com"); // { valid: true }
 * validateDomain("-invalid.com");    // { valid: false, error: "Invalid domain format" }
 * ```
 */
export function validateDomain(domain: string): ValidationResult {
  if (!domain) {
    return { valid: false, error: "Domain is required" };
  }

  if (domain.length > DOMAIN.MAX_LENGTH) {
    return { valid: false, error: "Domain is too long" };
  }

  if (!DOMAIN.PATTERN.test(domain)) {
    return { valid: false, error: "Invalid domain format" };
  }

  return { valid: true };
}

// ============================================================================
// Username Validation
// ============================================================================

/**
 * Validate a username
 *
 * @description Validates username format:
 * - Allowed characters: letters, numbers, underscores, hyphens
 * - Length: 3-32 characters
 *
 * @param username - The username to validate
 * @returns Validation result with error message if invalid
 *
 * @example
 * ```typescript
 * validateUsername("john_doe");  // { valid: true }
 * validateUsername("ab");        // { valid: false, error: "Username must be at least 3 characters" }
 * validateUsername("a@b");       // { valid: false, error: "Username can only contain..." }
 * ```
 */
export function validateUsername(username: string): ValidationResult {
  if (!username) {
    return { valid: false, error: "Username is required" };
  }

  if (username.length < USERNAME.MIN_LENGTH) {
    return {
      valid: false,
      error: `Username must be at least ${USERNAME.MIN_LENGTH} characters`,
    };
  }

  if (username.length > USERNAME.MAX_LENGTH) {
    return {
      valid: false,
      error: `Username must be at most ${USERNAME.MAX_LENGTH} characters`,
    };
  }

  if (!USERNAME.PATTERN.test(username)) {
    return {
      valid: false,
      error: "Username can only contain letters, numbers, underscores, and hyphens",
    };
  }

  return { valid: true };
}
