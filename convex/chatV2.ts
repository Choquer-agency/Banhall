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
import {
  abortStream,
  createThread,
  listUIMessages,
  saveMessage,
  syncStreams,
  vStreamArgs,
} from "@convex-dev/agent";
import {
  getInternalProjectAccessOrNull,
  requireInternalProjectAccess,
} from "./lib/auth";
import { requireAnthropicConfigured } from "./lib/providerConfig";
import { pruneSnapshots, snapshotAuditFields } from "./lib/snapshots";
import { applyReplacements, type PMNode } from "./lib/reportEdits";
import { domainError, sha256 } from "./lib/contracts";
import { normalizeCraScienceCode } from "../shared/craScienceCodes";
import { proposalPairs } from "../shared/chatProposals";

// ─── Agent-based chat plumbing (BNH-10 P2; sole pipeline since Jul 22) ───────
// The @convex-dev/agent component owns threads/messages/stream deltas.
// agentChatThreads maps a report to its component thread; chatProposals holds
// the app-side edit lifecycle the component can't (pending/applied/rejected).

const highlightValidator = v.object({
  text: v.string(),
  from: v.number(),
  to: v.number(),
});

const chatTurnStatusValidator = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("aborted")
);

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
    if (!(await getInternalProjectAccessOrNull(ctx, report.projectId))) return [];

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
    await requireInternalProjectAccess(ctx, thread.projectId);

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
    if (!(await getInternalProjectAccessOrNull(ctx, thread.projectId))) return [];

    return await ctx.db
      .query("chatProposals")
      .withIndex("by_agentThreadId", (q) => q.eq("agentThreadId", args.threadId))
      .order("asc")
      .collect();
  },
});

export const listTurns = query({
  args: {
    threadId: v.string(),
    startOrder: v.number(),
    endOrder: v.number(),
  },
  handler: async (ctx, args) => {
    if (args.startOrder > args.endOrder) return [];

    const thread = await threadRow(ctx, args.threadId);
    if (!thread) return [];
    if (!(await getInternalProjectAccessOrNull(ctx, thread.projectId))) return [];

    const turns = await ctx.db
      .query("chatTurns")
      .withIndex("by_agentThreadId_and_order", (q) =>
        q
          .eq("agentThreadId", args.threadId)
          .gte("order", args.startOrder)
          .lte("order", args.endOrder)
      )
      .order("desc")
      .take(200);
    return turns.reverse();
  },
});

// ─── Mutations ───────────────────────────────────────────────────────────────

export const sendMessage = mutation({
  args: {
    reportId: v.id("reports"),
    content: v.string(),
    threadId: v.optional(v.string()),
    highlight: v.optional(highlightValidator),
    refineProposalId: v.optional(v.id("chatProposals")),
    /** Force a fresh thread even when the report already has one ("New chat"). */
    newThread: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const report = await ctx.db.get(args.reportId);
    if (!report) throw new Error("Report not found");
    const { user } = await requireInternalProjectAccess(ctx, report.projectId);
    requireAnthropicConfigured("chat");
    if (!args.content.trim() && !args.highlight) {
      throw new Error("Message is empty");
    }
    const userId = user._id;

    let refineProposal;
    if (args.refineProposalId) {
      refineProposal = await ctx.db.get(args.refineProposalId);
      if (
        !refineProposal ||
        refineProposal.reportId !== report._id ||
        refineProposal.projectId !== report.projectId ||
        refineProposal.kind === "references"
      ) {
        throw new Error("Suggestion not found");
      }
    }

    // Resolve (or create) the component thread for this report.
    let agentThreadId = args.threadId;
    if (agentThreadId) {
      const thread = await threadRow(ctx, agentThreadId);
      if (
        !thread ||
        thread.projectId !== report.projectId ||
        thread.reportId !== report._id
      ) {
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
          userId,
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
    const refinement = refineProposal
      ? `\n\n[Writer is refining suggestion ${refineProposal._id}. Keep this exact canonical report target:]
"""${proposalPairs(refineProposal).map((pair) => pair.find).join("\n---\n")}"""
[Current candidate wording:]
"""${proposalPairs(refineProposal).map((pair) => pair.replaceWith).join("\n---\n")}"""`
      : "";
    const { messageId, message } = await saveMessage(ctx, components.agent, {
      threadId: agentThreadId,
      userId,
      message: { role: "user", content: `${args.content}${excerpt}${refinement}` },
    });

    await ctx.db.insert("chatTurns", {
      agentThreadId,
      promptMessageId: messageId,
      order: message.order,
      status: "queued",
      stepCount: 0,
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
    await requireInternalProjectAccess(ctx, thread.projectId);

    const turn = await ctx.db
      .query("chatTurns")
      .withIndex("by_agentThreadId_and_order", (q) =>
        q.eq("agentThreadId", args.threadId).eq("order", args.order)
      )
      .unique();
    const appTurnStopped =
      turn?.status === "queued" || turn?.status === "running";
    if (appTurnStopped) {
      await ctx.db.patch(turn._id, {
        status: "aborted",
        endedAt: Date.now(),
      });
    }

    const componentStreamStopped = await abortStream(ctx, components.agent, {
      threadId: args.threadId,
      order: args.order,
      reason: "Writer pressed stop",
    });
    return appTurnStopped || componentStreamStopped;
  },
});

export const applyProposal = mutation({
  args: { proposalId: v.id("chatProposals") },
  handler: async (ctx, args) => {
    const proposal = await ctx.db.get(args.proposalId);
    if (!proposal) domainError("NOT_FOUND", "Proposal not found");
    if (proposal.kind === "references") {
      domainError("INVALID_INPUT", "Highlights have nothing to apply.");
    }
    await requireInternalProjectAccess(ctx, proposal.projectId);
    if (proposal.state === "applied") {
      return { applied: true as const, count: 0, alreadyApplied: true as const };
    }
    if (proposal.state !== "pending") {
      domainError(
        "INVALID_INPUT",
        proposal.state === "stale"
          ? "This suggestion no longer matches the current report. Ask the assistant to regenerate it."
          : "This suggestion is no longer available to apply."
      );
    }
    const report = await ctx.db.get(proposal.reportId);
    if (!report || report.projectId !== proposal.projectId) {
      domainError("NOT_FOUND", "Report not found");
    }

    const pairs = proposalPairs(proposal);
    if (pairs.length === 0) {
      domainError("INVALID_INPUT", "This edit has nothing to replace.");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(report.content);
    } catch {
      domainError("INVALID_INPUT", "The report content is not valid editor JSON");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      domainError("INVALID_INPUT", "The report content is not a valid editor document");
    }
    const { doc: updated, count } = applyReplacements(parsed as PMNode, pairs);
    if (count === 0) {
      await ctx.db.patch(args.proposalId, { state: "stale" });
      return {
        applied: false as const,
        count: 0,
        reason:
          "Couldn't find the original passage in the current report. This suggestion may be based on wording that was rejected or already changed.",
      };
    }
    // Producer-declared single-target proposals (older research proposals
    // predate the flag, hence the researchSessionId fallback).
    const requireUniqueTarget =
      proposal.requireUniqueTarget ?? proposal.researchSessionId !== undefined;
    if (requireUniqueTarget && count !== 1) {
      domainError(
        "STALE_REVISION",
        "The target passage is no longer unique in this report. Review and apply this edit manually to avoid changing another occurrence."
      );
    }

    const content = JSON.stringify(updated);
    const revisionNumber = report.revisionNumber ?? 0;
    const now = Date.now();
    const auditFields = await snapshotAuditFields(ctx, report);
    // Provenance for version history. The research layer owns the evidence
    // policy (brain patterns never count) and stored the number at review time.
    const researchSourceCount = proposal.researchSessionId
      ? ((await ctx.db.get(proposal.researchSessionId))?.evidenceSourceCount ?? 0)
      : 0;
    await ctx.db.insert("reportSnapshots", {
      projectId: report.projectId,
      reportId: report._id,
      content: report.content,
      ...auditFields,
      sourceRevisionNumber: revisionNumber,
      reason: "pre_chat_edit",
      label: proposal.researchSessionId ? "Before researched edit" : "Before AI edit",
      createdByRole: "system",
      createdAt: now,
      ...(proposal.researchSessionId
        ? {
            researchSessionId: proposal.researchSessionId,
            researchSourceCount,
          }
        : {}),
    });
    await ctx.db.patch(report._id, {
      content,
      contentHash: await sha256(content),
      revisionNumber: revisionNumber + 1,
      provenanceId: undefined,
      updatedAt: now,
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
    await requireInternalProjectAccess(ctx, proposal.projectId);
    await ctx.db.patch(args.proposalId, { state: "applied" });
  },
});

export const updateProposalWording = mutation({
  args: {
    proposalId: v.id("chatProposals"),
    newText: v.optional(v.string()),
    replacements: v.optional(
      v.array(v.object({ find: v.string(), replaceWith: v.string() }))
    ),
  },
  handler: async (ctx, args) => {
    const proposal = await ctx.db.get(args.proposalId);
    if (!proposal) domainError("NOT_FOUND", "Suggestion not found");
    const { user } = await requireInternalProjectAccess(ctx, proposal.projectId);
    if (proposal.state !== "pending") {
      domainError("INVALID_INPUT", "Only a pending suggestion can be edited.");
    }
    if (proposal.kind === "references") {
      domainError("INVALID_INPUT", "A highlight suggestion has no wording to edit.");
    }

    const originalText = proposalPairs(proposal)
      .map((pair) => pair.replaceWith)
      .join("\n---\n");
    let editedText: string;
    let patch: {
      newText?: string;
      replacements?: Array<{ find: string; replaceWith: string }>;
    };

    if (proposal.kind === "edit") {
      if (args.replacements !== undefined || args.newText === undefined) {
        domainError("INVALID_INPUT", "Provide the edited wording for this suggestion.");
      }
      editedText = args.newText.trim();
      patch = { newText: editedText };
    } else {
      if (args.newText !== undefined || !args.replacements) {
        domainError("INVALID_INPUT", "Provide every edited replacement.");
      }
      const current = proposal.replacements ?? [];
      if (
        args.replacements.length !== current.length ||
        args.replacements.some((pair, index) => pair.find !== current[index]?.find)
      ) {
        domainError(
          "INVALID_INPUT",
          "The report targets changed. Edit only the replacement wording."
        );
      }
      const replacements = args.replacements.map((pair) => ({
        find: pair.find,
        replaceWith: pair.replaceWith.trim(),
      }));
      editedText = replacements.map((pair) => pair.replaceWith).join("\n---\n");
      patch = { replacements };
    }

    if (editedText === originalText) return { updated: false as const };
    const now = Date.now();
    await ctx.db.patch(proposal._id, {
      ...patch,
      wordingEditedBy: user._id,
      wordingEditedAt: now,
      wordingEditCount: (proposal.wordingEditCount ?? 0) + 1,
    });
    await ctx.db.insert("proposalWordingEditEvents", {
      projectId: proposal.projectId,
      reportId: proposal.reportId,
      proposalId: proposal._id,
      userId: user._id,
      originalText,
      editedText,
      createdAt: now,
    });
    return { updated: true as const };
  },
});

export const rejectProposal = mutation({
  args: { proposalId: v.id("chatProposals") },
  handler: async (ctx, args) => {
    const proposal = await ctx.db.get(args.proposalId);
    if (!proposal) throw new Error("Proposal not found");
    await requireInternalProjectAccess(ctx, proposal.projectId);
    if (proposal.state === "applied") {
      domainError("INVALID_INPUT", "An applied suggestion cannot be rejected.");
    }
    if (proposal.state !== "rejected") {
      await ctx.db.patch(args.proposalId, { state: "rejected" });
    }
  },
});

// ─── Internal: tool + action support ─────────────────────────────────────────

/**
 * Whether a started turn is still allowed to do work. `markTurnStarted` fences
 * the scheduler gap, but context loading takes long enough that the writer can
 * press stop after it — without a second check the action would keep
 * generating text and proposals for a turn already reported as stopped.
 */
export const isTurnActive = internalQuery({
  args: { agentThreadId: v.string(), promptMessageId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const turn = await ctx.db
      .query("chatTurns")
      .withIndex("by_agentThreadId_and_promptMessageId", (q) =>
        q
          .eq("agentThreadId", args.agentThreadId)
          .eq("promptMessageId", args.promptMessageId)
      )
      .unique();
    // A missing row predates chatTurns; let those turns run.
    return !turn || turn.status === "queued" || turn.status === "running";
  },
});

export const markTurnStarted = internalMutation({
  args: {
    agentThreadId: v.string(),
    promptMessageId: v.string(),
    startedAt: v.number(),
  },
  returns: v.object({
    shouldRun: v.boolean(),
    status: chatTurnStatusValidator,
  }),
  handler: async (ctx, args) => {
    const turn = await ctx.db
      .query("chatTurns")
      .withIndex("by_agentThreadId_and_promptMessageId", (q) =>
        q
          .eq("agentThreadId", args.agentThreadId)
          .eq("promptMessageId", args.promptMessageId)
      )
      .unique();

    if (!turn) return { shouldRun: true, status: "running" as const };
    if (turn.status === "queued") {
      await ctx.db.patch(turn._id, {
        status: "running",
        ...(turn.startedAt === undefined ? { startedAt: args.startedAt } : {}),
      });
      return { shouldRun: true, status: "running" as const };
    }
    if (turn.status === "running") {
      return { shouldRun: true, status: "running" as const };
    }
    return { shouldRun: false, status: turn.status };
  },
});

export const finishTurn = internalMutation({
  args: {
    agentThreadId: v.string(),
    promptMessageId: v.string(),
    requestedStatus: v.union(v.literal("completed"), v.literal("failed")),
    endedAt: v.number(),
    stepCount: v.number(),
  },
  returns: v.object({ status: chatTurnStatusValidator }),
  handler: async (ctx, args) => {
    const turn = await ctx.db
      .query("chatTurns")
      .withIndex("by_agentThreadId_and_promptMessageId", (q) =>
        q
          .eq("agentThreadId", args.agentThreadId)
          .eq("promptMessageId", args.promptMessageId)
      )
      .unique();
    if (!turn) return { status: args.requestedStatus };

    const stepCount = Number.isFinite(args.stepCount)
      ? Math.max(0, Math.floor(args.stepCount))
      : 0;
    if (turn.status === "queued" || turn.status === "running") {
      await ctx.db.patch(turn._id, {
        status: args.requestedStatus,
        endedAt: args.endedAt,
        stepCount,
      });
      return { status: args.requestedStatus };
    }
    if (turn.status === "aborted") {
      if (stepCount > turn.stepCount) {
        await ctx.db.patch(turn._id, { stepCount });
      }
      return { status: "aborted" as const };
    }
    return { status: turn.status };
  },
});

/**
 * Cron reaper (mirrors generations.failStaleGenerations): finishTurn only
 * runs from streamChatReply's own success/catch paths, so a hard action death
 * (deploy restart, timeout, OOM) strands a turn in "queued"/"running" and the
 * composer ticks "Working…" forever. Fail anything active past the cutoff —
 * the UI already renders failed turns, and the writer just sends again.
 * Status-CAS: terminal turns (completed/failed/aborted) are never touched.
 * `npx convex run chatV2:failStaleChatTurns '{"olderThanMinutes":15}'`
 */
export const failStaleChatTurns = internalMutation({
  args: { olderThanMinutes: v.optional(v.number()) },
  returns: v.object({ failed: v.number() }),
  handler: async (ctx, args) => {
    const cutoff = Date.now() - (args.olderThanMinutes ?? 15) * 60 * 1000;
    let failed = 0;
    for (const status of ["queued", "running"] as const) {
      const turns = await ctx.db
        .query("chatTurns")
        .withIndex("by_status", (q) => q.eq("status", status))
        .take(200);
      for (const turn of turns) {
        // Queued rows never got startedAt; age them from creation instead.
        if ((turn.startedAt ?? turn._creationTime) >= cutoff) continue;
        await ctx.db.patch(turn._id, {
          status: "failed",
          endedAt: Date.now(),
        });
        failed += 1;
      }
    }
    return { failed };
  },
});

export const saveProposal = internalMutation({
  args: {
    agentThreadId: v.string(),
    toolCallId: v.optional(v.string()),
    promptMessageId: v.optional(v.string()),
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

    // Final stop fence. The action's pre-stream check can't cover the instant
    // between it and the model's first tool call, and a card appearing after
    // the writer pressed stop is the visible harm. This mutation is the single
    // write path for every proposal tool, so the check lands atomically here.
    if (args.promptMessageId) {
      const turn = await ctx.db
        .query("chatTurns")
        .withIndex("by_agentThreadId_and_promptMessageId", (q) =>
          q
            .eq("agentThreadId", args.agentThreadId)
            .eq("promptMessageId", args.promptMessageId!)
        )
        .unique();
      if (turn && turn.status !== "queued" && turn.status !== "running") {
        return {
          ok: false as const,
          stopped: true as const,
          reason: "The writer stopped this reply.",
        };
      }
    }

    if (args.toolCallId) {
      const existing = await ctx.db
        .query("chatProposals")
        .withIndex("by_agentThreadId_and_toolCallId", (q) =>
          q.eq("agentThreadId", args.agentThreadId).eq("toolCallId", args.toolCallId)
        )
        .unique();
      if (existing) return { ok: true as const, proposalId: existing._id };
    }

    const report = await ctx.db.get(thread.reportId);
    if (!report) return { ok: false as const, reason: "The current report could not be loaded." };
    let parsed: unknown;
    try {
      parsed = JSON.parse(report.content);
    } catch {
      return { ok: false as const, reason: "The current report is not valid editor content." };
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false as const, reason: "The current report is not valid editor content." };
    }

    const pairs = proposalPairs(args);
    if (args.kind !== "references") {
      if (pairs.length === 0) {
        return { ok: false as const, reason: "The suggestion did not include text to replace." };
      }
      for (const pair of pairs) {
        const { count } = applyReplacements(parsed as PMNode, [pair]);
        if (count === 0) {
          return {
            ok: false as const,
            reason:
              "The proposed target is not in the CURRENT REPORT. Re-copy the canonical passage from the report; do not use wording from an earlier rejected or unapplied suggestion as targetText.",
          };
        }
        if (args.kind === "edit" && count !== 1) {
          return {
            ok: false as const,
            reason: `The proposed target matches ${count} places. Include more surrounding words so it identifies exactly one passage.`,
          };
        }
      }
    } else {
      const references = (args.references ?? []).filter((reference) => {
        if (!reference) return false;
        return applyReplacements(parsed as PMNode, [
          { find: reference, replaceWith: reference },
        ]).count > 0;
      });
      if (references.length === 0) {
        return {
          ok: false as const,
          reason: "None of the highlighted passages are in the CURRENT REPORT. Re-copy them from the report.",
        };
      }
      args.references = references;
    }

    const proposalId = await ctx.db.insert("chatProposals", {
      agentThreadId: args.agentThreadId,
      toolCallId: args.toolCallId,
      promptMessageId: args.promptMessageId,
      messageId: args.messageId,
      projectId: thread.projectId,
      reportId: thread.reportId,
      kind: args.kind,
      targetText: args.targetText,
      newText: args.newText,
      replacements: args.replacements,
      references: args.references,
      requireUniqueTarget: args.kind === "edit" ? true : undefined,
      state: args.kind === "references" ? "applied" : "pending",
      createdAt: Date.now(),
    });
    return { ok: true as const, proposalId };
  },
});

/** Project metadata for the searchBrain tool. */
export const getThreadBrainContext = internalQuery({
  args: { agentThreadId: v.string() },
  handler: async (ctx, args): Promise<{ industry: string | null; scienceCode: string | null }> => {
    const thread = await threadRow(ctx, args.agentThreadId);
    if (!thread) return { industry: null, scienceCode: null };
    const project = await ctx.db.get(thread.projectId);
    return {
      industry: project?.industry ?? null,
      scienceCode: normalizeCraScienceCode(project?.scienceCode) ?? null,
    };
  },
});

/** Grounding context for streamChatReply — thread history stays componentside. */
export const getChatContextV2 = internalQuery({
  args: { reportId: v.id("reports"), agentThreadId: v.string() },
  handler: async (ctx, args) => {
    const report = await ctx.db.get(args.reportId);
    if (!report) throw new Error("Report not found");

    // Ground on the generation that actually produced THIS report — the
    // latest project generation can belong to a newer report (or a failed
    // rerun) and its agentOutputs would describe a different analysis. We
    // fall back when the report predates generation linking OR its linked
    // generation stored no agentOutputs, and then only to a completed
    // generation that has agentOutputs to offer — a best-effort grounding
    // that can still describe an older draft of this project.
    let generation = report.generationId
      ? await ctx.db.get(report.generationId)
      : null;
    if (!generation?.agentOutputs) {
      const completed = await ctx.db
        .query("generations")
        .withIndex("by_projectId_and_status", (q) =>
          q.eq("projectId", report.projectId).eq("status", "completed")
        )
        .order("desc")
        .take(10);
      generation = completed.find((row) => row.agentOutputs) ?? null;
    }

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
        target:
          p.targetText ??
          (p.replacements ? p.replacements.map((r) => r.find).join(" | ") : ""),
        candidate:
          p.newText ??
          (p.replacements ? p.replacements.map((r) => r.replaceWith).join(" | ") : ""),
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
