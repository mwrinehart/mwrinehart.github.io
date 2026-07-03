// LMS module cron jobs (registered with the platform scheduler). Type-only
// cron import: lib/platform/cron.ts imports this array, so a value import
// would be a cycle.

import type { CronJob } from "@/lib/platform/cron";
import { syncAllLmsOrgs } from "./sync";
import { activateScheduledLms, pollLmsCompletions, tickLmsDueDates } from "./workers";

export const lmsCronJobs: CronJob[] = [
  {
    id: "lms-sync",
    description: "Mirror every configured org's Litmos users/teams/courses into the LMS module.",
    run: () => syncAllLmsOrgs(),
  },
  {
    id: "lms-activate",
    description: "Activate scheduled LMS assignments whose start time has arrived.",
    run: () => activateScheduledLms(),
  },
  {
    id: "lms-poll",
    description: "Poll Litmos for completions of active LMS assignments and fire completion events.",
    run: () => pollLmsCompletions(),
  },
  {
    id: "lms-duedates",
    description: "Overdue transitions, due-date reminders, compliance recompute + auto-reassign, and daily rules.",
    run: () => tickLmsDueDates(),
  },
];
