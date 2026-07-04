// Cron jobs for the Narrative module — this is the "machine speed" loop: an
// external scheduler hits /api/cron/<id> as often as the org wants (every few
// minutes in production) so detection and assessment never wait for a human.

import type { CronJob } from "@/lib/platform/cron";
import { scanAllNarrativeOrgs } from "./scan";
import { assessAllOrgs } from "./analyze";

export const narrativeCronJobs: CronJob[] = [
  {
    id: "narrative-scan",
    description: "Scan every org's enabled media sources for watch-term mentions, cluster them into narratives, and raise alerts on escalation.",
    run: () => scanAllNarrativeOrgs(),
  },
  {
    id: "narrative-assess",
    description: "AI-assess newly detected narratives against each org's fact library (bounded per run).",
    run: () => assessAllOrgs(),
  },
];
