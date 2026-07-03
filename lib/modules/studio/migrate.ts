// Studio module DDL. Registered with the platform runMigrations() runner.

import type { PoolClient } from "pg";

export async function migrateStudio(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS studio_projects (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'course',
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      data TEXT,
      created_by_user_id TEXT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_studio_projects_org ON studio_projects(org_id);
    ALTER TABLE studio_projects ADD COLUMN IF NOT EXISTS litmos_course_id TEXT;
    ALTER TABLE studio_projects ADD COLUMN IF NOT EXISTS litmos_published_at BIGINT;
    ALTER TABLE studio_projects ADD COLUMN IF NOT EXISTS litmos_status TEXT;
    ALTER TABLE studio_projects ADD COLUMN IF NOT EXISTS litmos_error TEXT;

    CREATE TABLE IF NOT EXISTS studio_media_assets (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      prompt TEXT,
      url TEXT,
      meta TEXT,
      status TEXT NOT NULL DEFAULT 'ready',
      note TEXT,
      created_by_user_id TEXT,
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_studio_media_org ON studio_media_assets(org_id);
  `);
}
