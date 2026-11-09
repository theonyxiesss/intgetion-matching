/**
 * Table queue for scoring one newly published job (D161).
 * Claim is FOR UPDATE SKIP LOCKED; the score runs after the claim commits
 * so the single app connection is not held across the compute.
 */
import { sql } from "drizzle-orm";
import { getDb } from "@intgetion/kit";
import { matchingJobs } from "../../../db";
import { reportError } from "@intgetion/kit";
import { computeMatchesForJob } from "./compute";
import {
  MATCH_CRON_BUDGET_MS,
  MATCH_LOCK_MS,
  budgetExhausted,
  retryPlan,
} from "./recalc-rules";

export interface ClaimedMatchJob {
  id: string;
  jobId: string;
  attempts: number;
}

export async function enqueueMatchJob(jobId: string): Promise<void> {
  await getDb().execute(sql`
    insert into public.matching_jobs (job_id, status, attempts, run_after)
    values (${jobId}, 'pending', 0, now())
    on conflict (job_id) where status in ('pending', 'running') do nothing
  `);
}

/**
 * One due row, or none. The update is the lock: a second caller skips it.
 * Without an explicit clock, due-ness uses the database clock. `run_after`
 * is written with `now()`, and a slightly slow app clock would skip the row.
 */
export async function claimMatchJob(
  now?: Date,
): Promise<ClaimedMatchJob | null> {
  const clock = now ? sql`${now.toISOString()}::timestamptz` : sql`now()`;
  const staleBefore = now
    ? sql`${new Date(now.getTime() - MATCH_LOCK_MS).toISOString()}::timestamptz`
    : sql`now() - make_interval(secs => ${MATCH_LOCK_MS / 1000})`;
  const rows = await getDb().execute<{
    id: string;
    job_id: string;
    attempts: number;
  }>(sql`
    update public.matching_jobs
    set status = 'running',
        attempts = attempts + 1,
        locked_at = ${clock}
    where id = (
      select id from public.matching_jobs
      where (
          status = 'pending'
          and run_after <= ${clock}
          and attempts < 5
        )
        or (
          status = 'running'
          and locked_at <= ${staleBefore}
          and attempts < 5
        )
      order by run_after, id
      limit 1
      for update skip locked
    )
    returning id, job_id, attempts
  `);
  const row = rows[0];
  if (!row) return null;
  return { id: row.id, jobId: row.job_id, attempts: row.attempts };
}

async function finishMatchJob(
  id: string,
  input: {
    status: "done" | "pending" | "failed";
    error?: string;
    runAfter?: Date;
    now: Date;
  },
): Promise<void> {
  await getDb()
    .update(matchingJobs)
    .set({
      status: input.status,
      error: input.error ?? null,
      ...(input.runAfter ? { runAfter: input.runAfter } : {}),
      ...(input.status === "done" || input.status === "failed"
        ? { finishedAt: input.now }
        : {}),
    })
    .where(sql`${matchingJobs.id} = ${id}`);
}

export async function runMatchingCron(input?: {
  now?: Date;
  budgetMs?: number;
  run?: (jobId: string) => Promise<void>;
}): Promise<{
  claimed: number;
  done: number;
  retried: number;
  failed: number;
}> {
  const now = input?.now ?? new Date();
  const budgetMs = input?.budgetMs ?? MATCH_CRON_BUDGET_MS;
  const run =
    input?.run ??
    ((jobId: string) => computeMatchesForJob(jobId).then(() => undefined));
  const started = Date.now();
  let claimed = 0;
  let done = 0;
  let retried = 0;
  let failed = 0;
  while (!budgetExhausted(started, Date.now(), budgetMs)) {
    const job = await claimMatchJob(input?.now);
    if (!job) break;
    claimed += 1;
    try {
      await run(job.jobId);
      await finishMatchJob(job.id, { status: "done", now });
      done += 1;
    } catch (error) {
      reportError(error, "matching cron");
      const plan = retryPlan(job.attempts, now);
      await finishMatchJob(job.id, {
        status: plan.status,
        error: "compute_failed",
        runAfter: plan.runAfter,
        now,
      });
      if (plan.status === "failed") failed += 1;
      else retried += 1;
    }
  }
  return { claimed, done, retried, failed };
}
