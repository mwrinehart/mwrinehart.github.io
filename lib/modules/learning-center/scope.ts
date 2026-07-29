// Team-scope resolution. Litmos semantics: a Team Admin controls their team
// AND every sub-team beneath it (control inherits downward; membership does
// not). All tree math is pure so it's unit-testable without a source.

import type { LitmosTeam, LitmosUser } from "./types";
import type { LitmosSource } from "./source";

export function childTeams(teams: LitmosTeam[], parentId: string): LitmosTeam[] {
  return teams.filter((t) => (t.ParentTeamId ?? null) === parentId);
}

// All descendants of the given roots (roots excluded), cycle-safe.
export function descendantTeamIds(teams: LitmosTeam[], rootIds: string[]): string[] {
  const byParent = new Map<string, LitmosTeam[]>();
  for (const t of teams) {
    const p = t.ParentTeamId ?? null;
    if (p !== null) {
      const arr = byParent.get(p) ?? [];
      arr.push(t);
      byParent.set(p, arr);
    }
  }
  const seen = new Set<string>();
  const queue = [...rootIds];
  const out: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    for (const child of byParent.get(id) ?? []) {
      if (!seen.has(child.Id) && !rootIds.includes(child.Id)) {
        seen.add(child.Id);
        out.push(child.Id);
        queue.push(child.Id);
      }
    }
  }
  return out;
}

// Roots + all descendants, deduped, in stable order.
export function scopedTeamIds(teams: LitmosTeam[], adminTeamIds: string[]): string[] {
  const roots = adminTeamIds.filter((id) => teams.some((t) => t.Id === id));
  return [...new Set([...roots, ...descendantTeamIds(teams, roots)])];
}

export interface TeamNode {
  team: LitmosTeam;
  children: TeamNode[];
  depth: number;
}

// Nested tree limited to the given scope; roots are scope teams whose parent
// is outside the scope.
export function buildTeamTree(teams: LitmosTeam[], scopeIds: string[]): TeamNode[] {
  const scope = new Set(scopeIds);
  const inScope = teams.filter((t) => scope.has(t.Id));
  const build = (parentIdInScope: string | null, depth: number): TeamNode[] =>
    inScope
      .filter((t) => {
        const p = t.ParentTeamId ?? null;
        if (parentIdInScope === null) return p === null || !scope.has(p);
        return p === parentIdInScope;
      })
      .sort((a, b) => a.Name.localeCompare(b.Name))
      .map((team) => ({ team, children: build(team.Id, depth + 1), depth }));
  return build(null, 0);
}

// Depth-first flattening of a team tree, for indented pickers.
export function flattenTeamTree(nodes: TeamNode[]): Array<{ id: string; name: string; depth: number }> {
  const out: Array<{ id: string; name: string; depth: number }> = [];
  const walk = (list: TeamNode[]) => {
    for (const node of list) {
      out.push({ id: node.team.Id, name: node.team.Name, depth: node.depth });
      walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

// Teams the given user administers, resolved from Litmos itself: for each team
// the user belongs to, check the team's admin list. Control of sub-teams is
// implied and resolved later via descendantTeamIds, so only direct admin
// designations are returned here.
export async function resolveAdminTeamIds(source: LitmosSource, litmosUserId: string): Promise<string[]> {
  const teams = await source.listUserTeams(litmosUserId);
  const flags = await Promise.all(
    teams.map(async (t) => {
      try {
        const admins = await source.listTeamAdmins(t.Id);
        return admins.some((a: LitmosUser) => a.Id === litmosUserId);
      } catch {
        return false;
      }
    }),
  );
  return teams.filter((_, i) => flags[i]).map((t) => t.Id);
}
