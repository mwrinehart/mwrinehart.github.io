import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/platform/org";
import { deleteAsset, listAssets, requestAsset } from "@/lib/modules/studio/media";
import { Badge, EmptyState, PageHeader, Panel } from "@/components/ui";

export default async function StudioMediaPage() {
  const { orgId } = await requireTenant();
  const assets = await listAssets(orgId);

  async function request(formData: FormData) {
    "use server";
    const { orgId, userId } = await requireTenant("member");
    await requestAsset(orgId, userId, { kind: String(formData.get("kind") || "image"), prompt: String(formData.get("prompt") || "") });
    revalidatePath("/studio/media");
  }
  async function remove(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("member");
    await deleteAsset(orgId, String(formData.get("id") || ""));
    revalidatePath("/studio/media");
  }

  return (
    <>
      <PageHeader title="Media library" subtitle="Generated images, video, and voiceover for courses." />

      <Panel className="mb-6">
        <h3 className="font-medium mb-1">Request generation</h3>
        <p className="text-xs text-jericho-muted mb-3">
          Requests are queued. Generation runs once a media provider (ElevenLabs / fal / Synthesia / HeyGen) is configured
          in org secrets — the provider integrations are env-gated in this build.
        </p>
        <form action={request} className="flex gap-2">
          <select name="kind" className="rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent">
            <option value="image">image</option>
            <option value="video">video</option>
            <option value="voice">voice</option>
          </select>
          <input name="prompt" placeholder="Prompt" required className="flex-1 rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent" />
          <button className="rounded-lg bg-jericho-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90" type="submit">Request</button>
        </form>
      </Panel>

      {assets.length === 0 ? (
        <EmptyState title="No media yet">Request a generation above to populate the library.</EmptyState>
      ) : (
        <div className="space-y-2">
          {assets.map((a) => (
            <Panel key={a.id} className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <Badge tone={a.status === "ready" ? "low" : a.status === "failed" ? "high" : "medium"}>{a.status}</Badge>
                  <span className="text-xs text-jericho-muted">{a.kind}</span>
                </div>
                <div className="text-sm text-jericho-text mt-1">{a.prompt}</div>
                {a.note && <div className="text-xs text-jericho-muted mt-1">{a.note}</div>}
              </div>
              <form action={remove}>
                <input type="hidden" name="id" value={a.id} />
                <button className="text-jericho-muted hover:text-jericho-bad text-sm" type="submit">remove</button>
              </form>
            </Panel>
          ))}
        </div>
      )}
    </>
  );
}
