/**
 * Hard filters (10.2). Any failure excludes the vacancy before scoring.
 * Currency and gross/net are NOT hard filters (D4, D5).
 */
import type {
  CandidateForScoring,
  FeedbackForScoring,
  JobForScoring,
  ScoringContext,
} from "./types";
import { workHoursOverlap } from "@intgetion/kit";

export type HardFilterReason =
  | "work_format"
  | "country_restricted"
  | "employment_type"
  | "location"
  | "tz_overlap"
  | "hidden_by_user"
  | "already_applied"
  | "not_published";

export type HardFilterResult =
  { pass: true } | { pass: false; reason: HardFilterReason };

/**
 * Point 6 (10.2): hidden job/company and active application come from the
 * user's feedback events; hidden_company excludes the whole company (10.5).
 */
function userExclusion(
  job: JobForScoring,
  feedback: FeedbackForScoring,
): HardFilterResult {
  if (job.status !== "published") {
    return { pass: false, reason: "not_published" };
  }
  if (
    feedback.hiddenJobIds.includes(job.jobId) ||
    feedback.hiddenCompanyIds.includes(job.companyId)
  ) {
    return { pass: false, reason: "hidden_by_user" };
  }
  if (feedback.activeApplicationJobIds.includes(job.jobId)) {
    return { pass: false, reason: "already_applied" };
  }
  return { pass: true };
}

export function hardFilter(
  candidate: CandidateForScoring,
  job: JobForScoring,
  context: ScoringContext,
): HardFilterResult {
  const published = userExclusion(job, context.feedback);
  if (!published.pass) return published;

  if (!candidate.workFormats.includes(job.workFormat)) {
    return { pass: false, reason: "work_format" };
  }

  if (job.countryRestrictions !== null) {
    if (
      candidate.country === null ||
      !job.countryRestrictions.includes(candidate.country)
    ) {
      return { pass: false, reason: "country_restricted" };
    }
  }

  if (!candidate.employmentTypes.includes(job.employmentType)) {
    return { pass: false, reason: "employment_type" };
  }

  if (
    (job.workFormat === "hybrid" || job.workFormat === "onsite") &&
    (candidate.country === null || job.locationCountry !== candidate.country)
  ) {
    return { pass: false, reason: "location" };
  }

  if (job.timezoneRequired !== null && candidate.timezone !== null) {
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
      from: context.now,
      days: 14,
    });
    const overlapHours = overlap.averageOverlapMinutes / 60;
    if (overlapHours < job.minOverlapHours) {
      return { pass: false, reason: "tz_overlap" };
    }
  }

  return { pass: true };
}
