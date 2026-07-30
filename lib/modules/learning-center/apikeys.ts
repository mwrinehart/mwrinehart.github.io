// Tenant API keys for the Learning Center's own REST API (/learning-center/
// api/v1/*). Each key is scoped to its tenant subtree, so a tenant admin can
// integrate their own systems (HRIS, provisioning) without a Litmos key. The
// raw token is shown once at creation; only its sha256 is stored.

import { createHash, randomBytes, randomUUID, timingSafeEqual } from "crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/platform/db";
import { lcApiKeys, type LcApiKeyRow } from "./schema";
import { parseIdList } from "./rules";

export type ApiScope = "read" | "assign";
const KEY_PREFIX = "lck_";
const LAST_USED_THROTTLE_MS = 60_000;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function listApiKeys(tenantRootTeamId: string): Promise<LcApiKeyRow[]> {
  return db.select().from(lcApiKeys).where(eq(lcApiKeys.teamId, tenantRootTeamId)).orderBy(desc(lcApiKeys.createdAt));
}

// Returns the RAW token exactly once — it is never recoverable afterward.
export async function createApiKey(input: { teamId: string; name: string; scopes: ApiScope[]; createdBy: string }): Promise<{ id: string; token: string }> {
  const token = `${KEY_PREFIX}${randomBytes(24).toString("hex")}`;
  const id = randomUUID();
  await db.insert(lcApiKeys).values({
    id,
    teamId: input.teamId,
    name: input.name.trim() || "API key",
    keyHash: sha256(token),
    keyPrefix: token.slice(0, KEY_PREFIX.length + 6),
    scopes: JSON.stringify(input.scopes.length ? input.scopes : ["read"]),
    createdBy: input.createdBy,
    createdAt: Date.now(),
  });
  return { id, token };
}

export async function revokeApiKey(tenantRootTeamId: string, id: string): Promise<void> {
  await db
    .update(lcApiKeys)
    .set({ revokedAt: Date.now() })
    .where(and(eq(lcApiKeys.id, id), eq(lcApiKeys.teamId, tenantRootTeamId), isNull(lcApiKeys.revokedAt)));
}

export interface AuthenticatedKey {
  teamId: string;
  scopes: ApiScope[];
  keyId: string;
}

// Authenticate an incoming Authorization: Bearer <token>. Constant-time hash
// compare; rejects revoked keys. Records last-used best-effort.
export async function authenticateApiKey(authorizationHeader: string | null): Promise<AuthenticatedKey | null> {
  if (!authorizationHeader) return null;
  const m = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim());
  const token = m?.[1]?.trim();
  if (!token || !token.startsWith(KEY_PREFIX)) return null;

  const hash = sha256(token);
  const rows = await db.select().from(lcApiKeys).where(and(eq(lcApiKeys.keyHash, hash), isNull(lcApiKeys.revokedAt))).limit(1);
  const row = rows[0];
  if (!row) return null;

  // Defense-in-depth constant-time confirm on the hashes.
  const a = Buffer.from(hash);
  const b = Buffer.from(row.keyHash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  // Throttle the last-used write to at most once per minute so a hot key can't
  // hammer a row-update on every request.
  const now = Date.now();
  if (!row.lastUsedAt || now - row.lastUsedAt > LAST_USED_THROTTLE_MS) {
    await db.update(lcApiKeys).set({ lastUsedAt: now }).where(eq(lcApiKeys.id, row.id));
  }
  return { teamId: row.teamId, scopes: parseIdList(row.scopes) as ApiScope[], keyId: row.id };
}
