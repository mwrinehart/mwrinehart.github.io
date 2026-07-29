// Dashboard audit trail — every mutating action an admin takes through the
// Learning Center, best-effort (an audit failure never blocks the action).

import { randomUUID } from "crypto";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/platform/db";
import { lcAuditLog, type LcAuditLogRow } from "./schema";
import type { LcSession } from "./auth";

export interface AuditInput {
  action: string;
  targetType?: "user" | "team" | "course" | "learning_path" | "rule" | "template" | "copy" | "notification" | "settings";
  targetId?: string;
  targetLabel?: string;
  teamId?: string;
  detail?: string;
}

export async function writeAudit(actor: LcSession | { email: string; role: string }, input: AuditInput): Promise<void> {
  try {
    await db.insert(lcAuditLog).values({
      id: randomUUID(),
      actorEmail: actor.email,
      actorRole: actor.role,
      action: input.action,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      targetLabel: input.targetLabel ?? null,
      teamId: input.teamId ?? null,
      detail: input.detail ?? null,
      createdAt: Date.now(),
    });
  } catch (e) {
    console.error("[learning-center] audit write failed:", e instanceof Error ? e.message : e);
  }
}

// Owners see everything; team admins see entries for their scoped teams (plus
// their own actions, which always carry a teamId within scope anyway).
export async function listAudit(scopeTeamIds: string[] | null, limit = 200): Promise<LcAuditLogRow[]> {
  if (scopeTeamIds === null) {
    return db.select().from(lcAuditLog).orderBy(desc(lcAuditLog.createdAt)).limit(limit);
  }
  if (!scopeTeamIds.length) return [];
  return db.select().from(lcAuditLog).where(inArray(lcAuditLog.teamId, scopeTeamIds)).orderBy(desc(lcAuditLog.createdAt)).limit(limit);
}

export async function listAuditForActor(email: string, limit = 100): Promise<LcAuditLogRow[]> {
  return db.select().from(lcAuditLog).where(eq(lcAuditLog.actorEmail, email)).orderBy(desc(lcAuditLog.createdAt)).limit(limit);
}
