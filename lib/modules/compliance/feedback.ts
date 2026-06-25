// Finding feedback — useful / not-useful votes that train the preference model
// (see scoring.ts). One vote per finding per org; re-voting flips it.

import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/platform/db";
import { complianceFeedback, complianceFindings } from "./schema";

export type Vote = "useful" | "not_useful";

export async function recordFeedback(orgId: string, findingId: string, vote: Vote): Promise<void> {
  const finding = (
    await db.select().from(complianceFindings).where(and(eq(complianceFindings.orgId, orgId), eq(complianceFindings.id, findingId)))
  )[0];
  if (!finding) return;
  await db
    .insert(complianceFeedback)
    .values({
      id: randomUUID(),
      orgId,
      findingId,
      vote,
      category: finding.category,
      feedName: finding.feedName,
      severity: finding.severity,
      keywords: finding.keywords,
      createdAt: Date.now(),
    })
    .onConflictDoUpdate({
      target: [complianceFeedback.orgId, complianceFeedback.findingId],
      set: { vote, createdAt: Date.now() },
    });
}

// Map of findingId → vote for the current org (to show vote state in the UI).
export async function votesByFinding(orgId: string): Promise<Record<string, Vote>> {
  const rows = await db
    .select({ findingId: complianceFeedback.findingId, vote: complianceFeedback.vote })
    .from(complianceFeedback)
    .where(eq(complianceFeedback.orgId, orgId));
  const out: Record<string, Vote> = {};
  for (const r of rows) out[r.findingId] = r.vote as Vote;
  return out;
}
