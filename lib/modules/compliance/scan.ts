// Compliance scanning (rebuilt from Horizon Scanner) on the shared platform feed
// engine. Tenants add their own feeds + policies (empty by default); "Scan now"
// and the compliance-scan cron job fetch enabled feeds, classify items with a
// compliance-flavored ruleset, dedupe by link, and store findings.

import { randomUUID } from "crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/platform/db";
import { assertSafeFeedUrl, classifyItem, scanFeed, type KeywordRule, type Severity } from "@/lib/platform/feeds";
import { complianceFeeds, complianceFindings, compliancePolicies } from "./schema";

// Built-in compliance/regulatory classifier. Tenants don't have to configure
// keywords; these give scanned items sensible severity + category out of the box.
const DEFAULT_RULES: KeywordRule[] = [
  ...["actively exploited", "emergency directive", "mass exploitation", "nation-state", "critical zero-day"].map((term) => ({
    term,
    severityFloor: "critical" as Severity,
  })),
  ...["cisa alert", "binding operational directive", "cve-", "active exploit", "breach notification", "enforcement action"].map((term) => ({
    term,
    severityFloor: "high" as Severity,
  })),
  ...["vulnerab", "advisory", "guidance", "rulemaking", "proposed rule", "final rule", "settlement", "penalty"].map((term) => ({
    term,
    severityFloor: "medium" as Severity,
  })),
  { term: "hipaa", category: "HIPAA" },
  { term: "hitech", category: "HIPAA" },
  { term: "nist", category: "NIST" },
  { term: "800-53", category: "NIST" },
  { term: "pci", category: "PCI-DSS" },
  { term: "gdpr", category: "Privacy" },
  { term: "ccpa", category: "Privacy" },
  { term: "ferpa", category: "Privacy" },
  { term: "sec ", category: "SEC" },
  { term: "ftc", category: "FTC" },
  { term: "federal register", category: "Regulatory" },
  { term: "oig", category: "OIG" },
  { term: "ransomware", category: "Threat" },
  { term: "phishing", category: "Threat" },
];

// ─── feeds ────────────────────────────────────────────────────────────────────

export function listFeeds(orgId: string) {
  return db.select().from(complianceFeeds).where(eq(complianceFeeds.orgId, orgId)).orderBy(desc(complianceFeeds.createdAt));
}

export async function addFeed(orgId: string, input: { name: string; url: string; category?: string }): Promise<void> {
  assertSafeFeedUrl(input.url);
  await db.insert(complianceFeeds).values({
    id: randomUUID(),
    orgId,
    name: input.name.trim() || "Feed",
    url: input.url.trim(),
    category: input.category ?? null,
    enabled: true,
    createdAt: Date.now(),
  });
}

export async function deleteFeed(orgId: string, id: string): Promise<void> {
  await db.delete(complianceFeeds).where(and(eq(complianceFeeds.orgId, orgId), eq(complianceFeeds.id, id)));
}

export async function setFeedEnabled(orgId: string, id: string, enabled: boolean): Promise<void> {
  await db.update(complianceFeeds).set({ enabled }).where(and(eq(complianceFeeds.orgId, orgId), eq(complianceFeeds.id, id)));
}

// ─── policies ─────────────────────────────────────────────────────────────────

export function listPolicies(orgId: string) {
  return db.select().from(compliancePolicies).where(eq(compliancePolicies.orgId, orgId)).orderBy(desc(compliancePolicies.updatedAt));
}

export async function addPolicy(
  orgId: string,
  input: { title: string; reference?: string; category?: string; content?: string },
): Promise<void> {
  const now = Date.now();
  await db.insert(compliancePolicies).values({
    id: randomUUID(),
    orgId,
    title: input.title.trim(),
    reference: input.reference ?? null,
    category: input.category ?? null,
    content: input.content ?? null,
    createdAt: now,
    updatedAt: now,
  });
}

export async function deletePolicy(orgId: string, id: string): Promise<void> {
  await db.delete(compliancePolicies).where(and(eq(compliancePolicies.orgId, orgId), eq(compliancePolicies.id, id)));
}

// ─── findings + scan ──────────────────────────────────────────────────────────

export function listFindings(orgId: string, limit = 50) {
  return db
    .select()
    .from(complianceFindings)
    .where(eq(complianceFindings.orgId, orgId))
    .orderBy(desc(complianceFindings.scannedAt))
    .limit(limit);
}

export interface ScanResult {
  scannedFeeds: number;
  added: number;
  errors: string[];
}

export async function scanOrgComplianceFeeds(orgId: string): Promise<ScanResult> {
  const feeds = (await listFeeds(orgId)).filter((f) => f.enabled);
  const result: ScanResult = { scannedFeeds: 0, added: 0, errors: [] };

  for (const feed of feeds) {
    try {
      const items = await scanFeed(feed.url, feed.name);
      result.scannedFeeds++;
      for (const item of items) {
        if (!item.link) continue;
        const c = classifyItem(item, DEFAULT_RULES);
        const inserted = await db
          .insert(complianceFindings)
          .values({
            id: randomUUID(),
            orgId,
            feedId: feed.id,
            feedName: feed.name,
            title: item.title,
            summary: item.summary,
            link: item.link,
            severity: c.severity,
            category: c.categories[0] ?? null,
            keywords: c.matched.join(", ") || null,
            publishedAt: item.publishedAt ? new Date(item.publishedAt).getTime() : null,
            scannedAt: Date.now(),
          })
          .onConflictDoNothing()
          .returning({ id: complianceFindings.id });
        if (inserted.length > 0) result.added++;
      }
      await db.update(complianceFeeds).set({ lastScannedAt: Date.now(), lastError: null }).where(eq(complianceFeeds.id, feed.id));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.errors.push(`${feed.name}: ${msg}`);
      await db.update(complianceFeeds).set({ lastScannedAt: Date.now(), lastError: msg }).where(eq(complianceFeeds.id, feed.id));
    }
  }
  return result;
}

// Global scan across every org with an enabled feed — driven by the
// compliance-scan cron job.
export async function scanAllComplianceOrgs(): Promise<{ orgs: number; added: number }> {
  const feeds = await db.select({ orgId: complianceFeeds.orgId }).from(complianceFeeds).where(eq(complianceFeeds.enabled, true));
  const orgIds = [...new Set(feeds.map((f) => f.orgId))];
  let added = 0;
  for (const orgId of orgIds) {
    const r = await scanOrgComplianceFeeds(orgId);
    added += r.added;
  }
  return { orgs: orgIds.length, added };
}
