import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/platform/org";
import { aggregateReportData, generateReport, listSavedReports, REPORT_TYPES } from "@/lib/modules/behavior/reports";
import { EmptyState, PageHeader, Panel, Stat } from "@/components/ui";

export default async function ReportsPage() {
  const { orgId } = await requireTenant();
  const [data, saved] = await Promise.all([aggregateReportData(orgId), listSavedReports(orgId)]);

  async function generate(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("member");
    await generateReport(orgId, { type: String(formData.get("type") || "executive") });
    revalidatePath("/behavior/reports");
  }

  return (
    <>
      <PageHeader title="Reports" subtitle="Cross-domain snapshot and saved reports." />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <Stat label="People" value={data.people} />
        <Stat label="Avg risk" value={data.avgRisk} />
        <Stat label="Policies" value={data.policies} />
        <Stat label="Pulse findings" value={data.pulseFindings} />
        <Stat label="Open behaviors" value={data.openBehaviors} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <Panel>
          <h3 className="font-medium mb-3">Phishing simulations</h3>
          {Object.keys(data.campaignsByType).length === 0 ? (
            <p className="text-sm text-jericho-muted">No campaign events imported.</p>
          ) : (
            <ul className="text-sm space-y-1">
              {Object.entries(data.campaignsByType).map(([k, v]) => (
                <li key={k} className="flex justify-between">
                  <span className="text-jericho-muted">{k}</span>
                  <span>{v}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel>
          <h3 className="font-medium mb-3">Triage verdicts</h3>
          {Object.keys(data.triageByVerdict).length === 0 ? (
            <p className="text-sm text-jericho-muted">No triage events imported.</p>
          ) : (
            <ul className="text-sm space-y-1">
              {Object.entries(data.triageByVerdict).map(([k, v]) => (
                <li key={k} className="flex justify-between">
                  <span className="text-jericho-muted">{k}</span>
                  <span>{v}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-jericho-muted mt-3">LMS completions: {data.lmsCompleted}</p>
        </Panel>
      </div>

      <Panel className="mb-6">
        <form action={generate} className="flex items-end gap-2">
          <label className="flex-1">
            <span className="text-xs text-jericho-muted">Generate report</span>
            <select name="type" className="mt-1 w-full rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent">
              {REPORT_TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <button className="rounded-lg bg-jericho-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90" type="submit">Generate</button>
        </form>
      </Panel>

      <h3 className="text-sm uppercase tracking-wide text-jericho-muted mb-3">Saved reports</h3>
      {saved.length === 0 ? (
        <EmptyState title="No reports generated yet" />
      ) : (
        <div className="space-y-2">
          {saved.map((r) => (
            <Panel key={r.id} className="flex items-center justify-between">
              <span className="text-sm">
                <span className="text-jericho-text">{r.title}</span>
                <span className="text-jericho-muted"> · {r.format} · {r.status}</span>
              </span>
              <span className="text-xs text-jericho-muted">{new Date(r.createdAt).toLocaleString()}</span>
            </Panel>
          ))}
        </div>
      )}
    </>
  );
}
