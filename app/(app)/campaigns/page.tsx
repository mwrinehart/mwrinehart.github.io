import { requireTenant } from "@/lib/platform/org";
import { ModulePlaceholder } from "@/components/ModulePlaceholder";

export default async function CampaignsPage() {
  await requireTenant();
  return (
    <ModulePlaceholder
      moduleId="campaigns"
      capabilities={[
        "Campaign builder: prompt → synthetic exercise blueprint (personas, content jobs, guardrails)",
        "Mission control with policy gates and agent autonomy modes (go/review/blocked)",
        "Expansion approval workflow with risk scoring and legal/opsec sign-off",
        "Persona warming and OSINT target workbench",
        "Immutable, actor-aware audit log and compliance checks",
        "Commercial product — Mirage's gov/DoD tenant class and classification banners are dropped",
      ]}
    />
  );
}
