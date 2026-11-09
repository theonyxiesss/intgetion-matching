import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { factsForMatching, UNKNOWN_LEVEL } from "../service/shared-facts";
import { tzOverlapComponent } from "../score/components";

describe("job matching reads only the shared profile (D507, D509)", () => {
  it("knows nothing without a shared profile", () => {
    expect(factsForMatching(null)).toEqual({
      country: null,
      timezone: null,
      languages: [],
    });
  });

  it("takes country, time zone and languages from the shared profile", () => {
    expect(
      factsForMatching({
        country: "DE",
        timezone: "Europe/Berlin",
        languages: [
          { code: "de", level: "B2" },
          { code: "fr", level: null },
        ],
      }),
    ).toEqual({
      country: "DE",
      timezone: "Europe/Berlin",
      languages: [
        { lang: "de", level: "B2" },
        { lang: "fr", level: UNKNOWN_LEVEL },
      ],
    });
  });

  it("does not guess a work-hours overlap without a time zone", () => {
    expect(
      tzOverlapComponent({
        candidate: {
          timezone: null,
          workHoursStart: "09:00",
          workHoursEnd: "18:00",
          workDays: [1, 2, 3, 4, 5],
          minOverlapHours: 3,
        },
        job: {
          timezoneRequired: "Europe/Berlin",
          workHoursStart: null,
          workHoursEnd: null,
          minOverlapHours: 3,
        },
        from: new Date("2026-10-21T00:00:00Z"),
      } as Parameters<typeof tzOverlapComponent>[0]),
    ).toEqual({ neutral: true, reason: "no_candidate_timezone" });
  });

  it("filters candidates by the shared country in the database prefilter", () => {
    const repo = readFileSync(
      join(process.cwd(), "src/modules/matching/repo/matching-repo.ts"),
      "utf8",
    );
    expect(repo).toContain(
      "left join public.user_profiles up on up.user_id = p.user_id",
    );
    expect(repo).toContain("up.country = any(j.country_restrictions)");
    expect(repo).not.toMatch(/p\.country/);
    expect(repo).not.toContain("candidateLanguages");
  });
});
