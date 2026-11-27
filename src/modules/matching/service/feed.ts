/**
 * GET /api/matches assembly and dismiss (6B).
 * The public job object is the 4A DTO. No profile → empty lowData (D160).
 */
import { matchingPorts, type PublicJob as PortPublicJob } from "../../../ports";
import { notFound, rateLimited } from "@intgetion/kit";
import {
  countDismissedSince,
  deleteUserResults,
  listDismissedJobIds,
  readFeedback,
} from "../repo/matching-repo";
import type { ExplainEntry } from "../score/types";
import { getMatches } from "./compute";
import {
  decodeMatchCursor,
  dismissLimited,
  isNewMatch,
  profileHintsFromCounts,
  sliceShown,
  type MatchTab,
  type ProfileHint,
  type ScoredRef,
} from "./feed-rules";

type PublicJob = PortPublicJob;

export interface MatchCard {
  job: PublicJob;
  score: number;
  explain: ExplainEntry[];
}

export interface MatchPage {
  items: MatchCard[];
  nextCursor: string | null;
  lowData: boolean;
  profileHints: ProfileHint[];
}

function emptyPage(lowData: boolean): MatchPage {
  return { items: [], nextCursor: null, lowData, profileHints: [] };
}

export async function loadProfileHints(
  userId: string,
  now = new Date(),
): Promise<ProfileHint[]> {
  const feedback = await readFeedback(userId, now);
  return profileHintsFromCounts(feedback.hideReasonCounts);
}

/**
 * Stored matches live up to 24 hours, so a hide made after the calculation
 * must be applied when the feed is read, not only when it is recomputed.
 * Closed jobs drop out the same way: the public lookup returns open jobs only.
 */
type HiddenByViewer = {
  hiddenJobIds: readonly string[];
  hiddenCompanyIds: readonly string[];
};

async function cardsFor(
  scored: readonly ScoredRef[],
  locale: string,
  hidden: HiddenByViewer,
): Promise<MatchCard[]> {
  if (scored.length === 0) return [];
  const hiddenCompanies = new Set(hidden.hiddenCompanyIds);
  const jobs = await matchingPorts().listPublicJobsByIds(
    scored.map((item) => item.jobId),
    locale,
  );
  const byId = new Map(jobs.map((job) => [job.id, job]));
  const cards: MatchCard[] = [];
  for (const item of scored) {
    const job = byId.get(item.jobId);
    if (!job || hiddenCompanies.has(job.company.id)) continue;
    cards.push({ job, score: item.score, explain: item.explain });
  }
  return cards;
}

/** Scored matches for the API. Dismissed jobs stay until they fall under 0.55. */
export async function listMatchPage(
  userId: string,
  input: { cursor?: string; limit: number; locale: string; now?: Date },
): Promise<MatchPage> {
  if (!(await matchingPorts().hasCandidateProfile(userId))) return emptyPage(true);
  const now = input.now ?? new Date();
  const cursor = decodeMatchCursor(input.cursor);
  const [list, feedback] = await Promise.all([
    getMatches(userId, { now }),
    readFeedback(userId, now),
  ]);
  const hiddenJobs = new Set(feedback.hiddenJobIds);
  const sliced = sliceShown(
    list.items.filter((item) => !hiddenJobs.has(item.jobId)),
    cursor,
    input.limit,
  );
  const profileHints = profileHintsFromCounts(feedback.hideReasonCounts);
  return {
    items: await cardsFor(sliced.page, input.locale, feedback),
    nextCursor: sliced.nextCursor,
    lowData: list.lowData,
    profileHints,
  };
}

export interface ScreenCard extends MatchCard {
  isNew: boolean;
}

export interface MatchScreen {
  items: ScreenCard[];
  nextCursor: string | null;
  lowData: boolean;
  profileHints: ProfileHint[];
  counts: { all: number; new: number; hidden: number };
}

/**
 * Page tabs (D163): All and New omit dismissed jobs. Hidden lists them
 * even after the score drops under 0.55.
 */
export async function loadMatchScreen(
  userId: string,
  input: {
    tab: MatchTab;
    cursor?: string;
    limit: number;
    locale: string;
    now?: Date;
  },
): Promise<MatchScreen> {
  if (!(await matchingPorts().hasCandidateProfile(userId))) {
    return {
      items: [],
      nextCursor: null,
      lowData: true,
      profileHints: [],
      counts: { all: 0, new: 0, hidden: 0 },
    };
  }
  const now = input.now ?? new Date();
  const cursor = decodeMatchCursor(input.cursor);
  const [list, dismissedIds, feedback] = await Promise.all([
    getMatches(userId, { now }),
    listDismissedJobIds(userId),
    readFeedback(userId, now),
  ]);
  const profileHints = profileHintsFromCounts(feedback.hideReasonCounts);
  const dismissed = new Set(dismissedIds);
  const hiddenJobs = new Set(feedback.hiddenJobIds);
  const hiddenCompanies = new Set(feedback.hiddenCompanyIds);
  const jobs = await matchingPorts().listPublicJobsByIds(
    [...new Set([...list.items.map((item) => item.jobId), ...dismissedIds])],
    input.locale,
  );
  const byId = new Map(jobs.map((job) => [job.id, job]));
  const scored = new Map(list.items.map((item) => [item.jobId, item]));

  const visible = (publishedAt: string | null, hidden: boolean) => {
    if (input.tab === "hidden") return hidden;
    if (hidden) return false;
    if (input.tab === "new") return isNewMatch(publishedAt, now);
    return true;
  };

  const pool: ScoredRef[] = [];
  const countOf = { all: 0, new: 0, hidden: 0 };
  for (const job of jobs) {
    const hidden = dismissed.has(job.id);
    // Hidden by the viewer after the stored calculation: not in All or New.
    if (
      !hidden &&
      (hiddenJobs.has(job.id) || hiddenCompanies.has(job.company.id))
    ) {
      continue;
    }
    const match = scored.get(job.id);
    if (!hidden && !match) continue;
    if (hidden) countOf.hidden += 1;
    if (!hidden && match) {
      countOf.all += 1;
      if (isNewMatch(job.publishedAt, now)) countOf.new += 1;
    }
    if (!visible(job.publishedAt, hidden)) continue;
    pool.push({
      jobId: job.id,
      score: match?.score ?? 0.55,
      explain: match?.explain ?? [],
    });
  }
  const sliced = sliceShown(pool, cursor, input.limit);
  const items: ScreenCard[] = [];
  for (const item of sliced.page) {
    const job = byId.get(item.jobId);
    const match = scored.get(item.jobId);
    if (!job) continue;
    items.push({
      job,
      score: match?.score ?? item.score,
      explain: match?.explain ?? [],
      isNew: isNewMatch(job.publishedAt, now),
    });
  }
  return {
    items,
    nextCursor: sliced.nextCursor,
    lowData: list.lowData,
    profileHints,
    counts: countOf,
  };
}

export async function dismissMatch(
  userId: string,
  jobId: string,
  reason: string | undefined,
  now = new Date(),
): Promise<void> {
  if (!(await matchingPorts().hasCandidateProfile(userId))) throw notFound();
  const job = await matchingPorts().getJobForPublic(jobId, { userId });
  if (!job) throw notFound();
  const since = new Date(now.getTime() - 60 * 60 * 1000);
  const recent = await countDismissedSince(userId, since);
  if (dismissLimited(recent)) {
    throw rateLimited(60 * 60);
  }
  await matchingPorts().recordJobFeedback({
    userId,
    jobId,
    companyId: job.company.id,
    action: "dismissed",
    reason: reason ?? null,
  });
  await deleteUserResults(userId);
}

/** Shown match for one job, or null when the candidate is under 0.55. */
export async function matchForJob(
  userId: string,
  jobId: string,
): Promise<ScoredRef | null> {
  if (!(await matchingPorts().hasCandidateProfile(userId))) return null;
  const list = await getMatches(userId);
  return list.items.find((item) => item.jobId === jobId) ?? null;
}
