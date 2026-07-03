import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireTenant } from "@/lib/platform/org";
import { clearOrgSecrets, getOrgSecrets, setOrgSecrets } from "@/lib/platform/secrets";
import { listLmsSyncRuns, lmsConfigured, syncLmsOrg } from "@/lib/modules/lms/sync";
import { listLmsCoursesMirror } from "@/lib/modules/lms/catalog";
import { getLmsSettings, updateLmsSettings } from "@/lib/modules/lms/notifications";
import { Badge, PageHeader, Panel } from "@/components/ui";

const inputCls =
  "w-full rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent";

const LITMOS_SECRET_KEYS = ["litmosApiKey", "litmosBaseUrl", "litmosSource"];

function first(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

function runTone(status: string): string {
  if (status === "success") return "low";
  if (status === "partial" || status === "running") return "medium";
  return "high"; // failed
}

// Summaries are JSON step counts written by the sync ledger; render the numeric
// entries and ignore anything else (errors array, malformed rows).
function summaryText(raw: string | null): string {
  if (!raw) return "";
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    if (!obj || typeof obj !== "object") return "";
    return Object.entries(obj)
      .filter((e): e is [string, number] => typeof e[1] === "number")
      .map(([k, v]) => `${k}: ${v}`)
      .join(" · ");
  } catch {
    return "";
  }
}

export default async function LmsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const err = first(sp.error);

  const { orgId, role } = await requireTenant();
  const isAdmin = role === "admin" || role === "owner";
  const [secrets, configured, runs, courses, settings] = await Promise.all([
    getOrgSecrets(orgId),
    lmsConfigured(orgId),
    listLmsSyncRuns(orgId, 8),
    listLmsCoursesMirror(orgId, { activeOnly: true }),
    getLmsSettings(orgId),
  ]);
  // Only derived booleans leave this scope for secret fields — never the values.
  const set = (k: string) => Boolean(secrets[k]?.trim());

  async function saveConnection(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("admin");
    // Blank fields keep the current value (update one credential without re-entering all).
    const patch: Record<string, string> = {};
    for (const key of LITMOS_SECRET_KEYS) {
      const v = String(formData.get(key) ?? "").trim();
      if (v) patch[key] = v;
    }
    if (Object.keys(patch).length) await setOrgSecrets(orgId, patch);
    revalidatePath("/lms/settings");
  }

  async function clear(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("admin");
    const keys = String(formData.get("keys") || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (keys.length) await clearOrgSecrets(orgId, keys);
    revalidatePath("/lms/settings");
  }

  async function syncNow() {
    "use server";
    const { orgId } = await requireTenant("admin");
    let error: string | null = null;
    try {
      await syncLmsOrg(orgId);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    if (error) redirect(`/lms/settings?error=${encodeURIComponent(error)}`);
    revalidatePath("/lms/settings");
  }

  async function saveFeatured(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("admin");
    await updateLmsSettings(orgId, { featuredCourseId: String(formData.get("featuredCourseId") || "") || null });
    revalidatePath("/lms/settings");
  }

  return (
    <>
      <PageHeader title="LMS settings" subtitle="Litmos connection, sync, webhook, and library options." />

      {err && (
        <Panel className="mb-4">
          <p className="text-sm text-jericho-bad">{err}</p>
        </Panel>
      )}

      {!isAdmin && (
        <Panel className="mb-4">
          <p className="text-sm text-jericho-muted">
            You can see how the LMS is configured, but only an <strong>admin</strong> or <strong>owner</strong> can change it.
          </p>
        </Panel>
      )}

      <div className="space-y-4">
        <Panel>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-medium">Litmos connection</h3>
            <StatusBadge on={set("litmosApiKey")} />
          </div>
          <form action={saveConnection} className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Field label="API key" name="litmosApiKey" secret configured={set("litmosApiKey")} disabled={!isAdmin} placeholder="Litmos API key" />
              <Field label="Base URL" name="litmosBaseUrl" defaultValue={secrets.litmosBaseUrl ?? ""} disabled={!isAdmin} placeholder="https://api.litmos.com/v1.svc" />
              <Field label="Source" name="litmosSource" defaultValue={secrets.litmosSource ?? ""} disabled={!isAdmin} placeholder="jericho-platform" />
            </div>
            {isAdmin && (
              <button className="rounded-lg bg-jericho-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90" type="submit">
                Save connection
              </button>
            )}
          </form>
          {isAdmin && LITMOS_SECRET_KEYS.some(set) && (
            <ClearButton action={clear} keys={LITMOS_SECRET_KEYS.join(",")} label="Disconnect Litmos" />
          )}
          <p className="text-xs text-jericho-muted mt-3">
            Also drives Behavior → Litmos training and Studio → Publish to Litmos.
          </p>
        </Panel>

        <Panel>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <h3 className="font-medium">Sync</h3>
              <StatusBadge on={configured} />
            </div>
            {isAdmin && (
              <form action={syncNow}>
                <button
                  className="rounded-lg bg-jericho-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                  type="submit"
                  disabled={!configured}
                >
                  Sync now
                </button>
              </form>
            )}
          </div>
          <p className="text-xs text-jericho-muted mb-3">
            Mirrors the Litmos catalog, learner directory, and teams locally. Also runs on the <code>lms-sync</code> scheduler job.
          </p>
          {runs.length === 0 ? (
            <p className="text-sm text-jericho-muted">No sync runs yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="text-left text-xs uppercase tracking-wide text-jericho-muted pb-2">Status</th>
                    <th className="text-left text-xs uppercase tracking-wide text-jericho-muted pb-2">Started</th>
                    <th className="text-left text-xs uppercase tracking-wide text-jericho-muted pb-2">Summary</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id} className="border-t border-jericho-border/60 text-sm">
                      <td className="py-2 pr-2">
                        <Badge tone={runTone(r.status)}>{r.status}</Badge>
                      </td>
                      <td className="py-2 pr-2 text-jericho-muted whitespace-nowrap">{new Date(r.startedAt).toLocaleString()}</td>
                      <td className="py-2">
                        <span className="text-jericho-muted">{summaryText(r.summary)}</span>
                        {r.error && <div className="text-xs text-jericho-bad mt-0.5">{r.error}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel>
          <h3 className="font-medium mb-3">Library</h3>
          <form action={saveFeatured} className="flex flex-wrap items-end gap-2">
            <label className="block min-w-64">
              <span className="text-xs text-jericho-muted">Featured course (library hero)</span>
              <select
                name="featuredCourseId"
                defaultValue={settings.featuredCourseId ?? ""}
                disabled={!isAdmin}
                className={`mt-1 ${inputCls} disabled:opacity-60`}
              >
                <option value="">— automatic —</option>
                {courses.map((c) => (
                  <option key={c.litmosId} value={c.litmosId}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            {isAdmin && (
              <button className="rounded-lg border border-jericho-border px-3 py-2 text-sm text-jericho-accent hover:bg-jericho-border/40" type="submit">
                Save
              </button>
            )}
          </form>
        </Panel>

        <Panel>
          <h3 className="font-medium mb-3">Completion webhook</h3>
          <p className="text-sm text-jericho-muted mb-2">
            Point a Litmos completion webhook (or middleware) at this endpoint so completions update assignments instantly and fire
            completion rules — no waiting for the poller:
          </p>
          <code className="block rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm overflow-x-auto whitespace-nowrap">
            POST /api/webhooks/litmos?org_id={orgId}
          </code>
          <p className="text-xs text-jericho-muted mt-2">
            Sign each request with the <code>X-Litmos-Signature</code> header: HMAC-SHA256 over{" "}
            <code>&lt;orgId&gt;:&lt;rawBody&gt;</code>, keyed by the Litmos API key configured above.
          </p>
        </Panel>

        <Panel>
          <h3 className="font-medium mb-3">Reporting data</h3>
          <p className="text-sm text-jericho-muted">
            Risk × training reporting reads phishing risk scores from the Jericho app connector configured under{" "}
            <Link href="/behavior/sources" className="text-jericho-accent hover:underline">
              Behavior → Sources
            </Link>
            . Notification channel credentials (Slack, Teams, Google Chat, SMTP) live under{" "}
            <Link href="/settings/integrations" className="text-jericho-accent hover:underline">
              Settings → Integrations
            </Link>
            .
          </p>
        </Panel>
      </div>
    </>
  );
}

function StatusBadge({ on }: { on: boolean }) {
  return <Badge tone={on ? "low" : "medium"}>{on ? "configured" : "not set"}</Badge>;
}

function Field({
  label,
  name,
  secret,
  configured,
  defaultValue,
  placeholder,
  disabled,
}: {
  label: string;
  name: string;
  secret?: boolean;
  configured?: boolean;
  defaultValue?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-xs text-jericho-muted">
        {label}
        {secret && configured && <span className="ml-2 text-jericho-good">• set (leave blank to keep)</span>}
      </span>
      <input
        type={secret ? "password" : "text"}
        name={name}
        defaultValue={secret ? "" : defaultValue}
        placeholder={secret && configured ? "••••••••" : placeholder}
        disabled={disabled}
        autoComplete="off"
        className={`mt-1 ${inputCls} disabled:opacity-60`}
      />
    </label>
  );
}

function ClearButton({ action, keys, label }: { action: (fd: FormData) => Promise<void>; keys: string; label: string }) {
  return (
    <form action={action} className="mt-3">
      <input type="hidden" name="keys" value={keys} />
      <button className="text-xs text-jericho-muted hover:text-jericho-bad" type="submit" formNoValidate>
        {label}
      </button>
    </form>
  );
}
