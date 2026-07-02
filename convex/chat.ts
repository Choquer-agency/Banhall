import {
  query,
  mutation,
  internalQuery,
  internalMutation,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { assertProjectOwner } from "./lib/auth";
import { pruneSnapshots } from "./lib/snapshots";
import { applyReplacements } from "./lib/reportEdits";

const highlightValidator = v.object({
  text: v.string(),
  from: v.number(),
  to: v.number(),
});

const proposedEditValidator = v.object({
  targetText: v.optional(v.string()),
  targetFrom: v.optional(v.number()),
  targetTo: v.optional(v.number()),
  newText: v.optional(v.string()),
  replacements: v.optional(
    v.array(v.object({ find: v.string(), replaceWith: v.string() }))
  ),
  summaryBefore: v.optional(v.string()),
  summaryAfter: v.optional(v.string()),
  state: v.union(
    v.literal("pending"),
    v.literal("applied"),
    v.literal("rejected")
  ),
});

// ─── Queries ─────────────────────────────────────────────────────────────────

export const listThreads = query({
  args: { reportId: v.id("reports") },
  handler: async (ctx, args) => {
    const report = await ctx.db.get(args.reportId);
    if (!report) return [];
    const project = await assertProjectOwner(ctx, report.projectId);
    if (!project) return [];

    return await ctx.db
      .query("chatThreads")
      .withIndex("by_reportId", (q) => q.eq("reportId", args.reportId))
      .order("desc")
      .collect();
  },
});

export const listMessages = query({
  args: { threadId: v.id("chatThreads") },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    if (!thread) return [];
    const project = await assertProjectOwner(ctx, thread.projectId);
    if (!project) return [];

    return await ctx.db
      .query("chatMessages")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .order("asc")
      .collect();
  },
});

/**
 * Project-wide chat log (all questions + answers across every thread) for
 * review and for growing the Brain. Owner-only, chronological.
 */
export const listProjectLog = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const project = await assertProjectOwner(ctx, args.projectId);
    if (!project) return [];

    const msgs = await ctx.db
      .query("chatMessages")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .order("asc")
      .collect();

    return msgs
      // Skip empty pending placeholders that haven't been answered yet.
      .filter((m) => !(m.role === "assistant" && m.status === "pending" && !m.content))
      .map((m) => ({
        _id: m._id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
        highlight: m.highlight?.text ?? null,
        proposedEdit: m.proposedEdit
          ? {
              newText:
                m.proposedEdit.newText ??
                (m.proposedEdit.replacements
                  ? m.proposedEdit.replacements
                      .map((r) => `"${r.find}" → "${r.replaceWith}"`)
                      .join(", ")
                  : undefined),
              state: m.proposedEdit.state,
            }
          : null,
      }));
  },
});

// ─── Mutations ───────────────────────────────────────────────────────────────

export const createThread = mutation({
  args: { reportId: v.id("reports") },
  handler: async (ctx, args) => {
    const report = await ctx.db.get(args.reportId);
    if (!report) throw new Error("Report not found");
    const project = await assertProjectOwner(ctx, report.projectId);
    if (!project) throw new Error("Not authorized");

    return await ctx.db.insert("chatThreads", {
      projectId: report.projectId,
      reportId: args.reportId,
      title: "New chat",
      createdAt: Date.now(),
    });
  },
});

export const sendMessage = mutation({
  args: {
    reportId: v.id("reports"),
    content: v.string(),
    threadId: v.optional(v.id("chatThreads")),
    highlight: v.optional(highlightValidator),
    attachmentIds: v.optional(v.array(v.id("projectDocuments"))),
  },
  handler: async (ctx, args) => {
    const report = await ctx.db.get(args.reportId);
    if (!report) throw new Error("Report not found");
    const project = await assertProjectOwner(ctx, report.projectId);
    if (!project) throw new Error("Not authorized");

    if (!args.content.trim() && !args.highlight) {
      throw new Error("Message is empty");
    }

    // Resolve (or create) the thread.
    let threadId = args.threadId;
    if (threadId) {
      const thread = await ctx.db.get(threadId);
      if (!thread || thread.projectId !== report.projectId) {
        throw new Error("Thread not found");
      }
    } else {
      const latest = await ctx.db
        .query("chatThreads")
        .withIndex("by_reportId", (q) => q.eq("reportId", args.reportId))
        .order("desc")
        .first();
      threadId =
        latest?._id ??
        (await ctx.db.insert("chatThreads", {
          projectId: report.projectId,
          reportId: args.reportId,
          title: args.content.trim().slice(0, 60) || "New chat",
          createdAt: Date.now(),
        }));
    }

    const now = Date.now();

    await ctx.db.insert("chatMessages", {
      threadId,
      projectId: report.projectId,
      reportId: args.reportId,
      role: "writer",
      content: args.content,
      status: "complete",
      ...(args.highlight ? { highlight: args.highlight } : {}),
      ...(args.attachmentIds && args.attachmentIds.length
        ? { attachmentIds: args.attachmentIds }
        : {}),
      createdAt: now,
    });

    // Placeholder assistant message the action will fill in.
    const assistantMessageId = await ctx.db.insert("chatMessages", {
      threadId,
      projectId: report.projectId,
      reportId: args.reportId,
      role: "assistant",
      content: "",
      status: "pending",
      createdAt: now + 1,
    });

    await ctx.scheduler.runAfter(0, internal.ai.chatAgent.processChatMessage, {
      threadId,
      assistantMessageId,
    });

    return { threadId, assistantMessageId };
  },
});

export const applyProposedEdit = mutation({
  args: { messageId: v.id("chatMessages") },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (!message) throw new Error("Message not found");
    if (!message.proposedEdit) throw new Error("No proposed edit on this message");

    const project = await assertProjectOwner(ctx, message.projectId);
    if (!project) throw new Error("Not authorized");

    const report = await ctx.db
      .query("reports")
      .withIndex("by_projectId", (q) => q.eq("projectId", message.projectId))
      .order("desc")
      .first();
    if (!report) throw new Error("Report not found");

    const { targetText, newText, replacements } = message.proposedEdit;

    // Build the find/replace pairs: an explicit multi-instance list (BNH-27) or
    // the single passage replacement. Empty/invalid pairs are dropped.
    const pairs: { find: string; replaceWith: string }[] = (
      replacements && replacements.length
        ? replacements
        : targetText
          ? [{ find: targetText, replaceWith: newText ?? "" }]
          : []
    ).filter((p) => p.find);

    if (pairs.length === 0) {
      throw new Error("This edit has nothing to replace.");
    }

    // Apply every pair to every occurrence in the report JSON.
    const doc = JSON.parse(report.content);
    const { doc: updated, count } = applyReplacements(doc, pairs);

    if (count === 0) {
      throw new Error(
        "Couldn't find the original passage in the report to replace — it may have already changed. Try asking again."
      );
    }

    // Snapshot current state BEFORE editing so nothing is ever destroyed.
    await ctx.db.insert("reportSnapshots", {
      projectId: message.projectId,
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

    await ctx.db.patch(args.messageId, {
      proposedEdit: { ...message.proposedEdit, state: "applied" },
    });

    await pruneSnapshots(ctx, report._id);

    return { applied: true, count };
  },
});

/**
 * BNH-30: mark a proposed edit as applied without re-running the server replace.
 * Used after the writer steps through the one-by-one replace flow in the live
 * editor (the document edits already happened client-side + autosaved).
 */
export const markProposedEditApplied = mutation({
  args: { messageId: v.id("chatMessages") },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (!message) throw new Error("Message not found");
    if (!message.proposedEdit) return;
    const project = await assertProjectOwner(ctx, message.projectId);
    if (!project) throw new Error("Not authorized");
    await ctx.db.patch(args.messageId, {
      proposedEdit: { ...message.proposedEdit, state: "applied" },
    });
  },
});

export const rejectProposedEdit = mutation({
  args: { messageId: v.id("chatMessages") },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (!message) throw new Error("Message not found");
    if (!message.proposedEdit) throw new Error("No proposed edit on this message");

    const project = await assertProjectOwner(ctx, message.projectId);
    if (!project) throw new Error("Not authorized");

    await ctx.db.patch(args.messageId, {
      proposedEdit: { ...message.proposedEdit, state: "rejected" },
    });

    // Ask the writer why — so the assistant can learn and do better next time.
    await ctx.db.insert("chatMessages", {
      threadId: message.threadId,
      projectId: message.projectId,
      reportId: message.reportId,
      role: "assistant",
      content:
        "No problem — I've set that version aside. Tell me what to change or what felt off, and I'll revise it and bring it right back.",
      status: "complete",
      createdAt: Date.now(),
    });
  },
});

// ─── Internal: used by the chat agent action ──────────────────────────────────

export const getChatContext = internalQuery({
  args: { threadId: v.id("chatThreads") },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    if (!thread) throw new Error("Thread not found");

    const report = await ctx.db
      .query("reports")
      .withIndex("by_projectId", (q) => q.eq("projectId", thread.projectId))
      .order("desc")
      .first();

    const generation = await ctx.db
      .query("generations")
      .withIndex("by_projectId", (q) => q.eq("projectId", thread.projectId))
      .order("desc")
      .first();

    const documents = await ctx.db
      .query("projectDocuments")
      .withIndex("by_projectId", (q) => q.eq("projectId", thread.projectId))
      .collect();

    const messages = await ctx.db
      .query("chatMessages")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .order("asc")
      .collect();

    return {
      projectId: thread.projectId,
      reportContent: report?.content ?? null,
      agentOutputs: generation?.agentOutputs ?? null,
      documents: documents
        .filter((d) => !d.archived) // BNH-24: archived docs are out of AI context
        .map((d) => ({
          fileName: d.fileName,
          content: d.content,
        })),
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
        status: m.status,
        highlight: m.highlight ?? null,
        proposedEdit: m.proposedEdit
          ? {
              newText:
                m.proposedEdit.newText ??
                (m.proposedEdit.replacements
                  ? m.proposedEdit.replacements
                      .map((r) => `"${r.find}" → "${r.replaceWith}"`)
                      .join(", ")
                  : undefined),
              state: m.proposedEdit.state,
            }
          : null,
      })),
    };
  },
});

export const completeAssistantMessage = internalMutation({
  args: {
    messageId: v.id("chatMessages"),
    content: v.string(),
    status: v.union(v.literal("complete"), v.literal("error")),
    proposedEdit: v.optional(proposedEditValidator),
    references: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.messageId, {
      content: args.content,
      status: args.status,
      ...(args.proposedEdit ? { proposedEdit: args.proposedEdit } : {}),
      ...(args.references ? { references: args.references } : {}),
    });
  },
});
