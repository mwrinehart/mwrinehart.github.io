// Campaigns module DDL. Registered with the platform runMigrations() runner.

import type { PoolClient } from "pg";

export async function migrateCampaigns(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      name TEXT NOT NULL,
      objective TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      autonomy_mode TEXT NOT NULL DEFAULT 'manual',
      blueprint TEXT,
      risk_score INTEGER NOT NULL DEFAULT 0,
      created_by_user_id TEXT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_campaigns_org ON campaigns(org_id);

    CREATE TABLE IF NOT EXISTS campaign_personas (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      campaign_id TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT,
      backstory TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_campaign_personas_cmp ON campaign_personas(org_id, campaign_id);

    CREATE TABLE IF NOT EXISTS campaign_approvals (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      campaign_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      detail TEXT,
      risk_score INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      requested_by_user_id TEXT,
      decided_by_user_id TEXT,
      decision_note TEXT,
      decided_at BIGINT,
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_campaign_approvals_org ON campaign_approvals(org_id, status);

    CREATE TABLE IF NOT EXISTS campaign_audit (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      campaign_id TEXT,
      actor_user_id TEXT,
      action TEXT NOT NULL,
      detail TEXT,
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_campaign_audit_org ON campaign_audit(org_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_campaign_audit_cmp ON campaign_audit(campaign_id, created_at DESC);
  `);
}
