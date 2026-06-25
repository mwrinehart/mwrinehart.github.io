// Per-organization encrypted secret storage (ported from CBM's orgSecrets.js).
//
// Each org's third-party credentials (Slack token, Teams webhook, Litmos key,
// per-org AI keys, …) live as a single AES-256-GCM blob in
// orgs.encrypted_secrets. The master key derives from PLATFORM_MASTER_KEY.
//
// This replaces the three different secret-handling schemes across the source
// apps (CBM's org blob, Make's org_ai_provider_keys / org_lms_targets rows,
// Horizon's AES-256-GCM `.encryption-key` file) with one platform mechanism.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { orgs } from "./db/schema";
import { isProd, str } from "./env";

function masterKey(): Buffer {
  const raw = str("PLATFORM_MASTER_KEY");
  if (!raw) {
    if (isProd) {
      throw new Error(
        "PLATFORM_MASTER_KEY is required in production. Generate: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
      );
    }
    // Dev fallback so the app boots without secrets configured. Never reuse a
    // dev-encrypted blob in production.
    return createHash("sha256").update("dev-insecure-master-key").digest();
  }
  return createHash("sha256").update(raw).digest();
}

export function encryptJson(value: unknown): string {
  const key = masterKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value ?? {}), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, data]).toString("base64"); // iv(12) + tag(16) + data
}

export function decryptJson<T = Record<string, unknown>>(b64: string | null | undefined): T {
  if (!b64) return {} as T;
  try {
    const buf = Buffer.from(b64, "base64");
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const data = buf.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", masterKey(), iv);
    decipher.setAuthTag(tag);
    const out = Buffer.concat([decipher.update(data), decipher.final()]);
    return JSON.parse(out.toString("utf8")) as T;
  } catch {
    return {} as T;
  }
}

export type OrgSecrets = Record<string, string>;

export async function getOrgSecrets(orgId: string): Promise<OrgSecrets> {
  const rows = await db.select({ blob: orgs.encryptedSecrets }).from(orgs).where(eq(orgs.id, orgId));
  return decryptJson<OrgSecrets>(rows[0]?.blob);
}

export async function getOrgSecret(orgId: string, key: string): Promise<string | null> {
  const s = await getOrgSecrets(orgId);
  return s[key] ?? null;
}

export async function setOrgSecrets(orgId: string, patch: OrgSecrets): Promise<OrgSecrets> {
  const merged = { ...(await getOrgSecrets(orgId)), ...patch };
  await db.update(orgs).set({ encryptedSecrets: encryptJson(merged) }).where(eq(orgs.id, orgId));
  return merged;
}
