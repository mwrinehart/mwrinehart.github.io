import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/platform/org";
import { clearOrgSecrets, getOrgSecrets, setOrgSecrets } from "@/lib/platform/secrets";
import { Badge, PageHeader, Panel } from "@/components/ui";

const inputCls =
  "w-full rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent";

// Org integration credentials live in the encrypted secret store; this page is the
// UI for them. Secret values are NEVER rendered back — only a configured/not-set
// status — so a token can't leak via page source. Writes require admin.
export default async function IntegrationsPage() {
  const { orgId, role } = await requireTenant();
  const isAdmin = role === "admin" || role === "owner";
  const secrets = await getOrgSecrets(orgId);
  const set = (k: string) => Boolean(secrets[k]?.trim());

  async function save(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("admin");
    // Only persist fields the admin actually filled in — a blank field keeps the
    // current value (so you can update one credential without re-entering them all).
    const patch: Record<string, string> = {};
    for (const key of ["slackBotToken", "slackDefaultChannel", "slackWebhook", "teamsWebhook", "smtpUrl", "smtpFrom", "anthropicApiKey"]) {
      const v = String(formData.get(key) ?? "").trim();
      if (v) patch[key] = v;
    }
    if (Object.keys(patch).length) await setOrgSecrets(orgId, patch);
    revalidatePath("/settings/integrations");
  }

  async function clear(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("admin");
    const keys = String(formData.get("keys") || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (keys.length) await clearOrgSecrets(orgId, keys);
    revalidatePath("/settings/integrations");
  }

  return (
    <>
      <PageHeader
        title="Integrations"
        subtitle="Connect this organization's Slack, Teams, email (SMTP), and AI credentials. Stored encrypted; values are never displayed back."
        action={
          <Link href="/settings" className="text-sm text-jericho-accent hover:underline">
            ← Settings
          </Link>
        }
      />

      {!isAdmin && (
        <Panel className="mb-4">
          <p className="text-sm text-jericho-muted">
            You can see which integrations are configured, but only an <strong>admin</strong> or <strong>owner</strong>{" "}
            can change them.
          </p>
        </Panel>
      )}

      <form action={save} className="space-y-4">
        <Panel>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-medium">Slack</h3>
            <StatusBadge on={set("slackBotToken") || set("slackWebhook")} />
          </div>
          <p className="text-xs text-jericho-muted mb-3">
            Use a bot token (recommended — targets are channel ids) <em>or</em> an incoming webhook URL.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Bot token" name="slackBotToken" secret configured={set("slackBotToken")} disabled={!isAdmin} placeholder="xoxb-…" />
            <Field label="Default channel id" name="slackDefaultChannel" defaultValue={secrets.slackDefaultChannel ?? ""} disabled={!isAdmin} placeholder="C0123456789" />
            <Field label="Incoming webhook URL" name="slackWebhook" secret configured={set("slackWebhook")} disabled={!isAdmin} placeholder="https://hooks.slack.com/…" />
          </div>
          {isAdmin && (set("slackBotToken") || set("slackWebhook") || set("slackDefaultChannel")) && (
            <ClearButton action={clear} keys="slackBotToken,slackWebhook,slackDefaultChannel" label="Remove Slack" />
          )}
        </Panel>

        <Panel>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-medium">Microsoft Teams</h3>
            <StatusBadge on={set("teamsWebhook")} />
          </div>
          <Field label="Incoming webhook URL" name="teamsWebhook" secret configured={set("teamsWebhook")} disabled={!isAdmin} placeholder="https://outlook.office.com/webhook/…" />
          {isAdmin && set("teamsWebhook") && <ClearButton action={clear} keys="teamsWebhook" label="Remove Teams" />}
        </Panel>

        <Panel>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-medium">Email (SMTP)</h3>
            <StatusBadge on={set("smtpUrl")} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="SMTP URL" name="smtpUrl" secret configured={set("smtpUrl")} disabled={!isAdmin} placeholder="smtps://user:pass@smtp.host:465" />
            <Field label="From address" name="smtpFrom" defaultValue={secrets.smtpFrom ?? ""} disabled={!isAdmin} placeholder="no-reply@yourcompany.com" />
          </div>
          {isAdmin && (set("smtpUrl") || set("smtpFrom")) && <ClearButton action={clear} keys="smtpUrl,smtpFrom" label="Remove SMTP" />}
        </Panel>

        <Panel>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-medium">AI (Anthropic)</h3>
            <StatusBadge on={set("anthropicApiKey")} />
          </div>
          <p className="text-xs text-jericho-muted mb-3">
            Powers compliance analysis and Studio course generation. Falls back to the platform key if unset.
          </p>
          <Field label="API key" name="anthropicApiKey" secret configured={set("anthropicApiKey")} disabled={!isAdmin} placeholder="sk-ant-…" />
          {isAdmin && set("anthropicApiKey") && <ClearButton action={clear} keys="anthropicApiKey" label="Remove AI key" />}
        </Panel>

        {isAdmin && (
          <button className="rounded-lg bg-jericho-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90" type="submit">
            Save integrations
          </button>
        )}
      </form>
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
