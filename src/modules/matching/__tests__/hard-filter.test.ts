import { describe, expect, it } from "vitest";
import { hardFilter } from "../score/hard-filter";
import type { ScoringContext } from "../score/types";
import { candidate, context, feedback, job, NOW } from "./builders";

function filter(
  candidateOverrides = {},
  jobOverrides = {},
  contextOverrides: Partial<ScoringContext> = {},
) {
  return hardFilter(
    candidate(candidateOverrides),
    job(jobOverrides),
    context(contextOverrides),
  );
}

describe("hardFilter (10.2)", () => {
  it("passes a fully matching pair", () => {
    expect(filter()).toEqual({ pass: true });
  });

  it("1: filters on work_format", () => {
    expect(
      filter({ workFormats: ["remote"] }, { workFormat: "onsite" }),
    ).toEqual({
      pass: false,
      reason: "work_format",
    });
    expect(
      filter({ workFormats: ["onsite"] }, { workFormat: "onsite" }),
    ).toEqual({
      pass: true,
    });
  });

  it("2: filters on country_restrictions, null means whole world", () => {
    expect(
      filter({ country: "DE" }, { countryRestrictions: ["US", "CA"] }),
    ).toEqual({ pass: false, reason: "country_restricted" });
    expect(filter({ country: "US" }, { countryRestrictions: ["US"] })).toEqual({
      pass: true,
    });
    expect(filter({ country: null }, { countryRestrictions: ["US"] })).toEqual({
      pass: false,
      reason: "country_restricted",
    });
    expect(filter({ country: null }, { countryRestrictions: null })).toEqual({
      pass: true,
    });
  });

  it("3: filters on employment_type", () => {
    expect(
      filter(
        { employmentTypes: ["full_time"] },
        { employmentType: "contract" },
      ),
    ).toEqual({ pass: false, reason: "employment_type" });
    expect(
      filter({ employmentTypes: ["contract"] }, { employmentType: "contract" }),
    ).toEqual({ pass: true });
  });

  it("4: hybrid/onsite require the same country", () => {
    expect(
      filter(
        { country: "DE", workFormats: ["hybrid"] },
        { workFormat: "hybrid", locationCountry: "DE" },
      ),
    ).toEqual({ pass: true });
    expect(
      filter(
        { country: "DE", workFormats: ["hybrid"] },
        { workFormat: "hybrid", locationCountry: "US" },
      ),
    ).toEqual({ pass: false, reason: "location" });
    expect(
      filter(
        { country: null, workFormats: ["onsite"] },
        { workFormat: "onsite", locationCountry: "DE" },
      ),
    ).toEqual({ pass: false, reason: "location" });
    // remote has no country requirement
    expect(filter({ country: null }, { workFormat: "remote" })).toEqual({
      pass: true,
    });
  });

  it("5: filters when the average overlap is below min_overlap_hours", () => {
    // Berlin 09:00–18:00 = 08:00–17:00Z; Kolkata 09:00–18:00 = 03:30–12:30Z
    // → 4.5h overlap.
    const tz = { timezoneRequired: "Asia/Kolkata" };
    expect(filter({}, { ...tz, minOverlapHours: 4 })).toEqual({ pass: true });
    expect(filter({}, { ...tz, minOverlapHours: 5 })).toEqual({
      pass: false,
      reason: "tz_overlap",
    });
  });

  it("5 (DoD 6A): Berlin ↔ New York in the DST-desync week still passes", () => {
    // Week of 2026-03-09: US already on DST, EU not yet → 4h overlap.
    const march = new Date("2026-03-09T12:00:00Z");
    expect(
      hardFilter(
        candidate(),
        job({ timezoneRequired: "America/New_York", minOverlapHours: 3 }),
        context({ now: march }),
      ),
    ).toEqual({ pass: true });
  });

  it("6: excludes hidden jobs, hidden companies, active applications and unpublished jobs", () => {
    expect(
      filter({}, {}, { feedback: feedback({ hiddenJobIds: ["j1"] }) }),
    ).toEqual({ pass: false, reason: "hidden_by_user" });
    expect(
      filter({}, {}, { feedback: feedback({ hiddenCompanyIds: ["c1"] }) }),
    ).toEqual({ pass: false, reason: "hidden_by_user" });
    expect(
      filter(
        {},
        {},
        { feedback: feedback({ activeApplicationJobIds: ["j1"] }) },
      ),
    ).toEqual({ pass: false, reason: "already_applied" });
    expect(filter({}, { status: "paused" })).toEqual({
      pass: false,
      reason: "not_published",
    });
  });

  it("currency and gross/net are NOT hard (D4, D5)", () => {
    expect(
      filter(
        { salaryCurrency: "USD", salaryBasis: "net" },
        { salaryCurrency: "EUR", salaryBasis: "gross" },
      ),
    ).toEqual({ pass: true });
  });

  it("runs with NOW from the context", () => {
    expect(context({ now: NOW }).now).toBe(NOW);
  });
});
