import { requireTenant } from "@/lib/platform/org";
import { listOrgsForUser } from "@/lib/platform/orgs";
import { MODULES } from "@/lib/platform/modules";
import { Badge, PageHeader, Panel } from "@/components/ui";

export default async function SettingsPage() {
  const { orgId, userId, role } = await requireTenant();
  const orgs = await listOrgsForUser(userId);
  const current = orgs.find((o) => o.id === orgId);

  return (
    <>
      <PageHeader title="Settings" subtitle="Organization, modules, and integrations." />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Panel>
          <h3 className="font-medium mb-3">Organization</h3>
          <dl className="text-sm space-y-2">
            <Row label="Name" value={current?.name ?? "—"} />
            <Row label="Plan" value={current?.plan ?? "—"} />
            <Row label="Your role" value={role} />
            <Row label="Org id" value={<code className="text-xs">{orgId}</code>} />
          </dl>
          <p className="text-xs text-jericho-muted mt-4">
            Branding, member management, invites, and billing land here as the platform admin console is ported from
            Make.
          </p>
        </Panel>

        <Panel>
          <h3 className="font-medium mb-3">Modules</h3>
          <ul className="space-y-2 text-sm">
            {MODULES.map((m) => (
              <li key={m.id} className="flex items-center justify-between">
                <span>
                  {m.icon} {m.label}
                </span>
                <Badge tone={m.status === "live" ? "low" : "medium"}>{m.status}</Badge>
              </li>
            ))}
          </ul>
          <p className="text-xs text-jericho-muted mt-4">
            Per-org module entitlements and encrypted integration credentials (Slack, Teams, Litmos, AI keys) are stored
            via the platform secret store.
          </p>
        </Panel>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-jericho-muted">{label}</dt>
      <dd className="text-jericho-text text-right">{value}</dd>
    </div>
  );
}
