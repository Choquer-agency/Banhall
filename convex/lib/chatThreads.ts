import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { domainError } from "./contracts";

/**
 * Report chat parity, Phase C (2026-10-20), W3: conversation management.
 * Conversations sort by their last activity (a send or an automatic link),
 * can be renamed and archived, and an admin may delete one for everyone.
 * Archiving is reversible: an archived conversation leaves the menu, stays
 * readable, and a send in it restores it.
 */

/** The conversation menu lists at most this many. */
export const THREAD_LIST_LIMIT = 50;
/** Open conversations read, newest by creation, before sorting by activity. */
export const THREAD_LIST_SCAN = 200;
/** A conversation name after trimming. */
export const MAX_THREAD_TITLE_CHARS = 80;
/** A new conversation is named after the first words of its first message. */
const NEW_THREAD_TITLE_CHARS = 60;

type ThreadRow = Doc<"agentChatThreads">;

/** When the conversation last had a message; older rows use creation time. */
export function threadActivityAt(thread: Pick<ThreadRow, "lastActivityAt" | "createdAt">): number {
  return thread.lastActivityAt ?? thread.createdAt;
}

/**
 * The report's open conversations for the menu: the newest
 * THREAD_LIST_SCAN by creation, sorted by last activity, newest first,
 * at most THREAD_LIST_LIMIT. Equal times keep creation order.
 */
export async function listOpenThreads(
  ctx: QueryCtx,
  reportId: Id<"reports">
): Promise<ThreadRow[]> {
  const rows = await ctx.db
    .query("agentChatThreads")
    .withIndex("by_reportId_and_archivedAt", (q) =>
      q.eq("reportId", reportId).eq("archivedAt", undefined)
    )
    .order("desc")
    .take(THREAD_LIST_SCAN);
  return rows
    .sort((a, b) => threadActivityAt(b) - threadActivityAt(a))
    .slice(0, THREAD_LIST_LIMIT);
}

/** The report's archived conversations, most recently archived first. */
export async function listArchivedThreadRows(
  ctx: QueryCtx,
  reportId: Id<"reports">
): Promise<ThreadRow[]> {
  return await ctx.db
    .query("agentChatThreads")
    .withIndex("by_reportId_and_archivedAt", (q) =>
      q.eq("reportId", reportId).gt("archivedAt", 0)
    )
    .order("desc")
    .take(THREAD_LIST_LIMIT);
}

/** The newest open conversation by creation: a send without a thread continues it. */
export async function newestOpenThread(
  ctx: QueryCtx,
  reportId: Id<"reports">
): Promise<ThreadRow | null> {
  return await ctx.db
    .query("agentChatThreads")
    .withIndex("by_reportId_and_archivedAt", (q) =>
      q.eq("reportId", reportId).eq("archivedAt", undefined)
    )
    .order("desc")
    .first();
}

/**
 * A new conversation's name: the first message's opening words, cut at a
 * word boundary within NEW_THREAD_TITLE_CHARS, or "New chat".
 */
export function threadTitleFrom(content: string): string {
  const text = content.replace(/\s+/g, " ").trim();
  if (text.length <= NEW_THREAD_TITLE_CHARS) return text || "New chat";
  const cut = text.slice(0, NEW_THREAD_TITLE_CHARS + 1);
  const space = cut.lastIndexOf(" ");
  // A first word longer than half the limit is cut where the limit falls.
  return (space >= NEW_THREAD_TITLE_CHARS / 2 ? cut.slice(0, space) : text.slice(0, NEW_THREAD_TITLE_CHARS)).trim();
}

/** A writer's new name for a conversation: one line, 1 to 80 characters. */
export function renamedThreadTitle(title: string): string {
  const name = title.replace(/\s+/g, " ").trim();
  if (!name || name.length > MAX_THREAD_TITLE_CHARS) {
    domainError(
      "INVALID_INPUT",
      `A conversation name needs 1 to ${MAX_THREAD_TITLE_CHARS} characters.`
    );
  }
  return name;
}

async function threadByAgentId(ctx: QueryCtx, agentThreadId: string) {
  return await ctx.db
    .query("agentChatThreads")
    .withIndex("by_agentThreadId", (q) => q.eq("agentThreadId", agentThreadId))
    .unique();
}

/**
 * `chatV2.sendMessage`'s one call: the conversation had a message now, and
 * an archived conversation a writer sends in is restored.
 */
export async function noteThreadSend(ctx: MutationCtx, agentThreadId: string): Promise<void> {
  const thread = await threadByAgentId(ctx, agentThreadId);
  if (!thread) return;
  await ctx.db.patch(thread._id, {
    lastActivityAt: Date.now(),
    ...(thread.archivedAt !== undefined ? { archivedAt: undefined, archivedBy: undefined } : {}),
  });
}

/**
 * An automatic link (`lib/chatChain.ts`) is activity too. It never restores
 * an archived conversation: only a person's send does.
 */
export async function noteThreadActivity(ctx: MutationCtx, thread: ThreadRow): Promise<void> {
  await ctx.db.patch(thread._id, { lastActivityAt: Date.now() });
}
