import { z } from "zod";
import { HIDE_REASONS } from "./hide-reasons";
import { MATCH_PAGE_DEFAULT, MATCH_PAGE_MAX } from "./service/feed-rules";

export const matchListQuery = z
  .object({
    cursor: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(MATCH_PAGE_MAX).optional(),
  })
  .strict();

export function matchListLimit(limit: number | undefined): number {
  return limit ?? MATCH_PAGE_DEFAULT;
}

export const dismissMatchInput = z
  .object({
    action: z.literal("dismissed"),
    reason: z.enum(HIDE_REASONS).optional(),
  })
  .strict();
