import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/platform/org";
import { addDomain, brandStats, listDomains, listImpersonations, reportImpersonation, setImpersonationStatus } from "@/lib/modules/behavior/brand";
import { Badge, EmptyState, PageHeader, Panel, Stat } from "@/components/ui";

export default async function BrandProtectionPage() {
  const { orgId } = await requireTenant();
  const [domains, impersonations, stats] = await Promise.all([listDomains(orgId), listImpersonations(orgId), brandStats(orgId)]);

  async function addDomainAction(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("member");
    await addDomain(orgId, { domain: String(formData.get("domain") || ""), brand: String(formData.get("brand") || "") || undefined });
    revalidatePath("/behavior/brand");
  }
  async function reportAction(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("member");
    await reportImpersonation(orgId, {
      type: String(formData.get("type") || "") || undefined,
      source: String(formData.get("source") || "") || undefined,
      description: String(formData.get("description") || "") || undefined,
      severity: String(formData.get("severity") || "medium"),
      brand: String(formData.get("brand") || "") || undefined,
    });
    revalidatePath("/behavior/brand");
  }
  async function resolveAction(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("member");
    await setImpersonationStatus(orgId, String(formData.get("id") || ""), "resolved");
    revalidatePath("/behavior/brand");
  }

  return (
    <>
      <PageHeader title="Brand protection" subtitle="Monitor lookalike domains and brand impersonations." />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Stat label="Domains" value={stats.domains} />
        <Stat label="Impersonations" value={stats.impersonations} />
        <Stat label="Open" value={stats.open} />
        <Stat label="Critical domains" value={stats.critical} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Panel>
          <h3 className="font-medium mb-3">Monitored domains</h3>
          <ul className="space-y-2 mb-4">
            {domains.length === 0 && <li className="text-sm text-jericho-muted">No domains monitored.</li>}
            {domains.map((d) => (
              <li key={d.id} className="flex items-center justify-between text-sm">
                <span>
                  <span className="text-jericho-text">{d.domain}</span>
                  {d.brand && <span className="text-jericho-muted"> · {d.brand}</span>}
                </span>
                <span className="text-jericho-muted">threat {d.threatScore}</span>
              </li>
            ))}
          </ul>
          <form action={addDomainAction} className="flex gap-2">
            <input name="domain" placeholder="lookalike-domain.com" required className="flex-1 rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent" />
            <input name="brand" placeholder="Brand" className="w-28 rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent" />
            <button className="rounded-lg bg-jericho-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90" type="submit">Add</button>
          </form>
        </Panel>

        <Panel>
          <h3 className="font-medium mb-3">Report impersonation</h3>
          <form action={reportAction} className="space-y-2">
            <div className="flex gap-2">
              <input name="type" placeholder="Type (e.g. domain, social)" className="flex-1 rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent" />
              <select name="severity" className="w-32 rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent">
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
                <option value="critical">critical</option>
              </select>
            </div>
            <input name="source" placeholder="Source / URL" className="w-full rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent" />
            <input name="description" placeholder="Description" className="w-full rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent" />
            <button className="rounded-lg bg-jericho-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90" type="submit">Report</button>
          </form>
        </Panel>
      </div>

      <h3 className="text-sm uppercase tracking-wide text-jericho-muted mt-6 mb-3">Impersonations</h3>
      {impersonations.length === 0 ? (
        <EmptyState title="No impersonations reported" />
      ) : (
        <div className="space-y-2">
          {impersonations.map((i) => (
            <Panel key={i.id} className="flex items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <Badge tone={i.severity === "low" ? "low" : i.severity === "medium" ? "medium" : "high"}>{i.severity}</Badge>
                  <span className="text-sm text-jericho-text">{i.type ?? "impersonation"}</span>
                  {i.status === "resolved" && <span className="text-xs text-jericho-good">resolved</span>}
                </div>
                <div className="text-sm text-jericho-muted mt-1">{i.description ?? i.source}</div>
              </div>
              {i.status !== "resolved" && (
                <form action={resolveAction}>
                  <input type="hidden" name="id" value={i.id} />
                  <button className="rounded-lg border border-jericho-border px-2.5 py-1 text-sm text-jericho-accent hover:bg-jericho-border/40" type="submit">Resolve</button>
                </form>
              )}
            </Panel>
          ))}
        </div>
      )}
    </>
  );
}
