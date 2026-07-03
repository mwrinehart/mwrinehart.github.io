import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/platform/org";
import { addBlock, deleteProject, getProject, moveBlock, parseDoc, removeBlock, setStatus, updateBlock } from "@/lib/modules/studio/projects";
import { publishProjectToLitmos } from "@/lib/modules/studio/publish";
import { generateCourse } from "@/lib/modules/studio/coursegen";
import { BLOCK_TYPES, type Block } from "@/lib/modules/studio/types";
import { Badge, EmptyState, PageHeader, Panel } from "@/components/ui";

const inputCls = "w-full rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent";

function first(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

export default async function CourseEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const err = first((await searchParams).error);
  const { orgId } = await requireTenant();
  const project = await getProject(orgId, id);
  if (!project) notFound();
  const doc = parseDoc(project.data);

  async function addBlockAction(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("member");
    const type = String(formData.get("type") || "text");
    if (BLOCK_TYPES.includes(type as never)) await addBlock(orgId, id, type as never);
    revalidatePath(`/studio/${id}`);
  }
  async function moveBlockAction(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("member");
    await moveBlock(orgId, id, String(formData.get("bid") || ""), String(formData.get("dir") || "up") === "down" ? "down" : "up");
    revalidatePath(`/studio/${id}`);
  }
  async function removeBlockAction(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("member");
    await removeBlock(orgId, id, String(formData.get("bid") || ""));
    revalidatePath(`/studio/${id}`);
  }
  async function updateBlockAction(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("member");
    const bid = String(formData.get("bid") || "");
    const btype = String(formData.get("btype") || "");
    let fields: Record<string, unknown> = {};
    if (btype === "heading" || btype === "text") fields = { text: String(formData.get("text") || "") };
    else if (btype === "bullets") fields = { items: String(formData.get("items") || "").split("\n").map((s) => s.trim()).filter(Boolean) };
    else if (btype === "quiz") {
      const options = String(formData.get("options") || "").split("\n").map((s) => s.trim()).filter(Boolean);
      // Clamp the answer to a valid option index; a blank/garbage/out-of-range
      // value would otherwise persist as NaN or point past the options list.
      const rawAnswer = Math.trunc(Number(formData.get("answer")));
      const answer = options.length && Number.isFinite(rawAnswer) ? Math.max(0, Math.min(options.length - 1, rawAnswer)) : 0;
      fields = { question: String(formData.get("question") || ""), options, answer };
    }
    else if (btype === "image") fields = { prompt: String(formData.get("prompt") || ""), url: String(formData.get("url") || "") || undefined };
    if (Object.keys(fields).length) await updateBlock(orgId, id, bid, fields);
    revalidatePath(`/studio/${id}`);
  }
  async function generateAction(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("member");
    try {
      await generateCourse(orgId, id, String(formData.get("topic") || ""));
    } catch {
      // No AI key / parse error.
    }
    revalidatePath(`/studio/${id}`);
  }
  async function publishAction() {
    "use server";
    const { orgId } = await requireTenant("member");
    const p = await getProject(orgId, id);
    await setStatus(orgId, id, p?.status === "published" ? "draft" : "published");
    revalidatePath(`/studio/${id}`);
  }
  async function publishToLitmosAction() {
    "use server";
    const { orgId } = await requireTenant("member");
    const res = await publishProjectToLitmos(orgId, id);
    if (!res.ok) redirect(`/studio/${id}?error=${encodeURIComponent(res.error ?? "Litmos publish failed")}`);
    revalidatePath(`/studio/${id}`);
  }
  async function deleteAction() {
    "use server";
    const { orgId } = await requireTenant("admin");
    await deleteProject(orgId, id);
    redirect("/studio");
  }

  return (
    <>
      <PageHeader
        title={project.title}
        subtitle={project.description ?? undefined}
        action={
          <div className="flex items-center gap-2">
            <Badge tone={project.status === "published" ? "low" : "medium"}>{project.status}</Badge>
            <a href={`/api/studio/courses/${id}/export`} className="rounded-lg border border-jericho-border px-3 py-2 text-sm text-jericho-accent hover:bg-jericho-border/40">
              Export HTML
            </a>
            <form action={publishToLitmosAction}>
              <button className="rounded-lg border border-jericho-border px-3 py-2 text-sm text-jericho-accent hover:bg-jericho-border/40" type="submit">
                {project.litmosCourseId === null ? "Publish to Litmos" : "Republish to Litmos"}
              </button>
            </form>
            <form action={publishAction}>
              <button className="rounded-lg bg-jericho-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90" type="submit">
                {project.status === "published" ? "Unpublish" : "Publish"}
              </button>
            </form>
          </div>
        }
      />

      {err && <p className="text-xs text-jericho-bad mb-4">{err}</p>}

      {project.litmosStatus === "published" && (
        <p className="text-xs text-jericho-good mb-4">
          Published to Litmos as course {project.litmosCourseId} · {project.litmosPublishedAt ? new Date(project.litmosPublishedAt).toLocaleDateString() : "—"}
          <span className="text-jericho-muted"> Publishing creates/updates the Litmos course shell — Litmos&apos;s API doesn&apos;t accept content uploads, so use Export HTML for SCORM packaging.</span>
        </p>
      )}
      {project.litmosStatus === "failed" && (
        <p className="text-xs text-jericho-bad mb-4">
          Litmos publish failed: {project.litmosError}
          <span className="text-jericho-muted"> Publishing creates/updates the Litmos course shell — Litmos&apos;s API doesn&apos;t accept content uploads, so use Export HTML for SCORM packaging.</span>
        </p>
      )}

      {doc.blocks.length === 0 ? (
        <EmptyState title="Empty course">Add blocks below, or generate a draft from a topic with AI.</EmptyState>
      ) : (
        <div className="space-y-3 mb-6">
          {doc.blocks.map((b, i) => (
            <Panel key={b.id}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs uppercase tracking-wide text-jericho-muted">{b.type}</span>
                <div className="flex items-center gap-2 text-xs">
                  <MoveButton action={moveBlockAction} bid={b.id} dir="up" disabled={i === 0}>↑</MoveButton>
                  <MoveButton action={moveBlockAction} bid={b.id} dir="down" disabled={i === doc.blocks.length - 1}>↓</MoveButton>
                  <form action={removeBlockAction}>
                    <input type="hidden" name="bid" value={b.id} />
                    <button className="text-jericho-muted hover:text-jericho-bad" type="submit">remove</button>
                  </form>
                </div>
              </div>
              <BlockEditor block={b} action={updateBlockAction} />
            </Panel>
          ))}
        </div>
      )}

      <Panel className="mb-4">
        <h3 className="font-medium mb-3">Add block</h3>
        <div className="flex flex-wrap gap-2">
          {BLOCK_TYPES.map((t) => (
            <form key={t} action={addBlockAction}>
              <input type="hidden" name="type" value={t} />
              <button className="rounded-lg border border-jericho-border px-3 py-1.5 text-sm text-jericho-accent hover:bg-jericho-border/40" type="submit">
                + {t}
              </button>
            </form>
          ))}
        </div>
      </Panel>

      <Panel className="mb-4">
        <h3 className="font-medium mb-2">Generate with AI</h3>
        <p className="text-xs text-jericho-muted mb-3">Replaces the current blocks with an AI-authored draft (requires an Anthropic API key).</p>
        <form action={generateAction} className="flex gap-2">
          <input name="topic" placeholder="Topic / learning objective" className={inputCls} />
          <button className="rounded-lg border border-jericho-border px-3 py-2 text-sm text-jericho-accent hover:bg-jericho-border/40 whitespace-nowrap" type="submit">
            Generate draft
          </button>
        </form>
      </Panel>

      <form action={deleteAction}>
        <button className="text-sm text-jericho-muted hover:text-jericho-bad" type="submit">Delete course</button>
      </form>
    </>
  );
}

function MoveButton({ action, bid, dir, disabled, children }: { action: (fd: FormData) => Promise<void>; bid: string; dir: "up" | "down"; disabled: boolean; children: React.ReactNode }) {
  return (
    <form action={action}>
      <input type="hidden" name="bid" value={bid} />
      <input type="hidden" name="dir" value={dir} />
      <button className="text-jericho-muted hover:text-jericho-text disabled:opacity-30" type="submit" disabled={disabled}>
        {children}
      </button>
    </form>
  );
}

function BlockEditor({ block, action }: { block: Block; action: (fd: FormData) => Promise<void> }) {
  if (block.type === "divider") return <hr className="border-jericho-border" />;
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="bid" value={block.id} />
      <input type="hidden" name="btype" value={block.type} />
      {(block.type === "heading" || block.type === "text") && (
        <textarea name="text" defaultValue={block.text} rows={block.type === "heading" ? 1 : 3} className={inputCls} placeholder={block.type === "heading" ? "Section heading" : "Body text"} />
      )}
      {block.type === "bullets" && (
        <textarea name="items" defaultValue={block.items.join("\n")} rows={4} className={inputCls} placeholder="One bullet per line" />
      )}
      {block.type === "quiz" && (
        <>
          <input name="question" defaultValue={block.question} className={inputCls} placeholder="Question" />
          <textarea name="options" defaultValue={block.options.join("\n")} rows={3} className={inputCls} placeholder="One option per line" />
          <input name="answer" type="number" min={0} defaultValue={block.answer} className={inputCls} placeholder="Correct option index (0-based)" />
        </>
      )}
      {block.type === "image" && (
        <>
          <input name="prompt" defaultValue={block.prompt} className={inputCls} placeholder="Image prompt" />
          <input name="url" defaultValue={block.url ?? ""} className={inputCls} placeholder="Image URL (optional, until media generation is wired)" />
        </>
      )}
      <button className="rounded-lg border border-jericho-border px-3 py-1.5 text-sm text-jericho-accent hover:bg-jericho-border/40" type="submit">
        Save block
      </button>
    </form>
  );
}
