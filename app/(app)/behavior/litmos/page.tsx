import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/platform/org";
import { activateNow, assignmentStats, cancelAssignment, createAssignments, listAssignments } from "@/lib/modules/behavior/litmos";
import { Badge, EmptyState, PageHeader, Panel } from "@/components/ui";

function statusTone(s: string): string {
  if (s === "completed") return "low";
  if (s === "active" || s === "scheduled" || s === "pending") return "medium";
  return "high"; // failed | cancelled
}

export default async function LitmosPage() {
  const { orgId } = await requireTenant();
  const [rows, stats] = await Promise.all([listAssignments(orgId), assignmentStats(orgId)]);

  async function assign(formData: FormData) {
    "use server";
    const { orgId, userId } = await requireTenant("member");
    const scheduledRaw = String(formData.get("scheduledFor") || "");
    const scheduledFor = scheduledRaw ? new Date(scheduledRaw).getTime() : undefined;
    await createAssignments(orgId, userId, [
      {
        userEmail: String(formData.get("userEmail") || ""),
        litmosCourseId: String(formData.get("courseId") || ""),
        litmosCourseName: String(formData.get("courseName") || "") || undefined,
        scheduledFor,
      },
    ]);
    revalidatePath("/behavior/litmos");
  }
  async function cancel(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("member");
    await cancelAssignment(orgId, String(formData.get("id") || ""));
    revalidatePath("/behavior/litmos");
  }
  async function activate(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("member");
    await activateNow(orgId, String(formData.get("id") || ""));
    revalidatePath("/behavior/litmos");
  }

  return (
    <>
      <PageHeader
        title="Litmos training"
        subtitle="Assign courses and track completion. Requires a Litmos API key configured on the Sources tab."
      />

      <div className="flex flex-wrap gap-2 mb-6">
        {Object.entries(stats).map(([k, v]) => (
          <Badge key={k} tone={statusTone(k)}>
            {k}: {v}
          </Badge>
        ))}
        {Object.keys(stats).length === 0 && <span className="text-sm text-jericho-muted">No assignments yet.</span>}
      </div>

      <Panel className="mb-6">
        <h3 className="font-medium mb-3">Assign a course</h3>
        <form action={assign} className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end">
          <input name="userEmail" type="email" placeholder="user@company.com" required className="rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent" />
          <input name="courseId" placeholder="Litmos course id" required className="rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent" />
          <input name="courseName" placeholder="Course name (optional)" className="rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent" />
          <input name="scheduledFor" type="datetime-local" className="rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent" />
          <div className="md:col-span-4">
            <button className="rounded-lg bg-jericho-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90" type="submit">
              Assign
            </button>
            <span className="text-xs text-jericho-muted ml-3">Leave the time empty to assign immediately.</span>
          </div>
        </form>
      </Panel>

      {rows.length === 0 ? (
        <EmptyState title="No assignments yet">Assign a course above, or let assignment-rule automation create them.</EmptyState>
      ) : (
        <Panel className="p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-left text-jericho-muted border-b border-jericho-border">
              <tr>
                <th className="px-5 py-3 font-medium">User</th>
                <th className="px-5 py-3 font-medium">Course</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Assigned</th>
                <th className="px-5 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-jericho-border/50 last:border-0">
                  <td className="px-5 py-3">{r.userEmail}</td>
                  <td className="px-5 py-3 text-jericho-muted">{r.litmosCourseName ?? r.litmosCourseId}</td>
                  <td className="px-5 py-3">
                    <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                  </td>
                  <td className="px-5 py-3 text-jericho-muted">{new Date(r.assignedAt).toLocaleDateString()}</td>
                  <td className="px-5 py-3 text-right">
                    {(r.status === "scheduled" || r.status === "failed") && (
                      <form action={activate} className="inline">
                        <input type="hidden" name="id" value={r.id} />
                        <button className="text-jericho-accent hover:underline mr-3" type="submit">activate</button>
                      </form>
                    )}
                    {r.status !== "completed" && r.status !== "cancelled" && (
                      <form action={cancel} className="inline">
                        <input type="hidden" name="id" value={r.id} />
                        <button className="text-jericho-muted hover:text-jericho-bad" type="submit">cancel</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </>
  );
}
