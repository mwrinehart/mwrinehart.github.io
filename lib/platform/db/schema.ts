// ─── Jericho Platform — shared data model ─────────────────────────────────────
//
// This is the *platform spine*: identity, tenancy, membership, per-org settings
// and encrypted integration secrets. It is owned by the platform, not by any one
// module, and is the table set that used to be re-implemented (inconsistently) in
// all four source apps (Make, Mirage, Horizon, CBM).
//
// Modules add their own tables in lib/modules/<name>/schema.ts and this file
// re-exports them so Drizzle Kit sees one schema. Tenant isolation everywhere is
// by `orgId` — never by separate databases.
//
// Convention (inherited from Make): timestamps are epoch-milliseconds stored as
// bigint in `{ mode: "number" }`.

import { bigint, integer, pgTable, text } from "drizzle-orm/pg-core";

// Auth.js identity. A *login account* — distinct from a "monitored person" in
// the Behavior module (a key reconciliation: CBM conflated the two).
export const users = pgTable("users", {
  id: text("id").primaryKey(), // Auth.js user id
  // Nullable: a provider may omit the email claim on first sign-in.
  email: text("email"),
  name: text("name"),
  passwordHash: text("password_hash"),
  activeOrgId: text("active_org_id"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

// Tenant. Merges Make's orgs (plan/stripe) with CBM's orgs (slug/settings/
// encrypted_secrets) into one shape.
export const orgs = pgTable("orgs", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  // free | team | enterprise (module entitlements derive from this + settings)
  plan: text("plan").notNull().default("free"),
  stripeCustomerId: text("stripe_customer_id"),
  // Free-form JSON: enabled modules, feature flags, branding pointers.
  settings: text("settings"),
  // AES-256-GCM blob of third-party credentials (see lib/platform/secrets.ts).
  encryptedSecrets: text("encrypted_secrets"),
  // Opaque public key used to scope unauthenticated embeddable widgets (nudges).
  widgetPublicKey: text("widget_public_key"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

export const orgMembers = pgTable("org_members", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  userId: text("user_id").notNull(),
  role: text("role").notNull().default("member"), // owner | admin | member | viewer
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

export const invites = pgTable("invites", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  email: text("email").notNull(),
  role: text("role").notNull().default("member"),
  token: text("token").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  acceptedAt: bigint("accepted_at", { mode: "number" }),
});

// Per-org branding + module toggles surfaced in Settings.
export const orgSettings = pgTable("org_settings", {
  orgId: text("org_id").primaryKey(),
  companyName: text("company_name"),
  logoUrl: text("logo_url"),
  primaryColor: text("primary_color"),
  accentColor: text("accent_color"),
  // JSON array of enabled module ids, e.g. ["behavior","compliance"].
  enabledModules: text("enabled_modules"),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

// Global key/value config (platform-wide, not org-scoped).
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

// Audit trail of platform-admin impersonation (subsystem ported in a later phase;
// the table lands now so the audit log is continuous from day one).
export const impersonationLog = pgTable("impersonation_log", {
  id: text("id").primaryKey(),
  adminUserId: text("admin_user_id").notNull(),
  adminEmail: text("admin_email"),
  targetUserId: text("target_user_id").notNull(),
  targetEmail: text("target_email"),
  action: text("action").notNull(), // start | stop
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

// Append-only outbound-notification log (consolidates CBM's comms_messages and
// the ad-hoc send logs in Horizon). Every Slack/Teams/email send lands here.
export const notificationLog = pgTable("notification_log", {
  id: text("id").primaryKey(),
  orgId: text("org_id"),
  channel: text("channel").notNull(), // slack | teams | email
  target: text("target"),
  module: text("module"), // which module triggered it
  subject: text("subject"),
  status: text("status").notNull(), // sent | failed | skipped
  error: text("error"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

// Append-only log of scheduled-job executions (platform cron layer).
export const cronRuns = pgTable("cron_runs", {
  id: text("id").primaryKey(),
  job: text("job").notNull(),
  status: text("status").notNull(), // success | failed
  startedAt: bigint("started_at", { mode: "number" }).notNull(),
  finishedAt: bigint("finished_at", { mode: "number" }),
  summary: text("summary"),
  error: text("error"),
});

export type UserRow = typeof users.$inferSelect;
export type OrgRow = typeof orgs.$inferSelect;
export type OrgMemberRow = typeof orgMembers.$inferSelect;
export type InviteRow = typeof invites.$inferSelect;
export type OrgSettingsRow = typeof orgSettings.$inferSelect;

// ─── Module schemas ───────────────────────────────────────────────────────────
// Each ported module appends its tables here.
export * from "@/lib/modules/behavior/schema";
export * from "@/lib/modules/compliance/schema";
export * from "@/lib/modules/campaigns/schema";
export * from "@/lib/modules/studio/schema";
export * from "@/lib/modules/narrative/schema";
