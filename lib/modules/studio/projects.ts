// Studio projects (courses) + block authoring. The authoring doc lives as JSON in
// studio_projects.data; block ops load → mutate the array → save.

import { randomUUID } from "crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/platform/db";
import { projects, type StudioProjectRow } from "./schema";
import { emptyDoc, newBlock, type Block, type BlockType, type CourseDoc } from "./types";

export function parseDoc(data: string | null): CourseDoc {
  if (!data) return emptyDoc();
  try {
    const v = JSON.parse(data) as CourseDoc;
    return Array.isArray(v?.blocks) ? { blocks: v.blocks } : emptyDoc();
  } catch {
    return emptyDoc();
  }
}

export function listProjects(orgId: string) {
  return db.select().from(projects).where(eq(projects.orgId, orgId)).orderBy(desc(projects.updatedAt));
}

export async function getProject(orgId: string, id: string): Promise<StudioProjectRow | null> {
  const rows = await db.select().from(projects).where(and(eq(projects.orgId, orgId), eq(projects.id, id)));
  return rows[0] ?? null;
}

export async function createProject(orgId: string, userId: string, input: { title: string; type?: string; description?: string }): Promise<string> {
  const id = randomUUID();
  const now = Date.now();
  await db.insert(projects).values({
    id,
    orgId,
    type: input.type === "video" ? "video" : "course",
    title: input.title.trim(),
    description: input.description ?? null,
    status: "draft",
    data: JSON.stringify(emptyDoc()),
    createdByUserId: userId,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

export async function setStatus(orgId: string, id: string, status: "draft" | "published"): Promise<void> {
  await db.update(projects).set({ status, updatedAt: Date.now() }).where(and(eq(projects.orgId, orgId), eq(projects.id, id)));
}

export async function deleteProject(orgId: string, id: string): Promise<void> {
  await db.delete(projects).where(and(eq(projects.orgId, orgId), eq(projects.id, id)));
}

export async function saveDoc(orgId: string, id: string, doc: CourseDoc): Promise<void> {
  await db.update(projects).set({ data: JSON.stringify(doc), updatedAt: Date.now() }).where(and(eq(projects.orgId, orgId), eq(projects.id, id)));
}

async function mutateDoc(orgId: string, id: string, fn: (doc: CourseDoc) => void): Promise<void> {
  const project = await getProject(orgId, id);
  if (!project) return;
  const doc = parseDoc(project.data);
  fn(doc);
  await saveDoc(orgId, id, doc);
}

export function addBlock(orgId: string, id: string, type: BlockType): Promise<void> {
  return mutateDoc(orgId, id, (doc) => {
    doc.blocks.push(newBlock(randomUUID(), type));
  });
}

export function removeBlock(orgId: string, id: string, blockId: string): Promise<void> {
  return mutateDoc(orgId, id, (doc) => {
    doc.blocks = doc.blocks.filter((b) => b.id !== blockId);
  });
}

export function moveBlock(orgId: string, id: string, blockId: string, dir: "up" | "down"): Promise<void> {
  return mutateDoc(orgId, id, (doc) => {
    const i = doc.blocks.findIndex((b) => b.id === blockId);
    if (i < 0) return;
    const j = dir === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= doc.blocks.length) return;
    [doc.blocks[i], doc.blocks[j]] = [doc.blocks[j], doc.blocks[i]];
  });
}

// Merge form-supplied fields into a block, keeping its type.
export function updateBlock(orgId: string, id: string, blockId: string, fields: Record<string, unknown>): Promise<void> {
  return mutateDoc(orgId, id, (doc) => {
    const i = doc.blocks.findIndex((b) => b.id === blockId);
    if (i < 0) return;
    doc.blocks[i] = { ...doc.blocks[i], ...fields } as Block;
  });
}
