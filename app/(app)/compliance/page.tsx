import { requireTenant } from "@/lib/platform/org";
import { ModulePlaceholder } from "@/components/ModulePlaceholder";

export default async function CompliancePage() {
  await requireTenant();
  return (
    <ModulePlaceholder
      moduleId="compliance"
      capabilities={[
        "RSS/regulatory feed ingestion via the shared platform feed engine (already used by Behavior's Threat Pulse)",
        "AI-summarized findings with policy-mapped action items (shared Anthropic client)",
        "Policy document upload + cross-reference and gap analysis",
        "Federal Register, breach-portal, and OIG workplan integrations",
        "Composite scoring + user feedback learning to rank findings",
        "Teams/Slack/email/SharePoint/Power Automate alerting via the unified notifier",
        "Executive reports and CSV export",
      ]}
    />
  );
}
