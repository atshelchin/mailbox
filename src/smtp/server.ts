import { SMTPServer } from "smtp-server";
import { simpleParser, ParsedMail } from "mailparser";
import { db } from "../db";
import { config } from "../config";
import { findMailboxByAddress } from "../api/mailboxes";

interface StoredEmail {
  id: string;
  mailbox_id: string;
  from_address: string;
  to_address: string;
  subject: string | null;
  text_body: string | null;
  html_body: string | null;
  raw_email: Buffer;
  size: number;
}

const queries = {
  insertEmail: db.prepare(`
    INSERT INTO emails (id, mailbox_id, from_address, to_address, subject, text_body, html_body, raw_email, size)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  insertAttachment: db.prepare(`
    INSERT INTO attachments (id, email_id, filename, content_type, size, content)
    VALUES (?, ?, ?, ?, ?, ?)
  `),
  getDomainByName: db.prepare<{ id: string; verified: number; is_official: number }, [string]>(
    "SELECT id, verified, is_official FROM domains WHERE name = ?"
  ),
};

function parseEmailAddress(address: string): { localPart: string; domain: string } | null {
  const match = address.match(/^<?([^@<>]+)@([^@<>]+)>?$/);
  if (!match) return null;
  return {
    localPart: match[1].toLowerCase(),
    domain: match[2].toLowerCase(),
  };
}

async function processEmail(
  rawEmail: Buffer,
  from: string,
  to: string[]
): Promise<{ accepted: string[]; rejected: string[] }> {
  const accepted: string[] = [];
  const rejected: string[] = [];

  // 解析邮件
  let parsed: ParsedMail;
  try {
    parsed = await simpleParser(rawEmail);
  } catch (error) {
    console.error("Failed to parse email:", error);
    return { accepted: [], rejected: to };
  }

  // 处理每个收件人
  for (const recipient of to) {
    const addr = parseEmailAddress(recipient);
    if (!addr) {
      rejected.push(recipient);
      continue;
    }

    // 检查域名是否存在
    const domain = queries.getDomainByName.get(addr.domain);
    if (!domain || (domain.is_official !== 1 && domain.verified !== 1)) {
      rejected.push(recipient);
      continue;
    }

    // 查找邮箱
    const mailbox = findMailboxByAddress(addr.localPart, addr.domain);
    if (!mailbox) {
      rejected.push(recipient);
      continue;
    }

    // 存储邮件
    const emailId = crypto.randomUUID();
    try {
      queries.insertEmail.run(
        emailId,
        mailbox.id,
        from,
        recipient,
        parsed.subject || null,
        parsed.text || null,
        parsed.html || null,
        rawEmail,
        rawEmail.length
      );

      // 存储附件
      if (parsed.attachments && parsed.attachments.length > 0) {
        for (const attachment of parsed.attachments) {
          queries.insertAttachment.run(
            crypto.randomUUID(),
            emailId,
            attachment.filename || null,
            attachment.contentType || null,
            attachment.size || 0,
            attachment.content
          );
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

export function createSMTPServer(): SMTPServer {
  const server = new SMTPServer({
    // 不需要认证 (接收邮件)
    authOptional: true,
    disabledCommands: ["AUTH"],

    // 大小限制
    size: config.maxEmailSize,

    // Banner
    banner: `${config.serviceDomain} ESMTP Mailbox Service`,

    // 验证发件人
    onMailFrom(address, session, callback) {
      // 接受所有发件人
      callback();
    },

    // 验证收件人
    onRcptTo(address, session, callback) {
      const addr = parseEmailAddress(address.address);
      if (!addr) {
        return callback(new Error("Invalid recipient address"));
      }

      // 检查域名
      const domain = queries.getDomainByName.get(addr.domain);
      if (!domain || (domain.is_official !== 1 && domain.verified !== 1)) {
        return callback(new Error("Domain not found"));
      }

      // 检查邮箱
      const mailbox = findMailboxByAddress(addr.localPart, addr.domain);
      if (!mailbox) {
        return callback(new Error("User not found"));
      }

      callback();
    },

    // 接收邮件数据
    onData(stream, session, callback) {
      const chunks: Buffer[] = [];
      let totalSize = 0;

      stream.on("data", (chunk: Buffer) => {
        totalSize += chunk.length;
        if (totalSize > config.maxEmailSize) {
          stream.destroy();
          return callback(new Error("Message too large"));
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
            return callback(new Error("No valid recipients"));
          }

          callback();
        } catch (error) {
          console.error("Error processing email:", error);
          callback(new Error("Internal server error"));
        }
      });

      stream.on("error", (err) => {
        console.error("Stream error:", err);
        callback(new Error("Stream error"));
      });
    },

    // 日志
    onConnect(session, callback) {
      console.log(`SMTP connection from ${session.remoteAddress}`);
      callback();
    },

    onClose(session) {
      console.log(`SMTP connection closed from ${session.remoteAddress}`);
    },
  });

  return server;
}

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
