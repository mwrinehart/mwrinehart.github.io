// Per-user drill-down: edit the Litmos profile (full-record update under the
// hood), activate/deactivate, manage team memberships within scope, review
// their assignments with unassign/reset actions, and see their gamification.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getAdminContext, assertTeamInScope, assertUserInScope, selectedTeam } from "@/lib/modules/learning-center/context";
import { writeAudit } from "@/lib/modules/learning-center/audit";
import { buildTeamTree, flattenTeamTree } from "@/lib/modules/learning-center/scope";
import { isGamificationDisabled, type GamificationSummary } from "@/lib/modules/learning-center/types";
import { LcBadge, LcFlash, LcPageHeader, LcPanel, LcProgress, LcTable, lcBtnGhost, lcBtnPrimary, lcBtnSecondary, lcInputCls, lcSelectCls } from "@/components/learning-center/ui";

function back(userId: string, teamId: string, extra: Record<string, string>): never {
  const q = new URLSearchParams({ team: teamId, ...extra });
  redirect(`/learning-center/admin/users/${encodeURIComponent(userId)}?${q.toString()}`);
}

function fmt(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  return Number.isNaN(t) ? "—" : new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default async function UserDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ team?: string; ok?: string; error?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await getAdminContext();
  const team = selectedTeam(ctx, sp.team);
  if (!team) notFound();

  // The acting admin must share scope with this user.
  try {
    await assertUserInScope(ctx, id);
  } catch {
    notFound();
  }

  const user = await ctx.source.getUser(id);
  if (!user) notFound();

  const [userTeams, courses, lps] = await Promise.all([
    ctx.source.listUserTeams(id),
    ctx.source.listUserCourses(id).catch(() => []),
    ctx.source.listUserLearningPaths(id).catch(() => []),
  ]);
  let gamification: GamificationSummary | null = null;
  try {
    gamification = await ctx.source.getUserGamificationSummary(id);
  } catch (e) {
    if (!isGamificationDisabled(e)) throw e;
  }

  const scopeSet = new Set(ctx.scopeIds);
  const scopedMemberships = userTeams.filter((t) => scopeSet.has(t.Id));
  const addableTeams = flattenTeamTree(buildTeamTree(ctx.allTeams, ctx.scopeIds)).filter((t) => !userTeams.some((ut) => ut.Id === t.id));

  async function saveProfile(formData: FormData) {
    "use server";
    const c = await getAdminContext();
    await assertUserInScope(c, id);
    const teamId = String(formData.get("team") ?? "");
    const patch = {
      FirstName: String(formData.get("firstName") ?? "").trim(),
      LastName: String(formData.get("lastName") ?? "").trim(),
      JobTitle: String(formData.get("jobTitle") ?? "").trim(),
      CompanyName: String(formData.get("companyName") ?? "").trim(),
      Active: formData.get("active") === "on",
    };
    if (!patch.FirstName || !patch.LastName) back(id, teamId, { error: "First and last name are required." });
    const before = await c.source.getUser(id);
    try {
      await c.source.updateUser(id, patch);
    } catch (e) {
      back(id, teamId, { error: e instanceof Error ? e.message : "Update failed." });
    }
    await writeAudit(c.session, {
      action: before?.Active && !patch.Active ? "user_deactivated" : !before?.Active && patch.Active ? "user_reactivated" : "user_profile_updated",
      targetType: "user",
      targetId: id,
      targetLabel: before?.Email ?? id,
      teamId: teamId || undefined,
    });
    revalidatePath(`/learning-center/admin/users/${id}`);
    back(id, teamId, { ok: "Profile saved." });
  }

  async function addToTeam(formData: FormData) {
    "use server";
    const c = await getAdminContext();
    await assertUserInScope(c, id);
    const currentTeam = String(formData.get("team") ?? "");
    const targetTeam = String(formData.get("targetTeam") ?? "");
    assertTeamInScope(c, targetTeam);
    const u = await c.source.getUser(id);
    try {
      await c.source.addUsersToTeam(targetTeam, [id], false);
    } catch (e) {
      back(id, currentTeam, { error: e instanceof Error ? e.message : "Add failed." });
    }
    await writeAudit(c.session, {
      action: "user_added_to_team",
      targetType: "user",
      targetId: id,
      targetLabel: u?.Email ?? id,
      teamId: targetTeam,
    });
    revalidatePath(`/learning-center/admin/users/${id}`);
    back(id, currentTeam, { ok: "Added to team." });
  }

  async function removeMembership(formData: FormData) {
    "use server";
    const c = await getAdminContext();
    await assertUserInScope(c, id);
    const currentTeam = String(formData.get("team") ?? "");
    const targetTeam = String(formData.get("targetTeam") ?? "");
    assertTeamInScope(c, targetTeam);
    const u = await c.source.getUser(id);
    try {
      await c.source.removeUserFromTeam(targetTeam, id);
    } catch (e) {
      back(id, currentTeam, { error: e instanceof Error ? e.message : "Remove failed." });
    }
    await writeAudit(c.session, {
      action: "user_removed_from_team",
      targetType: "user",
      targetId: id,
      targetLabel: u?.Email ?? id,
      teamId: targetTeam,
    });
    revalidatePath(`/learning-center/admin/users/${id}`);
    back(id, currentTeam, { ok: "Removed from team." });
  }

  async function unassignCourse(formData: FormData) {
    "use server";
    const c = await getAdminContext();
    await assertUserInScope(c, id);
    const currentTeam = String(formData.get("team") ?? "");
    const courseId = String(formData.get("courseId") ?? "");
    const label = String(formData.get("label") ?? courseId);
    const u = await c.source.getUser(id);
    try {
      await c.source.unassignCourseFromUser(id, courseId);
    } catch (e) {
      back(id, currentTeam, { error: e instanceof Error ? e.message : "Unassign failed (learning-path courses must be removed via the path)." });
    }
    await writeAudit(c.session, {
      action: "course_unassigned_from_user",
      targetType: "user",
      targetId: id,
      targetLabel: u?.Email ?? id,
      teamId: currentTeam || undefined,
      detail: label,
    });
    revalidatePath(`/learning-center/admin/users/${id}`);
    back(id, currentTeam, { ok: `"${label}" unassigned.` });
  }

  async function resetCourse(formData: FormData) {
    "use server";
    const c = await getAdminContext();
    await assertUserInScope(c, id);
    const currentTeam = String(formData.get("team") ?? "");
    const courseId = String(formData.get("courseId") ?? "");
    const label = String(formData.get("label") ?? courseId);
    const u = await c.source.getUser(id);
    try {
      await c.source.resetUserCourse(id, courseId);
    } catch (e) {
      back(id, currentTeam, { error: e instanceof Error ? e.message : "Reset failed." });
    }
    await writeAudit(c.session, {
      action: "course_reset_for_recertification",
      targetType: "user",
      targetId: id,
      targetLabel: u?.Email ?? id,
      teamId: currentTeam || undefined,
      detail: label,
    });
    revalidatePath(`/learning-center/admin/users/${id}`);
    back(id, currentTeam, { ok: `"${label}" reset to 0%.` });
  }

  return (
    <>
      <div className="mb-4">
        <Link href={`/learning-center/admin/users?team=${encodeURIComponent(team.Id)}`} className="text-sm font-semibold text-lc-purple hover:underline">
          ← Users
        </Link>
      </div>
      <LcPageHeader
        title={`${user.FirstName} ${user.LastName}`}
        subtitle={
          <>
            {user.Email} · {user.JobTitle || "No title"} {user.Brand ? `· Brand: ${user.Brand}` : ""}
          </>
        }
        action={user.Active ? <LcBadge tone="purple">Active</LcBadge> : <LcBadge tone="amber">Deactivated</LcBadge>}
      />
      <LcFlash ok={sp.ok} error={sp.error} />

      <div className="grid gap-6 xl:grid-cols-[380px_1fr]">
        <div className="space-y-4">
          <LcPanel>
            <h3 className="font-bold text-lc-ink mb-3">Profile</h3>
            <form action={saveProfile} className="space-y-2.5">
              <input type="hidden" name="team" value={team.Id} />
              <div className="flex gap-2">
                <input type="text" name="firstName" defaultValue={user.FirstName} required className={lcInputCls} />
                <input type="text" name="lastName" defaultValue={user.LastName} required className={lcInputCls} />
              </div>
              <input type="text" name="jobTitle" defaultValue={user.JobTitle ?? ""} placeholder="Job title" className={lcInputCls} />
              <input type="text" name="companyName" defaultValue={user.CompanyName ?? ""} placeholder="Company" className={lcInputCls} />
              <label className="flex items-center gap-2 text-sm text-lc-ink">
                <input type="checkbox" name="active" defaultChecked={user.Active} className="accent-lc-purple" /> Active (unchecking deactivates — history
                is preserved, access is removed)
              </label>
              <button type="submit" className={lcBtnPrimary}>
                Save profile
              </button>
            </form>
          </LcPanel>

          <LcPanel>
            <h3 className="font-bold text-lc-ink mb-3">Teams</h3>
            <ul className="space-y-2 mb-3">
              {scopedMemberships.map((t) => (
                <li key={t.Id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="font-medium text-lc-ink">{t.Name}</span>
                  <form action={removeMembership} className="inline">
                    <input type="hidden" name="team" value={team.Id} />
                    <input type="hidden" name="targetTeam" value={t.Id} />
                    <button type="submit" className={lcBtnGhost}>
                      Remove
                    </button>
                  </form>
                </li>
              ))}
              {userTeams.length > scopedMemberships.length && (
                <li className="text-xs text-lc-muted">+ {userTeams.length - scopedMemberships.length} team(s) outside your scope</li>
              )}
              {!userTeams.length && <li className="text-sm text-lc-muted">Not on any team.</li>}
            </ul>
            {addableTeams.length > 0 && (
              <form action={addToTeam} className="flex gap-2">
                <input type="hidden" name="team" value={team.Id} />
                <select name="targetTeam" required className={lcSelectCls} defaultValue="">
                  <option value="" disabled>
                    Add to team…
                  </option>
                  {addableTeams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {`${"— ".repeat(t.depth)}${t.name}`}
                    </option>
                  ))}
                </select>
                <button type="submit" className={`${lcBtnSecondary} shrink-0`}>
                  Add
                </button>
              </form>
            )}
          </LcPanel>

          {gamification && (
            <LcPanel>
              <h3 className="font-bold text-lc-ink mb-2">Gamification</h3>
              <div className="text-sm text-lc-ink">
                <span className="text-2xl font-bold text-lc-purple">{gamification.TotalPointsEarned.toLocaleString()}</span> points ·{" "}
                {gamification.TotalBadgesEarned} badge(s)
              </div>
            </LcPanel>
          )}
        </div>

        <div className="space-y-6">
          <section>
            <h2 className="text-lg font-bold text-lc-ink mb-3">Courses ({courses.length})</h2>
            {courses.length ? (
              <LcTable
                head={
                  <>
                    <th>Course</th>
                    <th>Progress</th>
                    <th>Status</th>
                    <th className="w-44"></th>
                  </>
                }
              >
                {courses.map((c) => (
                  <tr key={c.Id}>
                    <td>
                      <div className="font-semibold text-lc-ink">{c.Name}</div>
                      <div className="text-xs text-lc-muted">Assigned {fmt(c.AssignedDate)}</div>
                    </td>
                    <td className="w-40">
                      <div className="flex items-center gap-2">
                        <LcProgress pct={c.PercentageComplete} className="flex-1" />
                        <span className="text-xs font-semibold text-lc-muted">{Math.round(c.PercentageComplete)}%</span>
                      </div>
                    </td>
                    <td>
                      {c.Complete ? (
                        <LcBadge tone="purple">Done {fmt(c.CompletedDate)}</LcBadge>
                      ) : c.Overdue ? (
                        <LcBadge tone="amber">Overdue</LcBadge>
                      ) : (
                        <LcBadge tone="neutral">In progress</LcBadge>
                      )}
                      {c.ComplaintTill && <div className="text-xs text-lc-muted mt-1">Compliant until {fmt(c.ComplaintTill)}</div>}
                    </td>
                    <td className="text-right">
                      <div className="flex justify-end gap-1">
                        {(c.Complete || c.PercentageComplete > 0) && (
                          <form action={resetCourse} className="inline">
                            <input type="hidden" name="team" value={team.Id} />
                            <input type="hidden" name="courseId" value={c.Id} />
                            <input type="hidden" name="label" value={c.Name} />
                            <button type="submit" className={lcBtnGhost}>
                              Reset
                            </button>
                          </form>
                        )}
                        <form action={unassignCourse} className="inline">
                          <input type="hidden" name="team" value={team.Id} />
                          <input type="hidden" name="courseId" value={c.Id} />
                          <input type="hidden" name="label" value={c.Name} />
                          <button type="submit" className={lcBtnGhost}>
                            Unassign
                          </button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
              </LcTable>
            ) : (
              <LcPanel className="text-sm text-lc-muted">No course assignments.</LcPanel>
            )}
          </section>

          {lps.length > 0 && (
            <section>
              <h2 className="text-lg font-bold text-lc-ink mb-3">Learning paths ({lps.length})</h2>
              <div className="grid gap-3 md:grid-cols-2">
                {lps.map((lp) => (
                  <LcPanel key={lp.Id}>
                    <div className="font-semibold text-lc-ink text-sm">{lp.Name}</div>
                    <div className="mt-2 flex items-center gap-2">
                      <LcProgress pct={lp.PercentageComplete} className="flex-1" />
                      <span className="text-xs font-semibold text-lc-muted">{Math.round(lp.PercentageComplete)}%</span>
                    </div>
                  </LcPanel>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
