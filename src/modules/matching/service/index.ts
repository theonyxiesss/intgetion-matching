/**
 * Public service surface.
 * Other modules may import only this file, never this module's repo.
 */
export {
  ALGO_VERSION,
  SHOW_THRESHOLD,
  LOW_DATA_WEIGHT_SUM,
  COMPONENT_WEIGHTS,
  buildMatch,
  scoreCandidate,
  countMissingMustHaves,
  type MatchResult,
  type ComponentBreakdown,
  type ScoreExclusion,
} from "../score/assemble";
export {
  hardFilter,
  type HardFilterReason,
  type HardFilterResult,
} from "../score/hard-filter";
export {
  skillsComponent,
  roleComponent,
  salaryComponent,
  tzOverlapComponent,
  experienceComponent,
  languagesComponent,
  hasCompleteJobSalary,
} from "../score/components";
export {
  feedbackMultiplier,
  type FeedbackMultiplier,
  type SuggestProfileUpdateField,
} from "../score/feedback";
export {
  explainMatch,
  topExplain,
  sortExplain,
  toPublicMatch,
  type PublicMatch,
} from "../score/explain";
export { NoopSemanticProvider, type SemanticProvider } from "../score/semantic";
export type {
  CandidateForScoring,
  JobForScoring,
  FeedbackForScoring,
  ScoringContext,
  ComponentKey,
  ComponentResult,
  ExplainEntry,
  ExplainVerdict,
  CandidateSkillForScoring,
  CandidateLanguageForScoring,
  JobSkillForScoring,
  JobLanguageForScoring,
} from "../score/types";
export { emptyFeedback, skillLevelIndex, cefrLevelIndex } from "../score/types";
export {
  CACHE_MAX_AGE_MS,
  JOB_CANDIDATE_LIMIT,
  MATCH_STORE_LIMIT,
  PREFILTER_LIMIT,
  envelopeLowData,
  isCacheFresh,
  scoreToNumeric,
  selectShown,
} from "./cache-rules";
export {
  computeMatches,
  computeMatchesForJob,
  getMatches,
  resetComputeCount,
  takeComputeCount,
  type MatchItem,
  type MatchList,
} from "./compute";
export {
  dismissMatch,
  listMatchPage,
  loadMatchScreen,
  matchForJob,
  type MatchCard,
  type MatchPage,
  type MatchScreen,
  type ScreenCard,
} from "./feed";
export {
  DISMISS_LIMIT_PER_HOUR,
  MATCH_PAGE_DEFAULT,
  MATCH_PAGE_MAX,
  decodeMatchCursor,
  dismissLimited,
  encodeMatchCursor,
  isNewMatch,
  parseMatchTab,
  profileHintAnchor,
  profileHintsFromCounts,
  sliceShown,
  type MatchTab,
  type ProfileHint,
} from "./feed-rules";
export { enqueueMatchJob, claimMatchJob, runMatchingCron } from "./recalc";
export {
  MATCH_ATTEMPT_LIMIT,
  MATCH_CRON_BUDGET_MS,
  retryPlan,
} from "./recalc-rules";
export { setMatchingPorts } from "../../../ports";
export type { MatchingPorts, PublicJob, JobFeedbackInput } from "../../../ports";
export { HIDE_REASONS } from "../hide-reasons";
