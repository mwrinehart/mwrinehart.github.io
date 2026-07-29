// Owner-only settings: connection status and operational reference. The Litmos
// API key is env-configured on purpose (never stored or displayed here); this
// page shows what's effective and documents the moving parts.

import { requireLcOwner } from "@/lib/modules/learning-center/auth";
import { defaultBrandNames, isDemoMode, learnerPortalUrl, litmosCreds, ownerEmails } from "@/lib/modules/learning-center/config";
import { LcBadge, LcPageHeader, LcPanel } from "@/components/learning-center/ui";

export default async function SettingsPage() {
  await requireLcOwner();
  const demo = isDemoMode();
  const creds = litmosCreds();
  const owners = ownerEmails();

  const rows: Array<{ label: string; value: React.ReactNode }> = [
    {
      label: "Mode",
      value: demo ? <LcBadge tone="amber">Demo (seeded in-memory tenant)</LcBadge> : <LcBadge tone="purple">Live Litmos API</LcBadge>,
    },
    { label: "API key", value: creds ? <LcBadge tone="purple">Configured (write-only, via LITMOS_API_KEY)</LcBadge> : <LcBadge tone="neutral">Not set</LcBadge> },
    { label: "API base URL", value: <code className="text-xs">{creds?.base ?? "https://api.litmos.com/v1.svc (default)"}</code> },
    { label: "Source tag", value: <code className="text-xs">{creds?.source ?? "jericho-learning-center"}</code> },
    { label: "Learner portal", value: <code className="text-xs">{learnerPortalUrl()}</code> },
    {
      label: "Owner emails",
      value: owners.length ? owners.join(", ") : <span className="text-lc-muted">None (Litmos Account Owners / Administrators still get owner access)</span>,
    },
    { label: "Jericho-managed brands", value: defaultBrandNames().filter(Boolean).join(", ") || "jericho security, default" },
  ];

  return (
    <>
      <LcPageHeader title="Settings" subtitle="Connection and operational configuration. Secrets live in environment variables — nothing sensitive is stored or shown here." />

      <div className="grid gap-6 xl:grid-cols-2">
        <LcPanel>
          <h3 className="font-bold text-lc-ink mb-4">Connection</h3>
          <dl className="space-y-3">
            {rows.map((r) => (
              <div key={r.label} className="flex items-start justify-between gap-6 text-sm">
                <dt className="text-lc-muted font-medium shrink-0">{r.label}</dt>
                <dd className="text-lc-ink text-right">{r.value}</dd>
              </div>
            ))}
          </dl>
        </LcPanel>

        <LcPanel>
          <h3 className="font-bold text-lc-ink mb-3">Environment reference</h3>
          <pre className="text-xs bg-lc-tint rounded-xl p-4 overflow-x-auto leading-relaxed">{`# Litmos connection
LITMOS_API_KEY=            # account-level API key (owner's key)
LITMOS_BASE_URL=           # default https://api.litmos.com/v1.svc
LITMOS_SOURCE=             # audit tag on every API call
LITMOS_LEARNER_URL=        # your Litmos learner portal

# Learning Center
LEARNING_CENTER_DEMO=      # 1 forces the seeded demo tenant
LEARNING_CENTER_OWNER_EMAILS=   # comma-separated dashboard owners
LEARNING_CENTER_DEFAULT_BRANDS= # brands whose templates Jericho manages

# Email sending (platform mailer)
SMTP_URL=                  # smtps://user:pass@host:465
SMTP_FROM=                 # sender address

# Scheduler (external crontab → /api/cron/<job>)
#   lc-rules      assignment rules engine (every 15 min suggested)
#   lc-reminders  due/compliance reminder sweep (daily suggested)
CRON_SECRET=`}</pre>
          <p className="text-xs text-lc-muted mt-3">
            Access model: Litmos Account Owners/Administrators and the emails above get the owner view; everyone whose email belongs to a Litmos team
            with Team Admin designation gets this dashboard scoped to their team + sub-teams; all other active Litmos users get the learner view only.
          </p>
        </LcPanel>
      </div>
    </>
  );
}
