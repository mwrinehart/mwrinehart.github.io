// Idempotent raw DDL for the Narrative module, run at startup by the platform
// migration runner (lib/platform/db/index.ts). Keep in sync with ./schema.ts.

import type { PoolClient } from "pg";

export async function migrateNarrative(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS narrative_sources (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'rss',
      platform TEXT NOT NULL DEFAULT 'news',
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      last_scanned_at BIGINT,
      last_error TEXT,
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_narrative_sources_org ON narrative_sources(org_id);

    CREATE TABLE IF NOT EXISTS narrative_watch_terms (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      term TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      match_count INTEGER NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_narrative_watch_terms_org ON narrative_watch_terms(org_id);

    CREATE TABLE IF NOT EXISTS narrative_mentions (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      source_id TEXT,
      source_name TEXT,
      platform TEXT NOT NULL DEFAULT 'news',
      url TEXT NOT NULL,
      author TEXT,
      title TEXT NOT NULL,
      excerpt TEXT,
      matched_terms TEXT,
      reach INTEGER NOT NULL DEFAULT 0,
      narrative_id TEXT,
      published_at BIGINT,
      fetched_at BIGINT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_narrative_mentions_url ON narrative_mentions(org_id, url);
    CREATE INDEX IF NOT EXISTS idx_narrative_mentions_org ON narrative_mentions(org_id);
    CREATE INDEX IF NOT EXISTS idx_narrative_mentions_cluster ON narrative_mentions(org_id, narrative_id);

    CREATE TABLE IF NOT EXISTS narratives (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      title TEXT NOT NULL,
      claim TEXT,
      summary TEXT,
      status TEXT NOT NULL DEFAULT 'emerging',
      verdict TEXT NOT NULL DEFAULT 'unverified',
      verdict_confidence INTEGER NOT NULL DEFAULT 0,
      verdict_rationale TEXT,
      verdict_source TEXT,
      analyzed_at BIGINT,
      threat_score INTEGER NOT NULL DEFAULT 0,
      mention_count INTEGER NOT NULL DEFAULT 0,
      total_reach INTEGER NOT NULL DEFAULT 0,
      velocity INTEGER NOT NULL DEFAULT 0,
      alerted_severity TEXT,
      first_seen_at BIGINT NOT NULL,
      last_seen_at BIGINT NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_narratives_org ON narratives(org_id);
    CREATE INDEX IF NOT EXISTS idx_narratives_org_score ON narratives(org_id, threat_score DESC);

    CREATE TABLE IF NOT EXISTS narrative_facts (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      topic TEXT NOT NULL,
      statement TEXT NOT NULL,
      source_url TEXT,
      created_by_user_id TEXT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_narrative_facts_org ON narrative_facts(org_id);

    CREATE TABLE IF NOT EXISTS narrative_alerts (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      narrative_id TEXT NOT NULL,
      severity TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      acknowledged_by_user_id TEXT,
      acknowledged_at BIGINT,
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_narrative_alerts_org ON narrative_alerts(org_id, status);

    CREATE TABLE IF NOT EXISTS narrative_routes (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      name TEXT NOT NULL,
      severity_min TEXT NOT NULL DEFAULT 'high',
      channel_provider TEXT NOT NULL,
      channel_target TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      sent_count INTEGER NOT NULL DEFAULT 0,
      last_sent_at BIGINT,
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_narrative_routes_org ON narrative_routes(org_id);

    CREATE TABLE IF NOT EXISTS narrative_responses (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      narrative_id TEXT NOT NULL,
      posture TEXT NOT NULL DEFAULT 'monitor',
      strategy TEXT,
      draft_message TEXT,
      audience TEXT,
      channels TEXT,
      risk_score INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'draft',
      block_reason TEXT,
      created_by_user_id TEXT,
      decided_by_user_id TEXT,
      decision_note TEXT,
      decided_at BIGINT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_narrative_responses_nrr ON narrative_responses(org_id, narrative_id);
    CREATE INDEX IF NOT EXISTS idx_narrative_responses_status ON narrative_responses(org_id, status);

    CREATE TABLE IF NOT EXISTS narrative_audit (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      narrative_id TEXT,
      actor_user_id TEXT,
      action TEXT NOT NULL,
      detail TEXT,
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_narrative_audit_org ON narrative_audit(org_id, created_at DESC);
  `);
}
