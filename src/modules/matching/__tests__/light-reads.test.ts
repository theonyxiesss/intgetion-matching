import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyFeedback } from "../score/types";
import { candidate, NOW } from "./builders";

const repo = vi.hoisted(() => ({
  jobs: [] as unknown[],
  readJobs: vi.fn(),
}));

vi.mock("../repo/matching-repo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../repo/matching-repo")>()),
  prefilterCandidateIds: vi.fn(),
  prefilterJobIds: vi.fn(async () => repo.jobs.map(() => "x")),
  readCompanyVisible: vi.fn(),
  readFeedback: vi.fn(async () => emptyFeedback()),
  readFxRates: vi.fn(async () => []),
  readJobs: repo.readJobs,
  readProfile: vi.fn(),
  readStoredMatches: vi.fn(),
  readTitleSimilarities: vi.fn(),
  replaceUserResults: vi.fn(async () => undefined),
  writeJobResults: vi.fn(),
}));

import {
  JOB_SCORING_COLUMNS,
  jobRowToScoring,
  type JobScoringRow,
} from "../repo/matching-repo";
import { readProfile } from "../repo/matching-repo";
import { computeMatches } from "../service/compute";

const light = (id: string, title: string): JobScoringRow =>
  ({
    id,
    companyId: "c1",
    title,
    category: "backend",
    sectors: [],
    seniority: null,
    status: "published",
    workFormat: "remote",
    employmentType: "full_time",
    experienceMin: 3,
    experienceMax: null,
    locationCountry: "DE ",
    countryRestrictions: null,
    timezoneRequired: "Europe/Berlin",
    workHoursStart: null,
    workHoursEnd: null,
    minOverlapHours: 3,
    salaryMin: BigInt(600000),
    salaryMax: BigInt(800000),
    salaryCurrency: "EUR",
    salaryPeriod: "month",
    salaryBasis: "gross",
  }) as JobScoringRow;

const full = (row: JobScoringRow) => ({
  ...row,
  description: "A long description that scoring must never depend on.",
  fts: "'backend':1",
  applicationMethod: "internal",
});

const lightRows = [light("j1", "Backend Developer"), light("j2", "Designer")];

function jobsFrom(rows: object[]) {
  return rows.map((row) => ({
    titleSimilarity: 0.5,
    job: jobRowToScoring(row as JobScoringRow, [], []),
  }));
}

describe("light job reads", () => {
  beforeEach(() => {
    vi.mocked(readProfile).mockResolvedValue({
      candidate: candidate(),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    } as never);
  });

  it("selects exactly the scoring columns and not description or fts", () => {
    expect(Object.keys(JOB_SCORING_COLUMNS).sort()).toEqual(
      [
        "id",
        "companyId",
        "title",
        "category",
        "sectors",
        "seniority",
        "status",
        "workFormat",
        "employmentType",
        "experienceMin",
        "experienceMax",
        "locationCountry",
        "countryRestrictions",
        "timezoneRequired",
        "workHoursStart",
        "workHoursEnd",
        "minOverlapHours",
        "salaryMin",
        "salaryMax",
        "salaryCurrency",
        "salaryPeriod",
        "salaryBasis",
      ].sort(),
    );
    expect(JOB_SCORING_COLUMNS).not.toHaveProperty("description");
    expect(JOB_SCORING_COLUMNS).not.toHaveProperty("fts");
  });

  it("maps a light row and a full row to the same scoring input", () => {
    for (const row of lightRows) {
      expect(jobRowToScoring(full(row) as JobScoringRow, [], [])).toEqual(
        jobRowToScoring(row, [], []),
      );
    }
  });

  it("produces the same (jobId, score, explain) from light and full rows", async () => {
    repo.jobs = lightRows;
    repo.readJobs.mockResolvedValueOnce(jobsFrom(lightRows));
    const fromLight = await computeMatches("u1", { now: NOW });
    repo.readJobs.mockResolvedValueOnce(jobsFrom(lightRows.map(full)));
    const fromFull = await computeMatches("u1", { now: NOW });
    expect(fromLight.items.length).toBeGreaterThan(0);
    expect(fromLight).toEqual(fromFull);
  });
});
