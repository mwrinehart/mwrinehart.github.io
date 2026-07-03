// Catalog/directory operations. Reads serve the UI from the local mirror (fast,
// works while Litmos is down); writes go Litmos-first and mirror on success so
// the local copy never claims something Litmos rejected. Writes return
// { ok, error? } instead of throwing — the platform client already embeds
// Litmos's status + response body in its Error messages, so e.message is the
// admin-facing detail.

import { randomUUID } from "crypto";
import { and, asc, eq, ilike, or, type SQL } from "drizzle-orm";
import { db } from "@/lib/platform/db";
import {
  addLitmosTeamUsers,
  createLitmosCourse,
  createLitmosTeam,
  createLitmosUser,
  getLitmosCreds,
  getLitmosUser,
  removeLitmosTeamUser,
  updateLitmosCourse,
  updateLitmosUser,
  type LitmosCreds,
} from "@/lib/platform/litmos";
import {
  lmsCourses,
  lmsLearners,
  lmsTeamMembers,
  lmsTeams,
  type LmsCourseRow,
  type LmsLearnerRow,
  type LmsTeamMemberRow,
  type LmsTeamRow,
} from "./schema";
import { fireLmsEvent } from "./rules";

type WriteResult = { ok: boolean; error?: string };

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function requireCreds(orgId: string): Promise<LitmosCreds> {
  const creds = await getLitmosCreds(orgId);
  if (!creds) throw new Error("Litmos not configured");
  return creds;
}

// ─── mirror reads ─────────────────────────────────────────────────────────────

export async function listLmsCoursesMirror(orgId: string, opts?: { q?: string; activeOnly?: boolean }): Promise<LmsCourseRow[]> {
  const conds: SQL[] = [eq(lmsCourses.orgId, orgId)];
  if (opts?.activeOnly) conds.push(eq(lmsCourses.active, true));
  const q = opts?.q?.trim();
  if (q) conds.push(or(ilike(lmsCourses.name, `%${q}%`), ilike(lmsCourses.code, `%${q}%`))!);
  return db.select().from(lmsCourses).where(and(...conds)).orderBy(asc(lmsCourses.name));
}

export async function listLmsLearnersMirror(
  orgId: string,
  opts?: { q?: string; activeOnly?: boolean; limit?: number },
): Promise<LmsLearnerRow[]> {
  const conds: SQL[] = [eq(lmsLearners.orgId, orgId)];
  if (opts?.activeOnly) conds.push(eq(lmsLearners.active, true));
  const q = opts?.q?.trim();
  if (q) conds.push(or(ilike(lmsLearners.email, `%${q}%`), ilike(lmsLearners.fullName, `%${q}%`))!);
  return db
    .select()
    .from(lmsLearners)
    .where(and(...conds))
    .orderBy(asc(lmsLearners.fullName), asc(lmsLearners.email))
    .limit(opts?.limit ?? 500);
}

export async function listLmsTeamsMirror(orgId: string): Promise<LmsTeamRow[]> {
  return db.select().from(lmsTeams).where(eq(lmsTeams.orgId, orgId)).orderBy(asc(lmsTeams.name));
}

export async function listTeamMembership(orgId: string): Promise<LmsTeamMemberRow[]> {
  return db.select().from(lmsTeamMembers).where(eq(lmsTeamMembers.orgId, orgId));
}

// ─── courses ──────────────────────────────────────────────────────────────────

export async function createCourse(orgId: string, input: { name: string; description?: string; code?: string }): Promise<WriteResult> {
  try {
    const creds = await requireCreds(orgId);
    const created = await createLitmosCourse(creds, { name: input.name, description: input.description, code: input.code });
    const now = Date.now();
    await db.insert(lmsCourses).values({
      id: randomUUID(),
      orgId,
      litmosId: created.Id,
      name: input.name,
      description: input.description ?? null,
      code: input.code ?? null,
      active: true,
      source: "litmos",
      createdAt: now,
      syncedAt: now,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export async function updateCourse(
  orgId: string,
  litmosId: string,
  patch: { name: string; description?: string; code?: string; active?: boolean },
): Promise<WriteResult> {
  try {
    const creds = await requireCreds(orgId);
    await updateLitmosCourse(creds, litmosId, patch);
    // Litmos PUT replaces the record (omitted fields become blank/true) — keep
    // the mirror consistent with what Litmos now holds.
    await db
      .update(lmsCourses)
      .set({
        name: patch.name,
        description: patch.description ?? null,
        code: patch.code ?? null,
        active: patch.active ?? true,
        syncedAt: Date.now(),
      })
      .where(and(eq(lmsCourses.orgId, orgId), eq(lmsCourses.litmosId, litmosId)));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

// ─── learners ─────────────────────────────────────────────────────────────────

export async function createLearner(orgId: string, input: { email: string; firstName: string; lastName: string }): Promise<WriteResult> {
  try {
    const creds = await requireCreds(orgId);
    const email = input.email.trim().toLowerCase();
    const created = await createLitmosUser(creds, {
      email,
      firstName: input.firstName,
      lastName: input.lastName,
      disableMessages: true, // we send our own welcome via the rules engine
    });
    const now = Date.now();
    const fullName = created.FullName || [input.firstName, input.lastName].filter(Boolean).join(" ") || null;
    await db.insert(lmsLearners).values({
      id: randomUUID(),
      orgId,
      litmosId: created.Id,
      email,
      firstName: input.firstName,
      lastName: input.lastName,
      fullName,
      active: true,
      createdAt: now,
      syncedAt: now,
    });
    // Explicit admin action → fire regardless of sync history (unlike syncLmsOrg's
    // first-import guard). cycleKey = the Litmos user id so a rehire (same email,
    // new Litmos account) re-fires onboarding rules.
    await fireLmsEvent(orgId, {
      trigger: "learner.created",
      learner: { email, name: fullName, litmosUserId: created.Id, teamIds: [] },
      cycleKey: created.Id,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export async function setLearnerActive(orgId: string, litmosId: string, active: boolean): Promise<WriteResult> {
  try {
    const creds = await requireCreds(orgId);
    const mirror = (
      await db
        .select()
        .from(lmsLearners)
        .where(and(eq(lmsLearners.orgId, orgId), eq(lmsLearners.litmosId, litmosId)))
    )[0];
    // Litmos PUT replaces the record — fetch the current one and flip Active so
    // no other field is blanked. Fall back to a minimal record built from the
    // mirror when the fetch 404s (record still addressable by id on PUT).
    const current = await getLitmosUser(creds, litmosId);
    let record: Record<string, unknown>;
    if (current) {
      record = { ...current, Active: active };
    } else if (mirror) {
      record = {
        Id: litmosId,
        UserName: mirror.email ?? litmosId,
        FirstName: mirror.firstName ?? "",
        LastName: mirror.lastName ?? "",
        Email: mirror.email ?? "",
        Active: active,
      };
    } else {
      return { ok: false, error: "Learner not found" };
    }
    await updateLitmosUser(creds, litmosId, record);
    await db
      .update(lmsLearners)
      .set({ active, syncedAt: Date.now() })
      .where(and(eq(lmsLearners.orgId, orgId), eq(lmsLearners.litmosId, litmosId)));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

// ─── teams ────────────────────────────────────────────────────────────────────

export async function createTeam(orgId: string, input: { name: string; description?: string; parentLitmosId?: string }): Promise<WriteResult> {
  try {
    const creds = await requireCreds(orgId);
    const created = await createLitmosTeam(creds, { name: input.name, description: input.description, parentTeamId: input.parentLitmosId });
    const now = Date.now();
    await db.insert(lmsTeams).values({
      id: randomUUID(),
      orgId,
      litmosId: created.Id,
      name: input.name,
      description: input.description ?? null,
      parentLitmosId: input.parentLitmosId ?? null,
      createdAt: now,
      syncedAt: now,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export async function addLearnerToTeam(orgId: string, teamLitmosId: string, learnerLitmosId: string): Promise<WriteResult> {
  try {
    const creds = await requireCreds(orgId);
    await addLitmosTeamUsers(creds, teamLitmosId, [learnerLitmosId]);
    const [inserted] = await db
      .insert(lmsTeamMembers)
      .values({ id: randomUUID(), orgId, teamLitmosId, learnerLitmosId, syncedAt: Date.now() })
      .onConflictDoNothing()
      .returning({ id: lmsTeamMembers.id });
    const learner = (
      await db
        .select({ email: lmsLearners.email, fullName: lmsLearners.fullName })
        .from(lmsLearners)
        .where(and(eq(lmsLearners.orgId, orgId), eq(lmsLearners.litmosId, learnerLitmosId)))
    )[0];
    // Fire only on a NEW membership row; its id is the dedupe cycle, so leaving
    // and rejoining the team later legitimately re-fires join rules. Conditions
    // see the learner's full team list, not just the joined team.
    if (inserted && learner?.email) {
      const memberships = await db
        .select({ teamLitmosId: lmsTeamMembers.teamLitmosId })
        .from(lmsTeamMembers)
        .where(and(eq(lmsTeamMembers.orgId, orgId), eq(lmsTeamMembers.learnerLitmosId, learnerLitmosId)));
      await fireLmsEvent(orgId, {
        trigger: "learner.team_joined",
        learner: { email: learner.email, name: learner.fullName, litmosUserId: learnerLitmosId, teamIds: memberships.map((m) => m.teamLitmosId) },
        cycleKey: inserted.id,
      });
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export async function removeLearnerFromTeam(orgId: string, teamLitmosId: string, learnerLitmosId: string): Promise<WriteResult> {
  try {
    const creds = await requireCreds(orgId);
    await removeLitmosTeamUser(creds, teamLitmosId, learnerLitmosId);
    await db
      .delete(lmsTeamMembers)
      .where(
        and(
          eq(lmsTeamMembers.orgId, orgId),
          eq(lmsTeamMembers.teamLitmosId, teamLitmosId),
          eq(lmsTeamMembers.learnerLitmosId, learnerLitmosId),
        ),
      );
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}
