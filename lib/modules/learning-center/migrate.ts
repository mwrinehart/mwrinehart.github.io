import type { PoolClient } from "pg";

export async function migrateLearningCenter(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS lc_sessions (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL,
      email TEXT NOT NULL,
      display_name TEXT,
      litmos_user_id TEXT,
      role TEXT NOT NULL,
      admin_team_ids TEXT NOT NULL DEFAULT '[]',
      created_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_lc_sessions_token ON lc_sessions(token_hash);
    CREATE INDEX IF NOT EXISTS idx_lc_sessions_email ON lc_sessions(email);

    CREATE TABLE IF NOT EXISTS lc_login_codes (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      consumed_at BIGINT,
      created_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_lc_login_codes_email ON lc_login_codes(email, created_at DESC);

    CREATE TABLE IF NOT EXISTS lc_assignment_rules (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      team_name TEXT,
      name TEXT NOT NULL,
      trigger TEXT NOT NULL, -- member_joined | schedule
      interval_days INTEGER,
      course_ids TEXT NOT NULL DEFAULT '[]',
      learning_path_ids TEXT NOT NULL DEFAULT '[]',
      include_subteams BOOLEAN NOT NULL DEFAULT FALSE,
      send_litmos_email BOOLEAN NOT NULL DEFAULT FALSE,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      last_run_at BIGINT
    );
    CREATE INDEX IF NOT EXISTS idx_lc_rules_team ON lc_assignment_rules(team_id);

    CREATE TABLE IF NOT EXISTS lc_rule_runs (
      id TEXT PRIMARY KEY,
      rule_id TEXT NOT NULL,
      ran_at BIGINT NOT NULL,
      status TEXT NOT NULL, -- success | failed | skipped
      assigned_count INTEGER NOT NULL DEFAULT 0,
      detail TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_lc_rule_runs_rule ON lc_rule_runs(rule_id, ran_at DESC);

    CREATE TABLE IF NOT EXISTS lc_rule_seen_members (
      id TEXT PRIMARY KEY,
      rule_id TEXT NOT NULL,
      litmos_user_id TEXT NOT NULL,
      first_seen_at BIGINT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_lc_rule_seen_unique ON lc_rule_seen_members(rule_id, litmos_user_id);

    CREATE TABLE IF NOT EXISTS lc_notification_templates (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      brand TEXT,
      type TEXT NOT NULL, -- welcome | assignment | due_reminder | compliance_reminder | custom
      name TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      updated_by TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_lc_templates_team ON lc_notification_templates(team_id);

    CREATE TABLE IF NOT EXISTS lc_notification_sends (
      id TEXT PRIMARY KEY,
      team_id TEXT,
      template_id TEXT,
      type TEXT NOT NULL,
      subject TEXT,
      recipient_count INTEGER NOT NULL DEFAULT 0,
      recipients TEXT,
      delivered_to TEXT,
      status TEXT NOT NULL, -- sent | partial | failed | skipped
      error TEXT,
      sent_by TEXT NOT NULL,
      created_at BIGINT NOT NULL
    );
    ALTER TABLE lc_notification_sends ADD COLUMN IF NOT EXISTS delivered_to TEXT;
    CREATE INDEX IF NOT EXISTS idx_lc_sends_team ON lc_notification_sends(team_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS lc_course_copies (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      source_course_id TEXT NOT NULL,
      source_course_name TEXT,
      new_course_code TEXT NOT NULL,
      new_course_id TEXT,
      new_course_name TEXT,
      module_mode TEXT NOT NULL, -- copy | link | mirror
      status TEXT NOT NULL DEFAULT 'pending', -- pending | shell_created | modules_attached | in_library | failed
      detail TEXT,
      requested_by TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_lc_copies_team ON lc_course_copies(team_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS lc_audit_log (
      id TEXT PRIMARY KEY,
      actor_email TEXT NOT NULL,
      actor_role TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      target_label TEXT,
      team_id TEXT,
      detail TEXT,
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_lc_audit_created ON lc_audit_log(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_lc_audit_team ON lc_audit_log(team_id, created_at DESC);

    -- phase 2: per-course templates + rule notification actions
    ALTER TABLE lc_notification_templates ADD COLUMN IF NOT EXISTS course_id TEXT;
    ALTER TABLE lc_assignment_rules ADD COLUMN IF NOT EXISTS send_template_type TEXT;
    ALTER TABLE lc_assignment_rules ADD COLUMN IF NOT EXISTS notify_audience TEXT;

    -- phase 2: tenant-level configuration (tenant = top-level Litmos team)
    CREATE TABLE IF NOT EXISTS lc_tenant_settings (
      team_id TEXT PRIMARY KEY,
      portal_name TEXT,
      logo_url TEXT,
      primary_color TEXT,
      welcome_message TEXT,
      smtp_encrypted TEXT,
      smtp_from_hint TEXT,
      gamification_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      show_leaderboard BOOLEAN NOT NULL DEFAULT TRUE,
      points_per_completion INTEGER NOT NULL DEFAULT 0,
      updated_by TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS lc_badges (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      emoji TEXT NOT NULL DEFAULT '★',
      color TEXT NOT NULL DEFAULT '#6119E5',
      criteria_type TEXT NOT NULL, -- manual | course_completed | courses_count
      criteria_course_id TEXT,
      criteria_count INTEGER,
      bonus_points INTEGER NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by TEXT NOT NULL,
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_lc_badges_team ON lc_badges(team_id);

    CREATE TABLE IF NOT EXISTS lc_awards (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      litmos_user_id TEXT NOT NULL,
      badge_id TEXT,
      points INTEGER NOT NULL DEFAULT 0,
      reason TEXT,
      awarded_by TEXT NOT NULL,
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_lc_awards_team ON lc_awards(team_id);
    CREATE INDEX IF NOT EXISTS idx_lc_awards_user ON lc_awards(litmos_user_id);
    -- one auto-award per badge per user (bare bonus points have NULL badge_id
    -- and are exempt from the uniqueness rule)
    CREATE UNIQUE INDEX IF NOT EXISTS idx_lc_awards_badge_user ON lc_awards(badge_id, litmos_user_id) WHERE badge_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS lc_certificate_config (
      team_id TEXT PRIMARY KEY,
      enabled BOOLEAN NOT NULL DEFAULT FALSE,
      title_text TEXT NOT NULL DEFAULT 'Certificate of Completion',
      message_text TEXT NOT NULL DEFAULT 'has successfully completed',
      signer_name TEXT,
      signer_title TEXT,
      scope TEXT NOT NULL DEFAULT 'all', -- all | selected
      course_ids TEXT NOT NULL DEFAULT '[]',
      learning_path_ids TEXT NOT NULL DEFAULT '[]',
      updated_by TEXT NOT NULL,
      updated_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS lc_api_keys (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      name TEXT NOT NULL,
      key_hash TEXT NOT NULL,
      key_prefix TEXT NOT NULL,
      scopes TEXT NOT NULL DEFAULT '["read"]',
      created_by TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      last_used_at BIGINT,
      revoked_at BIGINT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_lc_api_keys_hash ON lc_api_keys(key_hash);
    CREATE INDEX IF NOT EXISTS idx_lc_api_keys_team ON lc_api_keys(team_id);
  `);
}
