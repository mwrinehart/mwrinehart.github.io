// Behavior module DDL. Called from the platform runMigrations() after the
// platform tables exist. Every ported module ships one of these — it owns its
// own tables and keeps them self-contained.

import type { PoolClient } from "pg";

export async function migrateBehavior(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS behavior_people (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      email TEXT NOT NULL,
      name TEXT,
      department TEXT,
      group_name TEXT,
      risk_score INTEGER NOT NULL DEFAULT 0,
      last_active_at BIGINT,
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_behavior_people_org ON behavior_people(org_id);

    CREATE TABLE IF NOT EXISTS behaviors (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      person_id TEXT NOT NULL,
      behavior_type TEXT,
      description TEXT,
      severity TEXT NOT NULL DEFAULT 'medium',
      detected_at BIGINT NOT NULL,
      resolved BOOLEAN NOT NULL DEFAULT FALSE,
      resolved_at BIGINT
    );
    CREATE INDEX IF NOT EXISTS idx_behaviors_org ON behaviors(org_id);

    CREATE TABLE IF NOT EXISTS risk_score_history (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      person_id TEXT NOT NULL,
      score INTEGER NOT NULL,
      recorded_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_risk_hist_org ON risk_score_history(org_id);

    CREATE TABLE IF NOT EXISTS nudge_configs (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      title TEXT,
      message TEXT,
      trigger TEXT,
      delivery_channels TEXT NOT NULL DEFAULT 'device',
      slack_channel TEXT,
      teams_webhook_id TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_nudge_configs_org ON nudge_configs(org_id);

    CREATE TABLE IF NOT EXISTS nudge_events (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      person_id TEXT,
      nudge_id TEXT,
      action TEXT,
      delivery_channel TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      title TEXT,
      message TEXT,
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_nudge_events_org ON nudge_events(org_id);

    CREATE TABLE IF NOT EXISTS pulse_feeds (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      category TEXT,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      last_scanned_at BIGINT,
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pulse_feeds_org ON pulse_feeds(org_id);

    CREATE TABLE IF NOT EXISTS pulse_findings (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      feed_id TEXT,
      feed_name TEXT,
      title TEXT NOT NULL,
      summary TEXT,
      link TEXT,
      severity TEXT NOT NULL DEFAULT 'medium',
      category TEXT,
      keywords TEXT,
      published_at BIGINT,
      scanned_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pulse_findings_org ON pulse_findings(org_id);
    -- Dedupe findings by link within an org.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pulse_findings_link ON pulse_findings(org_id, link);

    CREATE TABLE IF NOT EXISTS behavior_groups (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      external_id TEXT,
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_behavior_groups_org ON behavior_groups(org_id);

    CREATE TABLE IF NOT EXISTS data_source_configs (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      name TEXT NOT NULL,
      base_url TEXT,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      metadata TEXT,
      last_sync_at BIGINT,
      last_status TEXT,
      last_error TEXT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_dsc_org_provider ON data_source_configs(org_id, provider);

    CREATE TABLE IF NOT EXISTS data_sync_runs (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      started_at BIGINT NOT NULL,
      finished_at BIGINT,
      summary TEXT,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sync_runs_org ON data_sync_runs(org_id, provider, started_at DESC);

    CREATE TABLE IF NOT EXISTS imported_campaign_events (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      external_id TEXT NOT NULL,
      campaign_type TEXT,
      name TEXT,
      status TEXT,
      user_email TEXT,
      user_id TEXT,
      group_name TEXT,
      event_type TEXT,
      event_at BIGINT,
      raw_json TEXT,
      imported_at BIGINT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ice_unique ON imported_campaign_events(org_id, provider, external_id);
    CREATE INDEX IF NOT EXISTS idx_ice_org_email ON imported_campaign_events(org_id, user_email);

    CREATE TABLE IF NOT EXISTS triage_email_events (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      external_id TEXT NOT NULL,
      subject TEXT,
      sender TEXT,
      recipient_email TEXT,
      verdict TEXT,
      severity TEXT,
      status TEXT,
      reported_at BIGINT,
      raw_json TEXT,
      imported_at BIGINT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tee_unique ON triage_email_events(org_id, provider, external_id);

    CREATE TABLE IF NOT EXISTS imported_lms_records (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      record_type TEXT NOT NULL,
      external_id TEXT NOT NULL,
      user_email TEXT,
      title TEXT,
      status TEXT,
      score INTEGER,
      completed_at BIGINT,
      raw_json TEXT,
      imported_at BIGINT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ilms_unique ON imported_lms_records(org_id, provider, record_type, external_id);

    CREATE TABLE IF NOT EXISTS pulse_keywords (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      term TEXT NOT NULL,
      category TEXT,
      severity_floor TEXT,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      match_count INTEGER NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pulse_keywords_org ON pulse_keywords(org_id);

    CREATE TABLE IF NOT EXISTS pulse_auto_routes (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      name TEXT NOT NULL,
      severity_min TEXT NOT NULL DEFAULT 'critical',
      categories TEXT,
      channel_provider TEXT NOT NULL,
      channel_target TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      sent_count INTEGER NOT NULL DEFAULT 0,
      last_sent_at BIGINT,
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pulse_routes_org ON pulse_auto_routes(org_id);

    CREATE TABLE IF NOT EXISTS pulse_digests (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      name TEXT NOT NULL,
      frequency TEXT NOT NULL DEFAULT 'daily',
      day_of_week INTEGER,
      hour INTEGER NOT NULL DEFAULT 9,
      recipients TEXT NOT NULL,
      severity_min TEXT NOT NULL DEFAULT 'medium',
      categories TEXT,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      last_run_at BIGINT,
      last_status TEXT,
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pulse_digests_org ON pulse_digests(org_id);
  `);
}
