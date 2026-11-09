/**
 * Feedback multiplier (10.5) as a pure function of pre-aggregated events.
 * hidden_company is NOT here: it is a hard exclusion (10.2.6, D93).
 */
import type { FeedbackForScoring, JobForScoring } from "./types";

/** hidden/dismissed in the category: ×0.9ⁿ, not below 0.6. */
export const CATEGORY_DECAY = 0.9;
export const CATEGORY_FLOOR = 0.6;
/** +0.03 per skill seen in ≥ 2 saved/applied jobs, total cap ×1.15. */
export const SKILL_BONUS_STEP = 0.03;
export const SKILL_BONUS_CAP = 0.15;
/** hides by reason ≥ 3 → suggest updating that profile field. */
export const SUGGEST_UPDATE_THRESHOLD = 3;

export type SuggestProfileUpdateField = "salary" | "format" | "timezone";

export interface FeedbackMultiplier {
  /** 0.6..1.15 */
  multiplier: number;
  categoryMultiplier: number;
  /** 0..0.15 */
  skillBonus: number;
  /** which profile field the bot/UI should offer to update, if any */
  suggestProfileUpdate: SuggestProfileUpdateField | null;
}

export function feedbackMultiplier(
  job: JobForScoring,
  feedback: FeedbackForScoring,
): FeedbackMultiplier {
  const n = feedback.hiddenDismissedCategoryCounts[job.category] ?? 0;
  const categoryMultiplier =
    n > 0 ? Math.max(CATEGORY_FLOOR, Math.pow(CATEGORY_DECAY, n)) : 1;

  let repeated = 0;
  for (const skill of job.skills) {
    if (feedback.repeatedSkillIds.includes(skill.skillId)) {
      repeated += 1;
    }
  }
  const skillBonus = Math.min(SKILL_BONUS_CAP, SKILL_BONUS_STEP * repeated);

  let suggest: SuggestProfileUpdateField | null = null;
  let suggestCount = 0;
  for (const field of ["salary", "format", "timezone"] as const) {
    const count = feedback.hideReasonCounts[field];
    if (count >= SUGGEST_UPDATE_THRESHOLD && count > suggestCount) {
      suggest = field;
      suggestCount = count;
    }
  }

  return {
    multiplier: categoryMultiplier * (1 + skillBonus),
    categoryMultiplier,
    skillBonus,
    suggestProfileUpdate: suggest,
  };
}
