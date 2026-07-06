import {
  query,
  mutation,
  internalQuery,
  internalMutation,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import { components, internal } from "./_generated/api";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import {
  abortStream,
  createThread,
  listUIMessages,
  saveMessage,
  syncStreams,
  vStreamArgs,
} from "@convex-dev/agent";
import { assertProjectOwner } from "./lib/auth";
import { pruneSnapshots } from "./lib/snapshots";
import { applyReplacements } from "./lib/reportEdits";

// ─── Agent-based chat plumbing (BNH-10 P2, parallel-run with chat.ts) ────────
// The @convex-dev/agent component owns threads/messages/stream deltas.
// agentChatThreads maps a report to its component thread; chatProposals holds
// the app-side edit lifecycle the component can't (pending/applied/rejected).

const highlightValidator = v.object({
  text: v.string(),
  from: v.number(),
  to: v.number(),
});

/** Resolve a component thread id to our mapping row (or null). */
async function threadRow(ctx: QueryCtx | MutationCtx, agentThreadId: string) {
  return await ctx.db
    .query("agentChatThreads")
    .withIndex("by_agentThreadId", (q) => q.eq("agentThreadId", agentThreadId))
    .unique();
}

// ─── Queries ─────────────────────────────────────────────────────────────────

export const listThreads = query({
  args: { reportId: v.id("reports") },
  handler: async (ctx, args) => {
    const report = await ctx.db.get(args.reportId);
    if (!report) return [];
    const project = await assertProjectOwner(ctx, report.projectId);
    if (!project) return [];

    return await ctx.db
      .query("agentChatThreads")
      .withIndex("by_reportId", (q) => q.eq("reportId", args.reportId))
      .order("desc")
      .collect();
  },
});

/**
 * UIMessages + live stream deltas for a thread. Shaped for useUIMessages
 * (takes paginationOpts + streamArgs, returns pagination result + streams).
 */
export const listMessages = query({
  args: {
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
    streamArgs: vStreamArgs,
  },
  handler: async (ctx, args) => {
    const thread = await threadRow(ctx, args.threadId);
    if (!thread) throw new Error("Thread not found");
    const project = await assertProjectOwner(ctx, thread.projectId);
    if (!project) throw new Error("Not authorized");

    const paginated = await listUIMessages(ctx, components.agent, {
      threadId: args.threadId,
      paginationOpts: args.paginationOpts,
    });
    const streams = await syncStreams(ctx, components.agent, {
      threadId: args.threadId,
      streamArgs: args.streamArgs,
    });
    return { ...paginated, streams };
  },
});

/** All proposals for a thread — reactive source for edit/highlight cards. */
export const listProposals = query({
  args: { threadId: v.string() },
  handler: async (ctx, args) => {
    const thread = await threadRow(ctx, args.threadId);
    if (!thread) return [];
    const project = await assertProjectOwner(ctx, thread.projectId);
    if (!project) return [];

    return await ctx.db
      .query("chatProposals")
      .withIndex("by_agentThreadId", (q) => q.eq("agentThreadId", args.threadId))
      .order("asc")
      .collect();
  },
});

// ─── Mutations ───────────────────────────────────────────────────────────────

export const sendMessage = mutation({
  args: {
    reportId: v.id("reports"),
    content: v.string(),
    threadId: v.optional(v.string()),
    highlight: v.optional(highlightValidator),
    /** Force a fresh thread even when the report already has one ("New chat"). */
    newThread: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const report = await ctx.db.get(args.reportId);
    if (!report) throw new Error("Report not found");
    const project = await assertProjectOwner(ctx, report.projectId);
    if (!project) throw new Error("Not authorized");
    if (!args.content.trim() && !args.highlight) {
      throw new Error("Message is empty");
    }
    const userId = await getAuthUserId(ctx);

    // Resolve (or create) the component thread for this report.
    let agentThreadId = args.threadId;
    if (agentThreadId) {
      const thread = await threadRow(ctx, agentThreadId);
      if (!thread || thread.projectId !== report.projectId) {
        throw new Error("Thread not found");
      }
    } else {
      const latest = args.newThread
        ? null
        : await ctx.db
            .query("agentChatThreads")
            .withIndex("by_reportId", (q) => q.eq("reportId", args.reportId))
            .order("desc")
            .first();
      if (latest) {
        agentThreadId = latest.agentThreadId;
      } else {
        const title = args.content.trim().slice(0, 60) || "New chat";
        agentThreadId = await createThread(ctx, components.agent, {
          userId: userId ?? undefined,
          title,
        });
        await ctx.db.insert("agentChatThreads", {
          projectId: report.projectId,
          reportId: args.reportId,
          agentThreadId,
          title,
          createdAt: Date.now(),
        });
      }
    }

    const excerpt = args.highlight
      ? `\n\n[Writer highlighted this excerpt from the report]:\n"""${args.highlight.text}"""`
      : "";
    const { messageId } = await saveMessage(ctx, components.agent, {
      threadId: agentThreadId,
      userId: userId ?? undefined,
      message: { role: "user", content: `${args.content}${excerpt}` },
    });

    await ctx.scheduler.runAfter(0, internal.ai.chatAgentV2.streamChatReply, {
      agentThreadId,
      promptMessageId: messageId,
      reportId: args.reportId,
    });

    return { threadId: agentThreadId, messageId };
  },
});

/**
 * Stop the in-flight assistant reply (the composer's Stop button). `order` is
 * the streaming message's order — the reply shares its prompt's order, so the
 * client can pass the last visible message's order whether the reply has
 * started rendering or not. Returns false when there was nothing to abort
 * (e.g. the stream finished, or hasn't been created yet).
 */
export const abortStreaming = mutation({
  args: { threadId: v.string(), order: v.number() },
  handler: async (ctx, args) => {
    const thread = await threadRow(ctx, args.threadId);
    if (!thread) throw new Error("Thread not found");
    const project = await assertProjectOwner(ctx, thread.projectId);
    if (!project) throw new Error("Not authorized");

    return await abortStream(ctx, components.agent, {
      threadId: args.threadId,
      order: args.order,
      reason: "Writer pressed stop",
    });
  },
});

export const applyProposal = mutation({
  args: { proposalId: v.id("chatProposals") },
  handler: async (ctx, args) => {
    const proposal = await ctx.db.get(args.proposalId);
    if (!proposal) throw new Error("Proposal not found");
    if (proposal.kind === "references") {
      throw new Error("Highlights have nothing to apply.");
    }
    const project = await assertProjectOwner(ctx, proposal.projectId);
    if (!project) throw new Error("Not authorized");

    const report = await ctx.db
      .query("reports")
      .withIndex("by_projectId", (q) => q.eq("projectId", proposal.projectId))
      .order("desc")
      .first();
    if (!report) throw new Error("Report not found");

    const pairs: { find: string; replaceWith: string }[] = (
      proposal.replacements && proposal.replacements.length
        ? proposal.replacements
        : proposal.targetText
          ? [{ find: proposal.targetText, replaceWith: proposal.newText ?? "" }]
          : []
    ).filter((p) => p.find);
    if (pairs.length === 0) {
      throw new Error("This edit has nothing to replace.");
    }

    const doc = JSON.parse(report.content);
    const { doc: updated, count } = applyReplacements(doc, pairs);
    if (count === 0) {
      throw new Error(
        "Couldn't find the original passage in the report to replace — it may have already changed. Try asking again."
      );
    }

    // Snapshot current state BEFORE editing so nothing is ever destroyed.
    await ctx.db.insert("reportSnapshots", {
      projectId: proposal.projectId,
      reportId: report._id,
      content: report.content,
      reason: "pre_chat_edit",
      label: "Before AI edit",
      createdByRole: "system",
      createdAt: Date.now(),
    });

    await ctx.db.patch(report._id, {
      content: JSON.stringify(updated),
      updatedAt: Date.now(),
    });
    await ctx.db.patch(args.proposalId, { state: "applied" });
    await pruneSnapshots(ctx, report._id);

    return { applied: true, count };
  },
});

/**
 * Mark applied without re-running the server replace (BNH-30: the writer
 * stepped through the one-by-one replace flow client-side, already autosaved).
 */
export const markProposalApplied = mutation({
  args: { proposalId: v.id("chatProposals") },
  handler: async (ctx, args) => {
    const proposal = await ctx.db.get(args.proposalId);
    if (!proposal) return;
    const project = await assertProjectOwner(ctx, proposal.projectId);
    if (!project) throw new Error("Not authorized");
    await ctx.db.patch(args.proposalId, { state: "applied" });
  },
});

export const rejectProposal = mutation({
  args: { proposalId: v.id("chatProposals") },
  handler: async (ctx, args) => {
    const proposal = await ctx.db.get(args.proposalId);
    if (!proposal) throw new Error("Proposal not found");
    const project = await assertProjectOwner(ctx, proposal.projectId);
    if (!project) throw new Error("Not authorized");
    await ctx.db.patch(args.proposalId, { state: "rejected" });
  },
});

// ─── Internal: tool + action support ─────────────────────────────────────────

export const saveProposal = internalMutation({
  args: {
    agentThreadId: v.string(),
    messageId: v.optional(v.string()),
    kind: v.union(
      v.literal("edit"),
      v.literal("replacements"),
      v.literal("references")
    ),
    targetText: v.optional(v.string()),
    newText: v.optional(v.string()),
    replacements: v.optional(
      v.array(v.object({ find: v.string(), replaceWith: v.string() }))
    ),
    references: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const thread = await threadRow(ctx, args.agentThreadId);
    if (!thread) throw new Error("Unknown agent thread");
    return await ctx.db.insert("chatProposals", {
      agentThreadId: args.agentThreadId,
      messageId: args.messageId,
      projectId: thread.projectId,
      reportId: thread.reportId,
      kind: args.kind,
      targetText: args.targetText,
      newText: args.newText,
      replacements: args.replacements,
      references: args.references,
      state: args.kind === "references" ? "applied" : "pending",
      createdAt: Date.now(),
    });
  },
});

/** Project industry for the searchBrain tool (null = tool politely declines). */
export const getThreadIndustry = internalQuery({
  args: { agentThreadId: v.string() },
  handler: async (ctx, args): Promise<string | null> => {
    const thread = await threadRow(ctx, args.agentThreadId);
    if (!thread) return null;
    const project = await ctx.db.get(thread.projectId);
    return project?.industry ?? null;
  },
});

/** Grounding context for streamChatReply — thread history stays componentside. */
export const getChatContextV2 = internalQuery({
  args: { reportId: v.id("reports"), agentThreadId: v.string() },
  handler: async (ctx, args) => {
    const report = await ctx.db.get(args.reportId);
    if (!report) throw new Error("Report not found");

    const generation = await ctx.db
      .query("generations")
      .withIndex("by_projectId", (q) => q.eq("projectId", report.projectId))
      .order("desc")
      .first();

    const documents = await ctx.db
      .query("projectDocuments")
      .withIndex("by_projectId", (q) => q.eq("projectId", report.projectId))
      .collect();

    // Recent edit decisions = the assistant's iteration memory (mirrors v1).
    const proposals = await ctx.db
      .query("chatProposals")
      .withIndex("by_agentThreadId", (q) =>
        q.eq("agentThreadId", args.agentThreadId)
      )
      .order("desc")
      .take(12);
    const decisions = proposals
      .filter((p) => p.kind !== "references")
      .slice(0, 6)
      .reverse()
      .map((p) => ({
        state: p.state,
        summary:
          p.newText ??
          (p.replacements
            ? p.replacements
                .map((r) => `"${r.find}" → "${r.replaceWith}"`)
                .join(", ")
            : ""),
      }));

    return {
      reportContent: report.content ?? null,
      agentOutputs: generation?.agentOutputs ?? null,
      documents: documents
        .filter((d) => !d.archived) // BNH-24: archived docs are out of AI context
        .map((d) => ({ fileName: d.fileName, content: d.content })),
      decisions,
    };
  },
});
