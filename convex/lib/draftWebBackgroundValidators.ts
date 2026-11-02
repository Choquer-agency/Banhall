/**
 * Validators for public background in drafting (convex/ai/draftWebBackground.ts):
 * the per-project cache row and the record on the generation. Runtime-free
 * apart from `convex/values`, so the schema can import them.
 */
import { v } from "convex/values";

const queryKindValidator = v.union(v.literal("technology"), v.literal("cra"));

export const draftWebSourceValidator = v.object({
  url: v.string(),
  title: v.string(),
  domain: v.string(),
});

export const numberedDraftWebSourceValidator = v.object({
  n: v.number(),
  url: v.string(),
  title: v.string(),
  domain: v.string(),
});

/** One search as cached: the query as sent, its answer and its sources. */
export const draftWebResultValidator = v.object({
  query: v.string(),
  kind: queryKindValidator,
  status: v.union(v.literal("ok"), v.literal("failed")),
  answer: v.string(),
  sources: v.array(draftWebSourceValidator),
});

/** `generations.webBackground`: what the step did for this draft. */
export const draftWebBackgroundRecordValidator = v.object({
  status: v.union(
    v.literal("used"),
    v.literal("off_for_run"),
    v.literal("off_for_deployment"),
    v.literal("no_queries"),
    v.literal("failed"),
    v.literal("timed_out")
  ),
  queries: v.array(
    v.object({
      query: v.string(),
      kind: queryKindValidator,
      status: v.union(v.literal("ok"), v.literal("failed")),
    })
  ),
  sources: v.array(numberedDraftWebSourceValidator),
  droppedQueries: v.number(),
  // Why each dropped query was dropped (codes only, never its text).
  droppedReasons: v.optional(
    v.array(
      v.union(
        v.literal("names"),
        v.literal("unknown_name"),
        v.literal("claimant"),
        v.literal("source_text"),
        v.literal("placeholder"),
        v.literal("figure"),
        v.literal("too_long"),
        v.literal("empty"),
        v.literal("duplicate"),
        v.literal("over_limit")
      )
    )
  ),
  cached: v.boolean(),
  reason: v.optional(v.string()),
});
