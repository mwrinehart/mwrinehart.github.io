import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/platform/org";
import {
  getLmsSettings,
  listLmsNotificationLog,
  listTemplates,
  resetTemplate,
  saveTemplate,
  updateLmsSettings,
} from "@/lib/modules/lms/notifications";
import {
  NOTIFY_CHANNELS,
  parseReminderDays,
  renderTemplate,
  TEMPLATE_KEYS,
  type NotifyChannelId,
  type TemplateKey,
} from "@/lib/modules/lms/types";
import { Badge, EmptyState, PageHeader, Panel } from "@/components/ui";

const inputCls = "w-full rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent";

const CHANNEL_OPTIONS: Array<{ id: NotifyChannelId; label: string }> = [
  { id: "slack", label: "Slack" },
  { id: "teams", label: "Teams" },
  { id: "googlechat", label: "Google Chat" },
  { id: "email", label: "Email" },
];

// Base vars are shared; each key adds its own (mirrors what workers/rules pass).
const TEMPLATE_VARS: Record<TemplateKey, string> = {
  assignment_created: "learner, learnerEmail, course, dueDate, dueClause",
  due_soon: "learner, learnerEmail, course, dueDate, dueClause, daysLeft",
  overdue: "learner, learnerEmail, course, dueDate, dueClause, daysOverdue",
  completed: "learner, learnerEmail, course, dueDate, dueClause, score, scoreClause",
  compliance_expiring: "learner, learnerEmail, course, dueDate, dueClause, expiresDate, daysToExpiry",
};

const SAMPLE_VARS = {
  learner: "Avery Chen",
  learnerEmail: "avery@company.com",
  course: "Security Awareness Basics",
  dueDate: "Jul 17, 2026",
  dueClause: ", due Jul 17, 2026",
  daysLeft: 3,
  daysOverdue: 2,
  score: 92,
  scoreClause: " with a score of 92",
  expiresDate: "Aug 30, 2026",
  daysToExpiry: 21,
};

function parseChannels(raw: string | null): NotifyChannelId[] {
  if (!raw) return ["email"];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return ["email"];
    return arr.filter((c): c is NotifyChannelId => NOTIFY_CHANNELS.includes(c as NotifyChannelId));
  } catch {
    return ["email"];
  }
}

function logStatusTone(s: string): string {
  if (s === "sent") return "low";
  if (s === "skipped") return "medium";
  return "high"; // failed
}

export default async function LmsNotificationsPage() {
  const { orgId } = await requireTenant();
  const [settings, templates, log] = await Promise.all([
    getLmsSettings(orgId),
    listTemplates(orgId),
    listLmsNotificationLog(orgId, 50),
  ]);
  const reminderDays = parseReminderDays(settings.reminderDays);
  const channels = parseChannels(settings.channels);

  async function saveSettings(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("admin");
    const days = [
      ...new Set(
        String(formData.get("reminderDays") || "")
          .split(",")
          .map((s) => parseInt(s.trim(), 10))
          .filter((n) => Number.isInteger(n) && n >= 0 && n <= 365),
      ),
    ];
    const picked = formData
      .getAll("channels")
      .map(String)
      .filter((c): c is NotifyChannelId => NOTIFY_CHANNELS.includes(c as NotifyChannelId));
    await updateLmsSettings(orgId, {
      reminderDays: days, // empty array reads back as the default cadence
      channels: picked,
      notifyLearners: formData.get("notifyLearners") === "1",
    });
    revalidatePath("/lms/notifications");
  }

  async function saveTemplateAction(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("admin");
    const key = String(formData.get("key") || "") as TemplateKey;
    if (!TEMPLATE_KEYS.includes(key)) return;
    await saveTemplate(orgId, key, {
      subject: String(formData.get("subject") || ""),
      body: String(formData.get("body") || ""),
      enabled: formData.get("enabled") === "1",
    });
    revalidatePath("/lms/notifications");
  }

  async function resetTemplateAction(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("admin");
    const key = String(formData.get("key") || "") as TemplateKey;
    if (!TEMPLATE_KEYS.includes(key)) return;
    await resetTemplate(orgId, key);
    revalidatePath("/lms/notifications");
  }

  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle="Who hears about training events, where, and in what words."
        action={
          <Link href="/settings/integrations" className="text-sm text-jericho-accent hover:underline">
            Channel credentials →
          </Link>
        }
      />

      <Panel className="mb-6">
        <h3 className="font-medium mb-3">Delivery settings</h3>
        <form action={saveSettings} className="space-y-4">
          <label className="block max-w-sm">
            <span className="text-xs text-jericho-muted">Reminder cadence (days before due, comma-separated)</span>
            <input name="reminderDays" defaultValue={reminderDays.join(", ")} placeholder="14, 7, 3, 1" className={`mt-1 ${inputCls}`} />
          </label>
          <div>
            <span className="text-xs text-jericho-muted">Admin channels</span>
            <div className="flex flex-wrap gap-4 mt-1 text-sm">
              {CHANNEL_OPTIONS.map((c) => (
                <label key={c.id} className="flex items-center gap-1.5">
                  <input type="checkbox" name="channels" value={c.id} defaultChecked={channels.includes(c.id)} /> {c.label}
                </label>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" name="notifyLearners" value="1" defaultChecked={settings.notifyLearners} /> Also email the learner
            directly
          </label>
          <div>
            <button className="rounded-lg bg-jericho-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90" type="submit">
              Save settings
            </button>
          </div>
        </form>
        <p className="text-xs text-jericho-muted mt-3">
          Reminders fire on the <code>lms-duedates</code> scheduler job; each cadence window sends once per assignment.
        </p>
      </Panel>

      <h3 className="text-sm uppercase tracking-wide text-jericho-muted mb-3">Templates</h3>
      <div className="space-y-3 mb-6">
        {templates.map((t) => (
          <Panel key={t.key}>
            <div className="flex items-center gap-2 mb-3">
              <span className="font-medium">{t.label}</span>
              <Badge tone={t.enabled ? "low" : "none"}>{t.enabled ? "enabled" : "off"}</Badge>
              <span className="text-[11px] text-jericho-muted">{t.isDefault ? "default" : "customized"}</span>
            </div>
            <form action={saveTemplateAction} className="space-y-2">
              <input type="hidden" name="key" value={t.key} />
              <label className="block">
                <span className="text-xs text-jericho-muted">Subject</span>
                <input name="subject" defaultValue={t.subject} required className={`mt-1 ${inputCls}`} />
              </label>
              <label className="block">
                <span className="text-xs text-jericho-muted">Body</span>
                <textarea name="body" defaultValue={t.body} rows={3} required className={`mt-1 ${inputCls}`} />
              </label>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" name="enabled" value="1" defaultChecked={t.enabled} /> Enabled
                </label>
                <button className="rounded-lg border border-jericho-border px-3 py-2 text-sm text-jericho-accent hover:bg-jericho-border/40" type="submit">
                  Save template
                </button>
              </div>
            </form>
            {!t.isDefault && (
              <form action={resetTemplateAction} className="mt-2">
                <input type="hidden" name="key" value={t.key} />
                <button className="text-xs text-jericho-muted hover:text-jericho-bad" type="submit">
                  Reset to default
                </button>
              </form>
            )}
            <p className="text-xs text-jericho-muted mt-3">
              Variables: <code>{TEMPLATE_VARS[t.key]}</code>
            </p>
            <p className="text-xs text-jericho-muted italic mt-1">Example: {renderTemplate(t.subject, SAMPLE_VARS)}</p>
          </Panel>
        ))}
      </div>

      <h3 className="text-sm uppercase tracking-wide text-jericho-muted mb-3">Recent sends</h3>
      {log.length === 0 ? (
        <EmptyState title="Nothing sent yet">
          LMS notices land here once assignments, reminders, or compliance events start sending.
        </EmptyState>
      ) : (
        <Panel className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-jericho-muted border-b border-jericho-border">
                <tr>
                  <th className="px-5 py-3 font-medium">Channel</th>
                  <th className="px-5 py-3 font-medium">Target</th>
                  <th className="px-5 py-3 font-medium">Subject</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {log.map((n) => (
                  <tr key={n.id} className="border-b border-jericho-border/50 last:border-0">
                    <td className="px-5 py-3">{n.channel}</td>
                    <td className="px-5 py-3 text-jericho-muted">{n.target || "org default"}</td>
                    <td className="px-5 py-3 max-w-xs truncate">{n.subject}</td>
                    <td className="px-5 py-3">
                      <Badge tone={logStatusTone(n.status)}>{n.status}</Badge>
                      {n.error && <div className="text-xs text-jericho-bad mt-1">{n.error}</div>}
                    </td>
                    <td className="px-5 py-3 text-jericho-muted whitespace-nowrap">{new Date(n.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </>
  );
}
