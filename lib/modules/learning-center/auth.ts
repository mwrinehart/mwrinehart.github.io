// Learning Center authentication — deliberately separate from the platform's
// Auth.js setup. Litmos users are not platform users: they sign in with a
// one-time email code, and their authorization (owner / team admin / learner)
// is derived from Litmos itself at login, so access always mirrors the LMS.
//
// Cookie `lc_session` carries an opaque random token; only its sha256 is
// stored. OTPs are 6 digits, hashed at rest, 10-minute expiry, 5 attempts,
// 3 fresh codes per email per 10 minutes.

import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from "crypto";
import { and, desc, eq, gt, gte, isNull, lt, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/platform/db";
import { notify } from "@/lib/platform/notify";
import { isProd } from "@/lib/platform/env";
import { lcLoginCodes, lcSessions } from "./schema";
import { getSource } from "./source";
import { resolveAdminTeamIds } from "./scope";
import { ownerEmails, showLoginCodeInline } from "./config";

export const SESSION_COOKIE = "lc_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CODE_TTL_MS = 10 * 60 * 1000;
const CODE_MAX_ATTEMPTS = 5;
const CODE_RATE_LIMIT = 3; // fresh codes per email per CODE_TTL_MS window

export type LcRole = "owner" | "team_admin" | "learner";

export interface LcSession {
  id: string;
  email: string;
  displayName: string;
  role: LcRole;
  litmosUserId: string | null;
  // Direct admin designations (descendants resolved live per request).
  adminTeamIds: string[];
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function constantTimeEqualHex(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

// ─── identity resolution ──────────────────────────────────────────────────────

export interface ResolvedIdentity {
  role: LcRole;
  litmosUserId: string | null;
  displayName: string;
  adminTeamIds: string[];
}

// Who is this email? Owners come from the env allowlist or a Litmos
// Account_Owner/Administrator access level; team admins from Litmos team-admin
// designations; everyone else active in Litmos is a learner. Unknown emails
// are rejected — the Learning Center has no self-signup.
export async function resolveIdentity(email: string): Promise<ResolvedIdentity | null> {
  const source = await getSource();
  const normalized = email.trim().toLowerCase();
  const litmosUser = await source.findUserByEmail(normalized);
  const isEnvOwner = ownerEmails().includes(normalized);

  if (!litmosUser && !isEnvOwner) return null;
  if (litmosUser && !litmosUser.Active && !isEnvOwner) return null;

  const accessLevel = String(litmosUser?.AccessLevel ?? "").toLowerCase();
  const isLitmosAdmin = accessLevel === "account_owner" || accessLevel === "administrator";
  const displayName = litmosUser ? `${litmosUser.FirstName} ${litmosUser.LastName}`.trim() : normalized;

  if (isEnvOwner || isLitmosAdmin) {
    return { role: "owner", litmosUserId: litmosUser?.Id ?? null, displayName, adminTeamIds: [] };
  }
  const adminTeamIds = await resolveAdminTeamIds(source, litmosUser!.Id);
  return {
    role: adminTeamIds.length ? "team_admin" : "learner",
    litmosUserId: litmosUser!.Id,
    displayName,
    adminTeamIds,
  };
}

// ─── login codes ──────────────────────────────────────────────────────────────

export interface RequestCodeResult {
  ok: boolean;
  error?: string;
  // Populated only in dev/demo (no SMTP round-trip needed to try the product).
  inlineCode?: string;
}

export async function requestLoginCode(email: string): Promise<RequestCodeResult> {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return { ok: false, error: "Enter a valid email address." };

  const identity = await resolveIdentity(normalized);
  if (!identity) {
    // Don't reveal which emails exist in the tenant.
    return { ok: true };
  }

  const windowStart = Date.now() - CODE_TTL_MS;
  const recent = await db
    .select({ id: lcLoginCodes.id })
    .from(lcLoginCodes)
    .where(and(eq(lcLoginCodes.email, normalized), gte(lcLoginCodes.createdAt, windowStart)));
  if (recent.length >= CODE_RATE_LIMIT) return { ok: false, error: "Too many codes requested. Wait a few minutes and try again." };

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const now = Date.now();
  await db.insert(lcLoginCodes).values({
    id: randomUUID(),
    email: normalized,
    codeHash: sha256(code),
    attempts: 0,
    createdAt: now,
    expiresAt: now + CODE_TTL_MS,
  });

  const result = await notify({
    orgId: null,
    channel: "email",
    target: normalized,
    subject: `${code} is your Jericho Security Learning Center sign-in code`,
    body: `Your one-time sign-in code is ${code}. It expires in 10 minutes.\n\nIf you didn't request this, you can ignore this email.`,
    module: "learning-center",
  });

  if (result.status !== "sent" && showLoginCodeInline()) {
    return { ok: true, inlineCode: code };
  }
  if (result.status === "failed") return { ok: false, error: "Could not send the sign-in email. Try again shortly." };
  return { ok: true };
}

export async function verifyLoginCode(email: string, code: string): Promise<{ ok: boolean; error?: string }> {
  const normalized = email.trim().toLowerCase();
  const provided = code.trim();
  if (!/^\d{6}$/.test(provided)) return { ok: false, error: "Enter the 6-digit code from your email." };

  const now = Date.now();
  // All of the email's live codes (newest first). Accepting any unconsumed,
  // unexpired code — not just the newest — means a user who tapped "resend" and
  // then typed the FIRST code they received still gets in.
  const rows = await db
    .select()
    .from(lcLoginCodes)
    .where(and(eq(lcLoginCodes.email, normalized), isNull(lcLoginCodes.consumedAt), gt(lcLoginCodes.expiresAt, now)))
    .orderBy(desc(lcLoginCodes.createdAt))
    .limit(CODE_RATE_LIMIT);
  if (!rows.length) return { ok: false, error: "Code expired or not found. Request a new one." };

  // Brute-force gate: charge one attempt against the newest code atomically and
  // conditionally. A read-then-write of `attempts + 1` would let many concurrent
  // guesses read the same stale count and blow past the 5-attempt ceiling,
  // turning a bounded lockout into an unbounded brute force of the 6-digit space.
  const newest = rows[0];
  const charged = await db
    .update(lcLoginCodes)
    .set({ attempts: sql`${lcLoginCodes.attempts} + 1` })
    .where(and(eq(lcLoginCodes.id, newest.id), lt(lcLoginCodes.attempts, CODE_MAX_ATTEMPTS)))
    .returning({ attempts: lcLoginCodes.attempts });
  if (!charged.length) return { ok: false, error: "Too many attempts. Request a new code." };

  const providedHash = sha256(provided);
  const match = rows.find((r) => constantTimeEqualHex(providedHash, r.codeHash));
  if (!match) {
    return { ok: false, error: "That code is not right. Check the email and try again." };
  }
  const row = match;

  // Identity is resolved fresh at session creation so a revoked team admin
  // can't keep admin access by holding an old code.
  const identity = await resolveIdentity(normalized);
  if (!identity) return { ok: false, error: "This email does not have Learning Center access." };

  await db.update(lcLoginCodes).set({ consumedAt: now }).where(eq(lcLoginCodes.id, row.id));

  const token = randomBytes(32).toString("hex");
  await db.insert(lcSessions).values({
    id: randomUUID(),
    tokenHash: sha256(token),
    email: normalized,
    displayName: identity.displayName,
    litmosUserId: identity.litmosUserId,
    role: identity.role,
    adminTeamIds: JSON.stringify(identity.adminTeamIds),
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
  });

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    path: "/learning-center",
    maxAge: SESSION_TTL_MS / 1000,
  });
  return { ok: true };
}

// ─── session access ───────────────────────────────────────────────────────────

export async function getLcSession(): Promise<LcSession | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const rows = await db
    .select()
    .from(lcSessions)
    .where(and(eq(lcSessions.tokenHash, sha256(token)), gt(lcSessions.expiresAt, Date.now())))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  let adminTeamIds: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.adminTeamIds);
    if (Array.isArray(parsed)) adminTeamIds = parsed.map(String);
  } catch {
    adminTeamIds = [];
  }
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName ?? row.email,
    role: row.role as LcRole,
    litmosUserId: row.litmosUserId,
    adminTeamIds,
  };
}

export async function requireLcSession(): Promise<LcSession> {
  const session = await getLcSession();
  if (!session) redirect("/learning-center/login");
  return session;
}

// Admin area gate: owners and team admins only.
export async function requireLcAdmin(): Promise<LcSession> {
  const session = await requireLcSession();
  if (session.role !== "owner" && session.role !== "team_admin") redirect("/learning-center");
  return session;
}

export async function requireLcOwner(): Promise<LcSession> {
  const session = await requireLcSession();
  if (session.role !== "owner") redirect("/learning-center/admin");
  return session;
}

export async function signOutLc(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.delete(lcSessions).where(eq(lcSessions.tokenHash, sha256(token)));
    // Must match the path the cookie was set with — a bare delete() defaults to
    // Path=/ and would leave the Path=/learning-center cookie in the browser.
    store.delete({ name: SESSION_COOKIE, path: "/learning-center" });
  }
}

// Housekeeping (called from the rules cron): drop expired sessions and codes.
export async function pruneAuthRows(): Promise<void> {
  const now = Date.now();
  await db.delete(lcSessions).where(lt(lcSessions.expiresAt, now));
  await db.delete(lcLoginCodes).where(lt(lcLoginCodes.expiresAt, now - CODE_TTL_MS));
}
