import { v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";
import { components } from "./_generated/api";
import { getInternalProjectAccessOrNull, requireInternalProjectAccess } from "./lib/auth";
import { domainError } from "./lib/contracts";
import { deidentify } from "./lib/deidentify";

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

export const submitFeedback = mutation({
  args: { turnId: v.id("chatTurns"), vote: voteValidator },
  returns: voteValidator,
  handler: async (ctx, args) => {
    const turn = await ctx.db.get(args.turnId);
    if (!turn) domainError("NOT_FOUND", "Chat answer not found");
    const thread = await ctx.db.query("agentChatThreads")
      .withIndex("by_agentThreadId", q => q.eq("agentThreadId", turn.agentThreadId)).unique();
    if (!thread) domainError("NOT_FOUND", "Chat answer not found");
    const { user, project } = await requireInternalProjectAccess(ctx, thread.projectId);
    const report = await ctx.db.get(thread.reportId);
    if (!report || report.projectId !== thread.projectId)
      domainError("NOT_FOUND", "Chat answer not found");
    if (turn.status !== "completed") domainError("INVALID_INPUT", "Rate an answer after it completes");
    const existing = await ctx.db.query("chatAnswerFeedback")
      .withIndex("by_turnId_and_userId", q => q.eq("turnId", turn._id).eq("userId", user._id)).unique();
    if (existing) return existing.vote;
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
        version: 1,
        promptText: excerpt(deidentify(promptText, project), MAX_TEXT),
        answerText: excerpt(deidentify(answerText, project), MAX_TEXT),
      },
      vote: args.vote, createdAt: Date.now(),
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
  returns: v.array(v.object({ turnId: v.id("chatTurns"), vote: voteValidator })),
  handler: async (ctx, args) => {
    if (args.turnIds.length > MAX_TURNS) domainError("INVALID_INPUT", "Too many chat answers requested");
    const report = await ctx.db.get(args.reportId);
    if (!report) return [];
    const access = await getInternalProjectAccessOrNull(ctx, report.projectId);
    if (!access) return [];
    const thread = await ctx.db.query("agentChatThreads")
      .withIndex("by_agentThreadId", q => q.eq("agentThreadId", args.threadId)).unique();
    if (!thread || thread.reportId !== report._id || thread.projectId !== report.projectId) return [];
    const votes = [];
    for (const turnId of new Set(args.turnIds)) {
      const turn = await ctx.db.get(turnId);
      if (!turn || turn.agentThreadId !== thread.agentThreadId || turn.status !== "completed") continue;
      const feedback = await ctx.db.query("chatAnswerFeedback")
        .withIndex("by_turnId_and_userId", q => q.eq("turnId", turnId).eq("userId", access.user._id)).unique();
      if (feedback && feedback.reportId === report._id && feedback.projectId === report.projectId &&
        feedback.agentThreadId === thread.agentThreadId) votes.push({ turnId, vote: feedback.vote });
    }
    return votes;
  },
});

export const getFeedbackForDigest = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, args) => {
    const limit = Math.min(MAX_DIGEST_ROWS, Math.max(1, Math.floor(args.limit)));
    const rows = await ctx.db.query("chatAnswerFeedback").order("desc").take(limit);
    const signals = [];
    for (const row of rows) {
      if (!row.learningSnapshot?.answerText.trim()) continue;
      signals.push({
        signalId: row._id, producerId: row.userId, projectId: row.projectId,
        updatedAt: row.createdAt,
        payload: { vote: row.vote, promptText: excerpt(row.learningSnapshot.promptText, DIGEST_PROMPT_CHARS),
          answerText: excerpt(row.learningSnapshot.answerText, DIGEST_ANSWER_CHARS) },
      });
    }
    return signals;
  },
});
