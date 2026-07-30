import { authorizeRequest, jsonError } from "@/lib/modules/learning-center/api";

// GET /learning-center/api/v1/teams — the key's tenant team and its sub-teams.
export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = await authorizeRequest(req, "read");
    const allTeams = await ctx.source.listTeams();
    const scope = new Set(ctx.scopeTeamIds);
    const teams = allTeams
      .filter((t) => scope.has(t.Id))
      .map((t) => ({ id: t.Id, name: t.Name, parentTeamId: t.ParentTeamId ?? null }));
    return Response.json({ teams }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return jsonError(e);
  }
}
