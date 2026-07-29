// Manage compliance dates. Litmos's model: a compliance course grants a
// "compliant until" date per learner (completion date + "Compliant for" span),
// optionally with an automatic retake window. The API writes the course-level
// settings (via bulk import) and resets individual results for recertification;
// per-learner compliant-until dates themselves are read-only. This page edits
// the policy, shows everyone's standing, resets learners for recertification,
// and triggers compliance reminder emails.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getAdminContext, assertTeamInScope, assertUserInScope, selectedTeam, teamName } from "@/lib/modules/learning-center/context";
import { writeAudit } from "@/lib/modules/learning-center/audit";
import { buildTeamTree, flattenTeamTree } from "@/lib/modules/learning-center/scope";
import { courseStatusForTeams, scopedMemberIds } from "@/lib/modules/learning-center/reports";
import { sendNotification } from "@/lib/modules/learning-center/notifications";
import { TeamPicker } from "@/components/learning-center/TeamPicker";
import { LcBadge, LcEmpty, LcFlash, LcPageHeader, LcPanel, LcTable, lcBtnGhost, lcBtnPrimary, lcBtnSecondary, lcInputCls, lcSelectCls } from "@/components/learning-center/ui";

const DAY = 86_400_000;

function fmt(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  return Number.isNaN(t) ? "—" : new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function back(teamId: string, courseId: string, extra: Record<string, string>): never {
  const q = new URLSearchParams({ team: teamId, course: courseId, ...extra });
  redirect(`/learning-center/admin/compliance?${q.toString()}`);
}

export default async function CompliancePage({
  searchParams,
}: {
  searchParams: Promise<{ team?: string; course?: string; ok?: string; error?: string }>;
}) {
  const params = await searchParams;
  const ctx = await getAdminContext();
  const team = selectedTeam(ctx, params.team);
  if (!team) {
    return (
      <>
        <LcPageHeader title="Compliance" />
        <LcEmpty title="No teams in your scope" />
      </>
    );
  }

  const teamCourses = (await ctx.source.listTeamCourses(team.Id)).filter((c) => !c.CourseTeamLibrary);
  // Compliance page defaults to the first course that actually has a
  // compliance policy, but any team course can be opened to add one.
  const detailsList = await Promise.all(teamCourses.map((c) => ctx.source.getCourseDetails(c.Id)));
  const complianceCourses = teamCourses.filter((_, i) => detailsList[i]?.ComplianceDateSpan != null);
  const courseId =
    params.course && teamCourses.some((c) => c.Id === params.course)
      ? params.course
      : (complianceCourses[0]?.Id ?? teamCourses[0]?.Id ?? null);
  const details = courseId ? (detailsList[teamCourses.findIndex((c) => c.Id === courseId)] ?? null) : null;
  const memberIds = await scopedMemberIds(ctx.source, [team.Id]);
  const status = courseId ? await courseStatusForTeams(ctx.source, courseId, memberIds) : null;
  const teamOptions = flattenTeamTree(buildTeamTree(ctx.allTeams, ctx.scopeIds));
  const now = Date.now();

  async function saveCompliance(formData: FormData) {
    "use server";
    const c = await getAdminContext();
    const teamId = String(formData.get("team") ?? "");
    assertTeamInScope(c, teamId);
    const cid = String(formData.get("courseId") ?? "");
    const d = await c.source.getCourseDetails(cid);
    if (!d?.Code) back(teamId, cid, { error: "This course has no course code — compliance settings can't be updated via the API." });
    const enabled = formData.get("enabled") === "on";
    const span = Number(formData.get("span") ?? "");
    const retake = formData.get("retake") === "on";
    const complianceSpan = enabled && Number.isFinite(span) && span > 0 ? Math.min(100, Math.round(span)) : null;
    if (enabled && complianceSpan == null) back(teamId, cid, { error: "Enter how many days a completion stays compliant (1–100; Litmos bulk import caps at 100)." });
    try {
      await c.source.upsertCourseShell({
        CourseTitle: d.Name,
        CourseCode: d.Code,
        Description: d.Description ?? "",
        Active: d.Active,
        DueDate: d.DueDate ?? null,
        DueDateSpan: d.DueDateSpan ?? null,
        ComplianceDateSpan: complianceSpan,
        ComplianceRetake: enabled ? retake : false,
      });
    } catch (e) {
      back(teamId, cid, { error: e instanceof Error ? e.message : "Update failed." });
    }
    await writeAudit(c.session, {
      action: "compliance_settings_updated",
      targetType: "course",
      targetId: cid,
      targetLabel: d.Name,
      teamId,
      detail: enabled ? `Compliant for ${complianceSpan} days, auto-retake ${retake ? "on" : "off"}` : "Compliance disabled",
    });
    revalidatePath("/learning-center/admin/compliance");
    back(teamId, cid, { ok: "Compliance settings submitted (Litmos processes course updates as a bulk-import job)." });
  }

  async function recertify(formData: FormData) {
    "use server";
    const c = await getAdminContext();
    const teamId = String(formData.get("team") ?? "");
    assertTeamInScope(c, teamId);
    const cid = String(formData.get("courseId") ?? "");
    const userId = String(formData.get("userId") ?? "");
    const label = String(formData.get("label") ?? userId);
    await assertUserInScope(c, userId);
    try {
      await c.source.resetUserCourse(userId, cid);
    } catch (e) {
      back(teamId, cid, { error: e instanceof Error ? e.message : "Reset failed." });
    }
    await writeAudit(c.session, {
      action: "course_reset_for_recertification",
      targetType: "user",
      targetId: userId,
      targetLabel: label,
      teamId,
      detail: `Course ${cid} reset to 0% — back on their to-do list`,
    });
    revalidatePath("/learning-center/admin/compliance");
    back(teamId, cid, { ok: `${label}'s result was reset — the course is back on their to-do list.` });
  }

  async function sendComplianceReminders(formData: FormData) {
    "use server";
    const c = await getAdminContext();
    const teamId = String(formData.get("team") ?? "");
    assertTeamInScope(c, teamId);
    const cid = String(formData.get("courseId") ?? "");
    const d = await c.source.getCourseDetails(cid);
    const memberIdSet = await scopedMemberIds(c.source, [teamId]);
    const st = await courseStatusForTeams(c.source, cid, memberIdSet);
    const members = await c.source.listTeamUsers(teamId);
    const atRisk = st.users.filter((u) => {
      if (!u.CompliantTill) return false;
      const till = Date.parse(u.CompliantTill);
      return !Number.isNaN(till) && till - Date.now() < 30 * DAY;
    });
    const recipients = atRisk
      .map((u) => {
        const member = members.find((m) => m.Id === u.Id);
        return member ? { user: member, vars: { course_name: d?.Name ?? "your training", compliance_date: fmt(u.CompliantTill) } } : null;
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
    if (!recipients.length) back(teamId, cid, { error: "Nobody is expiring within 30 days (or lapsed) on this course." });
    const outcome = await sendNotification({
      source: c.source,
      teamId,
      teamName: teamName(c, teamId),
      type: "compliance_reminder",
      recipients,
      sentBy: c.session.email,
      extraVars: { course_name: d?.Name ?? "" },
    });
    await writeAudit(c.session, {
      action: "compliance_reminders_sent",
      targetType: "course",
      targetId: cid,
      targetLabel: d?.Name ?? cid,
      teamId,
      detail: `${recipients.length} recipient(s), status ${outcome.status}`,
    });
    back(teamId, cid, outcome.sent > 0 ? { ok: `Reminders sent to ${outcome.sent} member(s).` } : { error: `Send ${outcome.status} — check SMTP configuration (logged either way).` });
  }

  return (
    <>
      <LcPageHeader
        title="Compliance"
        subtitle="Certification windows per course: how long a completion stays compliant, automatic retakes, and per-member standing."
        action={<TeamPicker teams={teamOptions} selectedId={team.Id} />}
      />
      <LcFlash ok={params.ok} error={params.error} />

      {!teamCourses.length ? (
        <LcEmpty title="No courses assigned to this team">Assign courses first, then manage compliance here.</LcEmpty>
      ) : (
        <>
          <form method="GET" className="mb-6 flex items-center gap-2 max-w-xl">
            <input type="hidden" name="team" value={team.Id} />
            <select name="course" defaultValue={courseId ?? ""} className={lcSelectCls}>
              {teamCourses.map((c) => {
                const isCompliance = complianceCourses.some((cc) => cc.Id === c.Id);
                return (
                  <option key={c.Id} value={c.Id}>
                    {isCompliance ? "◆ " : ""}
                    {c.Name}
                  </option>
                );
              })}
            </select>
            <button type="submit" className={lcBtnSecondary}>
              View
            </button>
          </form>

          {details && status && (
            <div className="grid gap-6 xl:grid-cols-[380px_1fr]">
              <div className="space-y-4">
                <LcPanel>
                  <h3 className="font-bold text-lc-ink mb-1">Compliance policy</h3>
                  <p className="text-xs text-lc-muted mb-3">
                    Applies to everyone assigned <span className="font-semibold">{details.Name}</span>, account-wide.
                  </p>
                  <form action={saveCompliance} className="space-y-3">
                    <input type="hidden" name="team" value={team.Id} />
                    <input type="hidden" name="courseId" value={details.Id} />
                    <label className="flex items-center gap-2 text-sm text-lc-ink">
                      <input type="checkbox" name="enabled" defaultChecked={details.ComplianceDateSpan != null} className="accent-lc-purple" />
                      This is a compliance course
                    </label>
                    <label className="flex items-center gap-2 text-sm text-lc-ink">
                      Compliant for
                      <input type="number" name="span" min={1} max={100} defaultValue={details.ComplianceDateSpan ?? 90} className={`${lcInputCls} !w-20`} />
                      days after completion
                    </label>
                    <label className="flex items-center gap-2 text-sm text-lc-ink">
                      <input type="checkbox" name="retake" defaultChecked={details.ComplianceRetake ?? false} className="accent-lc-purple" />
                      Automatic retake before expiry
                    </label>
                    <p className="text-xs text-lc-muted">Note: the Litmos bulk-import API caps compliance spans at 100 days; longer cycles (e.g. annual) must be set in the Litmos UI.</p>
                    <button type="submit" className={lcBtnPrimary}>
                      Save compliance policy
                    </button>
                  </form>
                </LcPanel>

                <LcPanel>
                  <h3 className="font-bold text-lc-ink mb-1">Send compliance reminders</h3>
                  <p className="text-xs text-lc-muted mb-3">Emails everyone on {team.Name} whose certification is lapsed or expiring within 30 days.</p>
                  <form action={sendComplianceReminders}>
                    <input type="hidden" name="team" value={team.Id} />
                    <input type="hidden" name="courseId" value={details.Id} />
                    <button type="submit" className={lcBtnSecondary}>
                      Send reminders now
                    </button>
                  </form>
                </LcPanel>
              </div>

              <section>
                <div className="flex items-center gap-3 mb-3">
                  <h2 className="text-lg font-bold text-lc-ink">Certification standing</h2>
                  {status.lapsed > 0 && <LcBadge tone="amber">{status.lapsed} lapsed</LcBadge>}
                  {status.expiringSoon > 0 && <LcBadge tone="ink">{status.expiringSoon} expiring in 30d</LcBadge>}
                </div>
                {status.users.length ? (
                  <LcTable
                    head={
                      <>
                        <th>Member</th>
                        <th>Compliant until</th>
                        <th>Standing</th>
                        <th className="w-32"></th>
                      </>
                    }
                  >
                    {status.users.map((u) => {
                      const till = u.CompliantTill ? Date.parse(u.CompliantTill) : NaN;
                      const lapsed = !Number.isNaN(till) && till < now;
                      const expiring = !Number.isNaN(till) && till >= now && till - now < 30 * DAY;
                      return (
                        <tr key={u.Id}>
                          <td className="font-semibold text-lc-ink">
                            {u.FirstName} {u.LastName}
                          </td>
                          <td className="text-lc-muted">{fmt(u.CompliantTill)}</td>
                          <td>
                            {lapsed ? (
                              <LcBadge tone="amber">Not compliant</LcBadge>
                            ) : expiring ? (
                              <LcBadge tone="ink">Expiring soon</LcBadge>
                            ) : u.CompliantTill ? (
                              <LcBadge tone="purple">Compliant</LcBadge>
                            ) : u.Completed ? (
                              <LcBadge tone="neutral">No cycle</LcBadge>
                            ) : (
                              <LcBadge tone="neutral">{Math.round(u.PercentageComplete)}% done</LcBadge>
                            )}
                          </td>
                          <td className="text-right">
                            {(u.Completed || u.CompliantTill) && (
                              <form action={recertify} className="inline">
                                <input type="hidden" name="team" value={team.Id} />
                                <input type="hidden" name="courseId" value={details.Id} />
                                <input type="hidden" name="userId" value={u.Id} />
                                <input type="hidden" name="label" value={`${u.FirstName} ${u.LastName}`} />
                                <button type="submit" className={lcBtnGhost} title="Reset to 0% and put the course back on their to-do list">
                                  Reset for recert
                                </button>
                              </form>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </LcTable>
                ) : (
                  <LcEmpty title="No team members are assigned this course yet" />
                )}
              </section>
            </div>
          )}
        </>
      )}
    </>
  );
}
