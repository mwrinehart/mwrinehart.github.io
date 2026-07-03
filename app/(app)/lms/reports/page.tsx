import Link from "next/link";
import { requireTenant } from "@/lib/platform/org";
import {
  completionByCourse,
  completionByTeam,
  correlateTrainingRisk,
  lmsOverview,
  monthlyTrend,
  overdueAging,
  trainingStatsByEmail,
} from "@/lib/modules/lms/reports";
import { complianceForecast } from "@/lib/modules/lms/compliance";
import { riskByEmail } from "@/lib/modules/behavior/reports";
import { Badge, EmptyState, PageHeader, Panel, Stat } from "@/components/ui";

const CSV_REPORTS = ["courses", "teams", "assignments", "compliance", "risk-training"];

function riskBand(score: number): string {
  return score >= 80 ? "critical" : score >= 60 ? "high" : score >= 40 ? "medium" : "low";
}

// Brief-specified badge mapping: high and critical bands both render the red badge.
function bandTone(band: string): string {
  if (band === "low") return "low";
  if (band === "medium") return "medium";
  return "high";
}

function bandTextColor(band: string): string {
  if (band === "low") return "text-jericho-good";
  if (band === "medium") return "text-jericho-warn";
  return "text-jericho-bad";
}

function CompletionBar({ rate }: { rate: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 rounded bg-jericho-border overflow-hidden">
        <div className="h-full bg-jericho-accent" style={{ width: `${Math.min(100, Math.max(0, rate))}%` }} />
      </div>
      <span className="text-xs text-jericho-muted w-8 text-right">{rate}%</span>
    </div>
  );
}

const thCls = "text-left text-xs uppercase tracking-wide text-jericho-muted pb-2";

export default async function LmsReportsPage() {
  const { orgId } = await requireTenant();
  const [overview, byCourse, byTeam, aging, trend, forecast, training, risk] = await Promise.all([
    lmsOverview(orgId),
    completionByCourse(orgId),
    completionByTeam(orgId),
    overdueAging(orgId),
    monthlyTrend(orgId, 6),
    complianceForecast(orgId),
    trainingStatsByEmail(orgId),
    riskByEmail(orgId),
  ]);
  const { rows: riskRows, bands } = correlateTrainingRisk(risk, training);
  const undertrained = [...riskRows].sort((a, b) => b.riskScore - a.riskScore || b.overdue - a.overdue).slice(0, 10);

  const agingMax = Math.max(1, ...aging.map((b) => b.count));
  const trendMax = Math.max(1, ...trend.flatMap((m) => [m.assigned, m.completed]));

  return (
    <>
      <PageHeader title="Reports" subtitle="Litmos training × Jericho Security phishing risk, in one place." />

      <Panel className="mb-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-jericho-muted mr-2">Export CSV</span>
          {CSV_REPORTS.map((r) => (
            <a
              key={r}
              href={`/api/lms/reports/${r}`}
              className="rounded-lg border border-jericho-border px-3 py-2 text-sm text-jericho-accent hover:bg-jericho-border/40"
            >
              ⬇ {r}.csv
            </a>
          ))}
        </div>
      </Panel>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <Stat label="Learners" value={overview.learners} />
        <Stat label="Courses" value={overview.courses} />
        <Stat label="Open assignments" value={overview.openAssignments} />
        <Stat
          label="Overdue"
          value={<span className={overview.overdue > 0 ? "text-jericho-warn" : undefined}>{overview.overdue}</span>}
        />
        <Stat label="Compliance" value={overview.complianceRate === null ? "—" : `${overview.complianceRate}%`} />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Panel>
          <h3 className="font-medium mb-3">Completion by course</h3>
          {byCourse.length === 0 ? (
            <p className="text-sm text-jericho-muted">No assignments yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className={thCls}>Course</th>
                    <th className={thCls}>Assigned</th>
                    <th className={thCls}>Completed</th>
                    <th className={thCls}>Overdue</th>
                    <th className={thCls}>Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {byCourse.slice(0, 15).map((c) => (
                    <tr key={c.courseId} className="border-t border-jericho-border/60 text-sm">
                      <td className="py-2 pr-2 max-w-[16rem]">
                        <Link href={`/lms/assignments?course=${encodeURIComponent(c.courseId)}`} className="hover:text-jericho-accent">
                          {c.courseName}
                        </Link>
                      </td>
                      <td className="py-2 pr-2">{c.assigned}</td>
                      <td className="py-2 pr-2">{c.completed}</td>
                      <td className={`py-2 pr-2 ${c.overdue > 0 ? "text-jericho-bad" : "text-jericho-muted"}`}>{c.overdue}</td>
                      <td className="py-2">
                        <CompletionBar rate={c.completionRate} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel>
          <h3 className="font-medium mb-3">Completion by team</h3>
          {byTeam.length === 0 ? (
            <p className="text-sm text-jericho-muted">No teams synced yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className={thCls}>Team</th>
                    <th className={thCls}>Learners</th>
                    <th className={thCls}>Assigned</th>
                    <th className={thCls}>Completed</th>
                    <th className={thCls}>Overdue</th>
                    <th className={thCls}>Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {byTeam.slice(0, 15).map((t) => (
                    <tr key={t.teamId} className="border-t border-jericho-border/60 text-sm">
                      <td className="py-2 pr-2 max-w-[14rem] truncate">{t.teamName}</td>
                      <td className="py-2 pr-2">{t.learners}</td>
                      <td className="py-2 pr-2">{t.assigned}</td>
                      <td className="py-2 pr-2">{t.completed}</td>
                      <td className={`py-2 pr-2 ${t.overdue > 0 ? "text-jericho-bad" : "text-jericho-muted"}`}>{t.overdue}</td>
                      <td className="py-2">
                        <CompletionBar rate={t.completionRate} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel>
          <h3 className="font-medium mb-3">Overdue aging</h3>
          <div className="space-y-3">
            {aging.map((b) => (
              <div key={b.label} className="flex items-center gap-3">
                <span className="text-xs text-jericho-muted w-14">{b.label}</span>
                <div className="flex-1 h-2 rounded bg-jericho-border/40 overflow-hidden">
                  <div className="h-full rounded bg-jericho-accent" style={{ width: `${(b.count / agingMax) * 100}%` }} />
                </div>
                <span className={`text-sm w-8 text-right ${b.count > 0 ? "text-jericho-bad" : "text-jericho-muted"}`}>{b.count}</span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel>
          <h3 className="font-medium mb-3">Monthly trend</h3>
          <div className="flex items-end gap-3 h-28">
            {trend.map((m) => (
              <div key={m.month} className="flex-1 flex items-end justify-center gap-1 h-full">
                <div
                  className="w-2 rounded-t bg-jericho-border"
                  style={{ height: `${(m.assigned / trendMax) * 100}%`, minHeight: m.assigned > 0 ? 2 : 0 }}
                />
                <div
                  className="w-2 rounded-t bg-jericho-accent"
                  style={{ height: `${(m.completed / trendMax) * 100}%`, minHeight: m.completed > 0 ? 2 : 0 }}
                />
              </div>
            ))}
          </div>
          <div className="flex gap-3 mt-1">
            {trend.map((m) => (
              <div key={m.month} className="flex-1 text-center text-[10px] text-jericho-muted">
                {m.month}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-4 mt-3 text-[11px] text-jericho-muted">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-sm bg-jericho-border" /> assigned
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-sm bg-jericho-accent" /> completed
            </span>
          </div>
        </Panel>

        <Panel>
          <h3 className="font-medium mb-3">Compliance forecast</h3>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "Expiring ≤30d", value: forecast.in30 },
              { label: "Expiring ≤60d", value: forecast.in60 },
              { label: "Expiring ≤90d", value: forecast.in90 },
              { label: "Expired", value: forecast.expired, bad: true },
            ].map((c) => (
              <div key={c.label} className="rounded-lg border border-jericho-border p-3">
                <div className="text-xs uppercase tracking-wide text-jericho-muted">{c.label}</div>
                <div className={`text-2xl font-semibold mt-1 ${c.bad && c.value > 0 ? "text-jericho-bad" : "text-jericho-text"}`}>
                  {c.value}
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel className="md:col-span-2">
          <h3 className="font-medium mb-1">Risk × training</h3>
          <p className="text-sm text-jericho-muted mb-4">
            Phishing risk scores come from the Jericho app connector (Behavior → Sources).
          </p>
          {riskRows.length === 0 ? (
            <EmptyState title="No phishing risk data yet">
              Connect the Jericho app under{" "}
              <Link href="/behavior/sources" className="text-jericho-accent hover:underline">
                Behavior → Sources
              </Link>{" "}
              and run a sync to correlate risk scores with training history.
            </EmptyState>
          ) : (
            <>
              <div className="overflow-x-auto mb-6">
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className={thCls}>Risk band</th>
                      <th className={thCls}>People</th>
                      <th className={thCls}>Avg completed</th>
                      <th className={thCls}>Avg overdue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bands.map((b) => (
                      <tr key={b.band} className="border-t border-jericho-border/60 text-sm">
                        <td className="py-2 pr-2">
                          <Badge tone={bandTone(b.band)}>{b.band}</Badge>
                        </td>
                        <td className="py-2 pr-2">{b.count}</td>
                        <td className="py-2 pr-2">{b.avgCompleted}</td>
                        <td className="py-2">{b.avgOverdue}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <h4 className="text-xs uppercase tracking-wide text-jericho-muted mb-2">Highest-risk undertrained</h4>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className={thCls}>Learner</th>
                      <th className={thCls}>Risk score</th>
                      <th className={thCls}>Completed</th>
                      <th className={thCls}>Open</th>
                      <th className={thCls}>Overdue</th>
                      <th className={thCls}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {undertrained.map((r) => (
                      <tr key={r.email} className="border-t border-jericho-border/60 text-sm">
                        <td className="py-2 pr-2">
                          <div>{r.email}</div>
                          {r.name && <div className="text-xs text-jericho-muted">{r.name}</div>}
                        </td>
                        <td className={`py-2 pr-2 font-medium ${bandTextColor(riskBand(r.riskScore))}`}>{r.riskScore}</td>
                        <td className="py-2 pr-2">{r.completed}</td>
                        <td className="py-2 pr-2">{r.open}</td>
                        <td className={`py-2 pr-2 ${r.overdue > 0 ? "text-jericho-bad" : "text-jericho-muted"}`}>{r.overdue}</td>
                        <td className="py-2 text-right">
                          <Link
                            href={`/lms/assignments?learner=${encodeURIComponent(r.email)}`}
                            className="text-jericho-accent hover:underline whitespace-nowrap"
                          >
                            assign →
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Panel>
      </div>
    </>
  );
}
