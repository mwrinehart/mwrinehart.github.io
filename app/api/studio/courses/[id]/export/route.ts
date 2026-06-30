// Standalone HTML export of a course. Authenticated (org-scoped via requireTenant);
// returns a self-contained document as a download.

import { requireTenant } from "@/lib/platform/org";
import { getProject, parseDoc } from "@/lib/modules/studio/projects";
import { courseToHtml } from "@/lib/modules/studio/export";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let orgId: string;
  try {
    ({ orgId } = await requireTenant());
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }
  const project = await getProject(orgId, id);
  if (!project) return new Response("Not found", { status: 404 });

  const html = courseToHtml(project.title, parseDoc(project.data));
  const filename = `${project.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "course"}.html`;
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}
