import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@intgetion/kit";
import {
  computeMatches,
  computeMatchesForJob,
  getMatches,
  resetComputeCount,
  takeComputeCount,
} from "./service";

const userId = randomUUID();
const otherId = randomUUID();
const companyId = randomUUID();
const hiddenCompanyId = randomUUID();
const suspendedCompanyId = randomUUID();
const skillId = randomUUID();
const matchJobId = randomUUID();
const noSalaryJobId = randomUUID();
const grossJobId = randomUUID();
const tzJobId = randomUUID();
const nightJobId = randomUUID();
const dayJobId = randomUUID();
const removedJobId = randomUUID();
const suspendedJobId = randomUUID();
const hiddenJobId = randomUUID();
const categoryJobId = randomUUID();
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
    throw new Error("6A integration tests require a loopback database");
  }
}

async function insertJob(input: {
  id: string;
  companyId: string;
  title: string;
  status?: string;
  salaryMin?: bigint | null;
  salaryMax?: bigint | null;
  salaryCurrency?: string | null;
  salaryPeriod?: string | null;
  salaryBasis?: string | null;
  timezone?: string | null;
  hourStart?: string | null;
  hourEnd?: string | null;
  overlap?: number;
}): Promise<void> {
  const salaryMin =
    input.salaryMin === undefined ? BigInt(500000) : input.salaryMin;
  const salaryMax =
    input.salaryMax === undefined ? BigInt(700000) : input.salaryMax;
  const salaryCurrency =
    input.salaryCurrency === undefined ? "EUR" : input.salaryCurrency;
  const salaryPeriod =
    input.salaryPeriod === undefined ? "month" : input.salaryPeriod;
  const salaryBasis =
    input.salaryBasis === undefined ? "gross" : input.salaryBasis;
  await getDb().execute(sql`
    insert into public.jobs(
      id, company_id, title, description, category, work_format, employment_type,
      application_method, status, published_at, expires_at,
      salary_min, salary_max, salary_currency, salary_period, salary_basis,
      timezone_required, work_hours_start, work_hours_end, min_overlap_hours,
      location_country
    ) values (
      ${input.id}, ${input.companyId}, ${input.title}, ${description},
      'engineering', 'remote', 'full_time', 'internal',
      ${input.status ?? "published"}::job_status, now(), now() + interval '30 days',
      ${salaryMin},
      ${salaryMax},
      ${salaryCurrency},
      ${salaryPeriod}::salary_period,
      ${salaryBasis}::salary_basis,
      ${input.timezone ?? null},
      ${input.hourStart ?? null}::time,
      ${input.hourEnd ?? null}::time,
      ${input.overlap ?? 0},
      'DE'
    )
  `);
}

beforeAll(async () => {
  requireLoopback();
  const db = getDb();
  await db.execute(sql`
    insert into public.users(id, auth_uid, terms_accepted_at, terms_version)
    values
      (${userId}, ${randomUUID()}, now(), '6a'),
      (${otherId}, ${randomUUID()}, now(), '6a')
  `);
  await db.execute(sql`
    insert into public.companies(id, name, slug, status, created_by) values
      (${companyId}, '6A Match Co', ${`6a-${companyId.slice(0, 8)}`}, 'verified', ${userId}),
      (${hiddenCompanyId}, '6A Hidden Co', ${`6a-h-${hiddenCompanyId.slice(0, 8)}`}, 'verified', ${userId}),
      (${suspendedCompanyId}, '6A Suspended Co', ${`6a-s-${suspendedCompanyId.slice(0, 8)}`}, 'suspended', ${userId})
  `);
  await db.execute(sql`
    insert into public.skills(id, slug, name_en, name_ru, category)
    values (${skillId}, ${`6a-${skillId.slice(0, 8)}`}, '6A Skill', '6A Skill', 'engineering')
  `);
  await db.execute(sql`
    insert into public.candidate_profiles(
      user_id, work_formats, employment_types,
      work_hours_start, work_hours_end, work_days, experience_years,
      salary_min, salary_currency, salary_period, salary_basis,
      desired_titles, min_overlap_hours
    ) values (
      ${userId}, '{remote,hybrid,onsite}',
      '{full_time,part_time,contract}', '09:00', '18:00', '{1,2,3,4,5}', 5,
      400000, 'EUR', 'month', 'gross', '{Backend Developer}', 0
    )
  `);
  // Place and time zone live in the shared profile (D509).
  await db.execute(sql`
    insert into public.user_profiles(user_id, country, timezone)
    values (${userId}, 'DE', 'Europe/Berlin')
  `);
  await db.execute(sql`
    insert into public.candidate_skills(candidate_id, skill_id, level)
    values (${userId}, ${skillId}, 'advanced')
  `);
  await db.execute(sql`
    insert into public.candidate_preferences(user_id, categories)
    values (${userId}, '{engineering}')
  `);
  await insertJob({
    id: matchJobId,
    companyId,
    title: "Backend Developer",
  });
  await insertJob({
    id: noSalaryJobId,
    companyId,
    title: "Backend Developer unsized",
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryPeriod: null,
    salaryBasis: null,
  });
  await insertJob({
    id: grossJobId,
    companyId,
    title: "Backend Developer gross",
    salaryMin: BigInt(800000),
    salaryMax: BigInt(900000),
  });
  await insertJob({
    id: tzJobId,
    companyId,
    title: "Backend Developer overlap",
    timezone: "America/New_York",
    hourStart: "09:00",
    hourEnd: "18:00",
    overlap: 1,
  });
  await insertJob({
    id: nightJobId,
    companyId,
    title: "Backend Developer night",
    timezone: "Europe/Berlin",
    hourStart: "22:00",
    hourEnd: "06:00",
    overlap: 2,
  });
  await insertJob({
    id: dayJobId,
    companyId,
    title: "Backend Developer day",
    timezone: "Europe/Berlin",
    hourStart: "09:00",
    hourEnd: "17:00",
    overlap: 2,
  });
  await insertJob({
    id: removedJobId,
    companyId,
    title: "Backend Developer removed",
    status: "removed",
  });
  await insertJob({
    id: suspendedJobId,
    companyId: suspendedCompanyId,
    title: "Backend Developer suspended",
  });
  await insertJob({
    id: hiddenJobId,
    companyId: hiddenCompanyId,
    title: "Backend Developer hidden co",
  });
  await insertJob({
    id: categoryJobId,
    companyId,
    title: "Unrelated title",
  });
  await db.execute(sql`
    insert into public.job_skills(job_id, skill_id, weight, min_level)
    select id, ${skillId}, 2, 'intermediate'
    from public.jobs
    where id in (
      ${matchJobId}, ${noSalaryJobId}, ${grossJobId}, ${tzJobId},
      ${nightJobId}, ${dayJobId}, ${removedJobId}, ${suspendedJobId},
      ${hiddenJobId}
    )
  `);
});

afterAll(async () => {
  const db = getDb();
  await db.execute(
    sql`delete from public.companies where id in (${companyId}, ${hiddenCompanyId}, ${suspendedCompanyId})`,
  );
  await db.execute(sql`delete from public.skills where id = ${skillId}`);
  await db.execute(
    sql`delete from public.users where id in (${userId}, ${otherId})`,
  );
});

function idsOf(items: { jobId: string }[]): string[] {
  return items.map((item) => item.jobId);
}

describe("matching results", () => {
  it("keeps a job with no salary and a gross offer against a net expectation", async () => {
    const neutral = await computeMatches(userId, {
      now: new Date("2026-01-12T12:00:00Z"),
    });
    expect(idsOf(neutral.items)).toContain(noSalaryJobId);
    expect(idsOf(neutral.items)).toContain(matchJobId);
    expect(idsOf(neutral.items)).not.toContain(removedJobId);
    expect(idsOf(neutral.items)).not.toContain(suspendedJobId);

    await getDb().execute(sql`
      update public.candidate_profiles
      set salary_basis = 'net'
      where user_id = ${userId}
    `);
    const grossNet = await computeMatches(userId, {
      now: new Date("2026-01-12T12:00:00Z"),
    });
    expect(idsOf(grossNet.items)).toContain(grossJobId);
    await getDb().execute(sql`
      update public.candidate_profiles
      set salary_basis = 'gross'
      where user_id = ${userId}
    `);
  });

  it("scores Berlin against New York the same before and after DST, and differently in the gap week", async () => {
    await getDb().execute(sql`
      update public.candidate_profiles
      set min_overlap_hours = 8
      where user_id = ${userId}
    `);
    try {
      const winter = await computeMatches(userId, {
        now: new Date("2026-03-02T12:00:00Z"),
      });
      const gap = await computeMatches(userId, {
        now: new Date("2026-03-16T12:00:00Z"),
      });
      const summer = await computeMatches(userId, {
        now: new Date("2026-04-06T12:00:00Z"),
      });
      const score = (list: { items: { jobId: string; score: number }[] }) =>
        list.items.find((item) => item.jobId === tzJobId)?.score;
      expect(score(winter)).toBeDefined();
      expect(score(summer)).toBe(score(winter));
      expect(score(gap)).not.toBe(score(winter));
    } finally {
      await getDb().execute(sql`
        update public.candidate_profiles
        set min_overlap_hours = 0
        where user_id = ${userId}
      `);
    }
  });

  it("overlaps a window that crosses midnight and drops a daytime window that does not", async () => {
    await getDb().execute(sql`
      update public.candidate_profiles
      set work_hours_start = '22:00', work_hours_end = '06:00'
      where user_id = ${userId}
    `);
    const night = await computeMatches(userId, {
      now: new Date("2026-01-12T12:00:00Z"),
    });
    expect(idsOf(night.items)).toContain(nightJobId);
    expect(idsOf(night.items)).not.toContain(dayJobId);
    await getDb().execute(sql`
      update public.candidate_profiles
      set work_hours_start = '09:00', work_hours_end = '18:00'
      where user_id = ${userId}
    `);
  });

  it("drops hidden jobs and hidden companies, and lowers a category after dismissals", async () => {
    const before = await computeMatches(userId, {
      now: new Date("2026-01-12T12:00:00Z"),
    });
    const beforeScore = before.items.find(
      (item) => item.jobId === matchJobId,
    )?.score;
    await getDb().execute(sql`
      insert into public.user_job_feedback(user_id, job_id, company_id, action)
      values
        (${userId}, ${hiddenJobId}, ${hiddenCompanyId}, 'hidden'),
        (${userId}, ${hiddenJobId}, ${hiddenCompanyId}, 'hidden_company')
    `);
    const hidden = await computeMatches(userId, {
      now: new Date("2026-01-12T12:00:00Z"),
    });
    expect(idsOf(hidden.items)).not.toContain(hiddenJobId);
    await getDb().execute(sql`
      delete from public.user_job_feedback where user_id = ${userId}
    `);

    const extraIds = [randomUUID(), randomUUID(), randomUUID()];
    for (const id of extraIds) {
      await insertJob({ id, companyId, title: `Dismissed ${id.slice(0, 8)}` });
    }
    await getDb().execute(sql`
      insert into public.user_job_feedback(user_id, job_id, company_id, action, reason)
      values
        (${userId}, ${extraIds[0]}, ${companyId}, 'dismissed', 'role'),
        (${userId}, ${extraIds[1]}, ${companyId}, 'dismissed', 'role'),
        (${userId}, ${extraIds[2]}, ${companyId}, 'dismissed', 'role')
    `);
    const after = await computeMatches(userId, {
      now: new Date("2026-01-12T12:00:00Z"),
    });
    const afterScore = after.items.find(
      (item) => item.jobId === matchJobId,
    )?.score;
    expect(beforeScore).toBeDefined();
    expect(afterScore).toBeLessThan(beforeScore ?? 0);
    await getDb().execute(sql`
      delete from public.user_job_feedback where user_id = ${userId}
    `);
    await getDb().execute(
      sql`delete from public.jobs where id in (${extraIds[0]}, ${extraIds[1]}, ${extraIds[2]})`,
    );
  });

  it("recomputes when the profile or algo version changes, and not on a fresh second read", async () => {
    await computeMatches(userId);
    resetComputeCount();
    await getMatches(userId);
    await getMatches(userId);
    expect(takeComputeCount()).toBe(0);
    await getDb().execute(sql`
      update public.candidate_profiles
      set summary = 'updated'
      where user_id = ${userId}
    `);
    await getMatches(userId);
    expect(takeComputeCount()).toBe(1);
    await getDb().execute(sql`
      update public.matching_results
      set algo_version = 9
      where user_id = ${userId}
    `);
    await getMatches(userId);
    expect(takeComputeCount()).toBe(2);
  });

  it("scores one published job for candidates who pass the prefilter", async () => {
    await getDb().execute(sql`
      insert into public.candidate_profiles(
        user_id, work_formats, employment_types, desired_titles
      ) values (
        ${otherId}, '{remote}', '{full_time}', '{Backend Developer}'
      )
    `);
    await getDb().execute(sql`
      insert into public.user_profiles(user_id, country, timezone)
      values (${otherId}, 'DE', 'Europe/Berlin')
    `);
    await getDb().execute(sql`
      insert into public.candidate_skills(candidate_id, skill_id, level)
      values (${otherId}, ${skillId}, 'advanced')
    `);
    const result = await computeMatchesForJob(matchJobId, {
      now: new Date("2026-01-12T12:00:00Z"),
    });
    expect(result.considered).toBeGreaterThanOrEqual(1);
    expect(result.written).toBeGreaterThanOrEqual(1);
    const stored = await getDb().execute<{ n: number }>(sql`
      select count(*)::int as n from public.matching_results
      where user_id = ${otherId} and job_id = ${matchJobId}
    `);
    expect(stored[0]?.n).toBe(1);
  });

  it("keeps a warm cache under 300ms and a cold recompute under 1500ms on 5,000 jobs", async () => {
    const db = getDb();
    await db.execute(sql`
      insert into public.jobs(
        id, company_id, title, description, category, work_format, employment_type,
        application_method, status, published_at, expires_at, location_country
      )
      select md5('6a-perf-' || ${companyId}::text || '-' || n)::uuid,
        ${companyId},
        'Backend Developer ' || n,
        ${description},
        'engineering', 'remote', 'full_time', 'internal', 'published',
        now(), now() + interval '30 days', 'DE'
      from generate_series(1, 5000) n
      on conflict (id) do nothing
    `);
    await db.execute(sql`
      insert into public.job_skills(job_id, skill_id, weight, min_level)
      select md5('6a-perf-' || ${companyId}::text || '-' || n)::uuid,
        ${skillId}, 2, 'intermediate'
      from generate_series(1, 5000) n
      on conflict do nothing
    `);
    await db.execute(
      sql`delete from public.matching_results where user_id = ${userId}`,
    );

    const cold: number[] = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await db.execute(
        sql`delete from public.matching_results where user_id = ${userId}`,
      );
      const started = performance.now();
      await getMatches(userId);
      cold.push(performance.now() - started);
    }
    cold.sort((left, right) => left - right);
    const coldP95 = cold[Math.ceil(cold.length * 0.95) - 1] ?? cold[0];

    const warm: number[] = [];
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const started = performance.now();
      const list = await getMatches(userId);
      warm.push(performance.now() - started);
      expect(list.items.length).toBeGreaterThan(0);
    }
    warm.sort((left, right) => left - right);
    const warmP95 = warm[Math.ceil(warm.length * 0.95) - 1] ?? warm[0];
    console.info(
      `matching p95 warm=${warmP95.toFixed(1)}ms cold=${coldP95.toFixed(1)}ms`,
    );
    expect(warmP95).toBeLessThan(300);
    expect(coldP95).toBeLessThan(1500);

    await db.execute(sql`
      delete from public.jobs
      where id in (
        select md5('6a-perf-' || ${companyId}::text || '-' || n)::uuid
        from generate_series(1, 5000) n
      )
    `);
  });
});
