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
import { getLitmosCreds, listLitmosTeams, listLitmosTeamUsers, litmosGetAllEx, type LitmosCreds } from "@/lib/platform/litmos";
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

async function syncUsers(orgId: string, creds: LitmosCreds, now: number, warnings: string[]): Promise<{ count: number; newLearners: NewLearner[] }> {
  let rows: Record<string, unknown>[];
  let truncated: boolean;
  try {
    ({ rows, truncated } = await litmosGetAllEx(creds, "/users/details")); // richer record
  } catch {
    ({ rows, truncated } = await litmosGetAllEx(creds, "/users")); // details endpoint not enabled on all tiers
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
  // The diff is only trustworthy when we saw the WHOLE directory: skip it on a
  // truncated page-through, and on a suspicious all-empty fetch against a
  // populated mirror, so a bad response can't mass-deactivate a tenant.
  if (truncated) {
    warnings.push(`users: directory truncated at page cap (${seen.size} rows); deactivation diff skipped`);
  } else if (seen.size === 0 && existing.size > 0) {
    warnings.push("users: fetch returned 0 usable rows against a populated mirror; deactivation diff skipped");
  } else {
    const missing = [...existing].filter((id) => !seen.has(id));
    if (missing.length) {
      await db
        .update(lmsLearners)
        .set({ active: false, syncedAt: now })
        .where(and(eq(lmsLearners.orgId, orgId), inArray(lmsLearners.litmosId, missing)));
    }
  }

  return { count: seen.size, newLearners };
}

// ─── step: teams ──────────────────────────────────────────────────────────────

async function syncTeams(orgId: string, creds: LitmosCreds, now: number, warnings: string[]): Promise<number> {
  const rows = await listLitmosTeams(creds);
  const existing = new Set(
    (await db.select({ litmosId: lmsTeams.litmosId }).from(lmsTeams).where(eq(lmsTeams.orgId, orgId))).map((r) => r.litmosId),
  );
  const seen = new Set<string>();
  for (const row of rows) {
    const litmosId = str(row.Id);
    const name = str(row.Name);
    if (!litmosId || !name) continue;
    seen.add(litmosId);
    const patch = { name, description: str(row.Description), parentLitmosId: str(row.ParentTeamId), syncedAt: now };
    await db
      .insert(lmsTeams)
      .values({ id: randomUUID(), orgId, litmosId, createdAt: now, ...patch })
      .onConflictDoUpdate({ target: [lmsTeams.orgId, lmsTeams.litmosId], set: patch });
  }
  // Teams deleted in Litmos leave the mirror too (with their memberships) —
  // otherwise the membership walk 404s on the ghost forever and the UI keeps
  // offering a team that no longer exists. Same populated-mirror sanity guard
  // as users.
  if (seen.size === 0 && existing.size > 0) {
    warnings.push("teams: fetch returned 0 usable rows against a populated mirror; prune skipped");
  } else {
    const missing = [...existing].filter((id) => !seen.has(id));
    if (missing.length) {
      await db.delete(lmsTeamMembers).where(and(eq(lmsTeamMembers.orgId, orgId), inArray(lmsTeamMembers.teamLitmosId, missing)));
      await db.delete(lmsTeams).where(and(eq(lmsTeams.orgId, orgId), inArray(lmsTeams.litmosId, missing)));
    }
  }
  return seen.size;
}

// ─── step: memberships ───────────────────────────────────────────────────────

interface JoinedPair {
  teamLitmosId: string;
  learnerLitmosId: string;
  /** The new membership row's id — the team_joined dedupe cycle key, so leaving and rejoining a team re-fires rules. */
  membershipId: string;
}

async function syncMemberships(
  orgId: string,
  creds: LitmosCreds,
  now: number,
  errors: string[],
  deadline: number,
): Promise<{ count: number; joined: JoinedPair[] }> {
  // Walk the mirror's teams (just upserted by the teams step) so a partial
  // teams failure still syncs whatever teams we know about.
  const teams = await db.select({ litmosId: lmsTeams.litmosId }).from(lmsTeams).where(eq(lmsTeams.orgId, orgId));
  let count = 0;
  let consecutiveFailures = 0;
  const joined: JoinedPair[] = [];
  for (const team of teams) {
    // A hanging Litmos host would otherwise eat 20s per team and stall every
    // other tenant's sync behind this org's tick.
    if (Date.now() > deadline) {
      errors.push("memberships: org time budget exceeded; remaining teams deferred to the next sync");
      break;
    }
    try {
      const members = await listLitmosTeamUsers(creds, team.litmosId);
      consecutiveFailures = 0;
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
        if (inserted.length) joined.push({ teamLitmosId: team.litmosId, learnerLitmosId, membershipId: inserted[0].id });
      }
      count += present.length;
      const stale = and(eq(lmsTeamMembers.orgId, orgId), eq(lmsTeamMembers.teamLitmosId, team.litmosId));
      await db
        .delete(lmsTeamMembers)
        .where(present.length ? and(stale, notInArray(lmsTeamMembers.learnerLitmosId, present)) : stale);
    } catch (e) {
      const msg = errMsg(e);
      // A 404 here means the team vanished between the teams step and now —
      // prune it rather than recording a recurring ghost error.
      if (/ 404\b/.test(msg)) {
        await db.delete(lmsTeamMembers).where(and(eq(lmsTeamMembers.orgId, orgId), eq(lmsTeamMembers.teamLitmosId, team.litmosId)));
        await db.delete(lmsTeams).where(and(eq(lmsTeams.orgId, orgId), eq(lmsTeams.litmosId, team.litmosId)));
        continue;
      }
      errors.push(`memberships(${team.litmosId}): ${msg}`);
      if (++consecutiveFailures >= 3) {
        errors.push("memberships: 3 consecutive failures; remaining teams deferred to the next sync");
        break;
      }
    }
  }
  return { count, joined };
}

// ─── step: courses ───────────────────────────────────────────────────────────

async function syncCourses(orgId: string, creds: LitmosCreds, now: number, warnings: string[]): Promise<number> {
  const { rows, truncated } = await litmosGetAllEx(creds, "/courses");
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

  // Same completeness guards as users: never deactivate the catalog off a
  // truncated or suspiciously empty fetch.
  if (truncated) {
    warnings.push(`courses: catalog truncated at page cap (${seen.size} rows); deactivation diff skipped`);
  } else if (seen.size === 0 && existing.size > 0) {
    warnings.push("courses: fetch returned 0 usable rows against a populated mirror; deactivation diff skipped");
  } else {
    const missing = [...existing].filter((id) => !seen.has(id));
    if (missing.length) {
      await db
        .update(lmsCourses)
        .set({ active: false, syncedAt: now })
        .where(and(eq(lmsCourses.orgId, orgId), inArray(lmsCourses.litmosId, missing)));
    }
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

  // One hung Litmos host must not stall the shared sync job for every other
  // tenant — the memberships walk (one call per team) gets a hard budget.
  const deadline = startedAt + 5 * 60_000;

  try {
    const now = Date.now();

    let newLearners: NewLearner[] = [];
    try {
      const users = await syncUsers(orgId, creds, now, errors);
      counts.learners = users.count;
      newLearners = users.newLearners;
      counts.newLearners = newLearners.length;
    } catch (e) {
      errors.push(`users: ${errMsg(e)}`);
    }

    try {
      counts.teams = await syncTeams(orgId, creds, now, errors);
    } catch (e) {
      errors.push(`teams: ${errMsg(e)}`);
    }

    let joined: JoinedPair[] = [];
    try {
      const memberships = await syncMemberships(orgId, creds, now, errors, deadline);
      counts.memberships = memberships.count;
      joined = memberships.joined;
    } catch (e) {
      errors.push(`memberships: ${errMsg(e)}`);
    }

    try {
      counts.courses = await syncCourses(orgId, creds, now, errors);
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
      // Memberships were just synced, so team-scoped rule conditions see the
      // learner's real teams on both triggers.
      const membershipRows = await db
        .select({ teamLitmosId: lmsTeamMembers.teamLitmosId, learnerLitmosId: lmsTeamMembers.learnerLitmosId })
        .from(lmsTeamMembers)
        .where(eq(lmsTeamMembers.orgId, orgId));
      const teamsByLearner = new Map<string, string[]>();
      for (const m of membershipRows) {
        const teams = teamsByLearner.get(m.learnerLitmosId) ?? [];
        teams.push(m.teamLitmosId);
        teamsByLearner.set(m.learnerLitmosId, teams);
      }
      for (const l of newLearners) {
        if (!l.email) continue; // rules key on email; nothing to match without one
        // cycleKey = the Litmos user id: a rehire (deleted + re-created in
        // Litmos, same email, new id) re-fires onboarding rules.
        await fire({
          trigger: "learner.created",
          learner: { email: l.email, name: l.name, litmosUserId: l.litmosUserId, teamIds: teamsByLearner.get(l.litmosUserId) ?? [] },
          cycleKey: l.litmosUserId,
        });
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
          // cycleKey = the membership row id: leaving and later rejoining the
          // same team creates a new row and legitimately re-fires join rules.
          await fire({
            trigger: "learner.team_joined",
            learner: {
              email: learner.email,
              name: learner.fullName,
              litmosUserId: pair.learnerLitmosId,
              teamIds: teamsByLearner.get(pair.learnerLitmosId) ?? [pair.teamLitmosId],
            },
            cycleKey: pair.membershipId,
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
