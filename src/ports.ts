import type { toPublicJobDto } from "@intgetion/jobs";

/** The public job card as jobs serves it. */
export type PublicJob = ReturnType<typeof toPublicJobDto>;

export type JobFeedbackInput = {
  userId: string;
  jobId: string;
  companyId: string;
  action: "dismissed";
  reason: string | null;
};

export type MatchingPorts = {
  /** candidates: does this person have a candidate profile. */
  hasCandidateProfile: (userId: string) => Promise<boolean>;
  /** jobs: public job cards by id, and one job as this viewer may see it. */
  listPublicJobsByIds: (ids: string[], locale: string) => Promise<PublicJob[]>;
  getJobForPublic: (jobId: string, viewer: { userId: string }) => Promise<PublicJob | null>;
  /** feedback (platform until extracted): record a hide/dismiss. */
  recordJobFeedback: (input: JobFeedbackInput) => Promise<void>;
};

let ports: MatchingPorts | null = null;

export function setMatchingPorts(next: MatchingPorts): void {
  ports = next;
}

export function matchingPorts(): MatchingPorts {
  if (!ports) throw new Error("matching ports are not configured");
  return ports;
}
