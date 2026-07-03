// LMS module tables. The LMS is the full Litmos admin surface: a per-org mirror
// of the Litmos catalog/directory (so the UI is fast and works offline from the
// API), plus assignments with due/compliance dates, the rules engine, and the
// notification-management layer. Everything is org-scoped; litmos* columns hold
// Litmos-side ids, never local ones.

import { bigint, boolean, integer, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";

// ─── Litmos mirror ────────────────────────────────────────────────────────────

export const lmsCourses = pgTable(
  "lms_courses",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    litmosId: text("litmos_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    code: text("code"),
    active: boolean("active").notNull().default(true),
    source: text("source").notNull().default("litmos"), // litmos | studio
    enrolledCount: integer("enrolled_count").notNull().default(0),
    completedCount: integer("completed_count").notNull().default(0),
    litmosCreatedAt: bigint("litmos_created_at", { mode: "number" }),
    syncedAt: bigint("synced_at", { mode: "number" }),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => [uniqueIndex("uq_lms_courses_org_litmos").on(t.orgId, t.litmosId)],
);

export const lmsLearners = pgTable(
  "lms_learners",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    litmosId: text("litmos_id").notNull(),
    email: text("email"),
    firstName: text("first_name"),
    lastName: text("last_name"),
    fullName: text("full_name"),
    active: boolean("active").notNull().default(true),
    litmosCreatedAt: bigint("litmos_created_at", { mode: "number" }),
    lastLoginAt: bigint("last_login_at", { mode: "number" }),
    syncedAt: bigint("synced_at", { mode: "number" }),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => [uniqueIndex("uq_lms_learners_org_litmos").on(t.orgId, t.litmosId)],
);

export const lmsTeams = pgTable(
  "lms_teams",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    litmosId: text("litmos_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    parentLitmosId: text("parent_litmos_id"),
    syncedAt: bigint("synced_at", { mode: "number" }),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => [uniqueIndex("uq_lms_teams_org_litmos").on(t.orgId, t.litmosId)],
);

export const lmsTeamMembers = pgTable(
  "lms_team_members",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    teamLitmosId: text("team_litmos_id").notNull(),
    learnerLitmosId: text("learner_litmos_id").notNull(),
    syncedAt: bigint("synced_at", { mode: "number" }),
  },
  (t) => [uniqueIndex("uq_lms_team_members").on(t.orgId, t.teamLitmosId, t.learnerLitmosId)],
);

// ─── assignments ──────────────────────────────────────────────────────────────

export const lmsAssignments = pgTable("lms_assignments", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  learnerEmail: text("learner_email").notNull(),
  learnerName: text("learner_name"),
  litmosUserId: text("litmos_user_id"),
  courseLitmosId: text("course_litmos_id").notNull(),
  courseName: text("course_name"),
  assignedBy: text("assigned_by"), // user email/id, or "rule:<ruleId>"
  ruleId: text("rule_id"),
  assignedAt: bigint("assigned_at", { mode: "number" }).notNull(),
  scheduledFor: bigint("scheduled_for", { mode: "number" }),
  dueDate: bigint("due_date", { mode: "number" }),
  status: text("status").notNull().default("pending"), // pending | scheduled | active | completed | overdue | failed | cancelled
  activatedAt: bigint("activated_at", { mode: "number" }),
  completedAt: bigint("completed_at", { mode: "number" }),
  score: integer("score"),
  litmosResponse: text("litmos_response"),
  notes: text("notes"),
  lastPolledAt: bigint("last_polled_at", { mode: "number" }), // completion-poll fairness cursor
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

// ─── compliance ───────────────────────────────────────────────────────────────

export const lmsComplianceProfiles = pgTable("lms_compliance_profiles", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  name: text("name").notNull(),
  courseLitmosId: text("course_litmos_id").notNull(),
  courseName: text("course_name"),
  renewalMonths: integer("renewal_months").notNull(),
  warnDays: integer("warn_days").notNull().default(30),
  autoReassign: boolean("auto_reassign").notNull().default(true),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

export const lmsComplianceRecords = pgTable(
  "lms_compliance_records",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    profileId: text("profile_id").notNull(),
    learnerEmail: text("learner_email").notNull(),
    learnerName: text("learner_name"),
    courseLitmosId: text("course_litmos_id"),
    lastCompletedAt: bigint("last_completed_at", { mode: "number" }),
    expiresAt: bigint("expires_at", { mode: "number" }),
    status: text("status").notNull().default("never"), // never | compliant | expiring | expired
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [uniqueIndex("uq_lms_compliance_records").on(t.orgId, t.profileId, t.learnerEmail)],
);

// ─── rules engine ─────────────────────────────────────────────────────────────

export const lmsRules = pgTable("lms_rules", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  trigger: text("trigger").notNull(), // RuleTrigger (types.ts)
  conditions: text("conditions"), // JSON RuleConditions
  actions: text("actions"), // JSON RuleAction[]
  enabled: boolean("enabled").notNull().default(true),
  createdBy: text("created_by"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  lastFiredAt: bigint("last_fired_at", { mode: "number" }),
  fireCount: integer("fire_count").notNull().default(0),
});

// One row per (rule, dedupe key): the idempotency ledger that makes rule firing
// safe to re-run from sync, webhooks, and cron without double-executing actions.
export const lmsRuleRuns = pgTable(
  "lms_rule_runs",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    ruleId: text("rule_id").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    subject: text("subject"), // JSON LmsEvent snapshot
    results: text("results"), // JSON per-action outcomes
    status: text("status").notNull().default("ok"), // ok | partial | failed
    firedAt: bigint("fired_at", { mode: "number" }).notNull(),
  },
  (t) => [uniqueIndex("uq_lms_rule_runs_dedupe").on(t.ruleId, t.dedupeKey)],
);

// ─── notifications ────────────────────────────────────────────────────────────

export const lmsNotificationTemplates = pgTable(
  "lms_notification_templates",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    key: text("key").notNull(), // TemplateKey (types.ts)
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [uniqueIndex("uq_lms_templates_org_key").on(t.orgId, t.key)],
);

// One row per (assignment, kind, bucket): the reminder ledger. Crossing into a
// smaller cadence bucket inserts a new row, so each window fires exactly once.
export const lmsReminderLog = pgTable(
  "lms_reminder_log",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    assignmentId: text("assignment_id").notNull(),
    kind: text("kind").notNull(), // due_soon | overdue
    bucket: integer("bucket").notNull().default(0),
    sentAt: bigint("sent_at", { mode: "number" }).notNull(),
  },
  (t) => [uniqueIndex("uq_lms_reminders").on(t.assignmentId, t.kind, t.bucket)],
);

// Per-org LMS configuration (non-secret; credentials live in the secret store).
export const lmsSettings = pgTable("lms_settings", {
  orgId: text("org_id").primaryKey(),
  reminderDays: text("reminder_days"), // JSON number[] (default [14,7,3,1])
  channels: text("channels"), // JSON NotifyChannelId[] — admin channels for LMS notices
  notifyLearners: boolean("notify_learners").notNull().default(true), // email learners directly
  adminEmail: text("admin_email"), // recipient for the admin "email" channel (email has no org-default target)
  featuredCourseId: text("featured_course_id"), // litmos id pinned to the library hero
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

export const lmsSyncRuns = pgTable("lms_sync_runs", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  status: text("status").notNull().default("running"), // running | success | partial | failed
  startedAt: bigint("started_at", { mode: "number" }).notNull(),
  finishedAt: bigint("finished_at", { mode: "number" }),
  summary: text("summary"), // JSON step counts
  error: text("error"),
});

export type LmsCourseRow = typeof lmsCourses.$inferSelect;
export type LmsLearnerRow = typeof lmsLearners.$inferSelect;
export type LmsTeamRow = typeof lmsTeams.$inferSelect;
export type LmsTeamMemberRow = typeof lmsTeamMembers.$inferSelect;
export type LmsAssignmentRow = typeof lmsAssignments.$inferSelect;
export type LmsComplianceProfileRow = typeof lmsComplianceProfiles.$inferSelect;
export type LmsComplianceRecordRow = typeof lmsComplianceRecords.$inferSelect;
export type LmsRuleRow = typeof lmsRules.$inferSelect;
export type LmsRuleRunRow = typeof lmsRuleRuns.$inferSelect;
export type LmsNotificationTemplateRow = typeof lmsNotificationTemplates.$inferSelect;
export type LmsSettingsRow = typeof lmsSettings.$inferSelect;
export type LmsSyncRunRow = typeof lmsSyncRuns.$inferSelect;
