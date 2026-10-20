/**
 * Chat parity Phase B (W3): the report chat's per-conversation web search
 * setting and its search records (`chatWebSearches`). Helpers for the
 * `chatV2` functions that own them; no functions are registered here.
 */
import { v } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

/** A conversation's web search setting. Absent means on (lead decision 2026-10-20). */
export function threadWebSearchOn(thread: Pick<Doc<"agentChatThreads">, "webSearch">): boolean {
  return thread.webSearch !== false;
}

/**
 * `sendMessage`'s web search: a send that names a setting (`allowWeb`, the
 * composer's switch at send time) writes it to the conversation, and the
 * turn always runs with the conversation's stored setting. A send without
 * one (Continue, Regenerate) uses the stored setting. A missing row fails
 * closed.
 */
export async function resolveThreadWebSearch(
  ctx: MutationCtx,
  agentThreadId: string,
  allowWeb: boolean | undefined
): Promise<boolean> {
  const thread = await ctx.db
    .query("agentChatThreads")
    .withIndex("by_agentThreadId", (q) => q.eq("agentThreadId", agentThreadId))
    .unique();
  if (!thread) return false;
  if (allowWeb !== undefined && threadWebSearchOn(thread) !== allowWeb) {
    await ctx.db.patch(thread._id, { webSearch: allowWeb });
    return allowWeb;
  }
  return threadWebSearchOn(thread);
}

export const webSourceValidator = v.object({
  n: v.number(),
  url: v.string(),
  title: v.string(),
  domain: v.string(),
});

export const turnWebSourcesValidator = v.object({
  promptMessageId: v.string(),
  toolCallId: v.optional(v.string()),
  query: v.string(),
  status: v.union(v.literal("ok"), v.literal("failed")),
  sources: v.array(webSourceValidator),
});

/**
 * The most records `listTurnWebSources` reads for one conversation: three
 * searches for each of the 200 turns the panel's turn window holds.
 */
export const MAX_THREAD_WEB_SEARCH_ROWS = 600;

/**
 * A conversation's newest search records, in creation order, without ids or
 * answer text. Review R2 P3-3: read newest first by creation time, so a long
 * conversation drops its oldest searches, never its newest.
 */
export async function listThreadWebSources(ctx: QueryCtx, agentThreadId: string) {
  const rows = await ctx.db
    .query("chatWebSearches")
    .withIndex("by_agentThreadId", (q) => q.eq("agentThreadId", agentThreadId))
    .order("desc")
    .take(MAX_THREAD_WEB_SEARCH_ROWS);
  return rows
    .reverse()
    .map((row) => ({
      promptMessageId: row.promptMessageId,
      ...(row.toolCallId ? { toolCallId: row.toolCallId } : {}),
      query: row.query,
      status: row.status,
      sources: row.sources.map(({ n, url, title, domain }) => ({ n, url, title, domain })),
    }));
}
