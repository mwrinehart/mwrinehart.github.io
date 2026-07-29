// CSV export for the reports page. Same auth + team-scope enforcement as the
// admin pages — the session cookie is checked directly (no proxy protection on
// /learning-center paths by design).

import { getLcSession } from "@/lib/modules/learning-center/auth";
import { getSource } from "@/lib/modules/learning-center/source";
import { descendantTeamIds, scopedTeamIds } from "@/lib/modules/learning-center/scope";
import { assignmentDetailCsv, gatherTeamProgress, memberProgressCsv } from "@/lib/modules/learning-center/reports";

export async function GET(req: Request): Promise<Response> {
  const session = await getLcSession();
  if (!session || (session.role !== "owner" && session.role !== "team_admin")) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }

  const url = new URL(req.url);
  const teamId = url.searchParams.get("team") ?? "";
  const type = url.searchParams.get("type") ?? "members";

  const source = await getSource();
  const allTeams = await source.listTeams();
  const scope = session.role === "owner" ? allTeams.map((t) => t.Id) : scopedTeamIds(allTeams, session.adminTeamIds);
  if (!teamId || !scope.includes(teamId)) {
    return Response.json({ error: "That team is outside your admin scope." }, { status: 403 });
  }

  const teamScope = [teamId, ...descendantTeamIds(allTeams, [teamId])].filter((id) => scope.includes(id));
  const data = await gatherTeamProgress(source, teamScope);
  const csv = type === "assignments" ? assignmentDetailCsv(data) : memberProgressCsv(data);
  const teamName = allTeams.find((t) => t.Id === teamId)?.Name.replace(/[^a-z0-9]+/gi, "-").toLowerCase() ?? "team";
  const filename = `learning-center-${teamName}-${type}-${new Date().toISOString().slice(0, 10)}.csv`;

  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
