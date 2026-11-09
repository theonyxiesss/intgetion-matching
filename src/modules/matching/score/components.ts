/**
 * Score components (10.3). Each returns { score: 0..1 } or
 * { neutral: true, reason } — neutral components are excluded from the
 * weighted sum and their weight is redistributed (10.3, D91, D92).
 */
import { SECTOR_ROLE_FLOOR } from "@intgetion/taxonomy/catalog";
import {
  compareSalaries,
  jobSalaryReference,
  salaryScore,
  type FxRate,
  type SalaryAmount,
} from "@intgetion/kit";
import { workHoursOverlap } from "@intgetion/kit";
import {
  cefrLevelIndex,
  skillLevelIndex,
  type CandidateForScoring,
  type ComponentResult,
  type JobForScoring,
  type ScoringContext,
} from "./types";

export interface SkillsInput {
  jobSkills: JobForScoring["skills"];
  candidateSkills: CandidateForScoring["skills"];
}

/** Σ w_j·m_j / Σ w_j; m_j = 1 | 0.5 (below min_level) | 0 (absent). */
export function skillsComponent({
  jobSkills,
  candidateSkills,
}: SkillsInput): ComponentResult {
  if (jobSkills.length === 0) {
    return { neutral: true, reason: "no_job_skills" };
  }
  const candidate = new Map(candidateSkills.map((s) => [s.skillId, s.level]));
  let weighted = 0;
  let totalWeight = 0;
  for (const requirement of jobSkills) {
    const level = candidate.get(requirement.skillId);
    let m = 0;
    if (level !== undefined) {
      if (
        requirement.minLevel === null ||
        skillLevelIndex(level) >= skillLevelIndex(requirement.minLevel)
      ) {
        m = 1;
      } else {
        m = 0.5;
      }
    }
    weighted += requirement.weight * m;
    totalWeight += requirement.weight;
  }
  return { score: weighted / totalWeight };
}

export interface RoleInput {
  jobTitle: string;
  jobCategory: string;
  jobSectors?: readonly string[];
  desiredTitles: readonly string[];
  categories: readonly string[];
  candidateSectors?: readonly string[];
  titleSimilarity: ScoringContext["titleSimilarity"];
}

/** max(similarity(desiredTitle, jobTitle)); category membership floors at 0.7. */
export function roleComponent({
  jobTitle,
  jobCategory,
  jobSectors = [],
  desiredTitles,
  categories,
  candidateSectors = [],
  titleSimilarity,
}: RoleInput): ComponentResult {
  const sectorMatch = jobSectors.some((sector) =>
    candidateSectors.includes(sector),
  );
  if (desiredTitles.length === 0 && categories.length === 0 && !sectorMatch) {
    return { neutral: true, reason: "no_preferences" };
  }
  let similarity = 0;
  for (const title of desiredTitles) {
    similarity = Math.max(similarity, titleSimilarity(title, jobTitle));
  }
  if (categories.includes(jobCategory) || sectorMatch) {
    similarity = Math.max(similarity, SECTOR_ROLE_FLOOR);
  }
  return { score: similarity };
}

/** The job can be scored against salary only when its own data is complete. */
export function hasCompleteJobSalary(job: JobForScoring): boolean {
  return (
    (job.salaryMinMinor !== null || job.salaryMaxMinor !== null) &&
    job.salaryCurrency !== null &&
    job.salaryPeriod !== null &&
    job.salaryBasis !== null
  );
}

export interface SalaryInput {
  job: JobForScoring;
  candidate: Pick<
    CandidateForScoring,
    | "salaryMinMinor"
    | "salaryMaxMinor"
    | "salaryCurrency"
    | "salaryPeriod"
    | "salaryBasis"
  >;
  fxRates: readonly FxRate[];
  now: Date;
}

/** 10.4 via src/lib/money.ts; incomparable → neutral, never a guess (D4/D5).
 * A side with an amount but missing currency/period/basis counts as absent
 * (D92). */
export function salaryComponent({
  job,
  candidate,
  fxRates,
  now,
}: SalaryInput): ComponentResult {
  const jobCurrency = job.salaryCurrency;
  const jobPeriod = job.salaryPeriod;
  const jobBasis = job.salaryBasis;
  const jobReference = jobSalaryReference(
    job.salaryMinMinor,
    job.salaryMaxMinor,
  );
  if (
    jobReference === null ||
    jobCurrency === null ||
    jobPeriod === null ||
    jobBasis === null
  ) {
    return { neutral: true, reason: "no_job_salary" };
  }
  const candidateCurrency = candidate.salaryCurrency;
  const candidatePeriod = candidate.salaryPeriod;
  const candidateBasis = candidate.salaryBasis;
  if (
    candidate.salaryMinMinor === null ||
    candidateCurrency === null ||
    candidatePeriod === null ||
    candidateBasis === null
  ) {
    return { neutral: true, reason: "no_candidate_salary" };
  }
  const jobAmount: SalaryAmount = {
    amountMinor: jobReference,
    currency: jobCurrency,
    period: jobPeriod,
    basis: jobBasis,
  };
  const candidateAmount: SalaryAmount = {
    amountMinor: candidate.salaryMinMinor,
    currency: candidateCurrency,
    period: candidatePeriod,
    basis: candidateBasis,
  };
  const comparison = compareSalaries(jobAmount, candidateAmount, fxRates, now);
  if (!comparison.comparable) {
    return { neutral: true, reason: comparison.reason };
  }
  const score = salaryScore(
    comparison.jobMonthlyMinor,
    comparison.candMonthlyMinor,
  );
  if (score.kind === "score") {
    return { score: score.score };
  }
  return { neutral: true, reason: score.reason };
}

export interface TzOverlapInput {
  candidate: Pick<
    CandidateForScoring,
    | "timezone"
    | "workHoursStart"
    | "workHoursEnd"
    | "workDays"
    | "minOverlapHours"
  >;
  job: Pick<
    JobForScoring,
    "timezoneRequired" | "workHoursStart" | "workHoursEnd" | "minOverlapHours"
  >;
  from: Date;
}

/** min(1, O / max(R, 1)), O in hours over the next 14 days (10.3, 10.6). */
export function tzOverlapComponent({
  candidate,
  job,
  from,
}: TzOverlapInput): ComponentResult {
  if (job.timezoneRequired === null) {
    return { neutral: true, reason: "no_timezone_required" };
  }
  if (candidate.timezone === null) {
    return { neutral: true, reason: "no_candidate_timezone" };
  }
  const overlap = workHoursOverlap({
    candidate: {
      timeZone: candidate.timezone,
      start: candidate.workHoursStart,
      end: candidate.workHoursEnd,
      workDays: candidate.workDays,
    },
    job: {
      timeZone: job.timezoneRequired,
      start: job.workHoursStart ?? undefined,
      end: job.workHoursEnd ?? undefined,
    },
    from,
    days: 14,
  });
  const overlapHours = overlap.averageOverlapMinutes / 60;
  const requiredHours = Math.max(
    Math.max(job.minOverlapHours, candidate.minOverlapHours),
    1,
  );
  return { score: Math.min(1, overlapHours / requiredHours) };
}

export interface ExperienceInput {
  jobExperienceMin: number | null;
  jobExperienceMax: number | null;
  candidateExperienceYears: number | null;
}

/** cand ≥ min → 1; min−1 → 0.5; else 0; over max+3 → 0.7 (10.3, D92). */
export function experienceComponent({
  jobExperienceMin,
  jobExperienceMax,
  candidateExperienceYears,
}: ExperienceInput): ComponentResult {
  if (jobExperienceMin === null) {
    return { neutral: true, reason: "no_experience_requirement" };
  }
  const years = candidateExperienceYears ?? 0;
  if (jobExperienceMax !== null && years > jobExperienceMax + 3) {
    return { score: 0.7 };
  }
  if (years >= jobExperienceMin) {
    return { score: 1 };
  }
  if (years === jobExperienceMin - 1) {
    return { score: 0.5 };
  }
  return { score: 0 };
}

export interface LanguagesInput {
  jobLanguages: JobForScoring["languages"];
  candidateLanguages: CandidateForScoring["languages"];
}

/** Average over required languages: ≥ min → 1; one CEFR step below → 0.5;
 * otherwise (incl. absent) → 0. */
export function languagesComponent({
  jobLanguages,
  candidateLanguages,
}: LanguagesInput): ComponentResult {
  if (jobLanguages.length === 0) {
    return { neutral: true, reason: "no_job_languages" };
  }
  const candidate = new Map(
    candidateLanguages.map((language) => [language.lang, language.level]),
  );
  let sum = 0;
  for (const requirement of jobLanguages) {
    const level = candidate.get(requirement.lang);
    if (level === undefined) {
      sum += 0;
      continue;
    }
    const gap = cefrLevelIndex(level) - cefrLevelIndex(requirement.minLevel);
    sum += gap >= 0 ? 1 : gap === -1 ? 0.5 : 0;
  }
  return { score: sum / jobLanguages.length };
}
