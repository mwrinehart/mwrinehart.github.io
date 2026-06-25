// Behavior module cron jobs, registered with the platform scheduler
// (lib/platform/cron.ts). These run across ALL orgs — they are system jobs hit
// by the external scheduler, not tenant-scoped requests.

import type { CronJob } from "@/lib/platform/cron";
import { scanAllOrgs } from "./pulse";
import { tickDigests } from "./digests";

export const behaviorCronJobs: CronJob[] = [
  {
    id: "pulse-scan",
    description: "Scan every org's enabled threat-pulse feeds and auto-route critical findings.",
    run: () => scanAllOrgs(),
  },
  {
    id: "pulse-digests",
    description: "Hourly tick: email scheduled pulse digests that are due this hour.",
    run: () => tickDigests(),
  },
];
