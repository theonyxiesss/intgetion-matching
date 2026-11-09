import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/*
 * Read-only. Tables of extracted modules come from their `./db` exports;
 * the two below belong to modules not extracted yet (companies keeps more
 * columns, feedback lives in the platform).
 */
export { jobs, jobSkills, jobLanguages, fxRates } from "@intgetion/jobs/db";
export { candidateProfiles, candidatePreferences, candidateSkills } from "@intgetion/candidates/db";
export { applications } from "@intgetion/applications/db";
export { userProfiles } from "@intgetion/users/db";

export const companies = pgTable("companies", {
  id: uuid("id").primaryKey(),
  status: text("status").notNull(),
});

export const userJobFeedback = pgTable("user_job_feedback", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  jobId: uuid("job_id").notNull(),
  companyId: uuid("company_id"),
  action: text("action").notNull(),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});
