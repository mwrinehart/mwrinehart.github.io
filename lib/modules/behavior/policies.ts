// Policy Center (ported from CBM policyCenter.js). Policies + per-user
// acknowledgments. Binary document upload is deferred to the platform
// object-storage follow-up; policies carry text content + document metadata.

import { randomUUID } from "crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/platform/db";
import { users } from "@/lib/platform/db/schema";
import { policies, policyAcknowledgments } from "./schema";

export function listPolicies(orgId: string) {
  return db.select().from(policies).where(eq(policies.orgId, orgId)).orderBy(desc(policies.updatedAt));
}

export async function createPolicy(
  orgId: string,
  input: { title: string; category?: string; content?: string; version?: string },
): Promise<void> {
  const now = Date.now();
  await db.insert(policies).values({
    id: randomUUID(),
    orgId,
    title: input.title.trim(),
    category: input.category ?? null,
    content: input.content ?? null,
    version: input.version?.trim() || "1.0",
    status: "active",
    active: true,
    createdAt: now,
    updatedAt: now,
  });
}

export async function acknowledgePolicy(orgId: string, policyId: string, userId: string): Promise<void> {
  await db
    .insert(policyAcknowledgments)
    .values({ id: randomUUID(), orgId, policyId, userId, acknowledgedAt: Date.now() })
    .onConflictDoNothing();
}

export async function listAcknowledgments(orgId: string, policyId: string) {
  return db
    .select({ id: policyAcknowledgments.id, userId: policyAcknowledgments.userId, at: policyAcknowledgments.acknowledgedAt, email: users.email, name: users.name })
    .from(policyAcknowledgments)
    .leftJoin(users, eq(users.id, policyAcknowledgments.userId))
    .where(and(eq(policyAcknowledgments.orgId, orgId), eq(policyAcknowledgments.policyId, policyId)));
}

export async function policyStats(orgId: string): Promise<{ active: number; acknowledgments: number }> {
  const all = await listPolicies(orgId);
  const acks = await db.select({ id: policyAcknowledgments.id }).from(policyAcknowledgments).where(eq(policyAcknowledgments.orgId, orgId));
  return { active: all.filter((p) => p.active).length, acknowledgments: acks.length };
}
