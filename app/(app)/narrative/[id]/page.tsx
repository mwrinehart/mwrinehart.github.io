import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/platform/org";
import { getNarrative, listMentions, setNarrativeStatus, setNarrativeVerdict } from "@/lib/modules/narrative/scan";
import { aiKeyFor, assessNarrative } from "@/lib/modules/narrative/analyze";
import {
  decideResponse,
  generateResponse,
  listResponsesForNarrative,
  submitResponse,
  updateResponseDraft,
} from "@/lib/modules/narrative/respond";
import { severityForScore, VERDICTS, type Verdict } from "@/lib/modules/narrative/scoring";
import { Badge, EmptyState, PageHeader, Panel, Stat } from "@/components/ui";

// Badge tones. Unknown keys fall through to Badge's gray fallback via "none".
const VERDICT_TONE: Record<string, string> = { false: "critical", misleading: "high", unsubstantiated: "medium", unverified: "medium", true: "low" };
const NARRATIVE_STATUS_TONE: Record<string, string> = { emerging: "medium", active: "high", countered: "low" };
const RESPONSE_TONE: Record<string, string> = { pending_review: "medium", approved: "low", rejected: "high", blocked: "high" };

const ANALYST_STATUSES = ["active", "countered", "dismissed"];

export default async function NarrativeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { orgId, role } = await requireTenant();
  const narrative = await getNarrative(orgId, id);
  if (!narrative) redirect("/narrative");
  const isAdmin = role === "admin" || role === "owner";
  const canAct = role !== "viewer";

  const [mentions, responses, aiKey] = await Promise.all([
    listMentions(orgId, id),
    listResponsesForNarrative(orgId, id),
    aiKeyFor(orgId),
  ]);
  const aiAvailable = !!aiKey;

  const severity = severityForScore(narrative.threatScore);
  const verdictSourceLabel =
    narrative.analyzedAt == null ? "not yet assessed" : narrative.verdictSource === "analyst" ? "Analyst override" : "AI assessment";

  async function reassess() {
    "use server";
    const { orgId, userId } = await requireTenant("member");
    try {
      await assessNarrative(orgId, id, userId);
    } catch {
      // No AI key / model error / unparseable output — verdict stays as-is;
      // the assess cron retries later.
    }
    revalidatePath(`/narrative/${id}`);
  }
  async function overrideVerdict(formData: FormData) {
    "use server";
    const { orgId, userId } = await requireTenant("member");
    const verdict = String(formData.get("verdict") || "");
    if (!VERDICTS.includes(verdict as Verdict)) return;
    const rationale = String(formData.get("rationale") || "") || undefined;
    await setNarrativeVerdict(orgId, userId, id, verdict as Verdict, rationale);
    revalidatePath(`/narrative/${id}`);
  }
  async function changeStatus(formData: FormData) {
    "use server";
    const { orgId, userId } = await requireTenant("member");
    const status = String(formData.get("status") || "");
    if (!ANALYST_STATUSES.includes(status)) return;
    await setNarrativeStatus(orgId, userId, id, status);
    revalidatePath(`/narrative/${id}`);
  }
  async function genResponse() {
    "use server";
    const { orgId, userId } = await requireTenant("member");
    try {
      await generateResponse(orgId, userId, id);
    } catch {
      // No AI key / model error / unparseable output — nothing drafted.
    }
    revalidatePath(`/narrative/${id}`);
  }
  async function saveDraft(formData: FormData) {
    "use server";
    const { orgId, userId } = await requireTenant("member");
    await updateResponseDraft(orgId, userId, String(formData.get("rid") || ""), {
      draftMessage: String(formData.get("draftMessage") || ""),
      audience: String(formData.get("audience") || ""),
    });
    revalidatePath(`/narrative/${id}`);
  }
  async function submitDraft(formData: FormData) {
    "use server";
    const { orgId, userId } = await requireTenant("member");
    await submitResponse(orgId, userId, String(formData.get("rid") || ""));
    revalidatePath(`/narrative/${id}`);
  }
  async function decide(formData: FormData) {
    "use server";
    const { orgId, userId } = await requireTenant("admin");
    const decision = String(formData.get("decision") || "");
    if (decision !== "approved" && decision !== "rejected") return;
    const note = String(formData.get("note") || "") || undefined;
    await decideResponse(orgId, userId, String(formData.get("rid") || ""), decision, note);
    revalidatePath(`/narrative/${id}`);
  }

  return (
    <>
      <PageHeader
        title={narrative.title}
        subtitle={`${narrative.status} · first seen ${new Date(narrative.firstSeenAt).toLocaleDateString()} · last seen ${new Date(narrative.lastSeenAt).toLocaleDateString()}`}
        action={<Badge tone={NARRATIVE_STATUS_TONE[narrative.status] ?? "none"}>{narrative.status}</Badge>}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <Stat
          label="Threat score"
          value={
            <span className="flex items-center gap-2">
              {narrative.threatScore}
              <Badge tone={severity}>{severity}</Badge>
            </span>
          }
        />
        <Stat label="Mentions" value={narrative.mentionCount} />
        <Stat label="Total reach" value={narrative.totalReach.toLocaleString()} hint="engagement-based estimate" />
        <Stat label="Velocity" value={narrative.velocity} hint="mentions in the last 24h" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <Panel>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-medium">Verdict</h3>
            {aiAvailable && (
              <form action={reassess}>
                <button className="rounded-lg border border-jericho-border px-2.5 py-1 text-sm text-jericho-accent hover:bg-jericho-border/40" type="submit">
                  Re-assess (AI)
                </button>
              </form>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 mb-2">
            <Badge tone={VERDICT_TONE[narrative.verdict] ?? "none"}>{narrative.verdict}</Badge>
            <span className="text-xs text-jericho-muted">
              {narrative.verdictConfidence}% confidence · {verdictSourceLabel}
            </span>
          </div>
          {narrative.claim && (
            <p className="text-sm text-jericho-text mb-2">
              <span className="text-jericho-muted">Claim: </span>
              {narrative.claim}
            </p>
          )}
          {narrative.summary && <p className="text-sm text-jericho-muted mb-2">{narrative.summary}</p>}
          {narrative.verdictRationale && (
            <p className="text-sm text-jericho-muted border-l-2 border-jericho-border pl-3 mb-2">{narrative.verdictRationale}</p>
          )}

          <form action={overrideVerdict} className="flex flex-wrap items-center gap-2 mt-3">
            <select name="verdict" defaultValue={narrative.verdict} className="rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent">
              {VERDICTS.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
            <input name="rationale" placeholder="Rationale (optional)" className="flex-1 min-w-40 rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent" />
            <button className="rounded-lg border border-jericho-border px-3 py-2 text-sm text-jericho-accent hover:bg-jericho-border/40" type="submit">
              Override
            </button>
          </form>
          <p className="text-xs text-jericho-muted mt-2">An analyst override beats the AI assessment and re-runs scoring.</p>
        </Panel>

        <Panel>
          <h3 className="font-medium mb-3">Status</h3>
          <p className="text-sm text-jericho-muted mb-3">
            Dismiss noise, mark the narrative countered once your response lands, or reactivate it if it resurfaces.
          </p>
          {canAct && (
            <div className="flex flex-wrap gap-2">
              {narrative.status !== "dismissed" && (
                <StatusButton action={changeStatus} status="dismissed">Dismiss</StatusButton>
              )}
              {narrative.status !== "countered" && (
                <StatusButton action={changeStatus} status="countered">Mark countered</StatusButton>
              )}
              {(narrative.status === "dismissed" || narrative.status === "countered") && (
                <StatusButton action={changeStatus} status="active">Reactivate</StatusButton>
              )}
            </div>
          )}
        </Panel>
      </div>

      <Panel className="mb-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-medium">Counter-responses</h3>
          {aiAvailable ? (
            <form action={genResponse}>
              <button className="rounded-lg bg-jericho-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90" type="submit">
                Generate counter-response (AI)
              </button>
            </form>
          ) : (
            <span className="text-xs text-jericho-muted">
              Set an Anthropic API key (org secret <code>anthropicApiKey</code> or platform <code>ANTHROPIC_API_KEY</code>) to draft counter-responses.
            </span>
          )}
        </div>
        <p className="text-xs text-jericho-muted mt-1 mb-4">
          Approved responses are handed to your communications team — the platform never publishes on its own.
        </p>

        {responses.length === 0 ? (
          <p className="text-sm text-jericho-muted">No counter-responses drafted yet.</p>
        ) : (
          <ul className="space-y-3">
            {responses.map((r) => (
              <li key={r.id} className="rounded-lg border border-jericho-border/60 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs uppercase tracking-wide text-jericho-muted">{r.posture.replace(/_/g, " ")}</span>
                  <Badge tone={RESPONSE_TONE[r.status] ?? "none"}>{r.status.replace(/_/g, " ")}</Badge>
                  <span className="text-xs text-jericho-muted">risk {r.riskScore}</span>
                  <span className="ml-auto text-xs text-jericho-muted">{new Date(r.createdAt).toLocaleString()}</span>
                </div>

                {r.strategy && <p className="text-sm text-jericho-muted mt-2">{r.strategy}</p>}
                {(r.audience || r.channels) && r.status !== "draft" && (
                  <p className="text-xs text-jericho-muted mt-2">
                    {r.audience && <span>Audience: {r.audience}</span>}
                    {r.audience && r.channels && <span> · </span>}
                    {r.channels && <span>Channels: {r.channels}</span>}
                  </p>
                )}
                {r.status === "blocked" && r.blockReason && (
                  <p className="text-xs text-jericho-warn mt-2">blocked: {r.blockReason}</p>
                )}
                {r.decidedAt != null && r.decisionNote && (
                  <p className="text-xs text-jericho-muted mt-2">decision note: {r.decisionNote}</p>
                )}

                {r.status === "draft" ? (
                  <div className="mt-3 space-y-2">
                    <form action={saveDraft} className="space-y-2">
                      <input type="hidden" name="rid" value={r.id} />
                      <textarea
                        name="draftMessage"
                        rows={5}
                        defaultValue={r.draftMessage ?? ""}
                        placeholder="Draft message"
                        className="w-full rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent"
                      />
                      <div className="flex flex-wrap gap-2">
                        <input
                          name="audience"
                          defaultValue={r.audience ?? ""}
                          placeholder="Audience"
                          className="flex-1 min-w-40 rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent"
                        />
                        <button className="rounded-lg border border-jericho-border px-3 py-2 text-sm text-jericho-accent hover:bg-jericho-border/40" type="submit">
                          Save draft
                        </button>
                      </div>
                    </form>
                    <form action={submitDraft}>
                      <input type="hidden" name="rid" value={r.id} />
                      <button className="rounded-lg bg-jericho-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90" type="submit">
                        Submit for approval
                      </button>
                    </form>
                  </div>
                ) : (
                  r.draftMessage && (
                    <p className="whitespace-pre-wrap text-sm text-jericho-text mt-2 border-l-2 border-jericho-border pl-3">{r.draftMessage}</p>
                  )
                )}

                {r.status === "pending_review" && isAdmin && (
                  <form action={decide} className="mt-3 flex flex-wrap items-center gap-2">
                    <input type="hidden" name="rid" value={r.id} />
                    <input name="note" placeholder="Decision note (optional)" className="flex-1 min-w-40 rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent" />
                    <button name="decision" value="approved" className="rounded-lg bg-jericho-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90" type="submit">
                      Approve
                    </button>
                    <button name="decision" value="rejected" className="rounded-lg border border-jericho-border px-3 py-2 text-sm text-jericho-bad hover:bg-jericho-border/40" type="submit">
                      Reject
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <h3 className="text-sm uppercase tracking-wide text-jericho-muted mb-3">Mentions</h3>
      {mentions.length === 0 ? (
        <EmptyState title="No mentions recorded">
          Mentions matching your watch terms will cluster onto this narrative as scans run.
        </EmptyState>
      ) : (
        <Panel className="p-0 overflow-hidden">
          <ul className="divide-y divide-jericho-border/50 text-sm">
            {mentions.map((m) => (
              <li key={m.id} className="px-5 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs uppercase tracking-wide text-jericho-muted">{m.platform}</span>
                  <a href={m.url} target="_blank" rel="noreferrer" className="font-medium text-jericho-accent hover:underline">
                    {m.title}
                  </a>
                </div>
                <div className="mt-1 text-xs text-jericho-muted">
                  <span>{new Date(m.publishedAt ?? m.fetchedAt).toLocaleString()}</span>
                  {m.sourceName && <span> · {m.sourceName}</span>}
                  {m.author && <span> · by {m.author}</span>}
                  {m.reach > 0 && <span> · reach ~{m.reach.toLocaleString()}</span>}
                  {m.matchedTerms && <span> · matched: {m.matchedTerms}</span>}
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </>
  );
}

function StatusButton({ action, status, children }: { action: (fd: FormData) => Promise<void>; status: string; children: React.ReactNode }) {
  return (
    <form action={action}>
      <input type="hidden" name="status" value={status} />
      <button className="rounded-lg bg-jericho-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90" type="submit">
        {children}
      </button>
    </form>
  );
}
