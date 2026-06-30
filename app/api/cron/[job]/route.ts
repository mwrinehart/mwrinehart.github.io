// Scheduler entry point. An external scheduler (Droplet crontab / systemd timer)
// hits e.g. `GET /api/cron/pulse-scan` with `Authorization: Bearer $CRON_SECRET`.
// `/api/cron/all` runs every registered job. The secret is accepted ONLY via the
// Authorization header — never a query string, which would leak it into access /
// proxy / APM logs.

import type { NextRequest } from "next/server";
import { authorizeCron, getJob, listJobs, runAllJobs, runJob } from "@/lib/platform/cron";

function providedSecret(req: NextRequest): string | null {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  return null;
}

async function handle(req: NextRequest, ctx: { params: Promise<{ job: string }> }) {
  if (!authorizeCron(providedSecret(req))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const { job } = await ctx.params;
  if (job === "all") {
    return Response.json({ results: await runAllJobs() });
  }
  if (!getJob(job)) {
    return Response.json({ error: "unknown job", jobs: listJobs() }, { status: 404 });
  }
  const result = await runJob(job);
  return Response.json(result, { status: result.status === "failed" ? 500 : 200 });
}

export const GET = handle;
export const POST = handle;
