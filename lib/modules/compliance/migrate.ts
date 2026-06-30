// Compliance module DDL. Registered with the platform runMigrations() runner.

import type { PoolClient } from "pg";

export async function migrateCompliance(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS compliance_feeds (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      category TEXT,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      last_scanned_at BIGINT,
      last_error TEXT,
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_compliance_feeds_org ON compliance_feeds(org_id);

    CREATE TABLE IF NOT EXISTS compliance_policies (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      title TEXT NOT NULL,
      reference TEXT,
      category TEXT,
      content TEXT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_compliance_policies_org ON compliance_policies(org_id);

    CREATE TABLE IF NOT EXISTS compliance_findings (
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
    CREATE INDEX IF NOT EXISTS idx_compliance_findings_org ON compliance_findings(org_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_compliance_findings_link ON compliance_findings(org_id, link);
    ALTER TABLE compliance_findings ADD COLUMN IF NOT EXISTS ai_summary TEXT;
    ALTER TABLE compliance_findings ADD COLUMN IF NOT EXISTS ai_actions TEXT;
    ALTER TABLE compliance_findings ADD COLUMN IF NOT EXISTS mapped_policies TEXT;
    ALTER TABLE compliance_findings ADD COLUMN IF NOT EXISTS analyzed_at BIGINT;
    ALTER TABLE compliance_findings ADD COLUMN IF NOT EXISTS score INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE compliance_findings ADD COLUMN IF NOT EXISTS routed_severity TEXT;

    CREATE TABLE IF NOT EXISTS compliance_keywords (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      term TEXT NOT NULL,
      category TEXT,
      severity_floor TEXT,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      match_count INTEGER NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_compliance_keywords_org ON compliance_keywords(org_id);

    CREATE TABLE IF NOT EXISTS compliance_feedback (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      finding_id TEXT NOT NULL,
      vote TEXT NOT NULL,
      category TEXT,
      feed_name TEXT,
      severity TEXT,
      keywords TEXT,
      created_at BIGINT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_compliance_feedback_unique ON compliance_feedback(org_id, finding_id);

    CREATE TABLE IF NOT EXISTS compliance_auto_routes (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      name TEXT NOT NULL,
      severity_min TEXT NOT NULL DEFAULT 'high',
      categories TEXT,
      channel_provider TEXT NOT NULL,
      channel_target TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      sent_count INTEGER NOT NULL DEFAULT 0,
      last_sent_at BIGINT,
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_compliance_routes_org ON compliance_auto_routes(org_id);

    CREATE TABLE IF NOT EXISTS compliance_connectors (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      type TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT FALSE,
      config TEXT,
      last_scanned_at BIGINT,
      last_error TEXT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_compliance_connectors_unique ON compliance_connectors(org_id, type);
  `);
}
