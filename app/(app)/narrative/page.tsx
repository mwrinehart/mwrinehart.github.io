import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/platform/org";
import { listNarratives, listWatchTerms, narrativeOverview, scanOrgNarrativeSources } from "@/lib/modules/narrative/scan";
import { aiKeyFor, assessNewNarratives } from "@/lib/modules/narrative/analyze";
import { severityForScore } from "@/lib/modules/narrative/scoring";
import { seedNarrativeDemo } from "@/lib/modules/narrative/seed";
import { Badge, EmptyState, PageHeader, Panel, Stat } from "@/components/ui";

// Badge tones for this module's verdict/status strings (severity strings map
// directly onto Badge's low|medium|high|critical styles).
function verdictTone(verdict: string): string {
  if (verdict === "false") return "critical";
  if (verdict === "misleading") return "high";
  if (verdict === "unsubstantiated" || verdict === "unverified") return "medium";
  return "low"; // true
}

function statusTone(status: string): string {
  if (status === "emerging") return "medium";
  if (status === "active") return "high";
  if (status === "countered") return "low";
  return status; // dismissed → falls back to the gray Badge style
}

// Narrative module overview — detected narratives ranked by threat score, with
// the scan / AI-assessment entry points.
export default async function NarrativeOverviewPage() {
  const { orgId, role } = await requireTenant();
  const [overview, rows, aiKey, watchTerms] = await Promise.all([
    narrativeOverview(orgId),
    listNarratives(orgId, 50),
    aiKeyFor(orgId),
    listWatchTerms(orgId),
  ]);
  const aiAvailable = !!aiKey;

  async function loadSample() {
    "use server";
    const { orgId } = await requireTenant("member");
    await seedNarrativeDemo(orgId);
    revalidatePath("/narrative");
  }
  async function scan() {
    "use server";
    const { orgId } = await requireTenant("member");
    try {
      await scanOrgNarrativeSources(orgId);
    } catch {
      // Fetch/network failure: the page renders whatever state exists and the
      // narrative-scan cron retries, so don't surface a server-action error.
    }
    revalidatePath("/narrative");
  }
  async function assessNew() {
    "use server";
    const { orgId } = await requireTenant("member");
    try {
      await assessNewNarratives(orgId, 10);
    } catch {
      // AI failure: leave narratives unassessed (cron will retry) rather than
      // surfacing an unhandled server-action error to the user.
    }
    revalidatePath("/narrative");
  }

  return (
    <>
      <PageHeader
        title="Narrative defense"
        subtitle="Disinformation monitoring — scan traditional and social media for false narratives about your organization, assess them against your verified facts, and counter with human approval."
        action={
          overview.narratives === 0 && role !== "viewer" ? (
            <form action={loadSample}>
              <button className="rounded-lg bg-jericho-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90" type="submit">
                Load sample data
              </button>
            </form>
          ) : undefined
        }
      />

      {overview.narratives === 0 && watchTerms.length === 0 ? (
        <EmptyState title="No narratives yet">
          Add watch terms (your org&rsquo;s name, products, executives) and media sources on the{" "}
          <Link href="/narrative/sources" className="text-jericho-accent hover:underline">
            Sources
          </Link>{" "}
          tab, then run a scan to start detecting narratives.
          {role !== "viewer" && " Or use “Load sample data” to see the module working end-to-end."}
        </EmptyState>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <Stat label="Narratives" value={overview.narratives} />
            <Stat label="False active" value={overview.activeFalse} hint="false/misleading, not countered" />
            <Stat label="Open alerts" value={overview.openAlerts} />
            <Stat label="Pending responses" value={overview.pendingResponses} />
          </div>

          <div className="mb-6 flex flex-wrap items-center gap-3">
            <form action={scan}>
              <button className="rounded-lg bg-jericho-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90" type="submit">
                Scan sources now
              </button>
            </form>
            {aiAvailable ? (
              <form action={assessNew}>
                <button className="rounded-lg border border-jericho-border px-3 py-2 text-sm text-jericho-accent hover:bg-jericho-border/40" type="submit">
                  Assess new (AI)
                </button>
              </form>
            ) : (
              <p className="text-xs text-jericho-muted">
                Add an Anthropic API key in Settings → Integrations to enable AI assessment
              </p>
            )}
          </div>

          {rows.length === 0 ? (
            <EmptyState title="No narratives detected yet">
              Click “Scan sources now”, or wait for the scheduled <code>narrative-scan</code> job to pick up mentions matching your
              watch terms.
            </EmptyState>
          ) : (
            <div className="space-y-3">
              {rows.map((n) => {
                const severity = severityForScore(n.threatScore);
                return (
                  <Link key={n.id} href={`/narrative/${n.id}`} className="block">
                    <Panel className="transition-colors hover:border-jericho-accent/60">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={severity}>{severity}</Badge>
                        <span className="text-xs text-jericho-muted">score {n.threatScore}</span>
                        <Badge tone={verdictTone(n.verdict)}>{n.verdict}</Badge>
                        <Badge tone={statusTone(n.status)}>{n.status}</Badge>
                        <span className="ml-auto text-xs text-jericho-muted">
                          last seen {new Date(n.lastSeenAt).toLocaleDateString()}
                        </span>
                      </div>
                      <div className="mt-1 font-medium text-jericho-text">{n.title}</div>
                      <div className="mt-2 flex flex-wrap gap-4 text-xs text-jericho-muted">
                        <span>{n.mentionCount} mentions</span>
                        <span>reach {n.totalReach.toLocaleString()}</span>
                        <span>{n.velocity} in 24h</span>
                      </div>
                    </Panel>
                  </Link>
                );
              })}
            </div>
          )}
        </>
      )}
    </>
  );
}
