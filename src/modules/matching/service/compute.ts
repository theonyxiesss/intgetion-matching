/**
 * Matching v1 on the server (10.1). Reads the SQL prefilter, scores with
 * score/*, and stores the top 200 shown rows. No queue and no HTTP here.
 */
import { logger } from "@intgetion/kit";
import {
  prefilterCandidateIds,
  prefilterJobIds,
  readCompanyVisible,
  readFeedback,
  readFxRates,
  readJobs,
  readProfile,
  readStoredMatches,
  readTitleSimilarities,
  replaceUserResults,
  writeJobResults,
  type ResultWrite,
} from "../repo/matching-repo";
import { ALGO_VERSION, scoreCandidate } from "../score/assemble";
import { toPublicMatch } from "../score/explain";
import type { CandidateForScoring, MatchResult } from "../score/types";
import {
  envelopeLowData,
  isCacheFresh,
  JOB_CANDIDATE_LIMIT,
  PREFILTER_LIMIT,
  scoreToNumeric,
  selectShown,
} from "./cache-rules";

let computeCount = 0;

/** Test seam: how many full recomputes this process has started. */
export function resetComputeCount(): void {
  computeCount = 0;
}

export function takeComputeCount(): number {
  return computeCount;
}

export interface MatchItem {
  jobId: string;
  score: number;
  explain: ReturnType<typeof toPublicMatch>["explain"];
}

export interface MatchList {
  items: MatchItem[];
  lowData: boolean;
}

/** Cost counters of one recompute (no personal data). */
export interface ComputeStats {
  prefiltered: number;
  jobsRead: number;
  written: number;
  ms: number;
}

export type ComputedMatchList = MatchList & { stats: ComputeStats };

function logCompute(userId: string, stats: ComputeStats): void {
  logger.info(
    `matching.compute user=${userId} prefiltered=${stats.prefiltered} jobsRead=${stats.jobsRead} written=${stats.written} ms=${stats.ms}`,
  );
}

function emptyList(): MatchList {
  return { items: [], lowData: true };
}

function toItem(match: MatchResult): MatchItem {
  const pub = toPublicMatch(match);
  return { jobId: match.jobId, score: pub.score, explain: pub.explain };
}

function toWrite(match: MatchResult): ResultWrite {
  const item = toItem(match);
  return {
    jobId: match.jobId,
    score: scoreToNumeric(item.score),
    breakdown: {
      lowData: match.lowData,
      base: match.base,
      weightsSum: match.weightsSum,
      penalties: match.penalties,
      feedback: match.feedback,
      components: match.components,
    },
    explain: item.explain,
    algoVersion: ALGO_VERSION,
  };
}

async function scoreUser(
  candidate: CandidateForScoring,
  now: Date,
): Promise<{ shown: MatchResult[]; prefiltered: number; jobsRead: number }> {
  const feedback = await readFeedback(candidate.userId, now);
  const jobIds = await prefilterJobIds(candidate, PREFILTER_LIMIT);
  const rows = await readJobs(jobIds, candidate.desiredTitles);
  const fxRates = await readFxRates();
  const scored: MatchResult[] = [];
  for (const row of rows) {
    const result = scoreCandidate(candidate, row.job, {
      now,
      fxRates,
      feedback,
      titleSimilarity: () => row.titleSimilarity,
    });
    if (!("excluded" in result)) scored.push(result);
  }
  return {
    shown: selectShown(scored),
    prefiltered: jobIds.length,
    jobsRead: rows.length,
  };
}

export async function computeMatches(
  userId: string,
  options: { now?: Date } = {},
): Promise<ComputedMatchList> {
  computeCount += 1;
  const startedAt = performance.now();
  const now = options.now ?? new Date();
  const profile = await readProfile(userId);
  if (!profile) {
    const stats = {
      prefiltered: 0,
      jobsRead: 0,
      written: 0,
      ms: Math.round(performance.now() - startedAt),
    };
    logCompute(userId, stats);
    return { ...emptyList(), stats };
  }
  const { shown, prefiltered, jobsRead } = await scoreUser(
    profile.candidate,
    now,
  );
  await replaceUserResults(
    userId,
    shown.map((match) => toWrite(match)),
  );
  const stats = {
    prefiltered,
    jobsRead,
    written: shown.length,
    ms: Math.round(performance.now() - startedAt),
  };
  logCompute(userId, stats);
  return {
    items: shown.map(toItem),
    lowData: envelopeLowData(shown),
    stats,
  };
}

export async function getMatches(
  userId: string,
  options: { now?: Date } = {},
): Promise<MatchList> {
  const now = options.now ?? new Date();
  const profile = await readProfile(userId);
  if (!profile) return emptyList();
  const stored = await readStoredMatches(userId);
  if (
    isCacheFresh({
      rows: stored,
      profileUpdatedAt: profile.updatedAt,
      now,
    })
  ) {
    const items = stored
      .map((row) => ({
        jobId: row.jobId,
        score: row.score,
        explain: row.explain,
      }))
      .sort(
        (left, right) =>
          right.score - left.score || left.jobId.localeCompare(right.jobId),
      );
    return { items, lowData: envelopeLowData(stored) };
  }
  const { items, lowData } = await computeMatches(userId, { now });
  return { items, lowData };
}

export async function computeMatchesForJob(
  jobId: string,
  options: { now?: Date } = {},
): Promise<{ considered: number; written: number; ms: number }> {
  computeCount += 1;
  const startedAt = performance.now();
  const done = (considered: number, written: number) => {
    const ms = Math.round(performance.now() - startedAt);
    logger.info(
      `matching.computeForJob job=${jobId} considered=${considered} written=${written} ms=${ms}`,
    );
    return { considered, written, ms };
  };
  const now = options.now ?? new Date();
  if (!(await readCompanyVisible(jobId))) {
    return done(0, 0);
  }
  const userIds = await prefilterCandidateIds(jobId, JOB_CANDIDATE_LIMIT);
  const [jobRow] = await readJobs([jobId], []);
  if (!jobRow) return done(0, 0);
  const similarities = await readTitleSimilarities(jobId, userIds);
  const fxRates = await readFxRates();
  const writes: (ResultWrite & { userId: string })[] = [];
  const drops: string[] = [];
  for (const userId of userIds) {
    const profile = await readProfile(userId);
    if (!profile) {
      drops.push(userId);
      continue;
    }
    const feedback = await readFeedback(userId, now);
    const result = scoreCandidate(profile.candidate, jobRow.job, {
      now,
      fxRates,
      feedback,
      titleSimilarity: () => similarities.get(userId) ?? 0,
    });
    if ("excluded" in result || !result.shown) {
      drops.push(userId);
      continue;
    }
    writes.push({ userId, ...toWrite(result) });
  }
  await writeJobResults(jobId, writes, drops);
  return done(userIds.length, writes.length);
}
