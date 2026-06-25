// Organization & membership management — the tenancy primitives used by auth,
// onboarding, and the org switcher. Consolidates the org logic that Make, CBM,
// and Mirage each implemented separately.

import { randomUUID } from "crypto";
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
export async function upsertUser(input: { id: string; email: string; name?: string | null }): Promise<void> {
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
    email: input.email,
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

// The user's active org. Falls back to their first membership and persists it so
// subsequent calls are stable. Returns null when the user has no org yet
// (→ onboarding).
export async function getActiveOrgId(userId: string): Promise<string | null> {
  const rows = await db.select({ activeOrgId: users.activeOrgId }).from(users).where(eq(users.id, userId));
  const active = rows[0]?.activeOrgId ?? null;
  if (active) {
    // Confirm the membership still exists; otherwise fall through.
    if (await getMembership(active, userId)) return active;
  }
  const memberships = await listOrgsForUser(userId);
  if (memberships.length === 0) return null;
  const first = memberships[0].id;
  await setActiveOrg(userId, first);
  return first;
}

export async function setActiveOrg(userId: string, orgId: string): Promise<void> {
  await db.update(users).set({ activeOrgId: orgId }).where(eq(users.id, userId));
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
