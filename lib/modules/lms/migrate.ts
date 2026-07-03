// LMS module DDL. Registered with the platform runMigrations() runner.

import type { PoolClient } from "pg";

export async function migrateLms(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS lms_courses (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      litmos_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      code TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      source TEXT NOT NULL DEFAULT 'litmos',
      enrolled_count INTEGER NOT NULL DEFAULT 0,
      completed_count INTEGER NOT NULL DEFAULT 0,
      litmos_created_at BIGINT,
      synced_at BIGINT,
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_lms_courses_org ON lms_courses(org_id);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_lms_courses_org_litmos ON lms_courses(org_id, litmos_id);

    CREATE TABLE IF NOT EXISTS lms_learners (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      litmos_id TEXT NOT NULL,
      email TEXT,
      first_name TEXT,
      last_name TEXT,
      full_name TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      litmos_created_at BIGINT,
      last_login_at BIGINT,
      synced_at BIGINT,
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_lms_learners_org ON lms_learners(org_id);
    CREATE INDEX IF NOT EXISTS idx_lms_learners_org_email ON lms_learners(org_id, email);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_lms_learners_org_litmos ON lms_learners(org_id, litmos_id);

    CREATE TABLE IF NOT EXISTS lms_teams (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      litmos_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      parent_litmos_id TEXT,
      synced_at BIGINT,
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_lms_teams_org ON lms_teams(org_id);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_lms_teams_org_litmos ON lms_teams(org_id, litmos_id);

    CREATE TABLE IF NOT EXISTS lms_team_members (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      team_litmos_id TEXT NOT NULL,
      learner_litmos_id TEXT NOT NULL,
      synced_at BIGINT
    );
    CREATE INDEX IF NOT EXISTS idx_lms_team_members_org ON lms_team_members(org_id);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_lms_team_members ON lms_team_members(org_id, team_litmos_id, learner_litmos_id);

    CREATE TABLE IF NOT EXISTS lms_assignments (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      learner_email TEXT NOT NULL,
      learner_name TEXT,
      litmos_user_id TEXT,
      course_litmos_id TEXT NOT NULL,
      course_name TEXT,
      assigned_by TEXT,
      rule_id TEXT,
      assigned_at BIGINT NOT NULL,
      scheduled_for BIGINT,
      due_date BIGINT,
      status TEXT NOT NULL DEFAULT 'pending',
      activated_at BIGINT,
      completed_at BIGINT,
      score INTEGER,
      litmos_response TEXT,
      notes TEXT,
      updated_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_lms_assignments_org ON lms_assignments(org_id);
    CREATE INDEX IF NOT EXISTS idx_lms_assignments_org_status ON lms_assignments(org_id, status);
    CREATE INDEX IF NOT EXISTS idx_lms_assignments_status_due ON lms_assignments(status, due_date);
    ALTER TABLE lms_assignments ADD COLUMN IF NOT EXISTS last_polled_at BIGINT;

    CREATE TABLE IF NOT EXISTS lms_compliance_profiles (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      name TEXT NOT NULL,
      course_litmos_id TEXT NOT NULL,
      course_name TEXT,
      renewal_months INTEGER NOT NULL,
      warn_days INTEGER NOT NULL DEFAULT 30,
      auto_reassign BOOLEAN NOT NULL DEFAULT TRUE,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_lms_compliance_profiles_org ON lms_compliance_profiles(org_id);

    CREATE TABLE IF NOT EXISTS lms_compliance_records (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      profile_id TEXT NOT NULL,
      learner_email TEXT NOT NULL,
      learner_name TEXT,
      course_litmos_id TEXT,
      last_completed_at BIGINT,
      expires_at BIGINT,
      status TEXT NOT NULL DEFAULT 'never',
      updated_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_lms_compliance_records_org ON lms_compliance_records(org_id);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_lms_compliance_records ON lms_compliance_records(org_id, profile_id, learner_email);

    CREATE TABLE IF NOT EXISTS lms_rules (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      trigger TEXT NOT NULL,
      conditions TEXT,
      actions TEXT,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_by TEXT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      last_fired_at BIGINT,
      fire_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_lms_rules_org ON lms_rules(org_id);

    CREATE TABLE IF NOT EXISTS lms_rule_runs (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      rule_id TEXT NOT NULL,
      dedupe_key TEXT NOT NULL,
      subject TEXT,
      results TEXT,
      status TEXT NOT NULL DEFAULT 'ok',
      fired_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_lms_rule_runs_org ON lms_rule_runs(org_id);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_lms_rule_runs_dedupe ON lms_rule_runs(rule_id, dedupe_key);

    CREATE TABLE IF NOT EXISTS lms_notification_templates (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      key TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at BIGINT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_lms_templates_org_key ON lms_notification_templates(org_id, key);

    CREATE TABLE IF NOT EXISTS lms_reminder_log (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      assignment_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      bucket INTEGER NOT NULL DEFAULT 0,
      sent_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_lms_reminder_log_org ON lms_reminder_log(org_id);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_lms_reminders ON lms_reminder_log(assignment_id, kind, bucket);

    CREATE TABLE IF NOT EXISTS lms_settings (
      org_id TEXT PRIMARY KEY,
      reminder_days TEXT,
      channels TEXT,
      notify_learners BOOLEAN NOT NULL DEFAULT TRUE,
      admin_email TEXT,
      featured_course_id TEXT,
      updated_at BIGINT NOT NULL
    );
    ALTER TABLE lms_settings ADD COLUMN IF NOT EXISTS admin_email TEXT;

    CREATE TABLE IF NOT EXISTS lms_sync_runs (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      started_at BIGINT NOT NULL,
      finished_at BIGINT,
      summary TEXT,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_lms_sync_runs_org ON lms_sync_runs(org_id);
  `);
}
