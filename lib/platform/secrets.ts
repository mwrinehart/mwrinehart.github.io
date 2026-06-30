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
import { str } from "./env";

function masterKey(): Buffer {
  const raw = str("PLATFORM_MASTER_KEY");
  if (!raw) {
    // Fail closed everywhere EXCEPT an explicit local-development environment.
    // Keying the fallback on `NODE_ENV === "development"` (not merely "not
    // production") means a staging/preview deploy, or one that left NODE_ENV
    // unset, throws here instead of silently encrypting real customer secrets
    // under a publicly-known key.
    if (process.env.NODE_ENV === "development") {
      return createHash("sha256").update("dev-insecure-master-key").digest();
    }
    throw new Error(
      "PLATFORM_MASTER_KEY is required outside local development. Generate: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
    );
  }
  return createHash("sha256").update(raw).digest();
}

// Decrypt a blob, THROWING on any crypto/parse failure. Used by the write path,
// which must never treat an undecryptable blob as "empty".
function decryptOrThrow<T = Record<string, unknown>>(b64: string): T {
  const buf = Buffer.from(b64, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", masterKey(), iv);
  decipher.setAuthTag(tag);
  const out = Buffer.concat([decipher.update(data), decipher.final()]);
  return JSON.parse(out.toString("utf8")) as T;
}

export function encryptJson(value: unknown): string {
  const key = masterKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value ?? {}), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, data]).toString("base64"); // iv(12) + tag(16) + data
}

// Lenient decrypt for READ paths (notify, AI-key lookup): a missing or
// undecryptable blob reads as "no secrets configured" so best-effort sends just
// skip rather than crash. The WRITE path (setOrgSecrets) does NOT use this — it
// must distinguish "empty" from "can't decrypt".
export function decryptJson<T = Record<string, unknown>>(b64: string | null | undefined): T {
  if (!b64) return {} as T;
  try {
    return decryptOrThrow<T>(b64);
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
  // Read the raw blob and decrypt with the strict path. If an existing blob
  // won't decrypt (key rotation/corruption), REFUSE to write — otherwise we'd
  // merge the patch over `{}` and silently destroy every other secret the org
  // has (Slack token, SMTP URL, per-org AI key, …).
  const rows = await db.select({ blob: orgs.encryptedSecrets }).from(orgs).where(eq(orgs.id, orgId));
  const blob = rows[0]?.blob;
  let existing: OrgSecrets = {};
  if (blob) {
    try {
      existing = decryptOrThrow<OrgSecrets>(blob);
    } catch {
      throw new Error(
        "Existing org secrets could not be decrypted (PLATFORM_MASTER_KEY mismatch?). Refusing to overwrite and lose them.",
      );
    }
  }
  const merged = { ...existing, ...patch };
  await db.update(orgs).set({ encryptedSecrets: encryptJson(merged) }).where(eq(orgs.id, orgId));
  return merged;
}
