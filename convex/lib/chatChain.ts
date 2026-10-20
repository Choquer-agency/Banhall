import { saveMessage } from "@convex-dev/agent";
import { components, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { projectRollingCostUsdUnits, usdDecimalUnits } from "../aiUsage";
import { chatAdmissionLimits, chatAutoContinueEnabled } from "../appSettings";
import { isProjectDeleting } from "./projectDeletion";
import {
  autoContinueMessage,
  chainLinkMadeProgress,
  type ChatAutoContinueSkip,
} from "./chatTurnState";
import { turnSenders } from "./chatAuthors";
import { threadWebSearchOn } from "./chatWebSearches";
import { appendTurnAtTip, chatTipTurn, loadChatPath } from "./chatPath";
import { noteThreadActivity } from "./chatThreads";

/**
 * Report chat parity, Phase B (2026-10-20), W2: a long job carries on by
 * itself, as linked turns. When a reply ends with a Continue offer, the chat
 * action calls `chatV2.continueChain` as its very last step, and that one
 * transaction decides whether to start the next link and, if so, saves the
 * same writer message the Continue button sends, queues the turn and
 * schedules its reply. Owner decision 2026-10-19: no cap beyond the
 * project's daily chat budget; Stop on any link ends the chain.
 */

/** Stop pressed this soon after a reply with a Continue offer ends its chain. */
export const CHAIN_STOP_GRACE_MS = 30_000;

type ChainTurnKey = { agentThreadId: string; promptMessageId: string };

export type ContinueChainResult =
  | { kind: "linked"; promptMessageId: string }
  | { kind: "skipped"; reason: ChatAutoContinueSkip }
  | { kind: "none" };

async function threadRow(ctx: QueryCtx, agentThreadId: string) {
  return await ctx.db
    .query("agentChatThreads")
    .withIndex("by_agentThreadId", (q) => q.eq("agentThreadId", agentThreadId))
    .unique();
}

async function turnByPrompt(ctx: QueryCtx, key: ChainTurnKey) {
  return await ctx.db
    .query("chatTurns")
    .withIndex("by_agentThreadId_and_promptMessageId", (q) =>
      q.eq("agentThreadId", key.agentThreadId).eq("promptMessageId", key.promptMessageId)
    )
    .unique();
}

/**
 * Phase C (W2): the newest turn of the active path (the tip), which is the
 * thread's newest turn when it has no alternatives.
 */
async function newestTurn(ctx: QueryCtx, agentThreadId: string) {
  return await chatTipTurn(ctx, agentThreadId);
}

async function hasActiveTurn(ctx: QueryCtx, agentThreadId: string): Promise<boolean> {
  for (const status of ["running", "queued"] as const) {
    const active = await ctx.db
      .query("chatTurns")
      .withIndex("by_agentThreadId_and_status", (q) =>
        q.eq("agentThreadId", agentThreadId).eq("status", status)
      )
      .first();
    if (active) return true;
  }
  return false;
}

async function turnSavedAnyProposal(ctx: QueryCtx, key: ChainTurnKey): Promise<boolean> {
  const row = await ctx.db
    .query("chatProposals")
    .withIndex("by_agentThreadId_and_promptMessageId", (q) =>
      q.eq("agentThreadId", key.agentThreadId).eq("promptMessageId", key.promptMessageId)
    )
    .first();
  return row !== null;
}

/**
 * The project's rolling 24-hour chat spend is within its budget, read the
 * way `sendMessage` admits a turn. Usage rows are written by a scheduled
 * `logUsage`, so the reply that just ended may not be counted yet: a chain
 * can run one link past the budget, never more.
 */
async function withinBudget(ctx: QueryCtx, projectId: Id<"projects">): Promise<boolean> {
  const limits = await chatAdmissionLimits(ctx);
  const spent = await projectRollingCostUsdUnits(ctx, { projectId, now: Date.now() });
  return spent <= usdDecimalUnits(limits.dailyBudgetUsd);
}

/** How far back a link's progress check reads its chain. */
export const CHAIN_HISTORY_LIMIT = 50;

/**
 * The Continue offers of the chain before `order`: the automatic links
 * before it, newest first, and the turn that started the job (the first one
 * a person sent), bounded to CHAIN_HISTORY_LIMIT turns.
 */
async function chainBefore(ctx: QueryCtx, turn: Doc<"chatTurns">) {
  // Phase C (W2): the turns above `turn` on the active path, newest first,
  // walking parents (by order when the thread has no alternatives).
  const path = await loadChatPath(ctx, turn.agentThreadId);
  const turns: Doc<"chatTurns">[] = [];
  if (path) {
    let above = path.turns.find((row) => row._id === turn._id);
    for (above = above ? path.parentOf(above) ?? undefined : undefined;
      above && turns.length < CHAIN_HISTORY_LIMIT;
      above = path.parentOf(above) ?? undefined) {
      turns.push(above);
    }
  } else {
    turns.push(...await ctx.db
      .query("chatTurns")
      .withIndex("by_agentThreadId_and_order", (q) =>
        q.eq("agentThreadId", turn.agentThreadId).lt("order", turn.order)
      )
      .order("desc")
      .take(CHAIN_HISTORY_LIMIT));
  }
  const offers: Array<Doc<"chatTurns">["continuation"]> = [];
  for (const turn of turns) {
    offers.push(turn.continuation);
    if (turn.origin !== "auto_continue") break;
  }
  return offers;
}

/**
 * The sender may still use the report chat: the same actor rule as
 * `getInternalProjectAccessOrNull` (a non-anonymous user with a role), read
 * for a stored user rather than the caller. The project itself is checked
 * above (not being deleted).
 */
async function senderMayChat(ctx: QueryCtx, userId: Id<"users">): Promise<boolean> {
  const user = await ctx.db.get(userId);
  return !!user && user.isAnonymous !== true && !!user.role;
}

/** Whether a turn's ending offers Continue: completed, or cut off. */
function endedWithOffer(turn: Doc<"chatTurns">): boolean {
  if (!turn.continuation) return false;
  if (turn.status === "completed") return true;
  return turn.status === "failed" && turn.continuation.reason === "cut_off";
}

/**
 * Start the next link of a chain, or record why not. Runs once, at the very
 * end of the chat action, after every message of the turn was saved.
 *
 * Continues only when the turn ended with a Continue offer (completed, or
 * failed with a `cut_off` offer), Stop was not pressed just after it, it is
 * the thread's newest turn with nothing queued or running, the setting is
 * on, the turn made progress (a `lines_left` offer, or any card saved; for a
 * turn that was itself a link, fewer Deviations left or a new next Line),
 * and the project's chat spend is within budget. Skips for `budget`,
 * `no_progress` and `off` are recorded on the turn, so its Continue button
 * can say why; the other cases record nothing.
 *
 * A link does not go through `sendMessage`: it never counts toward the
 * queue limit, and the lease in `markTurnStarted` still holds it.
 */
export async function continueChain(ctx: MutationCtx, key: ChainTurnKey): Promise<ContinueChainResult> {
  const thread = await threadRow(ctx, key.agentThreadId);
  if (!thread || (await isProjectDeleting(ctx, thread.projectId))) return { kind: "none" };
  const turn = await turnByPrompt(ctx, key);
  if (!turn || !endedWithOffer(turn) || turn.chainStoppedAt !== undefined) return { kind: "none" };
  if (turn.autoContinueSkipped !== undefined) return { kind: "none" };
  // A newer writer message, or a link already started, wins.
  const newest = await newestTurn(ctx, key.agentThreadId);
  if (!newest || newest._id !== turn._id) return { kind: "none" };
  if (await hasActiveTurn(ctx, key.agentThreadId)) return { kind: "none" };
  const continuation = turn.continuation!;

  const skip = async (reason: ChatAutoContinueSkip): Promise<ContinueChainResult> => {
    await ctx.db.patch(turn._id, { autoContinueSkipped: reason });
    return { kind: "skipped", reason };
  };

  if (!(await chatAutoContinueEnabled(ctx))) return await skip("off");

  const progressed = continuation.reason === "lines_left" || (await turnSavedAnyProposal(ctx, key));
  if (!progressed) return await skip("no_progress");
  if (turn.origin === "auto_continue") {
    const earlier = await chainBefore(ctx, turn);
    if (!chainLinkMadeProgress(earlier, continuation)) return await skip("no_progress");
  }

  if (!(await withinBudget(ctx, thread.projectId))) return await skip("budget");

  // The link speaks for the person whose job it carries on. Review R1 P3-8:
  // a sender who no longer has access starts nothing, and nothing is
  // recorded (the Continue button stays for anyone who still may use it).
  const userId = (await turnSenders(ctx, [turn])).get(turn._id) ?? null;
  if (!userId || !(await senderMayChat(ctx, userId))) return { kind: "none" };

  const { messageId, message } = await saveMessage(ctx, components.agent, {
    threadId: key.agentThreadId,
    userId,
    message: { role: "user", content: autoContinueMessage(continuation) },
  });
  const linkId = await ctx.db.insert("chatTurns", {
    userId,
    agentThreadId: key.agentThreadId,
    promptMessageId: messageId,
    order: message.order,
    status: "queued",
    stepCount: 0,
    origin: "auto_continue",
  });
  // Phase C (W2): a link's parent is the turn it continues; it becomes the tip.
  await appendTurnAtTip(ctx, { _id: linkId, agentThreadId: key.agentThreadId, promptMessageId: messageId }, turn.promptMessageId);
  // Phase C (W3): a link is activity; it never restores an archived conversation.
  await noteThreadActivity(ctx, thread);
  // Brain off; web search from the conversation's own setting.
  await ctx.scheduler.runAfter(0, internal.ai.chatAgentV2.streamChatReply, {
    agentThreadId: key.agentThreadId,
    promptMessageId: messageId,
    reportId: thread.reportId,
    userId,
    ...(threadWebSearchOn(thread) ? { allowWeb: true } : {}),
  });
  return { kind: "linked", promptMessageId: messageId };
}

/**
 * Stop pressed on a reply that already finished. When it is the thread's
 * newest turn, it ended less than CHAIN_STOP_GRACE_MS ago and it offers
 * Continue, the chain must not go on from it: `chainStoppedAt` is recorded
 * and true returned. When a link already started from it (the writer's page
 * had not caught up), that link is stopped instead and its order returned,
 * so the caller can abort its stream too.
 */
export async function stopChainAfter(
  ctx: MutationCtx,
  turn: Doc<"chatTurns">
): Promise<{ stopped: false } | { stopped: true; linkOrder?: number }> {
  if (turn.status !== "completed" && turn.status !== "failed") return { stopped: false };
  const newest = await newestTurn(ctx, turn.agentThreadId);
  if (!newest) return { stopped: false };
  const now = Date.now();
  if (newest._id === turn._id) {
    if (!endedWithOffer(turn) || turn.endedAt === undefined || now - turn.endedAt >= CHAIN_STOP_GRACE_MS) {
      return { stopped: false };
    }
    await ctx.db.patch(turn._id, { chainStoppedAt: now });
    return { stopped: true };
  }
  // A link the server started from this very turn, still queued or running.
  if (newest.origin !== "auto_continue" || (newest.status !== "queued" && newest.status !== "running")) {
    return { stopped: false };
  }
  // Phase C (W2): the link's parent, the turn it continues.
  const before = newest.parentPromptMessageId !== undefined
    ? await turnByPrompt(ctx, { agentThreadId: turn.agentThreadId, promptMessageId: newest.parentPromptMessageId })
    : await ctx.db
      .query("chatTurns")
      .withIndex("by_agentThreadId_and_order", (q) =>
        q.eq("agentThreadId", turn.agentThreadId).lt("order", newest.order)
      )
      .order("desc")
      .first();
  if (before?._id !== turn._id) return { stopped: false };
  await ctx.db.patch(newest._id, { status: "aborted", endedAt: now });
  return { stopped: true, linkOrder: newest.order };
}

/**
 * Phase B, W2: whether any reply on the report runs now, whether one of the
 * viewer's does, and when the viewer's newest reply finished. Reads the 50
 * newest conversations of the report and the 3 newest turns of each.
 */
export const ACTIVITY_THREAD_LIMIT = 50;
export const ACTIVITY_TURNS_PER_THREAD = 3;

export async function reportChatActivity(
  ctx: QueryCtx,
  reportId: Id<"reports">,
  viewerId: Id<"users">
): Promise<{ active: boolean; mineActive: boolean; mineLastFinishedAt: number | null }> {
  const threads = await ctx.db
    .query("agentChatThreads")
    .withIndex("by_reportId", (q) => q.eq("reportId", reportId))
    .order("desc")
    .take(ACTIVITY_THREAD_LIMIT);
  let active = false;
  let mineActive = false;
  let mineLastFinishedAt: number | null = null;
  for (const thread of threads) {
    const turns = await ctx.db
      .query("chatTurns")
      .withIndex("by_agentThreadId_and_order", (q) => q.eq("agentThreadId", thread.agentThreadId))
      .order("desc")
      .take(ACTIVITY_TURNS_PER_THREAD);
    for (const turn of turns) {
      const running = turn.status === "queued" || turn.status === "running";
      if (running) active = true;
      if (turn.userId !== viewerId) continue;
      if (running) mineActive = true;
      if ((turn.status === "completed" || turn.status === "failed") && turn.endedAt !== undefined) {
        mineLastFinishedAt = Math.max(mineLastFinishedAt ?? 0, turn.endedAt);
      }
    }
  }
  return { active, mineActive, mineLastFinishedAt };
}
