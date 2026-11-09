/**
 * Match list shaping for GET /api/matches (section 6 cursor, threshold 0.55).
 * Pure: no SQL.
 */
import { SHOW_THRESHOLD } from "../score/assemble";
import type { ExplainEntry } from "../score/types";

export const MATCH_PAGE_DEFAULT = 20;
export const MATCH_PAGE_MAX = 50;
export const NEW_MATCH_MS = 48 * 60 * 60 * 1000;
export const DISMISS_LIMIT_PER_HOUR = 60;

export const PROFILE_HINT_FIELDS = ["salary", "format", "timezone"] as const;
export type ProfileHint = (typeof PROFILE_HINT_FIELDS)[number];

const HINT_ANCHOR: Record<ProfileHint, string> = {
  salary: "salary",
  format: "preferences",
  timezone: "basics",
};

export function profileHintAnchor(field: ProfileHint): string {
  return HINT_ANCHOR[field];
}

export function profileHintsFromCounts(counts: {
  salary: number;
  format: number;
  timezone: number;
}): ProfileHint[] {
  return PROFILE_HINT_FIELDS.filter((field) => counts[field] >= 3);
}

export function dismissLimited(countInWindow: number): boolean {
  return countInWindow >= DISMISS_LIMIT_PER_HOUR;
}

export interface MatchCursor {
  score: number;
  jobId: string;
}

export function encodeMatchCursor(row: MatchCursor): string {
  return Buffer.from(JSON.stringify(row)).toString("base64url");
}

export function decodeMatchCursor(cursor?: string): MatchCursor | undefined {
  if (!cursor) return undefined;
  try {
    const value = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as { score?: unknown; jobId?: unknown };
    if (typeof value.score !== "number" || !Number.isFinite(value.score)) {
      throw new Error();
    }
    if (value.score < SHOW_THRESHOLD || value.score > 1) throw new Error();
    if (
      typeof value.jobId !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(value.jobId)
    ) {
      throw new Error();
    }
    return { score: value.score, jobId: value.jobId };
  } catch {
    throw new Error("invalid_cursor");
  }
}

export interface ScoredRef {
  jobId: string;
  score: number;
  explain: ExplainEntry[];
}

/** Drops scores under 0.55, then takes the page after the cursor. */
export function sliceShown(
  items: readonly ScoredRef[],
  cursor: MatchCursor | undefined,
  limit: number,
): { page: ScoredRef[]; nextCursor: string | null } {
  const sorted = items
    .filter((item) => item.score >= SHOW_THRESHOLD)
    .sort(
      (left, right) =>
        right.score - left.score || left.jobId.localeCompare(right.jobId),
    );
  const from = cursor
    ? sorted.findIndex(
        (item) =>
          item.score < cursor.score ||
          (item.score === cursor.score &&
            item.jobId.localeCompare(cursor.jobId) > 0),
      )
    : 0;
  if (from < 0) return { page: [], nextCursor: null };
  const page = sorted.slice(from, from + limit);
  const last = page.at(-1);
  const hasMore = from + limit < sorted.length;
  return {
    page,
    nextCursor: hasMore && last ? encodeMatchCursor(last) : null,
  };
}

export type MatchTab = "all" | "new" | "hidden";

export function parseMatchTab(value: string | undefined): MatchTab {
  if (value === "new" || value === "hidden") return value;
  return "all";
}

export function isNewMatch(publishedAt: string | null, now: Date): boolean {
  if (!publishedAt) return false;
  const published = Date.parse(publishedAt);
  if (!Number.isFinite(published)) return false;
  return now.getTime() - published < NEW_MATCH_MS;
}
