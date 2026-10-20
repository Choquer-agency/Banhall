import { components } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

/**
 * Report chat parity, Phase B (2026-10-20), W2: who wrote each message of a
 * shared conversation, and who started it. Names only (first and last, then
 * the legacy single name), never an email, the same rule as the
 * CHAT_TURN_ACTIVE refusal's `turnSenderName`.
 */

/** A user's display name, or undefined when none is on record. */
export function chatDisplayName(user: Doc<"users"> | null | undefined): string | undefined {
  if (!user) return undefined;
  const full = [user.firstName?.trim(), user.lastName?.trim()].filter(Boolean).join(" ");
  return full || user.name?.trim() || undefined;
}

/** Prompt messages read per batch for turns saved before `chatTurns.userId`. */
const LEGACY_PROMPT_BATCH = 20;

/**
 * The sender of each turn: `chatTurns.userId`, or for a legacy turn the
 * prompt message's own user. Legacy prompts are read in small batches, and
 * only for turns that need them.
 */
export async function turnSenders(
  ctx: QueryCtx,
  turns: ReadonlyArray<Doc<"chatTurns">>
): Promise<Map<Id<"chatTurns">, Id<"users"> | null>> {
  const senders = new Map<Id<"chatTurns">, Id<"users"> | null>();
  const legacy: Doc<"chatTurns">[] = [];
  for (const turn of turns) {
    if (turn.userId) senders.set(turn._id, turn.userId);
    else legacy.push(turn);
  }
  for (let i = 0; i < legacy.length; i += LEGACY_PROMPT_BATCH) {
    const batch = legacy.slice(i, i + LEGACY_PROMPT_BATCH);
    let prompts: Array<{ userId?: string } | null>;
    try {
      prompts = await ctx.runQuery(components.agent.messages.getMessagesByIds, {
        messageIds: batch.map((turn) => turn.promptMessageId),
      });
    } catch {
      // A prompt that cannot be read leaves its turn without a name; author
      // labels must never fail the transcript read.
      prompts = [];
    }
    batch.forEach((turn, index) => {
      const userId = prompts[index]?.userId;
      senders.set(turn._id, userId ? ctx.db.normalizeId("users", userId) : null);
    });
  }
  return senders;
}

/** Display names for a set of users, one read each. */
export async function userNames(
  ctx: QueryCtx,
  userIds: Iterable<Id<"users"> | null | undefined>
): Promise<Map<Id<"users">, string | undefined>> {
  const names = new Map<Id<"users">, string | undefined>();
  for (const userId of userIds) {
    if (!userId || names.has(userId)) continue;
    names.set(userId, chatDisplayName(await ctx.db.get(userId)));
  }
  return names;
}

/**
 * Who started a conversation: `agentChatThreads.createdBy`, or for a row
 * created before that field, the sender of the thread's first turn.
 */
export async function threadStarter(
  ctx: QueryCtx,
  thread: Doc<"agentChatThreads">
): Promise<Id<"users"> | null> {
  if (thread.createdBy) return thread.createdBy;
  const first = await ctx.db
    .query("chatTurns")
    .withIndex("by_agentThreadId_and_order", (q) => q.eq("agentThreadId", thread.agentThreadId))
    .order("asc")
    .first();
  if (!first) return null;
  return (await turnSenders(ctx, [first])).get(first._id) ?? null;
}
