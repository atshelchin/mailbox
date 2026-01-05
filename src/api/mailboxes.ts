import { Elysia, t } from "elysia";
import { db } from "../db";
import { getAuthUser } from "./auth";
import { validateLocalPart } from "../utils/validation";

interface Mailbox {
  id: string;
  local_part: string;
  domain_id: string;
  user_id: string;
  created_at: number;
}

interface Domain {
  id: string;
  name: string;
  is_official: number;
  verified: number;
  user_id: string | null;
}

const queries = {
  getUserMailboxes: db.prepare<Mailbox & { domain_name: string }, [string]>(`
    SELECT m.*, d.name as domain_name
    FROM mailboxes m
    JOIN domains d ON m.domain_id = d.id
    WHERE m.user_id = ?
    ORDER BY m.created_at DESC
  `),
  getMailboxById: db.prepare<Mailbox & { domain_name: string }, [string]>(`
    SELECT m.*, d.name as domain_name
    FROM mailboxes m
    JOIN domains d ON m.domain_id = d.id
    WHERE m.id = ?
  `),
  getMailboxByAddress: db.prepare<Mailbox, [string, string]>(`
    SELECT m.* FROM mailboxes m
    JOIN domains d ON m.domain_id = d.id
    WHERE m.local_part = ? AND d.name = ?
  `),
  checkMailboxExists: db.prepare<{ count: number }, [string, string]>(
    "SELECT COUNT(*) as count FROM mailboxes WHERE local_part = ? AND domain_id = ?"
  ),
  getDomainById: db.prepare<Domain, [string]>("SELECT * FROM domains WHERE id = ?"),
  getDomainByName: db.prepare<Domain, [string]>("SELECT * FROM domains WHERE name = ?"),
  createMailbox: db.prepare(
    "INSERT INTO mailboxes (id, local_part, domain_id, user_id) VALUES (?, ?, ?, ?)"
  ),
  deleteMailbox: db.prepare("DELETE FROM mailboxes WHERE id = ?"),
  countUserMailboxes: db.prepare<{ count: number }, [string]>(
    "SELECT COUNT(*) as count FROM mailboxes WHERE user_id = ?"
  ),
};

const MAX_MAILBOXES_PER_USER = 100;

export const mailboxRoutes = new Elysia({ prefix: "/mailboxes" })
  // 获取用户的所有邮箱
  .get("/", ({ cookie }) => {
    const user = getAuthUser(cookie.session.value);
    if (!user) {
      return { success: false, error: "Unauthorized" };
    }

    const mailboxes = queries.getUserMailboxes.all(user.id);
    return {
      success: true,
      mailboxes: mailboxes.map((m) => ({
        id: m.id,
        address: `${m.local_part}@${m.domain_name}`,
        localPart: m.local_part,
        domain: m.domain_name,
        createdAt: m.created_at,
      })),
    };
  })

  // 注册邮箱地址 (抢注)
  .post(
    "/",
    ({ body, cookie }) => {
      const user = getAuthUser(cookie.session.value);
      if (!user) {
        return { success: false, error: "Unauthorized" };
      }

      const { localPart, domainId } = body;
      const normalizedLocalPart = localPart.toLowerCase().trim();

      // 验证本地部分格式
      const validation = validateLocalPart(normalizedLocalPart);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      // 检查域名是否存在且可用
      const domain = queries.getDomainById.get(domainId);
      if (!domain) {
        return { success: false, error: "Domain not found" };
      }

      // 域名必须是官方域名或已验证的用户域名
      if (domain.is_official !== 1 && domain.verified !== 1) {
        return { success: false, error: "Domain not verified" };
      }

      // 如果是用户自定义域名，只有域名拥有者可以创建邮箱
      if (domain.user_id && domain.user_id !== user.id) {
        return { success: false, error: "You can only create mailboxes on your own domains" };
      }

      // 检查用户邮箱数量限制
      const count = queries.countUserMailboxes.get(user.id);
      if (count && count.count >= MAX_MAILBOXES_PER_USER) {
        return { success: false, error: `Maximum ${MAX_MAILBOXES_PER_USER} mailboxes per user` };
      }

      // 检查邮箱是否已被注册
      const existing = queries.checkMailboxExists.get(normalizedLocalPart, domainId);
      if (existing && existing.count > 0) {
        return { success: false, error: "This email address is already taken" };
      }

      // 创建邮箱
      const mailboxId = crypto.randomUUID();
      queries.createMailbox.run(mailboxId, normalizedLocalPart, domainId, user.id);

      return {
        success: true,
        mailbox: {
          id: mailboxId,
          address: `${normalizedLocalPart}@${domain.name}`,
          localPart: normalizedLocalPart,
          domain: domain.name,
        },
      };
    },
    {
      body: t.Object({
        localPart: t.String(),
        domainId: t.String(),
      }),
    }
  )

  // 获取单个邮箱详情
  .get("/:id", ({ params, cookie }) => {
    const user = getAuthUser(cookie.session.value);
    if (!user) {
      return { success: false, error: "Unauthorized" };
    }

    const mailbox = queries.getMailboxById.get(params.id);
    if (!mailbox) {
      return { success: false, error: "Mailbox not found" };
    }

    if (mailbox.user_id !== user.id) {
      return { success: false, error: "Not your mailbox" };
    }

    return {
      success: true,
      mailbox: {
        id: mailbox.id,
        address: `${mailbox.local_part}@${mailbox.domain_name}`,
        localPart: mailbox.local_part,
        domain: mailbox.domain_name,
        createdAt: mailbox.created_at,
      },
    };
  })

  // 删除邮箱
  .delete("/:id", ({ params, cookie }) => {
    const user = getAuthUser(cookie.session.value);
    if (!user) {
      return { success: false, error: "Unauthorized" };
    }

    const mailbox = queries.getMailboxById.get(params.id);
    if (!mailbox) {
      return { success: false, error: "Mailbox not found" };
    }

    if (mailbox.user_id !== user.id) {
      return { success: false, error: "Not your mailbox" };
    }

    queries.deleteMailbox.run(params.id);
    return { success: true };
  });

// 导出查询函数供 SMTP 服务器使用
export function findMailboxByAddress(localPart: string, domain: string): Mailbox | null {
  return queries.getMailboxByAddress.get(localPart.toLowerCase(), domain.toLowerCase());
}

export function getMailboxOwner(mailboxId: string): string | null {
  const mailbox = queries.getMailboxById.get(mailboxId);
  return mailbox?.user_id || null;
}
