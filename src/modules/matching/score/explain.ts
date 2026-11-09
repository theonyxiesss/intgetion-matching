/**
 * Explain (10.7, D30): built deterministically from the breakdown, no LLM.
 * Entries are { criterion, verdict, detail: { key, params } } where key is a
 * next-intl path under the top-level "explain" message key. Public output
 * carries only score (2 decimals) and explain — never the breakdown (5.3).
 */
import type {
  ComponentKey,
  ExplainEntry,
  ExplainVerdict,
  JobForScoring,
  MatchResult,
} from "./types";

const EPSILON = 1e-9;
export const CARD_EXPLAIN_LIMIT = 4;

const VERDICT_RANK: Readonly<Record<ExplainVerdict, number>> = {
  matched: 0,
  partial: 1,
  neutral: 2,
  failed: 3,
};

const CRITERION_ORDER: readonly ComponentKey[] = [
  "skills",
  "role",
  "salary",
  "tzOverlap",
  "experience",
  "languages",
];

const PERIOD_SHORT: Readonly<Record<string, string>> = {
  hour: "hr",
  month: "mo",
  year: "yr",
};

/** Display-only minor→major conversion, integer BigInt math (D19: no float). */
function minorToMajorString(amountMinor: bigint): string {
  const hundred = BigInt(100);
  const major = amountMinor / hundred;
  const cents = amountMinor % hundred;
  if (cents === BigInt(0)) return major.toString();
  return `${major.toString()}.${cents.toString().padStart(2, "0")}`;
}

/**
 * buildMatch does not keep the raw job in the result, but the explain salary
 * texts quote the offer; the snapshot is attached module-privately at build
 * time and never leaves this module.
 */
const resultJobSnapshot = new WeakMap<MatchResult, JobForScoring>();

function formatJobSalary(result: MatchResult): string {
  const job = resultJobSnapshot.get(result);
  if (!job) return "";
  const parts: string[] = [];
  if (job.salaryMinMinor !== null && job.salaryMaxMinor !== null) {
    parts.push(
      `${minorToMajorString(job.salaryMinMinor)}–${minorToMajorString(job.salaryMaxMinor)}`,
    );
  } else {
    const amount = (job.salaryMaxMinor ?? job.salaryMinMinor)!;
    parts.push(minorToMajorString(amount));
  }
  const periodShort = PERIOD_SHORT[job.salaryPeriod ?? ""];
  parts.push(
    periodShort
      ? `${job.salaryCurrency}/${periodShort}`
      : (job.salaryCurrency ?? ""),
  );
  parts.push(job.salaryBasis ?? "");
  return parts.filter((part) => part !== "").join(" ");
}

function componentVerdict(
  result: MatchResult,
  key: ComponentKey,
): {
  verdict: ExplainVerdict;
  score: number | null;
} {
  const component = result.components[key].result;
  if ("neutral" in component) {
    return { verdict: "neutral", score: null };
  }
  if (component.score >= 1 - EPSILON)
    return { verdict: "matched", score: component.score };
  if (component.score <= EPSILON)
    return { verdict: "failed", score: component.score };
  return { verdict: "partial", score: component.score };
}

function percent(score: number): number {
  return Math.round(score * 100);
}

function buildEntries(result: MatchResult): ExplainEntry[] {
  const entries: ExplainEntry[] = [];
  const job = resultJobSnapshot.get(result);

  const skills = componentVerdict(result, "skills");
  entries.push({
    criterion: "skills",
    verdict: skills.verdict,
    detail: {
      key: `explain.skills.${skills.verdict}`,
      params: skills.score === null ? {} : { percent: percent(skills.score) },
    },
  });

  const role = componentVerdict(result, "role");
  entries.push({
    criterion: "role",
    verdict: role.verdict,
    detail: {
      key: `explain.role.${role.verdict}`,
      params: role.score === null ? {} : { percent: percent(role.score) },
    },
  });
  if (result.sectorOverlap) {
    entries.push({
      criterion: "role",
      verdict: "matched",
      detail: { key: "explain.role.sector", params: {} },
    });
  }
  if (result.penalties.seniorityMultiplier < 1) {
    entries.push({
      criterion: "role",
      verdict: "partial",
      detail: { key: "explain.seniority.partial", params: {} },
    });
  }

  const salary = componentVerdict(result, "salary");
  entries.push({
    criterion: "salary",
    verdict: salary.verdict,
    detail: {
      key: `explain.salary.${salary.verdict}`,
      params:
        salary.score === null
          ? {}
          : {
              job: job ? formatJobSalary(result) : "",
              percent: percent(salary.score),
            },
    },
  });

  const tzOverlap = componentVerdict(result, "tzOverlap");
  entries.push({
    criterion: "tzOverlap",
    verdict: tzOverlap.verdict,
    detail: {
      key: `explain.tzOverlap.${tzOverlap.verdict}`,
      params:
        tzOverlap.score === null ? {} : { percent: percent(tzOverlap.score) },
    },
  });

  const experience = componentVerdict(result, "experience");
  entries.push({
    criterion: "experience",
    verdict: experience.verdict,
    detail: {
      key: `explain.experience.${experience.verdict}`,
      params:
        experience.score === null ? {} : { percent: percent(experience.score) },
    },
  });

  const languages = componentVerdict(result, "languages");
  entries.push({
    criterion: "languages",
    verdict: languages.verdict,
    detail: {
      key: `explain.languages.${languages.verdict}`,
      params:
        languages.score === null ? {} : { percent: percent(languages.score) },
    },
  });

  return entries;
}

/** matched → partial → neutral → failed (10.7). */
export function sortExplain(entries: readonly ExplainEntry[]): ExplainEntry[] {
  return [...entries].sort(
    (a, b) =>
      VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict] ||
      CRITERION_ORDER.indexOf(a.criterion) -
        CRITERION_ORDER.indexOf(b.criterion),
  );
}

/** Card shows at most 4 entries (10.7). */
export function topExplain(
  entries: readonly ExplainEntry[],
  limit = CARD_EXPLAIN_LIMIT,
): ExplainEntry[] {
  return sortExplain(entries).slice(0, limit);
}

/** Builds the full explain array from a MatchResult breakdown. */
export function explainMatch(result: MatchResult): ExplainEntry[] {
  return sortExplain(buildEntries(result));
}

export interface PublicMatch {
  /** score rounded to 2 decimals (5.3) */
  score: number;
  explain: ExplainEntry[];
}

/** The only shape that leaves the backend for the client (5.3, D94). */
export function toPublicMatch(result: MatchResult): PublicMatch {
  return {
    score: Math.round(result.score * 100) / 100,
    explain: topExplain(buildEntries(result)),
  };
}

/** Module-internal: lets buildMatch quote the raw offer in salary params. */
export function attachJobSnapshot(
  result: MatchResult,
  job: JobForScoring,
): void {
  resultJobSnapshot.set(result, job);
}
