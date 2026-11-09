# INTGETION Matching Service

Matching for INTGETION JOB LIST: scoring candidates against jobs (hard filters, skills, role, salary, time-zone overlap, experience, languages, feedback multipliers) with human explanations, the stored match feed with tabs and cursors, dismissals, and the recalculation queue that scores a job for candidates when it is published.

Runs as its own HTTP process with its own tables and migration. Developed separately; the platform is not wired to it yet. Match cards and the "why it fits" UI stay in the platform.

## Run

```bash
npm install
cp .env.example .env   # fill in values
npm run migrate        # matching tables only
npm run dev            # http://localhost:4100
```

Checks: `npm run typecheck`, `npm test`. Integration tests (including a cached page < 300 ms and a cold page < 1500 ms on 5,000 jobs, and publish → queue → scoring through the real jobs package) run only when `DATABASE_URL` is set.

## How callers talk to it

Every request except `GET /health` needs `Authorization: Bearer <MATCHING_SERVICE_TOKEN>`. Feed routes need `x-user-id`. Answers are `cache-control: no-store`. Errors are `{ "error": { "code", "message", "details?" } }`.

## API

| Method | Path | Who | What |
|---|---|---|---|
| GET | `/health` | — | `{ ok }` |
| GET | `/v1/me/matches?cursor&limit&locale` | candidate | match feed with job cards |
| GET | `/v1/me/match-screen?tab=all\|new\|hidden&cursor&limit&locale` | candidate | the matches screen |
| GET | `/v1/me/matches/:jobId` | candidate | this job's match, or `null` |
| POST | `/v1/me/matches/:jobId/dismiss` | candidate | `{ action: "dismissed", reason? }`; limited per day |
| GET | `/v1/users/:id/matches` | module | stored matches of a person (briefs, assistant) |
| POST | `/v1/jobs/:jobId/match` | jobs | queue a recompute after publishing |
| POST | `/v1/jobs/:jobId/compute` | module | score a job for candidates now |
| POST | `/v1/tasks/run-matching` | scheduler | work the recompute queue |

Jobs asks the platform to queue a recompute today (`/api/internal/jobs/:id/match`); at integration its adapter points to `POST /v1/jobs/:jobId/match` here.

## What it calls

| Service | Calls |
|---|---|
| candidates | `GET /v1/candidates/:id/exists` |
| jobs | `POST /v1/jobs/by-ids`, `GET /v1/jobs/:id` (as the viewer) |
| platform (`PLATFORM_URL`, `PLATFORM_CALLBACK_TOKEN`) | `POST /api/internal/matching/job-feedback` (`{ userId, jobId, companyId, action, reason }`) until feedback is extracted |

## Data

Tables owned by matching: `matching_results`, `matching_jobs`. One migration, `migrations/0012_matching.sql`, generated from a schema dump of a database migrated to the latest platform state; a dump of the result matches the platform exactly. On a live database it changes nothing; checked against a non-superuser owner with rows present.

Scoring reads many tables in one pass (never writes them): jobs, skills and languages of jobs, FX rates (jobs), candidate profile, skills and preferences (candidates), applications (applications), shared profiles (users), companies, and `user_job_feedback` / `saved_jobs` (feedback). Tables of extracted modules come from their `./db` exports, so the column definitions are the owners'. CI builds them from the real migrations of companies, jobs, candidates and applications (`test/sql/pre/`), plus feedback tables from a platform dump, and the ingestion tables after the migration (`test/sql/post/`).

`HIDE_REASONS` is a copy of the platform's feedback rule list until feedback moves out.

## Packages inside

- `.` — feed, compute, recalc, explain, `setMatchingPorts`
- `./score` — pure scoring (no database)
- `./ports` — `setMatchingPorts()`
- `./server` — `createApp()` HTTP handler

Depends on `@intgetion/kit` (v0.3.1), `@intgetion/taxonomy` (v0.3.0) and, for table definitions and types, `@intgetion/jobs`, `@intgetion/candidates`, `@intgetion/applications`, `@intgetion/users` (v0.1.1) by git tag.
