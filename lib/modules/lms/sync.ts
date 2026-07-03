// Litmos → local mirror sync. Each run is ledgered in lms_sync_runs (mirroring
// behavior/connectors.ts runSync): a `running` row up front, finalized with a
// JSON summary. Steps are individually try/caught so one failing endpoint
// degrades the run to `partial` instead of aborting it. Rule events fire only
// once an org has a prior successful sync, so the first import of an existing
// tenant can't back-blast "learner.created" for the whole directory.

import { randomUUID } from "crypto";
import { and, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { db } from "@/lib/platform/db";
import { orgs } from "@/lib/platform/db/schema";
import {
  getLitmosCreds,
  listLitmosCourses,
  listLitmosTeams,
  listLitmosTeamUsers,
  listLitmosUsers,
  litmosGetAll,
  type LitmosCreds,
} from "@/lib/platform/litmos";
import { lmsAssignments, lmsCourses, lmsLearners, lmsSyncRuns, lmsTeamMembers, lmsTeams, type LmsSyncRunRow } from "./schema";
import { OPEN_ASSIGNMENT_STATUSES, type LmsEvent } from "./types";
import { fireLmsEvent } from "./rules";

// Bound rule firing on a pathological diff (e.g. a wiped mirror re-importing an
// entire tenant would otherwise fire thousands of events).
const EVENT_CAP = 200;

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function str(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number") return String(v);
  return null;
}

function parseTs(v: unknown): number | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
}

export async function lmsConfigured(orgId: string): Promise<boolean> {
  return (await getLitmosCreds(orgId)) !== null;
}

export async function listLmsSyncRuns(orgId: string, limit = 10): Promise<LmsSyncRunRow[]> {
  return db.select().from(lmsSyncRuns).where(eq(lmsSyncRuns.orgId, orgId)).orderBy(desc(lmsSyncRuns.startedAt)).limit(limit);
}

interface NewLearner {
  email: string | null;
  name: string | null;
  litmosUserId: string;
}

// ─── step: users ──────────────────────────────────────────────────────────────

async function syncUsers(orgId: string, creds: LitmosCreds, now: number): Promise<{ count: number; newLearners: NewLearner[] }> {
  let rows: Record<string, unknown>[];
  try {
    rows = await listLitmosUsers(creds); // /users/details (richer record)
  } catch {
    rows = await litmosGetAll(creds, "/users"); // details endpoint not enabled on all tiers
  }

  const existing = new Set(
    (await db.select({ litmosId: lmsLearners.litmosId }).from(lmsLearners).where(eq(lmsLearners.orgId, orgId))).map((r) => r.litmosId),
  );

  const seen = new Set<string>();
  const newLearners: NewLearner[] = [];
  for (const row of rows) {
    const litmosId = str(row.Id);
    if (!litmosId || seen.has(litmosId)) continue;
    seen.add(litmosId);
    const email = str(row.Email)?.toLowerCase() ?? null;
    const firstName = str(row.FirstName);
    const lastName = str(row.LastName);
    const joined = [firstName, lastName].filter(Boolean).join(" ");
    const fullName = str(row.FullName) ?? (joined || null);
    const patch = {
      email,
      firstName,
      lastName,
      fullName,
      active: row.Active !== false,
      litmosCreatedAt: parseTs(row.CreatedDate),
      lastLoginAt: parseTs(row.LastLogin),
      syncedAt: now,
    };
    await db
      .insert(lmsLearners)
      .values({ id: randomUUID(), orgId, litmosId, createdAt: now, ...patch })
      .onConflictDoUpdate({ target: [lmsLearners.orgId, lmsLearners.litmosId], set: patch });
    if (!existing.has(litmosId)) newLearners.push({ email, name: fullName, litmosUserId: litmosId });
  }

  // Anyone in the mirror that Litmos no longer returns is deactivated (Litmos
  // deletes/deactivates never reach us as events — the diff is the signal).
  const missing = [...existing].filter((id) => !seen.has(id));
  if (missing.length) {
    await db
      .update(lmsLearners)
      .set({ active: false, syncedAt: now })
      .where(and(eq(lmsLearners.orgId, orgId), inArray(lmsLearners.litmosId, missing)));
  }

  return { count: seen.size, newLearners };
}

// ─── step: teams ──────────────────────────────────────────────────────────────

async function syncTeams(orgId: string, creds: LitmosCreds, now: number): Promise<number> {
  const rows = await listLitmosTeams(creds);
  let count = 0;
  for (const row of rows) {
    const litmosId = str(row.Id);
    const name = str(row.Name);
    if (!litmosId || !name) continue;
    count++;
    const patch = { name, description: str(row.Description), parentLitmosId: str(row.ParentTeamId), syncedAt: now };
    await db
      .insert(lmsTeams)
      .values({ id: randomUUID(), orgId, litmosId, createdAt: now, ...patch })
      .onConflictDoUpdate({ target: [lmsTeams.orgId, lmsTeams.litmosId], set: patch });
  }
  return count;
}

// ─── step: memberships ───────────────────────────────────────────────────────

interface JoinedPair {
  teamLitmosId: string;
  learnerLitmosId: string;
}

async function syncMemberships(
  orgId: string,
  creds: LitmosCreds,
  now: number,
  errors: string[],
): Promise<{ count: number; joined: JoinedPair[] }> {
  // Walk the mirror's teams (just upserted by the teams step) so a partial
  // teams failure still syncs whatever teams we know about.
  const teams = await db.select({ litmosId: lmsTeams.litmosId }).from(lmsTeams).where(eq(lmsTeams.orgId, orgId));
  let count = 0;
  const joined: JoinedPair[] = [];
  for (const team of teams) {
    try {
      const members = await listLitmosTeamUsers(creds, team.litmosId);
      const present: string[] = [];
      for (const m of members) {
        const learnerLitmosId = str(m.Id);
        if (!learnerLitmosId) continue;
        present.push(learnerLitmosId);
        const inserted = await db
          .insert(lmsTeamMembers)
          .values({ id: randomUUID(), orgId, teamLitmosId: team.litmosId, learnerLitmosId, syncedAt: now })
          .onConflictDoNothing()
          .returning({ id: lmsTeamMembers.id });
        if (inserted.length) joined.push({ teamLitmosId: team.litmosId, learnerLitmosId });
      }
      count += present.length;
      const stale = and(eq(lmsTeamMembers.orgId, orgId), eq(lmsTeamMembers.teamLitmosId, team.litmosId));
      await db
        .delete(lmsTeamMembers)
        .where(present.length ? and(stale, notInArray(lmsTeamMembers.learnerLitmosId, present)) : stale);
    } catch (e) {
      errors.push(`memberships(${team.litmosId}): ${errMsg(e)}`);
    }
  }
  return { count, joined };
}

// ─── step: courses ───────────────────────────────────────────────────────────

async function syncCourses(orgId: string, creds: LitmosCreds, now: number): Promise<number> {
  const rows = await listLitmosCourses(creds);
  const existing = new Set(
    (await db.select({ litmosId: lmsCourses.litmosId }).from(lmsCourses).where(eq(lmsCourses.orgId, orgId))).map((r) => r.litmosId),
  );
  const seen = new Set<string>();
  for (const row of rows) {
    const litmosId = str(row.Id);
    const name = str(row.Name);
    if (!litmosId || !name) continue;
    seen.add(litmosId);
    const code = str(row.Code);
    const patch: Partial<typeof lmsCourses.$inferInsert> = {
      name,
      description: str(row.Description),
      code,
      active: row.Active !== false,
      litmosCreatedAt: parseTs(row.CourseCreatedDate) ?? parseTs(row.CreatedDate),
      syncedAt: now,
    };
    // Studio-published courses are tagged by their code; never downgrade a
    // studio row back to "litmos" just because the code shows up plain.
    if (code?.startsWith("studio-")) patch.source = "studio";
    await db
      .insert(lmsCourses)
      .values({ id: randomUUID(), orgId, litmosId, createdAt: now, source: code?.startsWith("studio-") ? "studio" : "litmos", ...patch, name })
      .onConflictDoUpdate({ target: [lmsCourses.orgId, lmsCourses.litmosId], set: patch });
  }

  const missing = [...existing].filter((id) => !seen.has(id));
  if (missing.length) {
    await db
      .update(lmsCourses)
      .set({ active: false, syncedAt: now })
      .where(and(eq(lmsCourses.orgId, orgId), inArray(lmsCourses.litmosId, missing)));
  }

  await recountCourses(orgId);
  return seen.size;
}

// enrolledCount = open + completed assignments; completedCount = completed.
async function recountCourses(orgId: string): Promise<void> {
  const counted = [...OPEN_ASSIGNMENT_STATUSES, "completed"];
  const rows = await db
    .select({
      courseId: lmsAssignments.courseLitmosId,
      enrolled: sql<number>`(count(*) filter (where ${inArray(lmsAssignments.status, counted)}))::int`,
      completed: sql<number>`(count(*) filter (where ${lmsAssignments.status} = 'completed'))::int`,
    })
    .from(lmsAssignments)
    .where(eq(lmsAssignments.orgId, orgId))
    .groupBy(lmsAssignments.courseLitmosId);
  await db.update(lmsCourses).set({ enrolledCount: 0, completedCount: 0 }).where(eq(lmsCourses.orgId, orgId));
  for (const r of rows) {
    await db
      .update(lmsCourses)
      .set({ enrolledCount: r.enrolled, completedCount: r.completed })
      .where(and(eq(lmsCourses.orgId, orgId), eq(lmsCourses.litmosId, r.courseId)));
  }
}

// ─── the run ─────────────────────────────────────────────────────────────────

export async function syncLmsOrg(
  orgId: string,
): Promise<{ courses: number; learners: number; teams: number; memberships: number; newLearners: number; errors: string[] }> {
  const creds = await getLitmosCreds(orgId);
  if (!creds) throw new Error("Litmos not configured");

  // Rule events only fire for orgs with an established mirror — a first sync is
  // an import, not a wave of "new learner" events.
  const prior = await db
    .select({ id: lmsSyncRuns.id })
    .from(lmsSyncRuns)
    .where(and(eq(lmsSyncRuns.orgId, orgId), inArray(lmsSyncRuns.status, ["success", "partial"])))
    .limit(1);
  const fireEvents = prior.length > 0;

  const runId = randomUUID();
  const startedAt = Date.now();
  await db.insert(lmsSyncRuns).values({ id: runId, orgId, status: "running", startedAt });

  const errors: string[] = [];
  const counts = { learners: 0, teams: 0, memberships: 0, courses: 0, newLearners: 0, events: 0 };
  let eventsCapped = false;

  try {
    const now = Date.now();

    let newLearners: NewLearner[] = [];
    try {
      const users = await syncUsers(orgId, creds, now);
      counts.learners = users.count;
      newLearners = users.newLearners;
      counts.newLearners = newLearners.length;
    } catch (e) {
      errors.push(`users: ${errMsg(e)}`);
    }

    try {
      counts.teams = await syncTeams(orgId, creds, now);
    } catch (e) {
      errors.push(`teams: ${errMsg(e)}`);
    }

    let joined: JoinedPair[] = [];
    try {
      const memberships = await syncMemberships(orgId, creds, now, errors);
      counts.memberships = memberships.count;
      joined = memberships.joined;
    } catch (e) {
      errors.push(`memberships: ${errMsg(e)}`);
    }

    try {
      counts.courses = await syncCourses(orgId, creds, now);
    } catch (e) {
      errors.push(`courses: ${errMsg(e)}`);
    }

    if (fireEvents) {
      const fire = async (event: LmsEvent): Promise<void> => {
        if (counts.events >= EVENT_CAP) {
          eventsCapped = true;
          return;
        }
        counts.events++;
        try {
          await fireLmsEvent(orgId, event);
        } catch (e) {
          errors.push(`events: ${errMsg(e)}`);
        }
      };
      for (const l of newLearners) {
        if (!l.email) continue; // rules key on email; nothing to match without one
        await fire({ trigger: "learner.created", learner: { email: l.email, name: l.name, litmosUserId: l.litmosUserId, teamIds: [] } });
      }
      if (joined.length) {
        const learnerRows = await db
          .select({ litmosId: lmsLearners.litmosId, email: lmsLearners.email, fullName: lmsLearners.fullName })
          .from(lmsLearners)
          .where(eq(lmsLearners.orgId, orgId));
        const byId = new Map(learnerRows.map((l) => [l.litmosId, l]));
        for (const pair of joined) {
          const learner = byId.get(pair.learnerLitmosId);
          if (!learner?.email) continue;
          await fire({
            trigger: "learner.team_joined",
            learner: { email: learner.email, name: learner.fullName, litmosUserId: pair.learnerLitmosId, teamIds: [pair.teamLitmosId] },
            cycleKey: pair.teamLitmosId,
          });
        }
      }
    }

    await db
      .update(lmsSyncRuns)
      .set({
        status: errors.length ? "partial" : "success",
        finishedAt: Date.now(),
        summary: JSON.stringify({ counts, errors, ...(eventsCapped ? { eventsCapped: true } : {}) }),
        error: null,
      })
      .where(eq(lmsSyncRuns.id, runId));
  } catch (e) {
    await db
      .update(lmsSyncRuns)
      .set({ status: "failed", finishedAt: Date.now(), summary: JSON.stringify({ counts, errors }), error: errMsg(e) })
      .where(eq(lmsSyncRuns.id, runId));
    throw e;
  }

  return {
    courses: counts.courses,
    learners: counts.learners,
    teams: counts.teams,
    memberships: counts.memberships,
    newLearners: counts.newLearners,
    errors,
  };
}

export async function syncAllLmsOrgs(): Promise<{ orgs: number; synced: number; failed: number }> {
  const all = await db.select({ id: orgs.id }).from(orgs);
  let synced = 0;
  let failed = 0;
  for (const org of all) {
    try {
      if (!(await getLitmosCreds(org.id))) continue; // unconfigured orgs are skipped, not failed
      await syncLmsOrg(org.id);
      synced++;
    } catch {
      failed++; // recorded on the org's own lms_sync_runs row; keep the tick going
    }
  }
  return { orgs: all.length, synced, failed };
}
