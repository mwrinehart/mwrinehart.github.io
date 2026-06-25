// ─── Compliance module (rebuilt from Horizon Scanner / "Compliance Radar") ────
//
// Per-tenant regulatory & threat feed scanning with policy cross-reference.
// Everything is org-scoped and EMPTY by default — each tenant configures its own
// feeds and policies. Findings are classified by the shared platform feed engine
// (the same engine Behavior's Threat Pulse uses).
//
// Note: this module owns its own `compliance_policies` (the regulatory/policy
// documents the scanner maps findings against). That is intentionally separate
// from Behavior's Policy Center (employee-facing security policies) — modules
// don't share tables; anything truly common would move to the platform.

import { bigint, boolean, pgTable, text } from "drizzle-orm/pg-core";

export const complianceFeeds = pgTable("compliance_feeds", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  category: text("category"),
  enabled: boolean("enabled").notNull().default(true),
  lastScannedAt: bigint("last_scanned_at", { mode: "number" }),
  lastError: text("last_error"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

export const compliancePolicies = pgTable("compliance_policies", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  title: text("title").notNull(),
  // Internal reference / control code, e.g. "NH-IM-0051".
  reference: text("reference"),
  category: text("category"),
  content: text("content"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

export const complianceFindings = pgTable("compliance_findings", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  feedId: text("feed_id"),
  feedName: text("feed_name"),
  title: text("title").notNull(),
  summary: text("summary"),
  link: text("link"),
  severity: text("severity").notNull().default("medium"),
  category: text("category"),
  keywords: text("keywords"),
  publishedAt: bigint("published_at", { mode: "number" }),
  scannedAt: bigint("scanned_at", { mode: "number" }).notNull(),
  // AI analysis (shared Anthropic client): summary, action items, and the org
  // policies this finding implicates. Populated on demand / by the cron job.
  aiSummary: text("ai_summary"),
  aiActions: text("ai_actions"), // JSON string[]
  mappedPolicies: text("mapped_policies"), // JSON [{reference,title,why}]
  analyzedAt: bigint("analyzed_at", { mode: "number" }),
});

export type ComplianceFeedRow = typeof complianceFeeds.$inferSelect;
export type CompliancePolicyRow = typeof compliancePolicies.$inferSelect;
export type ComplianceFindingRow = typeof complianceFindings.$inferSelect;
