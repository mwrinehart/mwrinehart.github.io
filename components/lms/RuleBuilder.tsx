"use client";

// Interactive rule editor: admins compose trigger + conditions + an action list,
// which serialize into hidden JSON fields (`conditions`, `actions`) submitted by
// the surrounding server-action <form>. Types come from the same module the
// server evaluator uses, so what you build here is exactly what fires.

import { useState } from "react";
import {
  NOTIFY_CHANNELS,
  RULE_TRIGGERS,
  type NotifyChannelId,
  type RuleAction,
  type RuleConditions,
  type RuleTrigger,
} from "@/lib/modules/lms/types";

const inputCls =
  "w-full rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent";
const selectCls = inputCls;

export interface RuleBuilderOption {
  litmosId: string;
  name: string;
}

export function RuleBuilder({
  courses,
  teams,
  initial,
  submitLabel,
}: {
  courses: RuleBuilderOption[];
  teams: RuleBuilderOption[];
  initial?: {
    name: string;
    description: string;
    trigger: RuleTrigger;
    conditions: RuleConditions;
    actions: RuleAction[];
    enabled: boolean;
  };
  submitLabel: string;
}) {
  const [trigger, setTrigger] = useState<RuleTrigger>(initial?.trigger ?? "learner.created");
  const [conditions, setConditions] = useState<RuleConditions>(initial?.conditions ?? {});
  const [actions, setActions] = useState<RuleAction[]>(initial?.actions ?? [{ type: "notify", channel: "email" }]);

  const triggerDef = RULE_TRIGGERS.find((t) => t.value === trigger);
  const patchCond = (patch: Partial<RuleConditions>) => setConditions((c) => ({ ...c, ...patch }));
  const patchAction = (i: number, next: RuleAction) => setActions((a) => a.map((x, j) => (j === i ? next : x)));
  const removeAction = (i: number) => setActions((a) => a.filter((_, j) => j !== i));

  return (
    <div className="space-y-4">
      <input type="hidden" name="conditions" value={JSON.stringify(conditions)} />
      <input type="hidden" name="actions" value={JSON.stringify(actions)} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs text-jericho-muted">Rule name</span>
          <input name="name" required defaultValue={initial?.name ?? ""} placeholder="e.g. Onboard new hires" className={`mt-1 ${inputCls}`} />
        </label>
        <label className="block">
          <span className="text-xs text-jericho-muted">Description (optional)</span>
          <input name="description" defaultValue={initial?.description ?? ""} className={`mt-1 ${inputCls}`} />
        </label>
      </div>

      <div>
        <label className="block md:w-1/2">
          <span className="text-xs text-jericho-muted">When (trigger)</span>
          <select name="trigger" value={trigger} onChange={(e) => setTrigger(e.target.value as RuleTrigger)} className={`mt-1 ${selectCls}`}>
            {RULE_TRIGGERS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        {triggerDef && <p className="text-xs text-jericho-muted mt-1">{triggerDef.hint}</p>}
      </div>

      <fieldset className="rounded-lg border border-jericho-border p-4">
        <legend className="px-1 text-xs uppercase tracking-wide text-jericho-muted">Only if (conditions — all must match)</legend>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <MultiPick
            label="Learner is in any of these teams"
            options={teams}
            selected={conditions.teamIds ?? []}
            onChange={(teamIds) => patchCond({ teamIds: teamIds.length ? teamIds : undefined })}
          />
          <label className="block">
            <span className="text-xs text-jericho-muted">Email domain is one of (comma-separated)</span>
            <input
              defaultValue={(conditions.emailDomains ?? []).join(", ")}
              onChange={(e) => {
                const domains = e.target.value.split(",").map((s) => s.trim().replace(/^@/, "").toLowerCase()).filter(Boolean);
                patchCond({ emailDomains: domains.length ? domains : undefined });
              }}
              placeholder="acme.com, acme.co.uk"
              className={`mt-1 ${inputCls}`}
            />
          </label>
          {(trigger === "assignment.completed" || trigger === "assignment.due_soon" || trigger === "assignment.overdue") && (
            <MultiPick
              label="Course is any of"
              options={courses}
              selected={conditions.courseIds ?? []}
              onChange={(courseIds) => patchCond({ courseIds: courseIds.length ? courseIds : undefined })}
            />
          )}
          {trigger === "assignment.due_soon" && (
            <NumberField label="Fire when days until due ≤" value={conditions.maxDaysLeft} onChange={(maxDaysLeft) => patchCond({ maxDaysLeft })} placeholder="7" />
          )}
          {trigger === "assignment.overdue" && (
            <NumberField label="Fire when days overdue ≥" value={conditions.minDaysOverdue} onChange={(minDaysOverdue) => patchCond({ minDaysOverdue })} placeholder="1" />
          )}
          {trigger === "compliance.expiring" && (
            <NumberField label="Fire when days to expiry ≤" value={conditions.maxDaysToExpiry} onChange={(maxDaysToExpiry) => patchCond({ maxDaysToExpiry })} placeholder="30" />
          )}
          {trigger === "assignment.completed" && (
            <>
              <NumberField label="Minimum score" value={conditions.minScore} onChange={(minScore) => patchCond({ minScore })} placeholder="0" />
              <NumberField label="Maximum score" value={conditions.maxScore} onChange={(maxScore) => patchCond({ maxScore })} placeholder="100" />
            </>
          )}
        </div>
      </fieldset>

      <fieldset className="rounded-lg border border-jericho-border p-4">
        <legend className="px-1 text-xs uppercase tracking-wide text-jericho-muted">Then (actions)</legend>
        <div className="space-y-3">
          {actions.map((action, i) => (
            <ActionRow key={i} action={action} courses={courses} teams={teams} onChange={(a) => patchAction(i, a)} onRemove={actions.length > 1 ? () => removeAction(i) : undefined} />
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={() => setActions((a) => [...a, { type: "assign_course", courseId: courses[0]?.litmosId ?? "" }])} className="rounded-lg border border-jericho-border px-3 py-1.5 text-xs text-jericho-accent hover:bg-jericho-border/40">
            + Assign a course
          </button>
          <button type="button" onClick={() => setActions((a) => [...a, { type: "notify", channel: "slack" }])} className="rounded-lg border border-jericho-border px-3 py-1.5 text-xs text-jericho-accent hover:bg-jericho-border/40">
            + Send a notification
          </button>
        </div>
      </fieldset>

      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="enabled" value="1" defaultChecked={initial?.enabled ?? true} />
          Enabled
        </label>
        <button type="submit" className="rounded-lg bg-jericho-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90">
          {submitLabel}
        </button>
      </div>
    </div>
  );
}

function ActionRow({
  action,
  courses,
  teams,
  onChange,
  onRemove,
}: {
  action: RuleAction;
  courses: RuleBuilderOption[];
  teams: RuleBuilderOption[];
  onChange: (a: RuleAction) => void;
  onRemove?: () => void;
}) {
  const retype = (type: RuleAction["type"]): RuleAction => {
    switch (type) {
      case "assign_course":
        return { type, courseId: courses[0]?.litmosId ?? "" };
      case "add_to_team":
        return { type, teamId: teams[0]?.litmosId ?? "" };
      case "notify":
        return { type, channel: "slack" };
      case "notify_learner":
        return { type };
    }
  };

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg bg-jericho-bg/60 border border-jericho-border/60 p-3">
      <label className="block">
        <span className="text-xs text-jericho-muted">Action</span>
        <select value={action.type} onChange={(e) => onChange(retype(e.target.value as RuleAction["type"]))} className={`mt-1 ${selectCls} w-44`}>
          <option value="assign_course">Assign course</option>
          <option value="add_to_team">Add to team</option>
          <option value="notify">Notify a channel</option>
          <option value="notify_learner">Email the learner</option>
        </select>
      </label>

      {action.type === "assign_course" && (
        <>
          <label className="block">
            <span className="text-xs text-jericho-muted">Course</span>
            <select
              value={action.courseId}
              onChange={(e) => {
                const c = courses.find((x) => x.litmosId === e.target.value);
                onChange({ ...action, courseId: e.target.value, courseName: c?.name });
              }}
              className={`mt-1 ${selectCls} w-64`}
            >
              {courses.map((c) => (
                <option key={c.litmosId} value={c.litmosId}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-jericho-muted">Due in (days)</span>
            <input
              type="number"
              min={1}
              value={action.dueInDays ?? ""}
              onChange={(e) => onChange({ ...action, dueInDays: e.target.value ? Number(e.target.value) : undefined })}
              placeholder="30"
              className={`mt-1 ${inputCls} w-24`}
            />
          </label>
        </>
      )}

      {action.type === "add_to_team" && (
        <label className="block">
          <span className="text-xs text-jericho-muted">Team</span>
          <select
            value={action.teamId}
            onChange={(e) => {
              const t = teams.find((x) => x.litmosId === e.target.value);
              onChange({ ...action, teamId: e.target.value, teamName: t?.name });
            }}
            className={`mt-1 ${selectCls} w-64`}
          >
            {teams.map((t) => (
              <option key={t.litmosId} value={t.litmosId}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {action.type === "notify" && (
        <>
          <label className="block">
            <span className="text-xs text-jericho-muted">Channel</span>
            <select value={action.channel} onChange={(e) => onChange({ ...action, channel: e.target.value as NotifyChannelId })} className={`mt-1 ${selectCls} w-36`}>
              {NOTIFY_CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {c === "googlechat" ? "Google Chat" : c}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-jericho-muted">Target (optional — org default if blank)</span>
            <input
              value={action.target ?? ""}
              onChange={(e) => onChange({ ...action, target: e.target.value || undefined })}
              placeholder="channel id / webhook / email"
              className={`mt-1 ${inputCls} w-64`}
            />
          </label>
        </>
      )}

      {(action.type === "notify" || action.type === "notify_learner") && (
        <label className="block flex-1 min-w-56">
          <span className="text-xs text-jericho-muted">Message (optional — supports {"{{learner}} {{course}} {{dueDate}}"})</span>
          <input
            value={action.message ?? ""}
            onChange={(e) => onChange({ ...action, message: e.target.value || undefined })}
            placeholder="{{learner}} — {{course}} needs your attention"
            className={`mt-1 ${inputCls}`}
          />
        </label>
      )}

      {onRemove && (
        <button type="button" onClick={onRemove} className="text-xs text-jericho-muted hover:text-jericho-bad pb-2.5">
          remove
        </button>
      )}
    </div>
  );
}

function MultiPick({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: RuleBuilderOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  if (!options.length) {
    return (
      <div className="block">
        <span className="text-xs text-jericho-muted">{label}</span>
        <p className="mt-1 text-xs text-jericho-muted italic">None synced yet — any will match.</p>
      </div>
    );
  }
  return (
    <div className="block">
      <span className="text-xs text-jericho-muted">{label}</span>
      <div className="mt-1 max-h-32 overflow-y-auto rounded-lg border border-jericho-border bg-jericho-bg p-2 space-y-1">
        {options.map((o) => (
          <label key={o.litmosId} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={selected.includes(o.litmosId)}
              onChange={(e) => onChange(e.target.checked ? [...selected, o.litmosId] : selected.filter((x) => x !== o.litmosId))}
            />
            <span className="truncate">{o.name}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function NumberField({ label, value, onChange, placeholder }: { label: string; value: number | undefined; onChange: (n: number | undefined) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="text-xs text-jericho-muted">{label}</span>
      <input
        type="number"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
        placeholder={placeholder}
        className={`mt-1 ${inputCls}`}
      />
    </label>
  );
}
