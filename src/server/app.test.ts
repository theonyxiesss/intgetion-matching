import { beforeEach, describe, expect, it, vi } from "vitest";

const JOB = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

const service = vi.hoisted(() => ({
  listMatchPage: vi.fn(async () => ({ items: [], nextCursor: null })),
  dismissMatch: vi.fn(async () => {}),
  enqueueMatchJob: vi.fn(async () => {}),
}));
vi.mock("../modules/matching/service", async (orig) => ({
  ...(await orig<typeof import("../modules/matching/service")>()),
  ...service,
}));

const { createApp } = await import("./app");
const { httpMatchingPorts } = await import("./remote-ports");
const TOKEN = "test-matching-token";
const handle = createApp({ serviceToken: TOKEN });

function call(path: string, init: RequestInit & { user?: string } = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${TOKEN}`);
  if (init.user) headers.set("x-user-id", init.user);
  return handle(new Request(`http://matching${path}`, { ...init, headers }));
}

beforeEach(() => vi.clearAllMocks());

describe("matching service HTTP", () => {
  it("refuses a wrong token and needs the person for the feed", async () => {
    const refused = await handle(new Request("http://matching/v1/me/matches", { headers: { authorization: "Bearer x" } }));
    expect(refused.status).toBe(401);
    expect((await call("/v1/me/matches")).status).toBe(401);
  });

  it("bounds the page size and passes the locale", async () => {
    expect((await call("/v1/me/matches?limit=9999", { user: USER })).status).toBe(400);
    await call("/v1/me/matches?limit=10&locale=ru", { user: USER });
    expect(service.listMatchPage).toHaveBeenCalledWith(USER, { cursor: undefined, limit: 10, locale: "ru" });
  });

  it("accepts only a known dismiss reason", async () => {
    const path = `/v1/me/matches/${JOB}/dismiss`;
    const bad = await call(path, { method: "POST", user: USER, body: JSON.stringify({ action: "dismissed", reason: "boring" }) });
    expect(bad.status).toBe(400);
    const ok = await call(path, { method: "POST", user: USER, body: JSON.stringify({ action: "dismissed", reason: "salary" }) });
    expect(ok.status).toBe(200);
    expect(service.dismissMatch).toHaveBeenCalledWith(USER, JOB, "salary");
  });

  it("queues a recompute for jobs", async () => {
    expect((await call(`/v1/jobs/${JOB}/match`, { method: "POST" })).status).toBe(200);
    expect(service.enqueueMatchJob).toHaveBeenCalledWith(JOB);
  });
});

describe("matching remote ports", () => {
  it("asks candidates and jobs with their tokens and maps a missing job to null", async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.includes("/exists") ? Response.json({ exists: true }) : new Response(null, { status: 404 }),
    );
    const ports = httpMatchingPorts({
      candidates: { url: "https://candidates.test", token: "c" },
      jobs: { url: "https://jobs.test", token: "j" },
      platform: { url: "https://platform.test", token: "p" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(ports.hasCandidateProfile(USER)).resolves.toBe(true);
    await expect(ports.getJobForPublic(JOB, { userId: USER })).resolves.toBeNull();
    await expect(ports.listPublicJobsByIds([], "en")).resolves.toEqual([]);
    const [, init] = fetchImpl.mock.calls[1] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["x-user-id"]).toBe(USER);
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer j");
  });
});
