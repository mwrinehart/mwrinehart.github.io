// Course library: browse every ACTIVE course in the Content Library and
// duplicate it into the selected team's library (Litmos has no whole-course
// copy API — the dashboard orchestrates shell creation + module copy/link/
// mirror + library placement, with progress tracked per copy). Duplicated
// courses get a settings page at ./[id].

import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getAdminContext, assertTeamInScope, selectedTeam, teamName } from "@/lib/modules/learning-center/context";
import { writeAudit } from "@/lib/modules/learning-center/audit";
import { buildTeamTree, flattenTeamTree } from "@/lib/modules/learning-center/scope";
import { duplicateCourseToTeamLibrary, listCopies } from "@/lib/modules/learning-center/duplicate";
import type { ModuleAttachMode } from "@/lib/modules/learning-center/source";
import { Poster } from "@/components/learning-center/Poster";
import { TeamPicker } from "@/components/learning-center/TeamPicker";
import { LcBadge, LcEmpty, LcFlash, LcPageHeader, LcTable, lcBtnGhost, lcBtnPrimary, lcSelectCls } from "@/components/learning-center/ui";

function back(teamId: string, extra: Record<string, string>): never {
  const q = new URLSearchParams({ team: teamId, ...extra });
  redirect(`/learning-center/admin/library?${q.toString()}`);
}

const COPY_STATUS_LABEL: Record<string, { label: string; tone: string }> = {
  pending: { label: "Starting…", tone: "neutral" },
  shell_created: { label: "Shell created", tone: "ink" },
  modules_attached: { label: "Modules attached", tone: "ink" },
  in_library: { label: "In team library", tone: "purple" },
  failed: { label: "Failed", tone: "amber" },
};

export default async function LibraryPage({
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
        <LcPageHeader title="Course library" />
        <LcEmpty title="No teams in your scope" />
      </>
    );
  }

  const [allCourses, teamCourses, copies] = await Promise.all([
    ctx.source.listCourses(),
    ctx.source.listTeamCourses(team.Id),
    listCopies(ctx.isOwner ? null : ctx.scopeIds, 25),
  ]);
  const activeCourses = allCourses.filter((c) => c.Active);
  const libraryCourses = teamCourses.filter((c) => c.CourseTeamLibrary);
  const copiedCourseIds = new Set(copies.filter((c) => c.newCourseId).map((c) => c.newCourseId as string));
  const teamOptions = flattenTeamTree(buildTeamTree(ctx.allTeams, ctx.scopeIds));

  async function duplicate(formData: FormData) {
    "use server";
    const c = await getAdminContext();
    const teamId = String(formData.get("team") ?? "");
    assertTeamInScope(c, teamId);
    const sourceCourseId = String(formData.get("courseId") ?? "");
    const mode = String(formData.get("mode") ?? "copy") as ModuleAttachMode;
    if (!["copy", "link", "mirror"].includes(mode)) back(teamId, { error: "Invalid module mode." });
    let result;
    try {
      result = await duplicateCourseToTeamLibrary({
        source: c.source,
        teamId,
        teamName: teamName(c, teamId),
        sourceCourseId,
        moduleMode: mode,
        requestedBy: c.session.email,
      });
    } catch (e) {
      back(teamId, { error: e instanceof Error ? e.message : "Duplication failed." });
    }
    await writeAudit(c.session, {
      action: "course_duplicated_to_team_library",
      targetType: "copy",
      targetId: result.copyId,
      targetLabel: String(formData.get("label") ?? sourceCourseId),
      teamId,
      detail: `Modules: ${mode}. Result: ${result.status}${result.error ? ` (${result.error})` : ""}`,
    });
    revalidatePath("/learning-center/admin/library");
    if (result.status === "in_library" && result.newCourseId) {
      redirect(
        `/learning-center/admin/library/${encodeURIComponent(result.newCourseId)}?team=${encodeURIComponent(teamId)}&ok=${encodeURIComponent(
          "Course duplicated into your team library — review its settings below.",
        )}`,
      );
    }
    back(teamId, { error: `Duplication ${result.status}: ${result.error ?? "see copy history below."}` });
  }

  async function removeFromLibrary(formData: FormData) {
    "use server";
    const c = await getAdminContext();
    const teamId = String(formData.get("team") ?? "");
    assertTeamInScope(c, teamId);
    const courseId = String(formData.get("courseId") ?? "");
    const label = String(formData.get("label") ?? courseId);
    try {
      await c.source.unassignCoursesFromTeam(teamId, [courseId], true);
    } catch (e) {
      back(teamId, { error: e instanceof Error ? e.message : "Remove failed." });
    }
    await writeAudit(c.session, { action: "course_removed_from_team_library", targetType: "course", targetId: courseId, targetLabel: label, teamId });
    revalidatePath("/learning-center/admin/library");
    back(teamId, { ok: `"${label}" removed from the team library.` });
  }

  return (
    <>
      <LcPageHeader
        title="Course library"
        subtitle={`Duplicate any Active course from the Content Library into ${team.Name}'s library, then manage the copy's settings.`}
        action={<TeamPicker teams={teamOptions} selectedId={team.Id} />}
      />
      <LcFlash ok={params.ok} error={params.error} />

      <section className="mb-10">
        <h2 className="text-lg font-bold text-lc-ink mb-1">Your team library ({libraryCourses.length})</h2>
        <p className="text-xs text-lc-muted mb-4">Optional self-signup courses visible to {team.Name} members in their Learning Center.</p>
        {libraryCourses.length ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {libraryCourses.map((c) => (
              <div key={c.Id} className="rounded-2xl border border-lc-line p-3">
                <Poster courseId={c.Id} title={c.Name} tag={copiedCourseIds.has(c.Id) ? "Team copy" : undefined} />
                <div className="mt-3 flex items-center justify-between gap-2">
                  <div className="text-xs text-lc-muted truncate">{c.Code}</div>
                  <div className="flex gap-1 shrink-0">
                    {copiedCourseIds.has(c.Id) && (
                      <Link href={`/learning-center/admin/library/${encodeURIComponent(c.Id)}?team=${encodeURIComponent(team.Id)}`} className={lcBtnGhost}>
                        Settings
                      </Link>
                    )}
                    <form action={removeFromLibrary} className="inline">
                      <input type="hidden" name="team" value={team.Id} />
                      <input type="hidden" name="courseId" value={c.Id} />
                      <input type="hidden" name="label" value={c.Name} />
                      <button type="submit" className={lcBtnGhost}>
                        Remove
                      </button>
                    </form>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <LcEmpty title="Your team library is empty">Duplicate a course from the Content Library below to get started.</LcEmpty>
        )}
      </section>

      <section className="mb-10">
        <h2 className="text-lg font-bold text-lc-ink mb-1">Content Library — Active courses ({activeCourses.length})</h2>
        <p className="text-xs text-lc-muted mb-4">
          Duplicating creates an independent course shell with the source&apos;s settings, brings its modules across (copy = independent tracking,
          link = shared completion, mirror = content stays synced), and files it in your team library.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {activeCourses.map((c) => (
            <div key={c.Id} className="rounded-2xl border border-lc-line p-3 flex flex-col">
              <Poster courseId={c.Id} title={c.Name} tag={c.Tags?.[0]} />
              <form action={duplicate} className="mt-3 flex items-center gap-2">
                <input type="hidden" name="team" value={team.Id} />
                <input type="hidden" name="courseId" value={c.Id} />
                <input type="hidden" name="label" value={c.Name} />
                <select name="mode" className={`${lcSelectCls} !w-auto flex-1 text-xs`} defaultValue="copy" title="How modules are brought across">
                  <option value="copy">Copy modules (independent)</option>
                  <option value="link">Link modules (shared completion)</option>
                  <option value="mirror">Mirror modules (content synced)</option>
                </select>
                <button type="submit" className={`${lcBtnPrimary} !px-3 !py-1.5 text-xs shrink-0`}>
                  Duplicate
                </button>
              </form>
            </div>
          ))}
        </div>
      </section>

      {copies.length > 0 && (
        <section>
          <h2 className="text-lg font-bold text-lc-ink mb-3">Duplication history</h2>
          <LcTable
            head={
              <>
                <th>Source</th>
                <th>New course</th>
                <th>Team</th>
                <th>Modules</th>
                <th>Status</th>
              </>
            }
          >
            {copies.map((copy) => {
              const s = COPY_STATUS_LABEL[copy.status] ?? { label: copy.status, tone: "neutral" };
              return (
                <tr key={copy.id}>
                  <td className="font-medium text-lc-ink">{copy.sourceCourseName ?? copy.sourceCourseId}</td>
                  <td>
                    {copy.newCourseId ? (
                      <Link
                        href={`/learning-center/admin/library/${encodeURIComponent(copy.newCourseId)}?team=${encodeURIComponent(copy.teamId)}`}
                        className="font-medium text-lc-purple hover:underline"
                      >
                        {copy.newCourseName ?? copy.newCourseCode}
                      </Link>
                    ) : (
                      <span className="text-lc-muted">{copy.newCourseCode}</span>
                    )}
                  </td>
                  <td className="text-lc-muted">{ctx.allTeams.find((t) => t.Id === copy.teamId)?.Name ?? copy.teamId}</td>
                  <td className="text-lc-muted">{copy.moduleMode}</td>
                  <td>
                    <LcBadge tone={s.tone}>{s.label}</LcBadge>
                    {copy.status === "failed" && copy.detail && <div className="text-xs text-lc-muted mt-1 max-w-60">{copy.detail}</div>}
                  </td>
                </tr>
              );
            })}
          </LcTable>
        </section>
      )}
    </>
  );
}
