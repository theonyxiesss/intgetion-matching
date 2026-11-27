import { beforeEach, describe, expect, it, vi } from "vitest";
import { ALGO_VERSION } from "../score/assemble";
import { emptyFeedback } from "../score/types";
import { candidate, NOW } from "./builders";

const J_KEEP = "00000000-0000-4000-8000-0000000000a1";
const J_HIDDEN = "00000000-0000-4000-8000-0000000000a2";
const J_CLOSED = "00000000-0000-4000-8000-0000000000a3";
const J_CO_HIDDEN = "00000000-0000-4000-8000-0000000000a4";

const state = vi.hoisted(() => ({
  feedback: null as unknown,
  publicJobs: [] as { id: string; companyId: string }[],
}));

vi.mock("../repo/matching-repo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../repo/matching-repo")>()),
  prefilterJobIds: vi.fn(),
  readFeedback: vi.fn(async () => state.feedback),
  listDismissedJobIds: vi.fn(async () => []),
  readJobs: vi.fn(async () => []),
  readFxRates: vi.fn(async () => []),
  readProfile: vi.fn(),
  readStoredMatches: vi.fn(),
  replaceUserResults: vi.fn(),
}));

import {
  prefilterJobIds,
  readFeedback,
  readProfile,
  readStoredMatches,
  replaceUserResults,
} from "../repo/matching-repo";
import { setMatchingPorts } from "../../../ports";
import { getMatches } from "../service/compute";
import { listMatchPage, loadMatchScreen, matchForJob } from "../service/feed";

const stored = (jobId: string, score: number) => ({
  jobId,
  score,
  explain: [],
  lowData: false,
  computedAt: new Date(NOW.getTime() - 60 * 60 * 1000),
  algoVersion: ALGO_VERSION,
});

describe("feed read path with a fresh 24h cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.feedback = emptyFeedback();
    // J_CLOSED is stored but the public lookup no longer returns it.
    state.publicJobs = [
      { id: J_KEEP, companyId: "c1" },
      { id: J_HIDDEN, companyId: "c1" },
      { id: J_CO_HIDDEN, companyId: "c-hidden" },
    ];
    vi.mocked(readProfile).mockResolvedValue({
      candidate: candidate(),
      updatedAt: new Date(NOW.getTime() - 48 * 60 * 60 * 1000),
    } as never);
    vi.mocked(readStoredMatches).mockResolvedValue([
      stored(J_KEEP, 0.9),
      stored(J_HIDDEN, 0.8),
      stored(J_CLOSED, 0.7),
      stored(J_CO_HIDDEN, 0.6),
    ] as never);
    setMatchingPorts({
      hasCandidateProfile: async () => true,
      listPublicJobsByIds: async (ids) =>
        state.publicJobs
          .filter((job) => ids.includes(job.id))
          .map((job) => ({
            id: job.id,
            publishedAt: null,
            company: { id: job.companyId },
          })) as never,
      getJobForPublic: async () => null,
      recordJobFeedback: async () => undefined,
    });
  });

  const input = { limit: 50, locale: "en", now: NOW };

  it("omits a job that closed after the stored calculation, without recomputing", async () => {
    const page = await listMatchPage("u1", input);
    expect(page.items.map((card) => card.job.id)).not.toContain(J_CLOSED);
    const screen = await loadMatchScreen("u1", { ...input, tab: "all" });
    expect(screen.items.map((card) => card.job.id)).not.toContain(J_CLOSED);
    expect(prefilterJobIds).not.toHaveBeenCalled();
    expect(replaceUserResults).not.toHaveBeenCalled();
  });

  it("getMatches serves the SQL-filtered stored rows as is, without reading feedback", async () => {
    // readStoredMatches filters hidden, hidden-company, applied and closed
    // jobs in SQL; on a cache hit getMatches adds no query of its own.
    const list = await getMatches("u1", { now: NOW });
    expect(list.items.map((item) => item.jobId)).toEqual([
      J_KEEP,
      J_HIDDEN,
      J_CLOSED,
      J_CO_HIDDEN,
    ]);
    expect(readStoredMatches).toHaveBeenCalledWith("u1");
    expect(readFeedback).not.toHaveBeenCalled();
    expect(prefilterJobIds).not.toHaveBeenCalled();
    expect(replaceUserResults).not.toHaveBeenCalled();
  });

  it("matchForJob reads no feedback on a cache hit", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    try {
      expect((await matchForJob("u1", J_KEEP))?.jobId).toBe(J_KEEP);
    } finally {
      vi.useRealTimers();
    }
    expect(readFeedback).not.toHaveBeenCalled();
  });

  it("reads feedback once on a stale cache, reusing the one passed in", async () => {
    vi.mocked(readStoredMatches).mockResolvedValue([] as never);
    vi.mocked(prefilterJobIds).mockResolvedValue([]);
    await getMatches("u1", { now: NOW, feedback: emptyFeedback() as never });
    expect(readFeedback).not.toHaveBeenCalled();
    expect(replaceUserResults).toHaveBeenCalledTimes(1);
    await getMatches("u1", { now: NOW });
    expect(readFeedback).toHaveBeenCalledTimes(1);
    // The feed reads feedback for hints and hands it down: one read in total.
    vi.mocked(readFeedback).mockClear();
    await listMatchPage("u1", input);
    expect(readFeedback).toHaveBeenCalledTimes(1);
  });
});
