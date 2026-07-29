// Manage due dates. Litmos models due dates at the COURSE level — a fixed
// calendar date or a days-after-assignment span — and the API cannot set a
// due date for one specific learner (that's UI-only in Litmos). So this page
// is honest about the model: edit course-level settings (via the bulk-import
// course update, the only write path), read per-learner due status, and
// manually trigger due-date reminder emails.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getAdminContext, assertTeamInScope, selectedTeam, teamName } from "@/lib/modules/learning-center/context";
import { writeAudit } from "@/lib/modules/learning-center/audit";
import { buildTeamTree, flattenTeamTree } from "@/lib/modules/learning-center/scope";
import { courseStatusForTeams, scopedMemberIds } from "@/lib/modules/learning-center/reports";
import { sendNotification } from "@/lib/modules/learning-center/notifications";
import { TeamPicker } from "@/components/learning-center/TeamPicker";
import { LcBadge, LcEmpty, LcFlash, LcPageHeader, LcPanel, LcTable, lcBtnPrimary, lcBtnSecondary, lcInputCls, lcSelectCls } from "@/components/learning-center/ui";

const DAY = 86_400_000;

function fmt(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  return Number.isNaN(t) ? "—" : new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function back(teamId: string, courseId: string, extra: Record<string, string>): never {
  const q = new URLSearchParams({ team: teamId, course: courseId, ...extra });
  redirect(`/learning-center/admin/due-dates?${q.toString()}`);
}

export default async function DueDatesPage({
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
        <LcPageHeader title="Due dates" />
        <LcEmpty title="No teams in your scope" />
      </>
    );
  }

  const teamCourses = (await ctx.source.listTeamCourses(team.Id)).filter((c) => !c.CourseTeamLibrary);
  const courseId = params.course && teamCourses.some((c) => c.Id === params.course) ? params.course : (teamCourses[0]?.Id ?? null);
  const details = courseId ? await ctx.source.getCourseDetails(courseId) : null;
  const memberIds = await scopedMemberIds(ctx.source, [team.Id]);
  const status = courseId ? await courseStatusForTeams(ctx.source, courseId, memberIds) : null;
  const teamOptions = flattenTeamTree(buildTeamTree(ctx.allTeams, ctx.scopeIds));
  const now = Date.now();

  async function saveDueSettings(formData: FormData) {
    "use server";
    const c = await getAdminContext();
    const teamId = String(formData.get("team") ?? "");
    assertTeamInScope(c, teamId);
    const cid = String(formData.get("courseId") ?? "");
    const d = await c.source.getCourseDetails(cid);
    if (!d?.Code) back(teamId, cid, { error: "This course has no course code — due-date settings can't be updated via the API." });
    const mode = String(formData.get("mode") ?? "none");
    const fixedDate = String(formData.get("fixedDate") ?? "").trim();
    const span = Number(formData.get("span") ?? "");
    const dueDate = mode === "fixed" && fixedDate ? fixedDate : null;
    const dueDateSpan = mode === "span" && Number.isFinite(span) && span > 0 ? Math.min(100, Math.round(span)) : null;
    if (mode === "fixed" && !dueDate) back(teamId, cid, { error: "Pick the fixed due date." });
    if (mode === "span" && dueDateSpan == null) back(teamId, cid, { error: "Enter the number of days (1–100)." });
    try {
      await c.source.upsertCourseShell({
        CourseTitle: d.Name,
        CourseCode: d.Code,
        Description: d.Description ?? "",
        Active: d.Active,
        DueDate: dueDate,
        DueDateSpan: dueDateSpan,
        ComplianceDateSpan: d.ComplianceDateSpan ?? null,
        ComplianceRetake: d.ComplianceRetake ?? false,
      });
    } catch (e) {
      back(teamId, cid, { error: e instanceof Error ? e.message : "Update failed." });
    }
    await writeAudit(c.session, {
      action: "due_date_settings_updated",
      targetType: "course",
      targetId: cid,
      targetLabel: d.Name,
      teamId,
      detail: dueDate ? `Fixed due date ${dueDate}` : dueDateSpan != null ? `${dueDateSpan} days after assignment` : "Due date removed",
    });
    revalidatePath("/learning-center/admin/due-dates");
    back(teamId, cid, { ok: "Due-date settings submitted (Litmos processes course updates as a bulk-import job)." });
  }

  async function sendDueReminders(formData: FormData) {
    "use server";
    const c = await getAdminContext();
    const teamId = String(formData.get("team") ?? "");
    assertTeamInScope(c, teamId);
    const cid = String(formData.get("courseId") ?? "");
    const d = await c.source.getCourseDetails(cid);
    const memberIdSet = await scopedMemberIds(c.source, [teamId]);
    const st = await courseStatusForTeams(c.source, cid, memberIdSet);
    const members = await c.source.listTeamUsers(teamId);
    const due = st.users.filter((u) => !u.Completed && u.DueDate);
    const recipients = due
      .map((u) => {
        const member = members.find((m) => m.Id === u.Id);
        return member
          ? {
              user: member,
              vars: { course_name: d?.Name ?? "your training", due_date: Date.parse(u.DueDate!) < Date.now() ? "now (overdue)" : fmt(u.DueDate) },
            }
          : null;
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
    if (!recipients.length) back(teamId, cid, { error: "Nobody has an incomplete assignment with a due date on this course." });
    const outcome = await sendNotification({
      source: c.source,
      teamId,
      teamName: teamName(c, teamId),
      type: "due_reminder",
      recipients,
      sentBy: c.session.email,
      extraVars: { course_name: d?.Name ?? "" },
    });
    await writeAudit(c.session, {
      action: "due_reminders_sent",
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
        title="Due dates"
        subtitle="Course-level due dates (fixed date or days-after-assignment). Per-learner due dates are read-only in the Litmos API."
        action={<TeamPicker teams={teamOptions} selectedId={team.Id} />}
      />
      <LcFlash ok={params.ok} error={params.error} />

      {!teamCourses.length ? (
        <LcEmpty title="No courses assigned to this team">Assign courses first, then manage their due dates here.</LcEmpty>
      ) : (
        <>
          <form method="GET" className="mb-6 flex items-center gap-2 max-w-xl">
            <input type="hidden" name="team" value={team.Id} />
            <select name="course" defaultValue={courseId ?? ""} className={lcSelectCls}>
              {teamCourses.map((c) => (
                <option key={c.Id} value={c.Id}>
                  {c.Name}
                </option>
              ))}
            </select>
            <button type="submit" className={lcBtnSecondary}>
              View
            </button>
          </form>

          {details && status && (
            <div className="grid gap-6 xl:grid-cols-[380px_1fr]">
              <div className="space-y-4">
                <LcPanel>
                  <h3 className="font-bold text-lc-ink mb-1">Due-date policy</h3>
                  <p className="text-xs text-lc-muted mb-3">
                    Applies to everyone assigned <span className="font-semibold">{details.Name}</span>, account-wide.
                  </p>
                  <form action={saveDueSettings} className="space-y-3">
                    <input type="hidden" name="team" value={team.Id} />
                    <input type="hidden" name="courseId" value={details.Id} />
                    <label className="flex items-center gap-2 text-sm text-lc-ink">
                      <input type="radio" name="mode" value="none" defaultChecked={!details.DueDate && details.DueDateSpan == null} className="accent-lc-purple" />
                      No due date
                    </label>
                    <label className="flex items-center gap-2 text-sm text-lc-ink">
                      <input type="radio" name="mode" value="span" defaultChecked={details.DueDateSpan != null} className="accent-lc-purple" />
                      Complete within
                      <input type="number" name="span" min={1} max={100} defaultValue={details.DueDateSpan ?? 14} className={`${lcInputCls} !w-20`} />
                      days of assignment
                    </label>
                    <label className="flex items-center gap-2 text-sm text-lc-ink">
                      <input type="radio" name="mode" value="fixed" defaultChecked={!!details.DueDate} className="accent-lc-purple" />
                      Fixed date
                      <input type="date" name="fixedDate" defaultValue={details.DueDate?.slice(0, 10) ?? ""} className={`${lcInputCls} !w-40`} />
                    </label>
                    <button type="submit" className={lcBtnPrimary}>
                      Save due-date policy
                    </button>
                  </form>
                </LcPanel>

                <LcPanel>
                  <h3 className="font-bold text-lc-ink mb-1">Send reminders now</h3>
                  <p className="text-xs text-lc-muted mb-3">
                    Emails your due-date reminder template to every {team.Name} member with an incomplete, dated assignment on this course.
                  </p>
                  <form action={sendDueReminders}>
                    <input type="hidden" name="team" value={team.Id} />
                    <input type="hidden" name="courseId" value={details.Id} />
                    <button type="submit" className={lcBtnSecondary}>
                      Send due-date reminders
                    </button>
                  </form>
                </LcPanel>
              </div>

              <section>
                <div className="flex items-center gap-3 mb-3">
                  <h2 className="text-lg font-bold text-lc-ink">Member status</h2>
                  {status.overdue > 0 && <LcBadge tone="amber">{status.overdue} overdue</LcBadge>}
                  {status.dueSoon > 0 && <LcBadge tone="ink">{status.dueSoon} due within 7 days</LcBadge>}
                </div>
                {status.users.length ? (
                  <LcTable
                    head={
                      <>
                        <th>Member</th>
                        <th>Progress</th>
                        <th>Due</th>
                        <th>Status</th>
                      </>
                    }
                  >
                    {status.users.map((u) => {
                      const due = u.DueDate ? Date.parse(u.DueDate) : NaN;
                      const overdue = !u.Completed && !Number.isNaN(due) && due < now;
                      const dueSoon = !u.Completed && !Number.isNaN(due) && due >= now && due - now < 7 * DAY;
                      return (
                        <tr key={u.Id}>
                          <td className="font-semibold text-lc-ink">
                            {u.FirstName} {u.LastName}
                          </td>
                          <td className="text-lc-muted">{u.Completed ? "Completed" : `${Math.round(u.PercentageComplete)}%`}</td>
                          <td className="text-lc-muted">{fmt(u.DueDate)}</td>
                          <td>
                            {u.Completed ? (
                              <LcBadge tone="purple">Done</LcBadge>
                            ) : overdue ? (
                              <LcBadge tone="amber">Overdue</LcBadge>
                            ) : dueSoon ? (
                              <LcBadge tone="ink">Due soon</LcBadge>
                            ) : (
                              <LcBadge tone="neutral">On track</LcBadge>
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
