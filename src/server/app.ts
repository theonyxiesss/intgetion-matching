import { z, ZodError } from "zod";
import {
  HttpError,
  httpErrorResponse,
  notFound,
  reportError,
  validationError,
} from "@intgetion/kit";
import * as matching from "../modules/matching/service";
import { dismissMatchInput, matchListLimit, matchListQuery } from "../modules/matching/schemas";
import { isUuid, requireCaller, requireServiceToken } from "./auth";

export type AppConfig = { serviceToken: string };

const MAX_JSON = 8 * 1024;

async function parseBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const text = await request.text();
  if (text.length > MAX_JSON) {
    throw new HttpError(413, "PAYLOAD_TOO_LARGE", "Body too large");
  }
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw validationError({ body: "invalid json" });
  }
  return schema.parse(json);
}

function idParam(value: string | undefined): string {
  if (!value || !isUuid(value)) throw notFound();
  return value;
}

function locale(url: URL): string {
  return url.searchParams.get("locale")?.slice(0, 8) || "en";
}

function pageQuery(url: URL) {
  return matchListQuery.parse({
    cursor: url.searchParams.get("cursor") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });
}

type Route = {
  method: string;
  pattern: RegExp;
  run: (request: Request, params: string[], url: URL) => Promise<unknown>;
};

const routes: Route[] = [
  {
    method: "GET",
    pattern: /^\/v1\/me\/matches$/,
    run: async (request, _params, url) => {
      const { userId } = requireCaller(request);
      const query = pageQuery(url);
      return matching.listMatchPage(userId, {
        cursor: query.cursor,
        limit: matchListLimit(query.limit),
        locale: locale(url),
      });
    },
  },
  {
    method: "GET",
    pattern: /^\/v1\/me\/match-screen$/,
    run: async (request, _params, url) => {
      const { userId } = requireCaller(request);
      const query = pageQuery(url);
      return matching.loadMatchScreen(userId, {
        tab: matching.parseMatchTab(url.searchParams.get("tab") ?? undefined),
        cursor: query.cursor,
        limit: matchListLimit(query.limit),
        locale: locale(url),
      });
    },
  },
  {
    method: "GET",
    pattern: /^\/v1\/me\/matches\/([^/]+)$/,
    run: async (request, [jobId]) => {
      const { userId } = requireCaller(request);
      return { match: await matching.matchForJob(userId, idParam(jobId)) };
    },
  },
  {
    method: "POST",
    pattern: /^\/v1\/me\/matches\/([^/]+)\/dismiss$/,
    run: async (request, [jobId]) => {
      const { userId } = requireCaller(request);
      const id = idParam(jobId);
      const { reason } = await parseBody(request, dismissMatchInput);
      await matching.dismissMatch(userId, id, reason);
      return { ok: true };
    },
  },
  {
    method: "GET",
    pattern: /^\/v1\/users\/([^/]+)\/matches$/,
    run: async (_request, [userId]) => matching.getMatches(idParam(userId)),
  },
  {
    method: "POST",
    pattern: /^\/v1\/jobs\/([^/]+)\/match$/,
    run: async (_request, [jobId]) => {
      await matching.enqueueMatchJob(idParam(jobId));
      return { ok: true };
    },
  },
  {
    method: "POST",
    pattern: /^\/v1\/jobs\/([^/]+)\/compute$/,
    run: async (_request, [jobId]) => matching.computeMatchesForJob(idParam(jobId)),
  },
  {
    method: "POST",
    pattern: /^\/v1\/tasks\/run-matching$/,
    run: async () => ({ ok: true, ...(await matching.runMatchingCron()) }),
  },
];

export function toResponse(error: unknown): Response {
  if (error instanceof HttpError) return httpErrorResponse(error);
  if (error instanceof ZodError) {
    return httpErrorResponse(validationError(error.issues));
  }
  if (error instanceof Error && error.message === "invalid_cursor") {
    return httpErrorResponse(new HttpError(400, "VALIDATION_ERROR", "Invalid page cursor"));
  }
  reportError(error, "matching-service");
  return Response.json(
    { error: { code: "INTERNAL", message: "Internal error" } },
    { status: 500 },
  );
}

export function createApp(config: AppConfig) {
  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/health") {
        return Response.json({ ok: true });
      }
      requireServiceToken(request, config.serviceToken);
      for (const route of routes) {
        if (route.method !== request.method) continue;
        const match = route.pattern.exec(url.pathname);
        if (!match) continue;
        return Response.json(await route.run(request, match.slice(1), url), {
          headers: { "cache-control": "no-store" },
        });
      }
      throw notFound();
    } catch (error) {
      return toResponse(error);
    }
  };
}
