import { describe, expect, it } from "vitest";
import { ALGO_VERSION, buildMatch } from "../score/assemble";
import { emptyFeedback } from "../score/types";
import {
  CACHE_MAX_AGE_MS,
  envelopeLowData,
  isCacheFresh,
  scoreToNumeric,
  selectShown,
} from "../service/cache-rules";
import { candidate, context, job, NOW } from "./builders";

describe("matching cache and cutoff", () => {
  it("treats a cache as stale when it is empty, older than 6h, behind the profile, or on another algo version", () => {
    const computedAt = new Date(NOW.getTime() - CACHE_MAX_AGE_MS);
    const fresh = {
      rows: [{ computedAt, algoVersion: ALGO_VERSION }],
      profileUpdatedAt: new Date(computedAt.getTime() - 1000),
      now: NOW,
    };
    expect(isCacheFresh(fresh)).toBe(true);
    expect(isCacheFresh({ ...fresh, rows: [] })).toBe(false);
    expect(
      isCacheFresh({
        ...fresh,
        now: new Date(computedAt.getTime() + CACHE_MAX_AGE_MS + 1),
      }),
    ).toBe(false);
    expect(
      isCacheFresh({
        ...fresh,
        profileUpdatedAt: new Date(computedAt.getTime() + 1),
      }),
    ).toBe(false);
    expect(
      isCacheFresh({
        ...fresh,
        rows: [{ computedAt, algoVersion: ALGO_VERSION + 1 }],
      }),
    ).toBe(false);
  });

  it("keeps scores at or above 0.55 and only the top 200", () => {
    const rows = [
      { jobId: "low", score: 0.549 },
      { jobId: "edge", score: 0.55 },
      ...Array.from({ length: 199 }, (_, index) => ({
        jobId: `j${String(index).padStart(3, "0")}`,
        score: 0.9,
      })),
    ];
    const shown = selectShown(rows);
    expect(shown).toHaveLength(200);
    expect(shown.map((row) => row.jobId)).not.toContain("low");
    expect(shown.map((row) => row.jobId)).toContain("edge");
    expect(shown[0]?.score).toBe(0.9);
  });

  it("applies the category feedback multiplier and flags lowData below weight 0.4", () => {
    const offer = job({ category: "engineering" });
    const plain = buildMatch(candidate(), offer, context());
    const penalised = buildMatch(
      candidate(),
      offer,
      context({
        feedback: {
          ...emptyFeedback(),
          hiddenDismissedCategoryCounts: { engineering: 2 },
        },
      }),
    );
    expect(penalised.feedback.categoryMultiplier).toBeCloseTo(0.81);
    expect(penalised.score).toBeLessThan(plain.score);

    const sparse = buildMatch(
      candidate({
        desiredTitles: [],
        categories: [],
        salaryMinMinor: null,
        salaryCurrency: null,
        salaryPeriod: null,
        salaryBasis: null,
      }),
      job({
        skills: [],
        languages: [],
        salaryMinMinor: null,
        salaryMaxMinor: null,
        salaryCurrency: null,
        salaryPeriod: null,
        salaryBasis: null,
        timezoneRequired: null,
        experienceMin: 3,
      }),
      context(),
    );
    expect(sparse.lowData).toBe(true);
    expect(sparse.weightsSum).toBeLessThan(0.4);
    expect(envelopeLowData([sparse])).toBe(true);
    expect(envelopeLowData([])).toBe(false);
    expect(envelopeLowData([plain])).toBe(false);
  });

  it("stores a score as numeric(5,4) text", () => {
    expect(scoreToNumeric(0.86)).toBe("0.8600");
    expect(scoreToNumeric(1)).toBe("1.0000");
    expect(scoreToNumeric(0)).toBe("0.0000");
  });
});
