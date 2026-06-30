import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/platform/org";
import {
  generateBlueprint,
  getCampaign,
  setAutonomyMode,
  setStatus,
  type AutonomyMode,
  type CampaignStatus,
} from "@/lib/modules/campaigns/campaigns";
import { addPersona, listPersonas, setPersonaStatus } from "@/lib/modules/campaigns/personas";
import { campaignGateStatus, listApprovalsForCampaign, requestApproval, type ApprovalType } from "@/lib/modules/campaigns/approvals";
import { listCampaignAudit } from "@/lib/modules/campaigns/audit";
import { Badge, EmptyState, PageHeader, Panel } from "@/components/ui";

const STATUS_TONE: Record<string, string> = { active: "low", completed: "medium", draft: "high", paused: "high" };

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { orgId } = await requireTenant();
  const campaign = await getCampaign(orgId, id);
  if (!campaign) notFound();

  const [personas, approvals, gate, audit] = await Promise.all([
    listPersonas(orgId, id),
    listApprovalsForCampaign(orgId, id),
    campaignGateStatus(orgId, id),
    listCampaignAudit(orgId, id),
  ]);

  async function changeStatus(formData: FormData) {
    "use server";
    const { orgId, userId } = await requireTenant("member");
    try {
      await setStatus(orgId, userId, id, String(formData.get("status") || "draft") as CampaignStatus);
    } catch {
      // Launch gate not satisfied — the UI already shows gate state; no-op.
    }
    revalidatePath(`/campaigns/${id}`);
  }
  async function changeAutonomy(formData: FormData) {
    "use server";
    const { orgId, userId } = await requireTenant("member");
    await setAutonomyMode(orgId, userId, id, String(formData.get("mode") || "manual") as AutonomyMode);
    revalidatePath(`/campaigns/${id}`);
  }
  async function blueprint() {
    "use server";
    const { orgId, userId } = await requireTenant("member");
    try {
      await generateBlueprint(orgId, userId, id);
    } catch {
      // No AI key / model error — leave blueprint empty.
    }
    revalidatePath(`/campaigns/${id}`);
  }
  async function persona(formData: FormData) {
    "use server";
    const { orgId, userId } = await requireTenant("member");
    await addPersona(orgId, userId, id, {
      name: String(formData.get("name") || ""),
      role: String(formData.get("role") || "") || undefined,
      backstory: String(formData.get("backstory") || "") || undefined,
    });
    revalidatePath(`/campaigns/${id}`);
  }
  async function personaStatus(formData: FormData) {
    "use server";
    const { orgId, userId } = await requireTenant("member");
    await setPersonaStatus(orgId, userId, id, String(formData.get("pid") || ""), String(formData.get("status") || "draft"));
    revalidatePath(`/campaigns/${id}`);
  }
  async function approval(formData: FormData) {
    "use server";
    const { orgId, userId } = await requireTenant("member");
    await requestApproval(orgId, userId, id, {
      type: String(formData.get("type") || "launch") as ApprovalType,
      title: String(formData.get("title") || ""),
      detail: String(formData.get("detail") || "") || undefined,
      riskScore: Number(formData.get("riskScore") || 0),
    });
    revalidatePath(`/campaigns/${id}`);
  }

  return (
    <>
      <PageHeader
        title={campaign.name}
        subtitle={campaign.objective ?? undefined}
        action={<Badge tone={STATUS_TONE[campaign.status] ?? "medium"}>{campaign.status}</Badge>}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <Panel>
          <h3 className="font-medium mb-3">Mission control</h3>
          <div className="text-sm text-jericho-muted mb-3">
            Launch gate:{" "}
            {gate.launchApproved ? (
              <span className="text-jericho-good">approved</span>
            ) : (
              <span className="text-jericho-warn">needs an approved launch approval</span>
            )}
            {gate.pending > 0 && <span> · {gate.pending} pending</span>}
          </div>

          <div className="flex flex-wrap gap-2 mb-4">
            {campaign.status !== "active" && gate.launchApproved && (
              <StatusButton action={changeStatus} status="active">Activate</StatusButton>
            )}
            {campaign.status === "active" && <StatusButton action={changeStatus} status="paused">Pause</StatusButton>}
            {(campaign.status === "active" || campaign.status === "paused") && (
              <StatusButton action={changeStatus} status="completed">Complete</StatusButton>
            )}
            {campaign.status === "paused" && gate.launchApproved && (
              <StatusButton action={changeStatus} status="active">Resume</StatusButton>
            )}
          </div>

          <form action={changeAutonomy} className="flex items-center gap-2">
            <span className="text-xs text-jericho-muted">Autonomy</span>
            <select name="mode" defaultValue={campaign.autonomyMode} className="rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent">
              <option value="manual">manual — every action needs approval</option>
              <option value="review">review — approve above risk threshold</option>
              <option value="auto">auto — proceed within guardrails</option>
            </select>
            <button className="rounded-lg border border-jericho-border px-2.5 py-1 text-sm text-jericho-accent hover:bg-jericho-border/40" type="submit">
              Save
            </button>
          </form>
        </Panel>

        <Panel>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-medium">Blueprint</h3>
            <form action={blueprint}>
              <button className="rounded-lg border border-jericho-border px-2.5 py-1 text-sm text-jericho-accent hover:bg-jericho-border/40" type="submit">
                {campaign.blueprint ? "Regenerate" : "Generate with AI"}
              </button>
            </form>
          </div>
          {campaign.blueprint ? (
            <pre className="whitespace-pre-wrap text-sm text-jericho-muted max-h-72 overflow-y-auto">{campaign.blueprint}</pre>
          ) : (
            <p className="text-sm text-jericho-muted">No blueprint yet. Generate one from the objective (requires an Anthropic API key).</p>
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <Panel>
          <h3 className="font-medium mb-3">Personas</h3>
          <ul className="space-y-2 mb-4">
            {personas.length === 0 && <li className="text-sm text-jericho-muted">No personas yet.</li>}
            {personas.map((p) => (
              <li key={p.id} className="flex items-center justify-between text-sm">
                <span>
                  <span className="text-jericho-text">{p.name}</span>
                  {p.role && <span className="text-jericho-muted"> · {p.role}</span>}
                </span>
                <form action={personaStatus} className="flex items-center gap-2">
                  <input type="hidden" name="pid" value={p.id} />
                  <select name="status" defaultValue={p.status} className="rounded border border-jericho-border bg-jericho-bg px-2 py-1 text-xs outline-none">
                    <option value="draft">draft</option>
                    <option value="warming">warming</option>
                    <option value="ready">ready</option>
                  </select>
                  <button className="text-jericho-accent hover:underline" type="submit">set</button>
                </form>
              </li>
            ))}
          </ul>
          <form action={persona} className="space-y-2">
            <div className="flex gap-2">
              <input name="name" placeholder="Persona name" required className="flex-1 rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent" />
              <input name="role" placeholder="Role" className="w-32 rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent" />
            </div>
            <input name="backstory" placeholder="Backstory (optional)" className="w-full rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent" />
            <button className="rounded-lg border border-jericho-border px-3 py-2 text-sm text-jericho-accent hover:bg-jericho-border/40" type="submit">Add persona</button>
          </form>
        </Panel>

        <Panel>
          <h3 className="font-medium mb-3">Approvals</h3>
          <ul className="space-y-2 mb-4">
            {approvals.length === 0 && <li className="text-sm text-jericho-muted">No approvals requested.</li>}
            {approvals.map((a) => (
              <li key={a.id} className="flex items-center justify-between text-sm">
                <span>
                  <span className="text-jericho-muted">{a.type}</span> · {a.title}
                </span>
                <Badge tone={a.status === "approved" ? "low" : a.status === "rejected" ? "high" : "medium"}>{a.status}</Badge>
              </li>
            ))}
          </ul>
          <form action={approval} className="space-y-2">
            <div className="flex gap-2">
              <select name="type" className="rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent">
                <option value="launch">launch</option>
                <option value="expansion">expansion</option>
                <option value="content">content</option>
              </select>
              <input name="riskScore" type="number" min={0} max={100} placeholder="Risk" className="w-24 rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent" />
            </div>
            <input name="title" placeholder="Request title" required className="w-full rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent" />
            <input name="detail" placeholder="Detail (optional)" className="w-full rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent" />
            <button className="rounded-lg border border-jericho-border px-3 py-2 text-sm text-jericho-accent hover:bg-jericho-border/40" type="submit">Request approval</button>
          </form>
          <p className="text-xs text-jericho-muted mt-2">Admins decide pending requests on the Approvals tab.</p>
        </Panel>
      </div>

      <h3 className="text-sm uppercase tracking-wide text-jericho-muted mb-3">Recent activity</h3>
      {audit.length === 0 ? (
        <EmptyState title="No activity yet" />
      ) : (
        <Panel className="p-0 overflow-hidden">
          <ul className="text-sm divide-y divide-jericho-border/50">
            {audit.map((e) => (
              <li key={e.id} className="px-5 py-2.5 flex items-center justify-between">
                <span>
                  <span className="text-jericho-text">{e.action}</span>
                  {e.detail && <span className="text-jericho-muted"> · {e.detail}</span>}
                </span>
                <span className="text-xs text-jericho-muted">{new Date(e.createdAt).toLocaleString()}</span>
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
