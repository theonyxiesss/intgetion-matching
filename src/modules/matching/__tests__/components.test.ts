import { describe, expect, it } from "vitest";
import {
  experienceComponent,
  hasCompleteJobSalary,
  languagesComponent,
  roleComponent,
  salaryComponent,
  skillsComponent,
  tzOverlapComponent,
} from "../score/components";
import { NoopSemanticProvider, type SemanticProvider } from "../score/semantic";
import { candidate, job, NOW } from "./builders";
import type { FxRate } from "@intgetion/kit";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("skillsComponent (10.3)", () => {
  it("scores Σ w·m / Σ w over levels and weights", () => {
    expect(
      skillsComponent({
        jobSkills: [
          { skillId: "s1", weight: 3, minLevel: "advanced" },
          { skillId: "s2", weight: 1, minLevel: null },
        ],
        candidateSkills: [
          { skillId: "s1", level: "advanced" },
          { skillId: "s2", level: "novice" },
        ],
      }),
    ).toEqual({ score: 1 });
  });

  it("gives 0.5 for a level just below min_level and 0 for absence", () => {
    expect(
      skillsComponent({
        jobSkills: [
          { skillId: "s1", weight: 3, minLevel: "advanced" },
          { skillId: "s2", weight: 1, minLevel: null },
        ],
        candidateSkills: [
          { skillId: "s1", level: "intermediate" },
          { skillId: "s2", level: "novice" },
        ],
      }),
    ).toEqual({ score: (3 * 0.5 + 1 * 1) / 4 });
    expect(
      skillsComponent({
        jobSkills: [
          { skillId: "s1", weight: 3, minLevel: "advanced" },
          { skillId: "s2", weight: 1, minLevel: null },
        ],
        candidateSkills: [{ skillId: "s2", level: "novice" }],
      }),
    ).toEqual({ score: 0.25 });
  });

  it("is neutral when the job lists no skills", () => {
    expect(skillsComponent({ jobSkills: [], candidateSkills: [] })).toEqual({
      neutral: true,
      reason: "no_job_skills",
    });
  });
});

describe("roleComponent (10.3)", () => {
  const base = {
    jobTitle: "Backend Developer",
    jobCategory: "backend",
  };

  it("takes the maximum title similarity", () => {
    expect(
      roleComponent({
        ...base,
        desiredTitles: ["Frontend", "Backend Developer"],
        categories: [],
        titleSimilarity: (a, b) => (a === b ? 0.9 : 0),
      }),
    ).toEqual({ score: 0.9 });
  });

  it("floors at 0.7 when the job category is in preferences", () => {
    expect(
      roleComponent({
        ...base,
        desiredTitles: ["Something Else"],
        categories: ["backend"],
        titleSimilarity: () => 0.2,
      }),
    ).toEqual({ score: 0.7 });
    expect(
      roleComponent({
        ...base,
        desiredTitles: ["Something Else"],
        categories: ["backend"],
        titleSimilarity: () => 0.9,
      }),
    ).toEqual({ score: 0.9 });
  });

  it("floors at 0.7 when a sector overlaps and titles are empty", () => {
    expect(
      roleComponent({
        ...base,
        jobSectors: ["web3"],
        desiredTitles: [],
        categories: [],
        candidateSectors: ["web3", "fintech"],
        titleSimilarity: () => 0,
      }),
    ).toEqual({ score: 0.7 });
  });

  it("is neutral without desired titles and categories", () => {
    expect(
      roleComponent({
        ...base,
        desiredTitles: [],
        categories: [],
        titleSimilarity: () => 1,
      }),
    ).toEqual({ neutral: true, reason: "no_preferences" });
  });
});

describe("salaryComponent (10.4, D4, D5)", () => {
  const fxRates: FxRate[] = [
    { currency: "EUR", rateToUsd: "1.10000000", asOf: NOW },
  ];

  it("returns 1 when the job offers at least the candidate minimum", () => {
    expect(
      salaryComponent({
        job: job(),
        candidate: candidate(),
        fxRates,
        now: NOW,
      }),
    ).toEqual({ score: 1 });
  });

  it("computes partial scores from the J/C ratio", () => {
    expect(
      salaryComponent({
        job: job({ salaryMinMinor: BigInt(425000), salaryMaxMinor: null }),
        candidate: candidate(),
        fxRates,
        now: NOW,
      }),
    ).toEqual({ score: 0.5 }); // J/C = 0.85
    expect(
      salaryComponent({
        job: job({ salaryMinMinor: BigInt(350000), salaryMaxMinor: null }),
        candidate: candidate(),
        fxRates,
        now: NOW,
      }),
    ).toEqual({ score: 0 }); // J/C = 0.7
  });

  it("is neutral on hour vs month and on gross vs net, job stays in the pool", () => {
    expect(
      salaryComponent({
        job: job({ salaryPeriod: "hour" }),
        candidate: candidate(),
        fxRates,
        now: NOW,
      }),
    ).toEqual({ neutral: true, reason: "period" });
    expect(
      salaryComponent({
        job: job(),
        candidate: candidate({ salaryBasis: "net" }),
        fxRates,
        now: NOW,
      }),
    ).toEqual({ neutral: true, reason: "basis" });
  });

  it("is neutral when a rate is missing or stale (7 days fresh, +1 ms stale)", () => {
    const gbpJob = job({
      salaryCurrency: "GBP",
      salaryMinMinor: BigInt(500000),
      salaryMaxMinor: null,
    });
    const eurCandidate = candidate();
    expect(
      salaryComponent({
        job: gbpJob,
        candidate: eurCandidate,
        fxRates: [],
        now: NOW,
      }),
    ).toEqual({ neutral: true, reason: "fx_missing" });
    expect(
      salaryComponent({
        job: gbpJob,
        candidate: eurCandidate,
        fxRates: [
          {
            currency: "GBP",
            rateToUsd: "1.27000000",
            asOf: new Date(+NOW - 7 * DAY_MS),
          },
          { currency: "EUR", rateToUsd: "1.10000000", asOf: NOW },
        ],
        now: NOW,
      }),
    ).toEqual({ score: 1 }); // exactly 7 days is still fresh
    expect(
      salaryComponent({
        job: gbpJob,
        candidate: eurCandidate,
        fxRates: [
          {
            currency: "GBP",
            rateToUsd: "1.27000000",
            asOf: new Date(+NOW - (7 * DAY_MS + 1)),
          },
          { currency: "EUR", rateToUsd: "1.10000000", asOf: NOW },
        ],
        now: NOW,
      }),
    ).toEqual({ neutral: true, reason: "fx_stale" });
  });

  it("is neutral when either side has no salary data", () => {
    expect(
      salaryComponent({
        job: job({
          salaryMinMinor: null,
          salaryMaxMinor: null,
          salaryCurrency: null,
          salaryPeriod: null,
          salaryBasis: null,
        }),
        candidate: candidate(),
        fxRates,
        now: NOW,
      }),
    ).toEqual({ neutral: true, reason: "no_job_salary" });
    expect(
      salaryComponent({
        job: job(),
        candidate: candidate({ salaryMinMinor: null }),
        fxRates,
        now: NOW,
      }),
    ).toEqual({ neutral: true, reason: "no_candidate_salary" });
    expect(
      salaryComponent({
        job: job(),
        candidate: candidate({ salaryCurrency: null }),
        fxRates,
        now: NOW,
      }),
    ).toEqual({ neutral: true, reason: "no_candidate_salary" });
    expect(
      salaryComponent({
        job: job(),
        candidate: candidate({ salaryMinMinor: BigInt(0) }),
        fxRates,
        now: NOW,
      }),
    ).toEqual({ neutral: true, reason: "candidate_salary_zero" });
  });

  it("marks job salary completeness", () => {
    expect(hasCompleteJobSalary(job())).toBe(true);
    expect(
      hasCompleteJobSalary(job({ salaryMinMinor: null, salaryMaxMinor: null })),
    ).toBe(false);
    expect(hasCompleteJobSalary(job({ salaryCurrency: null }))).toBe(false);
  });

  it("compares two currencies through USD", () => {
    expect(
      salaryComponent({
        job: job({
          salaryMinMinor: BigInt(110000),
          salaryMaxMinor: null,
          salaryCurrency: "USD",
        }),
        candidate: candidate({
          salaryMinMinor: BigInt(100000),
          salaryCurrency: "EUR",
        }),
        fxRates: [
          { currency: "EUR", rateToUsd: "1.10000000", asOf: NOW },
          { currency: "USD", rateToUsd: "1.00000000", asOf: NOW },
        ],
        now: NOW,
      }),
    ).toEqual({ score: 1 }); // 1100 USD ≥ 1100 USD
  });
});

describe("tzOverlapComponent (10.3, 10.6)", () => {
  it("caps at 1 when the overlap covers the requirement", () => {
    // Berlin 08:00–17:00Z ∩ Kolkata 03:30–12:30Z = 4.5h, R = 3
    expect(
      tzOverlapComponent({
        candidate: candidate(),
        job: job({ timezoneRequired: "Asia/Kolkata", minOverlapHours: 3 }),
        from: NOW,
      }),
    ).toEqual({ score: 1 });
  });

  it("scales below 1 when the overlap is smaller than R", () => {
    expect(
      tzOverlapComponent({
        candidate: candidate(),
        job: job({ timezoneRequired: "Asia/Kolkata", minOverlapHours: 6 }),
        from: NOW,
      }),
    ).toEqual({ score: 4.5 / 6 });
  });

  it("is neutral without timezone_required", () => {
    expect(
      tzOverlapComponent({
        candidate: candidate(),
        job: job({ timezoneRequired: null }),
        from: NOW,
      }),
    ).toEqual({ neutral: true, reason: "no_timezone_required" });
  });

  it("DoD 6A: DST-desync week Berlin ↔ New York gives 4h", () => {
    const march = new Date("2026-03-09T12:00:00Z");
    expect(
      tzOverlapComponent({
        candidate: candidate(),
        job: job({ timezoneRequired: "America/New_York", minOverlapHours: 3 }),
        from: march,
      }),
    ).toEqual({ score: 1 }); // 4h ≥ R = 3
    const october = new Date("2026-10-26T12:00:00Z");
    // The 14-day average straddles the US fall-back (2026-11-01):
    // 5 days × 4h (NY on EDT) + 5 days × 3h (NY on EST) = 3.5h average,
    // R = max(4, 3) = 4 → 3.5/4.
    expect(
      tzOverlapComponent({
        candidate: candidate(),
        job: job({ timezoneRequired: "America/New_York", minOverlapHours: 4 }),
        from: october,
      }),
    ).toEqual({ score: 3.5 / 4 });
  });

  it("DoD 6A: midnight-crossing window counts the next job day", () => {
    // Candidate 22:00–06:00 IST vs job 04:00–12:00 IST → 2h via the next day.
    expect(
      tzOverlapComponent({
        candidate: candidate({
          timezone: "Asia/Kolkata",
          workHoursStart: "22:00",
          workHoursEnd: "06:00",
        }),
        job: job({
          timezoneRequired: "Asia/Kolkata",
          workHoursStart: "04:00",
          workHoursEnd: "12:00",
        }),
        from: NOW,
      }),
    ).toEqual({ score: 2 / 3 });
  });
});

describe("experienceComponent (10.3)", () => {
  const call = (min: number | null, max: number | null, years: number | null) =>
    experienceComponent({
      jobExperienceMin: min,
      jobExperienceMax: max,
      candidateExperienceYears: years,
    });

  it("scores 1 at or above the minimum", () => {
    expect(call(3, null, 3)).toEqual({ score: 1 });
    expect(call(3, null, 10)).toEqual({ score: 1 });
  });

  it("scores 0.5 one year below and 0 further below", () => {
    expect(call(3, null, 2)).toEqual({ score: 0.5 });
    expect(call(3, null, 1)).toEqual({ score: 0 });
  });

  it("caps overqualified candidates at 0.7 beyond max + 3", () => {
    expect(call(2, 5, 8)).toEqual({ score: 1 });
    expect(call(2, 5, 9)).toEqual({ score: 0.7 });
  });

  it("is neutral without experience_min", () => {
    expect(call(null, null, 5)).toEqual({
      neutral: true,
      reason: "no_experience_requirement",
    });
  });

  it("treats a missing candidate value as 0 years (D92)", () => {
    expect(call(3, null, null)).toEqual({ score: 0 });
  });
});

describe("languagesComponent (10.3)", () => {
  it("scores 1 at or above the required CEFR level", () => {
    expect(
      languagesComponent({
        jobLanguages: [{ lang: "en", minLevel: "B2" }],
        candidateLanguages: [{ lang: "en", level: "C1" }],
      }),
    ).toEqual({ score: 1 });
  });

  it("scores 0.5 exactly one CEFR step below and 0 further below or absent", () => {
    expect(
      languagesComponent({
        jobLanguages: [{ lang: "en", minLevel: "B2" }],
        candidateLanguages: [{ lang: "en", level: "B1" }],
      }),
    ).toEqual({ score: 0.5 });
    expect(
      languagesComponent({
        jobLanguages: [{ lang: "en", minLevel: "B2" }],
        candidateLanguages: [{ lang: "en", level: "A2" }],
      }),
    ).toEqual({ score: 0 });
    expect(
      languagesComponent({
        jobLanguages: [{ lang: "en", minLevel: "B2" }],
        candidateLanguages: [{ lang: "de", level: "C2" }],
      }),
    ).toEqual({ score: 0 });
  });

  it("averages over required languages and is neutral without requirements", () => {
    expect(
      languagesComponent({
        jobLanguages: [
          { lang: "en", minLevel: "B2" },
          { lang: "de", minLevel: "B2" },
        ],
        candidateLanguages: [{ lang: "en", level: "C1" }],
      }),
    ).toEqual({ score: 0.5 });
    expect(
      languagesComponent({ jobLanguages: [], candidateLanguages: [] }),
    ).toEqual({ neutral: true, reason: "no_job_languages" });
  });
});

describe("NoopSemanticProvider (10.9, D11)", () => {
  it("reports the component unused", async () => {
    const provider: SemanticProvider = new NoopSemanticProvider();
    expect(await provider.similarity("a", "b")).toBeNull();
  });
});
