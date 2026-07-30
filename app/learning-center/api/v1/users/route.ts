import { authorizeRequest, jsonError } from "@/lib/modules/learning-center/api";

// GET /learning-center/api/v1/users — tenant users, scoped to the key's subtree.
export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = await authorizeRequest(req, "read");
    const seen = new Map<string, { id: string; email: string; firstName: string; lastName: string; active: boolean }>();
    for (const teamId of ctx.scopeTeamIds) {
      for (const u of await ctx.source.listTeamUsers(teamId).catch(() => [])) {
        if (!seen.has(u.Id)) seen.set(u.Id, { id: u.Id, email: u.Email, firstName: u.FirstName, lastName: u.LastName, active: u.Active });
      }
    }
    return Response.json({ users: [...seen.values()] }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return jsonError(e);
  }
}
