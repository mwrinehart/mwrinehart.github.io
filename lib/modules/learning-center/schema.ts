// Learning Center tables (lc_*). Litmos itself is the system of record for
// users/teams/courses/results — these tables hold only what the dashboard owns:
// its sessions, assignment rules, notification templates, duplication tracking,
// and the audit trail. No org_id: the Learning Center is a standalone app bound
// to one Litmos tenant, scoped by Litmos team ids instead.

import { bigint, boolean, integer, pgTable, text } from "drizzle-orm/pg-core";

// Email-OTP login sessions. The cookie holds the raw opaque token; only its
// sha256 lands here.
export const lcSessions = pgTable("lc_sessions", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull(),
  email: text("email").notNull(),
  displayName: text("display_name"),
  litmosUserId: text("litmos_user_id"),
  role: text("role").notNull(), // owner | team_admin | learner
  // Teams the session's user administers (JSON string[]; snapshot taken at
  // login — descendants are resolved live per request).
  adminTeamIds: text("admin_team_ids").notNull().default("[]"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
});

export const lcLoginCodes = pgTable("lc_login_codes", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  codeHash: text("code_hash").notNull(),
  attempts: integer("attempts").notNull().default(0),
  consumedAt: bigint("consumed_at", { mode: "number" }),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
});

// Team-admin-manageable assignment automation (Litmos Assign is account-owner
// only and premium — this is the dashboard's own engine, run by platform cron).
export const lcAssignmentRules = pgTable("lc_assignment_rules", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull(),
  teamName: text("team_name"),
  name: text("name").notNull(),
  trigger: text("trigger").notNull(), // member_joined | schedule
  intervalDays: integer("interval_days"), // schedule trigger: re-run cadence
  courseIds: text("course_ids").notNull().default("[]"), // JSON string[]
  learningPathIds: text("learning_path_ids").notNull().default("[]"), // JSON string[]
  includeSubteams: boolean("include_subteams").notNull().default(false),
  sendLitmosEmail: boolean("send_litmos_email").notNull().default(false),
  // Optional notification action: send this team template type as part of the
  // rule (rules drive courses AND notifications). Null = assignment only.
  sendTemplateType: text("send_template_type"), // welcome | assignment | due_reminder | compliance_reminder | custom
  // Who the notification action reaches. member_joined rules always notify the
  // affected new members; schedule rules choose.
  notifyAudience: text("notify_audience"), // affected | all | overdue | compliance_risk
  active: boolean("active").notNull().default(true),
  createdBy: text("created_by").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  lastRunAt: bigint("last_run_at", { mode: "number" }),
});

export const lcRuleRuns = pgTable("lc_rule_runs", {
  id: text("id").primaryKey(),
  ruleId: text("rule_id").notNull(),
  ranAt: bigint("ran_at", { mode: "number" }).notNull(),
  status: text("status").notNull(), // success | failed | skipped
  assignedCount: integer("assigned_count").notNull().default(0),
  detail: text("detail"),
});

// Members a member_joined rule has already processed — new joiners are the
// set difference against this table on each cron tick.
export const lcRuleSeenMembers = pgTable("lc_rule_seen_members", {
  id: text("id").primaryKey(),
  ruleId: text("rule_id").notNull(),
  litmosUserId: text("litmos_user_id").notNull(),
  firstSeenAt: bigint("first_seen_at", { mode: "number" }).notNull(),
});

// Notification templates owned by the dashboard (Litmos exposes no template
// API). Team-scoped, optionally narrowed to ONE course (course-specific
// templates override the team default of the same type). Editing is gated on
// the team managing its own brand. Sends go out via the platform mailer,
// using the tenant's custom SMTP when configured.
export const lcNotificationTemplates = pgTable("lc_notification_templates", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull(),
  brand: text("brand"),
  type: text("type").notNull(), // welcome | assignment | due_reminder | compliance_reminder | custom
  // Null = the team's default template for this type; set = a per-course
  // override used when a send concerns that course.
  courseId: text("course_id"),
  name: text("name").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(), // plain text with {{placeholders}}
  active: boolean("active").notNull().default(true),
  updatedBy: text("updated_by").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

export const lcNotificationSends = pgTable("lc_notification_sends", {
  id: text("id").primaryKey(),
  teamId: text("team_id"),
  templateId: text("template_id"),
  type: text("type").notNull(),
  subject: text("subject"),
  recipientCount: integer("recipient_count").notNull().default(0),
  recipients: text("recipients"), // JSON string[] — all attempted recipient emails
  deliveredTo: text("delivered_to"), // JSON string[] — emails that actually sent (drives reminder cooldown)
  status: text("status").notNull(), // sent | partial | failed | skipped
  error: text("error"),
  sentBy: text("sent_by").notNull(), // admin email or "cron"
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

// Course duplication jobs (Content Library → Team Library). Litmos has no
// whole-course copy API, so this tracks the multi-step orchestration:
// bulk-import shell → resolve by code → attach modules → place in team library.
export const lcCourseCopies = pgTable("lc_course_copies", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull(),
  sourceCourseId: text("source_course_id").notNull(),
  sourceCourseName: text("source_course_name"),
  newCourseCode: text("new_course_code").notNull(),
  newCourseId: text("new_course_id"),
  newCourseName: text("new_course_name"),
  moduleMode: text("module_mode").notNull(), // copy | link | mirror
  status: text("status").notNull().default("pending"), // pending | shell_created | modules_attached | in_library | failed
  detail: text("detail"),
  requestedBy: text("requested_by").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

// Every mutating admin action, for accountability (Litmos's own audit API
// covers UI actions; this covers actions taken through the dashboard).
export const lcAuditLog = pgTable("lc_audit_log", {
  id: text("id").primaryKey(),
  actorEmail: text("actor_email").notNull(),
  actorRole: text("actor_role").notNull(),
  action: text("action").notNull(),
  targetType: text("target_type"), // user | team | course | learning_path | rule | template | copy | settings
  targetId: text("target_id"),
  targetLabel: text("target_label"),
  teamId: text("team_id"),
  detail: text("detail"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

// ─── tenant-level configuration (phase 2) ─────────────────────────────────────
// A "tenant" is a top-level Litmos team; its settings apply to the whole
// subtree. None of this exists in the Litmos API — the dashboard owns it.

export const lcTenantSettings = pgTable("lc_tenant_settings", {
  teamId: text("team_id").primaryKey(), // the tenant ROOT team id
  // Portal branding (learner-facing).
  portalName: text("portal_name"),
  logoUrl: text("logo_url"), // https URL to the tenant's logo
  primaryColor: text("primary_color"), // hex, e.g. #0F766E
  welcomeMessage: text("welcome_message"),
  // Custom outbound email: AES-256-GCM blob (platform encryptJson) of
  // { url, from, fromName } so each tenant sends from their own address.
  smtpEncrypted: text("smtp_encrypted"),
  smtpFromHint: text("smtp_from_hint"), // display-only, e.g. "training@meridianhealth.com"
  // Gamification configuration for the tenant.
  gamificationEnabled: boolean("gamification_enabled").notNull().default(true),
  showLeaderboard: boolean("show_leaderboard").notNull().default(true),
  pointsPerCompletion: integer("points_per_completion").notNull().default(0), // dashboard bonus per completion (0 = Litmos points only)
  updatedBy: text("updated_by").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

// Tenant-defined badges. Criteria: manual award, completing one specific
// course, or completing N courses. Auto criteria are evaluated on the rules
// cron and on demand.
export const lcBadges = pgTable("lc_badges", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull(), // tenant root
  title: text("title").notNull(),
  description: text("description"),
  emoji: text("emoji").notNull().default("★"),
  color: text("color").notNull().default("#6119E5"),
  criteriaType: text("criteria_type").notNull(), // manual | course_completed | courses_count
  criteriaCourseId: text("criteria_course_id"),
  criteriaCount: integer("criteria_count"),
  bonusPoints: integer("bonus_points").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdBy: text("created_by").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

// Dashboard-granted awards: a badge earned and/or bonus points. Merged with
// Litmos points into the leaderboards.
export const lcAwards = pgTable("lc_awards", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull(), // tenant root
  litmosUserId: text("litmos_user_id").notNull(),
  badgeId: text("badge_id"), // null = bare bonus points
  points: integer("points").notNull().default(0),
  reason: text("reason"),
  awardedBy: text("awarded_by").notNull(), // admin email or "auto"
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

// Certificate configuration per tenant (Litmos cert templates have no API —
// the dashboard issues print-ready certificates itself).
export const lcCertificateConfig = pgTable("lc_certificate_config", {
  teamId: text("team_id").primaryKey(), // tenant root
  enabled: boolean("enabled").notNull().default(false),
  titleText: text("title_text").notNull().default("Certificate of Completion"),
  messageText: text("message_text").notNull().default("has successfully completed"),
  signerName: text("signer_name"),
  signerTitle: text("signer_title"),
  scope: text("scope").notNull().default("all"), // all | selected
  courseIds: text("course_ids").notNull().default("[]"), // JSON string[] (scope=selected)
  learningPathIds: text("learning_path_ids").notNull().default("[]"), // JSON string[] (scope=selected)
  updatedBy: text("updated_by").notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

// Tenant API keys for the Learning Center's own REST API (/learning-center/
// api/v1/*), scoped to the key's tenant subtree. Raw token shown once; only
// the sha256 is stored.
export const lcApiKeys = pgTable("lc_api_keys", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull(), // tenant root
  name: text("name").notNull(),
  keyHash: text("key_hash").notNull(),
  keyPrefix: text("key_prefix").notNull(), // first chars, display only
  scopes: text("scopes").notNull().default('["read"]'), // JSON: read | assign
  createdBy: text("created_by").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  lastUsedAt: bigint("last_used_at", { mode: "number" }),
  revokedAt: bigint("revoked_at", { mode: "number" }),
});

export type LcTenantSettingsRow = typeof lcTenantSettings.$inferSelect;
export type LcBadgeRow = typeof lcBadges.$inferSelect;
export type LcAwardRow = typeof lcAwards.$inferSelect;
export type LcCertificateConfigRow = typeof lcCertificateConfig.$inferSelect;
export type LcApiKeyRow = typeof lcApiKeys.$inferSelect;

export type LcSessionRow = typeof lcSessions.$inferSelect;
export type LcLoginCodeRow = typeof lcLoginCodes.$inferSelect;
export type LcAssignmentRuleRow = typeof lcAssignmentRules.$inferSelect;
export type LcRuleRunRow = typeof lcRuleRuns.$inferSelect;
export type LcNotificationTemplateRow = typeof lcNotificationTemplates.$inferSelect;
export type LcNotificationSendRow = typeof lcNotificationSends.$inferSelect;
export type LcCourseCopyRow = typeof lcCourseCopies.$inferSelect;
export type LcAuditLogRow = typeof lcAuditLog.$inferSelect;
