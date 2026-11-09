import { describe, expect, it } from "vitest";
import { SHOW_THRESHOLD } from "../score/assemble";
import {
  decodeMatchCursor,
  dismissLimited,
  encodeMatchCursor,
  isNewMatch,
  profileHintsFromCounts,
  sliceShown,
  type ScoredRef,
} from "../service/feed-rules";
import { retryPlan } from "../service/recalc-rules";

function row(jobId: string, score: number): ScoredRef {
  return { jobId, score, explain: [] };
}

describe("match page assembly", () => {
  it("drops scores under 0.55 and pages by score then job id", () => {
    const low = "00000000-0000-4000-8000-000000000001";
    const mid = "00000000-0000-4000-8000-000000000002";
    const high = "00000000-0000-4000-8000-000000000003";
    const tied = "00000000-0000-4000-8000-000000000004";
    const first = sliceShown(
      [row(low, 0.54), row(mid, 0.7), row(high, 0.9), row(tied, 0.9)],
      undefined,
      2,
    );
    expect(first.page.map((item) => item.jobId)).toEqual([high, tied]);
    expect(first.page.every((item) => item.score >= SHOW_THRESHOLD)).toBe(true);
    const cursor = decodeMatchCursor(first.nextCursor ?? undefined);
    const second = sliceShown(
      [row(low, 0.54), row(mid, 0.7), row(high, 0.9), row(tied, 0.9)],
      cursor,
      2,
    );
    expect(second.page.map((item) => item.jobId)).toEqual([mid]);
    expect(second.nextCursor).toBeNull();
  });

  it("rejects a cursor below the show threshold", () => {
    expect(() =>
      decodeMatchCursor(
        encodeMatchCursor({
          score: 0.4,
          jobId: "00000000-0000-4000-8000-000000000001",
        }),
      ),
    ).toThrow("invalid_cursor");
  });

  it("lists every profile field hidden three or more times", () => {
    expect(
      profileHintsFromCounts({ salary: 3, format: 2, timezone: 4 }),
    ).toEqual(["salary", "timezone"]);
    expect(
      profileHintsFromCounts({ salary: 0, format: 0, timezone: 0 }),
    ).toEqual([]);
  });

  it("treats a job published 48 hours ago as not new", () => {
    const now = new Date("2026-10-04T12:00:00.000Z");
    expect(isNewMatch("2026-10-02T12:00:01.000Z", now)).toBe(true);
    expect(isNewMatch("2026-10-02T12:00:00.000Z", now)).toBe(false);
    expect(isNewMatch(null, now)).toBe(false);
  });

  it("caps dismissals at 60 in the window", () => {
    expect(dismissLimited(59)).toBe(false);
    expect(dismissLimited(60)).toBe(true);
  });
});

describe("matching queue retry", () => {
  const now = new Date("2026-10-04T12:00:00.000Z");

  it("waits 2^(attempts-1) minutes and fails on the fifth", () => {
    expect(retryPlan(1, now)).toEqual({
      status: "pending",
      runAfter: new Date("2026-10-04T12:01:00.000Z"),
    });
    expect(retryPlan(3, now).runAfter.toISOString()).toBe(
      "2026-10-04T12:04:00.000Z",
    );
    expect(retryPlan(5, now).status).toBe("failed");
  });
});
