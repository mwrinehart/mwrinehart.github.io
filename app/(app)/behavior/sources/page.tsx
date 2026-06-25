import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/platform/org";
import { setOrgSecrets } from "@/lib/platform/secrets";
import { listConfigs, listRecentRuns, runSync, upsertConfig } from "@/lib/modules/behavior/connectors";
import { Badge, PageHeader, Panel } from "@/components/ui";

function fmt(ts: number | null | undefined): string {
  return ts ? new Date(ts).toLocaleString() : "—";
}

export default async function SourcesPage() {
  const { orgId } = await requireTenant();
  const [configs, runs] = await Promise.all([listConfigs(orgId), listRecentRuns(orgId)]);
  const jericho = configs.find((c) => c.provider === "jericho-app");
  const litmos = configs.find((c) => c.provider === "litmos");

  async function saveJericho(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("admin");
    const apiKey = String(formData.get("apiKey") || "").trim();
    const baseUrl = String(formData.get("baseUrl") || "").trim();
    if (apiKey) await setOrgSecrets(orgId, { jerichoAppApiKey: apiKey });
    await upsertConfig(orgId, "jericho-app", { baseUrl });
    revalidatePath("/behavior/sources");
  }

  async function saveLitmos(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("admin");
    const apiKey = String(formData.get("apiKey") || "").trim();
    const baseUrl = String(formData.get("baseUrl") || "").trim();
    const source = String(formData.get("source") || "").trim();
    const patch: Record<string, string> = {};
    if (apiKey) patch.litmosApiKey = apiKey;
    if (baseUrl) patch.litmosBaseUrl = baseUrl;
    if (source) patch.litmosSource = source;
    if (Object.keys(patch).length) await setOrgSecrets(orgId, patch);
    await upsertConfig(orgId, "litmos", { baseUrl });
    revalidatePath("/behavior/sources");
  }

  async function sync(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("member");
    const provider = String(formData.get("provider") || "");
    if (provider === "jericho-app" || provider === "litmos") await runSync(orgId, provider);
    revalidatePath("/behavior/sources");
  }

  return (
    <>
      <PageHeader
        title="Data sources"
        subtitle="Connect external systems to ingest people, groups, and security events. Risk is recomputed after each sync."
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Panel>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-medium">Jericho app</h3>
            {jericho && <Badge tone={jericho.lastStatus === "success" ? "low" : jericho.lastStatus === "failed" ? "high" : "medium"}>{jericho.lastStatus ?? "not synced"}</Badge>}
          </div>
          <form action={saveJericho} className="space-y-2">
            <Input name="baseUrl" placeholder="https://app.jerichosecurity.com" defaultValue={jericho?.baseUrl ?? "https://app.jerichosecurity.com"} label="Base URL" />
            <Input name="apiKey" type="password" placeholder="API key (write-only)" label="API key" />
            <SaveButton>Save Jericho config</SaveButton>
          </form>
          {jericho && (
            <div className="mt-3 flex items-center gap-3 text-xs text-jericho-muted">
              <span>Last sync: {fmt(jericho.lastSyncAt)}</span>
              <SyncButton provider="jericho-app" action={sync} />
            </div>
          )}
          {jericho?.lastError && <p className="text-xs text-jericho-bad mt-2">{jericho.lastError}</p>}
        </Panel>

        <Panel>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-medium">Litmos LMS</h3>
            {litmos && <Badge tone={litmos.lastStatus === "success" ? "low" : litmos.lastStatus === "failed" ? "high" : "medium"}>{litmos.lastStatus ?? "not synced"}</Badge>}
          </div>
          <form action={saveLitmos} className="space-y-2">
            <Input name="baseUrl" placeholder="https://api.litmos.com/v1.svc" defaultValue={litmos?.baseUrl ?? "https://api.litmos.com"} label="Base URL" />
            <Input name="apiKey" type="password" placeholder="apikey (write-only)" label="API key" />
            <Input name="source" placeholder="jericho-platform" label="Source" />
            <SaveButton>Save Litmos config</SaveButton>
          </form>
          {litmos && (
            <div className="mt-3 flex items-center gap-3 text-xs text-jericho-muted">
              <span>Last sync: {fmt(litmos.lastSyncAt)}</span>
              <SyncButton provider="litmos" action={sync} />
            </div>
          )}
          {litmos?.lastError && <p className="text-xs text-jericho-bad mt-2">{litmos.lastError}</p>}
        </Panel>
      </div>

      <h3 className="text-sm uppercase tracking-wide text-jericho-muted mt-8 mb-3">Recent sync runs</h3>
      <Panel className="p-0 overflow-hidden">
        {runs.length === 0 ? (
          <div className="px-5 py-6 text-sm text-jericho-muted">No sync runs yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-jericho-muted border-b border-jericho-border">
              <tr>
                <th className="px-5 py-3 font-medium">Provider</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Started</th>
                <th className="px-5 py-3 font-medium">Summary</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => {
                const counts = r.summary ? (JSON.parse(r.summary).counts as Record<string, number>) : null;
                return (
                  <tr key={r.id} className="border-b border-jericho-border/50 last:border-0">
                    <td className="px-5 py-3">{r.provider}</td>
                    <td className="px-5 py-3">
                      <Badge tone={r.status === "success" ? "low" : r.status === "failed" ? "high" : "medium"}>{r.status}</Badge>
                    </td>
                    <td className="px-5 py-3 text-jericho-muted">{fmt(r.startedAt)}</td>
                    <td className="px-5 py-3 text-jericho-muted">
                      {counts ? Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(" · ") : r.error ?? "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>
    </>
  );
}

function Input({ name, label, type = "text", placeholder, defaultValue }: { name: string; label: string; type?: string; placeholder?: string; defaultValue?: string }) {
  return (
    <label className="block">
      <span className="text-xs text-jericho-muted">{label}</span>
      <input
        name={name}
        type={type}
        placeholder={placeholder}
        defaultValue={defaultValue}
        className="mt-1 w-full rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent"
      />
    </label>
  );
}

function SaveButton({ children }: { children: React.ReactNode }) {
  return (
    <button className="rounded-lg bg-jericho-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90" type="submit">
      {children}
    </button>
  );
}

function SyncButton({ provider, action }: { provider: string; action: (fd: FormData) => Promise<void> }) {
  return (
    <form action={action}>
      <input type="hidden" name="provider" value={provider} />
      <button className="rounded-lg border border-jericho-border px-2.5 py-1 text-jericho-accent hover:bg-jericho-border/40" type="submit">
        Sync now
      </button>
    </form>
  );
}
