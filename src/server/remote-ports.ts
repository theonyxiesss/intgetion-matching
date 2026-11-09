import type { MatchingPorts, PublicJob } from "../ports";

export type Endpoint = { url: string; token: string };

export type RemoteConfig = {
  candidates: Endpoint;
  jobs: Endpoint;
  platform: Endpoint;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

/** Ports answered by candidates and jobs, and by the platform for feedback until it moves out. */
export function httpMatchingPorts(config: RemoteConfig): MatchingPorts {
  const doFetch = config.fetchImpl ?? fetch;
  const timeoutMs = config.timeoutMs ?? 5000;
  const json = { "content-type": "application/json" };

  async function call(to: Endpoint, path: string, init: RequestInit = {}) {
    return doFetch(`${to.url.replace(/\/+$/, "")}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${to.token}`, ...init.headers },
      signal: AbortSignal.timeout(timeoutMs),
    });
  }
  async function ok(to: Endpoint, path: string, init?: RequestInit) {
    const response = await call(to, path, init);
    if (!response.ok) throw new Error(`${path} answered ${response.status}`);
    return response;
  }
  const enc = encodeURIComponent;

  return {
    async hasCandidateProfile(userId) {
      const response = await ok(config.candidates, `/v1/candidates/${enc(userId)}/exists`);
      return ((await response.json()) as { exists: boolean }).exists;
    },
    async listPublicJobsByIds(ids, locale) {
      if (ids.length === 0) return [];
      const response = await ok(config.jobs, "/v1/jobs/by-ids", {
        method: "POST",
        headers: json,
        body: JSON.stringify({ ids, locale }),
      });
      return ((await response.json()) as { jobs: PublicJob[] }).jobs;
    },
    async getJobForPublic(jobId, viewer) {
      const response = await call(config.jobs, `/v1/jobs/${enc(jobId)}`, {
        headers: { "x-user-id": viewer.userId },
      });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`job answered ${response.status}`);
      return ((await response.json()) as { job: PublicJob }).job;
    },
    async recordJobFeedback(input) {
      await ok(config.platform, "/api/internal/matching/job-feedback", {
        method: "POST",
        headers: json,
        body: JSON.stringify(input),
      });
    },
  };
}
