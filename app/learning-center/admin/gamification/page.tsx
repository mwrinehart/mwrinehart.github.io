// Configure gamification for the tenant: enable/disable, leaderboard
// visibility, a per-completion point bonus, and custom badges (manual or
// auto-earned). Manually award badges/points to members, and run the
// auto-award evaluation on demand. All layered on Litmos's read-only
// gamification data.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getAdminContext, assertUserInScope, selectedTeam } from "@/lib/modules/learning-center/context";
import { writeAudit } from "@/lib/modules/learning-center/audit";
import { buildTeamTree, descendantTeamIds, flattenTeamTree } from "@/lib/modules/learning-center/scope";
import { getTenantSettings, saveTenantGamification, tenantRootId } from "@/lib/modules/learning-center/tenant";
import {
  createBadge,
  deleteBadge,
  evaluateAutoAwards,
  grantAward,
  listAwards,
  listBadges,
  revokeAward,
  setBadgeActive,
  type BadgeCriteria,
} from "@/lib/modules/learning-center/gamify";
import { TeamPicker } from "@/components/learning-center/TeamPicker";
import { LcBadge, LcEmpty, LcFlash, LcPageHeader, LcPanel, LcTable, lcBtnGhost, lcBtnPrimary, lcBtnSecondary, lcInputCls, lcSelectCls } from "@/components/learning-center/ui";

function back(teamId: string, extra: Record<string, string>): never {
  const q = new URLSearchParams({ team: teamId, ...extra });
  redirect(`/learning-center/admin/gamification?${q.toString()}`);
}

const CRITERIA: BadgeCriteria[] = ["manual", "course_completed", "courses_count"];

export default async function GamificationPage({
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
        <LcPageHeader title="Gamification" />
        <LcEmpty title="No teams in your scope" />
      </>
    );
  }

  const rootId = tenantRootId(ctx.allTeams, team.Id);
  const rootTeam = ctx.allTeams.find((t) => t.Id === rootId);
  const [settings, badges, awards, courses] = await Promise.all([
    getTenantSettings(rootId),
    listBadges(rootId),
    listAwards(rootId, 40),
    ctx.source.listCourses(),
  ]);
  // Members across the tenant subtree (for manual awards).
  const tenantTeamIds = [rootId, ...descendantTeamIds(ctx.allTeams, [rootId])].filter((id) => ctx.scopeIds.includes(id));
  const memberMap = new Map<string, { Id: string; FirstName: string; LastName: string; Email: string }>();
  for (const tid of tenantTeamIds) {
    for (const u of await ctx.source.listTeamUsers(tid).catch(() => [])) memberMap.set(u.Id, u);
  }
  const members = [...memberMap.values()].sort((a, b) => a.FirstName.localeCompare(b.FirstName));
  const badgeById = new Map(badges.map((b) => [b.id, b]));
  const courseById = new Map(courses.map((c) => [c.Id, c]));
  const memberById = memberMap;
  const teamOptions = flattenTeamTree(buildTeamTree(ctx.allTeams, ctx.scopeIds));

  async function saveConfig(formData: FormData) {
    "use server";
    const c = await getAdminContext();
    const teamId = String(formData.get("team") ?? "");
    const root = tenantRootId(c.allTeams, teamId);
    if (!c.scopeIds.includes(root)) back(teamId, { error: "Outside your scope." });
    await saveTenantGamification(
      root,
      {
        gamificationEnabled: formData.get("enabled") === "on",
        showLeaderboard: formData.get("showLeaderboard") === "on",
        pointsPerCompletion: Number(formData.get("pointsPerCompletion") ?? "0"),
      },
      c.session.email,
    );
    await writeAudit(c.session, { action: "gamification_config_updated", targetType: "settings", targetId: root, teamId: root });
    revalidatePath("/learning-center/admin/gamification");
    back(teamId, { ok: "Gamification settings saved." });
  }

  async function addBadge(formData: FormData) {
    "use server";
    const c = await getAdminContext();
    const teamId = String(formData.get("team") ?? "");
    const root = tenantRootId(c.allTeams, teamId);
    if (!c.scopeIds.includes(root)) back(teamId, { error: "Outside your scope." });
    const criteriaType = String(formData.get("criteriaType") ?? "manual") as BadgeCriteria;
    if (!CRITERIA.includes(criteriaType)) back(teamId, { error: "Invalid criteria." });
    const title = String(formData.get("title") ?? "").trim();
    if (!title) back(teamId, { error: "Badge needs a title." });
    await createBadge({
      teamId: root,
      title,
      description: String(formData.get("description") ?? ""),
      emoji: String(formData.get("emoji") ?? "★"),
      color: String(formData.get("color") ?? "#6119E5"),
      criteriaType,
      criteriaCourseId: String(formData.get("criteriaCourseId") ?? "") || null,
      criteriaCount: Number(formData.get("criteriaCount") ?? "1"),
      bonusPoints: Number(formData.get("bonusPoints") ?? "0"),
      createdBy: c.session.email,
    });
    await writeAudit(c.session, { action: "badge_created", targetType: "settings", targetLabel: title, teamId: root });
    revalidatePath("/learning-center/admin/gamification");
    back(teamId, { ok: `Badge "${title}" created.` });
  }

  async function badgeAction(formData: FormData) {
    "use server";
    const c = await getAdminContext();
    const teamId = String(formData.get("team") ?? "");
    const root = tenantRootId(c.allTeams, teamId);
    if (!c.scopeIds.includes(root)) back(teamId, { error: "Outside your scope." });
    const badgeId = String(formData.get("badgeId") ?? "");
    const op = String(formData.get("op") ?? "");
    if (op === "delete") {
      await deleteBadge(root, badgeId);
      await writeAudit(c.session, { action: "badge_deleted", targetType: "settings", targetId: badgeId, teamId: root });
    } else if (op === "toggle") {
      await setBadgeActive(root, badgeId, formData.get("active") === "1");
      await writeAudit(c.session, { action: "badge_toggled", targetType: "settings", targetId: badgeId, teamId: root });
    }
    revalidatePath("/learning-center/admin/gamification");
    back(teamId, { ok: "Badge updated." });
  }

  async function award(formData: FormData) {
    "use server";
    const c = await getAdminContext();
    const teamId = String(formData.get("team") ?? "");
    const root = tenantRootId(c.allTeams, teamId);
    if (!c.scopeIds.includes(root)) back(teamId, { error: "Outside your scope." });
    const userId = String(formData.get("userId") ?? "");
    await assertUserInScope(c, userId);
    const badgeId = String(formData.get("badgeId") ?? "");
    const points = Number(formData.get("points") ?? "0");
    const reason = String(formData.get("reason") ?? "");
    if (!badgeId && !(points > 0)) back(teamId, { error: "Pick a badge or enter bonus points." });
    let badge = null;
    if (badgeId) {
      const badgeRows = await listBadges(root);
      badge = badgeRows.find((b) => b.id === badgeId) ?? null;
      if (!badge) back(teamId, { error: "Badge not found." });
    }
    const granted = await grantAward({ teamId: root, litmosUserId: userId, badge, points, reason, awardedBy: c.session.email });
    await writeAudit(c.session, { action: "award_granted", targetType: "user", targetId: userId, targetLabel: badge?.title ?? `${points} pts`, teamId: root });
    revalidatePath("/learning-center/admin/gamification");
    back(teamId, granted ? { ok: "Award granted." } : { error: "That badge was already awarded to this member." });
  }

  async function revoke(formData: FormData) {
    "use server";
    const c = await getAdminContext();
    const teamId = String(formData.get("team") ?? "");
    const root = tenantRootId(c.allTeams, teamId);
    if (!c.scopeIds.includes(root)) back(teamId, { error: "Outside your scope." });
    await revokeAward(root, String(formData.get("awardId") ?? ""));
    await writeAudit(c.session, { action: "award_revoked", targetType: "settings", teamId: root });
    revalidatePath("/learning-center/admin/gamification");
    back(teamId, { ok: "Award revoked." });
  }

  async function runAuto(formData: FormData) {
    "use server";
    const c = await getAdminContext();
    const teamId = String(formData.get("team") ?? "");
    const root = tenantRootId(c.allTeams, teamId);
    if (!c.scopeIds.includes(root)) back(teamId, { error: "Outside your scope." });
    const result = await evaluateAutoAwards(c.source, root);
    await writeAudit(c.session, { action: "auto_awards_evaluated", targetType: "settings", teamId: root, detail: `${result.granted} granted` });
    back(teamId, { ok: `Evaluated ${result.evaluated} auto badge(s); granted ${result.granted} new award(s).` });
  }

  return (
    <>
      <LcPageHeader
        title="Gamification"
        subtitle={
          <>
            Points and badges for the <span className="font-semibold">{rootTeam?.Name ?? team.Name}</span> tenant, layered on Litmos gamification.
          </>
        }
        action={<TeamPicker teams={teamOptions} selectedId={team.Id} />}
      />
      <LcFlash ok={params.ok} error={params.error} />

      <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
        <div className="space-y-4">
          <LcPanel>
            <h3 className="font-bold text-lc-ink mb-3">Settings</h3>
            <form action={saveConfig} className="space-y-3">
              <input type="hidden" name="team" value={team.Id} />
              <label className="flex items-center gap-2 text-sm text-lc-ink">
                <input type="checkbox" name="enabled" defaultChecked={settings?.gamificationEnabled ?? true} className="accent-lc-purple" /> Gamification enabled
              </label>
              <label className="flex items-center gap-2 text-sm text-lc-ink">
                <input type="checkbox" name="showLeaderboard" defaultChecked={settings?.showLeaderboard ?? true} className="accent-lc-purple" /> Show leaderboard to learners
              </label>
              <label className="flex items-center gap-2 text-sm text-lc-ink">
                Bonus points per completion
                <input type="number" name="pointsPerCompletion" min={0} max={10000} defaultValue={settings?.pointsPerCompletion ?? 0} className={`${lcInputCls} !w-24`} />
              </label>
              <button type="submit" className={lcBtnPrimary}>
                Save settings
              </button>
            </form>
          </LcPanel>

          <LcPanel>
            <h3 className="font-bold text-lc-ink mb-1">New badge</h3>
            <p className="text-xs text-lc-muted mb-3">Manual badges are awarded by hand; auto badges are granted when their criteria are met (on the cron and via &quot;Evaluate now&quot;).</p>
            <form action={addBadge} className="space-y-2.5">
              <input type="hidden" name="team" value={team.Id} />
              <div className="flex gap-2">
                <input type="text" name="emoji" defaultValue="★" maxLength={4} className={`${lcInputCls} !w-16 text-center`} />
                <input type="text" name="title" required placeholder="Badge title" className={lcInputCls} />
              </div>
              <input type="text" name="description" placeholder="Description (optional)" className={lcInputCls} />
              <div className="flex gap-2 items-center">
                <label className="text-xs font-semibold text-lc-muted">Color</label>
                <input type="text" name="color" defaultValue="#6119E5" className={`${lcInputCls} !w-32`} />
                <label className="text-xs font-semibold text-lc-muted">Points</label>
                <input type="number" name="bonusPoints" min={0} defaultValue={0} className={`${lcInputCls} !w-20`} />
              </div>
              <select name="criteriaType" className={lcSelectCls} defaultValue="manual">
                <option value="manual">Awarded manually</option>
                <option value="course_completed">When a specific course is completed</option>
                <option value="courses_count">When N courses are completed</option>
              </select>
              <select name="criteriaCourseId" className={lcSelectCls} defaultValue="">
                <option value="">— course (for &quot;specific course&quot;) —</option>
                {courses.filter((c) => c.Active).map((c) => (
                  <option key={c.Id} value={c.Id}>
                    {c.Name}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-2 text-xs text-lc-muted">
                Count (for &quot;N courses&quot;)
                <input type="number" name="criteriaCount" min={1} defaultValue={3} className={`${lcInputCls} !w-20`} />
              </label>
              <button type="submit" className={lcBtnPrimary}>
                Create badge
              </button>
            </form>
          </LcPanel>
        </div>

        <div className="space-y-6">
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-bold text-lc-ink">Badges ({badges.length})</h2>
              <form action={runAuto}>
                <input type="hidden" name="team" value={team.Id} />
                <button type="submit" className={lcBtnSecondary}>
                  Evaluate auto badges now
                </button>
              </form>
            </div>
            {badges.length ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {badges.map((b) => (
                  <LcPanel key={b.id} className="flex items-start gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg" style={{ backgroundColor: `${b.color}20`, color: b.color }}>
                      {b.emoji}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-lc-ink">{b.title}</span>
                        {b.active ? <LcBadge tone="purple">Active</LcBadge> : <LcBadge tone="neutral">Off</LcBadge>}
                      </div>
                      {b.description && <div className="text-xs text-lc-muted mt-0.5">{b.description}</div>}
                      <div className="text-xs text-lc-muted mt-1">
                        {b.criteriaType === "manual"
                          ? "Manual"
                          : b.criteriaType === "course_completed"
                            ? `Auto: complete ${courseById.get(b.criteriaCourseId ?? "")?.Name ?? "a course"}`
                            : `Auto: complete ${b.criteriaCount} courses`}
                        {b.bonusPoints > 0 ? ` · +${b.bonusPoints} pts` : ""}
                      </div>
                      <div className="mt-2 flex gap-1">
                        <form action={badgeAction} className="inline">
                          <input type="hidden" name="team" value={team.Id} />
                          <input type="hidden" name="badgeId" value={b.id} />
                          <input type="hidden" name="op" value="toggle" />
                          <input type="hidden" name="active" value={b.active ? "0" : "1"} />
                          <button type="submit" className={lcBtnGhost}>
                            {b.active ? "Disable" : "Enable"}
                          </button>
                        </form>
                        <form action={badgeAction} className="inline">
                          <input type="hidden" name="team" value={team.Id} />
                          <input type="hidden" name="badgeId" value={b.id} />
                          <input type="hidden" name="op" value="delete" />
                          <button type="submit" className={lcBtnGhost}>
                            Delete
                          </button>
                        </form>
                      </div>
                    </div>
                  </LcPanel>
                ))}
              </div>
            ) : (
              <LcEmpty title="No badges yet">Create one on the left — manual recognition or auto-earned on course completion.</LcEmpty>
            )}
          </section>

          <section>
            <h2 className="text-lg font-bold text-lc-ink mb-3">Award a badge or points</h2>
            <LcPanel>
              <form action={award} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="team" value={team.Id} />
                <label className="text-sm flex-1 min-w-52">
                  <span className="text-xs font-semibold text-lc-muted">Member</span>
                  <select name="userId" required className={`${lcSelectCls} mt-1`} defaultValue="">
                    <option value="" disabled>
                      Choose…
                    </option>
                    {members.map((m) => (
                      <option key={m.Id} value={m.Id}>
                        {m.FirstName} {m.LastName}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  <span className="text-xs font-semibold text-lc-muted">Badge</span>
                  <select name="badgeId" className={`${lcSelectCls} mt-1`} defaultValue="">
                    <option value="">— none —</option>
                    {badges.filter((b) => b.active).map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.emoji} {b.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  <span className="text-xs font-semibold text-lc-muted">Or points</span>
                  <input type="number" name="points" min={0} defaultValue={0} className={`${lcInputCls} !w-24 mt-1`} />
                </label>
                <input type="text" name="reason" placeholder="Reason (optional)" className={`${lcInputCls} flex-1 min-w-40`} />
                <button type="submit" className={lcBtnPrimary}>
                  Award
                </button>
              </form>
            </LcPanel>
          </section>

          <section>
            <h2 className="text-lg font-bold text-lc-ink mb-3">Recent awards</h2>
            {awards.length ? (
              <LcTable
                head={
                  <>
                    <th>Member</th>
                    <th>Award</th>
                    <th>Points</th>
                    <th>By</th>
                    <th></th>
                  </>
                }
              >
                {awards.map((a) => {
                  const m = memberById.get(a.litmosUserId);
                  const b = a.badgeId ? badgeById.get(a.badgeId) : null;
                  return (
                    <tr key={a.id}>
                      <td className="font-medium text-lc-ink">{m ? `${m.FirstName} ${m.LastName}` : a.litmosUserId}</td>
                      <td>{b ? <LcBadge tone="purple">{b.emoji} {b.title}</LcBadge> : <span className="text-lc-muted">{a.reason ?? "Bonus points"}</span>}</td>
                      <td className="text-lc-muted">{a.points ? `+${a.points}` : "—"}</td>
                      <td className="text-lc-muted text-xs">{a.awardedBy}</td>
                      <td className="text-right">
                        <form action={revoke} className="inline">
                          <input type="hidden" name="team" value={team.Id} />
                          <input type="hidden" name="awardId" value={a.id} />
                          <button type="submit" className={lcBtnGhost}>
                            Revoke
                          </button>
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </LcTable>
            ) : (
              <LcEmpty title="No awards yet" />
            )}
          </section>
        </div>
      </div>
    </>
  );
}
