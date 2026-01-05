// RFC 5321 邮箱地址本地部分验证
// 允许: 字母、数字、点、连字符、下划线、加号
// 长度: 1-64 字符
// 不能以点开头或结尾，不能连续两个点

const LOCAL_PART_REGEX = /^[a-zA-Z0-9]([a-zA-Z0-9._+-]*[a-zA-Z0-9])?$/;
const MAX_LOCAL_PART_LENGTH = 64;
const MIN_LOCAL_PART_LENGTH = 1;

// 保留的邮箱地址
const RESERVED_LOCAL_PARTS = [
  "admin",
  "administrator",
  "postmaster",
  "hostmaster",
  "webmaster",
  "abuse",
  "noreply",
  "no-reply",
  "mailer-daemon",
  "root",
  "support",
  "info",
  "contact",
  "security",
  "ssl",
  "ftp",
  "mail",
  "www",
  "ns1",
  "ns2",
  "localhost",
  "test",
];

export function validateLocalPart(localPart: string): { valid: boolean; error?: string } {
  if (!localPart) {
    return { valid: false, error: "Local part is required" };
  }

  if (localPart.length < MIN_LOCAL_PART_LENGTH) {
    return { valid: false, error: `Local part must be at least ${MIN_LOCAL_PART_LENGTH} character` };
  }

  if (localPart.length > MAX_LOCAL_PART_LENGTH) {
    return { valid: false, error: `Local part must be at most ${MAX_LOCAL_PART_LENGTH} characters` };
  }

  if (!LOCAL_PART_REGEX.test(localPart)) {
    return {
      valid: false,
      error: "Local part can only contain letters, numbers, dots, hyphens, underscores, and plus signs",
    };
  }

  if (localPart.includes("..")) {
    return { valid: false, error: "Local part cannot contain consecutive dots" };
  }

  if (RESERVED_LOCAL_PARTS.includes(localPart.toLowerCase())) {
    return { valid: false, error: "This email address is reserved" };
  }

  return { valid: true };
}

// 验证域名格式
const DOMAIN_REGEX = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/;

export function validateDomain(domain: string): { valid: boolean; error?: string } {
  if (!domain) {
    return { valid: false, error: "Domain is required" };
  }

  if (domain.length > 253) {
    return { valid: false, error: "Domain is too long" };
  }

  if (!DOMAIN_REGEX.test(domain)) {
    return { valid: false, error: "Invalid domain format" };
  }

  return { valid: true };
}

// 验证用户名
export function validateUsername(username: string): { valid: boolean; error?: string } {
  if (!username) {
    return { valid: false, error: "Username is required" };
  }

  if (username.length < 3) {
    return { valid: false, error: "Username must be at least 3 characters" };
  }

  if (username.length > 32) {
    return { valid: false, error: "Username must be at most 32 characters" };
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
    return { valid: false, error: "Username can only contain letters, numbers, underscores, and hyphens" };
  }

  return { valid: true };
}
