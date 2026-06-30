// Platform-admin helpers. Admin status is driven entirely by the
// PLATFORM_ADMIN_EMAILS env list, re-checked on every call (so revoking an
// email immediately removes access). Mirrors Make's lib/admin.ts contract.

import { desc, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { orgMembers, orgs, users, type UserRow } from "./db/schema";
import { getUserEmail } from "./org";
import { list } from "./env";

export function isPlatformAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  return list("PLATFORM_ADMIN_EMAILS").includes(email.toLowerCase());
}

// Authorize the caller as a platform admin (driven solely by PLATFORM_ADMIN_EMAILS,
// independent of org roles). Throws otherwise — call from every admin server action.
export async function requirePlatformAdmin(): Promise<string> {
  const email = await getUserEmail();
  if (!isPlatformAdmin(email)) throw new Error("Platform admin access required.");
  return email as string;
}

export async function getUserById(id: string): Promise<UserRow | null> {
  const rows = await db.select().from(users).where(eq(users.id, id));
  return rows[0] ?? null;
}

export interface AdminOrgRow {
  id: string;
  name: string;
  slug: string;
  plan: string;
  members: number;
  createdAt: number;
}

export async function listAllOrgs(): Promise<AdminOrgRow[]> {
  const rows = await db
    .select({
      id: orgs.id,
      name: orgs.name,
      slug: orgs.slug,
      plan: orgs.plan,
      createdAt: orgs.createdAt,
      members: sql<number>`count(${orgMembers.id})`,
    })
    .from(orgs)
    .leftJoin(orgMembers, eq(orgMembers.orgId, orgs.id))
    .groupBy(orgs.id)
    .orderBy(desc(orgs.createdAt));
  return rows.map((r) => ({ ...r, members: Number(r.members) }));
}

export interface AdminUserRow {
  id: string;
  email: string | null;
  name: string | null;
  createdAt: number;
  orgCount: number;
}

export async function listAllUsers(limit = 200): Promise<AdminUserRow[]> {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      createdAt: users.createdAt,
      orgCount: sql<number>`count(${orgMembers.id})`,
    })
    .from(users)
    .leftJoin(orgMembers, eq(orgMembers.userId, users.id))
    .groupBy(users.id)
    .orderBy(desc(users.createdAt))
    .limit(limit);
  return rows.map((r) => ({ ...r, orgCount: Number(r.orgCount) }));
}

export const PLATFORM_PLANS = ["free", "pro", "enterprise"] as const;

export async function setOrgPlan(orgId: string, plan: string): Promise<void> {
  if (!(PLATFORM_PLANS as readonly string[]).includes(plan)) throw new Error("Invalid plan");
  await db.update(orgs).set({ plan }).where(eq(orgs.id, orgId));
}
