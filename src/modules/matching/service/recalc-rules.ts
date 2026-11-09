/**
 * Retry schedule for the matching job queue (D161). Pure: no SQL.
 * Same pause as the mail queue: 2^(attempts-1) minutes, stop after 5.
 */

export const MATCH_ATTEMPT_LIMIT = 5;
/** Leave headroom under the ~50s cron budget. */
export const MATCH_CRON_BUDGET_MS = 45_000;
/** A running row older than this is claimed again (worker died). */
export const MATCH_LOCK_MS = 2 * 60 * 1000;

export interface RetryPlan {
  status: "pending" | "failed";
  runAfter: Date;
}

export function retryPlan(attempts: number, now: Date): RetryPlan {
  if (attempts >= MATCH_ATTEMPT_LIMIT) {
    return { status: "failed", runAfter: now };
  }
  const minutes = 2 ** Math.max(0, attempts - 1);
  return {
    status: "pending",
    runAfter: new Date(now.getTime() + minutes * 60_000),
  };
}

export function budgetExhausted(
  startedAt: number,
  now: number,
  budgetMs: number,
): boolean {
  return now - startedAt >= budgetMs;
}
