import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/platform/org";
import { listFeeds, listFindings, scanOrgComplianceFeeds } from "@/lib/modules/compliance/scan";
import { aiKeyFor, analyzeFinding, analyzeNewFindings } from "@/lib/modules/compliance/analyze";
import { Badge, EmptyState, PageHeader, Panel } from "@/components/ui";

function parseStrArray(json: string | null): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((s) => typeof s === "string") : [];
  } catch {
    return [];
  }
}

function parsePolicies(json: string | null): Array<{ reference?: string; title?: string; why?: string }> {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

// Compliance Radar — findings, with AI summaries + policy cross-reference.
export default async function ComplianceFindingsPage() {
  const { orgId } = await requireTenant();
  const [feeds, findings, aiKey] = await Promise.all([listFeeds(orgId), listFindings(orgId), aiKeyFor(orgId)]);
  const hasFeeds = feeds.some((f) => f.enabled);
  const aiAvailable = !!aiKey;
  const unanalyzed = findings.some((f) => !f.analyzedAt);

  async function scan() {
    "use server";
    const { orgId } = await requireTenant("member");
    await scanOrgComplianceFeeds(orgId);
    revalidatePath("/compliance");
  }
  async function analyzeOne(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("member");
    await analyzeFinding(orgId, String(formData.get("id") || ""));
    revalidatePath("/compliance");
  }
  async function analyzeNew() {
    "use server";
    const { orgId } = await requireTenant("member");
    await analyzeNewFindings(orgId, 10);
    revalidatePath("/compliance");
  }

  return (
    <>
      <PageHeader
        title="Compliance Radar"
        subtitle="Regulatory & threat findings from your feeds, classified and AI-cross-referenced against your policies."
        action={
          <div className="flex gap-2">
            {aiAvailable && unanalyzed && findings.length > 0 && (
              <form action={analyzeNew}>
                <button className="rounded-lg border border-jericho-border px-3 py-2 text-sm text-jericho-accent hover:bg-jericho-border/40" type="submit">
                  Analyze new
                </button>
              </form>
            )}
            {hasFeeds && (
              <form action={scan}>
                <button className="rounded-lg bg-jericho-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90" type="submit">
                  Scan now
                </button>
              </form>
            )}
          </div>
        }
      />

      {!aiAvailable && findings.length > 0 && (
        <p className="mb-4 text-xs text-jericho-muted">
          AI summaries are off — set an Anthropic API key (org secret <code>anthropicApiKey</code> or the platform{" "}
          <code>ANTHROPIC_API_KEY</code>) to enable summaries and policy cross-reference.
        </p>
      )}

      {findings.length === 0 ? (
        <EmptyState title={hasFeeds ? "No findings yet" : "No feeds configured"}>
          {hasFeeds ? (
            <>
              Click “Scan now”, or wait for the scheduled <code>compliance-scan</code> job.
            </>
          ) : (
            <>
              Add feeds on the{" "}
              <Link href="/compliance/feeds" className="text-jericho-accent hover:underline">
                Feeds
              </Link>{" "}
              tab to start scanning.
            </>
          )}
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {findings.map((f) => {
            const actions = parseStrArray(f.aiActions);
            const mapped = parsePolicies(f.mappedPolicies);
            return (
              <Panel key={f.id}>
                <div className="flex items-center gap-2">
                  <Badge tone={f.severity === "low" ? "low" : f.severity === "medium" ? "medium" : "high"}>{f.severity}</Badge>
                  {f.category && <span className="text-xs text-jericho-muted">{f.category}</span>}
                  <span className="ml-auto text-xs text-jericho-muted">{f.feedName}</span>
                </div>
                <a href={f.link ?? "#"} target="_blank" rel="noreferrer" className="block font-medium mt-1 hover:text-jericho-accent">
                  {f.title}
                </a>

                {f.aiSummary ? (
                  <div className="mt-2 rounded-lg border border-jericho-border/60 bg-jericho-bg/40 p-3">
                    <p className="text-sm text-jericho-text">{f.aiSummary}</p>
                    {actions.length > 0 && (
                      <ul className="mt-2 list-disc pl-5 text-sm text-jericho-muted space-y-1">
                        {actions.map((a, i) => (
                          <li key={i}>{a}</li>
                        ))}
                      </ul>
                    )}
                    {mapped.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {mapped.map((m, i) => (
                          <span key={i} className="rounded-full bg-jericho-accent/15 px-2.5 py-0.5 text-xs text-jericho-accent" title={m.why}>
                            {m.reference ? `${m.reference} · ` : ""}
                            {m.title}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="mt-2 flex items-center gap-3">
                    {f.summary && <p className="text-sm text-jericho-muted line-clamp-2 flex-1">{f.summary}</p>}
                    {aiAvailable && (
                      <form action={analyzeOne}>
                        <input type="hidden" name="id" value={f.id} />
                        <button className="rounded-lg border border-jericho-border px-2.5 py-1 text-sm text-jericho-accent hover:bg-jericho-border/40 whitespace-nowrap" type="submit">
                          Analyze
                        </button>
                      </form>
                    )}
                  </div>
                )}
              </Panel>
            );
          })}
        </div>
      )}
    </>
  );
}
