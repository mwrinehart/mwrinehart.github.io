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
  `);
}
