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

import { bigint, boolean, integer, pgTable, text } from "drizzle-orm/pg-core";

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
  // Composite relevance score (0–100) at scan time; findings sort by this.
  score: integer("score").notNull().default(0),
});

// Per-tenant keyword rules that augment the built-in classifier.
export const complianceKeywords = pgTable("compliance_keywords", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  term: text("term").notNull(),
  category: text("category"),
  severityFloor: text("severity_floor"), // low | medium | high | critical
  enabled: boolean("enabled").notNull().default(true),
  matchCount: integer("match_count").notNull().default(0),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

// Useful / not-useful votes on findings. Snapshots the finding's signals so the
// preference model can learn affinities by category / feed / keyword.
export const complianceFeedback = pgTable("compliance_feedback", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  findingId: text("finding_id").notNull(),
  vote: text("vote").notNull(), // useful | not_useful
  category: text("category"),
  feedName: text("feed_name"),
  severity: text("severity"),
  keywords: text("keywords"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

// Instant alert routes — push critical/high findings to Slack/Teams/email.
export const complianceAutoRoutes = pgTable("compliance_auto_routes", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  name: text("name").notNull(),
  severityMin: text("severity_min").notNull().default("high"),
  categories: text("categories"), // csv; null = all
  channelProvider: text("channel_provider").notNull(), // slack | teams | email
  channelTarget: text("channel_target").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  sentCount: integer("sent_count").notNull().default(0),
  lastSentAt: bigint("last_sent_at", { mode: "number" }),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

// Built-in external ingestion connectors (Federal Register, HHS breach, OIG
// workplan) — toggled + configured per org. One row per (org, type).
export const complianceConnectors = pgTable("compliance_connectors", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  type: text("type").notNull(), // federal-register | hhs-breach | oig-workplan
  enabled: boolean("enabled").notNull().default(false),
  config: text("config"), // JSON: { terms?, agencies?, url? }
  lastScannedAt: bigint("last_scanned_at", { mode: "number" }),
  lastError: text("last_error"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

export type ComplianceFeedRow = typeof complianceFeeds.$inferSelect;
export type CompliancePolicyRow = typeof compliancePolicies.$inferSelect;
export type ComplianceFindingRow = typeof complianceFindings.$inferSelect;
export type ComplianceAutoRouteRow = typeof complianceAutoRoutes.$inferSelect;
export type ComplianceKeywordRow = typeof complianceKeywords.$inferSelect;
export type ComplianceConnectorRow = typeof complianceConnectors.$inferSelect;
