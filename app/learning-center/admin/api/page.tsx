// Generate and manage API keys for the tenant. Each key is scoped to the
// tenant subtree and authenticates against the Learning Center's own REST API
// (/learning-center/api/v1/*). The raw token is shown exactly once.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getAdminContext, selectedTeam } from "@/lib/modules/learning-center/context";
import { writeAudit } from "@/lib/modules/learning-center/audit";
import { buildTeamTree, flattenTeamTree } from "@/lib/modules/learning-center/scope";
import { createApiKey, listApiKeys, revokeApiKey, type ApiScope } from "@/lib/modules/learning-center/apikeys";
import { parseIdList } from "@/lib/modules/learning-center/rules";
import { tenantRootId } from "@/lib/modules/learning-center/tenant";
import { TeamPicker } from "@/components/learning-center/TeamPicker";
import { LcBadge, LcEmpty, LcFlash, LcPageHeader, LcPanel, LcTable, lcBtnGhost, lcBtnPrimary, lcInputCls } from "@/components/learning-center/ui";

function back(teamId: string, extra: Record<string, string>): never {
  const q = new URLSearchParams({ team: teamId, ...extra });
  redirect(`/learning-center/admin/api?${q.toString()}`);
}

function when(ms: number | null): string {
  return ms ? new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
}

export default async function ApiAccessPage({
  searchParams,
}: {
  searchParams: Promise<{ team?: string; ok?: string; error?: string; token?: string }>;
}) {
  const params = await searchParams;
  const ctx = await getAdminContext();
  const team = selectedTeam(ctx, params.team);
  if (!team) {
    return (
      <>
        <LcPageHeader title="API access" />
        <LcEmpty title="No teams in your scope" />
      </>
    );
  }

  const rootId = tenantRootId(ctx.allTeams, team.Id);
  const rootTeam = ctx.allTeams.find((t) => t.Id === rootId);
  const keys = await listApiKeys(rootId);
  const teamOptions = flattenTeamTree(buildTeamTree(ctx.allTeams, ctx.scopeIds));

  async function create(formData: FormData) {
    "use server";
    const c = await getAdminContext();
    const teamId = String(formData.get("team") ?? "");
    const root = tenantRootId(c.allTeams, teamId);
    if (!c.scopeIds.includes(root)) back(teamId, { error: "Outside your scope." });
    const name = String(formData.get("name") ?? "").trim() || "API key";
    const scopes: ApiScope[] = ["read"];
    if (formData.get("assign") === "on") scopes.push("assign");
    const { token } = await createApiKey({ teamId: root, name, scopes, createdBy: c.session.email });
    await writeAudit(c.session, { action: "api_key_created", targetType: "settings", targetLabel: name, teamId: root, detail: scopes.join(",") });
    revalidatePath("/learning-center/admin/api");
    back(teamId, { ok: `Key "${name}" created. Copy it now — it won't be shown again.`, token });
  }

  async function revoke(formData: FormData) {
    "use server";
    const c = await getAdminContext();
    const teamId = String(formData.get("team") ?? "");
    const root = tenantRootId(c.allTeams, teamId);
    if (!c.scopeIds.includes(root)) back(teamId, { error: "Outside your scope." });
    await revokeApiKey(root, String(formData.get("keyId") ?? ""));
    await writeAudit(c.session, { action: "api_key_revoked", targetType: "settings", targetId: String(formData.get("keyId") ?? ""), teamId: root });
    revalidatePath("/learning-center/admin/api");
    back(teamId, { ok: "Key revoked." });
  }

  const baseUrl = "/learning-center/api/v1";

  return (
    <>
      <LcPageHeader
        title="API access"
        subtitle={
          <>
            API keys for the <span className="font-semibold">{rootTeam?.Name ?? team.Name}</span>{" "}tenant. Each key is scoped to this tenant&apos;s teams.
          </>
        }
        action={<TeamPicker teams={teamOptions} selectedId={team.Id} />}
      />
      <LcFlash ok={params.ok} error={params.error} />

      {params.token && (
        <LcPanel className="mb-6 bg-lc-tint border-lc-purple/30">
          <div className="text-sm font-bold text-lc-ink mb-1">Your new API key — copy it now</div>
          <div className="text-xs text-lc-muted mb-2">This is the only time the full key is shown. Store it somewhere safe.</div>
          <code className="block rounded-lg bg-white border border-lc-line px-3 py-2 text-sm font-mono break-all">{params.token}</code>
        </LcPanel>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <section>
          <h2 className="text-lg font-bold text-lc-ink mb-3">Keys</h2>
          {keys.length ? (
            <LcTable
              head={
                <>
                  <th>Name</th>
                  <th>Prefix</th>
                  <th>Scopes</th>
                  <th>Last used</th>
                  <th>Status</th>
                  <th></th>
                </>
              }
            >
              {keys.map((k) => (
                <tr key={k.id}>
                  <td className="font-semibold text-lc-ink">{k.name}</td>
                  <td className="text-lc-muted font-mono text-xs">{k.keyPrefix}…</td>
                  <td>
                    <div className="flex gap-1">
                      {parseIdList(k.scopes).map((s) => (
                        <LcBadge key={s} tone="neutral">
                          {s}
                        </LcBadge>
                      ))}
                    </div>
                  </td>
                  <td className="text-lc-muted text-xs">{when(k.lastUsedAt)}</td>
                  <td>{k.revokedAt ? <LcBadge tone="amber">Revoked</LcBadge> : <LcBadge tone="purple">Active</LcBadge>}</td>
                  <td className="text-right">
                    {!k.revokedAt && (
                      <form action={revoke} className="inline">
                        <input type="hidden" name="team" value={team.Id} />
                        <input type="hidden" name="keyId" value={k.id} />
                        <button type="submit" className={lcBtnGhost}>
                          Revoke
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </LcTable>
          ) : (
            <LcEmpty title="No API keys yet">Generate one to integrate your systems with this tenant.</LcEmpty>
          )}
        </section>

        <div className="space-y-4">
          <LcPanel>
            <h3 className="font-bold text-lc-ink mb-3">Generate a key</h3>
            <form action={create} className="space-y-3">
              <input type="hidden" name="team" value={team.Id} />
              <input type="text" name="name" placeholder="Key name (e.g. HRIS sync)" className={lcInputCls} />
              <label className="flex items-center gap-2 text-sm text-lc-ink">
                <input type="checkbox" name="assign" className="accent-lc-purple" /> Allow assignment writes (read is always included)
              </label>
              <button type="submit" className={lcBtnPrimary}>
                Generate key
              </button>
            </form>
          </LcPanel>

          <LcPanel>
            <h3 className="font-bold text-lc-ink mb-2">Endpoints</h3>
            <pre className="text-[11px] bg-lc-tint rounded-xl p-3 overflow-x-auto leading-relaxed">{`# Authenticate with:
#   Authorization: Bearer lck_…

GET  ${baseUrl}/users        list tenant users
GET  ${baseUrl}/courses      list courses
GET  ${baseUrl}/teams        list tenant teams
POST ${baseUrl}/assignments  assign a course to a user
     { "email": "...", "courseId": "..." }
     (requires the "assign" scope)`}</pre>
          </LcPanel>
        </div>
      </div>
    </>
  );
}
