// ─── Studio module (rebuilt from Make / "Content Studio") — data model ────────
//
// AI media generation + eLearning authoring. Make IS the platform foundation, so
// this module lifts its authoring surface onto the shared spine. The course
// authoring + AI generation + HTML export here are fully functional; media
// generation (image/video/voice via ElevenLabs/fal/Synthesia/HeyGen) is gated
// behind provider keys and recorded as requests until those are wired.
//
// Everything is org-scoped.

import { bigint, pgTable, text } from "drizzle-orm/pg-core";

export const projects = pgTable("studio_projects", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  type: text("type").notNull().default("course"), // course | video
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("draft"), // draft | published
  data: text("data"), // JSON authoring document (CourseDoc: { blocks: [...] })
  createdByUserId: text("created_by_user_id"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

export const mediaAssets = pgTable("studio_media_assets", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  kind: text("kind").notNull(), // image | video | voice | document
  prompt: text("prompt"),
  url: text("url"), // data URL or remote URL once generated
  meta: text("meta"), // JSON (model, aspect, duration…)
  status: text("status").notNull().default("ready"), // ready | requested | failed
  note: text("note"),
  createdByUserId: text("created_by_user_id"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

export type StudioProjectRow = typeof projects.$inferSelect;
export type StudioMediaAssetRow = typeof mediaAssets.$inferSelect;
