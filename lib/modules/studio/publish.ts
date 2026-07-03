// One-click "Publish to Litmos" for Studio courses. Litmos's public API
// creates/updates the course shell (name/description/code/active); it has no
// content-upload endpoint, so course content authored in Studio still ships via
// the HTML export (SCORM wrap) or stays hosted here.

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/platform/db";
import { createLitmosCourse, getLitmosCourse, getLitmosCreds, updateLitmosCourse } from "@/lib/platform/litmos";
import { projects } from "./schema";
import { getProject } from "./projects";

export async function publishProjectToLitmos(orgId: string, projectId: string): Promise<{ ok: boolean; courseId?: string; error?: string }> {
  const project = await getProject(orgId, projectId);
  if (!project) return { ok: false, error: "Project not found" };
  const creds = await getLitmosCreds(orgId);
  if (!creds) return { ok: false, error: "Litmos API key not configured — add it under LMS → Settings" };

  try {
    const shell = {
      name: project.title,
      description: project.description ?? "",
      code: `studio-${projectId.slice(0, 8)}`,
      active: true,
    };
    // A linked course can vanish server-side (admins delete courses in Litmos);
    // recreate rather than PUTting a ghost forever.
    const existing = project.litmosCourseId ? await getLitmosCourse(creds, project.litmosCourseId) : null;
    let courseId: string;
    if (project.litmosCourseId && existing) {
      await updateLitmosCourse(creds, project.litmosCourseId, shell);
      courseId = project.litmosCourseId;
    } else {
      const created = await createLitmosCourse(creds, shell);
      courseId = created.Id;
    }
    await db
      .update(projects)
      .set({ litmosCourseId: courseId, litmosPublishedAt: Date.now(), litmosStatus: "published", litmosError: null })
      .where(and(eq(projects.orgId, orgId), eq(projects.id, projectId)));
    return { ok: true, courseId };
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    try {
      await db
        .update(projects)
        .set({ litmosStatus: "failed", litmosError: message })
        .where(and(eq(projects.orgId, orgId), eq(projects.id, projectId)));
    } catch {
      // Best-effort status record; the caller still gets the error below.
    }
    return { ok: false, error: message };
  }
}
