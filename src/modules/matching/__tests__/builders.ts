/**
 * Shared plain-object builders for scoring unit tests. Defaults are chosen
 * so every component is active and every hard filter passes; tests override
 * the one field under test.
 */
import type {
  CandidateForScoring,
  FeedbackForScoring,
  JobForScoring,
  ScoringContext,
} from "../score/types";
import { emptyFeedback } from "../score/types";

export const NOW = new Date("2026-01-12T12:00:00Z"); // Monday, northern winter

export function candidate(
  overrides: Partial<CandidateForScoring> = {},
): CandidateForScoring {
  return {
    userId: "u1",
    country: "DE",
    timezone: "Europe/Berlin",
    workHoursStart: "09:00",
    workHoursEnd: "18:00",
    workDays: [1, 2, 3, 4, 5],
    workFormats: ["remote", "hybrid", "onsite"],
    employmentTypes: ["full_time", "part_time", "contract"],
    experienceYears: 5,
    desiredTitles: ["Backend Developer"],
    categories: ["backend"],
    salaryMinMinor: BigInt(500000),
    salaryMaxMinor: null,
    salaryCurrency: "EUR",
    salaryPeriod: "month",
    salaryBasis: "gross",
    minOverlapHours: 3,
    skills: [{ skillId: "s1", level: "advanced" }],
    languages: [{ lang: "en", level: "C1" }],
    ...overrides,
  };
}

export function job(overrides: Partial<JobForScoring> = {}): JobForScoring {
  return {
    jobId: "j1",
    companyId: "c1",
    title: "Backend Developer",
    category: "backend",
    status: "published",
    workFormat: "remote",
    employmentType: "full_time",
    experienceMin: 3,
    experienceMax: null,
    locationCountry: "DE",
    countryRestrictions: null,
    timezoneRequired: "Europe/Berlin",
    workHoursStart: null,
    workHoursEnd: null,
    minOverlapHours: 3,
    salaryMinMinor: BigInt(600000),
    salaryMaxMinor: BigInt(720000),
    salaryCurrency: "EUR",
    salaryPeriod: "month",
    salaryBasis: "gross",
    skills: [{ skillId: "s1", weight: 2, minLevel: "intermediate" }],
    languages: [{ lang: "en", minLevel: "B2" }],
    ...overrides,
  };
}

export function context(
  overrides: Partial<ScoringContext> = {},
): ScoringContext {
  return {
    now: NOW,
    fxRates: [],
    titleSimilarity: (a, b) => (a === b ? 1 : 0),
    feedback: emptyFeedback(),
    ...overrides,
  };
}

export function feedback(
  overrides: Partial<FeedbackForScoring> = {},
): FeedbackForScoring {
  return { ...emptyFeedback(), ...overrides };
}

export const exactSim =
  (pairs: Record<string, number>) =>
  (candidateTitle: string, jobTitle: string): number =>
    pairs[`${candidateTitle}|${jobTitle}`] ?? 0;
