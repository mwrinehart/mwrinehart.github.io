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
        "Immutable, actor-aware audit log and jurisdiction compliance checks",
        "Commercial vs. DoD tenant copy (folds into platform tenancy)",
      ]}
    />
  );
}
