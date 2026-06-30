import Link from "next/link";
import { requireTenant, getUserEmail } from "@/lib/platform/org";
import { listOrgsForUser } from "@/lib/platform/orgs";
import { isPlatformAdmin } from "@/lib/platform/admin";
import { MODULES } from "@/lib/platform/modules";
import { Badge, PageHeader, Panel } from "@/components/ui";

export default async function SettingsPage() {
  const { orgId, userId, role } = await requireTenant();
  const orgs = await listOrgsForUser(userId);
  const current = orgs.find((o) => o.id === orgId);
  const platformAdmin = isPlatformAdmin(await getUserEmail());

  return (
    <>
      <PageHeader title="Settings" subtitle="Organization, team, modules, and integrations." />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Panel>
          <h3 className="font-medium mb-3">Organization</h3>
          <dl className="text-sm space-y-2">
            <Row label="Name" value={current?.name ?? "—"} />
            <Row label="Plan" value={current?.plan ?? "—"} />
            <Row label="Your role" value={role} />
            <Row label="Org id" value={<code className="text-xs">{orgId}</code>} />
          </dl>
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
        </Panel>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
        <NavCard href="/settings/members" icon="👥" title="Team & invites" desc="Invite teammates, change roles, remove members." />
        <NavCard href="/settings/integrations" icon="🔌" title="Integrations" desc="Slack, Teams, email (SMTP), and AI credentials." />
        {platformAdmin && (
          <NavCard href="/admin" icon="🛡️" title="Platform admin" desc="All organizations and users across the platform." />
        )}
      </div>
    </>
  );
}

function NavCard({ href, icon, title, desc }: { href: string; icon: string; title: string; desc: string }) {
  return (
    <Link href={href} className="block">
      <Panel className="hover:border-jericho-accent transition-colors">
        <div className="flex items-start gap-3">
          <span className="text-xl" aria-hidden>
            {icon}
          </span>
          <div>
            <div className="font-medium text-jericho-text">{title}</div>
            <div className="text-sm text-jericho-muted mt-0.5">{desc}</div>
          </div>
        </div>
      </Panel>
    </Link>
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
