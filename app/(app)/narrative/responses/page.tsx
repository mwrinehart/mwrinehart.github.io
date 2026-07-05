import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/platform/org";
import { decideResponse, listResponses } from "@/lib/modules/narrative/respond";
import { listNarratives } from "@/lib/modules/narrative/scan";
import { Badge, EmptyState, PageHeader, Panel } from "@/components/ui";

// Risk that responding backfires or amplifies the narrative (0-100).
function riskTone(score: number): string {
  return score >= 60 ? "high" : score >= 30 ? "medium" : "low";
}

function statusTone(status: string): string {
  if (status === "approved") return "low";
  if (status === "rejected" || status === "blocked") return "high";
  return "draft"; // unknown tone → gray fallback in Badge
}

// Counter-response approval queue — AI-drafted responses flow draft →
// pending_review → approved | rejected, and only an admin can decide.
export default async function NarrativeResponsesPage() {
  const { orgId, role } = await requireTenant();
  const isAdmin = role === "admin" || role === "owner";
  const [responses, narratives] = await Promise.all([listResponses(orgId), listNarratives(orgId, 200)]);
  const titles = new Map(narratives.map((n) => [n.id, n.title]));
  const pending = responses.filter((r) => r.status === "pending_review");
  const history = responses.filter((r) => r.status !== "pending_review");

  async function decide(formData: FormData) {
    "use server";
    const { orgId, userId } = await requireTenant("admin");
    const decision = String(formData.get("decision") || "") === "approved" ? "approved" : "rejected";
    await decideResponse(orgId, userId, String(formData.get("id") || ""), decision, String(formData.get("note") || "") || undefined);
    revalidatePath("/narrative/responses");
  }

  return (
    <>
      <PageHeader
        title="Counter-responses"
        subtitle="Every counter-response requires human approval — nothing is ever auto-published. Approved drafts are handed to your communications team."
      />

      {responses.length === 0 ? (
        <EmptyState title="No counter-responses yet">
          Generate a response from a narrative&rsquo;s detail page; drafts flow through review here.
        </EmptyState>
      ) : (
        <>
          <h3 className="font-medium mb-3">Awaiting approval</h3>
          {pending.length === 0 ? (
            <p className="text-xs text-jericho-muted mb-6">Nothing is waiting on a decision.</p>
          ) : (
            <div className="space-y-3 mb-6">
              {pending.map((r) => (
                <Panel key={r.id}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={riskTone(r.riskScore)}>risk {r.riskScore}</Badge>
                    <span className="text-xs uppercase tracking-wide text-jericho-muted">{r.posture}</span>
                  </div>
                  <Link href={`/narrative/${r.narrativeId}`} className="block font-medium mt-1 hover:text-jericho-accent">
                    {titles.get(r.narrativeId) ?? "Narrative"}
                  </Link>
                  {r.strategy && <p className="text-sm text-jericho-muted mt-1">{r.strategy}</p>}
                  {r.draftMessage && (
                    <div className="mt-2 rounded-lg border border-jericho-border/60 bg-jericho-bg/40 p-3">
                      <p className="whitespace-pre-wrap text-sm text-jericho-text">{r.draftMessage}</p>
                    </div>
                  )}
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-jericho-muted">
                    {r.audience && <span>Audience: {r.audience}</span>}
                    {r.channels && <span>Channels: {r.channels}</span>}
                    <span>Created {new Date(r.createdAt).toLocaleString()}</span>
                  </div>
                  {isAdmin ? (
                    <form action={decide} className="mt-3 flex items-center gap-2">
                      <input type="hidden" name="id" value={r.id} />
                      <input
                        name="note"
                        placeholder="Decision note (optional)"
                        className="flex-1 rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent"
                      />
                      <button name="decision" value="approved" className="rounded-lg bg-jericho-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90" type="submit">
                        Approve
                      </button>
                      <button name="decision" value="rejected" className="rounded-lg border border-jericho-border px-3 py-2 text-sm text-jericho-bad hover:bg-jericho-border/40" type="submit">
                        Reject
                      </button>
                    </form>
                  ) : (
                    <p className="mt-3 text-xs text-jericho-muted">Admins decide counter-responses.</p>
                  )}
                </Panel>
              ))}
            </div>
          )}

          {history.length > 0 && (
            <>
              <h3 className="font-medium mb-3 mt-6">History</h3>
              <Panel className="p-0 overflow-hidden">
                <ul className="divide-y divide-jericho-border/50">
                  {history.map((r) => (
                    <li key={r.id} className="px-5 py-3">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <Badge tone={statusTone(r.status)}>{r.status.replace("_", " ")}</Badge>
                        <Link href={`/narrative/${r.narrativeId}`} className="text-jericho-accent hover:underline">
                          {titles.get(r.narrativeId) ?? "Narrative"}
                        </Link>
                        <span className="text-xs uppercase tracking-wide text-jericho-muted">{r.posture}</span>
                        <span className="ml-auto text-xs text-jericho-muted">
                          {r.decidedAt ? new Date(r.decidedAt).toLocaleString() : "—"}
                        </span>
                      </div>
                      {(r.decisionNote || r.blockReason) && (
                        <p className="mt-1 text-xs text-jericho-muted">{r.decisionNote ?? r.blockReason}</p>
                      )}
                    </li>
                  ))}
                </ul>
              </Panel>
            </>
          )}
        </>
      )}
    </>
  );
}
