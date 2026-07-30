// Assignment rules — team-admin-manageable automation (Litmos Assign is
// account-owner-only and premium, so this engine is the dashboard's own).
// Rules run on the platform cron (`lc-rules`) and via "Run now".

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getAdminContext, assertTeamInScope, selectedTeam, teamName } from "@/lib/modules/learning-center/context";
import { writeAudit } from "@/lib/modules/learning-center/audit";
import { buildTeamTree, flattenTeamTree } from "@/lib/modules/learning-center/scope";
import { createRule, deleteRule, getRule, listRules, listRuns, parseIdList, runRule, setRuleActive } from "@/lib/modules/learning-center/rules";
import { TeamPicker } from "@/components/learning-center/TeamPicker";
import { LcBadge, LcEmpty, LcFlash, LcPageHeader, LcPanel, lcBtnGhost, lcBtnPrimary, lcInputCls, lcSelectCls } from "@/components/learning-center/ui";

function back(teamId: string, extra: Record<string, string>): never {
  const q = new URLSearchParams({ team: teamId, ...extra });
  redirect(`/learning-center/admin/rules?${q.toString()}`);
}

function ago(ms: number | null): string {
  if (!ms) return "never";
  const mins = Math.round((Date.now() - ms) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default async function RulesPage({
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
        <LcPageHeader title="Assignment rules" />
        <LcEmpty title="No teams in your scope" />
      </>
    );
  }

  const [rules, allCourses, allLps] = await Promise.all([
    listRules(ctx.isOwner ? null : ctx.scopeIds),
    ctx.source.listCourses(),
    ctx.source.listLearningPaths(),
  ]);
  const activeCourses = allCourses.filter((c) => c.Active);
  const activeLps = allLps.filter((lp) => lp.Active);
  const runsByRule = new Map(await Promise.all(rules.map(async (r) => [r.id, await listRuns(r.id, 3)] as const)));
  const teamOptions = flattenTeamTree(buildTeamTree(ctx.allTeams, ctx.scopeIds));
  const nameOf = (id: string) => allCourses.find((c) => c.Id === id)?.Name ?? allLps.find((l) => l.Id === id)?.Name ?? id;

  async function create(formData: FormData) {
    "use server";
    const c = await getAdminContext();
    const teamId = String(formData.get("team") ?? "");
    assertTeamInScope(c, teamId);
    const name = String(formData.get("name") ?? "").trim();
    const trigger = String(formData.get("trigger") ?? "member_joined") as "member_joined" | "schedule";
    const intervalDays = Number(formData.get("intervalDays") ?? "7");
    const courseIds = formData.getAll("courseIds").map(String).filter(Boolean);
    const lpIds = formData.getAll("lpIds").map(String).filter(Boolean);
    const sendTemplateTypeRaw = String(formData.get("sendTemplateType") ?? "");
    const sendTemplateType = ["welcome", "assignment", "due_reminder", "compliance_reminder", "custom"].includes(sendTemplateTypeRaw) ? sendTemplateTypeRaw : null;
    const notifyAudienceRaw = String(formData.get("notifyAudience") ?? "");
    const notifyAudience = ["affected", "all", "overdue", "compliance_risk"].includes(notifyAudienceRaw) ? notifyAudienceRaw : null;
    if (!name) back(teamId, { error: "Give the rule a name." });
    if (!["member_joined", "schedule"].includes(trigger)) back(teamId, { error: "Invalid trigger." });
    if (!courseIds.length && !lpIds.length && !sendTemplateType) back(teamId, { error: "Pick at least one course, learning path, or a notification to send." });
    const rule = await createRule({
      teamId,
      teamName: teamName(c, teamId),
      name,
      trigger,
      intervalDays: Number.isFinite(intervalDays) ? Math.max(1, Math.round(intervalDays)) : 7,
      courseIds,
      learningPathIds: lpIds,
      includeSubteams: formData.get("includeSubteams") === "on",
      sendLitmosEmail: formData.get("sendLitmosEmail") === "on",
      sendTemplateType,
      notifyAudience,
      createdBy: c.session.email,
    });
    await writeAudit(c.session, { action: "rule_created", targetType: "rule", targetId: rule.id, targetLabel: name, teamId });
    revalidatePath("/learning-center/admin/rules");
    back(teamId, { ok: `Rule "${name}" created.` });
  }

  async function ruleAction(formData: FormData) {
    "use server";
    const c = await getAdminContext();
    const ruleId = String(formData.get("ruleId") ?? "");
    const op = String(formData.get("op") ?? "");
    const rule = await getRule(ruleId);
    if (!rule) redirect("/learning-center/admin/rules?error=Rule%20not%20found");
    assertTeamInScope(c, rule.teamId);
    if (op === "run") {
      const result = await runRule(rule, { force: true });
      await writeAudit(c.session, { action: "rule_run_manually", targetType: "rule", targetId: rule.id, targetLabel: rule.name, teamId: rule.teamId, detail: result.detail });
      revalidatePath("/learning-center/admin/rules");
      back(rule.teamId, result.status === "failed" ? { error: `Run failed: ${result.detail}` } : { ok: `Rule ran: ${result.detail}` });
    } else if (op === "toggle") {
      await setRuleActive(rule.id, !rule.active);
      await writeAudit(c.session, { action: rule.active ? "rule_paused" : "rule_resumed", targetType: "rule", targetId: rule.id, targetLabel: rule.name, teamId: rule.teamId });
      revalidatePath("/learning-center/admin/rules");
      back(rule.teamId, { ok: `Rule ${rule.active ? "paused" : "resumed"}.` });
    } else if (op === "delete") {
      await deleteRule(rule.id);
      await writeAudit(c.session, { action: "rule_deleted", targetType: "rule", targetId: rule.id, targetLabel: rule.name, teamId: rule.teamId });
      revalidatePath("/learning-center/admin/rules");
      back(rule.teamId, { ok: `Rule "${rule.name}" deleted.` });
    }
    back(rule.teamId, { error: "Unknown action." });
  }

  return (
    <>
      <LcPageHeader
        title="Assignment rules"
        subtitle="Automate training: assign content to new team members the moment they join, or re-run assignments on a schedule."
        action={<TeamPicker teams={teamOptions} selectedId={team.Id} />}
      />
      <LcFlash ok={params.ok} error={params.error} />

      <div className="grid gap-6 xl:grid-cols-[1fr_400px]">
        <section className="space-y-4">
          {rules.length ? (
            rules.map((rule) => {
              const runs = runsByRule.get(rule.id) ?? [];
              const courseIds = parseIdList(rule.courseIds);
              const lpIds = parseIdList(rule.learningPathIds);
              return (
                <LcPanel key={rule.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-lc-ink">{rule.name}</span>
                        {rule.active ? <LcBadge tone="purple">Active</LcBadge> : <LcBadge tone="neutral">Paused</LcBadge>}
                      </div>
                      <div className="text-xs text-lc-muted mt-1">
                        {rule.teamName ?? rule.teamId}
                        {rule.includeSubteams ? " + sub-teams" : ""} ·{" "}
                        {rule.trigger === "member_joined" ? "When a new member joins" : `Every ${rule.intervalDays ?? 7} day(s)`} · Last run{" "}
                        {ago(rule.lastRunAt)}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {courseIds.map((id) => (
                          <LcBadge key={id} tone="ink">
                            {nameOf(id)}
                          </LcBadge>
                        ))}
                        {lpIds.map((id) => (
                          <LcBadge key={id} tone="neutral">
                            LP: {nameOf(id)}
                          </LcBadge>
                        ))}
                        {rule.sendTemplateType && (
                          <LcBadge tone="amber">
                            ✉ {rule.sendTemplateType.replaceAll("_", " ")} → {(rule.notifyAudience ?? "affected").replaceAll("_", " ")}
                          </LcBadge>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <form action={ruleAction} className="inline">
                        <input type="hidden" name="ruleId" value={rule.id} />
                        <input type="hidden" name="op" value="run" />
                        <button type="submit" className={lcBtnGhost}>
                          Run now
                        </button>
                      </form>
                      <form action={ruleAction} className="inline">
                        <input type="hidden" name="ruleId" value={rule.id} />
                        <input type="hidden" name="op" value="toggle" />
                        <button type="submit" className={lcBtnGhost}>
                          {rule.active ? "Pause" : "Resume"}
                        </button>
                      </form>
                      <form action={ruleAction} className="inline">
                        <input type="hidden" name="ruleId" value={rule.id} />
                        <input type="hidden" name="op" value="delete" />
                        <button type="submit" className={lcBtnGhost}>
                          Delete
                        </button>
                      </form>
                    </div>
                  </div>
                  {runs.length > 0 && (
                    <div className="mt-3 border-t border-lc-line pt-2 space-y-1">
                      {runs.map((run) => (
                        <div key={run.id} className="text-xs text-lc-muted flex items-center gap-2">
                          <LcBadge tone={run.status === "success" ? "purple" : run.status === "failed" ? "amber" : "neutral"}>{run.status}</LcBadge>
                          <span>{ago(run.ranAt)}</span>
                          <span className="truncate">{run.detail}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </LcPanel>
              );
            })
          ) : (
            <LcEmpty title="No rules yet">
              Create one on the right — for example, &quot;assign New Hire Security Orientation to everyone who joins {team.Name}&quot;.
            </LcEmpty>
          )}
        </section>

        <LcPanel className="self-start">
          <h3 className="font-bold text-lc-ink mb-1">New rule for {team.Name}</h3>
          <p className="text-xs text-lc-muted mb-3">
            &quot;New member&quot; rules only affect people who join after the rule is created. Rules are evaluated by the scheduler and by Run now.
          </p>
          <form action={create} className="space-y-3">
            <input type="hidden" name="team" value={team.Id} />
            <input type="text" name="name" required placeholder="Rule name (e.g. Onboarding for new joiners)" className={lcInputCls} />
            <div className="flex gap-2 items-center">
              <select name="trigger" className={lcSelectCls} defaultValue="member_joined">
                <option value="member_joined">When a new member joins</option>
                <option value="schedule">On a schedule</option>
              </select>
              <label className="flex items-center gap-1.5 text-xs text-lc-muted shrink-0">
                every
                <input type="number" name="intervalDays" min={1} defaultValue={7} className={`${lcInputCls} !w-16`} />
                days
              </label>
            </div>
            <div>
              <div className="text-xs font-semibold text-lc-ink mb-1.5">Courses</div>
              <div className="max-h-40 overflow-y-auto rounded-lg border border-lc-line p-2 space-y-1">
                {activeCourses.map((c) => (
                  <label key={c.Id} className="flex items-center gap-2 text-xs text-lc-ink">
                    <input type="checkbox" name="courseIds" value={c.Id} className="accent-lc-purple" />
                    {c.Name}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold text-lc-ink mb-1.5">Learning paths</div>
              <div className="max-h-28 overflow-y-auto rounded-lg border border-lc-line p-2 space-y-1">
                {activeLps.map((lp) => (
                  <label key={lp.Id} className="flex items-center gap-2 text-xs text-lc-ink">
                    <input type="checkbox" name="lpIds" value={lp.Id} className="accent-lc-purple" />
                    {lp.Name}
                  </label>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs text-lc-muted font-medium">
              <input type="checkbox" name="includeSubteams" className="accent-lc-purple" /> Include sub-teams
            </label>
            <label className="flex items-center gap-2 text-xs text-lc-muted font-medium">
              <input type="checkbox" name="sendLitmosEmail" className="accent-lc-purple" /> Send the Litmos assignment email
            </label>

            <div className="border-t border-lc-line pt-3">
              <div className="text-xs font-semibold text-lc-ink mb-1.5">Notification action (optional)</div>
              <p className="text-[11px] text-lc-muted mb-2">Rules can also send a notification — on its own or alongside the assignment.</p>
              <select name="sendTemplateType" className={`${lcSelectCls} mb-2`} defaultValue="">
                <option value="">No notification</option>
                <option value="assignment">Send assignment email</option>
                <option value="custom">Send custom message</option>
                <option value="due_reminder">Send due-date reminder</option>
                <option value="compliance_reminder">Send compliance reminder</option>
                <option value="welcome">Send welcome / login link</option>
              </select>
              <select name="notifyAudience" className={lcSelectCls} defaultValue="affected">
                <option value="affected">To affected members (new joiners / this team)</option>
                <option value="all">To everyone in scope</option>
                <option value="overdue">To members with overdue training</option>
                <option value="compliance_risk">To members with compliance at risk</option>
              </select>
            </div>

            <button type="submit" className={lcBtnPrimary}>
              Create rule
            </button>
          </form>
        </LcPanel>
      </div>
    </>
  );
}
