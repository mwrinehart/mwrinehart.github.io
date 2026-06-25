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
  icon: text("icon"), // emoji shown by the device widget
  delayMs: integer("delay_ms").notNull().default(5000), // device widget reveal delay
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

// Org groups/teams (synced from external sources or created manually).
export const behaviorGroups = pgTable("behavior_groups", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  externalId: text("external_id"), // tenant-scoped: "{orgId}:{provider}:{id}"
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

// ─── Data-source sync (ported from CBM dataSources.js) ────────────────────────
export const dataSourceConfigs = pgTable("data_source_configs", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  provider: text("provider").notNull(), // jericho-app | litmos
  name: text("name").notNull(),
  baseUrl: text("base_url"),
  enabled: boolean("enabled").notNull().default(true),
  metadata: text("metadata"), // JSON: { paths?, source? }
  lastSyncAt: bigint("last_sync_at", { mode: "number" }),
  lastStatus: text("last_status"),
  lastError: text("last_error"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

export const dataSyncRuns = pgTable("data_sync_runs", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  provider: text("provider").notNull(),
  status: text("status").notNull().default("running"), // running | success | partial | failed
  startedAt: bigint("started_at", { mode: "number" }).notNull(),
  finishedAt: bigint("finished_at", { mode: "number" }),
  summary: text("summary"), // JSON counts
  error: text("error"),
});

// Imported event ledgers — deduped by (org_id, provider, external_id).
export const importedCampaignEvents = pgTable("imported_campaign_events", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  provider: text("provider").notNull(),
  externalId: text("external_id").notNull(),
  campaignType: text("campaign_type"), // phishing | smishing | vishing
  name: text("name"),
  status: text("status"),
  userEmail: text("user_email"),
  userId: text("user_id"),
  groupName: text("group_name"),
  eventType: text("event_type"), // clicked | reported | opened | completed_training
  eventAt: bigint("event_at", { mode: "number" }),
  rawJson: text("raw_json"),
  importedAt: bigint("imported_at", { mode: "number" }).notNull(),
});

export const triageEmailEvents = pgTable("triage_email_events", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  provider: text("provider").notNull(),
  externalId: text("external_id").notNull(),
  subject: text("subject"),
  sender: text("sender"),
  recipientEmail: text("recipient_email"),
  verdict: text("verdict"), // malicious | suspicious | safe
  severity: text("severity"),
  status: text("status"),
  reportedAt: bigint("reported_at", { mode: "number" }),
  rawJson: text("raw_json"),
  importedAt: bigint("imported_at", { mode: "number" }).notNull(),
});

export const importedLmsRecords = pgTable("imported_lms_records", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  provider: text("provider").notNull(),
  recordType: text("record_type").notNull(), // user | team | course | learning_path
  externalId: text("external_id").notNull(),
  userEmail: text("user_email"),
  title: text("title"),
  status: text("status"),
  score: integer("score"),
  completedAt: bigint("completed_at", { mode: "number" }),
  rawJson: text("raw_json"),
  importedAt: bigint("imported_at", { mode: "number" }).notNull(),
});

// ─── Threat Pulse: custom keyword rules + auto-route rules ─────────────────────
export const pulseKeywords = pgTable("pulse_keywords", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  term: text("term").notNull(),
  category: text("category"),
  severityFloor: text("severity_floor"), // low | medium | high | critical
  enabled: boolean("enabled").notNull().default(true),
  matchCount: integer("match_count").notNull().default(0),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

export const pulseAutoRoutes = pgTable("pulse_auto_routes", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  name: text("name").notNull(),
  severityMin: text("severity_min").notNull().default("critical"),
  categories: text("categories"), // csv; null = all
  channelProvider: text("channel_provider").notNull(), // slack | teams
  channelTarget: text("channel_target").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  sentCount: integer("sent_count").notNull().default(0),
  lastSentAt: bigint("last_sent_at", { mode: "number" }),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

// Scheduled email digests of pulse findings (sent by the pulse-digests cron job).
export const pulseDigests = pgTable("pulse_digests", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  name: text("name").notNull(),
  frequency: text("frequency").notNull().default("daily"), // daily | weekly
  dayOfWeek: integer("day_of_week"), // 0-6, weekly only
  hour: integer("hour").notNull().default(9), // 0-23 UTC
  recipients: text("recipients").notNull(), // comma-separated emails
  severityMin: text("severity_min").notNull().default("medium"),
  categories: text("categories"), // csv; null = all
  enabled: boolean("enabled").notNull().default(true),
  lastRunAt: bigint("last_run_at", { mode: "number" }),
  lastStatus: text("last_status"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

export type BehaviorPersonRow = typeof behaviorPeople.$inferSelect;
export type BehaviorRow = typeof behaviors.$inferSelect;
export type PulseFindingRow = typeof pulseFindings.$inferSelect;
export type DataSourceConfigRow = typeof dataSourceConfigs.$inferSelect;
export type DataSyncRunRow = typeof dataSyncRuns.$inferSelect;
export type PulseKeywordRow = typeof pulseKeywords.$inferSelect;
export type PulseAutoRouteRow = typeof pulseAutoRoutes.$inferSelect;
export type NudgeConfigRow = typeof nudgeConfigs.$inferSelect;
export type NudgeEventRow = typeof nudgeEvents.$inferSelect;
export type PulseDigestRow = typeof pulseDigests.$inferSelect;

// ─── Policy Center ────────────────────────────────────────────────────────────
// Document-blob upload is deferred to the platform object-storage follow-up;
// policies carry text content + document metadata for now.
export const policies = pgTable("policies", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  title: text("title").notNull(),
  category: text("category"),
  content: text("content"),
  version: text("version").notNull().default("1.0"),
  status: text("status").notNull().default("active"),
  active: boolean("active").notNull().default(true),
  documentName: text("document_name"),
  documentMime: text("document_mime"),
  documentSize: integer("document_size"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

export const policyAcknowledgments = pgTable("policy_acknowledgments", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  policyId: text("policy_id").notNull(),
  userId: text("user_id").notNull(),
  acknowledgedAt: bigint("acknowledged_at", { mode: "number" }).notNull(),
});

// ─── Compliance frameworks (GRC control evidence — distinct from the Compliance
// MODULE's regulatory feed scanning) ──────────────────────────────────────────
export const complianceFrameworks = pgTable("compliance_frameworks", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  name: text("name").notNull(),
  version: text("version"),
  description: text("description"),
  status: text("status"),
  score: integer("score").notNull().default(0),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

export const complianceEvidence = pgTable("compliance_evidence", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  frameworkId: text("framework_id").notNull(),
  controlId: text("control_id"),
  description: text("description"),
  status: text("status").notNull().default("pending"), // pending | submitted | approved
  submittedAt: bigint("submitted_at", { mode: "number" }).notNull(),
});

// ─── Maturity ─────────────────────────────────────────────────────────────────
export const maturityFrameworks = pgTable("maturity_frameworks", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  name: text("name").notNull(),
  version: text("version"),
  description: text("description"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

export const maturityControls = pgTable("maturity_controls", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  frameworkId: text("framework_id").notNull(),
  domain: text("domain"),
  name: text("name"),
  score: integer("score"), // nullable until assessed (0-5)
  notes: text("notes"),
  assessedAt: bigint("assessed_at", { mode: "number" }),
});

export const maturitySnapshots = pgTable("maturity_snapshots", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  frameworkId: text("framework_id").notNull(),
  avgScore: integer("avg_score").notNull(),
  recordedAt: bigint("recorded_at", { mode: "number" }).notNull(),
});

// ─── Brand protection ─────────────────────────────────────────────────────────
export const brandDomains = pgTable("brand_domains", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  domain: text("domain").notNull(),
  brand: text("brand"),
  threatScore: integer("threat_score").notNull().default(0),
  lastChecked: bigint("last_checked", { mode: "number" }),
  detectedAt: bigint("detected_at", { mode: "number" }).notNull(),
});

export const brandImpersonations = pgTable("brand_impersonations", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  type: text("type"),
  source: text("source"),
  description: text("description"),
  severity: text("severity").notNull().default("medium"),
  brand: text("brand"),
  status: text("status").notNull().default("open"), // open | resolved
  detectedAt: bigint("detected_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }),
});

// ─── Reports ──────────────────────────────────────────────────────────────────
export const savedReports = pgTable("saved_reports", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  type: text("type").notNull(),
  title: text("title"),
  dateRange: text("date_range"),
  format: text("format").notNull().default("json"),
  status: text("status").notNull().default("ready"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

// ─── Litmos training assignments ──────────────────────────────────────────────
export const litmosAssignments = pgTable("litmos_assignments", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  userEmail: text("user_email"),
  userName: text("user_name"),
  litmosUserId: text("litmos_user_id"),
  litmosCourseId: text("litmos_course_id").notNull(),
  litmosCourseName: text("litmos_course_name"),
  assignedBy: text("assigned_by"),
  assignedAt: bigint("assigned_at", { mode: "number" }).notNull(),
  scheduledFor: bigint("scheduled_for", { mode: "number" }),
  dueDate: bigint("due_date", { mode: "number" }),
  activatedAt: bigint("activated_at", { mode: "number" }),
  completedAt: bigint("completed_at", { mode: "number" }),
  score: integer("score"),
  status: text("status").notNull().default("pending"), // pending|scheduled|active|completed|failed|cancelled
  litmosResponse: text("litmos_response"),
  notes: text("notes"),
});

export type PolicyRow = typeof policies.$inferSelect;
export type ComplianceFrameworkRow = typeof complianceFrameworks.$inferSelect;
export type MaturityControlRow = typeof maturityControls.$inferSelect;
export type BrandImpersonationRow = typeof brandImpersonations.$inferSelect;
export type LitmosAssignmentRow = typeof litmosAssignments.$inferSelect;
