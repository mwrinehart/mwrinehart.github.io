import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getUserEmail, requireTenant, roleAtLeast } from "@/lib/platform/org";
import { createRule, deleteRule, listRuleRuns, listRules, setRuleEnabled, updateRule } from "@/lib/modules/lms/rules";
import { listLmsCoursesMirror, listLmsTeamsMirror } from "@/lib/modules/lms/catalog";
import {
  parseRuleActions,
  parseRuleConditions,
  RULE_TRIGGERS,
  type LmsEvent,
  type RuleAction,
  type RuleConditions,
  type RuleTrigger,
} from "@/lib/modules/lms/types";
import { RuleBuilder, type RuleBuilderOption } from "@/components/lms/RuleBuilder";
import { Badge, EmptyState, PageHeader, Panel } from "@/components/ui";

function first(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

function triggerLabel(trigger: string): string {
  return RULE_TRIGGERS.find((t) => t.value === trigger)?.label ?? trigger;
}

function actionSummary(a: RuleAction): string {
  switch (a.type) {
    case "assign_course":
      return `assign ${a.courseName ?? a.courseId}`;
    case "add_to_team":
      return `team ${a.teamName ?? a.teamId}`;
    case "notify":
      return `notify ${a.channel}`;
    case "notify_learner":
      return "email learner";
  }
}

function runTone(status: string): string {
  if (status === "ok") return "low";
  if (status === "partial") return "medium";
  return "high"; // failed
}

// Guarded subject render: rule runs store the LmsEvent JSON snapshot.
function runSubject(raw: string | null): string {
  if (!raw) return "—";
  try {
    const ev = JSON.parse(raw) as LmsEvent;
    const parts = [ev.trigger, ev.learner?.email, ev.course?.name || ev.course?.litmosId].filter(Boolean);
    return parts.length ? parts.join(" · ") : "—";
  } catch {
    return "—";
  }
}

function parseConditionsField(raw: string): RuleConditions {
  try {
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" && !Array.isArray(obj) ? (obj as RuleConditions) : {};
  } catch {
    return {};
  }
}

function parseActionsField(raw: string): RuleAction[] {
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as RuleAction[]) : [];
  } catch {
    return [];
  }
}

export default async function LmsRulesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const ruleParam = first(sp.rule);
  const err = first(sp.error);

  const { orgId, role } = await requireTenant();
  const isAdmin = roleAtLeast(role, "admin");

  const [rules, runs, courseRows, teamRows] = await Promise.all([
    listRules(orgId),
    listRuleRuns(orgId, 30),
    listLmsCoursesMirror(orgId, { activeOnly: true }),
    listLmsTeamsMirror(orgId),
  ]);
  const courses: RuleBuilderOption[] = courseRows.map((c) => ({ litmosId: c.litmosId, name: c.name }));
  const teams: RuleBuilderOption[] = teamRows.map((t) => ({ litmosId: t.litmosId, name: t.name }));
  const ruleNameById = new Map(rules.map((r) => [r.id, r.name]));
  const editing = ruleParam ? rules.find((r) => r.id === ruleParam) : undefined;

  async function createRuleAction(formData: FormData) {
    "use server";
    const { orgId, userId } = await requireTenant("admin");
    const userEmail = (await getUserEmail()) ?? userId;
    let error = "";
    try {
      await createRule(orgId, userEmail, {
        name: String(formData.get("name") || ""),
        description: String(formData.get("description") || "") || undefined,
        trigger: String(formData.get("trigger") || "") as RuleTrigger,
        conditions: parseConditionsField(String(formData.get("conditions") || "")),
        actions: parseActionsField(String(formData.get("actions") || "")),
        enabled: formData.get("enabled") === "1",
      });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    if (error) redirect(`/lms/rules?error=${encodeURIComponent(error)}`);
    revalidatePath("/lms/rules");
  }

  async function updateRuleAction(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("admin");
    const id = String(formData.get("id") || "");
    let error = "";
    try {
      await updateRule(orgId, id, {
        name: String(formData.get("name") || ""),
        description: String(formData.get("description") || "") || undefined,
        trigger: String(formData.get("trigger") || "") as RuleTrigger,
        conditions: parseConditionsField(String(formData.get("conditions") || "")),
        actions: parseActionsField(String(formData.get("actions") || "")),
        enabled: formData.get("enabled") === "1",
      });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    if (error) redirect(`/lms/rules?rule=${encodeURIComponent(id)}&error=${encodeURIComponent(error)}`);
    revalidatePath("/lms/rules");
    redirect("/lms/rules"); // success clears ?rule so the edit panel closes
  }

  async function toggleRule(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("admin");
    await setRuleEnabled(orgId, String(formData.get("id") || ""), formData.get("enabled") === "1");
    revalidatePath("/lms/rules");
  }

  async function removeRule(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("admin");
    await deleteRule(orgId, String(formData.get("id") || ""));
    revalidatePath("/lms/rules");
  }

  return (
    <>
      <PageHeader title="Rules" subtitle="Automation your admins own: assignments, team placement, and notifications that fire themselves." />

      {err && (
        <Panel className="mb-6">
          <p className="text-sm text-jericho-bad">{err}</p>
        </Panel>
      )}

      {rules.length === 0 ? (
        <EmptyState title="No rules yet">
          {isAdmin ? "Create your first automation below — e.g. assign onboarding training to every new learner." : "An admin can create automations here."}
        </EmptyState>
      ) : (
        <Panel className="p-0 overflow-x-auto mb-6">
          <table className="w-full text-sm">
            <thead className="text-left text-jericho-muted border-b border-jericho-border">
              <tr>
                <th className="px-4 py-3 font-medium">Rule</th>
                <th className="px-4 py-3 font-medium">When</th>
                <th className="px-4 py-3 font-medium">Then</th>
                <th className="px-4 py-3 font-medium">State</th>
                <th className="px-4 py-3 font-medium">Fired</th>
                {isAdmin && <th className="px-4 py-3 font-medium"></th>}
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => {
                const badge = <Badge tone={r.enabled ? "low" : "medium"}>{r.enabled ? "enabled" : "disabled"}</Badge>;
                return (
                  <tr key={r.id} className="border-b border-jericho-border/50 last:border-0">
                    <td className="px-4 py-3">
                      <div className="text-jericho-text">{r.name}</div>
                      {r.description && <div className="text-xs text-jericho-muted max-w-xs line-clamp-1">{r.description}</div>}
                    </td>
                    <td className="px-4 py-3 text-jericho-muted">{triggerLabel(r.trigger)}</td>
                    <td className="px-4 py-3 text-jericho-muted max-w-sm">
                      {parseRuleActions(r.actions).map(actionSummary).join(" · ") || "—"}
                    </td>
                    <td className="px-4 py-3">
                      {isAdmin ? (
                        <form action={toggleRule} className="inline">
                          <input type="hidden" name="id" value={r.id} />
                          <input type="hidden" name="enabled" value={r.enabled ? "0" : "1"} />
                          <button type="submit" title={r.enabled ? "Click to disable" : "Click to enable"}>
                            {badge}
                          </button>
                        </form>
                      ) : (
                        badge
                      )}
                    </td>
                    <td className="px-4 py-3 text-jericho-muted whitespace-nowrap">
                      {r.fireCount}× {r.lastFiredAt ? `· last ${new Date(r.lastFiredAt).toLocaleDateString()}` : "· never"}
                    </td>
                    {isAdmin && (
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <Link href={`/lms/rules?rule=${encodeURIComponent(r.id)}`} className="text-jericho-accent hover:underline mr-3">
                          edit
                        </Link>
                        <form action={removeRule} className="inline">
                          <input type="hidden" name="id" value={r.id} />
                          <button className="text-xs text-jericho-muted hover:text-jericho-bad" type="submit">
                            delete
                          </button>
                        </form>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      )}

      {isAdmin && (
        <Panel className="mb-6">
          {editing ? (
            <>
              <div className="flex items-start justify-between gap-4 mb-3">
                <h3 className="font-medium">Edit rule — {editing.name}</h3>
                <Link href="/lms/rules" className="text-sm text-jericho-muted hover:text-jericho-text">
                  Cancel
                </Link>
              </div>
              <form action={updateRuleAction}>
                <input type="hidden" name="id" value={editing.id} />
                <RuleBuilder
                  key={editing.id}
                  courses={courses}
                  teams={teams}
                  initial={{
                    name: editing.name,
                    description: editing.description ?? "",
                    trigger: editing.trigger as RuleTrigger,
                    conditions: parseRuleConditions(editing.conditions),
                    actions: parseRuleActions(editing.actions),
                    enabled: editing.enabled,
                  }}
                  submitLabel="Save rule"
                />
              </form>
            </>
          ) : (
            <>
              <h3 className="font-medium mb-3">Create a rule</h3>
              <form action={createRuleAction}>
                <RuleBuilder key="new" courses={courses} teams={teams} submitLabel="Create rule" />
              </form>
            </>
          )}
        </Panel>
      )}

      <Panel>
        <h3 className="font-medium mb-3">Recent activity</h3>
        {runs.length === 0 ? (
          <EmptyState title="Rules haven't fired yet">
            Firings show up here as sync, webhooks, and the scheduler deliver matching events.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left text-xs uppercase tracking-wide text-jericho-muted pb-2">Rule</th>
                  <th className="text-left text-xs uppercase tracking-wide text-jericho-muted pb-2">Fired</th>
                  <th className="text-left text-xs uppercase tracking-wide text-jericho-muted pb-2">Status</th>
                  <th className="text-left text-xs uppercase tracking-wide text-jericho-muted pb-2">Subject</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id} className="border-t border-jericho-border/60 text-sm">
                    <td className="py-2 pr-4">{ruleNameById.get(run.ruleId) ?? <span className="text-jericho-muted">(deleted rule)</span>}</td>
                    <td className="py-2 pr-4 text-jericho-muted whitespace-nowrap">{new Date(run.firedAt).toLocaleString()}</td>
                    <td className="py-2 pr-4">
                      <Badge tone={runTone(run.status)}>{run.status}</Badge>
                    </td>
                    <td className="py-2 text-jericho-muted">{runSubject(run.subject)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <p className="text-xs text-jericho-muted mt-4">
        How rules run: events are fired by Litmos sync, webhooks, and the lms-duedates scheduler; each rule fires once per subject per
        cycle (idempotency ledger), so re-delivered events never double-execute actions.
      </p>
    </>
  );
}
