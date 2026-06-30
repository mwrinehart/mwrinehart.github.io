// ─── Campaigns module (rebuilt from Mirage) — data model ──────────────────────
//
// Narrative campaign simulation: a campaign is built from an objective (optionally
// expanded into a blueprint by the shared AI client), staffed with personas, and
// run under a policy-gated "mission control" — an autonomy mode plus an approval
// workflow for launches and scope expansions. Every state change is written to an
// immutable, actor-aware audit log.
//
// Commercial product: Mirage's gov/DoD tenant class and classification banners are
// intentionally dropped. Everything is org-scoped.

import { bigint, integer, pgTable, text } from "drizzle-orm/pg-core";

export const campaigns = pgTable("campaigns", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  name: text("name").notNull(),
  objective: text("objective"),
  // draft | active | paused | completed
  status: text("status").notNull().default("draft"),
  // manual (every action needs approval) | review (approve above risk threshold) | auto
  autonomyMode: text("autonomy_mode").notNull().default("manual"),
  blueprint: text("blueprint"), // AI-generated plan (JSON/markdown)
  riskScore: integer("risk_score").notNull().default(0),
  createdByUserId: text("created_by_user_id"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

export const campaignPersonas = pgTable("campaign_personas", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  campaignId: text("campaign_id").notNull(),
  name: text("name").notNull(),
  role: text("role"),
  backstory: text("backstory"),
  // draft | warming | ready
  status: text("status").notNull().default("draft"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

// Approval workflow — launch gate + scope-expansion / content sign-off.
export const campaignApprovals = pgTable("campaign_approvals", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  campaignId: text("campaign_id").notNull(),
  type: text("type").notNull(), // launch | expansion | content
  title: text("title").notNull(),
  detail: text("detail"),
  riskScore: integer("risk_score").notNull().default(0),
  status: text("status").notNull().default("pending"), // pending | approved | rejected
  requestedByUserId: text("requested_by_user_id"),
  decidedByUserId: text("decided_by_user_id"),
  decisionNote: text("decision_note"),
  decidedAt: bigint("decided_at", { mode: "number" }),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

// Append-only, actor-aware audit trail.
export const campaignAudit = pgTable("campaign_audit", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  campaignId: text("campaign_id"),
  actorUserId: text("actor_user_id"),
  action: text("action").notNull(),
  detail: text("detail"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

// Content jobs — the unit of work a campaign produces. A brief is AI-drafted,
// then "submitted" through the autonomy gate (campaign status + autonomy mode +
// risk) which resolves it to approved / pending_review / blocked.
export const campaignContentJobs = pgTable("campaign_content_jobs", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  campaignId: text("campaign_id").notNull(),
  personaId: text("persona_id"),
  channel: text("channel").notNull().default("email"), // email | sms | voice | social
  brief: text("brief"),
  generatedContent: text("generated_content"),
  riskScore: integer("risk_score").notNull().default(0),
  // draft | generated | pending_review | approved | rejected | blocked
  status: text("status").notNull().default("draft"),
  blockReason: text("block_reason"),
  createdByUserId: text("created_by_user_id"),
  decidedByUserId: text("decided_by_user_id"),
  decidedAt: bigint("decided_at", { mode: "number" }),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

export type CampaignRow = typeof campaigns.$inferSelect;
export type CampaignPersonaRow = typeof campaignPersonas.$inferSelect;
export type CampaignApprovalRow = typeof campaignApprovals.$inferSelect;
export type CampaignAuditRow = typeof campaignAudit.$inferSelect;
export type CampaignContentJobRow = typeof campaignContentJobs.$inferSelect;
