/**
 * @fileoverview SMTP Server Implementation
 * @description Receives and stores incoming emails for registered mailboxes.
 *
 * ## Overview
 * This module implements an SMTP server that:
 * - Receives incoming emails on port 25
 * - Validates recipients against registered mailboxes
 * - Parses email content (subject, body, attachments)
 * - Stores emails in the database
 *
 * ## SMTP Flow
 * 1. Connection: Client connects, server sends banner
 * 2. MAIL FROM: Server accepts any sender
 * 3. RCPT TO: Server validates recipient has a registered mailbox
 * 4. DATA: Server receives and processes the email
 * 5. Storage: Email is parsed and stored in database
 *
 * ## Security
 * - No authentication required (standard for receiving mail)
 * - Size limits enforced to prevent abuse
 * - Only accepts mail for registered domains/mailboxes
 *
 * @module smtp/server
 */

import { SMTPServer } from "smtp-server";
import { simpleParser, ParsedMail } from "mailparser";
import { config } from "../config";
import { domainRepository, emailRepository } from "../db";
import { findMailboxByAddress } from "../api/mailboxes";
import { ERROR_MESSAGES } from "../constants";
import { verifyMxRecord } from "../utils/dns";
import {
  checkSender,
  trackConnectionOpen,
  trackConnectionClose,
} from "./antispam";

// ============================================================================
// Types
// ============================================================================

/**
 * Result of processing an email
 */
interface ProcessEmailResult {
  /** Recipients that were accepted */
  accepted: string[];
  /** Recipients that were rejected */
  rejected: string[];
}

/**
 * Parsed email address components
 */
interface ParsedEmailAddress {
  /** Local part (before @) */
  localPart: string;
  /** Domain part (after @) */
  domain: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Parse an email address into its components
 *
 * @description Extracts the local part and domain from an email address.
 * Handles both plain addresses and angle-bracket format.
 *
 * @param address - The email address to parse
 * @returns Parsed components or null if invalid
 *
 * @example
 * ```typescript
 * parseEmailAddress("user@example.com")
 * // { localPart: "user", domain: "example.com" }
 *
 * parseEmailAddress("<user@example.com>")
 * // { localPart: "user", domain: "example.com" }
 * ```
 */
function parseEmailAddress(address: string): ParsedEmailAddress | null {
  const match = address.match(/^<?([^@<>]+)@([^@<>]+)>?$/);
  if (!match) return null;
  return {
    localPart: match[1].toLowerCase(),
    domain: match[2].toLowerCase(),
  };
}

/**
 * Process and store an incoming email
 *
 * @description Parses the raw email and stores it for each valid recipient.
 * Handles multiple recipients in a single email.
 *
 * @param rawEmail - The raw email data
 * @param from - The sender address
 * @param to - Array of recipient addresses
 * @returns Processing result with accepted/rejected recipients
 */
async function processEmail(
  rawEmail: Buffer,
  from: string,
  to: string[]
): Promise<ProcessEmailResult> {
  const accepted: string[] = [];
  const rejected: string[] = [];

  // Parse the email
  let parsed: ParsedMail;
  try {
    parsed = await simpleParser(rawEmail);
  } catch (error) {
    console.error("Failed to parse email:", error);
    return { accepted: [], rejected: to };
  }

  // Process each recipient
  for (const recipient of to) {
    const addr = parseEmailAddress(recipient);
    if (!addr) {
      rejected.push(recipient);
      continue;
    }

    // Check if domain exists and is available
    if (!domainRepository.isAvailable(addr.domain)) {
      rejected.push(recipient);
      continue;
    }

    // Find the mailbox
    const mailbox = findMailboxByAddress(addr.localPart, addr.domain);
    if (!mailbox) {
      rejected.push(recipient);
      continue;
    }

    // Store the email
    const emailId = crypto.randomUUID();
    try {
      emailRepository.create({
        id: emailId,
        mailboxId: mailbox.id,
        fromAddress: from,
        toAddress: recipient,
        subject: parsed.subject || null,
        textBody: parsed.text || null,
        htmlBody: parsed.html || null,
        rawEmail,
        size: rawEmail.length,
      });

      // Store attachments
      if (parsed.attachments && parsed.attachments.length > 0) {
        for (const attachment of parsed.attachments) {
          emailRepository.createAttachment({
            id: crypto.randomUUID(),
            emailId,
            filename: attachment.filename || null,
            contentType: attachment.contentType || null,
            size: attachment.size || 0,
            content: attachment.content,
          });
        }
      }

      accepted.push(recipient);
      console.log(`Email received for ${recipient} (${rawEmail.length} bytes)`);
    } catch (error) {
      console.error(`Failed to store email for ${recipient}:`, error);
      rejected.push(recipient);
    }
  }

  return { accepted, rejected };
}

// ============================================================================
// SMTP Server Factory
// ============================================================================

/**
 * Create an SMTP server instance
 *
 * @description Creates and configures an SMTP server for receiving emails.
 * The server validates recipients against registered mailboxes and stores
 * received emails in the database.
 *
 * @returns Configured SMTP server instance
 *
 * @example
 * ```typescript
 * const server = createSMTPServer();
 * server.listen(25, "0.0.0.0", () => {
 *   console.log("SMTP server started");
 * });
 * ```
 */
export function createSMTPServer(): SMTPServer {
  const server = new SMTPServer({
    // No authentication required for receiving mail
    authOptional: true,
    disabledCommands: ["AUTH"],

    // Size limit for incoming emails
    size: config.maxEmailSize,

    // Server banner
    banner: `${config.serviceDomain} ESMTP Mailbox Service`,

    /**
     * Validate sender address
     * @description Checks sender against anti-spam rules (rate limits, MX validation)
     */
    async onMailFrom(address, session, callback) {
      const ip = session.remoteAddress || "unknown";
      console.log(`[SMTP] MAIL FROM: ${address.address} (from ${ip})`);

      try {
        const senderCheck = await checkSender(address.address, "");
        if (!senderCheck.allowed) {
          console.log(`[SMTP] ❌ Sender rejected: ${address.address} - ${senderCheck.reason}`);
          return callback(new Error(senderCheck.reason || "Sender rejected"));
        }
        console.log(`[SMTP] ✓ Sender accepted: ${address.address}`);
        callback();
      } catch (error) {
        console.error(`[SMTP] ❌ Error checking sender ${address.address}:`, error);
        callback(new Error("Sender verification failed"));
      }
    },

    /**
     * Validate recipient address
     * @description Checks if the recipient has a registered mailbox.
     * If domain is unknown but MX points to us, auto-discover and register it.
     */
    async onRcptTo(address, session, callback) {
      const ip = session.remoteAddress || "unknown";
      console.log(`[SMTP] RCPT TO: ${address.address} (from ${ip})`);

      const addr = parseEmailAddress(address.address);
      if (!addr) {
        console.log(`[SMTP] ❌ Invalid recipient format: ${address.address}`);
        return callback(new Error(ERROR_MESSAGES.INVALID_RECIPIENT));
      }

      // Check if domain exists
      let domain = domainRepository.findByName(addr.domain);
      console.log(`[SMTP] Domain lookup for ${addr.domain}: ${domain ? "found" : "not found"}`);

      // Auto-discovery: if domain doesn't exist, check if MX points to us
      if (!domain) {
        console.log(`[SMTP] Attempting auto-discovery for domain: ${addr.domain}`);
        try {
          const mxPointsToUs = await verifyMxRecord(addr.domain);
          if (mxPointsToUs) {
            // Auto-create the domain as public (visibility = 2)
            const domainId = crypto.randomUUID();
            domainRepository.createAutoDiscovered(domainId, addr.domain);
            domain = domainRepository.findByName(addr.domain);
            console.log(`[SMTP] ✓ Auto-discovered domain: ${addr.domain}`);
          } else {
            console.log(`[SMTP] ❌ MX record does not point to us for: ${addr.domain}`);
          }
        } catch (error) {
          console.error(`[SMTP] ❌ MX verification failed for ${addr.domain}:`, error);
        }
      }

      // Check if domain is available (exists and verified/official)
      if (!domain || (domain.is_official !== 1 && domain.verified !== 1)) {
        console.log(`[SMTP] ❌ Domain not available: ${addr.domain} (official=${domain?.is_official}, verified=${domain?.verified})`);
        return callback(new Error(ERROR_MESSAGES.DOMAIN_NOT_FOUND));
      }

      // Check if mailbox exists
      const mailbox = findMailboxByAddress(addr.localPart, addr.domain);
      if (!mailbox) {
        console.log(`[SMTP] ❌ Mailbox not found: ${addr.localPart}@${addr.domain}`);
        return callback(new Error(ERROR_MESSAGES.MAILBOX_NOT_FOUND));
      }

      console.log(`[SMTP] ✓ Recipient accepted: ${address.address} (mailbox: ${mailbox.id})`);
      callback();
    },

    /**
     * Receive and process email data
     * @description Receives the email stream, validates size, and stores the email
     */
    onData(stream, session, callback) {
      const ip = session.remoteAddress || "unknown";
      const chunks: Buffer[] = [];
      let totalSize = 0;

      console.log(`[SMTP] DATA: Starting to receive email data (from ${ip})`);

      stream.on("data", (chunk: Buffer) => {
        totalSize += chunk.length;
        if (totalSize > config.maxEmailSize) {
          console.log(`[SMTP] ❌ Message too large: ${totalSize} bytes (max: ${config.maxEmailSize})`);
          stream.destroy();
          return callback(new Error(ERROR_MESSAGES.MESSAGE_TOO_LARGE));
        }
        chunks.push(chunk);
      });

      stream.on("end", async () => {
        const rawEmail = Buffer.concat(chunks);
        console.log(`[SMTP] DATA: Received ${rawEmail.length} bytes`);

        const from = session.envelope.mailFrom
          ? session.envelope.mailFrom.address
          : "unknown@unknown";

        const to = session.envelope.rcptTo.map((r) => r.address);
        console.log(`[SMTP] Processing email: from=${from}, to=${to.join(", ")}`);

        try {
          const result = await processEmail(rawEmail, from, to);
          console.log(`[SMTP] Email processed: accepted=${result.accepted.length}, rejected=${result.rejected.length}`);

          if (result.accepted.length === 0) {
            console.log(`[SMTP] ❌ No valid recipients, rejected: ${result.rejected.join(", ")}`);
            return callback(new Error(ERROR_MESSAGES.NO_VALID_RECIPIENTS));
          }

          console.log(`[SMTP] ✓ Email accepted for: ${result.accepted.join(", ")}`);
          callback();
        } catch (error) {
          console.error("[SMTP] ❌ Error processing email:", error);
          callback(new Error(ERROR_MESSAGES.INTERNAL_ERROR));
        }
      });

      stream.on("error", (err) => {
        console.error("[SMTP] ❌ Stream error:", err);
        callback(new Error(ERROR_MESSAGES.INTERNAL_ERROR));
      });
    },

    /**
     * Connection opened handler
     * @description Logs connection and performs basic rate limiting.
     * Note: Async DNS checks are disabled to prevent connection timeouts.
     */
    onConnect(session, callback) {
      const ip = session.remoteAddress || "unknown";
      console.log(`[SMTP] ➡️ Connection opened from ${ip}`);

      // Perform synchronous checks only (rate limiting, concurrent connections)
      // Async DNS checks moved to avoid blocking connection establishment
      try {
        // Track connection for concurrent limit
        trackConnectionOpen(ip);
        console.log(`[SMTP] ✓ Connection accepted from ${ip}`);
        callback();
      } catch (error) {
        console.error(`[SMTP] ❌ Connection rejected from ${ip}:`, error);
        callback(new Error("Connection rejected"));
      }
    },

    /**
     * Connection closed handler
     * @description Logs closed SMTP connections and updates tracking
     */
    onClose(session) {
      const ip = session.remoteAddress || "unknown";
      console.log(`[SMTP] ⬅️ Connection closed from ${ip}`);
      trackConnectionClose(ip);
    },
  });

  return server;
}

// ============================================================================
// Server Startup
// ============================================================================

/**
 * Start the SMTP server
 *
 * @description Creates and starts the SMTP server on the configured port.
 * Sets up error handling for server errors.
 *
 * @returns The running SMTP server instance
 *
 * @example
 * ```typescript
 * const server = startSMTPServer();
 * // Server is now listening on configured port
 *
 * // To stop the server:
 * server.close();
 * ```
 */
export function startSMTPServer(): SMTPServer {
  const server = createSMTPServer();

  server.listen(config.smtpPort, config.host, () => {
    console.log(`SMTP server listening on ${config.host}:${config.smtpPort}`);
  });

  server.on("error", (err) => {
    console.error("SMTP server error:", err);
  });

  return server;
}
