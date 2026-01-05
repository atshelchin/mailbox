import { Elysia, t } from "elysia";
import { db } from "../db";
import { config } from "../config";
import { getAuthUser } from "./auth";
import { validateDomain } from "../utils/validation";
import { verifyTxtRecord, generateTxtRecord } from "../utils/dns";

interface Domain {
  id: string;
  name: string;
  user_id: string | null;
  txt_record: string | null;
  verified: number;
  is_official: number;
  created_at: number;
}

const queries = {
  getAllDomains: db.prepare<Domain, []>(
    "SELECT * FROM domains WHERE is_official = 1 OR verified = 1 ORDER BY is_official DESC, name ASC"
  ),
  getUserDomains: db.prepare<Domain, [string]>(
    "SELECT * FROM domains WHERE user_id = ? ORDER BY created_at DESC"
  ),
  getDomainById: db.prepare<Domain, [string]>("SELECT * FROM domains WHERE id = ?"),
  getDomainByName: db.prepare<Domain, [string]>("SELECT * FROM domains WHERE name = ?"),
  createDomain: db.prepare(
    "INSERT INTO domains (id, name, user_id, txt_record) VALUES (?, ?, ?, ?)"
  ),
  updateDomainVerified: db.prepare("UPDATE domains SET verified = 1 WHERE id = ?"),
  deleteDomain: db.prepare("DELETE FROM domains WHERE id = ?"),
};

export const domainRoutes = new Elysia({ prefix: "/domains" })
  // 获取所有可用域名 (官方 + 已验证的用户域名)
  .get("/", ({ cookie }) => {
    const user = getAuthUser(cookie.session.value);
    if (!user) {
      return { success: false, error: "Unauthorized" };
    }

    const domains = queries.getAllDomains.all();
    return {
      success: true,
      domains: domains.map((d) => ({
        id: d.id,
        name: d.name,
        isOfficial: d.is_official === 1,
        isMine: d.user_id === user.id,
      })),
    };
  })

  // 获取用户自己的域名
  .get("/mine", ({ cookie }) => {
    const user = getAuthUser(cookie.session.value);
    if (!user) {
      return { success: false, error: "Unauthorized" };
    }

    const domains = queries.getUserDomains.all(user.id);
    return {
      success: true,
      domains: domains.map((d) => ({
        id: d.id,
        name: d.name,
        txtRecord: d.txt_record,
        verified: d.verified === 1,
        createdAt: d.created_at,
      })),
    };
  })

  // 添加自定义域名
  .post(
    "/",
    ({ body, cookie }) => {
      const user = getAuthUser(cookie.session.value);
      if (!user) {
        return { success: false, error: "Unauthorized" };
      }

      const { name } = body;
      const domainName = name.toLowerCase().trim();

      // 验证域名格式
      const validation = validateDomain(domainName);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      // 检查是否是官方域名
      if (config.officialDomains.includes(domainName)) {
        return { success: false, error: "Cannot add official domain" };
      }

      // 检查域名是否已存在
      const existing = queries.getDomainByName.get(domainName);
      if (existing) {
        return { success: false, error: "Domain already exists" };
      }

      // 生成 TXT 记录
      const txtRecord = generateTxtRecord();
      const domainId = crypto.randomUUID();

      queries.createDomain.run(domainId, domainName, user.id, txtRecord);

      return {
        success: true,
        domain: {
          id: domainId,
          name: domainName,
          txtRecord,
          verified: false,
        },
      };
    },
    {
      body: t.Object({
        name: t.String(),
      }),
    }
  )

  // 获取域名验证信息
  .get("/:id/verify", ({ params, cookie }) => {
    const user = getAuthUser(cookie.session.value);
    if (!user) {
      return { success: false, error: "Unauthorized" };
    }

    const domain = queries.getDomainById.get(params.id);
    if (!domain) {
      return { success: false, error: "Domain not found" };
    }

    if (domain.user_id !== user.id) {
      return { success: false, error: "Not your domain" };
    }

    if (domain.verified === 1) {
      return { success: true, verified: true };
    }

    return {
      success: true,
      verified: false,
      domain: domain.name,
      txtRecord: domain.txt_record,
      instructions: `Add a TXT record to your domain:\n\nHost: _mailbox-verify.${domain.name}\nValue: ${domain.txt_record}\n\nOr:\n\nHost: ${domain.name}\nValue: ${domain.txt_record}`,
    };
  })

  // 验证域名所有权
  .post("/:id/verify", async ({ params, cookie }) => {
    const user = getAuthUser(cookie.session.value);
    if (!user) {
      return { success: false, error: "Unauthorized" };
    }

    const domain = queries.getDomainById.get(params.id);
    if (!domain) {
      return { success: false, error: "Domain not found" };
    }

    if (domain.user_id !== user.id) {
      return { success: false, error: "Not your domain" };
    }

    if (domain.verified === 1) {
      return { success: true, verified: true };
    }

    if (!domain.txt_record) {
      return { success: false, error: "No TXT record found" };
    }

    // 尝试两种验证方式
    const verified =
      (await verifyTxtRecord(`_mailbox-verify.${domain.name}`, domain.txt_record)) ||
      (await verifyTxtRecord(domain.name, domain.txt_record));

    if (verified) {
      queries.updateDomainVerified.run(domain.id);
      return { success: true, verified: true };
    }

    return {
      success: false,
      verified: false,
      error: "TXT record not found. Please make sure you have added the TXT record and wait for DNS propagation.",
    };
  })

  // 删除域名
  .delete("/:id", ({ params, cookie }) => {
    const user = getAuthUser(cookie.session.value);
    if (!user) {
      return { success: false, error: "Unauthorized" };
    }

    const domain = queries.getDomainById.get(params.id);
    if (!domain) {
      return { success: false, error: "Domain not found" };
    }

    if (domain.user_id !== user.id) {
      return { success: false, error: "Not your domain" };
    }

    if (domain.is_official === 1) {
      return { success: false, error: "Cannot delete official domain" };
    }

    queries.deleteDomain.run(domain.id);
    return { success: true };
  });
