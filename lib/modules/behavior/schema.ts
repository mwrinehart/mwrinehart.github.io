// ─── Behavior module (rebuilt from CBM-Next) — data model ─────────────────────
//
// Human-risk management. The key reconciliation vs. the source app: CBM's
// `users` table mixed *login accounts* with *monitored employees*. In the
// platform, login accounts are platform `users` (Auth.js). The people whose risk
// we track are `behavior_people` — they may or may not have a login. Everything
// here is org-scoped via `orgId`.

import { bigint, boolean, integer, pgTable, text } from "drizzle-orm/pg-core";

// A monitored person (employee / end user) whose security behavior is tracked.
export const behaviorPeople = pgTable("behavior_people", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  email: text("email").notNull(),
  name: text("name"),
  department: text("department"),
  groupName: text("group_name"),
  riskScore: integer("risk_score").notNull().default(0),
  lastActiveAt: bigint("last_active_at", { mode: "number" }),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

// A detected risk behavior (clicked a phish, reused a password, downloaded a
// risky file, …).
export const behaviors = pgTable("behaviors", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  personId: text("person_id").notNull(),
  behaviorType: text("behavior_type"),
  description: text("description"),
  severity: text("severity").notNull().default("medium"), // low | medium | high | critical
  detectedAt: bigint("detected_at", { mode: "number" }).notNull(),
  resolved: boolean("resolved").notNull().default(false),
  resolvedAt: bigint("resolved_at", { mode: "number" }),
});

// Time series of a person's risk score, for trend charts.
export const riskScoreHistory = pgTable("risk_score_history", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  personId: text("person_id").notNull(),
  score: integer("score").notNull(),
  recordedAt: bigint("recorded_at", { mode: "number" }).notNull(),
});

// A configurable nudge (security reminder) and its delivery rules.
export const nudgeConfigs = pgTable("nudge_configs", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  title: text("title"),
  message: text("message"),
  trigger: text("trigger"), // e.g. risk_threshold | behavior_type | manual
  deliveryChannels: text("delivery_channels").notNull().default("device"), // csv: device,slack,teams,email
  slackChannel: text("slack_channel"),
  teamsWebhookId: text("teams_webhook_id"),
  active: boolean("active").notNull().default(true),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

export const nudgeEvents = pgTable("nudge_events", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  personId: text("person_id"),
  nudgeId: text("nudge_id"),
  action: text("action"),
  deliveryChannel: text("delivery_channel"),
  status: text("status").notNull().default("pending"),
  title: text("title"),
  message: text("message"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

// Threat Pulse feeds + findings. These reuse the shared feed engine
// (lib/platform/feeds.ts) — the same engine the Compliance module will use.
export const pulseFeeds = pgTable("pulse_feeds", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  category: text("category"),
  enabled: boolean("enabled").notNull().default(true),
  lastScannedAt: bigint("last_scanned_at", { mode: "number" }),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

export const pulseFindings = pgTable("pulse_findings", {
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
});

export type BehaviorPersonRow = typeof behaviorPeople.$inferSelect;
export type BehaviorRow = typeof behaviors.$inferSelect;
export type PulseFindingRow = typeof pulseFindings.$inferSelect;
