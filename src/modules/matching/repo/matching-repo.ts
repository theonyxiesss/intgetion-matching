/**
 * SQL prefilter and matching_results IO (6A). Scoring stays in score/*.
 */
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { getDb } from "@intgetion/kit";
import {
  applications,
  candidatePreferences,
  candidateProfiles,
  candidateSkills,
  companies,
  fxRates,
  jobLanguages,
  jobSkills,
  jobs,
  matchingResults,
  userJobFeedback,
  userProfiles,
} from "../../../db";
import type { FxRate } from "@intgetion/kit";
import { factsForMatching } from "../service/shared-facts";
import type { ExplainEntry } from "../score/types";
import type {
  CandidateForScoring,
  CandidateSkillForScoring,
  FeedbackForScoring,
  JobForScoring,
  JobLanguageForScoring,
  JobSkillForScoring,
} from "../score/types";
const FEEDBACK_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

export interface StoredMatchRow {
  jobId: string;
  score: number;
  explain: ExplainEntry[];
  lowData: boolean;
  computedAt: Date;
  algoVersion: number;
}

export interface ProfileForMatching {
  candidate: CandidateForScoring;
  updatedAt: Date;
}

function hhmm(value: string): string {
  const match = /^(\d{2}):(\d{2})/.exec(value);
  if (!match) {
    throw new Error(`time must be HH:MM, got ${value}`);
  }
  return `${match[1]}:${match[2]}`;
}

function trimCode(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function textArray(values: readonly string[]) {
  return sql`array[${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )}]::text[]`;
}

export async function readProfile(
  userId: string,
): Promise<ProfileForMatching | null> {
  const db = getDb();
  const [profile] = await db
    .select()
    .from(candidateProfiles)
    .where(eq(candidateProfiles.userId, userId))
    .limit(1);
  if (!profile) return null;

  const skills = await db
    .select({
      skillId: candidateSkills.skillId,
      level: candidateSkills.level,
    })
    .from(candidateSkills)
    .where(eq(candidateSkills.candidateId, userId));
  const [shared] = await db
    .select({
      country: userProfiles.country,
      timezone: userProfiles.timezone,
      languages: userProfiles.languages,
    })
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .limit(1);
  const preferences = await db
    .select({
      categories: candidatePreferences.categories,
      sectors: candidatePreferences.sectors,
      seniority: candidatePreferences.seniority,
    })
    .from(candidatePreferences)
    .where(eq(candidatePreferences.userId, userId))
    .limit(1);

  const candidateSkillsForScoring: CandidateSkillForScoring[] = skills.map(
    (skill) => ({ skillId: skill.skillId, level: skill.level }),
  );
  // Country, time zone and languages live in the shared profile (D509).
  const facts = factsForMatching(
    shared
      ? {
          country: trimCode(shared.country),
          timezone: shared.timezone,
          languages: shared.languages ?? [],
        }
      : null,
  );

  return {
    updatedAt: profile.updatedAt,
    candidate: {
      userId,
      country: facts.country,
      timezone: facts.timezone,
      workHoursStart: hhmm(profile.workHoursStart),
      workHoursEnd: hhmm(profile.workHoursEnd),
      workDays: profile.workDays.map(Number),
      workFormats: profile.workFormats,
      employmentTypes: profile.employmentTypes,
      experienceYears: profile.experienceYears,
      desiredTitles: profile.desiredTitles,
      categories: preferences[0]?.categories ?? [],
      sectors: preferences[0]?.sectors ?? [],
      seniority: preferences[0]?.seniority ?? null,
      salaryMinMinor: profile.salaryMin,
      salaryMaxMinor: profile.salaryMax,
      salaryCurrency: trimCode(profile.salaryCurrency),
      salaryPeriod: profile.salaryPeriod,
      salaryBasis: profile.salaryBasis,
      minOverlapHours: profile.minOverlapHours,
      skills: candidateSkillsForScoring,
      languages: facts.languages,
    },
  };
}

export async function readFeedback(
  userId: string,
  now: Date,
): Promise<FeedbackForScoring> {
  const db = getDb();
  const since = new Date(now.getTime() - FEEDBACK_WINDOW_MS).toISOString();
  const hiddenJobs = await db
    .select({ jobId: userJobFeedback.jobId })
    .from(userJobFeedback)
    .where(
      and(
        eq(userJobFeedback.userId, userId),
        eq(userJobFeedback.action, "hidden"),
      ),
    );
  const hiddenCompanies = await db
    .select({ companyId: userJobFeedback.companyId })
    .from(userJobFeedback)
    .where(
      and(
        eq(userJobFeedback.userId, userId),
        eq(userJobFeedback.action, "hidden_company"),
      ),
    );
  const activeApplications = await db
    .select({ jobId: applications.jobId })
    .from(applications)
    .where(
      and(
        eq(applications.candidateId, userId),
        sql`${applications.status} <> 'withdrawn'`,
      ),
    );
  const categories = await db.execute<{ category: string; n: number }>(sql`
    select j.category, count(*)::int as n
    from public.user_job_feedback f
    join public.jobs j on j.id = f.job_id
    where f.user_id = ${userId}
      and f.action in ('hidden', 'dismissed')
      and f.created_at >= ${since}::timestamptz
    group by j.category
  `);
  const skills = await db.execute<{ skill_id: string }>(sql`
    with touched as (
      select job_id from public.saved_jobs
      where user_id = ${userId} and created_at >= ${since}::timestamptz
      union
      select job_id from public.applications
      where candidate_id = ${userId}
        and created_at >= ${since}::timestamptz
        and status <> 'withdrawn'
      union
      select job_id from public.user_job_feedback
      where user_id = ${userId}
        and action in ('saved', 'applied', 'applied_external')
        and created_at >= ${since}::timestamptz
    )
    select js.skill_id
    from touched t
    join public.job_skills js on js.job_id = t.job_id
    group by js.skill_id
    having count(distinct t.job_id) >= 2
  `);
  const reasons = await db.execute<{ reason: string; n: number }>(sql`
    select reason, count(*)::int as n
    from public.user_job_feedback
    where user_id = ${userId}
      and action in ('hidden', 'dismissed')
      and reason in ('salary', 'format', 'timezone')
      and created_at >= ${since}::timestamptz
    group by reason
  `);

  const hiddenDismissedCategoryCounts: Record<string, number> = {};
  for (const row of categories) {
    hiddenDismissedCategoryCounts[row.category] = row.n;
  }
  const hideReasonCounts = { salary: 0, format: 0, timezone: 0 };
  for (const row of reasons) {
    if (
      row.reason === "salary" ||
      row.reason === "format" ||
      row.reason === "timezone"
    ) {
      hideReasonCounts[row.reason] = row.n;
    }
  }

  return {
    hiddenJobIds: hiddenJobs.map((row) => row.jobId),
    hiddenCompanyIds: hiddenCompanies
      .map((row) => row.companyId)
      .filter((id): id is string => id !== null),
    activeApplicationJobIds: activeApplications.map((row) => row.jobId),
    hiddenDismissedCategoryCounts,
    repeatedSkillIds: skills.map((row) => row.skill_id),
    hideReasonCounts,
  };
}

export async function prefilterJobIds(
  candidate: CandidateForScoring,
  limit: number,
): Promise<string[]> {
  if (
    candidate.workFormats.length === 0 ||
    candidate.employmentTypes.length === 0
  ) {
    return [];
  }
  const country = candidate.country;
  const categories =
    candidate.categories.length > 0 ? textArray(candidate.categories) : null;
  const rows = await getDb().execute<{ id: string }>(sql`
    select j.id
    from public.jobs j
    join public.companies c on c.id = j.company_id
    where j.status = 'published'
      and c.status not in ('suspended', 'rejected')
      and j.work_format::text = any(${textArray(candidate.workFormats)})
      and j.employment_type::text = any(${textArray(candidate.employmentTypes)})
      and (
        j.country_restrictions is null
        or (
          ${country}::text is not null
          and ${country} = any(j.country_restrictions)
        )
      )
      and (
        j.work_format = 'remote'
        or (
          ${country}::text is not null
          and j.location_country = ${country}
        )
      )
      and (
        exists (
          select 1
          from public.job_skills js
          join public.candidate_skills cs on cs.skill_id = js.skill_id
          where js.job_id = j.id and cs.candidate_id = ${candidate.userId}
        )
        or (
          ${categories}::text[] is not null
          and j.category = any(${categories}::text[])
        )
      )
      and not exists (
        select 1 from public.user_job_feedback f
        where f.user_id = ${candidate.userId}
          and f.action = 'hidden'
          and f.job_id = j.id
      )
      and not exists (
        select 1 from public.user_job_feedback f
        where f.user_id = ${candidate.userId}
          and f.action = 'hidden_company'
          and f.company_id = j.company_id
      )
      and not exists (
        select 1 from public.applications a
        where a.candidate_id = ${candidate.userId}
          and a.job_id = j.id
          and a.status <> 'withdrawn'
      )
    limit ${limit}
  `);
  return rows.map((row) => row.id);
}

export async function prefilterCandidateIds(
  jobId: string,
  limit: number,
): Promise<string[]> {
  const rows = await getDb().execute<{ user_id: string }>(sql`
    select p.user_id
    from public.candidate_profiles p
    join public.jobs j on j.id = ${jobId}
    join public.companies c on c.id = j.company_id
    left join public.candidate_preferences pref on pref.user_id = p.user_id
    left join public.user_profiles up on up.user_id = p.user_id
    where j.status = 'published'
      and c.status not in ('suspended', 'rejected')
      and j.work_format = any(p.work_formats)
      and j.employment_type = any(p.employment_types)
      and (
        j.country_restrictions is null
        or (up.country is not null and up.country = any(j.country_restrictions))
      )
      and (
        j.work_format = 'remote'
        or (up.country is not null and j.location_country = up.country)
      )
      and (
        exists (
          select 1
          from public.job_skills js
          join public.candidate_skills cs
            on cs.skill_id = js.skill_id and cs.candidate_id = p.user_id
          where js.job_id = j.id
        )
        or (
          pref.categories is not null
          and j.category = any(pref.categories)
        )
      )
      and not exists (
        select 1 from public.user_job_feedback f
        where f.user_id = p.user_id
          and f.action = 'hidden'
          and f.job_id = j.id
      )
      and not exists (
        select 1 from public.user_job_feedback f
        where f.user_id = p.user_id
          and f.action = 'hidden_company'
          and f.company_id = j.company_id
      )
      and not exists (
        select 1 from public.applications a
        where a.candidate_id = p.user_id
          and a.job_id = j.id
          and a.status <> 'withdrawn'
      )
    limit ${limit}
  `);
  return rows.map((row) => row.user_id);
}

export interface JobWithSimilarity {
  job: JobForScoring;
  titleSimilarity: number;
}

export async function readJobs(
  jobIds: readonly string[],
  desiredTitles: readonly string[],
): Promise<JobWithSimilarity[]> {
  if (jobIds.length === 0) return [];
  const db = getDb();
  const jobRows = await db
    .select()
    .from(jobs)
    .where(inArray(jobs.id, [...jobIds]));
  const skillRows = await db
    .select()
    .from(jobSkills)
    .where(inArray(jobSkills.jobId, [...jobIds]));
  const languageRows = await db
    .select()
    .from(jobLanguages)
    .where(inArray(jobLanguages.jobId, [...jobIds]));
  const similarityRows =
    desiredTitles.length === 0
      ? []
      : await db.execute<{ id: string; sim: number }>(sql`
          select j.id, max(public.skill_similarity(t.title, j.title)) as sim
          from public.jobs j
          cross join unnest(${textArray(desiredTitles)}) as t(title)
          where j.id in (${sql.join(
            jobIds.map((id) => sql`${id}`),
            sql`, `,
          )})
          group by j.id
        `);

  const skillsByJob = new Map<string, JobSkillForScoring[]>();
  for (const skill of skillRows) {
    const weight = skill.weight;
    if (weight !== 1 && weight !== 2 && weight !== 3) continue;
    const list = skillsByJob.get(skill.jobId) ?? [];
    list.push({
      skillId: skill.skillId,
      weight,
      minLevel: skill.minLevel,
    });
    skillsByJob.set(skill.jobId, list);
  }
  const languagesByJob = new Map<string, JobLanguageForScoring[]>();
  for (const language of languageRows) {
    const list = languagesByJob.get(language.jobId) ?? [];
    list.push({ lang: language.lang.trim(), minLevel: language.minLevel });
    languagesByJob.set(language.jobId, list);
  }
  const similarityByJob = new Map<string, number>();
  for (const row of similarityRows) {
    similarityByJob.set(row.id, Number(row.sim));
  }

  return jobRows.map((row) => ({
    titleSimilarity: similarityByJob.get(row.id) ?? 0,
    job: {
      jobId: row.id,
      companyId: row.companyId,
      title: row.title,
      category: row.category,
      sectors: row.sectors,
      seniority: row.seniority,
      status: row.status,
      workFormat: row.workFormat,
      employmentType: row.employmentType,
      experienceMin: row.experienceMin,
      experienceMax: row.experienceMax,
      locationCountry: trimCode(row.locationCountry),
      countryRestrictions:
        row.countryRestrictions === null
          ? null
          : row.countryRestrictions.map((code) => code.trim()),
      timezoneRequired: row.timezoneRequired,
      workHoursStart:
        row.workHoursStart === null ? null : hhmm(row.workHoursStart),
      workHoursEnd: row.workHoursEnd === null ? null : hhmm(row.workHoursEnd),
      minOverlapHours: row.minOverlapHours,
      salaryMinMinor: row.salaryMin,
      salaryMaxMinor: row.salaryMax,
      salaryCurrency: trimCode(row.salaryCurrency),
      salaryPeriod: row.salaryPeriod,
      salaryBasis: row.salaryBasis,
      skills: skillsByJob.get(row.id) ?? [],
      languages: languagesByJob.get(row.id) ?? [],
    },
  }));
}

export async function readTitleSimilarities(
  jobId: string,
  userIds: readonly string[],
): Promise<Map<string, number>> {
  const similarities = new Map<string, number>();
  if (userIds.length === 0) return similarities;
  const rows = await getDb().execute<{ user_id: string; sim: number }>(sql`
    select p.user_id,
           coalesce(max(public.skill_similarity(t.title, j.title)), 0) as sim
    from public.candidate_profiles p
    join public.jobs j on j.id = ${jobId}
    left join lateral unnest(p.desired_titles) as t(title) on true
    where p.user_id in (${sql.join(
      userIds.map((id) => sql`${id}`),
      sql`, `,
    )})
    group by p.user_id
  `);
  for (const row of rows) similarities.set(row.user_id, Number(row.sim));
  return similarities;
}

export async function readFxRates(): Promise<FxRate[]> {
  const rows = await getDb()
    .select({
      currency: fxRates.currency,
      rateToUsd: fxRates.rateToUsd,
      asOf: fxRates.asOf,
    })
    .from(fxRates)
    .where(gte(fxRates.asOf, sql`current_date - interval '8 days'`));
  return rows.map((row) => ({
    currency: row.currency.trim(),
    rateToUsd: row.rateToUsd,
    asOf: row.asOf,
  }));
}

export async function readStoredMatches(
  userId: string,
): Promise<StoredMatchRow[]> {
  const rows = await getDb()
    .select()
    .from(matchingResults)
    .where(eq(matchingResults.userId, userId));
  return rows.map((row) => {
    const breakdown = row.breakdown as { lowData?: boolean };
    return {
      jobId: row.jobId,
      score: Number(row.score),
      explain: row.explain as ExplainEntry[],
      lowData: breakdown.lowData === true,
      computedAt: row.computedAt,
      algoVersion: row.algoVersion,
    };
  });
}

export interface ResultWrite {
  jobId: string;
  score: string;
  breakdown: unknown;
  explain: unknown;
  algoVersion: number;
}

export async function replaceUserResults(
  userId: string,
  rows: readonly ResultWrite[],
): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.delete(matchingResults).where(eq(matchingResults.userId, userId));
    if (rows.length === 0) return;
    await tx.insert(matchingResults).values(
      rows.map((row) => ({
        userId,
        jobId: row.jobId,
        score: row.score,
        breakdown: row.breakdown,
        explain: row.explain,
        algoVersion: row.algoVersion,
        computedAt: sql`now()`,
      })),
    );
  });
}

/** Upserts one job for many candidates. Does not touch their other jobs. */
export async function writeJobResults(
  jobId: string,
  rows: readonly (ResultWrite & { userId: string })[],
  dropUserIds: readonly string[],
): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    if (dropUserIds.length > 0) {
      await tx
        .delete(matchingResults)
        .where(
          and(
            eq(matchingResults.jobId, jobId),
            inArray(matchingResults.userId, [...dropUserIds]),
          ),
        );
    }
    if (rows.length === 0) return;
    await tx
      .insert(matchingResults)
      .values(
        rows.map((row) => ({
          userId: row.userId,
          jobId,
          score: row.score,
          breakdown: row.breakdown,
          explain: row.explain,
          algoVersion: row.algoVersion,
          computedAt: sql`now()`,
        })),
      )
      .onConflictDoUpdate({
        target: [matchingResults.userId, matchingResults.jobId],
        set: {
          score: sql`excluded.score`,
          breakdown: sql`excluded.breakdown`,
          explain: sql`excluded.explain`,
          algoVersion: sql`excluded.algo_version`,
          computedAt: sql`excluded.computed_at`,
        },
      });
  });
}

export async function readCompanyVisible(jobId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: jobs.id })
    .from(jobs)
    .innerJoin(companies, eq(companies.id, jobs.companyId))
    .where(
      and(
        eq(jobs.id, jobId),
        eq(jobs.status, "published"),
        sql`${companies.status} not in ('suspended', 'rejected')`,
      ),
    )
    .limit(1);
  return row !== undefined;
}

/** Drop the user's cache so the next getMatches recomputes (6B feedback). */
export async function deleteUserResults(userId: string): Promise<void> {
  await getDb()
    .delete(matchingResults)
    .where(eq(matchingResults.userId, userId));
}

export async function listDismissedJobIds(userId: string): Promise<string[]> {
  const rows = await getDb().execute<{ job_id: string }>(sql`
    select distinct on (job_id) job_id
    from public.user_job_feedback
    where user_id = ${userId} and action = 'dismissed'
    order by job_id, created_at desc
  `);
  return rows.map((row) => row.job_id);
}

export async function countDismissedSince(
  userId: string,
  since: Date,
): Promise<number> {
  const rows = await getDb().execute<{ n: number }>(sql`
    select count(*)::int as n
    from public.user_job_feedback
    where user_id = ${userId}
      and action = 'dismissed'
      and created_at >= ${since.toISOString()}::timestamptz
  `);
  return rows[0]?.n ?? 0;
}
