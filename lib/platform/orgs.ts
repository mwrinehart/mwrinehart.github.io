// Organization & membership management — the tenancy primitives used by auth,
// onboarding, and the org switcher. Consolidates the org logic that Make, CBM,
// and Mirage each implemented separately.

import { randomBytes, randomUUID } from "crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "./db";
import { invites, orgMembers, orgs, users, type OrgRow } from "./db/schema";

function now() {
  return Date.now();
}

const ROLE_VALUES = ["owner", "admin", "member", "viewer"] as const;
type MemberRole = (typeof ROLE_VALUES)[number];
function isRole(r: string): r is MemberRole {
  return (ROLE_VALUES as readonly string[]).includes(r);
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "org"
  );
}

// Insert the Auth.js identity into our users table on sign-in, keeping email/
// name fresh. Idempotent.
export async function upsertUser(input: { id: string; email: string | null; name?: string | null }): Promise<void> {
  const existing = await db.select().from(users).where(eq(users.id, input.id));
  if (existing[0]) {
    await db
      .update(users)
      .set({ email: input.email || existing[0].email, name: input.name ?? existing[0].name })
      .where(eq(users.id, input.id));
    return;
  }
  await db.insert(users).values({
    id: input.id,
    // Email is nullable: a provider may omit the claim on first sign-in. Storing
    // null (not "") keeps isPlatformAdmin/notification lookups honest.
    email: input.email || null,
    name: input.name ?? null,
    activeOrgId: null,
    createdAt: now(),
  });
}

export async function listOrgsForUser(userId: string): Promise<Array<OrgRow & { role: string }>> {
  const rows = await db
    .select({ org: orgs, role: orgMembers.role })
    .from(orgMembers)
    .innerJoin(orgs, eq(orgs.id, orgMembers.orgId))
    .where(eq(orgMembers.userId, userId));
  return rows.map((r) => ({ ...r.org, role: r.role }));
}

export async function getMembership(orgId: string, userId: string) {
  const rows = await db
    .select()
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)));
  return rows[0] ?? null;
}

// The user's active org AND role, resolved in one place. Validates the stored
// active org still has a membership; otherwise falls back to the first membership
// and persists it. Returns null when the user has no org yet (→ onboarding).
// requireTenant() consumes this so the membership row is fetched once per request
// rather than once here and again in requireTenant.
export async function getActiveMembership(userId: string): Promise<{ orgId: string; role: string } | null> {
  const rows = await db.select({ activeOrgId: users.activeOrgId }).from(users).where(eq(users.id, userId));
  const active = rows[0]?.activeOrgId ?? null;
  if (active) {
    const m = await getMembership(active, userId);
    if (m) return { orgId: active, role: m.role };
  }
  const memberships = await listOrgsForUser(userId);
  if (memberships.length === 0) return null;
  const first = memberships[0];
  await setActiveOrg(userId, first.id);
  return { orgId: first.id, role: first.role };
}

export async function getActiveOrgId(userId: string): Promise<string | null> {
  return (await getActiveMembership(userId))?.orgId ?? null;
}

export async function setActiveOrg(userId: string, orgId: string): Promise<void> {
  await db.update(users).set({ activeOrgId: orgId }).where(eq(users.id, userId));
}

// ─── Embeddable widget key ────────────────────────────────────────────────────
// Opaque per-org key that scopes unauthenticated widget reads (e.g. the device
// nudge widget). It identifies an org without exposing its internal id and can be
// rotated to revoke embedded widgets.

function newWidgetKey(): string {
  return `wk_${randomBytes(18).toString("hex")}`;
}

export async function getOrCreateWidgetKey(orgId: string): Promise<string> {
  const rows = await db.select({ key: orgs.widgetPublicKey }).from(orgs).where(eq(orgs.id, orgId));
  if (rows[0]?.key) return rows[0].key;
  const key = newWidgetKey();
  await db.update(orgs).set({ widgetPublicKey: key }).where(eq(orgs.id, orgId));
  return key;
}

export async function regenerateWidgetKey(orgId: string): Promise<string> {
  const key = newWidgetKey();
  await db.update(orgs).set({ widgetPublicKey: key }).where(eq(orgs.id, orgId));
  return key;
}

export async function resolveOrgIdByWidgetKey(key: string): Promise<string | null> {
  if (!key) return null;
  const rows = await db.select({ id: orgs.id }).from(orgs).where(eq(orgs.widgetPublicKey, key));
  return rows[0]?.id ?? null;
}

// ─── Members ──────────────────────────────────────────────────────────────────

export interface MemberRow {
  membershipId: string;
  userId: string;
  email: string | null;
  name: string | null;
  role: string;
  createdAt: number;
}

export async function listMembers(orgId: string): Promise<MemberRow[]> {
  return db
    .select({
      membershipId: orgMembers.id,
      userId: orgMembers.userId,
      email: users.email,
      name: users.name,
      role: orgMembers.role,
      createdAt: orgMembers.createdAt,
    })
    .from(orgMembers)
    .innerJoin(users, eq(users.id, orgMembers.userId))
    .where(eq(orgMembers.orgId, orgId))
    .orderBy(orgMembers.createdAt);
}

async function ownerCount(orgId: string): Promise<number> {
  const rows = await db
    .select({ id: orgMembers.id })
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.role, "owner")));
  return rows.length;
}

// Change a member's role. Only an owner may grant/revoke the owner role, and an
// org must always keep at least one owner.
export async function changeMemberRole(orgId: string, actorRole: string, targetUserId: string, role: string): Promise<void> {
  if (!isRole(role)) throw new Error("Invalid role");
  const m = await getMembership(orgId, targetUserId);
  if (!m) throw new Error("Not a member of this organization");
  if ((role === "owner" || m.role === "owner") && actorRole !== "owner") {
    throw new Error("Only an owner can grant or revoke the owner role.");
  }
  if (m.role === "owner" && role !== "owner" && (await ownerCount(orgId)) <= 1) {
    throw new Error("An organization must keep at least one owner.");
  }
  await db.update(orgMembers).set({ role }).where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, targetUserId)));
}

export async function removeMember(orgId: string, actorRole: string, targetUserId: string): Promise<void> {
  const m = await getMembership(orgId, targetUserId);
  if (!m) return;
  if (m.role === "owner" && actorRole !== "owner") throw new Error("Only an owner can remove an owner.");
  if (m.role === "owner" && (await ownerCount(orgId)) <= 1) throw new Error("Can't remove the last owner of an organization.");
  await db.delete(orgMembers).where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, targetUserId)));
  // Clear the removed user's active org if it pointed here, so they re-resolve to
  // another membership (or onboarding) on their next request.
  await db.update(users).set({ activeOrgId: null }).where(and(eq(users.id, targetUserId), eq(users.activeOrgId, orgId)));
}

// ─── Invites ──────────────────────────────────────────────────────────────────

function newInviteToken(): string {
  return randomBytes(24).toString("hex");
}

// Create an email-bound invite and return its token. `actorRole` gates inviting
// new owners to existing owners only.
export async function createInvite(orgId: string, actorRole: string, email: string, role: string): Promise<{ token: string; email: string; role: string }> {
  const e = email.trim().toLowerCase();
  if (!e || !e.includes("@")) throw new Error("A valid email address is required.");
  let r: MemberRole = isRole(role) ? role : "member";
  if (r === "owner" && actorRole !== "owner") r = "admin";
  const token = newInviteToken();
  await db.insert(invites).values({ id: randomUUID(), orgId, email: e, role: r, token, createdAt: now() });
  return { token, email: e, role: r };
}

export function listPendingInvites(orgId: string) {
  return db
    .select()
    .from(invites)
    .where(and(eq(invites.orgId, orgId), isNull(invites.acceptedAt)))
    .orderBy(desc(invites.createdAt));
}

export async function revokeInvite(orgId: string, inviteId: string): Promise<void> {
  await db.delete(invites).where(and(eq(invites.orgId, orgId), eq(invites.id, inviteId)));
}

export interface PendingInvite {
  id: string;
  orgId: string;
  email: string;
  role: string;
  orgName: string;
  token: string;
}

export async function getInviteByToken(token: string): Promise<PendingInvite | null> {
  if (!token) return null;
  const rows = await db
    .select({ invite: invites, orgName: orgs.name })
    .from(invites)
    .innerJoin(orgs, eq(orgs.id, invites.orgId))
    .where(eq(invites.token, token));
  const r = rows[0];
  if (!r || r.invite.acceptedAt) return null; // unknown or already used
  return { id: r.invite.id, orgId: r.invite.orgId, email: r.invite.email, role: r.invite.role, orgName: r.orgName, token };
}

export async function listPendingInvitesForEmail(email: string | null | undefined): Promise<PendingInvite[]> {
  if (!email) return [];
  const e = email.trim().toLowerCase();
  const rows = await db
    .select({ invite: invites, orgName: orgs.name })
    .from(invites)
    .innerJoin(orgs, eq(orgs.id, invites.orgId))
    .where(and(eq(invites.email, e), isNull(invites.acceptedAt)));
  return rows.map((r) => ({ id: r.invite.id, orgId: r.invite.orgId, email: r.invite.email, role: r.invite.role, orgName: r.orgName, token: r.invite.token }));
}

// Accept an invite for the signed-in user. Email-bound: the session identity must
// match the invited address (the token alone isn't enough), so a forwarded link
// can't be redeemed by the wrong person.
export async function acceptInvite(token: string, userId: string, userEmail: string | null | undefined): Promise<{ orgId: string }> {
  const inv = await getInviteByToken(token);
  if (!inv) throw new Error("This invite is invalid or has already been used.");
  if (!userEmail || userEmail.trim().toLowerCase() !== inv.email) {
    throw new Error("This invite was sent to a different email address. Sign in with that address to accept it.");
  }
  const role: MemberRole = isRole(inv.role) ? inv.role : "member";
  await db
    .insert(orgMembers)
    .values({ id: randomUUID(), orgId: inv.orgId, userId, role, createdAt: now() })
    .onConflictDoNothing({ target: [orgMembers.orgId, orgMembers.userId] });
  await db.update(invites).set({ acceptedAt: now() }).where(and(eq(invites.id, inv.id), isNull(invites.acceptedAt)));
  await setActiveOrg(userId, inv.orgId);
  return { orgId: inv.orgId };
}

// Create an org and make `ownerUserId` its owner. Used by onboarding.
export async function createOrg(name: string, ownerUserId: string): Promise<OrgRow> {
  const id = randomUUID();
  const ts = now();
  const [org] = await db
    .insert(orgs)
    .values({ id, slug: `${slugify(name)}-${id.slice(0, 6)}`, name, plan: "free", createdAt: ts })
    .returning();
  await db.insert(orgMembers).values({ id: randomUUID(), orgId: id, userId: ownerUserId, role: "owner", createdAt: ts });
  await setActiveOrg(ownerUserId, id);
  return org;
}
