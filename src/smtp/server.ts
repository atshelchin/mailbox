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
     * @description Accepts all senders - we don't restrict who can send to us
     */
    onMailFrom(address, session, callback) {
      callback();
    },

    /**
     * Validate recipient address
     * @description Checks if the recipient has a registered mailbox
     */
    onRcptTo(address, session, callback) {
      const addr = parseEmailAddress(address.address);
      if (!addr) {
        return callback(new Error(ERROR_MESSAGES.INVALID_RECIPIENT));
      }

      // Check if domain is available
      if (!domainRepository.isAvailable(addr.domain)) {
        return callback(new Error(ERROR_MESSAGES.DOMAIN_NOT_FOUND));
      }

      // Check if mailbox exists
      const mailbox = findMailboxByAddress(addr.localPart, addr.domain);
      if (!mailbox) {
        return callback(new Error(ERROR_MESSAGES.MAILBOX_NOT_FOUND));
      }

      callback();
    },

    /**
     * Receive and process email data
     * @description Receives the email stream, validates size, and stores the email
     */
    onData(stream, session, callback) {
      const chunks: Buffer[] = [];
      let totalSize = 0;

      stream.on("data", (chunk: Buffer) => {
        totalSize += chunk.length;
        if (totalSize > config.maxEmailSize) {
          stream.destroy();
          return callback(new Error(ERROR_MESSAGES.MESSAGE_TOO_LARGE));
        }
        chunks.push(chunk);
      });

      stream.on("end", async () => {
        const rawEmail = Buffer.concat(chunks);

        const from = session.envelope.mailFrom
          ? session.envelope.mailFrom.address
          : "unknown@unknown";

        const to = session.envelope.rcptTo.map((r) => r.address);

        try {
          const result = await processEmail(rawEmail, from, to);

          if (result.accepted.length === 0) {
            return callback(new Error(ERROR_MESSAGES.NO_VALID_RECIPIENTS));
          }

          callback();
        } catch (error) {
          console.error("Error processing email:", error);
          callback(new Error(ERROR_MESSAGES.INTERNAL_ERROR));
        }
      });

      stream.on("error", (err) => {
        console.error("Stream error:", err);
        callback(new Error(ERROR_MESSAGES.INTERNAL_ERROR));
      });
    },

    /**
     * Connection opened handler
     * @description Logs new SMTP connections
     */
    onConnect(session, callback) {
      console.log(`SMTP connection from ${session.remoteAddress}`);
      callback();
    },

    /**
     * Connection closed handler
     * @description Logs closed SMTP connections
     */
    onClose(session) {
      console.log(`SMTP connection closed from ${session.remoteAddress}`);
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
