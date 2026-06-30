// Campaign personas (rebuilt from Mirage's persona workbench). Personas warm up
// through draft → warming → ready before a campaign launches.

import { randomUUID } from "crypto";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/platform/db";
import { campaignPersonas } from "./schema";
import { logAudit } from "./audit";

export function listPersonas(orgId: string, campaignId: string) {
  return db
    .select()
    .from(campaignPersonas)
    .where(and(eq(campaignPersonas.orgId, orgId), eq(campaignPersonas.campaignId, campaignId)))
    .orderBy(asc(campaignPersonas.createdAt));
}

export async function addPersona(
  orgId: string,
  userId: string,
  campaignId: string,
  input: { name: string; role?: string; backstory?: string },
): Promise<void> {
  await db.insert(campaignPersonas).values({
    id: randomUUID(),
    orgId,
    campaignId,
    name: input.name.trim(),
    role: input.role ?? null,
    backstory: input.backstory ?? null,
    status: "draft",
    createdAt: Date.now(),
  });
  await logAudit(orgId, campaignId, userId, "persona.added", input.name.trim());
}

const PERSONA_STATES = new Set(["draft", "warming", "ready"]);

export async function setPersonaStatus(orgId: string, userId: string, campaignId: string, personaId: string, status: string): Promise<void> {
  if (!PERSONA_STATES.has(status)) return;
  await db
    .update(campaignPersonas)
    .set({ status })
    .where(and(eq(campaignPersonas.orgId, orgId), eq(campaignPersonas.id, personaId)));
  await logAudit(orgId, campaignId, userId, `persona.status.${status}`, personaId);
}
