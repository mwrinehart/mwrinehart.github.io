// Tenant certificates. Litmos certificate templates (.doc/.docx uploaded in the
// UI) have no API, so the dashboard issues its own print-ready certificates for
// course / learning-path completions, configured per tenant.

import { eq } from "drizzle-orm";
import { db } from "@/lib/platform/db";
import { lcCertificateConfig, type LcCertificateConfigRow } from "./schema";
import { parseIdList } from "./rules";

export async function getCertConfig(tenantRootTeamId: string): Promise<LcCertificateConfigRow | null> {
  const rows = await db.select().from(lcCertificateConfig).where(eq(lcCertificateConfig.teamId, tenantRootTeamId)).limit(1);
  return rows[0] ?? null;
}

export async function saveCertConfig(
  tenantRootTeamId: string,
  input: {
    enabled: boolean;
    titleText: string;
    messageText: string;
    signerName?: string;
    signerTitle?: string;
    scope: "all" | "selected";
    courseIds: string[];
    learningPathIds: string[];
  },
  updatedBy: string,
): Promise<void> {
  const now = Date.now();
  const existing = await getCertConfig(tenantRootTeamId);
  const values = {
    enabled: input.enabled,
    titleText: input.titleText.trim() || "Certificate of Completion",
    messageText: input.messageText.trim() || "has successfully completed",
    signerName: input.signerName?.trim() || null,
    signerTitle: input.signerTitle?.trim() || null,
    scope: input.scope,
    courseIds: JSON.stringify(input.courseIds),
    learningPathIds: JSON.stringify(input.learningPathIds),
    updatedBy,
    updatedAt: now,
  };
  if (existing) {
    await db.update(lcCertificateConfig).set(values).where(eq(lcCertificateConfig.teamId, tenantRootTeamId));
  } else {
    await db.insert(lcCertificateConfig).values({ teamId: tenantRootTeamId, ...values });
  }
}

// Does a completed course/LP qualify for a certificate under the tenant config?
export function certificateEligible(config: LcCertificateConfigRow | null, opts: { courseId?: string; learningPathId?: string }): boolean {
  if (!config?.enabled) return false;
  if (config.scope === "all") return true;
  if (opts.courseId) return parseIdList(config.courseIds).includes(opts.courseId);
  if (opts.learningPathId) return parseIdList(config.learningPathIds).includes(opts.learningPathId);
  return false;
}
