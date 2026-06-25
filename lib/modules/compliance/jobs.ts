// Compliance module cron jobs (registered with the platform scheduler).

import type { CronJob } from "@/lib/platform/cron";
import { scanAllComplianceOrgs } from "./scan";

export const complianceCronJobs: CronJob[] = [
  {
    id: "compliance-scan",
    description: "Scan every org's enabled compliance/regulatory feeds and classify findings.",
    run: () => scanAllComplianceOrgs(),
  },
];
