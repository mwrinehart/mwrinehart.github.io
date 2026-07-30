// Shared helpers for the tenant REST API (/learning-center/api/v1/*). A key
// authenticates and scopes every response to its tenant subtree, so a tenant
// can only ever read/write its own people and content.

import { authenticateApiKey, type ApiScope, type AuthenticatedKey } from "./apikeys";
import { getSource } from "./source";
import type { LitmosSource } from "./source";
import { descendantTeamIds } from "./scope";

export interface ApiContext {
  auth: AuthenticatedKey;
  source: LitmosSource;
  scopeTeamIds: string[];
  memberIds: Set<string>;
}

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function authorizeRequest(req: Request, required: ApiScope): Promise<ApiContext> {
  const auth = await authenticateApiKey(req.headers.get("authorization"));
  if (!auth) throw new ApiError(401, "Invalid or missing API key.");
  if (!auth.scopes.includes(required)) throw new ApiError(403, `This key lacks the "${required}" scope.`);

  const source = await getSource();
  const allTeams = await source.listTeams();
  const scopeTeamIds = [auth.teamId, ...descendantTeamIds(allTeams, [auth.teamId])];
  const memberIds = new Set<string>();
  for (const tid of scopeTeamIds) {
    for (const u of await source.listTeamUsers(tid).catch(() => [])) memberIds.add(u.Id);
  }
  return { auth, source, scopeTeamIds, memberIds };
}

export function jsonError(e: unknown): Response {
  if (e instanceof ApiError) return Response.json({ error: e.message }, { status: e.status });
  return Response.json({ error: e instanceof Error ? e.message : "Internal error" }, { status: 500 });
}
