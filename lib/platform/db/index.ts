// Server-only PostgreSQL connection (pg + Drizzle), shared by the whole platform.
//
// The pool is cached on globalThis so Next.js hot-reloads in development reuse a
// single pool. `runMigrations()` is invoked once at startup from
// instrumentation.ts: it creates the platform tables, then asks each ported
// module to ensure its own tables. This mirrors Make's runMigrations() approach
// but adds the per-module hook so modules own their DDL.

import { Pool, type PoolClient } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import { migrateBehavior } from "@/lib/modules/behavior/migrate";
import { migrateCompliance } from "@/lib/modules/compliance/migrate";
import { migrateCampaigns } from "@/lib/modules/campaigns/migrate";
import { migrateStudio } from "@/lib/modules/studio/migrate";
import { migrateLms } from "@/lib/modules/lms/migrate";

const globalForDb = globalThis as unknown as { __jerichoPool?: Pool };

const defaultDatabaseUrl = "postgres://postgres:postgres@localhost:5432/jericho";
const databaseUrl = process.env.DATABASE_URL?.trim() || defaultDatabaseUrl;

const pool =
  globalForDb.__jerichoPool ??
  new Pool({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes("sslmode=disable")
      ? false
      : process.env.NODE_ENV === "production"
        ? { rejectUnauthorized: false }
        : false,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__jerichoPool = pool;
}

export const db = drizzle(pool, { schema });
export { schema };

// Module migrators run after the platform DDL. Adding a ported module = import
// its migrate fn and push it here.
const MODULE_MIGRATORS: Array<(client: PoolClient) => Promise<void>> = [migrateBehavior, migrateCompliance, migrateCampaigns, migrateStudio, migrateLms];

let migrated = false;

export async function runMigrations(): Promise<void> {
  if (migrated) return;
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT,
        name TEXT,
        password_hash TEXT,
        active_org_id TEXT,
        created_at BIGINT NOT NULL
      );
      ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
      CREATE TABLE IF NOT EXISTS orgs (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL,
        name TEXT NOT NULL,
        plan TEXT NOT NULL DEFAULT 'free',
        stripe_customer_id TEXT,
        settings TEXT,
        encrypted_secrets TEXT,
        widget_public_key TEXT,
        created_at BIGINT NOT NULL
      );
      ALTER TABLE orgs ADD COLUMN IF NOT EXISTS widget_public_key TEXT;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_orgs_slug ON orgs(slug);
      CREATE INDEX IF NOT EXISTS idx_orgs_widget_key ON orgs(widget_public_key);
      CREATE TABLE IF NOT EXISTS org_members (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member',
        created_at BIGINT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_orgm_unique ON org_members(org_id, user_id);
      CREATE INDEX IF NOT EXISTS idx_orgm_user ON org_members(user_id);
      CREATE TABLE IF NOT EXISTS invites (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        email TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member',
        token TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        accepted_at BIGINT
      );
      CREATE TABLE IF NOT EXISTS org_settings (
        org_id TEXT PRIMARY KEY,
        company_name TEXT,
        logo_url TEXT,
        primary_color TEXT,
        accent_color TEXT,
        enabled_modules TEXT,
        updated_at BIGINT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at BIGINT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS impersonation_log (
        id TEXT PRIMARY KEY,
        admin_user_id TEXT NOT NULL,
        admin_email TEXT,
        target_user_id TEXT NOT NULL,
        target_email TEXT,
        action TEXT NOT NULL,
        created_at BIGINT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS notification_log (
        id TEXT PRIMARY KEY,
        org_id TEXT,
        channel TEXT NOT NULL,
        target TEXT,
        module TEXT,
        subject TEXT,
        status TEXT NOT NULL,
        error TEXT,
        created_at BIGINT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS cron_runs (
        id TEXT PRIMARY KEY,
        job TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at BIGINT NOT NULL,
        finished_at BIGINT,
        summary TEXT,
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_cron_runs_job ON cron_runs(job, started_at DESC);
    `);

    for (const migrate of MODULE_MIGRATORS) {
      await migrate(client);
    }
  } finally {
    client.release();
  }
  migrated = true;
}
