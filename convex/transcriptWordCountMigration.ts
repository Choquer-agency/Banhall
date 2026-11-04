import { makeFunctionReference, type FunctionReference } from "convex/server";
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { countTranscriptWords } from "./lib/transcripts";

const PAGE_SIZE = 10;
const PAGE_MAX_BYTES = 2 * 1024 * 1024;
const nextPage = makeFunctionReference(
  "transcriptWordCountMigration:backfillWordCounts"
) as unknown as FunctionReference<
  "mutation", "internal", { cursor: string },
  { scanned: number; updated: number; isDone: boolean }
>;

/** Run once with {} after deployment. Each page fills only missing counts. */
export const backfillWordCounts = internalMutation({
  args: { cursor: v.optional(v.string()) },
  returns: v.object({ scanned: v.number(), updated: v.number(), isDone: v.boolean() }),
  handler: async (ctx, args) => {
    const page = await ctx.db.query("transcripts").paginate({
      cursor: args.cursor ?? null,
      numItems: PAGE_SIZE,
      maximumBytesRead: PAGE_MAX_BYTES,
    });
    let updated = 0;
    for (const row of page.page) {
      if (row.wordCount !== undefined) continue;
      await ctx.db.patch(row._id, { wordCount: countTranscriptWords(row.content) });
      updated += 1;
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, nextPage, { cursor: page.continueCursor });
    }
    return { scanned: page.page.length, updated, isDone: page.isDone };
  },
});
