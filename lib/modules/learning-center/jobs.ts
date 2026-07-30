// Learning Center cron jobs, registered in lib/platform/cron.ts and invoked
// externally via /api/cron/<id> (see docs/DEPLOYMENT.md for crontab lines).

import type { CronJob } from "@/lib/platform/cron";
import { runAllRules } from "./rules";
import { runReminderSweep } from "./notifications";
import { runAutoAwardSweep } from "./gamify";
import { pruneAuthRows } from "./auth";
import { getSource } from "./source";

export const learningCenterCronJobs: CronJob[] = [
  {
    id: "lc-rules",
    description: "Evaluate Learning Center assignment rules (new team members + scheduled re-assignments) and grant earned badges.",
    run: async () => {
      await pruneAuthRows();
      const rules = await runAllRules();
      const awards = await runAutoAwardSweep(await getSource());
      return { rules, awards };
    },
  },
  {
    id: "lc-reminders",
    description: "Send templated due-date and compliance reminder emails for teams with active reminder templates.",
    run: async () => runReminderSweep(await getSource()),
  },
];
