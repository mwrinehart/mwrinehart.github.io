// Manage assignments: team-level courses and learning paths (assign/unassign,
// with sub-team cascade and library placement) plus individual assignment for
// a single member. LP-sourced restrictions from Litmos (can't unassign a
// course delivered via a learning path) surface as readable errors.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getAdminContext, assertTeamInScope, assertUserInScope, selectedTeam, teamName } from "@/lib/modules/learning-center/context";
import { writeAudit } from "@/lib/modules/learning-center/audit";
import { buildTeamTree, flattenTeamTree } from "@/lib/modules/learning-center/scope";
import { TeamPicker } from "@/components/learning-center/TeamPicker";
import { LcBadge, LcEmpty, LcFlash, LcPageHeader, LcPanel, LcTable, lcBtnGhost, lcBtnPrimary, lcSelectCls } from "@/components/learning-center/ui";

function back(teamId: string, extra: Record<string, string>): never {
  const q = new URLSearchParams({ team: teamId, ...extra });
  redirect(`/learning-center/admin/assignments?${q.toString()}`);
}

export default async function AssignmentsPage({
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
        <LcPageHeader title="Assignments" />
        <LcEmpty title="No teams in your scope" />
      </>
    );
  }

  const [teamCourses, teamLps, allCourses, allLps, members] = await Promise.all([
    ctx.source.listTeamCourses(team.Id),
    ctx.source.listTeamLearningPaths(team.Id).catch(() => []),
    ctx.source.listCourses(),
    ctx.source.listLearningPaths(),
    ctx.source.listTeamUsers(team.Id),
  ]);

  const assigned = teamCourses.filter((c) => !c.CourseTeamLibrary);
  const assignedIds = new Set(teamCourses.map((c) => c.Id));
  const assignableCourses = allCourses.filter((c) => c.Active && !assignedIds.has(c.Id));
  const teamLpIds = new Set(teamLps.map((lp) => lp.Id));
  const assignableLps = allLps.filter((lp) => lp.Active && !teamLpIds.has(lp.Id));
  const teamOptions = flattenTeamTree(buildTeamTree(ctx.allTeams, ctx.scopeIds));

  // ── actions ─────────────────────────────────────────────────────────────────

  async function assignCourseToTeam(formData: FormData) {
    "use server";
    const c = await getAdminContext();
    const teamId = String(formData.get("team") ?? "");
    assertTeamInScope(c, teamId);
    const courseId = String(formData.get("courseId") ?? "");
    if (!courseId) back(teamId, { error: "Pick a course first." });
    const includeSubteams = formData.get("includeSubteams") === "on";
    const course = (await c.source.listCourses()).find((x) => x.Id === courseId);
    try {
      await c.source.assignCoursesToTeam(teamId, [courseId], { library: false, includeSubteams });
    } catch (e) {
      back(teamId, { error: e instanceof Error ? e.message : "Assignment failed." });
    }
    await writeAudit(c.session, {
      action: "course_assigned_to_team",
      targetType: "course",
      targetId: courseId,
      targetLabel: course?.Name ?? courseId,
      teamId,
      detail: includeSubteams ? "Including sub-teams" : undefined,
    });
    revalidatePath("/learning-center/admin/assignments");
    back(teamId, { ok: `"${course?.Name ?? courseId}" assigned to ${teamName(c, teamId)}.` });
  }

  async function unassignCourseFromTeam(formData: FormData) {
    "use server";
    const c = await getAdminContext();
    const teamId = String(formData.get("team") ?? "");
    assertTeamInScope(c, teamId);
    const courseId = String(formData.get("courseId") ?? "");
    const label = String(formData.get("label") ?? courseId);
    try {
      await c.source.unassignCoursesFromTeam(teamId, [courseId], false);
    } catch (e) {
      back(teamId, { error: e instanceof Error ? e.message : "Unassign failed (courses delivered via a learning path must be removed there)." });
    }
    await writeAudit(c.session, { action: "course_unassigned_from_team", targetType: "course", targetId: courseId, targetLabel: label, teamId });
    revalidatePath("/learning-center/admin/assignments");
    back(teamId, { ok: `"${label}" unassigned.` });
  }

  async function assignLpToTeam(formData: FormData) {
    "use server";
    const c = await getAdminContext();
    const teamId = String(formData.get("team") ?? "");
    assertTeamInScope(c, teamId);
    const lpId = String(formData.get("lpId") ?? "");
    if (!lpId) back(teamId, { error: "Pick a learning path first." });
    const lp = (await c.source.listLearningPaths()).find((x) => x.Id === lpId);
    try {
      await c.source.assignLearningPathsToTeam(teamId, [lpId]);
    } catch (e) {
      back(teamId, { error: e instanceof Error ? e.message : "Assignment failed." });
    }
    await writeAudit(c.session, { action: "lp_assigned_to_team", targetType: "learning_path", targetId: lpId, targetLabel: lp?.Name ?? lpId, teamId });
    revalidatePath("/learning-center/admin/assignments");
    back(teamId, { ok: `"${lp?.Name ?? lpId}" assigned to ${teamName(c, teamId)}.` });
  }

  async function unassignLpFromTeam(formData: FormData) {
    "use server";
    const c = await getAdminContext();
    const teamId = String(formData.get("team") ?? "");
    assertTeamInScope(c, teamId);
    const lpId = String(formData.get("lpId") ?? "");
    const label = String(formData.get("label") ?? lpId);
    try {
      await c.source.unassignLearningPathsFromTeam(teamId, [lpId]);
    } catch (e) {
      back(teamId, { error: e instanceof Error ? e.message : "Unassign failed." });
    }
    await writeAudit(c.session, { action: "lp_unassigned_from_team", targetType: "learning_path", targetId: lpId, targetLabel: label, teamId });
    revalidatePath("/learning-center/admin/assignments");
    back(teamId, { ok: `"${label}" unassigned.` });
  }

  async function assignToMember(formData: FormData) {
    "use server";
    const c = await getAdminContext();
    const teamId = String(formData.get("team") ?? "");
    assertTeamInScope(c, teamId);
    const userId = String(formData.get("userId") ?? "");
    // Option values are "course:<id>" or "lp:<id>" so kind can never mismatch.
    const content = String(formData.get("content") ?? "");
    const [kind, contentId] = content.includes(":") ? [content.slice(0, content.indexOf(":")), content.slice(content.indexOf(":") + 1)] : ["", ""];
    const sendMessage = formData.get("sendMessage") === "on";
    if (!userId || !contentId || !["course", "lp"].includes(kind)) back(teamId, { error: "Pick a member and a course or learning path." });
    await assertUserInScope(c, userId);
    const users = await c.source.listTeamUsers(teamId);
    const user = users.find((u) => u.Id === userId);
    try {
      if (kind === "course") await c.source.assignCoursesToUser(userId, [contentId], sendMessage);
      else await c.source.assignLearningPathsToUser(userId, [contentId]);
    } catch (e) {
      back(teamId, { error: e instanceof Error ? e.message : "Assignment failed." });
    }
    await writeAudit(c.session, {
      action: kind === "course" ? "course_assigned_to_user" : "lp_assigned_to_user",
      targetType: "user",
      targetId: userId,
      targetLabel: user?.Email ?? userId,
      teamId,
      detail: `Content ${contentId}${sendMessage ? " (Litmos email sent)" : ""}`,
    });
    revalidatePath("/learning-center/admin/assignments");
    back(teamId, { ok: `Assigned to ${user?.Email ?? "member"}.` });
  }

  return (
    <>
      <LcPageHeader
        title="Assignments"
        subtitle={`Required training for ${team.Name}. Library (optional) courses are managed on the Course library page.`}
        action={<TeamPicker teams={teamOptions} selectedId={team.Id} />}
      />
      <LcFlash ok={params.ok} error={params.error} />

      <div className="grid gap-6 xl:grid-cols-2">
        <section>
          <h2 className="text-lg font-bold text-lc-ink mb-3">Team courses ({assigned.length})</h2>
          {assigned.length ? (
            <LcTable
              head={
                <>
                  <th>Course</th>
                  <th className="w-28"></th>
                </>
              }
            >
              {assigned.map((c) => (
                <tr key={c.Id}>
                  <td>
                    <div className="font-semibold text-lc-ink">{c.Name}</div>
                    {c.Code && <div className="text-xs text-lc-muted">{c.Code}</div>}
                  </td>
                  <td className="text-right">
                    <form action={unassignCourseFromTeam} className="inline">
                      <input type="hidden" name="team" value={team.Id} />
                      <input type="hidden" name="courseId" value={c.Id} />
                      <input type="hidden" name="label" value={c.Name} />
                      <button type="submit" className={lcBtnGhost}>
                        Unassign
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </LcTable>
          ) : (
            <LcEmpty title="No courses assigned to this team yet" />
          )}

          <LcPanel className="mt-4">
            <h3 className="font-bold text-lc-ink mb-3">Assign a course to {team.Name}</h3>
            <form action={assignCourseToTeam} className="space-y-2.5">
              <input type="hidden" name="team" value={team.Id} />
              <select name="courseId" required className={lcSelectCls} defaultValue="">
                <option value="" disabled>
                  Choose a course…
                </option>
                {assignableCourses.map((c) => (
                  <option key={c.Id} value={c.Id}>
                    {c.Name}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-2 text-xs text-lc-muted font-medium">
                <input type="checkbox" name="includeSubteams" className="accent-lc-purple" /> Also assign to sub-teams
              </label>
              <p className="text-xs text-lc-muted">Members added to the team later inherit team-assigned courses automatically.</p>
              <button type="submit" className={lcBtnPrimary}>
                Assign course
              </button>
            </form>
          </LcPanel>
        </section>

        <section>
          <h2 className="text-lg font-bold text-lc-ink mb-3">Learning paths ({teamLps.length})</h2>
          {teamLps.length ? (
            <LcTable
              head={
                <>
                  <th>Learning path</th>
                  <th className="w-28"></th>
                </>
              }
            >
              {teamLps.map((lp) => (
                <tr key={lp.Id}>
                  <td>
                    <div className="font-semibold text-lc-ink">{lp.Name}</div>
                    {lp.Description && <div className="text-xs text-lc-muted line-clamp-1">{lp.Description}</div>}
                  </td>
                  <td className="text-right">
                    <form action={unassignLpFromTeam} className="inline">
                      <input type="hidden" name="team" value={team.Id} />
                      <input type="hidden" name="lpId" value={lp.Id} />
                      <input type="hidden" name="label" value={lp.Name} />
                      <button type="submit" className={lcBtnGhost}>
                        Unassign
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </LcTable>
          ) : (
            <LcEmpty title="No learning paths assigned" />
          )}

          <LcPanel className="mt-4">
            <h3 className="font-bold text-lc-ink mb-3">Assign a learning path</h3>
            <form action={assignLpToTeam} className="space-y-2.5">
              <input type="hidden" name="team" value={team.Id} />
              <select name="lpId" required className={lcSelectCls} defaultValue="">
                <option value="" disabled>
                  Choose a learning path…
                </option>
                {assignableLps.map((lp) => (
                  <option key={lp.Id} value={lp.Id}>
                    {lp.Name}
                  </option>
                ))}
              </select>
              <button type="submit" className={lcBtnPrimary}>
                Assign learning path
              </button>
            </form>
          </LcPanel>

          <LcPanel className="mt-4">
            <h3 className="font-bold text-lc-ink mb-1">Assign to one person</h3>
            <p className="text-xs text-lc-muted mb-3">For individual needs outside the team-wide requirements.</p>
            <form action={assignToMember} className="space-y-2.5">
              <input type="hidden" name="team" value={team.Id} />
              <select name="userId" required className={lcSelectCls} defaultValue="">
                <option value="" disabled>
                  Choose a member…
                </option>
                {members.map((m) => (
                  <option key={m.Id} value={m.Id}>
                    {m.FirstName} {m.LastName} — {m.Email}
                  </option>
                ))}
              </select>
              <select name="content" required className={lcSelectCls} defaultValue="">
                <option value="" disabled>
                  Choose content…
                </option>
                <optgroup label="Courses">
                  {allCourses
                    .filter((c) => c.Active)
                    .map((c) => (
                      <option key={c.Id} value={`course:${c.Id}`}>
                        {c.Name}
                      </option>
                    ))}
                </optgroup>
                <optgroup label="Learning paths">
                  {allLps
                    .filter((lp) => lp.Active)
                    .map((lp) => (
                      <option key={lp.Id} value={`lp:${lp.Id}`}>
                        {lp.Name}
                      </option>
                    ))}
                </optgroup>
              </select>
              <label className="flex items-center gap-2 text-xs text-lc-muted font-medium">
                <input type="checkbox" name="sendMessage" className="accent-lc-purple" /> Send the Litmos assignment email
              </label>
              <button type="submit" className={lcBtnPrimary}>
                Assign
              </button>
            </form>
          </LcPanel>
        </section>
      </div>
    </>
  );
}
