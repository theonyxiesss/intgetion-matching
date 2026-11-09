/**
 * Input and result types for matching v1 scoring (spec 10, decisions D90).
 * Plain objects only — 2B/3B/4B will assemble them from the database; the
 * scoring functions never touch SQL, queues or UI.
 */
import type { FxRate, SalaryBasis, SalaryPeriod } from "@intgetion/kit";

export type WorkFormat = "remote" | "hybrid" | "onsite";
export type EmploymentType =
  "full_time" | "part_time" | "contract" | "freelance" | "internship";
export type SkillLevel = "novice" | "intermediate" | "advanced" | "expert";
export type CefrLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2" | "native";

export const SKILL_LEVEL_ORDER: readonly SkillLevel[] = [
  "novice",
  "intermediate",
  "advanced",
  "expert",
];

export const CEFR_LEVEL_ORDER: readonly CefrLevel[] = [
  "A1",
  "A2",
  "B1",
  "B2",
  "C1",
  "C2",
  "native",
];

export function skillLevelIndex(level: SkillLevel): number {
  return SKILL_LEVEL_ORDER.indexOf(level);
}

export function cefrLevelIndex(level: CefrLevel): number {
  return CEFR_LEVEL_ORDER.indexOf(level);
}

export interface CandidateSkillForScoring {
  skillId: string;
  level: SkillLevel;
}

export interface CandidateLanguageForScoring {
  /** ISO 639-1 */
  lang: string;
  level: CefrLevel;
}

/** Fields of candidate_profiles + candidate_preferences + candidate_skills
 * + the shared profile's place and languages that scoring needs (D509). */
export interface CandidateForScoring {
  userId: string;
  /** ISO 3166-1 alpha-2; null = not filled in */
  country: string | null;
  /** IANA */
  /** IANA from the shared profile; null = unknown, no work-hours check (D509). */
  timezone: string | null;
  workHoursStart: string;
  workHoursEnd: string;
  /** ISO weekdays 1..7 */
  workDays: readonly number[];
  workFormats: readonly WorkFormat[];
  employmentTypes: readonly EmploymentType[];
  /** null = not filled in; scoring treats it as 0 years (D92) */
  experienceYears: number | null;
  desiredTitles: readonly string[];
  /** candidate_preferences.categories */
  categories: readonly string[];
  /** candidate_preferences.sectors (M1). Absent on older fixtures. */
  sectors?: readonly string[];
  seniority?: string | null;
  salaryMinMinor: bigint | null;
  salaryMaxMinor: bigint | null;
  salaryCurrency: string | null;
  salaryPeriod: SalaryPeriod | null;
  salaryBasis: SalaryBasis | null;
  minOverlapHours: number;
  skills: readonly CandidateSkillForScoring[];
  languages: readonly CandidateLanguageForScoring[];
}

export interface JobSkillForScoring {
  skillId: string;
  /** 1 = nice-to-have, 2 = important, 3 = must-have */
  weight: 1 | 2 | 3;
  minLevel: SkillLevel | null;
}

export interface JobLanguageForScoring {
  /** ISO 639-1 */
  lang: string;
  minLevel: CefrLevel;
}

/** Fields of jobs + job_skills + job_languages (4.1) that scoring needs. */
export interface JobForScoring {
  jobId: string;
  companyId: string;
  title: string;
  category: string;
  sectors?: readonly string[];
  seniority?: string | null;
  status: JobStatusForScoring;
  workFormat: WorkFormat;
  employmentType: EmploymentType;
  experienceMin: number | null;
  experienceMax: number | null;
  locationCountry: string | null;
  /** null = whole world */
  countryRestrictions: readonly string[] | null;
  /** IANA; null = no timezone requirement */
  timezoneRequired: string | null;
  /** in timezone_required; null = default 09:00–18:00 (10.6) */
  workHoursStart: string | null;
  workHoursEnd: string | null;
  minOverlapHours: number;
  salaryMinMinor: bigint | null;
  salaryMaxMinor: bigint | null;
  salaryCurrency: string | null;
  salaryPeriod: SalaryPeriod | null;
  salaryBasis: SalaryBasis | null;
  skills: readonly JobSkillForScoring[];
  languages: readonly JobLanguageForScoring[];
}

export type JobStatusForScoring =
  | "draft"
  | "pending_moderation"
  | "published"
  | "paused"
  | "expired"
  | "closed"
  | "removed";

/**
 * Feedback events (10.5) already aggregated upstream over their 90-day
 * windows: the scoring functions receive counts and id lists, not event rows.
 */
export interface FeedbackForScoring {
  /** jobs the user hid */
  hiddenJobIds: readonly string[];
  /** companies the user hid (hidden_company → hard exclusion) */
  hiddenCompanyIds: readonly string[];
  /** jobs with an active (non-withdrawn) application */
  activeApplicationJobIds: readonly string[];
  /** hidden/dismissed event count per job category within 90 days */
  hiddenDismissedCategoryCounts: Readonly<Record<string, number>>;
  /** skill ids seen in ≥ 2 saved/applied jobs within 90 days */
  repeatedSkillIds: readonly string[];
  /** hide/dismiss counts by reason; ≥ 3 → suggest a profile update */
  hideReasonCounts: { salary: number; format: number; timezone: number };
}

export function emptyFeedback(): FeedbackForScoring {
  return {
    hiddenJobIds: [],
    hiddenCompanyIds: [],
    activeApplicationJobIds: [],
    hiddenDismissedCategoryCounts: {},
    repeatedSkillIds: [],
    hideReasonCounts: { salary: 0, format: 0, timezone: 0 },
  };
}

/** Title similarity comes from pg_trgm in SQL (6A); tests pass their own. */
export type TitleSimilarityFn = (
  candidateTitle: string,
  jobTitle: string,
) => number;

export interface ScoringContext {
  now: Date;
  fxRates: readonly FxRate[];
  titleSimilarity: TitleSimilarityFn;
  feedback: FeedbackForScoring;
}

export type ComponentKey =
  "skills" | "role" | "salary" | "tzOverlap" | "experience" | "languages";

export type ComponentResult =
  { score: number } | { neutral: true; reason: string };

export interface ComponentBreakdown {
  weight: number;
  result: ComponentResult;
}

export interface MatchResult {
  jobId: string;
  userId: string;
  algoVersion: number;
  base: number;
  lowData: boolean;
  components: Readonly<Record<ComponentKey, ComponentBreakdown>>;
  weightsSum: number;
  penalties: {
    missingMustHaves: number;
    /** 0.8 per missing must-have skill */
    mustHaveMultiplier: number;
    /** ×0.95 when the job posts no (complete) salary */
    noSalaryMultiplier: number;
    /** ×0.9 when seniority differs by more than one step (D203). */
    seniorityMultiplier: number;
    multiplier: number;
  };
  feedback: {
    categoryMultiplier: number;
    skillBonus: number;
    multiplier: number;
    suggestProfileUpdate: "salary" | "format" | "timezone" | null;
  };
  /** clamp(base × penalties × feedback × seniority, 0, 1) */
  score: number;
  /** A shared sector raised the role component (D203). */
  sectorOverlap: boolean;
  /** score ≥ 0.55 */
  shown: boolean;
}

export type ScoreExclusion = { excluded: true; reason: string };

export type ExplainVerdict = "matched" | "partial" | "neutral" | "failed";

export interface ExplainEntry {
  criterion: ComponentKey;
  verdict: ExplainVerdict;
  detail: { key: string; params: Record<string, string | number> };
}
