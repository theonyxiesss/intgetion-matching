import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@intgetion/kit";
import { getJobForPublic, listPublicJobsByIds, setJobsPorts, transitionOwnedJob } from "@intgetion/jobs";
import { deleteUserResults } from "./repo/matching-repo";
import {
  claimMatchJob,
  dismissMatch,
  enqueueMatchJob,
  getMatches,
  listMatchPage,
  resetComputeCount,
  runMatchingCron,
  takeComputeCount,
  setMatchingPorts,
} from "./service";

async function recordJobFeedback(input: {
  userId: string;
  jobId: string;
  companyId: string | null;
  action: string;
  reason?: string | null;
}) {
  await getDb().execute(sql`
    insert into public.user_job_feedback (user_id, job_id, company_id, action, reason)
    values (${input.userId}, ${input.jobId}, ${input.companyId}, ${input.action}, ${input.reason ?? null})
  `);
}

setMatchingPorts({
  hasCandidateProfile: async (id) => {
    const rows = await getDb().execute<{ n: number }>(
      sql`select count(*)::int as n from public.candidate_profiles where user_id = ${id}`,
    );
    return Number(rows[0]?.n) > 0;
  },
  listPublicJobsByIds: (ids, locale) => listPublicJobsByIds(ids, locale),
  getJobForPublic: (jobId, viewer) => getJobForPublic(jobId, viewer),
  recordJobFeedback: (input) => recordJobFeedback(input),
});

setJobsPorts({
  activeUser: async (id) => ({ id, platformRole: "admin" }),
  rateLimit: async () => {},
  enqueueModeration: async () => {},
  normalizeSkill: async (raw) => ({ result: "suggested", suggestionId: randomUUID(), normalized: raw, occurrences: 1 }),
  extractSkillIds: async () => [],
  findMemberRole: async () => "owner",
  companiesForUser: async () => [],
  promotedHireJobIds: async () => [],
  companyHasActiveTeam: async () => false,
  activeCandidateIds: async () => [],
  enqueueMatchJob: (jobId) => enqueueMatchJob(jobId),
  notify: async () => {},
  submitToIndexNow: async () => {},
});

const userId = randomUUID();
const ownerId = randomUUID();
const companyId = randomUUID();
const hiddenCompanyId = randomUUID();
const skillId = randomUUID();
const jobA = randomUUID();
const jobB = randomUUID();
const hiddenJob = randomUUID();
const draftJob = randomUUID();
const queueJob = randomUUID();
const retryJob = randomUUID();
const perfUser = randomUUID();
const perfCompany = randomUUID();
const description =
  "Integration matching role description long enough for the jobs table check.";

function requireLoopback(): void {
  const dbUrl = process.env.DATABASE_URL;
  if (
    !dbUrl ||
    !["localhost", "127.0.0.1", "::1", "[::1]"].includes(
      new URL(dbUrl).hostname,
    )
  ) {
    throw new Error("6B integration tests require a loopback database");
  }
}

async function insertJob(input: {
  id: string;
  companyId: string;
  title: string;
  status?: string;
  category?: string;
}): Promise<void> {
  await getDb().execute(sql`
    insert into public.jobs(
      id, company_id, title, description, category, work_format, employment_type,
      application_method, status, published_at, expires_at,
      salary_min, salary_max, salary_currency, salary_period, salary_basis,
      experience_min, location_country
    ) values (
      ${input.id}, ${input.companyId}, ${input.title}, ${description},
      ${input.category ?? "engineering"}, 'remote', 'full_time', 'internal',
      ${input.status ?? "published"}::job_status,
      case when ${input.status ?? "published"} = 'published' then now() else null end,
      case when ${input.status ?? "published"} = 'published' then now() + interval '30 days' else null end,
      500000, 700000, 'EUR', 'month', 'gross', 3, 'DE'
    )
  `);
  await getDb().execute(sql`
    insert into public.job_skills(job_id, skill_id, weight, min_level)
    values (${input.id}, ${skillId}, 2, 'intermediate')
  `);
}

beforeAll(async () => {
  requireLoopback();
  const db = getDb();
  await db.execute(sql`
    insert into public.users(id, auth_uid, terms_accepted_at, terms_version)
    values
      (${userId}, ${randomUUID()}, now(), '6b'),
      (${ownerId}, ${randomUUID()}, now(), '6b'),
      (${perfUser}, ${randomUUID()}, now(), '6b')
  `);
  await db.execute(sql`
    insert into public.companies(id, name, slug, status, created_by) values
      (${companyId}, '6B Match Co', ${`6b-${companyId.slice(0, 8)}`}, 'verified', ${ownerId}),
      (${hiddenCompanyId}, '6B Hidden Co', ${`6b-h-${hiddenCompanyId.slice(0, 8)}`}, 'verified', ${ownerId}),
      (${perfCompany}, '6B Perf Co', ${`6b-p-${perfCompany.slice(0, 8)}`}, 'verified', ${ownerId})
  `);
  await db.execute(sql`
    insert into public.company_members(company_id, user_id, role)
    values (${companyId}, ${ownerId}, 'owner')
  `);
  await db.execute(sql`
    insert into public.skills(id, slug, name_en, name_ru, category)
    values (${skillId}, ${`6b-${skillId.slice(0, 8)}`}, '6B Skill', '6B Skill', 'engineering')
  `);
  for (const id of [userId, perfUser]) {
    await db.execute(sql`
      insert into public.candidate_profiles(
        user_id, work_formats, employment_types,
        work_hours_start, work_hours_end, work_days, experience_years,
        salary_min, salary_currency, salary_period, salary_basis,
        desired_titles, min_overlap_hours
      ) values (
        ${id}, '{remote}', '{full_time}',
        '09:00', '18:00', '{1,2,3,4,5}', 5,
        400000, 'EUR', 'month', 'gross', '{Backend Developer}', 0
      )
    `);
    // Place and time zone live in the shared profile (D509).
    await db.execute(sql`
      insert into public.user_profiles(user_id, country, timezone)
      values (${id}, 'DE', 'Europe/Berlin')
    `);
    await db.execute(sql`
      insert into public.candidate_skills(candidate_id, skill_id, level)
      values (${id}, ${skillId}, 'advanced')
    `);
    await db.execute(sql`
      insert into public.candidate_preferences(user_id, categories)
      values (${id}, '{engineering,design}')
    `);
  }
  await insertJob({ id: jobA, companyId, title: "Backend Developer A" });
  await insertJob({ id: jobB, companyId, title: "Backend Developer B" });
  await insertJob({
    id: hiddenJob,
    companyId: hiddenCompanyId,
    title: "Backend Developer hidden",
  });
  await insertJob({
    id: draftJob,
    companyId,
    title: "Backend Developer draft",
    status: "draft",
  });
  await insertJob({
    id: queueJob,
    companyId,
    title: "Backend Developer queue",
  });
  await insertJob({
    id: retryJob,
    companyId,
    title: "Backend Developer retry",
  });
});

afterAll(async () => {
  const db = getDb();
  await db.execute(
    sql`delete from public.companies where id in (${companyId}, ${hiddenCompanyId}, ${perfCompany})`,
  );
  await db.execute(sql`delete from public.skills where id = ${skillId}`);
  await db.execute(
    sql`delete from public.users where id in (${userId}, ${ownerId}, ${perfUser})`,
  );
});

describe("6B feedback and publish recalc", () => {
  it("dismissed in a category lowers the next job in that category", async () => {
    const before = await getMatches(userId);
    const previous = before.items.find((item) => item.jobId === jobB);
    expect(previous).toBeTruthy();
    await dismissMatch(userId, jobA, "role");
    const after = await getMatches(userId);
    const next = after.items.find((item) => item.jobId === jobB);
    expect(next).toBeTruthy();
    expect(next!.score).toBeLessThan(previous!.score);
    const stored = await getDb().execute<{
      feedback: { categoryMultiplier: number };
    }>(
      sql`
        select breakdown->'feedback' as feedback
        from public.matching_results
        where user_id = ${userId} and job_id = ${jobB}
      `,
    );
    expect(Number(stored[0]?.feedback.categoryMultiplier)).toBeCloseTo(0.9, 5);
  });

  it("hidden_company drops every job of that company", async () => {
    await recordJobFeedback({
      userId,
      jobId: hiddenJob,
      companyId: hiddenCompanyId,
      action: "hidden_company",
    });
    await deleteUserResults(userId);
    const list = await getMatches(userId);
    expect(list.items.some((item) => item.jobId === hiddenJob)).toBe(false);
  });

  it("publishing a job enqueues it and the cron scores it for a candidate", async () => {
    await transitionOwnedJob(draftJob, "publish", ownerId);
    await transitionOwnedJob(draftJob, "approve", ownerId, "admin");
    const queued = await getDb().execute<{ status: string }>(sql`
      select status from public.matching_jobs
      where job_id = ${draftJob} and status in ('pending', 'running')
    `);
    expect(queued.length).toBe(1);
    resetComputeCount();
    const result = await runMatchingCron();
    expect(result.done).toBeGreaterThanOrEqual(1);
    expect(takeComputeCount()).toBeGreaterThanOrEqual(1);
    const matches = await getMatches(userId);
    expect(matches.items.some((item) => item.jobId === draftJob)).toBe(true);
  });

  it("two claims do not take the same row, and a failed run is retried", async () => {
    await enqueueMatchJob(queueJob);
    const first = await claimMatchJob();
    const second = await claimMatchJob();
    expect(first?.jobId).toBe(queueJob);
    expect(second).toBeNull();

    await enqueueMatchJob(retryJob);
    const failed = await runMatchingCron({
      run: async (jobId) => {
        if (jobId === retryJob) throw new Error("boom");
      },
    });
    expect(failed.retried).toBeGreaterThanOrEqual(1);
    const row = await getDb().execute<{ status: string; attempts: number }>(sql`
      select status, attempts from public.matching_jobs
      where job_id = ${retryJob}
      order by created_at desc
      limit 1
    `);
    expect(row[0]?.status).toBe("pending");
    expect(row[0]?.attempts).toBe(1);
  });

  it("two overlapping cron runs score one pending job once", async () => {
    const once = randomUUID();
    await insertJob({ id: once, companyId, title: "Backend Developer once" });
    await enqueueMatchJob(once);
    let runs = 0;
    const run = async (jobId: string) => {
      if (jobId === once) runs += 1;
    };
    await Promise.all([runMatchingCron({ run }), runMatchingCron({ run })]);
    expect(runs).toBe(1);
  });

  it("serves a cached page under 300ms and a cold page under 1500ms on 5k jobs", async () => {
    await getDb().execute(sql`
      insert into public.jobs(
        id, company_id, title, description, category, work_format, employment_type,
        application_method, status, published_at, expires_at,
        salary_min, salary_max, salary_currency, salary_period, salary_basis,
        experience_min, location_country
      )
      select gen_random_uuid(), ${perfCompany}, 'Backend Developer perf', ${description},
        'design', 'remote', 'full_time', 'internal', 'published',
        now(), now() + interval '30 days',
        500000, 700000, 'EUR', 'month', 'gross', 3, 'DE'
      from generate_series(1, 5000)
    `);
    await deleteUserResults(perfUser);
    const coldStarted = performance.now();
    const cold = await listMatchPage(perfUser, { limit: 20, locale: "en" });
    const coldMs = performance.now() - coldStarted;
    expect(cold.items.length).toBeGreaterThan(0);
    expect(coldMs).toBeLessThan(1500);
    const warmStarted = performance.now();
    const warm = await listMatchPage(perfUser, { limit: 20, locale: "en" });
    const warmMs = performance.now() - warmStarted;
    expect(warm.items.length).toBe(cold.items.length);
    expect(warmMs).toBeLessThan(300);
  }, 120_000);
});
