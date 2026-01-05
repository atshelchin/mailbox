import { resolve } from "dns/promises";

export async function verifyTxtRecord(domain: string, expectedValue: string): Promise<boolean> {
  try {
    const records = await resolve(domain, "TXT");
    for (const record of records) {
      const txt = Array.isArray(record) ? record.join("") : record;
      if (txt === expectedValue) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

export function generateTxtRecord(): string {
  return `mailbox-verify=${crypto.randomUUID()}`;
}
