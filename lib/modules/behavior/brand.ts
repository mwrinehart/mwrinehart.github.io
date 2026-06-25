// Brand protection (ported from CBM brandProtection.js). Monitored domains +
// detected impersonations.

import { randomUUID } from "crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/platform/db";
import { brandDomains, brandImpersonations } from "./schema";

export function listDomains(orgId: string) {
  return db.select().from(brandDomains).where(eq(brandDomains.orgId, orgId)).orderBy(desc(brandDomains.threatScore));
}

export async function addDomain(orgId: string, input: { domain: string; brand?: string }): Promise<void> {
  await db.insert(brandDomains).values({
    id: randomUUID(),
    orgId,
    domain: input.domain.trim(),
    brand: input.brand ?? null,
    threatScore: 0,
    detectedAt: Date.now(),
  });
}

export function listImpersonations(orgId: string, limit = 100) {
  return db
    .select()
    .from(brandImpersonations)
    .where(eq(brandImpersonations.orgId, orgId))
    .orderBy(desc(brandImpersonations.detectedAt))
    .limit(limit);
}

export async function reportImpersonation(
  orgId: string,
  input: { type?: string; source?: string; description?: string; severity?: string; brand?: string },
): Promise<void> {
  await db.insert(brandImpersonations).values({
    id: randomUUID(),
    orgId,
    type: input.type ?? null,
    source: input.source ?? null,
    description: input.description ?? null,
    severity: input.severity ?? "medium",
    brand: input.brand ?? null,
    status: "open",
    detectedAt: Date.now(),
  });
}

export async function setImpersonationStatus(orgId: string, id: string, status: string): Promise<void> {
  await db
    .update(brandImpersonations)
    .set({ status, updatedAt: Date.now() })
    .where(and(eq(brandImpersonations.orgId, orgId), eq(brandImpersonations.id, id)));
}

export async function brandStats(orgId: string) {
  const domains = await listDomains(orgId);
  const imps = await db.select().from(brandImpersonations).where(eq(brandImpersonations.orgId, orgId));
  return {
    domains: domains.length,
    impersonations: imps.length,
    open: imps.filter((i) => i.status === "open").length,
    resolved: imps.filter((i) => i.status === "resolved").length,
    critical: domains.filter((d) => d.threatScore >= 70).length,
  };
}
