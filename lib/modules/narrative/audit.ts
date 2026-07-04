// Append-only audit log for the Narrative module — every detection, verdict,
// alert, and counter-response decision leaves a row. Rows are never updated or
// deleted; actorUserId is null for system (scan/cron) actions.

import { randomUUID } from "crypto";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/platform/db";
import { narrativeAudit } from "./schema";

export async function logAudit(
  orgId: string,
  narrativeId: string | null,
  actorUserId: string | null,
  action: string,
  detail?: string,
): Promise<void> {
  await db.insert(narrativeAudit).values({
    id: randomUUID(),
    orgId,
    narrativeId,
    actorUserId,
    action,
    detail: detail ?? null,
    createdAt: Date.now(),
  });
}

export function listAudit(orgId: string, limit = 100) {
  return db.select().from(narrativeAudit).where(eq(narrativeAudit.orgId, orgId)).orderBy(desc(narrativeAudit.createdAt)).limit(limit);
}
