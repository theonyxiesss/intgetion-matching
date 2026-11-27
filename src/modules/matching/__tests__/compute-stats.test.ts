import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyFeedback } from "../score/types";
import { candidate, NOW } from "./builders";

const mocks = vi.hoisted(() => ({
  info: vi.fn(),
}));

vi.mock("@intgetion/kit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@intgetion/kit")>()),
  logger: { info: mocks.info },
}));

vi.mock("../repo/matching-repo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../repo/matching-repo")>()),
  prefilterCandidateIds: vi.fn(),
  prefilterJobIds: vi.fn(async () => ["a", "b", "c"]),
  readCompanyVisible: vi.fn(),
  readFeedback: vi.fn(async () => emptyFeedback()),
  readFxRates: vi.fn(async () => []),
  readJobs: vi.fn(async () => []),
  readProfile: vi.fn(),
  readStoredMatches: vi.fn(),
  readTitleSimilarities: vi.fn(async () => new Map()),
  replaceUserResults: vi.fn(async () => undefined),
  writeJobResults: vi.fn(async () => undefined),
}));

import {
  prefilterCandidateIds,
  readCompanyVisible,
  readProfile,
} from "../repo/matching-repo";
import { computeMatches, computeMatchesForJob } from "../service/compute";

describe("per-call matching cost counters", () => {
  beforeEach(() => {
    mocks.info.mockClear();
    vi.mocked(readProfile).mockResolvedValue({
      candidate: candidate(),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    } as never);
  });

  it("reports prefiltered, jobsRead, written and ms", async () => {
    const result = await computeMatches("u1", { now: NOW });
    expect(result.stats.prefiltered).toBe(3);
    expect(result.stats.jobsRead).toBe(0);
    expect(result.stats.written).toBe(0);
    expect(result.stats.ms).toBeGreaterThanOrEqual(0);
  });

  it("counts jobs read from the repo rows", async () => {
    const repo = await import("../repo/matching-repo");
    vi.mocked(repo.readJobs).mockResolvedValueOnce(
      ["a", "b", "c"].map((id) => ({ id, titleSimilarity: 0, job: {} })) as never,
    );
    const result = await computeMatches("u1", { now: NOW });
    expect(result.stats.prefiltered).toBe(3);
    expect(result.stats.jobsRead).toBe(3);
  });

  it("logs one line per call with only the user id", async () => {
    await computeMatches("u1", { now: NOW });
    expect(mocks.info).toHaveBeenCalledTimes(1);
    expect(mocks.info.mock.calls[0]?.[0]).toMatch(
      /^matching\.compute user=u1 prefiltered=3 jobsRead=0 written=0 ms=\d+$/,
    );
  });

  it("computeMatchesForJob returns considered, written and ms", async () => {
    vi.mocked(readCompanyVisible).mockResolvedValue(true);
    vi.mocked(prefilterCandidateIds).mockResolvedValue([]);
    const result = await computeMatchesForJob("j1", { now: NOW });
    expect(result.considered).toBe(0);
    expect(result.written).toBe(0);
    expect(result.ms).toBeGreaterThanOrEqual(0);
  });
});
