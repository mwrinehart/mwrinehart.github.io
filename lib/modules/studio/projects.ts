// Studio projects (courses) + block authoring. The authoring doc lives as JSON in
// studio_projects.data; block ops load → mutate the array → save.

import { randomUUID } from "crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/platform/db";
import { projects, type StudioProjectRow } from "./schema";
import { coerceBlock, emptyDoc, newBlock, type BlockType, type CourseDoc } from "./types";

export function parseDoc(data: string | null): CourseDoc {
  if (!data) return emptyDoc();
  try {
    const v = JSON.parse(data) as unknown;
    const blocks = (v as { blocks?: unknown })?.blocks;
    if (!Array.isArray(blocks)) return emptyDoc();
    // Never trust persisted JSON: coerce each block, dropping anything malformed.
    return { blocks: blocks.map(coerceBlock).filter((b) => b !== null) };
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

// Read-modify-write a project's doc under optimistic concurrency: the write only
// lands if `updatedAt` still matches what we read, so two concurrent block edits
// can't silently clobber each other (last-write-wins on a stale copy). On a
// conflict we re-read and re-apply the mutation, up to a few attempts.
async function mutateDoc(orgId: string, id: string, fn: (doc: CourseDoc) => void): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const project = await getProject(orgId, id);
    if (!project) return;
    const doc = parseDoc(project.data);
    fn(doc);
    const written = await db
      .update(projects)
      .set({ data: JSON.stringify(doc), updatedAt: Date.now() })
      .where(and(eq(projects.orgId, orgId), eq(projects.id, id), eq(projects.updatedAt, project.updatedAt)))
      .returning({ id: projects.id });
    if (written.length) return; // our compare-and-set won
    // Lost the race: someone wrote between our read and update — retry from a fresh read.
  }
  throw new Error("Concurrent edit conflict; please retry");
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

// Merge form-supplied fields into a block, keeping its type. The merged result is
// coerced (clamping quiz answers, dropping junk fields, etc.); if coercion fails
// we leave the block untouched rather than persist something malformed.
export function updateBlock(orgId: string, id: string, blockId: string, fields: Record<string, unknown>): Promise<void> {
  return mutateDoc(orgId, id, (doc) => {
    const i = doc.blocks.findIndex((b) => b.id === blockId);
    if (i < 0) return;
    const merged = coerceBlock({ ...doc.blocks[i], ...fields, type: doc.blocks[i].type });
    if (merged) doc.blocks[i] = merged;
  });
}
