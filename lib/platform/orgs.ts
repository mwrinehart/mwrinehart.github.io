// Organization & membership management — the tenancy primitives used by auth,
// onboarding, and the org switcher. Consolidates the org logic that Make, CBM,
// and Mirage each implemented separately.

import { randomBytes, randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { orgMembers, orgs, users, type OrgRow } from "./db/schema";

function now() {
  return Date.now();
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
