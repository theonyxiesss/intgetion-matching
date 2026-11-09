import { describe, expect, it } from "vitest";
import {
  ALGO_VERSION,
  buildMatch,
  scoreCandidate,
  SHOW_THRESHOLD,
} from "../score/assemble";
import { feedbackMultiplier } from "../score/feedback";
import { explainMatch, toPublicMatch } from "../score/explain";
import type { ExplainEntry } from "../score/types";
import { candidate, context, exactSim, feedback, job } from "./builders";

describe("weighted assembly (10.3)", () => {
  it("computes base over all six components", () => {
    const result = buildMatch(candidate(), job(), context());
    expect(result.weightsSum).toBeCloseTo(1.0);
    expect(result.lowData).toBe(false);
    // defaults give every active component score 1
    expect(result.base).toBe(1);
    expect(result.score).toBe(1);
    expect(result.algoVersion).toBe(ALGO_VERSION);
    expect(result.shown).toBe(true);
  });

  it("redistributes weight over non-neutral components", () => {
    // role neutral (no preferences), languages neutral (no job languages)
    const result = buildMatch(
      candidate({ desiredTitles: [], categories: [] }),
      job({ languages: [] }),
      context(),
    );
    expect(result.weightsSum).toBeCloseTo(0.75);
    expect(result.base).toBe(1);
  });

  it("mixes partial scores proportionally", () => {
    const result = buildMatch(
      candidate({ desiredTitles: [], categories: [] }),
      job({
        languages: [],
        skills: [{ skillId: "s1", weight: 2, minLevel: "expert" }], // 0.5
        experienceMin: 6, // candidate 5 = min−1 → 0.5
      }),
      context(),
    );
    // (0.35·0.5 + 0.2·1 + 0.1·1 + 0.1·0.5) / 0.75 = 0.525/0.75
    expect(result.base).toBeCloseTo(0.7);
  });

  it("flags lowData below 0.4 of active weight — boundary included", () => {
    // salary + experience + languages = 0.4 → not lowData
    const edge = buildMatch(
      candidate({ desiredTitles: [], categories: [] }),
      job({ skills: [], timezoneRequired: null }),
      context(),
    );
    expect(edge.weightsSum).toBeCloseTo(0.4);
    expect(edge.lowData).toBe(false);

    // salary only = 0.2 → lowData
    const low = buildMatch(
      candidate({ desiredTitles: [], categories: [] }),
      job({
        skills: [],
        timezoneRequired: null,
        experienceMin: null,
        languages: [],
      }),
      context(),
    );
    expect(low.lowData).toBe(true);
  });
});

describe("penalties (10.3)", () => {
  it("multiplies ×0.8 per absent must-have (0, 1, 2)", () => {
    const none = buildMatch(
      candidate(),
      job({ skills: [{ skillId: "s1", weight: 3, minLevel: null }] }),
      context(),
    );
    expect(none.penalties.missingMustHaves).toBe(0);
    expect(none.penalties.multiplier).toBe(1);

    const one = buildMatch(
      candidate({ skills: [] }),
      job({ skills: [{ skillId: "s1", weight: 3, minLevel: null }] }),
      context(),
    );
    expect(one.penalties.missingMustHaves).toBe(1);
    expect(one.penalties.multiplier).toBeCloseTo(0.8);
    // empty candidate skills also zero the skills component:
    // base = (0.15 + 0.2 + 0.1 + 0.1 + 0.1) / 1 = 0.65 → 0.65 × 0.8
    expect(one.score).toBeCloseTo(0.52);

    const two = buildMatch(
      candidate({ skills: [] }),
      job({
        skills: [
          { skillId: "s1", weight: 3, minLevel: null },
          { skillId: "s2", weight: 3, minLevel: null },
        ],
      }),
      context(),
    );
    expect(two.penalties.multiplier).toBeCloseTo(0.64);
    expect(two.score).toBeCloseTo(0.65 * 0.64);
  });

  it("does not count a present-but-below-level must-have as missing", () => {
    const result = buildMatch(
      candidate({ skills: [{ skillId: "s1", level: "novice" }] }),
      job({ skills: [{ skillId: "s1", weight: 3, minLevel: "expert" }] }),
      context(),
    );
    expect(result.penalties.missingMustHaves).toBe(0);
    expect(result.penalties.multiplier).toBe(1);
  });

  it("multiplies ×0.95 for a job without salary", () => {
    const result = buildMatch(
      candidate(),
      job({
        salaryMinMinor: null,
        salaryMaxMinor: null,
        salaryCurrency: null,
        salaryPeriod: null,
        salaryBasis: null,
      }),
      context(),
    );
    expect(result.penalties.noSalaryMultiplier).toBeCloseTo(0.95);
    expect(result.score).toBeCloseTo(0.95);
  });
});

describe("feedback multiplier (10.5)", () => {
  it("applies ×0.9ⁿ with the 0.6 floor", () => {
    expect(
      feedbackMultiplier(
        job(),
        feedback({ hiddenDismissedCategoryCounts: { backend: 1 } }),
      ).multiplier,
    ).toBeCloseTo(0.9);
    expect(
      feedbackMultiplier(
        job(),
        feedback({ hiddenDismissedCategoryCounts: { backend: 3 } }),
      ).multiplier,
    ).toBeCloseTo(0.729);
    expect(
      feedbackMultiplier(
        job(),
        feedback({ hiddenDismissedCategoryCounts: { backend: 30 } }),
      ).multiplier,
    ).toBeCloseTo(0.6);
    expect(feedbackMultiplier(job(), feedback()).multiplier).toBe(1);
  });

  it("ignores other categories", () => {
    expect(
      feedbackMultiplier(
        job(),
        feedback({ hiddenDismissedCategoryCounts: { frontend: 5 } }),
      ).categoryMultiplier,
    ).toBe(1);
  });

  it("adds +0.03 per repeated skill, capped at ×1.15", () => {
    const repeated = feedbackMultiplier(
      job({ skills: [{ skillId: "s1", weight: 2, minLevel: null }] }),
      feedback({ repeatedSkillIds: ["s1", "s-other"] }),
    );
    expect(repeated.skillBonus).toBeCloseTo(0.03);
    expect(repeated.multiplier).toBeCloseTo(1.03);

    const tenSkills = Array.from({ length: 10 }, (_, i) => ({
      skillId: `s${i}`,
      weight: 1 as const,
      minLevel: null,
    }));
    expect(
      feedbackMultiplier(
        job({ skills: tenSkills }),
        feedback({ repeatedSkillIds: tenSkills.map((s) => s.skillId) }),
      ).multiplier,
    ).toBeCloseTo(1.15);
  });

  it("suggests a profile update at ≥ 3 hides by reason", () => {
    expect(
      feedbackMultiplier(
        job(),
        feedback({ hideReasonCounts: { salary: 3, format: 0, timezone: 0 } }),
      ).suggestProfileUpdate,
    ).toBe("salary");
    expect(
      feedbackMultiplier(
        job(),
        feedback({ hideReasonCounts: { salary: 0, format: 2, timezone: 0 } }),
      ).suggestProfileUpdate,
    ).toBeNull();
    expect(
      feedbackMultiplier(
        job(),
        feedback({ hideReasonCounts: { salary: 5, format: 0, timezone: 3 } }),
      ).suggestProfileUpdate,
    ).toBe("salary");
    expect(
      feedbackMultiplier(
        job(),
        feedback({ hideReasonCounts: { salary: 0, format: 0, timezone: 3 } }),
      ).suggestProfileUpdate,
    ).toBe("timezone");
  });

  it("feeds the final score and breakdown.feedback", () => {
    const result = buildMatch(
      candidate({
        desiredTitles: [],
        categories: [],
        skills: [{ skillId: "s1", level: "advanced" }],
      }),
      job({
        languages: [],
        timezoneRequired: null,
        experienceMin: null,
        salaryMinMinor: BigInt(425000),
        salaryMaxMinor: null, // salary 0.5
        skills: [{ skillId: "s1", weight: 2, minLevel: null }],
      }),
      context({
        feedback: feedback({
          hiddenDismissedCategoryCounts: { backend: 1 }, // ×0.9
          repeatedSkillIds: ["s1"], // ×1.03
        }),
      }),
    );
    // base = (0.35·1 + 0.2·0.5) / 0.55
    expect(result.base).toBeCloseTo(0.45 / 0.55);
    expect(result.feedback.multiplier).toBeCloseTo(0.927);
    expect(result.score).toBeCloseTo((0.45 / 0.55) * 0.927);
    expect(result.shown).toBe(true);
  });
});

describe("scoreCandidate (10.1)", () => {
  it("excludes on hard filters before scoring", () => {
    expect(
      scoreCandidate(candidate(), job({ status: "draft" }), context()),
    ).toEqual({ excluded: true, reason: "not_published" });
    expect(
      scoreCandidate(
        candidate({ workFormats: ["hybrid"], country: "DE" }),
        job({ workFormat: "hybrid", locationCountry: "US" }),
        context(),
      ),
    ).toEqual({ excluded: true, reason: "location" });
  });

  it("scores when filters pass", () => {
    const result = scoreCandidate(candidate(), job(), context());
    expect(result).toHaveProperty("score", 1);
  });
});

describe("explain and toPublicMatch (10.7, D30, 5.3)", () => {
  function mixedResult() {
    return buildMatch(
      candidate({
        desiredTitles: [], // role → neutral
        categories: [],
        skills: [{ skillId: "s1", level: "advanced" }],
      }),
      job({
        languages: [{ lang: "de", minLevel: "B2" }], // failed (candidate has no de)
        salaryMinMinor: BigInt(425000),
        salaryMaxMinor: null, // partial 0.5
        skills: [{ skillId: "s1", weight: 2, minLevel: null }], // matched
      }),
      context(),
    );
  }

  it("orders matched → partial → neutral → failed", () => {
    const explain = explainMatch(mixedResult());
    expect(explain.map((entry) => entry.verdict)).toEqual([
      "matched",
      "matched",
      "matched",
      "partial",
      "neutral",
      "failed",
    ]);
    expect(explain.map((entry) => entry.criterion)).toEqual([
      "skills",
      "tzOverlap",
      "experience",
      "salary",
      "role",
      "languages",
    ]);
  });

  it("uses explain.* i18n keys with params", () => {
    const explain = explainMatch(mixedResult());
    const salary = explain.find((entry) => entry.criterion === "salary")!;
    expect(salary.detail.key).toBe("explain.salary.partial");
    expect(salary.detail.params.job).toBe("4250 EUR/mo gross");
    const skills = explain.find((entry) => entry.criterion === "skills")!;
    expect(skills.detail.key).toBe("explain.skills.matched");
    expect(skills.detail.params).toEqual({ percent: 100 });
  });

  it("limits the card to 4 entries", () => {
    const entries: ExplainEntry[] = [
      {
        criterion: "skills",
        verdict: "matched",
        detail: { key: "explain.skills.matched", params: {} },
      },
      {
        criterion: "role",
        verdict: "partial",
        detail: { key: "explain.role.partial", params: {} },
      },
      {
        criterion: "salary",
        verdict: "neutral",
        detail: { key: "explain.salary.neutral", params: {} },
      },
      {
        criterion: "tzOverlap",
        verdict: "failed",
        detail: { key: "explain.tzOverlap.failed", params: {} },
      },
      {
        criterion: "experience",
        verdict: "matched",
        detail: { key: "explain.experience.matched", params: {} },
      },
      {
        criterion: "languages",
        verdict: "partial",
        detail: { key: "explain.languages.partial", params: {} },
      },
    ];
    expect(entries).toHaveLength(6);
    expect(toPublicMatch(mixedResult()).explain.length).toBeLessThanOrEqual(4);
  });

  it("publishes only score (2 decimals) and explain", () => {
    const result = buildMatch(
      candidate({
        skills: [
          { skillId: "s1", level: "advanced" },
          { skillId: "s2", level: "intermediate" },
        ],
      }),
      job({
        skills: [
          { skillId: "s1", weight: 2, minLevel: null },
          { skillId: "s2", weight: 2, minLevel: "expert" },
        ],
      }),
      context(),
    );
    // skills (2·1 + 2·0.5)/4 = 0.75, everything else 1 → base 0.9125
    const publicMatch = toPublicMatch(result);
    expect(Object.keys(publicMatch).sort()).toEqual(["explain", "score"]);
    expect(JSON.stringify(publicMatch)).not.toContain("breakdown");
    expect(JSON.stringify(publicMatch)).not.toContain("weight");
    expect(publicMatch.score).toBe(0.91);
  });

  it("rounds the public score to 2 decimals", () => {
    const result = buildMatch(
      candidate({ desiredTitles: [], categories: [] }),
      job({
        languages: [],
        timezoneRequired: "Asia/Kolkata",
        minOverlapHours: 6,
        skills: [{ skillId: "s1", weight: 2, minLevel: null }],
      }),
      context(),
    );
    // Berlin ↔ Kolkata: O = 4.5h, R = 6 → tz 0.75
    // base = (0.35 + 0.2 + 0.1·0.75 + 0.1) / 0.75 = 0.725/0.75
    expect(result.score).toBeCloseTo(0.725 / 0.75);
    expect(toPublicMatch(result).score).toBe(0.97);
  });
});

describe("DoD 6A integration cases (section 22)", () => {
  it("neutral salary does not exclude the job and still scores", () => {
    const result = scoreCandidate(
      candidate({ salaryBasis: "net" }), // gross vs net → salary neutral
      job({ timezoneRequired: null }),
      context(),
    );
    expect(result).toHaveProperty("score");
    const match = result as Exclude<typeof result, { excluded: true }>;
    expect(match.components.salary.result).toEqual({
      neutral: true,
      reason: "basis",
    });
    // active weights: 0.35 + 0.15 + 0.1 + 0.1 = 0.7, all remaining scores 1
    expect(match.base).toBe(1);
    expect(match.score).toBe(1);
  });

  it("DST-desync week Berlin ↔ New York passes and scores tz at 1", () => {
    const march = new Date("2026-03-09T12:00:00Z");
    const result = scoreCandidate(
      candidate(),
      job({ timezoneRequired: "America/New_York" }),
      context({ now: march }),
    );
    const match = result as Exclude<typeof result, { excluded: true }>;
    expect(match.components.tzOverlap.result).toEqual({ score: 1 });
  });

  it("midnight-crossing window lands inside the threshold logic", () => {
    const result = buildMatch(
      candidate({
        timezone: "Asia/Kolkata",
        workHoursStart: "22:00",
        workHoursEnd: "06:00",
      }),
      job({
        timezoneRequired: "Asia/Kolkata",
        workHoursStart: "04:00",
        workHoursEnd: "12:00",
        minOverlapHours: 6,
      }),
      context(),
    );
    // R = max(6, 3) = 6, O = 2h → 2/6 = 1/3
    expect(
      (result.components.tzOverlap.result as { score: number }).score,
    ).toBeCloseTo(1 / 3);
    expect(result.shown).toBe(result.score >= SHOW_THRESHOLD);
  });

  it("uses the exact title similarity passed by the caller", () => {
    const result = buildMatch(
      candidate({ desiredTitles: ["Go Engineer"], categories: [] }),
      job(),
      context({
        titleSimilarity: exactSim({ "Go Engineer|Backend Developer": 0.42 }),
      }),
    );
    expect(
      (result.components.role.result as { score: number }).score,
    ).toBeCloseTo(0.42);
  });
});
