import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const matchingResults = pgTable(
  "matching_results",
  {
    userId: uuid("user_id")
      .notNull(),
    jobId: uuid("job_id")
      .notNull(),
    score: numeric("score", { precision: 5, scale: 4 }).notNull(),
    breakdown: jsonb("breakdown").notNull(),
    explain: jsonb("explain").notNull(),
    algoVersion: smallint("algo_version").notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.jobId] }),
    index("matching_results_user_score_idx").on(table.userId, table.score),
    check(
      "matching_results_score_check",
      sql`${table.score} >= 0 and ${table.score} <= 1`,
    ),
  ],
);

/** One open row per job (pending or running). Done rows stay for audit. */
export const matchingJobs = pgTable(
  "matching_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    runAfter: timestamp("run_after", { withTimezone: true }).notNull(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    index("matching_jobs_due_idx").on(table.status, table.runAfter),
    uniqueIndex("matching_jobs_open_job_idx")
      .on(table.jobId)
      .where(sql`${table.status} in ('pending', 'running')`),
    check(
      "matching_jobs_status_check",
      sql`${table.status} in ('pending', 'running', 'done', 'failed')`,
    ),
  ],
);
