import { requireTenant } from "@/lib/platform/org";
import { ModulePlaceholder } from "@/components/ModulePlaceholder";

export default async function StudioPage() {
  await requireTenant();
  return (
    <ModulePlaceholder
      moduleId="studio"
      capabilities={[
        "eLearning authoring with 29 interactive block types and live preview",
        "AI media generation: images, video, voiceover, avatars, music (OpenRouter, ElevenLabs, fal.ai)",
        "Timeline-based video composer with transitions and overlays",
        "Course export to HTML, SCORM 1.2/2004, xAPI, and PDF",
        "Brand kits + per-org templates (folds into platform org settings)",
        "Plan-based generation quotas + usage ledger (folds into platform billing)",
      ]}
    />
  );
}
