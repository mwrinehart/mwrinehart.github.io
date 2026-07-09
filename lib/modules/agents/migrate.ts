// Agents module DDL. Registered with the platform runMigrations() runner.

import type { PoolClient } from "pg";

export async function migrateAgents(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS agent_gateways (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'unknown',
      status_detail TEXT,
      agents_json TEXT,
      last_probe_at BIGINT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_gateways_org ON agent_gateways(org_id);

    CREATE TABLE IF NOT EXISTS agent_chat_messages (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      gateway_id TEXT NOT NULL,
      session_key TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'final',
      error TEXT,
      broadcast_id TEXT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_chat_session
      ON agent_chat_messages(org_id, gateway_id, session_key, created_at);
    CREATE INDEX IF NOT EXISTS idx_agent_chat_broadcast
      ON agent_chat_messages(org_id, broadcast_id);
  `);
}
