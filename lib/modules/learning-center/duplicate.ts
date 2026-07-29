// Course duplication: Content Library → Team Library. Litmos has NO whole-
// course copy API, so this orchestrates the documented primitives:
//   1. POST /bulkimports/courses — create a new course shell carrying the
//      source's settings (due dates, compliance) under a fresh CourseCode
//   2. resolve the new course by that code (bulk import is asynchronous)
//   3. POST /courses/{new}/modules/{copy|link|mirror} — bring the source's
//      modules across (copy = independent, link = shared completion,
//      mirror = content stays synced)
//   4. POST /teams/{team}/courses with CourseTeamLibrary=true — place the
//      duplicate in the team's optional library
// Progress and failures land in lc_course_copies so a half-finished copy is
// visible and explainable rather than silent.

import { randomUUID } from "crypto";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/platform/db";
import { lcCourseCopies, type LcCourseCopyRow } from "./schema";
import type { LitmosSource, ModuleAttachMode } from "./source";

const RESOLVE_ATTEMPTS = 10;
const RESOLVE_DELAY_MS = 3_000;

// New-course code: recognizable prefix + slug + time suffix, unique per tenant.
export function duplicateCourseCode(sourceName: string, teamName: string, now = Date.now()): string {
  const slug = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 18);
  return `TL-${slug(teamName)}-${slug(sourceName)}-${now.toString(36)}`.toUpperCase();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function setCopy(id: string, patch: Partial<typeof lcCourseCopies.$inferInsert>): Promise<void> {
  await db.update(lcCourseCopies).set({ ...patch, updatedAt: Date.now() }).where(eq(lcCourseCopies.id, id));
}

export interface DuplicateInput {
  source: LitmosSource;
  teamId: string;
  teamName: string;
  sourceCourseId: string;
  moduleMode: ModuleAttachMode;
  requestedBy: string;
  // Optional setting overrides for the duplicate; anything omitted inherits
  // the source course's configuration.
  titleOverride?: string;
  dueDateSpan?: number | null;
  complianceDateSpan?: number | null;
  complianceRetake?: boolean;
}

export interface DuplicateResult {
  copyId: string;
  status: string;
  newCourseId: string | null;
  error?: string;
}

export async function duplicateCourseToTeamLibrary(input: DuplicateInput): Promise<DuplicateResult> {
  const { source } = input;
  const now = Date.now();
  const copyId = randomUUID();

  const details = await source.getCourseDetails(input.sourceCourseId);
  if (!details) throw new Error("Source course not found.");
  if (!details.Active) throw new Error("Only Active courses can be duplicated into a team library.");

  const newTitle = input.titleOverride?.trim() || `${details.Name} (${input.teamName})`;
  const newCode = duplicateCourseCode(details.Name, input.teamName, now);

  // The bulk-import API caps day spans at 100; a source course configured with
  // a longer cycle in the Litmos UI must be clamped or the import is rejected.
  const clampSpan = (v: number | null | undefined): { value: number | null; clamped: boolean } => {
    if (v == null) return { value: null, clamped: false };
    return v > 100 ? { value: 100, clamped: true } : { value: v, clamped: false };
  };
  const dueSpan = clampSpan(input.dueDateSpan !== undefined ? input.dueDateSpan : (details.DueDateSpan ?? null));
  const complianceSpan = clampSpan(input.complianceDateSpan !== undefined ? input.complianceDateSpan : (details.ComplianceDateSpan ?? null));
  const clampNotes: string[] = [];
  if (dueSpan.clamped) clampNotes.push("due-date span clamped to the API's 100-day cap");
  if (complianceSpan.clamped) clampNotes.push("compliance span clamped to the API's 100-day cap — extend it in the Litmos UI if needed");

  await db.insert(lcCourseCopies).values({
    id: copyId,
    teamId: input.teamId,
    sourceCourseId: input.sourceCourseId,
    sourceCourseName: details.Name,
    newCourseCode: newCode,
    newCourseName: newTitle,
    moduleMode: input.moduleMode,
    status: "pending",
    requestedBy: input.requestedBy,
    createdAt: now,
    updatedAt: now,
  });

  try {
    // 1. Create the shell with inherited (or overridden) settings. The
    //    duplicate stays OUT of the account-wide content library — it belongs
    //    to this team's library only.
    await source.upsertCourseShell({
      CourseTitle: newTitle,
      CourseCode: newCode,
      Description: details.Description ?? "",
      Active: true,
      ContentLibrary: false,
      DueDate: details.DueDate ?? null,
      DueDateSpan: dueSpan.value,
      ComplianceDateSpan: complianceSpan.value,
      ComplianceRetake: input.complianceRetake !== undefined ? input.complianceRetake : (details.ComplianceRetake ?? false),
    });

    // 2. Bulk import is async in live Litmos — poll until the code resolves.
    let newCourseId: string | null = null;
    for (let attempt = 0; attempt < RESOLVE_ATTEMPTS; attempt++) {
      const found = await source.findCourseByCode(newCode);
      if (found) {
        newCourseId = found.Id;
        break;
      }
      if (attempt < RESOLVE_ATTEMPTS - 1) await sleep(source.mode === "demo" ? 0 : RESOLVE_DELAY_MS);
    }
    if (!newCourseId) {
      await setCopy(copyId, { status: "failed", detail: "Course shell was submitted but never appeared under its code — check the Litmos bulk import log." });
      return { copyId, status: "failed", newCourseId: null, error: "Course shell did not resolve." };
    }
    await setCopy(copyId, { status: "shell_created", newCourseId });

    // 3. Bring modules across.
    const modules = await source.listCourseModules(input.sourceCourseId);
    if (modules.length) {
      await source.attachModules(
        newCourseId,
        modules.map((m) => m.Id),
        input.moduleMode,
      );
    }
    await setCopy(copyId, {
      status: "modules_attached",
      detail: [`${modules.length} module(s) ${input.moduleMode}ed.`, ...clampNotes].join(" "),
    });

    // 4. Place in the team's library (optional/self-signup, not force-assigned).
    await input.source.assignCoursesToTeam(input.teamId, [newCourseId], { library: true, includeSubteams: false });
    await setCopy(copyId, { status: "in_library" });

    return { copyId, status: "in_library", newCourseId };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await setCopy(copyId, { status: "failed", detail: message });
    return { copyId, status: "failed", newCourseId: null, error: message };
  }
}

export async function listCopies(scopeTeamIds: string[] | null, limit = 100): Promise<LcCourseCopyRow[]> {
  if (scopeTeamIds === null) {
    return db.select().from(lcCourseCopies).orderBy(desc(lcCourseCopies.createdAt)).limit(limit);
  }
  if (!scopeTeamIds.length) return [];
  return db.select().from(lcCourseCopies).where(inArray(lcCourseCopies.teamId, scopeTeamIds)).orderBy(desc(lcCourseCopies.createdAt)).limit(limit);
}

export async function getCopyByCourseId(newCourseId: string): Promise<LcCourseCopyRow | null> {
  const rows = await db.select().from(lcCourseCopies).where(eq(lcCourseCopies.newCourseId, newCourseId)).limit(1);
  return rows[0] ?? null;
}
