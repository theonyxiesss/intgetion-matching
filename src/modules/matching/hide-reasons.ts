/** Reasons a person gives for hiding a job (feedback rules, 4.1). Copy of the platform list. */
export const HIDE_REASONS = [
  "salary",
  "format",
  "timezone",
  "company",
  "role",
  "other",
] as const;

export type HideReason = (typeof HIDE_REASONS)[number];
