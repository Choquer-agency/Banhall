import { v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";
import { components } from "./_generated/api";
import { getInternalProjectAccessOrNull, requireInternalProjectAccess } from "./lib/auth";
import { domainError } from "./lib/contracts";
import { deidentify, pseudonymize } from "./lib/deidentify";
import { isThreadDeleting } from "./lib/chatThreads";
import { listProjectTranscripts } from "./lib/transcripts";
import { projectPlaceholderMap } from "./lib/transcriptPlaceholders";
import type { QueryCtx } from "./_generated/server";
import { chatFeedbackReasonValidator } from "./lib/chatFeedbackReasons";
import {
  MAX_CHAT_FEEDBACK_REASON_CHARS,
  type ChatFeedbackReasonCode,
} from "../shared/chatFeedback";
import type { Doc } from "./_generated/dataModel";

const voteValidator = v.union(v.literal(1), v.literal(-1));
const MAX_TURNS = 200;
const MAX_TEXT = 4000;
// Each component page tracks merged-stream bytes, including prefetched docs.
// Reserve document overshoot and anchor reads: at most two pages, not 100 full
// historical bodies. Ordinary answers finish after the first returned record.
const FEEDBACK_PAGE_BYTES = 1 << 20;
// Keep the new stream below Convex read limits even with four Unicode-rich
// 4,000-character stored fields per row. Other streams retain their windows.
const MAX_DIGEST_ROWS = 20;
const DIGEST_PROMPT_CHARS = 500;
const DIGEST_ANSWER_CHARS = 1000;

function excerpt(text: string, limit: number): string {
  return Array.from(text).slice(0, limit).join("");
}

type FeedbackReason = { reasonCode: ChatFeedbackReasonCode; reasonText?: string };

/**
 * Phase C (W3): a reason goes with a thumbs down only. Its optional text is
 * trimmed and at most MAX_CHAT_FEEDBACK_REASON_CHARS; text without a code
 * counts as "other".
 */
function feedbackReason(args: {
  vote: 1 | -1;
  reasonCode?: ChatFeedbackReasonCode;
  reasonText?: string;
}): FeedbackReason | undefined {
  const text = args.reasonText?.replace(/\u0000/g, "").trim() ?? "";
  if (!args.reasonCode && !text) return undefined;
  if (args.vote !== -1) domainError("INVALID_INPUT", "A reason goes with a thumbs down only");
  if (text.length > MAX_CHAT_FEEDBACK_REASON_CHARS) {
    domainError("INVALID_INPUT", `A reason is limited to ${MAX_CHAT_FEEDBACK_REASON_CHARS} characters`);
  }
  return { reasonCode: args.reasonCode ?? "other", ...(text ? { reasonText: text } : {}) };
}

function storedReason(row: Doc<"chatAnswerFeedback">): FeedbackReason | undefined {
  return row.reasonCode
    ? { reasonCode: row.reasonCode, ...(row.reasonText ? { reasonText: row.reasonText } : {}) }
    : undefined;
}

/**
 * The reason as the learning digest may read it: the code, and the text
 * de-identified. Review R2 P3-8: the writer's own words can name anyone in
 * the project's transcripts, so they go through the project's placeholder
 * map (as research and web search do) before the record's names are removed.
 * The map is built only when there is text.
 */
async function snapshotReason(
  ctx: QueryCtx,
  reason: FeedbackReason | undefined,
  project: Doc<"projects">
): Promise<{ reasonCode?: ChatFeedbackReasonCode; reasonText?: string }> {
  if (!reason) return {};
  let text = "";
  if (reason.reasonText) {
    const placeholders = await projectPlaceholderMap(
      ctx, project, await listProjectTranscripts(ctx, project._id), [reason.reasonText]
    );
    text = deidentify(pseudonymize(reason.reasonText, placeholders), project).trim();
  }
  return { reasonCode: reason.reasonCode, ...(text ? { reasonText: text } : {}) };
}

export const submitFeedback = mutation({
  args: {
    turnId: v.id("chatTurns"),
    vote: voteValidator,
    // Phase C (W3): thumbs down only; cleared when the vote flips.
    reasonCode: v.optional(chatFeedbackReasonValidator),
    reasonText: v.optional(v.string()),
  },
  returns: voteValidator,
  handler: async (ctx, args) => {
    const reason = feedbackReason(args);
    const turn = await ctx.db.get(args.turnId);
    if (!turn) domainError("NOT_FOUND", "Chat answer not found");
    const thread = await ctx.db.query("agentChatThreads")
      .withIndex("by_agentThreadId", q => q.eq("agentThreadId", turn.agentThreadId)).unique();
    // Phase C (W3): a conversation being deleted takes no votes.
    if (!thread || isThreadDeleting(thread)) domainError("NOT_FOUND", "Chat answer not found");
    const { user, project } = await requireInternalProjectAccess(ctx, thread.projectId);
    const report = await ctx.db.get(thread.reportId);
    if (!report || report.projectId !== thread.projectId)
      domainError("NOT_FOUND", "Chat answer not found");
    if (turn.status !== "completed") domainError("INVALID_INPUT", "Rate an answer after it completes");
    const existing = await ctx.db.query("chatAnswerFeedback")
      .withIndex("by_turnId_and_userId", q => q.eq("turnId", turn._id).eq("userId", user._id)).unique();
    if (existing) {
      // Phase C (W3): the voter may change their vote or its reason. The
      // same vote without a reason keeps the reason already given; a flip
      // to thumbs up clears it.
      const previous = storedReason(existing);
      const next = args.vote === -1 ? (reason ?? (existing.vote === -1 ? previous : undefined)) : undefined;
      if (
        existing.vote === args.vote &&
        next?.reasonCode === previous?.reasonCode &&
        next?.reasonText === previous?.reasonText
      ) {
        return existing.vote;
      }
      await ctx.db.patch(existing._id, {
        vote: args.vote,
        reasonCode: next?.reasonCode,
        reasonText: next?.reasonText,
        updatedAt: Date.now(),
        changeCount: (existing.changeCount ?? 0) + 1,
        // A row saved before snapshots existed stays out of learning.
        ...(existing.learningSnapshot
          ? {
              learningSnapshot: {
                version: 2 as const,
                promptText: existing.learningSnapshot.promptText,
                answerText: existing.learningSnapshot.answerText,
                ...(await snapshotReason(ctx, next, project)),
              },
            }
          : {}),
      });
      return args.vote;
    }
    const [prompt] = await ctx.runQuery(components.agent.messages.getMessagesByIds, {
      messageIds: [turn.promptMessageId],
    });
    if (!prompt || prompt.threadId !== turn.agentThreadId || prompt.order !== turn.order ||
      prompt.status !== "success" || prompt.message?.role !== "user")
      domainError("INVALID_INPUT", "Chat answer is unavailable for feedback");
    const messages = await ctx.runQuery(components.agent.messages.listMessagesByThreadId, {
      threadId: turn.agentThreadId,
      upToAndIncludingMessageId: turn.promptMessageId,
      order: "desc",
      statuses: ["success"],
      excludeToolMessages: false,
      paginationOpts: { cursor: null, numItems: 1, maximumRowsRead: 1, maximumBytesRead: FEEDBACK_PAGE_BYTES },
    });
    // Descending component order selects the last visible assistant answer.
    // Never read tool output, reasoning, or a neighbouring turn as answer prose.
    let answer = messages.page.find(message => message.order === turn.order &&
      message.message?.role === "assistant" && textOnly(message.message.content).trim());
    if (!answer && !messages.isDone && messages.page.length > 0 &&
      messages.page.every(message => message.order === turn.order)) {
      const remaining = await ctx.runQuery(components.agent.messages.listMessagesByThreadId, {
        threadId: turn.agentThreadId,
        upToAndIncludingMessageId: turn.promptMessageId,
        order: "desc",
        statuses: ["success"],
        excludeToolMessages: false,
        paginationOpts: { cursor: messages.continueCursor, numItems: 99,
          maximumRowsRead: 99, maximumBytesRead: FEEDBACK_PAGE_BYTES },
      });
      answer = remaining.page.find(message => message.order === turn.order &&
        message.message?.role === "assistant" && textOnly(message.message.content).trim());
    }
    if (!answer || answer.message?.role !== "assistant")
      domainError("INVALID_INPUT", "Chat answer is unavailable within feedback read limits");
    const promptText = textOnly(prompt.message.content);
    const answerText = textOnly(answer.message.content);
    await ctx.db.insert("chatAnswerFeedback", {
      turnId: turn._id, userId: user._id, projectId: thread.projectId,
      reportId: thread.reportId, agentThreadId: turn.agentThreadId,
      promptMessageId: turn.promptMessageId, answerMessageId: answer._id,
      promptText: excerpt(promptText, MAX_TEXT), answerText: excerpt(answerText, MAX_TEXT),
      learningSnapshot: {
        version: 2,
        promptText: excerpt(deidentify(promptText, project), MAX_TEXT),
        answerText: excerpt(deidentify(answerText, project), MAX_TEXT),
        ...(await snapshotReason(ctx, reason, project)),
      },
      vote: args.vote, createdAt: Date.now(),
      ...(reason ?? {}),
    });
    return args.vote;
  },
});

/** Accept only text parts from validated component messages. */
function textOnly(content: string | Array<unknown>): string {
  if (typeof content === "string") return content.trim();
  return content.flatMap(part => typeof part === "object" && part !== null &&
    "type" in part && part.type === "text" && "text" in part && typeof part.text === "string"
    ? [part.text] : []).join("\n").trim();
}

export const getViewerVotes = query({
  args: { reportId: v.id("reports"), threadId: v.string(), turnIds: v.array(v.id("chatTurns")) },
  returns: v.array(v.object({
    turnId: v.id("chatTurns"),
    vote: voteValidator,
    reasonCode: v.optional(chatFeedbackReasonValidator),
    reasonText: v.optional(v.string()),
  })),
  handler: async (ctx, args) => {
    if (args.turnIds.length > MAX_TURNS) domainError("INVALID_INPUT", "Too many chat answers requested");
    const report = await ctx.db.get(args.reportId);
    if (!report) return [];
    const access = await getInternalProjectAccessOrNull(ctx, report.projectId);
    if (!access) return [];
    const thread = await ctx.db.query("agentChatThreads")
      .withIndex("by_agentThreadId", q => q.eq("agentThreadId", args.threadId)).unique();
    if (!thread || isThreadDeleting(thread) || thread.reportId !== report._id || thread.projectId !== report.projectId) return [];
    const votes = [];
    for (const turnId of new Set(args.turnIds)) {
      const turn = await ctx.db.get(turnId);
      if (!turn || turn.agentThreadId !== thread.agentThreadId || turn.status !== "completed") continue;
      const feedback = await ctx.db.query("chatAnswerFeedback")
        .withIndex("by_turnId_and_userId", q => q.eq("turnId", turnId).eq("userId", access.user._id)).unique();
      if (feedback && feedback.reportId === report._id && feedback.projectId === report.projectId &&
        feedback.agentThreadId === thread.agentThreadId) votes.push({ turnId, vote: feedback.vote, ...storedReason(feedback) });
    }
    return votes;
  },
});

/** When a vote last counted as a signal: its last change, else its creation. */
function signalTime(row: Doc<"chatAnswerFeedback">): number {
  return row.updatedAt ?? row.createdAt;
}

export const getFeedbackForDigest = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, args) => {
    const limit = Math.min(MAX_DIGEST_ROWS, Math.max(1, Math.floor(args.limit)));
    // Phase C (W3): a changed vote is a new signal. The newest `limit` by
    // signal time are all among the newest by creation plus the most
    // recently changed, so two bounded reads find them.
    const created = await ctx.db.query("chatAnswerFeedback").order("desc").take(limit);
    const changed = await ctx.db.query("chatAnswerFeedback")
      .withIndex("by_updatedAt", q => q.gt("updatedAt", 0)).order("desc").take(limit);
    const byId = new Map(created.map(row => [row._id, row]));
    for (const row of changed) byId.set(row._id, row);
    const rows = [...byId.values()]
      .sort((a, b) => signalTime(b) - signalTime(a) || b._creationTime - a._creationTime)
      .slice(0, limit);
    const signals = [];
    for (const row of rows) {
      if (!row.learningSnapshot?.answerText.trim()) continue;
      const reasonCode = row.vote === -1 ? row.learningSnapshot.reasonCode : undefined;
      const reasonText = reasonCode ? row.learningSnapshot.reasonText : undefined;
      signals.push({
        signalId: row._id, producerId: row.userId, projectId: row.projectId,
        updatedAt: signalTime(row),
        payload: { vote: row.vote, promptText: excerpt(row.learningSnapshot.promptText, DIGEST_PROMPT_CHARS),
          answerText: excerpt(row.learningSnapshot.answerText, DIGEST_ANSWER_CHARS),
          // Phase C (W3): the writer's stated reason for a thumbs down.
          ...(reasonCode ? { reason: { code: reasonCode, ...(reasonText ? { text: reasonText } : {}) } } : {}) },
      });
    }
    return signals;
  },
});
