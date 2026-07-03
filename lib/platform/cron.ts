// Platform scheduler. Next.js has no long-running worker, so scheduled work is
// modeled as named jobs invoked by an EXTERNAL scheduler (a Droplet crontab, a
// systemd timer, or any pinger) hitting /api/cron/<job> with the CRON_SECRET.
//
// Each module contributes jobs the same way it contributes migrators: export a
// CronJob[] and register it here. Every execution is recorded in cron_runs.

import { createHash, randomUUID, timingSafeEqual } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { cronRuns } from "./db/schema";
import { str } from "./env";
import { behaviorCronJobs } from "@/lib/modules/behavior/jobs";
import { complianceCronJobs } from "@/lib/modules/compliance/jobs";
import { lmsCronJobs } from "@/lib/modules/lms/jobs";

export interface CronJob {
  id: string;
  description: string;
  run: () => Promise<unknown>;
}

const JOBS: CronJob[] = [...behaviorCronJobs, ...complianceCronJobs, ...lmsCronJobs];

export function listJobs(): Array<{ id: string; description: string }> {
  return JOBS.map(({ id, description }) => ({ id, description }));
}

export function getJob(id: string): CronJob | null {
  return JOBS.find((j) => j.id === id) ?? null;
}

// Constant-time comparison of the provided secret against CRON_SECRET. Returns
// false when CRON_SECRET is unset, so the endpoint is closed by default.
export function authorizeCron(provided: string | null): boolean {
  const expected = str("CRON_SECRET");
  if (!expected || !provided) return false;
  // Hash both sides to a fixed 32-byte width before comparing. This keeps the
  // comparison constant-time AND avoids leaking the secret's length via the
  // length-equality short-circuit (and avoids timingSafeEqual's throw on
  // unequal-length buffers).
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export interface CronRunResult {
  job: string;
  status: "success" | "failed";
  summary?: unknown;
  error?: string;
  ms: number;
}

// In-process overlap guard (the app runs as a single container): an external
// pinger firing faster than a slow job finishes must not stack concurrent
// executions of the same job.
const runningJobs = new Set<string>();

export async function runJob(id: string): Promise<CronRunResult> {
  const job = getJob(id);
  if (!job) throw new Error(`Unknown job: ${id}`);

  if (runningJobs.has(id)) {
    return { job: id, status: "success", summary: { skipped: "already-running" }, ms: 0 };
  }
  runningJobs.add(id);

  const runId = randomUUID();
  const started = Date.now();
  await db.insert(cronRuns).values({ id: runId, job: id, status: "running", startedAt: started });

  let status: "success" | "failed";
  let summary: unknown;
  let error: string | undefined;
  try {
    summary = await job.run();
    status = "success";
  } catch (e) {
    status = "failed";
    error = e instanceof Error ? e.message : String(e);
  } finally {
    runningJobs.delete(id);
  }

  const finished = Date.now();
  await db
    .update(cronRuns)
    .set({ status, finishedAt: finished, summary: summary !== undefined ? JSON.stringify(summary) : null, error: error ?? null })
    .where(eq(cronRuns.id, runId));

  return { job: id, status, summary, error, ms: finished - started };
}

export async function runAllJobs(): Promise<CronRunResult[]> {
  const results: CronRunResult[] = [];
  for (const job of JOBS) results.push(await runJob(job.id));
  return results;
}
