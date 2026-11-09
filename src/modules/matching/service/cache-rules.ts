/**
 * Cache freshness, the 0.55 cutoff and the top-200 cut (10.1). Pure: no SQL.
 */
import { ALGO_VERSION, SHOW_THRESHOLD } from "../score/assemble";

/** A row exactly this old is still fresh; one millisecond older is not. */
export const CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
export const PREFILTER_LIMIT = 500;
export const MATCH_STORE_LIMIT = 200;
export const JOB_CANDIDATE_LIMIT = 2000;

export interface CacheRowStamp {
  computedAt: Date;
  algoVersion: number;
}

export function isCacheFresh(input: {
  rows: readonly CacheRowStamp[];
  profileUpdatedAt: Date;
  now: Date;
  algoVersion?: number;
}): boolean {
  const algoVersion = input.algoVersion ?? ALGO_VERSION;
  if (input.rows.length === 0) return false;
  for (const row of input.rows) {
    if (row.algoVersion !== algoVersion) return false;
    if (input.now.getTime() - row.computedAt.getTime() > CACHE_MAX_AGE_MS) {
      return false;
    }
    if (input.profileUpdatedAt.getTime() > row.computedAt.getTime()) {
      return false;
    }
  }
  return true;
}

export function selectShown<T extends { score: number; jobId: string }>(
  rows: readonly T[],
): T[] {
  return rows
    .filter((row) => row.score >= SHOW_THRESHOLD)
    .sort(
      (left, right) =>
        right.score - left.score || left.jobId.localeCompare(right.jobId),
    )
    .slice(0, MATCH_STORE_LIMIT);
}

/** True when every stored match was flagged lowData (10.3). Empty is not. */
export function envelopeLowData(
  matches: readonly { lowData: boolean }[],
): boolean {
  return matches.length > 0 && matches.every((match) => match.lowData);
}

/** numeric(5,4) text for a score already clamped to 0..1. */
export function scoreToNumeric(score: number): string {
  const scaled = Math.round(Math.min(1, Math.max(0, score)) * 10000);
  return `${Math.trunc(scaled / 10000)}.${String(scaled % 10000).padStart(4, "0")}`;
}
