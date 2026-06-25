import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/platform/org";
import { addEvidence, createComplianceFramework, listComplianceFrameworks, listEvidence } from "@/lib/modules/behavior/grc";
import { Badge, EmptyState, PageHeader, Panel } from "@/components/ui";

// GRC compliance frameworks + control evidence. (Distinct from the Compliance
// MODULE, which scans regulatory feeds.)
export default async function FrameworksPage() {
  const { orgId } = await requireTenant();
  const [frameworks, evidence] = await Promise.all([listComplianceFrameworks(orgId), listEvidence(orgId)]);

  async function createFw(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("admin");
    await createComplianceFramework(orgId, {
      name: String(formData.get("name") || ""),
      version: String(formData.get("version") || "") || undefined,
      score: Number(formData.get("score") || 0),
    });
    revalidatePath("/behavior/frameworks");
  }

  async function addEv(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("admin");
    await addEvidence(orgId, {
      frameworkId: String(formData.get("frameworkId") || ""),
      controlId: String(formData.get("controlId") || "") || undefined,
      description: String(formData.get("description") || "") || undefined,
      status: String(formData.get("status") || "pending"),
    });
    revalidatePath("/behavior/frameworks");
  }

  return (
    <>
      <PageHeader title="Compliance frameworks" subtitle="Track control frameworks and evidence (GRC)." />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <Panel>
          <h3 className="font-medium mb-3">Frameworks</h3>
          {frameworks.length === 0 ? (
            <p className="text-sm text-jericho-muted">No frameworks yet.</p>
          ) : (
            <ul className="space-y-2 mb-4">
              {frameworks.map((f) => {
                const ev = evidence.filter((e) => e.frameworkId === f.id);
                const approved = ev.filter((e) => e.status === "approved").length;
                return (
                  <li key={f.id} className="flex items-center justify-between text-sm">
                    <span>
                      <span className="text-jericho-text">{f.name}</span>
                      {f.version && <span className="text-jericho-muted"> v{f.version}</span>}
                      <span className="text-jericho-muted"> · {ev.length ? `${approved}/${ev.length} approved` : "no evidence"}</span>
                    </span>
                    <span className="text-jericho-muted">{f.score}%</span>
                  </li>
                );
              })}
            </ul>
          )}
          <form action={createFw} className="space-y-2">
            <input name="name" placeholder="Framework (e.g. SOC 2)" required className="w-full rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent" />
            <div className="flex gap-2">
              <input name="version" placeholder="Version" className="flex-1 rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent" />
              <input name="score" type="number" min={0} max={100} placeholder="Score %" className="w-28 rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent" />
            </div>
            <button className="rounded-lg bg-jericho-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90" type="submit">
              Add framework
            </button>
          </form>
        </Panel>

        <Panel>
          <h3 className="font-medium mb-3">Add evidence</h3>
          {frameworks.length === 0 ? (
            <p className="text-sm text-jericho-muted">Create a framework first.</p>
          ) : (
            <form action={addEv} className="space-y-2">
              <select name="frameworkId" className="w-full rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent">
                {frameworks.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
              <input name="controlId" placeholder="Control id (e.g. CC6.1)" className="w-full rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent" />
              <input name="description" placeholder="Description" className="w-full rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent" />
              <select name="status" className="w-full rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent">
                <option value="pending">pending</option>
                <option value="submitted">submitted</option>
                <option value="approved">approved</option>
              </select>
              <button className="rounded-lg bg-jericho-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90" type="submit">
                Add evidence
              </button>
            </form>
          )}
        </Panel>
      </div>

      <h3 className="text-sm uppercase tracking-wide text-jericho-muted mb-3">Evidence</h3>
      {evidence.length === 0 ? (
        <EmptyState title="No evidence submitted" />
      ) : (
        <div className="space-y-2">
          {evidence.map((e) => (
            <Panel key={e.id} className="flex items-center justify-between">
              <span className="text-sm">
                <span className="text-jericho-text">{e.controlId ?? "—"}</span>
                <span className="text-jericho-muted"> · {e.description ?? ""}</span>
              </span>
              <Badge tone={e.status === "approved" ? "low" : e.status === "pending" ? "medium" : "high"}>{e.status}</Badge>
            </Panel>
          ))}
        </div>
      )}
    </>
  );
}
