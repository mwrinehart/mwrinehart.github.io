import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/platform/org";
import { addFeed, addKeyword, deleteFeed, deleteKeyword, listFeeds, listFindings, listKeywords, scanOrgFeeds } from "@/lib/modules/behavior/pulse";
import { createDigest, deleteDigest, listDigests } from "@/lib/modules/behavior/digests";
import type { Severity } from "@/lib/platform/feeds";
import { Badge, EmptyState, PageHeader, Panel } from "@/components/ui";

// Threat Pulse — feeds + keyword rules + findings, on the shared feed engine.
// The Compliance module (Horizon) will reuse the same engine, so this page and
// Compliance's findings share scanning + classification code.
export default async function PulsePage() {
  const { orgId } = await requireTenant();
  const [feeds, keywords, findings, digests] = await Promise.all([
    listFeeds(orgId),
    listKeywords(orgId),
    listFindings(orgId),
    listDigests(orgId),
  ]);

  async function addFeedAction(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("member");
    await addFeed(orgId, {
      name: String(formData.get("name") || ""),
      url: String(formData.get("url") || ""),
      category: String(formData.get("category") || "") || undefined,
    });
    revalidatePath("/behavior/pulse");
  }

  async function deleteFeedAction(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("member");
    await deleteFeed(orgId, String(formData.get("id") || ""));
    revalidatePath("/behavior/pulse");
  }

  async function scanAction() {
    "use server";
    const { orgId } = await requireTenant("member");
    await scanOrgFeeds(orgId);
    revalidatePath("/behavior/pulse");
  }

  async function addKeywordAction(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("member");
    const floor = String(formData.get("severityFloor") || "") as Severity | "";
    await addKeyword(orgId, {
      term: String(formData.get("term") || ""),
      category: String(formData.get("category") || "") || undefined,
      severityFloor: floor || undefined,
    });
    revalidatePath("/behavior/pulse");
  }

  async function deleteKeywordAction(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("member");
    await deleteKeyword(orgId, String(formData.get("id") || ""));
    revalidatePath("/behavior/pulse");
  }

  async function createDigestAction(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("member");
    const frequency = String(formData.get("frequency") || "daily") === "weekly" ? "weekly" : "daily";
    await createDigest(orgId, {
      name: String(formData.get("name") || ""),
      frequency,
      hour: Number(formData.get("hour") || 9),
      recipients: String(formData.get("recipients") || ""),
      severityMin: (String(formData.get("severityMin") || "medium") as Severity) || "medium",
    });
    revalidatePath("/behavior/pulse");
  }

  async function deleteDigestAction(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("member");
    await deleteDigest(orgId, String(formData.get("id") || ""));
    revalidatePath("/behavior/pulse");
  }

  return (
    <>
      <PageHeader
        title="Threat Pulse"
        subtitle="Curated security & regulatory feeds, classified by the shared platform feed engine. Critical/high findings auto-route to Slack/Teams."
        action={
          feeds.length > 0 ? (
            <form action={scanAction}>
              <button className="rounded-lg bg-jericho-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90" type="submit">
                Scan now
              </button>
            </form>
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <Panel>
          <h3 className="font-medium mb-3">Feeds</h3>
          <ul className="space-y-2 mb-4">
            {feeds.length === 0 && <li className="text-sm text-jericho-muted">No feeds yet — add one to start scanning.</li>}
            {feeds.map((f) => (
              <li key={f.id} className="flex items-center justify-between text-sm">
                <span>
                  <span className="text-jericho-text">{f.name}</span>
                  {f.category && <span className="text-jericho-muted"> · {f.category}</span>}
                </span>
                <form action={deleteFeedAction}>
                  <input type="hidden" name="id" value={f.id} />
                  <button className="text-jericho-muted hover:text-jericho-bad" type="submit">
                    remove
                  </button>
                </form>
              </li>
            ))}
          </ul>
          <form action={addFeedAction} className="space-y-2">
            <SmallInput name="name" placeholder="Feed name (e.g. CISA Alerts)" />
            <SmallInput name="url" placeholder="https://…/rss" />
            <SmallInput name="category" placeholder="Category (optional)" />
            <SmallButton>Add feed</SmallButton>
          </form>
        </Panel>

        <Panel>
          <h3 className="font-medium mb-3">Custom keywords</h3>
          <p className="text-xs text-jericho-muted mb-3">
            Augment the built-in classifier. A matched term raises a finding to its severity floor.
          </p>
          <ul className="space-y-2 mb-4">
            {keywords.length === 0 && <li className="text-sm text-jericho-muted">Using built-in rules only.</li>}
            {keywords.map((k) => (
              <li key={k.id} className="flex items-center justify-between text-sm">
                <span>
                  <span className="text-jericho-text">{k.term}</span>
                  {k.severityFloor && <span className="text-jericho-muted"> → {k.severityFloor}</span>}
                </span>
                <form action={deleteKeywordAction}>
                  <input type="hidden" name="id" value={k.id} />
                  <button className="text-jericho-muted hover:text-jericho-bad" type="submit">
                    remove
                  </button>
                </form>
              </li>
            ))}
          </ul>
          <form action={addKeywordAction} className="space-y-2">
            <SmallInput name="term" placeholder="Term to match" />
            <SmallInput name="category" placeholder="Category (optional)" />
            <select
              name="severityFloor"
              className="w-full rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent"
            >
              <option value="">Severity floor (optional)</option>
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
              <option value="critical">critical</option>
            </select>
            <SmallButton>Add keyword</SmallButton>
          </form>
        </Panel>
      </div>

      <Panel className="mb-6">
        <h3 className="font-medium mb-1">Email digests</h3>
        <p className="text-xs text-jericho-muted mb-3">
          Scheduled summaries emailed by the <code>pulse-digests</code> cron job. Requires SMTP configured in org secrets or env.
        </p>
        <ul className="space-y-2 mb-4">
          {digests.length === 0 && <li className="text-sm text-jericho-muted">No digests configured.</li>}
          {digests.map((d) => (
            <li key={d.id} className="flex items-center justify-between text-sm">
              <span>
                <span className="text-jericho-text">{d.name}</span>
                <span className="text-jericho-muted">
                  {" "}
                  · {d.frequency} @ {String(d.hour).padStart(2, "0")}:00 UTC · ≥{d.severityMin} · {d.recipients}
                </span>
                {d.lastStatus && <span className="text-jericho-muted"> · last: {d.lastStatus}</span>}
              </span>
              <form action={deleteDigestAction}>
                <input type="hidden" name="id" value={d.id} />
                <button className="text-jericho-muted hover:text-jericho-bad" type="submit">
                  remove
                </button>
              </form>
            </li>
          ))}
        </ul>
        <form action={createDigestAction} className="grid grid-cols-2 md:grid-cols-5 gap-2 items-end">
          <SmallInput name="name" placeholder="Digest name" />
          <SmallInput name="recipients" placeholder="a@co.com, b@co.com" />
          <select name="frequency" className="rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent">
            <option value="daily">daily</option>
            <option value="weekly">weekly</option>
          </select>
          <input name="hour" type="number" min={0} max={23} defaultValue={9} className="rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent" />
          <select name="severityMin" className="rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent">
            <option value="low">≥ low</option>
            <option value="medium">≥ medium</option>
            <option value="high">≥ high</option>
            <option value="critical">≥ critical</option>
          </select>
          <div className="col-span-2 md:col-span-5">
            <SmallButton>Add digest</SmallButton>
          </div>
        </form>
      </Panel>

      <h3 className="text-sm uppercase tracking-wide text-jericho-muted mb-3">Findings</h3>
      {findings.length === 0 ? (
        <EmptyState title="No findings yet">Add feeds and click “Scan now” to surface classified findings.</EmptyState>
      ) : (
        <div className="space-y-3">
          {findings.map((f) => (
            <Panel key={f.id}>
              <div className="flex items-center gap-2">
                <Badge tone={f.severity === "low" ? "low" : f.severity === "medium" ? "medium" : "high"}>{f.severity}</Badge>
                {f.category && <span className="text-xs text-jericho-muted">{f.category}</span>}
                <span className="ml-auto text-xs text-jericho-muted">{f.feedName}</span>
              </div>
              <a href={f.link ?? "#"} target="_blank" rel="noreferrer" className="block font-medium mt-1 hover:text-jericho-accent">
                {f.title}
              </a>
              {f.summary && <p className="text-sm text-jericho-muted mt-1 line-clamp-2">{f.summary}</p>}
            </Panel>
          ))}
        </div>
      )}
    </>
  );
}

function SmallInput({ name, placeholder }: { name: string; placeholder: string }) {
  return (
    <input
      name={name}
      placeholder={placeholder}
      className="w-full rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent"
    />
  );
}

function SmallButton({ children }: { children: React.ReactNode }) {
  return (
    <button className="rounded-lg bg-jericho-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90" type="submit">
      {children}
    </button>
  );
}
