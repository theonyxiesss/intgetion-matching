/**
 * Matching v1 on the server (10.1). Reads the SQL prefilter, scores with
 * score/*, and stores the top 200 shown rows. No queue and no HTTP here.
 */
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
): Promise<MatchResult[]> {
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
  return selectShown(scored);
}

export async function computeMatches(
  userId: string,
  options: { now?: Date } = {},
): Promise<MatchList> {
  computeCount += 1;
  const now = options.now ?? new Date();
  const profile = await readProfile(userId);
  if (!profile) return emptyList();
  const shown = await scoreUser(profile.candidate, now);
  await replaceUserResults(
    userId,
    shown.map((match) => toWrite(match)),
  );
  return {
    items: shown.map(toItem),
    lowData: envelopeLowData(shown),
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
  return computeMatches(userId, { now });
}

export async function computeMatchesForJob(
  jobId: string,
  options: { now?: Date } = {},
): Promise<{ considered: number; written: number }> {
  computeCount += 1;
  const now = options.now ?? new Date();
  if (!(await readCompanyVisible(jobId))) {
    return { considered: 0, written: 0 };
  }
  const userIds = await prefilterCandidateIds(jobId, JOB_CANDIDATE_LIMIT);
  const [jobRow] = await readJobs([jobId], []);
  if (!jobRow) return { considered: 0, written: 0 };
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
  return { considered: userIds.length, written: writes.length };
}
