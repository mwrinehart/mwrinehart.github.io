import Link from "next/link";
import { redirect } from "next/navigation";
import { requireTenant } from "@/lib/platform/org";
import { createProject, listProjects, parseDoc } from "@/lib/modules/studio/projects";
import { generateCourse } from "@/lib/modules/studio/coursegen";
import { Badge, EmptyState, PageHeader, Panel } from "@/components/ui";

export default async function StudioCoursesPage() {
  const { orgId } = await requireTenant();
  const list = await listProjects(orgId);

  async function create(formData: FormData) {
    "use server";
    const { orgId, userId } = await requireTenant("member");
    const title = String(formData.get("title") || "Untitled course");
    const topic = String(formData.get("topic") || "").trim();
    const id = await createProject(orgId, userId, { title });
    if (topic) {
      try {
        await generateCourse(orgId, id, topic);
      } catch {
        // No AI key / parse error — leave the course empty for manual authoring.
      }
    }
    redirect(`/studio/${id}`);
  }

  return (
    <>
      <PageHeader title="Courses" subtitle="Author eLearning courses — block by block or generated from a topic with AI." />

      <Panel className="mb-6">
        <h3 className="font-medium mb-3">New course</h3>
        <form action={create} className="space-y-2">
          <input name="title" placeholder="Course title" required className="w-full rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent" />
          <input name="topic" placeholder="Optional: topic to generate from with AI (e.g. “phishing awareness for finance teams”)" className="w-full rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent" />
          <button className="rounded-lg bg-jericho-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90" type="submit">
            Create course
          </button>
        </form>
      </Panel>

      {list.length === 0 ? (
        <EmptyState title="No courses yet">Create one above — leave the topic blank to start from an empty canvas.</EmptyState>
      ) : (
        <div className="space-y-3">
          {list.map((p) => {
            const blocks = parseDoc(p.data).blocks.length;
            return (
              <Link key={p.id} href={`/studio/${p.id}`} className="block">
                <Panel className="hover:border-jericho-accent transition-colors">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{p.title}</span>
                    <Badge tone={p.status === "published" ? "low" : "medium"}>{p.status}</Badge>
                    <span className="text-xs text-jericho-muted">{blocks} block{blocks === 1 ? "" : "s"}</span>
                    <span className="ml-auto text-xs text-jericho-muted">updated {new Date(p.updatedAt).toLocaleDateString()}</span>
                  </div>
                  {p.description && <p className="text-sm text-jericho-muted mt-1">{p.description}</p>}
                </Panel>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
