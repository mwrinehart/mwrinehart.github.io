import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/platform/org";
import {
  addSource,
  addWatchTerm,
  deleteSource,
  deleteWatchTerm,
  listSources,
  listWatchTerms,
  setSourceEnabled,
  setWatchTermEnabled,
  SOURCE_KINDS,
  SOURCE_PLATFORMS,
  type SourceKind,
  type SourcePlatform,
} from "@/lib/modules/narrative/scan";
import { EmptyState, PageHeader, Panel } from "@/components/ui";

function fmt(ts: number | null | undefined): string {
  return ts ? new Date(ts).toLocaleString() : "never";
}

const KIND_LABELS: Record<SourceKind, string> = {
  rss: "RSS / Atom feed",
  reddit: "Reddit JSON listing",
};

// Sources & watch terms — what the narrative scanner reads, and the terms that
// gate what it keeps. Terms come first: without them a scan keeps nothing.
export default async function NarrativeSourcesPage() {
  const { orgId } = await requireTenant();
  const [sources, terms] = await Promise.all([listSources(orgId), listWatchTerms(orgId)]);

  async function addTerm(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("member");
    await addWatchTerm(orgId, String(formData.get("term") || ""));
    revalidatePath("/narrative/sources");
  }
  async function removeTerm(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("member");
    await deleteWatchTerm(orgId, String(formData.get("id") || ""));
    revalidatePath("/narrative/sources");
  }
  async function toggleTerm(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("member");
    await setWatchTermEnabled(orgId, String(formData.get("id") || ""), formData.get("enabled") === "1");
    revalidatePath("/narrative/sources");
  }
  async function add(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("member");
    const kind = String(formData.get("kind") || "");
    const platform = String(formData.get("platform") || "");
    if (!(SOURCE_KINDS as string[]).includes(kind)) return;
    if (!(SOURCE_PLATFORMS as string[]).includes(platform)) return;
    try {
      await addSource(orgId, {
        name: String(formData.get("name") || ""),
        url: String(formData.get("url") || ""),
        kind: kind as SourceKind,
        platform: platform as SourcePlatform,
      });
    } catch {
      // Invalid or unsafe URL (the SSRF guard throws) — drop the submission
      // rather than surfacing an unhandled server-action error.
    }
    revalidatePath("/narrative/sources");
  }
  async function remove(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("member");
    await deleteSource(orgId, String(formData.get("id") || ""));
    revalidatePath("/narrative/sources");
  }
  async function toggle(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("member");
    await setSourceEnabled(orgId, String(formData.get("id") || ""), formData.get("enabled") === "1");
    revalidatePath("/narrative/sources");
  }

  return (
    <>
      <PageHeader
        title="Sources & watch terms"
        subtitle="The media sources this organization monitors for narratives, and the watch terms that decide which items are kept."
      />

      <h3 className="text-sm uppercase tracking-wide text-jericho-muted mb-3">Watch terms</h3>
      <Panel className="mb-4">
        <h3 className="font-medium mb-1">Add a watch term</h3>
        <p className="text-sm text-jericho-muted mb-3">
          Scans only keep items that match a watch term — add your org’s name, products, executives, and hot-button topics.
        </p>
        <form action={addTerm} className="flex gap-2">
          <input
            name="term"
            placeholder="Term to watch (e.g. Acme Health)"
            required
            className="flex-1 rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent"
          />
          <button className="rounded-lg bg-jericho-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90" type="submit">
            Add term
          </button>
        </form>
      </Panel>

      {terms.length === 0 ? (
        <EmptyState title="No watch terms yet">Scans keep nothing until at least one term is configured. Add one above.</EmptyState>
      ) : (
        <Panel className="p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-left text-jericho-muted border-b border-jericho-border">
              <tr>
                <th className="px-5 py-3 font-medium">Term</th>
                <th className="px-5 py-3 font-medium">Matches</th>
                <th className="px-5 py-3 font-medium">State</th>
                <th className="px-5 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {terms.map((t) => (
                <tr key={t.id} className="border-b border-jericho-border/50 last:border-0">
                  <td className="px-5 py-3 text-jericho-text">{t.term}</td>
                  <td className="px-5 py-3 text-jericho-muted">matched {t.matchCount} items</td>
                  <td className="px-5 py-3">
                    <form action={toggleTerm}>
                      <input type="hidden" name="id" value={t.id} />
                      <input type="hidden" name="enabled" value={t.enabled ? "0" : "1"} />
                      <button className="text-jericho-accent hover:underline" type="submit">
                        {t.enabled ? "enabled" : "disabled"}
                      </button>
                    </form>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <form action={removeTerm}>
                      <input type="hidden" name="id" value={t.id} />
                      <button className="text-jericho-muted hover:text-jericho-bad" type="submit">
                        remove
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      <h3 className="text-sm uppercase tracking-wide text-jericho-muted mt-8 mb-3">Media sources</h3>
      <Panel className="mb-4">
        <h3 className="font-medium mb-3">Add a source</h3>
        <form action={add} className="grid grid-cols-1 md:grid-cols-6 gap-2 items-end">
          <input
            name="name"
            placeholder="Name (e.g. Google News)"
            required
            className="md:col-span-2 rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent"
          />
          <input
            name="url"
            placeholder="https://…"
            required
            className="md:col-span-2 rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent"
          />
          <select name="kind" className="rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent">
            {SOURCE_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
          <select name="platform" className="rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent">
            {SOURCE_PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <div className="md:col-span-6">
            <button className="rounded-lg bg-jericho-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90" type="submit">
              Add source
            </button>
          </div>
        </form>
      </Panel>

      {sources.length === 0 ? (
        <EmptyState title="No sources yet">Add an RSS feed or a Reddit JSON listing above to start scanning.</EmptyState>
      ) : (
        <Panel className="p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-left text-jericho-muted border-b border-jericho-border">
              <tr>
                <th className="px-5 py-3 font-medium">Source</th>
                <th className="px-5 py-3 font-medium">Last scanned</th>
                <th className="px-5 py-3 font-medium">State</th>
                <th className="px-5 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.id} className="border-b border-jericho-border/50 last:border-0">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <span className="text-jericho-text">{s.name}</span>
                      <span className="text-[11px] uppercase tracking-wide text-jericho-muted">
                        {s.kind} · {s.platform}
                      </span>
                    </div>
                    <div className="text-xs text-jericho-muted break-all">{s.url}</div>
                    {s.lastError && <div className="text-xs text-jericho-bad mt-0.5">{s.lastError}</div>}
                  </td>
                  <td className="px-5 py-3 text-jericho-muted whitespace-nowrap">{fmt(s.lastScannedAt)}</td>
                  <td className="px-5 py-3">
                    <form action={toggle}>
                      <input type="hidden" name="id" value={s.id} />
                      <input type="hidden" name="enabled" value={s.enabled ? "0" : "1"} />
                      <button className="text-jericho-accent hover:underline" type="submit">
                        {s.enabled ? "enabled" : "disabled"}
                      </button>
                    </form>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <form action={remove}>
                      <input type="hidden" name="id" value={s.id} />
                      <button className="text-jericho-muted hover:text-jericho-bad" type="submit">
                        remove
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      <p className="mt-4 text-xs text-jericho-muted">
        Tip: Google News RSS — <code className="break-all">{"https://news.google.com/rss/search?q=%22Your+Org%22"}</code> · Reddit search —{" "}
        <code className="break-all">{"https://www.reddit.com/search.json?q=%22your+org%22&sort=new"}</code>
      </p>
    </>
  );
}
