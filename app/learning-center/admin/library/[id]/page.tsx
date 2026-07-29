// Settings for a duplicated course — the team's own copy. Title, description,
// active flag, due-date and compliance policy all update through the bulk-
// import path (the only course-settings write in the Litmos API). Modules can
// be pulled in from any other Active course (copy/link/mirror), and the course
// can be pulled from or re-added to the team library.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getAdminContext, assertTeamInScope, selectedTeam } from "@/lib/modules/learning-center/context";
import { writeAudit } from "@/lib/modules/learning-center/audit";
import { getCopyByCourseId } from "@/lib/modules/learning-center/duplicate";
import type { ModuleAttachMode } from "@/lib/modules/learning-center/source";
import { Poster } from "@/components/learning-center/Poster";
import { LcBadge, LcFlash, LcPageHeader, LcPanel, lcBtnPrimary, lcBtnSecondary, lcInputCls, lcSelectCls } from "@/components/learning-center/ui";

function back(courseId: string, teamId: string, extra: Record<string, string>): never {
  const q = new URLSearchParams({ team: teamId, ...extra });
  redirect(`/learning-center/admin/library/${encodeURIComponent(courseId)}?${q.toString()}`);
}

export default async function DuplicatedCoursePage({
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

  // Only courses created by this dashboard's duplication flow are editable
  // here, and only by admins whose scope covers the copy's team.
  const copy = await getCopyByCourseId(id);
  if (!copy || !ctx.scopeIds.includes(copy.teamId)) notFound();

  const details = await ctx.source.getCourseDetails(id);
  if (!details) notFound();
  const modules = await ctx.source.listCourseModules(id);
  const teamCourses = await ctx.source.listTeamCourses(copy.teamId);
  const inLibrary = teamCourses.some((c) => c.Id === id && c.CourseTeamLibrary);
  const allCourses = (await ctx.source.listCourses()).filter((c) => c.Active && c.Id !== id);

  async function saveSettings(formData: FormData) {
    "use server";
    const c = await getAdminContext();
    const cp = await getCopyByCourseId(id);
    if (!cp) notFound();
    assertTeamInScope(c, cp.teamId);
    const d = await c.source.getCourseDetails(id);
    if (!d?.Code) back(id, cp.teamId, { error: "Course code missing — settings can't be updated via the API." });
    const title = String(formData.get("title") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim();
    const active = formData.get("active") === "on";
    const dueMode = String(formData.get("dueMode") ?? "none");
    const span = Number(formData.get("dueSpan") ?? "");
    const fixed = String(formData.get("dueFixed") ?? "").trim();
    const compliance = formData.get("compliance") === "on";
    const complianceSpan = Number(formData.get("complianceSpan") ?? "");
    const retake = formData.get("retake") === "on";
    if (!title) back(id, cp.teamId, { error: "Title is required." });
    try {
      await c.source.upsertCourseShell({
        CourseTitle: title,
        CourseCode: d.Code,
        Description: description,
        Active: active,
        DueDate: dueMode === "fixed" && fixed ? fixed : null,
        DueDateSpan: dueMode === "span" && Number.isFinite(span) && span > 0 ? Math.min(100, Math.round(span)) : null,
        ComplianceDateSpan: compliance && Number.isFinite(complianceSpan) && complianceSpan > 0 ? Math.min(100, Math.round(complianceSpan)) : null,
        ComplianceRetake: compliance ? retake : false,
      });
    } catch (e) {
      back(id, cp.teamId, { error: e instanceof Error ? e.message : "Update failed." });
    }
    await writeAudit(c.session, {
      action: "duplicated_course_settings_updated",
      targetType: "course",
      targetId: id,
      targetLabel: title,
      teamId: cp.teamId,
    });
    revalidatePath(`/learning-center/admin/library/${id}`);
    back(id, cp.teamId, { ok: "Settings submitted (Litmos processes course updates as a bulk-import job)." });
  }

  async function addModules(formData: FormData) {
    "use server";
    const c = await getAdminContext();
    const cp = await getCopyByCourseId(id);
    if (!cp) notFound();
    assertTeamInScope(c, cp.teamId);
    const fromCourseId = String(formData.get("fromCourse") ?? "");
    const mode = String(formData.get("mode") ?? "copy") as ModuleAttachMode;
    if (!fromCourseId || !["copy", "link", "mirror"].includes(mode)) back(id, cp.teamId, { error: "Pick a source course and mode." });
    // Resolve modules outside the try so an empty-modules redirect isn't caught
    // and re-surfaced as the literal "NEXT_REDIRECT" error (redirect() throws).
    let mods;
    try {
      mods = await c.source.listCourseModules(fromCourseId);
    } catch (e) {
      back(id, cp.teamId, { error: e instanceof Error ? e.message : "Could not read the source course's modules." });
    }
    if (!mods.length) back(id, cp.teamId, { error: "That course has no modules to bring across." });
    try {
      await c.source.attachModules(id, mods.map((m) => m.Id), mode);
    } catch (e) {
      back(id, cp.teamId, { error: e instanceof Error ? e.message : "Module attach failed." });
    }
    const count = mods.length;
    await writeAudit(c.session, {
      action: "modules_attached_to_duplicate",
      targetType: "course",
      targetId: id,
      targetLabel: cp.newCourseName ?? id,
      teamId: cp.teamId,
      detail: `${count} module(s) ${mode}ed from ${fromCourseId}`,
    });
    revalidatePath(`/learning-center/admin/library/${id}`);
    back(id, cp.teamId, { ok: `${count} module(s) attached.` });
  }

  async function toggleLibrary(formData: FormData) {
    "use server";
    const c = await getAdminContext();
    const cp = await getCopyByCourseId(id);
    if (!cp) notFound();
    assertTeamInScope(c, cp.teamId);
    const place = formData.get("place") === "1";
    try {
      if (place) await c.source.assignCoursesToTeam(cp.teamId, [id], { library: true, includeSubteams: false });
      else await c.source.unassignCoursesFromTeam(cp.teamId, [id], true);
    } catch (e) {
      back(id, cp.teamId, { error: e instanceof Error ? e.message : "Library update failed." });
    }
    await writeAudit(c.session, {
      action: place ? "duplicate_added_to_team_library" : "duplicate_removed_from_team_library",
      targetType: "course",
      targetId: id,
      targetLabel: cp.newCourseName ?? id,
      teamId: cp.teamId,
    });
    revalidatePath(`/learning-center/admin/library/${id}`);
    back(id, cp.teamId, { ok: place ? "Added to the team library." : "Removed from the team library." });
  }

  return (
    <>
      <div className="mb-4">
        <Link href={`/learning-center/admin/library?team=${encodeURIComponent(copy.teamId)}`} className="text-sm font-semibold text-lc-purple hover:underline">
          ← Course library
        </Link>
      </div>
      <LcPageHeader
        title={details.Name}
        subtitle={
          <>
            Your team&apos;s copy of <span className="font-semibold">{copy.sourceCourseName}</span> · Code {details.Code} · Modules brought across via{" "}
            <span className="font-semibold">{copy.moduleMode}</span>
          </>
        }
        action={inLibrary ? <LcBadge tone="purple">In team library</LcBadge> : <LcBadge tone="amber">Not in library</LcBadge>}
      />
      <LcFlash ok={sp.ok} error={sp.error} />

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <LcPanel>
            <h3 className="font-bold text-lc-ink mb-3">Course settings</h3>
            <form action={saveSettings} className="space-y-3">
              <label className="block text-sm">
                <span className="font-semibold text-lc-ink">Title</span>
                <input type="text" name="title" defaultValue={details.Name} required className={`${lcInputCls} mt-1`} />
              </label>
              <label className="block text-sm">
                <span className="font-semibold text-lc-ink">Description</span>
                <textarea name="description" defaultValue={details.Description ?? ""} rows={3} className={`${lcInputCls} mt-1`} />
              </label>
              <label className="flex items-center gap-2 text-sm text-lc-ink">
                <input type="checkbox" name="active" defaultChecked={details.Active} className="accent-lc-purple" /> Active (learners can access it)
              </label>

              <div className="border-t border-lc-line pt-3">
                <div className="text-sm font-semibold text-lc-ink mb-2">Due date</div>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm text-lc-ink">
                    <input type="radio" name="dueMode" value="none" defaultChecked={!details.DueDate && details.DueDateSpan == null} className="accent-lc-purple" />
                    None
                  </label>
                  <label className="flex items-center gap-2 text-sm text-lc-ink">
                    <input type="radio" name="dueMode" value="span" defaultChecked={details.DueDateSpan != null} className="accent-lc-purple" />
                    Within
                    <input type="number" name="dueSpan" min={1} max={100} defaultValue={details.DueDateSpan ?? 14} className={`${lcInputCls} !w-20`} />
                    days of assignment
                  </label>
                  <label className="flex items-center gap-2 text-sm text-lc-ink">
                    <input type="radio" name="dueMode" value="fixed" defaultChecked={!!details.DueDate} className="accent-lc-purple" />
                    Fixed date
                    <input type="date" name="dueFixed" defaultValue={details.DueDate?.slice(0, 10) ?? ""} className={`${lcInputCls} !w-40`} />
                  </label>
                </div>
              </div>

              <div className="border-t border-lc-line pt-3">
                <div className="text-sm font-semibold text-lc-ink mb-2">Compliance</div>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm text-lc-ink">
                    <input type="checkbox" name="compliance" defaultChecked={details.ComplianceDateSpan != null} className="accent-lc-purple" />
                    Compliance course — compliant for
                    <input type="number" name="complianceSpan" min={1} max={100} defaultValue={details.ComplianceDateSpan ?? 90} className={`${lcInputCls} !w-20`} />
                    days
                  </label>
                  <label className="flex items-center gap-2 text-sm text-lc-ink">
                    <input type="checkbox" name="retake" defaultChecked={details.ComplianceRetake ?? false} className="accent-lc-purple" /> Automatic retake before expiry
                  </label>
                </div>
              </div>

              <button type="submit" className={lcBtnPrimary}>
                Save settings
              </button>
            </form>
          </LcPanel>

          <LcPanel>
            <h3 className="font-bold text-lc-ink mb-1">Modules ({modules.length})</h3>
            <p className="text-xs text-lc-muted mb-3">Module content itself is edited in Litmos; here you can pull modules in from other courses.</p>
            <ol className="space-y-1.5 mb-4">
              {modules.map((m, i) => (
                <li key={`${m.Id}-${i}`} className="flex items-center gap-3 rounded-lg border border-lc-line px-3 py-2 text-sm">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-lc-tint text-xs font-bold text-lc-purple">{i + 1}</span>
                  <span className="font-medium text-lc-ink">{m.Name}</span>
                </li>
              ))}
              {!modules.length && <li className="text-sm text-lc-muted">No modules yet — attach some below.</li>}
            </ol>
            <form action={addModules} className="flex flex-wrap items-center gap-2">
              <select name="fromCourse" required className={`${lcSelectCls} !w-auto flex-1 min-w-52`} defaultValue="">
                <option value="" disabled>
                  Bring modules from…
                </option>
                {allCourses.map((c) => (
                  <option key={c.Id} value={c.Id}>
                    {c.Name}
                  </option>
                ))}
              </select>
              <select name="mode" className={`${lcSelectCls} !w-auto`} defaultValue="copy">
                <option value="copy">Copy</option>
                <option value="link">Link</option>
                <option value="mirror">Mirror</option>
              </select>
              <button type="submit" className={lcBtnSecondary}>
                Attach modules
              </button>
            </form>
          </LcPanel>
        </div>

        <div className="space-y-4">
          <Poster courseId={details.Id} title={details.Name} tag="Team copy" />
          <LcPanel>
            <h3 className="font-bold text-lc-ink mb-1">Team library placement</h3>
            <p className="text-xs text-lc-muted mb-3">
              {inLibrary
                ? "Members can find and self-enroll in this course from their Learning Center."
                : "Currently hidden from members — add it back to the library to make it self-enrollable."}
            </p>
            <form action={toggleLibrary}>
              <input type="hidden" name="place" value={inLibrary ? "0" : "1"} />
              <button type="submit" className={inLibrary ? lcBtnSecondary : lcBtnPrimary}>
                {inLibrary ? "Remove from team library" : "Add to team library"}
              </button>
            </form>
          </LcPanel>
        </div>
      </div>
    </>
  );
}
