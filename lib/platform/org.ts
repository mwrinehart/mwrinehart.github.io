// Tenant + identity resolution for server code. Every data path routes through
// getOrgId()/requireOrgId() so org isolation is enforced in exactly one place
// (the pattern Make established in lib/org.ts).
//
// NOTE: platform-admin impersonation (Make's full cookie machinery) is a planned
// follow-up — the impersonation_log table and isPlatformAdmin() already exist, so
// getUserId() is the single seam where the impersonated target id will be
// substituted once that subsystem is ported.

import { auth } from "./auth";
import { getActiveMembership, getActiveOrgId } from "./orgs";

export type Role = "owner" | "admin" | "member" | "viewer";

export async function getUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

export async function getUserEmail(): Promise<string | null> {
  const session = await auth();
  return session?.user?.email ?? null;
}

export async function getOrgId(): Promise<string | null> {
  const uid = await getUserId();
  if (!uid) return null;
  return getActiveOrgId(uid);
}

export async function requireOrgId(): Promise<string> {
  const orgId = await getOrgId();
  if (!orgId) throw new Error("No active organization for this request.");
  return orgId;
}

export interface TenantContext {
  userId: string;
  orgId: string;
  role: Role;
}

// Resolve and authorize the caller for the active org. Throws if signed out or
// not a member. Optionally enforce a minimum role.
export async function requireTenant(minRole?: Role): Promise<TenantContext> {
  const userId = await getUserId();
  if (!userId) throw new Error("Not authenticated.");
  const membership = await getActiveMembership(userId);
  if (!membership) throw new Error("No active organization for this request.");
  const role = membership.role as Role;
  if (minRole && !roleAtLeast(role, minRole)) {
    throw new Error(`Requires ${minRole} role.`);
  }
  return { userId, orgId: membership.orgId, role };
}

const ROLE_RANK: Record<Role, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };

export function roleAtLeast(role: Role, min: Role): boolean {
  return (ROLE_RANK[role] ?? -1) >= (ROLE_RANK[min] ?? 99);
}
