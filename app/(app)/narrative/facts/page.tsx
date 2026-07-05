import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/platform/org";
import { addFact, deleteFact, listFacts } from "@/lib/modules/narrative/analyze";
import { EmptyState, PageHeader, Panel } from "@/components/ui";

// Verified fact library — the org's ground truth. AI veracity assessments and
// counter-message drafts are grounded in these statements, so the library's
// quality bounds the quality of everything downstream. Starts empty.
export default async function NarrativeFactsPage() {
  const { orgId } = await requireTenant();
  const facts = await listFacts(orgId);

  async function add(formData: FormData) {
    "use server";
    const { orgId, userId } = await requireTenant("member");
    await addFact(orgId, userId, {
      topic: String(formData.get("topic") || ""),
      statement: String(formData.get("statement") || ""),
      sourceUrl: String(formData.get("sourceUrl") || "") || undefined,
    });
    revalidatePath("/narrative/facts");
  }
  async function remove(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("member");
    await deleteFact(orgId, String(formData.get("id") || ""));
    revalidatePath("/narrative/facts");
  }

  return (
    <>
      <PageHeader
        title="Fact library"
        subtitle="The fact library is the ground truth AI assessments and counter-messaging are anchored to — keep it current and sourced."
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2">
          {facts.length === 0 ? (
            <EmptyState title="No verified facts yet">
              Without facts, the AI can only mark narratives as unverified — it never invents ground truth. Record what your
              organization knows to be true (with sources) so assessments and counter-messages have something to stand on.
            </EmptyState>
          ) : (
            <div className="space-y-3">
              {facts.map((f) => (
                <Panel key={f.id} className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-jericho-muted">{f.topic}</div>
                    <p className="text-sm text-jericho-text mt-1">{f.statement}</p>
                    <div className="text-xs text-jericho-muted mt-1">
                      {f.sourceUrl && (
                        <>
                          <a
                            href={f.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-jericho-accent hover:underline break-all"
                          >
                            {f.sourceUrl}
                          </a>{" "}
                          ·{" "}
                        </>
                      )}
                      updated {new Date(f.updatedAt).toLocaleDateString()}
                    </div>
                  </div>
                  <form action={remove}>
                    <input type="hidden" name="id" value={f.id} />
                    <button className="text-jericho-muted hover:text-jericho-bad text-sm" type="submit">
                      remove
                    </button>
                  </form>
                </Panel>
              ))}
            </div>
          )}
        </div>

        <Panel>
          <h3 className="font-medium mb-3">New fact</h3>
          <form action={add} className="space-y-2">
            <input
              name="topic"
              placeholder="Topic (e.g. Product safety)"
              required
              className="w-full rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent"
            />
            <textarea
              name="statement"
              placeholder="The verified statement, as you would state it publicly"
              rows={4}
              required
              className="w-full rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent"
            />
            <input
              name="sourceUrl"
              placeholder="Source URL (optional)"
              className="w-full rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent"
            />
            <button className="rounded-lg bg-jericho-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90" type="submit">
              Add fact
            </button>
          </form>
          <p className="text-xs text-jericho-muted mt-3">
            Narrative assessments and counter-response drafts cite these facts verbatim (requires an Anthropic API key).
          </p>
        </Panel>
      </div>
    </>
  );
}
