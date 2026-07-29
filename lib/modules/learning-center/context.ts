// Per-request admin context: the session plus the resolved team scope. Every
// admin page and server action starts here; every action that touches a team
// re-checks the team against the scope (assertTeamInScope) so a crafted form
// post can't reach outside the admin's teams.

import type { LcSession } from "./auth";
import { requireLcAdmin } from "./auth";
import type { LitmosSource } from "./source";
import { getSource } from "./source";
import type { LitmosTeam } from "./types";
import { scopedTeamIds } from "./scope";

export interface AdminContext {
  session: LcSession;
  source: LitmosSource;
  // Every team in the tenant (needed to draw hierarchies); scoping is applied
  // via scopeIds/scopedTeams.
  allTeams: LitmosTeam[];
  // Teams this admin controls: their admin teams + all descendants; owners get
  // everything. Order: parents before children where possible.
  scopeIds: string[];
  scopedTeams: LitmosTeam[];
  isOwner: boolean;
}

export async function getAdminContext(): Promise<AdminContext> {
  const session = await requireLcAdmin();
  const source = await getSource();
  const allTeams = await source.listTeams();
  const isOwner = session.role === "owner";
  const scopeIds = isOwner ? allTeams.map((t) => t.Id) : scopedTeamIds(allTeams, session.adminTeamIds);
  const scopeSet = new Set(scopeIds);
  return {
    session,
    source,
    allTeams,
    scopeIds,
    scopedTeams: allTeams.filter((t) => scopeSet.has(t.Id)),
    isOwner,
  };
}

export function assertTeamInScope(ctx: AdminContext, teamId: string): void {
  if (!ctx.scopeIds.includes(teamId)) {
    throw new Error("That team is outside your admin scope.");
  }
}

export function teamName(ctx: AdminContext, teamId: string): string {
  return ctx.allTeams.find((t) => t.Id === teamId)?.Name ?? teamId;
}

// The team a page is operating on: an explicit ?team= selection when it's in
// scope, else the admin's first scoped team.
export function selectedTeam(ctx: AdminContext, requested: string | null | undefined): LitmosTeam | null {
  if (requested && ctx.scopeIds.includes(requested)) {
    return ctx.allTeams.find((t) => t.Id === requested) ?? null;
  }
  return ctx.scopedTeams[0] ?? null;
}

// Members of the selected team must be visible to the acting admin before a
// per-user mutation (assign/reset/edit) is allowed. Membership in ANY scoped
// team qualifies.
export async function assertUserInScope(ctx: AdminContext, litmosUserId: string): Promise<void> {
  if (ctx.isOwner) return;
  const teams = await ctx.source.listUserTeams(litmosUserId);
  const scope = new Set(ctx.scopeIds);
  if (!teams.some((t) => scope.has(t.Id))) {
    throw new Error("That user is outside your admin scope.");
  }
}
