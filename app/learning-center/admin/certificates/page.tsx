// Configure completion certificates for the tenant. Litmos certificate
// templates have no API, so the dashboard issues its own print-ready
// certificates; here the admin enables them, sets the wording and signer, and
// chooses whether they apply to all completions or selected courses/paths.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getAdminContext, selectedTeam, tenantScope } from "@/lib/modules/learning-center/context";
import { writeAudit } from "@/lib/modules/learning-center/audit";
import { buildTeamTree, flattenTeamTree } from "@/lib/modules/learning-center/scope";
import { getCertConfig, saveCertConfig } from "@/lib/modules/learning-center/certificates";
import { parseIdList } from "@/lib/modules/learning-center/rules";
import { tenantRootId } from "@/lib/modules/learning-center/tenant";
import { TeamPicker } from "@/components/learning-center/TeamPicker";
import { LcBadge, LcEmpty, LcFlash, LcPageHeader, LcPanel, lcBtnPrimary, lcInputCls } from "@/components/learning-center/ui";

function back(teamId: string, extra: Record<string, string>): never {
  const q = new URLSearchParams({ team: teamId, ...extra });
  redirect(`/learning-center/admin/certificates?${q.toString()}`);
}

export default async function CertificatesPage({
  searchParams,
}: {
  searchParams: Promise<{ team?: string; ok?: string; error?: string }>;
}) {
  const params = await searchParams;
  const ctx = await getAdminContext();
  const team = selectedTeam(ctx, params.team);
  if (!team) {
    return (
      <>
        <LcPageHeader title="Certificates" />
        <LcEmpty title="No teams in your scope" />
      </>
    );
  }

  const { rootId, rootTeam, inScope } = tenantScope(ctx, team.Id);
  if (!inScope) {
    return (
      <>
        <LcPageHeader title="Certificates" />
        <LcEmpty title="Managed at the tenant level">
          Certificate settings are configured for the <span className="font-semibold">{rootTeam?.Name ?? rootId}</span> tenant. You administer a sub-team — ask a tenant admin to change them.
        </LcEmpty>
      </>
    );
  }
  const [config, courses, lps] = await Promise.all([getCertConfig(rootId), ctx.source.listCourses(), ctx.source.listLearningPaths()]);
  const selectedCourses = new Set(parseIdList(config?.courseIds));
  const selectedLps = new Set(parseIdList(config?.learningPathIds));
  const teamOptions = flattenTeamTree(buildTeamTree(ctx.allTeams, ctx.scopeIds));

  async function save(formData: FormData) {
    "use server";
    const c = await getAdminContext();
    const teamId = String(formData.get("team") ?? "");
    const root = tenantRootId(c.allTeams, teamId);
    if (!c.scopeIds.includes(root)) back(teamId, { error: "Outside your scope." });
    await saveCertConfig(
      root,
      {
        enabled: formData.get("enabled") === "on",
        titleText: String(formData.get("titleText") ?? ""),
        messageText: String(formData.get("messageText") ?? ""),
        signerName: String(formData.get("signerName") ?? ""),
        signerTitle: String(formData.get("signerTitle") ?? ""),
        scope: formData.get("scope") === "selected" ? "selected" : "all",
        courseIds: formData.getAll("courseIds").map(String),
        learningPathIds: formData.getAll("learningPathIds").map(String),
      },
      c.session.email,
    );
    await writeAudit(c.session, { action: "certificate_config_updated", targetType: "settings", targetId: root, teamId: root });
    revalidatePath("/learning-center/admin/certificates");
    back(teamId, { ok: "Certificate settings saved." });
  }

  return (
    <>
      <LcPageHeader
        title="Certificates"
        subtitle={
          <>
            Completion certificates for the <span className="font-semibold">{rootTeam?.Name ?? team.Name}</span>{" "}tenant. Learners download a print-ready
            certificate for eligible completions.
          </>
        }
        action={<TeamPicker teams={teamOptions} selectedId={team.Id} />}
      />
      <LcFlash ok={params.ok} error={params.error} />

      <div className="grid gap-6 xl:grid-cols-[1fr_400px]">
        <LcPanel>
          <form action={save} className="space-y-4">
            <input type="hidden" name="team" value={team.Id} />
            <label className="flex items-center gap-2 text-sm text-lc-ink">
              <input type="checkbox" name="enabled" defaultChecked={config?.enabled ?? false} className="accent-lc-purple" /> Issue certificates for this tenant
            </label>
            <label className="block text-sm">
              <span className="font-semibold text-lc-ink">Certificate title</span>
              <input type="text" name="titleText" defaultValue={config?.titleText ?? "Certificate of Completion"} className={`${lcInputCls} mt-1`} />
            </label>
            <label className="block text-sm">
              <span className="font-semibold text-lc-ink">Body line</span>
              <input type="text" name="messageText" defaultValue={config?.messageText ?? "has successfully completed"} className={`${lcInputCls} mt-1`} />
              <span className="text-xs text-lc-muted">Reads: &quot;[Name] {config?.messageText ?? "has successfully completed"} [Course]&quot;.</span>
            </label>
            <div className="flex gap-2">
              <label className="block text-sm flex-1">
                <span className="font-semibold text-lc-ink">Signer name</span>
                <input type="text" name="signerName" defaultValue={config?.signerName ?? ""} placeholder="e.g. Dr. Sasha Nguyen" className={`${lcInputCls} mt-1`} />
              </label>
              <label className="block text-sm flex-1">
                <span className="font-semibold text-lc-ink">Signer title</span>
                <input type="text" name="signerTitle" defaultValue={config?.signerTitle ?? ""} placeholder="e.g. Security Training Lead" className={`${lcInputCls} mt-1`} />
              </label>
            </div>

            <div className="border-t border-lc-line pt-3">
              <div className="text-sm font-semibold text-lc-ink mb-2">Applies to</div>
              <label className="flex items-center gap-2 text-sm text-lc-ink">
                <input type="radio" name="scope" value="all" defaultChecked={(config?.scope ?? "all") === "all"} className="accent-lc-purple" /> All course &amp;
                learning-path completions
              </label>
              <label className="flex items-center gap-2 text-sm text-lc-ink mt-1">
                <input type="radio" name="scope" value="selected" defaultChecked={config?.scope === "selected"} className="accent-lc-purple" /> Selected only
              </label>
              <div className="grid gap-3 md:grid-cols-2 mt-3">
                <div>
                  <div className="text-xs font-semibold text-lc-ink mb-1">Courses</div>
                  <div className="max-h-40 overflow-y-auto rounded-lg border border-lc-line p-2 space-y-1">
                    {courses.filter((c) => c.Active).map((c) => (
                      <label key={c.Id} className="flex items-center gap-2 text-xs text-lc-ink">
                        <input type="checkbox" name="courseIds" value={c.Id} defaultChecked={selectedCourses.has(c.Id)} className="accent-lc-purple" />
                        {c.Name}
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-lc-ink mb-1">Learning paths</div>
                  <div className="max-h-40 overflow-y-auto rounded-lg border border-lc-line p-2 space-y-1">
                    {lps.filter((lp) => lp.Active).map((lp) => (
                      <label key={lp.Id} className="flex items-center gap-2 text-xs text-lc-ink">
                        <input type="checkbox" name="learningPathIds" value={lp.Id} defaultChecked={selectedLps.has(lp.Id)} className="accent-lc-purple" />
                        {lp.Name}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <button type="submit" className={lcBtnPrimary}>
              Save certificate settings
            </button>
          </form>
        </LcPanel>

        <div>
          <div className="flex items-center gap-2 mb-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-lc-muted">Preview</div>
            {config?.enabled ? <LcBadge tone="purple">Enabled</LcBadge> : <LcBadge tone="neutral">Off</LcBadge>}
          </div>
          <div className="rounded-2xl border-4 border-lc-purple/20 bg-white p-6 text-center">
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-lc-purple">Jericho Security</div>
            <div className="text-lg font-bold text-lc-ink mt-3">{config?.titleText ?? "Certificate of Completion"}</div>
            <div className="text-xs text-lc-muted mt-4">This certifies that</div>
            <div className="text-base font-bold text-lc-ink mt-1">Jordan Learner</div>
            <div className="text-xs text-lc-muted mt-2">{config?.messageText ?? "has successfully completed"}</div>
            <div className="text-sm font-semibold text-lc-purple mt-1">Phishing Foundations</div>
            <div className="mt-6 flex items-end justify-between text-left">
              <div className="text-[10px] text-lc-muted">
                <div className="border-t border-lc-ink/30 pt-1 w-28">{config?.signerName || "Signer"}</div>
                <div>{config?.signerTitle || "Title"}</div>
              </div>
              <div className="text-[10px] text-lc-muted">
                <div className="border-t border-lc-ink/30 pt-1 w-24">Date</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
