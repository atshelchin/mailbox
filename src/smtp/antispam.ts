/**
 * @fileoverview Anti-spam measures for SMTP server
 * @description Basic spam prevention strategies including rate limiting,
 * connection throttling, and sender validation.
 * @module smtp/antispam
 */

import { resolveMx, resolve } from "dns/promises";

// ============================================================================
// Types
// ============================================================================

interface RateLimitEntry {
  count: number;
  firstSeen: number;
  blocked: boolean;
}

interface SpamCheckResult {
  allowed: boolean;
  reason?: string;
}

// ============================================================================
// Configuration
// ============================================================================

const ANTISPAM_CONFIG = {
  // Rate limiting per IP
  maxConnectionsPerIpPerMinute: 30,
  maxEmailsPerIpPerMinute: 20,

  // Rate limiting per sender domain
  maxEmailsPerSenderDomainPerMinute: 50,

  // Connection limits
  maxConcurrentConnectionsPerIp: 10,

  // Greylist: reject first attempt from new senders (they should retry)
  enableGreylist: false, // Disabled by default as it delays legitimate mail
  greylistMinutes: 5,

  // Block IPs for repeated abuse
  blockDurationMinutes: 60,
  blockThreshold: 100, // Block after this many requests in a minute

  // Require valid reverse DNS (PTR record)
  requireReverseDns: false, // Many legitimate servers don't have PTR

  // Require sender domain to have MX record
  requireSenderMx: false, // Disabled to avoid DNS lookup delays
};

// ============================================================================
// Rate Limiting Storage (in-memory)
// ============================================================================

// IP -> rate limit info
const ipRateLimits = new Map<string, RateLimitEntry>();

// Sender domain -> rate limit info
const senderDomainRateLimits = new Map<string, RateLimitEntry>();

// IP -> concurrent connection count
const concurrentConnections = new Map<string, number>();

// Greylist: "sender@domain:recipient@domain" -> first seen timestamp
const greylist = new Map<string, number>();

// Cleanup old entries periodically (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  const oneMinuteAgo = now - 60 * 1000;
  const oneHourAgo = now - 60 * 60 * 1000;

  // Clean rate limits older than 1 minute
  for (const [key, entry] of ipRateLimits.entries()) {
    if (entry.firstSeen < oneMinuteAgo && !entry.blocked) {
      ipRateLimits.delete(key);
    } else if (entry.blocked && entry.firstSeen < oneHourAgo) {
      // Unblock after 1 hour
      ipRateLimits.delete(key);
    }
  }

  for (const [key, entry] of senderDomainRateLimits.entries()) {
    if (entry.firstSeen < oneMinuteAgo) {
      senderDomainRateLimits.delete(key);
    }
  }

  // Clean greylist entries older than 24 hours
  const oneDayAgo = now - 24 * 60 * 60 * 1000;
  for (const [key, timestamp] of greylist.entries()) {
    if (timestamp < oneDayAgo) {
      greylist.delete(key);
    }
  }
}, 5 * 60 * 1000);

// ============================================================================
// Rate Limiting Functions
// ============================================================================

/**
 * Check if an IP is rate limited
 */
function checkIpRateLimit(ip: string): SpamCheckResult {
  const now = Date.now();
  const entry = ipRateLimits.get(ip);

  if (entry) {
    // Check if blocked
    if (entry.blocked) {
      const blockedUntil = entry.firstSeen + ANTISPAM_CONFIG.blockDurationMinutes * 60 * 1000;
      if (now < blockedUntil) {
        return { allowed: false, reason: "IP temporarily blocked due to abuse" };
      }
      // Block expired, reset
      ipRateLimits.delete(ip);
    }

    // Check if within the same minute window
    if (now - entry.firstSeen < 60 * 1000) {
      if (entry.count >= ANTISPAM_CONFIG.blockThreshold) {
        // Block this IP
        entry.blocked = true;
        return { allowed: false, reason: "IP temporarily blocked due to abuse" };
      }
      if (entry.count >= ANTISPAM_CONFIG.maxConnectionsPerIpPerMinute) {
        return { allowed: false, reason: "Rate limit exceeded" };
      }
      entry.count++;
    } else {
      // New minute window
      ipRateLimits.set(ip, { count: 1, firstSeen: now, blocked: false });
    }
  } else {
    ipRateLimits.set(ip, { count: 1, firstSeen: now, blocked: false });
  }

  return { allowed: true };
}

/**
 * Check concurrent connection limit for an IP
 */
function checkConcurrentConnections(ip: string): SpamCheckResult {
  const current = concurrentConnections.get(ip) || 0;
  if (current >= ANTISPAM_CONFIG.maxConcurrentConnectionsPerIp) {
    return { allowed: false, reason: "Too many concurrent connections" };
  }
  return { allowed: true };
}

/**
 * Track connection open/close
 */
export function trackConnectionOpen(ip: string): void {
  const current = concurrentConnections.get(ip) || 0;
  concurrentConnections.set(ip, current + 1);
}

export function trackConnectionClose(ip: string): void {
  const current = concurrentConnections.get(ip) || 0;
  if (current > 0) {
    concurrentConnections.set(ip, current - 1);
  }
}

/**
 * Check sender domain rate limit
 */
function checkSenderDomainRateLimit(domain: string): SpamCheckResult {
  const now = Date.now();
  const entry = senderDomainRateLimits.get(domain);

  if (entry) {
    if (now - entry.firstSeen < 60 * 1000) {
      if (entry.count >= ANTISPAM_CONFIG.maxEmailsPerSenderDomainPerMinute) {
        return { allowed: false, reason: "Sender domain rate limit exceeded" };
      }
      entry.count++;
    } else {
      senderDomainRateLimits.set(domain, { count: 1, firstSeen: now, blocked: false });
    }
  } else {
    senderDomainRateLimits.set(domain, { count: 1, firstSeen: now, blocked: false });
  }

  return { allowed: true };
}

// ============================================================================
// Greylist Functions
// ============================================================================

/**
 * Check greylist for a sender-recipient pair
 */
function checkGreylist(senderDomain: string, recipientDomain: string): SpamCheckResult {
  if (!ANTISPAM_CONFIG.enableGreylist) {
    return { allowed: true };
  }

  const key = `${senderDomain}:${recipientDomain}`;
  const now = Date.now();
  const firstSeen = greylist.get(key);

  if (!firstSeen) {
    // First time seeing this pair, greylist it
    greylist.set(key, now);
    return {
      allowed: false,
      reason: `Please retry after ${ANTISPAM_CONFIG.greylistMinutes} minutes (greylisting)`,
    };
  }

  // Check if enough time has passed
  const greylistPeriod = ANTISPAM_CONFIG.greylistMinutes * 60 * 1000;
  if (now - firstSeen < greylistPeriod) {
    return {
      allowed: false,
      reason: `Please retry after ${Math.ceil((greylistPeriod - (now - firstSeen)) / 60000)} minutes (greylisting)`,
    };
  }

  return { allowed: true };
}

// ============================================================================
// DNS Validation Functions
// ============================================================================

/**
 * Check if sender domain has valid MX records
 */
async function checkSenderMx(senderDomain: string): Promise<SpamCheckResult> {
  if (!ANTISPAM_CONFIG.requireSenderMx) {
    return { allowed: true };
  }

  try {
    const mxRecords = await resolveMx(senderDomain);
    if (!mxRecords || mxRecords.length === 0) {
      return { allowed: false, reason: "Sender domain has no MX record" };
    }
    return { allowed: true };
  } catch {
    // DNS lookup failed - domain might not exist or have no MX
    return { allowed: false, reason: "Sender domain has no valid MX record" };
  }
}

/**
 * Check reverse DNS for connecting IP
 */
async function checkReverseDns(ip: string): Promise<SpamCheckResult> {
  if (!ANTISPAM_CONFIG.requireReverseDns) {
    return { allowed: true };
  }

  // Skip for private/local IPs
  if (
    ip === "127.0.0.1" ||
    ip === "::1" ||
    ip.startsWith("192.168.") ||
    ip.startsWith("10.") ||
    ip.startsWith("172.")
  ) {
    return { allowed: true };
  }

  try {
    // Convert IP to reverse DNS format
    const parts = ip.split(".");
    if (parts.length !== 4) {
      return { allowed: true }; // Skip IPv6 for now
    }

    const reverseName = `${parts[3]}.${parts[2]}.${parts[1]}.${parts[0]}.in-addr.arpa`;
    await resolve(reverseName, "PTR");
    return { allowed: true };
  } catch {
    return { allowed: false, reason: "No reverse DNS (PTR) record for connecting IP" };
  }
}

// ============================================================================
// Main Anti-spam Check Function
// ============================================================================

/**
 * Check all anti-spam rules for an incoming connection
 * @param ip - Remote IP address
 * @returns Check result with allowed status and reason if blocked
 */
export async function checkConnection(ip: string): Promise<SpamCheckResult> {
  // Check IP rate limit
  const ipCheck = checkIpRateLimit(ip);
  if (!ipCheck.allowed) return ipCheck;

  // Check concurrent connections
  const concurrentCheck = checkConcurrentConnections(ip);
  if (!concurrentCheck.allowed) return concurrentCheck;

  // Check reverse DNS (async)
  const reverseDnsCheck = await checkReverseDns(ip);
  if (!reverseDnsCheck.allowed) return reverseDnsCheck;

  return { allowed: true };
}

/**
 * Check all anti-spam rules for a sender
 * @param senderEmail - Sender email address
 * @param recipientDomain - Recipient domain
 * @returns Check result with allowed status and reason if blocked
 */
export async function checkSender(
  senderEmail: string,
  recipientDomain: string
): Promise<SpamCheckResult> {
  // Extract sender domain
  const atIndex = senderEmail.lastIndexOf("@");
  if (atIndex === -1) {
    return { allowed: false, reason: "Invalid sender address" };
  }
  const senderDomain = senderEmail.slice(atIndex + 1).toLowerCase();

  // Check sender domain rate limit
  const domainRateCheck = checkSenderDomainRateLimit(senderDomain);
  if (!domainRateCheck.allowed) return domainRateCheck;

  // Check greylist
  const greylistCheck = checkGreylist(senderDomain, recipientDomain);
  if (!greylistCheck.allowed) return greylistCheck;

  // Check sender MX (async)
  const mxCheck = await checkSenderMx(senderDomain);
  if (!mxCheck.allowed) return mxCheck;

  return { allowed: true };
}

/**
 * Get current anti-spam statistics
 * @returns Statistics object
 */
export function getStats(): {
  blockedIps: number;
  rateLimitedIps: number;
  greylistedPairs: number;
  activeConnections: number;
} {
  let blockedIps = 0;
  let rateLimitedIps = 0;

  for (const entry of ipRateLimits.values()) {
    if (entry.blocked) blockedIps++;
    else rateLimitedIps++;
  }

  let activeConnections = 0;
  for (const count of concurrentConnections.values()) {
    activeConnections += count;
  }

  return {
    blockedIps,
    rateLimitedIps,
    greylistedPairs: greylist.size,
    activeConnections,
  };
}
