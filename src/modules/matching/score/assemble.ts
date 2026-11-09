/**
 * Weighted assembly (10.3): weight redistribution over non-neutral
 * components, lowData flag, must-have and no-salary penalties, feedback
 * multiplier, clamp and the 0.55 show threshold. ALGO_VERSION invalidates
 * matching_results caches when formulas change (10.1).
 */
import { seniorityPenalty } from "@intgetion/taxonomy/catalog";
import type {
  CandidateForScoring,
  ComponentBreakdown,
  ComponentKey,
  ComponentResult,
  JobForScoring,
  MatchResult,
  ScoringContext,
  ScoreExclusion,
} from "./types";
import {
  experienceComponent,
  hasCompleteJobSalary,
  languagesComponent,
  roleComponent,
  salaryComponent,
  skillsComponent,
  tzOverlapComponent,
} from "./components";
import { feedbackMultiplier } from "./feedback";
import { hardFilter } from "./hard-filter";
import { attachJobSnapshot } from "./explain";

export const ALGO_VERSION = 2;
export const SHOW_THRESHOLD = 0.55;
/** Below this sum of active weights the result is flagged lowData (10.3). */
export const LOW_DATA_WEIGHT_SUM = 0.4;
export const MUST_HAVE_WEIGHT = 3;
export const MISSING_MUST_HAVE_MULTIPLIER = 0.8;
export const NO_SALARY_MULTIPLIER = 0.95;

export const COMPONENT_WEIGHTS: Readonly<Record<ComponentKey, number>> = {
  skills: 0.35,
  role: 0.15,
  salary: 0.2,
  tzOverlap: 0.1,
  experience: 0.1,
  languages: 0.1,
};

const COMPONENT_ORDER: readonly ComponentKey[] = [
  "skills",
  "role",
  "salary",
  "tzOverlap",
  "experience",
  "languages",
];

export type { MatchResult, ComponentBreakdown, ScoreExclusion } from "./types";

function computeComponents(
  candidate: CandidateForScoring,
  job: JobForScoring,
  context: ScoringContext,
): Record<ComponentKey, ComponentResult> {
  return {
    skills: skillsComponent({
      jobSkills: job.skills,
      candidateSkills: candidate.skills,
    }),
    role: roleComponent({
      jobTitle: job.title,
      jobCategory: job.category,
      jobSectors: job.sectors,
      desiredTitles: candidate.desiredTitles,
      categories: candidate.categories,
      candidateSectors: candidate.sectors,
      titleSimilarity: context.titleSimilarity,
    }),
    salary: salaryComponent({
      job,
      candidate,
      fxRates: context.fxRates,
      now: context.now,
    }),
    tzOverlap: tzOverlapComponent({ candidate, job, from: context.now }),
    experience: experienceComponent({
      jobExperienceMin: job.experienceMin,
      jobExperienceMax: job.experienceMax,
      candidateExperienceYears: candidate.experienceYears,
    }),
    languages: languagesComponent({
      jobLanguages: job.languages,
      candidateLanguages: candidate.languages,
    }),
  };
}

/** Must-have skill absent from the candidate profile (weight = 3, D93). */
export function countMissingMustHaves(
  candidate: CandidateForScoring,
  job: JobForScoring,
): number {
  const owned = new Set(candidate.skills.map((skill) => skill.skillId));
  return job.skills.filter(
    (skill) => skill.weight === MUST_HAVE_WEIGHT && !owned.has(skill.skillId),
  ).length;
}

/**
 * Scores one (candidate, job) pair. Hard filters must already have passed —
 * use scoreCandidate to run them first (10.1 pipeline).
 */
export function buildMatch(
  candidate: CandidateForScoring,
  job: JobForScoring,
  context: ScoringContext,
): MatchResult {
  const results = computeComponents(candidate, job, context);

  let weightedSum = 0;
  let weightsSum = 0;
  for (const key of COMPONENT_ORDER) {
    const result = results[key];
    if ("score" in result) {
      weightedSum += COMPONENT_WEIGHTS[key] * result.score;
      weightsSum += COMPONENT_WEIGHTS[key];
    }
  }
  const base = weightsSum > 0 ? weightedSum / weightsSum : 0;
  const lowData = weightsSum < LOW_DATA_WEIGHT_SUM;

  const missingMustHaves = countMissingMustHaves(candidate, job);
  const mustHaveMultiplier = Math.pow(
    MISSING_MUST_HAVE_MULTIPLIER,
    missingMustHaves,
  );
  const noSalaryMultiplier = hasCompleteJobSalary(job)
    ? 1
    : NO_SALARY_MULTIPLIER;
  const penaltyMultiplier = mustHaveMultiplier * noSalaryMultiplier;

  const feedback = feedbackMultiplier(job, context.feedback);
  const levelMultiplier = seniorityPenalty(candidate.seniority, job.seniority);

  const score = Math.min(
    1,
    Math.max(
      0,
      base * penaltyMultiplier * feedback.multiplier * levelMultiplier,
    ),
  );

  const components = {} as Record<ComponentKey, ComponentBreakdown>;
  for (const key of COMPONENT_ORDER) {
    components[key] = { weight: COMPONENT_WEIGHTS[key], result: results[key] };
  }

  const match: MatchResult = {
    jobId: job.jobId,
    userId: candidate.userId,
    algoVersion: ALGO_VERSION,
    base,
    lowData,
    components,
    weightsSum,
    penalties: {
      missingMustHaves,
      mustHaveMultiplier,
      noSalaryMultiplier,
      seniorityMultiplier: levelMultiplier,
      multiplier: penaltyMultiplier,
    },
    feedback: {
      categoryMultiplier: feedback.categoryMultiplier,
      skillBonus: feedback.skillBonus,
      multiplier: feedback.multiplier,
      suggestProfileUpdate: feedback.suggestProfileUpdate,
    },
    score,
    shown: score >= SHOW_THRESHOLD,
    sectorOverlap: (job.sectors ?? []).some((sector) =>
      (candidate.sectors ?? []).includes(sector),
    ),
  };
  attachJobSnapshot(match, job);
  return match;
}

/** Full pipeline step for one pair: hard filter, then score (10.1). */
export function scoreCandidate(
  candidate: CandidateForScoring,
  job: JobForScoring,
  context: ScoringContext,
): MatchResult | ScoreExclusion {
  const filter = hardFilter(candidate, job, context);
  if (!filter.pass) {
    return { excluded: true, reason: filter.reason };
  }
  return buildMatch(candidate, job, context);
}
