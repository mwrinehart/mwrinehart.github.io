// ─── Narrative module (Narrative Defense — new build) ─────────────────────────
//
// Disinformation monitoring: scan traditional + social media for mentions that
// match the org's watch terms, cluster them into narratives, assess each
// narrative against the org's verified fact library (AI-assisted), alert when a
// false narrative is spreading, and draft counter-messaging for human approval.
//
// Design stance (deliberate):
//   * Detection, scoring, and drafting run at machine speed (cron + on demand).
//   * Dissemination never does — every counter-response requires an explicit
//     human approval, and the platform itself never publishes anything.
//   * Everything is org-scoped and empty by default, like the other modules.

import { bigint, boolean, integer, pgTable, text } from "drizzle-orm/pg-core";

// Monitored media sources. `kind` picks the fetcher: "rss" uses the shared
// platform feed engine; "reddit" hits a public reddit .json listing (search,
// subreddit /new, etc.) and carries real engagement counts as reach.
export const narrativeSources = pgTable("narrative_sources", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  kind: text("kind").notNull().default("rss"), // rss | reddit
  platform: text("platform").notNull().default("news"), // news | social | blog | forum | other
  enabled: boolean("enabled").notNull().default(true),
  lastScannedAt: bigint("last_scanned_at", { mode: "number" }),
  lastError: text("last_error"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

// Watch terms — the org's name, products, executives, and hot-button topics.
// A scanned item only becomes a mention when it matches at least one enabled
// term; without terms a busy feed would flood the org with noise.
export const narrativeWatchTerms = pgTable("narrative_watch_terms", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  term: text("term").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  matchCount: integer("match_count").notNull().default(0),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

// One media item that matched a watch term. Deduped by (org_id, url).
export const narrativeMentions = pgTable("narrative_mentions", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  sourceId: text("source_id"),
  sourceName: text("source_name"),
  platform: text("platform").notNull().default("news"), // news | social | blog | forum | other
  url: text("url").notNull(),
  author: text("author"),
  title: text("title").notNull(),
  excerpt: text("excerpt"),
  matchedTerms: text("matched_terms"), // csv of watch terms that matched
  // Engagement-based audience estimate where the source exposes one (reddit
  // score + comments); 0 for plain RSS items.
  reach: integer("reach").notNull().default(0),
  narrativeId: text("narrative_id"),
  publishedAt: bigint("published_at", { mode: "number" }),
  fetchedAt: bigint("fetched_at", { mode: "number" }).notNull(),
});

// A cluster of mentions pushing the same story. Verdict + threat score drive
// alerting; AI fills claim/summary/verdict, and analysts can override.
export const narratives = pgTable("narratives", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  title: text("title").notNull(),
  claim: text("claim"), // the central factual claim being spread
  summary: text("summary"),
  status: text("status").notNull().default("emerging"), // emerging | active | countered | dismissed
  verdict: text("verdict").notNull().default("unverified"), // unverified | false | misleading | unsubstantiated | true
  verdictConfidence: integer("verdict_confidence").notNull().default(0), // 0-100
  verdictRationale: text("verdict_rationale"),
  verdictSource: text("verdict_source"), // ai | analyst
  analyzedAt: bigint("analyzed_at", { mode: "number" }),
  threatScore: integer("threat_score").notNull().default(0), // 0-100
  mentionCount: integer("mention_count").notNull().default(0),
  totalReach: integer("total_reach").notNull().default(0),
  velocity: integer("velocity").notNull().default(0), // mentions seen in the last 24h
  // Highest severity already alerted for this narrative (high-water mark), so
  // re-scans only re-alert on escalation.
  alertedSeverity: text("alerted_severity"),
  firstSeenAt: bigint("first_seen_at", { mode: "number" }).notNull(),
  lastSeenAt: bigint("last_seen_at", { mode: "number" }).notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

// The org's verified fact library — the ground truth that veracity assessment
// and counter-messaging are anchored to. Maintained by analysts.
export const narrativeFacts = pgTable("narrative_facts", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  topic: text("topic").notNull(),
  statement: text("statement").notNull(),
  sourceUrl: text("source_url"),
  createdByUserId: text("created_by_user_id"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

// In-app alert queue. One row per escalation of a narrative past the alert
// thresholds; channel fan-out goes through narrative_routes + platform notify.
export const narrativeAlerts = pgTable("narrative_alerts", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  narrativeId: text("narrative_id").notNull(),
  severity: text("severity").notNull(), // low | medium | high | critical
  title: text("title").notNull(),
  body: text("body"),
  status: text("status").notNull().default("open"), // open | acknowledged | resolved
  acknowledgedByUserId: text("acknowledged_by_user_id"),
  acknowledgedAt: bigint("acknowledged_at", { mode: "number" }),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

// Channel routes for alert fan-out (Slack/Teams/email via platform notify).
export const narrativeRoutes = pgTable("narrative_routes", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  name: text("name").notNull(),
  severityMin: text("severity_min").notNull().default("high"),
  channelProvider: text("channel_provider").notNull(), // slack | teams | email
  channelTarget: text("channel_target").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  sentCount: integer("sent_count").notNull().default(0),
  lastSentAt: bigint("last_sent_at", { mode: "number" }),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

// Counter-response drafts. AI drafts a strategy + message grounded in the fact
// library; a human edits, submits, and an admin approves. The platform never
// publishes — "approved" hands finished copy to the comms team.
export const narrativeResponses = pgTable("narrative_responses", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  narrativeId: text("narrative_id").notNull(),
  posture: text("posture").notNull().default("monitor"), // debunk | prebunk | amplify_truth | monitor
  strategy: text("strategy"), // markdown rationale / playbook
  draftMessage: text("draft_message"),
  audience: text("audience"),
  channels: text("channels"), // csv of suggested channels
  riskScore: integer("risk_score").notNull().default(0), // 0-100
  status: text("status").notNull().default("draft"), // draft | pending_review | approved | rejected | blocked
  blockReason: text("block_reason"),
  createdByUserId: text("created_by_user_id"),
  decidedByUserId: text("decided_by_user_id"),
  decisionNote: text("decision_note"),
  decidedAt: bigint("decided_at", { mode: "number" }),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

// Append-only audit trail. actorUserId is null for system (cron) actions.
export const narrativeAudit = pgTable("narrative_audit", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  narrativeId: text("narrative_id"),
  actorUserId: text("actor_user_id"),
  action: text("action").notNull(),
  detail: text("detail"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

export type NarrativeSourceRow = typeof narrativeSources.$inferSelect;
export type NarrativeWatchTermRow = typeof narrativeWatchTerms.$inferSelect;
export type NarrativeMentionRow = typeof narrativeMentions.$inferSelect;
export type NarrativeRow = typeof narratives.$inferSelect;
export type NarrativeFactRow = typeof narrativeFacts.$inferSelect;
export type NarrativeAlertRow = typeof narrativeAlerts.$inferSelect;
export type NarrativeRouteRow = typeof narrativeRoutes.$inferSelect;
export type NarrativeResponseRow = typeof narrativeResponses.$inferSelect;
export type NarrativeAuditRow = typeof narrativeAudit.$inferSelect;
