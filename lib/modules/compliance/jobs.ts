// Compliance module cron jobs (registered with the platform scheduler).

import type { CronJob } from "@/lib/platform/cron";
import { scanAllComplianceOrgs } from "./scan";
import { analyzeAllOrgs } from "./analyze";

export const complianceCronJobs: CronJob[] = [
  {
    id: "compliance-scan",
    description: "Scan every org's enabled compliance/regulatory feeds and classify findings.",
    run: () => scanAllComplianceOrgs(),
  },
  {
    id: "compliance-analyze",
    description: "AI-summarize new compliance findings and cross-reference org policies (bounded per run).",
    run: () => analyzeAllOrgs(),
  },
];
