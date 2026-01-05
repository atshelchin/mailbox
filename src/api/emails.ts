import { Elysia } from "elysia";
import { db } from "../db";
import { getAuthUser } from "./auth";

interface Email {
  id: string;
  mailbox_id: string;
  from_address: string;
  to_address: string;
  subject: string | null;
  text_body: string | null;
  html_body: string | null;
  raw_email: Uint8Array | null;
  size: number | null;
  received_at: number;
}

interface Attachment {
  id: string;
  email_id: string;
  filename: string | null;
  content_type: string | null;
  size: number | null;
  content: Uint8Array | null;
}

interface Mailbox {
  id: string;
  user_id: string;
  local_part: string;
  domain_name: string;
}

const queries = {
  getMailboxById: db.prepare<Mailbox, [string]>(`
    SELECT m.id, m.user_id, m.local_part, d.name as domain_name
    FROM mailboxes m
    JOIN domains d ON m.domain_id = d.id
    WHERE m.id = ?
  `),
  getEmailsByMailbox: db.prepare<Email, [string]>(`
    SELECT id, mailbox_id, from_address, to_address, subject, size, received_at
    FROM emails
    WHERE mailbox_id = ?
    ORDER BY received_at DESC
    LIMIT 100
  `),
  getEmailById: db.prepare<Email, [string]>("SELECT * FROM emails WHERE id = ?"),
  getEmailMailboxOwner: db.prepare<{ user_id: string }, [string]>(`
    SELECT m.user_id FROM emails e
    JOIN mailboxes m ON e.mailbox_id = m.id
    WHERE e.id = ?
  `),
  getAttachmentsByEmail: db.prepare<Attachment, [string]>(
    "SELECT id, email_id, filename, content_type, size FROM attachments WHERE email_id = ?"
  ),
  getAttachmentById: db.prepare<Attachment, [string]>("SELECT * FROM attachments WHERE id = ?"),
  deleteEmail: db.prepare("DELETE FROM emails WHERE id = ?"),
  countUnreadByMailbox: db.prepare<{ count: number }, [string]>(
    "SELECT COUNT(*) as count FROM emails WHERE mailbox_id = ?"
  ),
};

export const emailRoutes = new Elysia({ prefix: "/emails" })
  // 获取邮箱的邮件列表
  .get("/mailbox/:mailboxId", ({ params, cookie }) => {
    const user = getAuthUser(cookie.session.value as string | undefined);
    if (!user) {
      return { success: false, error: "Unauthorized" };
    }

    const mailbox = queries.getMailboxById.get(params.mailboxId);
    if (!mailbox) {
      return { success: false, error: "Mailbox not found" };
    }

    if (mailbox.user_id !== user.id) {
      return { success: false, error: "Not your mailbox" };
    }

    const emails = queries.getEmailsByMailbox.all(params.mailboxId);
    const count = queries.countUnreadByMailbox.get(params.mailboxId);

    return {
      success: true,
      mailbox: {
        id: mailbox.id,
        address: `${mailbox.local_part}@${mailbox.domain_name}`,
      },
      total: count?.count || 0,
      emails: emails.map((e) => ({
        id: e.id,
        from: e.from_address,
        to: e.to_address,
        subject: e.subject || "(No Subject)",
        size: e.size,
        receivedAt: e.received_at,
      })),
    };
  })

  // 获取邮件详情
  .get("/:id", ({ params, cookie }) => {
    const user = getAuthUser(cookie.session.value as string | undefined);
    if (!user) {
      return { success: false, error: "Unauthorized" };
    }

    const owner = queries.getEmailMailboxOwner.get(params.id);
    if (!owner) {
      return { success: false, error: "Email not found" };
    }

    if (owner.user_id !== user.id) {
      return { success: false, error: "Not your email" };
    }

    const email = queries.getEmailById.get(params.id);
    if (!email) {
      return { success: false, error: "Email not found" };
    }

    const attachments = queries.getAttachmentsByEmail.all(params.id);

    return {
      success: true,
      email: {
        id: email.id,
        from: email.from_address,
        to: email.to_address,
        subject: email.subject || "(No Subject)",
        textBody: email.text_body,
        htmlBody: email.html_body,
        size: email.size,
        receivedAt: email.received_at,
        attachments: attachments.map((a) => ({
          id: a.id,
          filename: a.filename || "attachment",
          contentType: a.content_type,
          size: a.size,
        })),
      },
    };
  })

  // 获取原始邮件
  .get("/:id/raw", ({ params, cookie, set }) => {
    const user = getAuthUser(cookie.session.value as string | undefined);
    if (!user) {
      set.status = 401;
      return { success: false, error: "Unauthorized" };
    }

    const owner = queries.getEmailMailboxOwner.get(params.id);
    if (!owner) {
      set.status = 404;
      return { success: false, error: "Email not found" };
    }

    if (owner.user_id !== user.id) {
      set.status = 403;
      return { success: false, error: "Not your email" };
    }

    const email = queries.getEmailById.get(params.id);
    if (!email || !email.raw_email) {
      set.status = 404;
      return { success: false, error: "Raw email not found" };
    }

    set.headers["Content-Type"] = "message/rfc822";
    set.headers["Content-Disposition"] = `attachment; filename="email-${params.id}.eml"`;

    return new Response(Buffer.from(email.raw_email));
  })

  // 删除邮件
  .delete("/:id", ({ params, cookie }) => {
    const user = getAuthUser(cookie.session.value as string | undefined);
    if (!user) {
      return { success: false, error: "Unauthorized" };
    }

    const owner = queries.getEmailMailboxOwner.get(params.id);
    if (!owner) {
      return { success: false, error: "Email not found" };
    }

    if (owner.user_id !== user.id) {
      return { success: false, error: "Not your email" };
    }

    queries.deleteEmail.run(params.id);
    return { success: true };
  });

// 附件路由 - 单独的路由组避免参数名冲突
export const attachmentRoutes = new Elysia({ prefix: "/attachments" })
  .get("/:id", ({ params, cookie, set }) => {
    const user = getAuthUser(cookie.session.value as string | undefined);
    if (!user) {
      set.status = 401;
      return { success: false, error: "Unauthorized" };
    }

    const attachment = queries.getAttachmentById.get(params.id);
    if (!attachment) {
      set.status = 404;
      return { success: false, error: "Attachment not found" };
    }

    // 验证邮件所有权
    const owner = queries.getEmailMailboxOwner.get(attachment.email_id);
    if (!owner || owner.user_id !== user.id) {
      set.status = 403;
      return { success: false, error: "Not your attachment" };
    }

    if (!attachment.content) {
      set.status = 404;
      return { success: false, error: "Attachment content not found" };
    }

    set.headers["Content-Type"] = attachment.content_type || "application/octet-stream";
    set.headers["Content-Disposition"] = `attachment; filename="${attachment.filename || "attachment"}"`;

    return new Response(Buffer.from(attachment.content));
  });
