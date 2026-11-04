import type { MutationCtx, QueryCtx } from "../_generated/server";

export const TRANSCRIPT_FACTS_MODE_KEY = "transcripts.factsMode";
export type TranscriptFactsMode = "off" | "long" | "all";

/** Invalid or missing settings leave fact extraction off. */
export async function transcriptFactsMode(ctx: QueryCtx | MutationCtx): Promise<TranscriptFactsMode> {
  const row = await ctx.db
    .query("appSettings")
    .withIndex("by_key", (q) => q.eq("key", TRANSCRIPT_FACTS_MODE_KEY))
    .unique();
  const value = row?.value.trim();
  return value === "long" || value === "all" ? value : "off";
}
