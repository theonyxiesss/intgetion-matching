import type { CandidateLanguageForScoring } from "../score/types";

/**
 * Country, time zone and languages for matching live in the shared "about
 * me" profile (D507, D509). A language without a level reads as B1: the
 * level only weighs the score, it never filters a job out. No time zone
 * means no work-hours check, not a guessed zone.
 */

export type SharedForMatching = {
  country: string | null;
  timezone: string | null;
  languages: readonly { code: string; level: string | null }[];
} | null;

const LEVELS = new Set(["A1", "A2", "B1", "B2", "C1", "C2", "native"]);
export const UNKNOWN_LEVEL = "B1" as const;

export function factsForMatching(shared: SharedForMatching): {
  country: string | null;
  timezone: string | null;
  languages: CandidateLanguageForScoring[];
} {
  return {
    country: shared?.country ?? null,
    timezone: shared?.timezone ?? null,
    languages: (shared?.languages ?? []).map((item) => ({
      lang: item.code,
      level: (item.level && LEVELS.has(item.level)
        ? item.level
        : UNKNOWN_LEVEL) as CandidateLanguageForScoring["level"],
    })),
  };
}
