import { persistDeterministicFindings } from "./lib/qaFindings";
import {
  query,
  mutation,
  internalQuery,
  internalMutation,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import { components, internal } from "./_generated/api";
import { getConvexSize, v, type Value } from "convex/values";
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
import { pruneSnapshots, writePreEditSnapshot } from "./lib/snapshots";
import { requireReportEditAccess } from "./lib/roleCapabilities";
import {
  applyReplacements,
  headingEditRefusal,
  highlightLocation,
  locateSelection,
  SELECTION_GONE,
  type SelectionLocation,
  scrubBannedWords,
  type PMNode,
} from "./lib/reportEdits";
import { getEffectiveWriterStyle } from "./writerProfiles";
import { selectedCandidateRunId } from "./complianceNotes";
import { applyPassageEdits } from "./lib/passageEdits";
import {
  MAX_COMPLETION_REPORT_FINDINGS,
  completionReportAnchorIssues,
  completionReportItemValidator,
  completionReportRows,
  paragraphCounts,
  paragraphCountsSentence,
  zeroEditIssue,
} from "./lib/completionReport";
import { extractReportSections, sectionParagraphs } from "./lib/tiptapReport";
import type {
  InventoryNote,
  InventorySections,
} from "./lib/deviationInventory";
import { publicChatDelta, publicChatMessage } from "./lib/chatPublicOutput";
import { safeErrorDetails } from "./lib/safeErrorDetails";
import { domainError, sha256 } from "./lib/contracts";
import { isProjectDeleting } from "./lib/projectDeletion";
import { normalizeCraScienceCode } from "../shared/craScienceCodes";
import { isRecordOnlyProposal, proposalPairs } from "../shared/chatProposals";
import { chatAdmissionLimits, chatEvidenceBudget } from "./appSettings";
import {
  DEFAULT_CHAT_EVIDENCE_BUDGET,
  type ChatOpenQuestion,
  type ChatOpenQuestionsOmitted,
} from "./ai/chatEvidence";
import { projectRollingCostUsdUnits, usdDecimalUnits } from "./aiUsage";
import type { Doc, Id } from "./_generated/dataModel";
import { outputArtifact, outputsInArtifacts } from "./lib/generationOutputs";

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

const turnWindowArgs = {
  startOrder: v.optional(v.number()),
  endOrder: v.optional(v.number()),
};

const DEFAULT_TURN_START_ORDER = 0;
const DEFAULT_TURN_END_ORDER = Number.MAX_SAFE_INTEGER;
const TURN_WINDOW_LIMIT = 200;

function resolveTurnWindow(args: {
  startOrder?: number;
  endOrder?: number;
}) {
  return {
    startOrder: args.startOrder ?? DEFAULT_TURN_START_ORDER,
    endOrder: args.endOrder ?? DEFAULT_TURN_END_ORDER,
  };
}

async function loadNewestTurns(
  ctx: QueryCtx,
  args: {
    agentThreadId: string;
    startOrder: number;
    endOrder: number;
  }
) {
  const turns = await ctx.db
    .query("chatTurns")
    .withIndex("by_agentThreadId_and_order", (q) =>
      q
        .eq("agentThreadId", args.agentThreadId)
        .gte("order", args.startOrder)
        .lte("order", args.endOrder)
    )
    .order("desc")
    .take(TURN_WINDOW_LIMIT);
  return turns.reverse();
}

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
    if (!thread) {
      return {
        page: [],
        isDone: true,
        continueCursor: "",
        streams: undefined,
      };
    }
    await requireInternalProjectAccess(ctx, thread.projectId);

    const paginated = await listUIMessages(ctx, components.agent, {
      threadId: args.threadId,
      paginationOpts: args.paginationOpts,
    });
    let streamArgs = args.streamArgs;
    if (streamArgs?.kind === "deltas") {
      // The pinned agent component does not verify cursor ownership itself.
      // Include retained finished streams so their final delta can still drain.
      const ownedStreams = await ctx.runQuery(components.agent.streams.list, {
        threadId: args.threadId, statuses: ["streaming", "finished", "aborted"],
      });
      const ownedIds = new Set(ownedStreams.map(stream => stream.streamId));
      streamArgs = { ...streamArgs, cursors: streamArgs.cursors.filter(cursor => ownedIds.has(cursor.streamId)) };
    }
    const streams = await syncStreams(ctx, components.agent, {
      threadId: args.threadId,
      streamArgs,
    });
    return { ...paginated, page: paginated.page.map(publicChatMessage),
      streams: streams?.kind === "deltas"
        ? { ...streams, deltas: streams.deltas.map(publicChatDelta) }
        : streams?.kind === "list"
          ? { ...streams, messages: streams.messages.map(({ streamId, status, format, order, stepOrder }) =>
            ({ streamId, status, format, order, stepOrder })) }
          : streams };
  },
});

/**
 * Proposals linked to the newest turns in an inclusive order window.
 *
 * Empty only when no thread mapping exists; an existing thread the caller may
 * not read throws the typed NOT_AUTHENTICATED / NOT_AUTHORIZED error, like
 * listMessages. Proposals without a promptMessageId anchor (legacy rows) are
 * never returned because their window membership cannot be proven.
 */
export const listProposals = query({
  args: {
    threadId: v.string(),
    ...turnWindowArgs,
  },
  handler: async (ctx, args) => {
    const thread = await threadRow(ctx, args.threadId);
    if (!thread) return [];
    await requireInternalProjectAccess(ctx, thread.projectId);

    const window = resolveTurnWindow(args);
    if (window.startOrder > window.endOrder) return [];

    const turns = await loadNewestTurns(ctx, {
      agentThreadId: args.threadId,
      ...window,
    });
    const promptMessageIds = [
      ...new Set(turns.map((turn) => turn.promptMessageId)),
    ];
    const proposalsByTurn = await Promise.all(
      promptMessageIds.map(async (promptMessageId) =>
        ctx.db
          .query("chatProposals")
          .withIndex("by_agentThreadId_and_promptMessageId", (q) =>
            q
              .eq("agentThreadId", args.threadId)
              .eq("promptMessageId", promptMessageId)
          )
          .order("asc")
          .collect()
      )
    );

    // Same order the by_agentThreadId index yields: creation time, then id.
    // Plain code-point comparison keeps the tie-break locale-independent.
    return proposalsByTurn.flat().sort((left, right) => {
      const creationTimeDifference = left._creationTime - right._creationTime;
      if (creationTimeDifference !== 0) return creationTimeDifference;
      if (left._id === right._id) return 0;
      return left._id < right._id ? -1 : 1;
    });
  },
});

/**
 * Turn timing rows in the same inclusive newest-200 window as listProposals.
 * Unlike listProposals this stays empty-on-unauthorized: it is a metadata
 * feed for UI timing badges and its callers never surface query errors.
 */
export const listTurns = query({
  args: {
    threadId: v.string(),
    ...turnWindowArgs,
  },
  handler: async (ctx, args) => {
    const window = resolveTurnWindow(args);
    if (window.startOrder > window.endOrder) return [];

    const thread = await threadRow(ctx, args.threadId);
    if (!thread) return [];
    if (!(await getInternalProjectAccessOrNull(ctx, thread.projectId))) return [];

    return await loadNewestTurns(ctx, {
      agentThreadId: args.threadId,
      ...window,
    });
  },
});

// ─── Mutations ───────────────────────────────────────────────────────────────

async function assertChatAdmission(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  userId: Id<"users">
): Promise<void> {
  const limits = await chatAdmissionLimits(ctx);
  if (await projectRollingCostUsdUnits(ctx, { projectId, now: Date.now() }) > usdDecimalUnits(limits.dailyBudgetUsd)) {
    domainError("CHAT_SPEND_BUDGET_EXCEEDED", "Project AI spending budget exceeded; chat is unavailable");
  }
  let queued = 0;
  const ownTurns = ctx.db.query("chatTurns")
    .withIndex("by_userId_and_status", (q) => q.eq("userId", userId).eq("status", "queued"));
  for await (const turn of ownTurns) {
    queued += 1;
    if (queued >= limits.maxQueuedTurns) {
      domainError("CHAT_QUEUE_LIMIT_EXCEEDED", "Your queued chat turn limit has been reached");
    }
  }
  // Legacy turns belong to their prompt sender, never the shared thread creator.
  const legacyTurns = ctx.db.query("chatTurns")
    .withIndex("by_userId_and_status", (q) => q.eq("userId", undefined).eq("status", "queued"));
  for await (const turn of legacyTurns) {
    const [prompt] = await ctx.runQuery(components.agent.messages.getMessagesByIds, {
      messageIds: [turn.promptMessageId],
    });
    if (prompt?.userId === userId) queued += 1;
    if (queued >= limits.maxQueuedTurns) {
      domainError("CHAT_QUEUE_LIMIT_EXCEEDED", "Your queued chat turn limit has been reached");
    }
  }
}

/**
 * The thread's queued or running turn other than `exceptPromptMessageId`, if
 * any. A thread runs one turn at a time (a4 #17): two tabs, or a double send,
 * must not stream two replies into one conversation and pay for both.
 */
async function otherActiveTurn(
  ctx: QueryCtx,
  agentThreadId: string,
  exceptPromptMessageId?: string,
  statuses: ReadonlyArray<"running" | "queued"> = ["running", "queued"]
) {
  for (const status of statuses) {
    const turns = await ctx.db
      .query("chatTurns")
      .withIndex("by_agentThreadId_and_status", (q) =>
        q.eq("agentThreadId", agentThreadId).eq("status", status)
      )
      .take(2);
    const other = turns.find((turn) => turn.promptMessageId !== exceptPromptMessageId);
    if (other) return other;
  }
  return null;
}

/** The report text the writer highlighted for a prompt, when the turn stored it. */
async function turnHighlight(
  ctx: QueryCtx,
  agentThreadId: string,
  promptMessageId: string
): Promise<{ text: string; from: number; to: number } | undefined> {
  const turn = await ctx.db
    .query("chatTurns")
    .withIndex("by_agentThreadId_and_promptMessageId", (q) =>
      q.eq("agentThreadId", agentThreadId).eq("promptMessageId", promptMessageId)
    )
    .unique();
  return turn?.highlight;
}

export const sendMessage = mutation({
  args: {
    reportId: v.id("reports"),
    content: v.string(),
    threadId: v.optional(v.string()),
    highlight: v.optional(highlightValidator),
    refineProposalId: v.optional(v.id("chatProposals")),
    /** Force a fresh thread even when the report already has one ("New chat"). */
    newThread: v.optional(v.boolean()),
    allowBrain: v.optional(v.boolean()),
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
        refineProposal.kind === "references" ||
        // DW-135: a record-only revision has no wording to refine.
        isRecordOnlyProposal(refineProposal)
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
      agentThreadId = latest?.agentThreadId;
    }

    await assertChatAdmission(ctx, report.projectId, userId);

    if (agentThreadId && (await otherActiveTurn(ctx, agentThreadId))) {
      domainError(
        "INVALID_STATE",
        "A reply is still being written in this chat. Wait for it to finish or stop it, then send again."
      );
    }

    if (!agentThreadId) {
      const title = args.content.trim().slice(0, 60) || "New chat";
      agentThreadId = await createThread(ctx, components.agent, { userId, title });
      await ctx.db.insert("agentChatThreads", {
        projectId: report.projectId,
        reportId: args.reportId,
        agentThreadId,
        title,
        createdAt: Date.now(),
      });
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

    // Keep the highlight's positions on the turn, so a proposal aimed at it
    // is judged by where it sits. A regenerated prompt carries the excerpt in
    // its text only: reuse the positions an earlier turn stored for it.
    let highlight = args.highlight
      ? { text: args.highlight.text, from: args.highlight.from, to: args.highlight.to }
      : undefined;
    const quoted = !highlight
      ? /\[Writer highlighted this excerpt from the report\]:\n"""([\s\S]*?)"""/.exec(args.content)?.[1]
      : undefined;
    if (quoted) {
      const earlier = await ctx.db
        .query("chatTurns")
        .withIndex("by_agentThreadId_and_order", (q) => q.eq("agentThreadId", agentThreadId))
        .order("desc")
        .take(50);
      highlight = earlier.find((turn) => turn.highlight?.text === quoted)?.highlight;
    }
    await ctx.db.insert("chatTurns", {
      userId,
      agentThreadId,
      promptMessageId: messageId,
      order: message.order,
      status: "queued",
      stepCount: 0,
      ...(highlight ? { highlight } : {}),
    });

    await ctx.scheduler.runAfter(0, internal.ai.chatAgentV2.streamChatReply, {
      agentThreadId,
      promptMessageId: messageId,
      reportId: args.reportId,
      // PSOS-49: the SENDER of this turn — their house-style waivers govern the
      // reply. Threads are shared per report, so the thread's own userId (its
      // creator) is the wrong writer for later participants.
      userId,
      ...(args.allowBrain === true ? { allowBrain: true } : {}),
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
    // DW-135 (AD-28 amendment): an all-blocked/conflicting revision was saved
    // with zero edits. It is a record of findings, never a prose change, so it
    // is refused here exactly like a highlight, before any report read.
    if (isRecordOnlyProposal(proposal)) {
      domainError(
        "INVALID_INPUT",
        "This revision has nothing to apply. Its findings need a writer's decision."
      );
    }
    // report.editProse: applying a proposal writes report prose.
    const { user: applier } = await requireReportEditAccess(
      ctx,
      proposal.projectId
    );
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

    let pairs = proposalPairs(proposal);
    if (pairs.length === 0) {
      domainError("INVALID_INPUT", "This edit has nothing to replace.");
    }

    // PSOS-50: proposals are scrubbed (or not) at creation per the SENDER's
    // banned-words waiver, but threads are shared per report — text entering
    // the report must also pass the APPLYING user's policy. Re-scrubbing an
    // already-clean proposal is a no-op (the scrub is idempotent); a waived
    // applier keeps the proposal verbatim.
    try {
      const style = await getEffectiveWriterStyle(ctx, applier._id);
      if (!style.styleOverrides.bannedWords) {
        pairs = pairs.map((pair) => ({
          ...pair,
          replaceWith: scrubBannedWords(pair.replaceWith),
        }));
      }
    } catch (err) {
      // Policy lookup must never block an apply; default to scrubbing.
      console.error("apply-time scrub policy lookup failed", safeErrorDetails(err));
      pairs = pairs.map((pair) => ({
        ...pair,
        replaceWith: scrubBannedWords(pair.replaceWith),
      }));
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
    const bulkResult = proposal.requireUniqueTargets
      ? applyPassageEdits(parsed as PMNode, pairs)
      : null;
    if (bulkResult && !bulkResult.ok) {
      await ctx.db.patch(args.proposalId, { state: "stale" });
      return { applied: false as const, count: 0, reason: bulkResult.reason };
    }
    const direct = bulkResult ? null : applyReplacements(parsed as PMNode, pairs);
    const { doc: updated, count } = bulkResult ?? direct!;
    // Producer-declared single-target proposals (older research proposals
    // predate the flag, hence the researchSessionId fallback).
    const requireUniqueTarget =
      proposal.requireUniqueTarget ?? proposal.researchSessionId !== undefined;
    // Heading and title text is never edited. A research edit carries the
    // writer's selection, which decides; any other edit is refused only when
    // heading or title text is its sole match.
    if (direct) {
      let location: SelectionLocation | undefined;
      if (proposal.researchSessionId) {
        const session = await ctx.db.get(proposal.researchSessionId);
        if (session && session.reportId === proposal.reportId) {
          // Made in the report editor: never part of a heading's text.
          location = locateSelection(
            parsed as PMNode,
            { from: session.selectionFrom, to: session.selectionTo, text: session.selectedText },
            { partialHeadingText: false }
          );
        }
      } else if (proposal.promptMessageId) {
        // An Ask assistant edit: the writer's highlight decides when the
        // edit targets it.
        const highlight = await turnHighlight(ctx, proposal.agentThreadId, proposal.promptMessageId);
        for (const pair of highlight ? pairs : []) {
          const probe = applyReplacements(parsed as PMNode, [pair]);
          const found = highlightLocation(
            parsed as PMNode,
            highlight!,
            pair.find,
            probe.skippedInHeadings + probe.skippedInTitle
          );
          if (found !== undefined) location = found;
          if (found !== undefined && found !== "body") break;
        }
      }
      const refusal = headingEditRefusal(direct, location);
      if (refusal) {
        await ctx.db.patch(args.proposalId, { state: "stale" });
        return { applied: false as const, count: 0, reason: refusal };
      }
    }
    if (count === 0) {
      await ctx.db.patch(args.proposalId, { state: "stale" });
      return {
        applied: false as const,
        count: 0,
        reason:
          "Couldn't find the original passage in the current report. This suggestion may be based on wording that was rejected or already changed.",
      };
    }
    if (requireUniqueTarget && count !== 1) {
      domainError(
        "STALE_REVISION",
        "The target passage is no longer unique in this report. Review and apply this edit manually to avoid changing another occurrence."
      );
    }

    const content = JSON.stringify(updated);
    const revisionNumber = report.revisionNumber ?? 0;
    const now = Date.now();
    await writePreEditSnapshot(ctx, report, "pre_chat_edit", {
      createdAt: now,
      ...(proposal.researchSessionId
        ? { researchSessionId: proposal.researchSessionId }
        : {}),
    });
    await ctx.db.patch(report._id, {
      content,
      contentHash: await sha256(content),
      revisionNumber: revisionNumber + 1,
      provenanceId: undefined,
      updatedAt: now,
    });
    await persistDeterministicFindings(ctx, report._id);
    await ctx.db.patch(args.proposalId, { state: "applied" });
    await pruneSnapshots(ctx, report._id);

    return { applied: true, count };
  },
});

/**
 * Reject editor content the same way `reports.updateReportContent` does
 * (empty or over the size cap), plus the editor-document shape check
 * `applyProposal` runs before it will operate on stored content: what this
 * path persists must be a JSON object the next apply can parse.
 */
function assertEditorDocument(content: string): void {
  if (!content.trim() || content.length > 1_000_000) {
    domainError(
      "INVALID_INPUT",
      "Report content is empty or exceeds 1,000,000 characters"
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    domainError("INVALID_INPUT", "The report content is not valid editor JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    domainError(
      "INVALID_INPUT",
      "The report content is not a valid editor document"
    );
  }
}

/**
 * One-by-one apply (BNH-30): the writer stepped through the replacements
 * client-side and submits the resulting document here. Sprint 1 story 6
 * (CAP-2, D-1): this is the same transaction shape as `applyProposal` —
 * authorization recheck, `pre_chat_edit` snapshot of the content as it stands
 * before the edit, revision fence, content + status written together, revision
 * bumped by one. The client holds autosave for the whole stepping session, so
 * no content reaches the report for that proposal outside this mutation. No
 * banned-word scrub: the writer authored the final document.
 */
export const markProposalApplied = mutation({
  args: {
    proposalId: v.id("chatProposals"),
    content: v.string(),
    expectedRevisionNumber: v.number(),
  },
  handler: async (ctx, args) => {
    const proposal = await ctx.db.get(args.proposalId);
    if (!proposal) domainError("NOT_FOUND", "Proposal not found");
    // report.editProse: this path writes the final document content.
    await requireReportEditAccess(ctx, proposal.projectId);
    const report = await ctx.db.get(proposal.reportId);
    if (!report || report.projectId !== proposal.projectId) {
      domainError("NOT_FOUND", "Report not found");
    }
    // Kind guards run before the already-applied short-circuit: a highlight or
    // a record-only revision (DW-135) is stored `applied` from creation, and
    // must be refused as nothing to apply, never reported as applied prose.
    if (proposal.kind === "references") {
      domainError("INVALID_INPUT", "Highlights have nothing to apply.");
    }
    if (isRecordOnlyProposal(proposal)) {
      domainError(
        "INVALID_INPUT",
        "This revision has nothing to apply. Its findings need a writer's decision."
      );
    }
    if (proposal.requireUniqueTargets) {
      domainError("INVALID_INPUT", "Apply this coordinated revision from its suggestion card so every passage can be checked together.");
    }
    if (proposal.state === "applied") {
      return {
        applied: true as const,
        alreadyApplied: true as const,
        revisionNumber: report.revisionNumber ?? 0,
      };
    }
    if (proposal.state !== "pending") {
      domainError(
        "INVALID_INPUT",
        proposal.state === "stale"
          ? "This suggestion no longer matches the current report. Ask the assistant to regenerate it."
          : "This suggestion is no longer available to apply."
      );
    }
    assertEditorDocument(args.content);
    const revisionNumber = report.revisionNumber ?? 0;
    if (args.expectedRevisionNumber !== revisionNumber) {
      domainError(
        "STALE_REVISION",
        "The report changed before this save completed"
      );
    }

    const now = Date.now();
    await writePreEditSnapshot(ctx, report, "pre_chat_edit", { createdAt: now });
    await ctx.db.patch(report._id, {
      content: args.content,
      contentHash: await sha256(args.content),
      revisionNumber: revisionNumber + 1,
      // Any writer edit requires a new provenance review for the exact revision.
      provenanceId: undefined,
      updatedAt: now,
    });
    await persistDeterministicFindings(ctx, report._id);
    await ctx.db.patch(args.proposalId, { state: "applied" });
    await pruneSnapshots(ctx, report._id);

    return {
      applied: true as const,
      alreadyApplied: false as const,
      revisionNumber: revisionNumber + 1,
    };
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
    // The owner applies stored wording as is, so rewording a pending
    // suggestion is editing report prose (audit 2026-09-25, a2 P2-2).
    const { user } = await requireReportEditAccess(ctx, proposal.projectId);
    if (isRecordOnlyProposal(proposal)) {
      domainError("INVALID_INPUT", "This record has nothing to reword.");
    }
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
    await requireReportEditAccess(ctx, proposal.projectId);
    if (isRecordOnlyProposal(proposal)) {
      domainError("INVALID_INPUT", "This record has nothing to reject.");
    }
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
    const threadOwner = await threadRow(ctx, args.agentThreadId);
    if (!threadOwner || (await isProjectDeleting(ctx, threadOwner.projectId))) {
      return { shouldRun: false, status: "failed" as const };
    }
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
      // Lease (a4 #17): sendMessage refuses a second turn while one is
      // active, so this only meets turns queued before that check. One
      // running turn per thread; a turn queued behind it fails, and the
      // writer sends again.
      if (await otherActiveTurn(ctx, args.agentThreadId, args.promptMessageId, ["running"])) {
        await ctx.db.patch(turn._id, { status: "failed", endedAt: args.startedAt });
        return { shouldRun: false, status: "failed" as const };
      }
      await ctx.db.patch(turn._id, {
        status: "running",
        ...(turn.startedAt === undefined ? { startedAt: args.startedAt } : {}),
      });
      return { shouldRun: true, status: "running" as const };
    }
    // Already running: the first start holds the turn; a second start of the
    // same turn (a duplicate action) does not stream it again.
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
    const threadOwner = await threadRow(ctx, args.agentThreadId);
    if (!threadOwner || (await isProjectDeleting(ctx, threadOwner.projectId))) {
      return { status: args.requestedStatus };
    }
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
        const threadOwner = await threadRow(ctx, turn.agentThreadId);
        if (!threadOwner || (await isProjectDeleting(ctx, threadOwner.projectId))) continue;
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
    requireUniqueTargets: v.optional(v.boolean()),
    // Story 5 (CAP-13, AD-28): the Coordinated Revision's Completion Report.
    // One `chatProposalItems` child row per item, written in this transaction
    // and nowhere else. Absent for every other proposal producer.
    items: v.optional(v.array(completionReportItemValidator)),
  },
  handler: async (ctx, args) => {
    const thread = await threadRow(ctx, args.agentThreadId);
    if (!thread) {
      return {
        ok: false as const,
        reason: "The project is no longer available.",
      };
    }
    if (await isProjectDeleting(ctx, thread.projectId)) {
      return {
        ok: false as const,
        reason: "The project is being deleted.",
      };
    }

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
    const items = args.items ?? [];
    const highlight = args.promptMessageId
      ? await turnHighlight(ctx, args.agentThreadId, args.promptMessageId)
      : undefined;
    // DW-135 (AD-28 amendment, approved 2026-09-14): a Coordinated Revision may
    // carry zero edits when every finding is blocked or conflicting. The rule
    // is the same one the tool's schema applies, re-checked here over the item
    // rows because this mutation is the only writer of both tables.
    const recordOnly = isRecordOnlyProposal(args);
    if (recordOnly) {
      // The predicate ignores blank `find` entries; the stored row must not.
      // A record-only proposal is stored as exactly `replacements: []`.
      if ((args.replacements ?? []).length !== 0) {
        return {
          ok: false as const,
          reason: "Each passage must identify exactly one current report location and make a change.",
        };
      }
      const issue = zeroEditIssue(0, items);
      if (issue) return { ok: false as const, reason: issue };
    } else if (args.requireUniqueTargets) {
      if (args.kind !== "replacements") return { ok: false as const, reason: "A passage set must use replacements." };
      const result = applyPassageEdits(parsed as PMNode, pairs);
      if (!result.ok) return { ok: false as const, reason: result.reason };
    }
    if (recordOnly) {
      // Nothing to match against the report: no pairs, so no target checks.
    } else if (args.kind !== "references") {
      if (pairs.length === 0) {
        return { ok: false as const, reason: "The suggestion did not include text to replace." };
      }
      for (const pair of pairs) {
        const probe = applyReplacements(parsed as PMNode, [pair]);
        const { count } = probe;
        // Heading and title text is never edited. An edit aimed at the text
        // the writer highlighted is judged by where the highlight sits; any
        // other edit only when heading or title text is its sole match (say
        // so rather than "not in the report").
        const refusal = headingEditRefusal(
          probe,
          highlight
            ? highlightLocation(parsed as PMNode, highlight, pair.find, probe.skippedInHeadings + probe.skippedInTitle)
            : undefined
        );
        if (refusal) {
          return {
            ok: false as const,
            reason:
              refusal === SELECTION_GONE ? refusal : `${refusal} Target the passage in the report prose instead.`,
          };
        }
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
            reason: `The proposed target matches ${count} places in the report prose. Include more surrounding words so it matches only the one passage you mean.`,
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

    // CAP-12/CAP-13: every Completion Report item must name a paragraph the
    // CURRENT report actually has. Checked before the parent insert, so a bad
    // anchor writes neither the proposal nor a single item row, and the reason
    // hands the model the real counts to retry against.
    if (items.length) {
      const counts = paragraphCounts(extractReportSections(report.content));
      const issues = completionReportAnchorIssues(items, counts);
      if (issues.length) {
        // Written to be EMBEDDED, like every other `saveProposal` reason: the
        // tool result adds the "Proposal NOT created" prefix and its own retry
        // instruction, so neither belongs here.
        return {
          ok: false as const,
          reason: `${issues.join(" ")} In the current report, ${paragraphCountsSentence(counts)}.`,
        };
      }
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
      requireUniqueTargets: args.requireUniqueTargets,
      // Highlights and record-only revisions have no state machine: nothing
      // for a human to apply or reject, so they are terminal on creation.
      state: args.kind === "references" || recordOnly ? "applied" : "pending",
      createdAt: Date.now(),
    });
    // AD-28: the findings persist as child rows, one per item, in input order.
    // `saveProposal` is the only writer of this table, and the `toolCallId`
    // short-circuit above returns before here, so a retried tool call cannot
    // double-write them.
    for (const row of completionReportRows(items, {
      proposalId,
      projectId: thread.projectId,
      createdAt: Date.now(),
    })) {
      await ctx.db.insert("chatProposalItems", row);
    }
    return { ok: true as const, proposalId };
  },
});

/**
 * The Completion Report rows of one proposal, for the card (DW-135). Same
 * access rule as `listProposals`; bounded by the tool's own findings cap, so
 * the read can never exceed what `saveProposal` could have written.
 */
export const listProposalItems = query({
  args: { proposalId: v.id("chatProposals") },
  handler: async (ctx, args) => {
    const proposal = await ctx.db.get(args.proposalId);
    if (!proposal) return [];
    await requireInternalProjectAccess(ctx, proposal.projectId);
    return await ctx.db
      .query("chatProposalItems")
      .withIndex("by_proposalId", (q) => q.eq("proposalId", args.proposalId))
      .take(MAX_COMPLETION_REPORT_FINDINGS);
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

const MAX_INVENTORY_NOTES = 1000;
/**
 * DW-138: the Reference PD lookup walks the project's documents and keeps the
 * `previous_pd` rows, so the bound is on rows SCANNED, not rows taken before
 * the filter (which lost any Reference PD uploaded after 200 attachments).
 * Hitting it, or the read budget below, is reported as
 * `documentScanTruncated`, never as "none attached".
 */
export const MAX_PROJECT_DOCUMENT_SCAN = 1000;

// ── Per-transaction read budget (Astra review of DW-138) ────────────────────
//
// A row bound alone does not keep a walk under Convex's 16 MiB per-transaction
// read limit: 400 attachments of 50 KiB blow it before row 1000, and the query
// then throws instead of reporting a cut. Every row a query reads is charged
// here BEFORE the next read is started, and a walk stops, reporting itself
// incomplete, once one maximum-size document no longer fits.
//
// This is a local twin of `convex/lib/learningHealthReads.ts` (same numbers,
// same reserve-then-account shape). A shared `convex/lib/boundedRead.ts`
// primitive is being extracted from that module on another branch; this block
// is shaped so the switch is a one-line import: `account` for point reads,
// `list` for a capped index walk returning `{ rows, complete }`.
const MIB = 1 << 20;
/** Half the platform limit, so everything else the transaction reads fits. */
export const CHAT_READ_BYTES = 8 * MIB;
/** Room for one maximum-size document before each read. */
const CHAT_DOCUMENT_HEADROOM = MIB + 4096;
const CHAT_DOCUMENT_OVERHEAD = 256;

function chatReadBudget() {
  let used = 0;
  let exhausted = false;
  function reserve(): boolean {
    if (used + CHAT_DOCUMENT_HEADROOM <= CHAT_READ_BYTES) return true;
    exhausted = true;
    return false;
  }
  function account(value: Value): void {
    used += getConvexSize(value) + CHAT_DOCUMENT_OVERHEAD;
  }
  return {
    /** Charge a point read (`ctx.db.get`, a `.take`) that already happened. */
    charge<T extends Value | null | undefined>(value: T): T {
      if (Array.isArray(value)) value.forEach((row) => account(row));
      else if (value !== null && value !== undefined) account(value);
      return value;
    },
    /**
     * Reserve BEFORE a read, then perform and charge it. `{ ok: false }` means
     * the read was not started: the caller degrades (an unavailable label, a
     * default) instead of the transaction throwing. `extraBytes` covers rows
     * a helper reads that its return value does not carry (a selection row,
     * a settings row); the return value itself is charged when it is a Value.
     */
    async read<T>(
      fn: () => Promise<T>,
      extraBytes = 0
    ): Promise<{ ok: true; value: T } | { ok: false }> {
      if (!reserve()) return { ok: false };
      const value = await fn();
      used += extraBytes;
      if (value !== null && value !== undefined && typeof value === "object") {
        account(value as Value);
      }
      return { ok: true, value };
    },
    /**
     * Walk an index range, keeping the rows `keep` accepts, up to `cap` rows
     * scanned and within the byte budget. `complete` is false when either
     * bound stopped the walk before the range ended.
     */
    async list<T extends Value>(
      source: AsyncIterable<T>,
      cap: number,
      keep: (row: T) => boolean = () => true
    ): Promise<{ rows: T[]; complete: boolean }> {
      const rows: T[] = [];
      let scanned = 0;
      if (!reserve()) return { rows, complete: false };
      const iterator = source[Symbol.asyncIterator]();
      try {
        while (reserve()) {
          if (scanned >= cap) return { rows, complete: false };
          const next = await iterator.next();
          if (next.done) return { rows, complete: true };
          account(next.value);
          scanned += 1;
          if (keep(next.value)) rows.push(next.value);
        }
        return { rows, complete: false };
      } finally {
        await iterator.return?.();
      }
    },
    get exhausted() {
      return exhausted;
    },
  };
}

/** Why rule Deviations are or are not in the inventory. Three distinguishable
 * states, because "no linked generation" and "a generation that found nothing"
 * need different sentences and only one of them is a clean bill. */
type RulesStatus = "available" | "no_generation" | "no_notes" | "unread";

/**
 * What happened when the tool tried to resolve a Reference PD. Every non
 * `resolved` value is something the assistant must SAY, not work around.
 */
type ReferenceStatus =
  | "none"
  | "resolved"
  | "unknown_name"
  | "unreadable"
  | "unparsed"
  | "ambiguous";

/**
 * A `previous_pd` row is comparable only when its text was actually extracted.
 * `could_not_read` and `reference_only` are the two intake outcomes that store a
 * row with no usable body (an image-only PDF, a file kept for reference), and a
 * blank `content` fails closed the same way whatever its status says.
 */
function isComparableReference(row: Doc<"projectDocuments">): boolean {
  if (
    row.processingStatus === "could_not_read" ||
    row.processingStatus === "reference_only"
  ) {
    return false;
  }
  return (row.content ?? "").trim().length > 0;
}

/**
 * Did the Reference PD's text actually parse into the 242/244/246 skeleton?
 *
 * All three, not "at least one paragraph somewhere": `extractReportSections`
 * treats leading prose with no recognizable heading as Line 242, so a plain docx
 * or PDF extract of last year's PD parses to one fat 242 and two empty sections.
 * Comparing against that attaches "the Reference PD's Line 244 has 0
 * paragraph(s), so this paragraph has no counterpart" to every 244 and 246
 * paragraph of the draft: invented differences, offered as a Coordinated
 * Revision. A PD that can be compared has all three Locked sections.
 */
function parsedIntoSections(sections: InventorySections): boolean {
  return (
    sectionParagraphs(sections.s242).length > 0 &&
    sectionParagraphs(sections.s244).length > 0 &&
    sectionParagraphs(sections.s246).length > 0
  );
}

/**
 * Story 5 (CAP-12/CAP-15): everything the `deviationInventory` and
 * `compareReferencePd` tools read, resolved server-side from the thread. The
 * tools take no project, report or generation argument, so neither can be
 * steered at another project. Bounded reads only.
 */
export const getDeviationInventoryContext = internalQuery({
  args: {
    agentThreadId: v.string(),
    /** A `previous_pd` document of THIS project, by file name. */
    referenceFileName: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    found: boolean;
    sections: InventorySections;
    notes: InventoryNote[];
    rulesStatus: RulesStatus;
    rulesAvailable: boolean;
    reference: { fileName: string; sections: InventorySections } | null;
    referenceStatus: ReferenceStatus;
    /** Non-archived `previous_pd` rows whose text can actually be compared. */
    referenceFileNames: string[];
    /** Attached `previous_pd` rows whose text could not be extracted at upload. */
    unreadableReferenceFileNames: string[];
    /** The row the tool tried to use, named so its copy can say which file. */
    selectedReferenceFileName: string | null;
    /**
     * True when the project holds more than `MAX_PROJECT_DOCUMENT_SCAN`
     * documents, so a Reference PD past the bound was not seen. The tool says
     * so instead of reporting the PD absent.
     */
    documentScanTruncated: boolean;
  }> => {
    const empty: InventorySections = { s242: "", s244: "", s246: "" };
    const thread = await threadRow(ctx, args.agentThreadId);
    if (!thread) {
      return {
        found: false,
        sections: empty,
        notes: [],
        rulesStatus: "no_generation",
        rulesAvailable: false,
        reference: null,
        referenceStatus: "none",
        referenceFileNames: [],
        unreadableReferenceFileNames: [],
        selectedReferenceFileName: null,
        documentScanTruncated: false,
      };
    }
    // One budget for everything this transaction reads, charged in read
    // order, so the document walk at the end stops with headroom to spare.
    const budget = chatReadBudget();
    budget.charge(thread);
    const report = budget.charge(await ctx.db.get(thread.reportId));
    const sections = report ? extractReportSections(report.content) : empty;

    // ONLY the report's own generation. There is deliberately no fallback to
    // the project's newest generation: `complianceNotes.paragraphIndex` is an
    // index into the paragraphs of the draft that generation produced, so
    // anchoring another generation's rows onto this report's paragraphs would
    // present another draft's rule Deviations as this one's. No linked
    // generation means rule Deviations are UNAVAILABLE, never fabricated.
    const generation = report?.generationId
      ? budget.charge(await ctx.db.get(report.generationId))
      : null;

    let notes: InventoryNote[] = [];
    // The selection lookup reads one modelSelections row and up to ten small
    // candidate-run rows; reserved before it starts and charged as a flat
    // estimate on top of its (id) return value. Without it a compare
    // generation would be read through the unfiltered index and present
    // every candidate's notes as this report's, so a failed reservation
    // marks the rules UNREAD rather than falling through.
    let notesUnread = false;
    if (generation) {
      const selection = await budget.read(
        () => selectedCandidateRunId(ctx, generation),
        11 * 2048
      );
      if (!selection.ok) {
        notesUnread = true;
      }
      const candidateRunId = selection.ok ? selection.value : undefined;
      const { rows } = notesUnread
        ? { rows: [] as Doc<"complianceNotes">[] }
        : await budget.list(
        candidateRunId !== undefined
          ? ctx.db
              .query("complianceNotes")
              .withIndex("by_generationId_and_candidateRunId_and_section", (q) =>
                q
                  .eq("generationId", generation._id)
                  .eq("candidateRunId", candidateRunId)
              )
          : ctx.db
              .query("complianceNotes")
              .withIndex("by_generationId_and_section", (q) =>
                q.eq("generationId", generation._id)
              ),
        MAX_INVENTORY_NOTES
      );
      notes = rows.map((row) => ({
        section: row.section,
        ...(row.paragraphIndex !== undefined
          ? { paragraphIndex: row.paragraphIndex }
          : {}),
        instruction: row.instruction,
        outcome: row.outcome,
        tier: row.tier,
        reason: row.reason,
      }));
    }
    const rulesStatus: RulesStatus = !generation
      ? "no_generation"
      : notesUnread
        ? "unread"
        : notes.length === 0
          ? "no_notes"
          : "available";

    // The Reference PD is a `previous_pd` document of THIS project. Archived
    // rows are already out of AI context, so they are out of here too. The
    // filter runs INSIDE the bounded walk (DW-138): `projectDocuments` has no
    // category index, and taking a prefix first dropped any Reference PD that
    // sat behind the project's other attachments.
    const { rows: attached, complete } = await budget.list(
      ctx.db
        .query("projectDocuments")
        .withIndex("by_projectId", (q) => q.eq("projectId", thread.projectId)),
      MAX_PROJECT_DOCUMENT_SCAN,
      (row) => row.category === "previous_pd" && !row.archived
    );
    const documentScanTruncated = !complete;
    // A row whose extraction produced nothing carries no text to compare. It is
    // NOT offered as a choice, because a blank Reference PD parses to three
    // empty sections and would make every draft paragraph look like a
    // difference from it.
    const readable = attached.filter((row) => isComparableReference(row));
    const unreadable = attached.filter((row) => !isComparableReference(row));

    let selected: (typeof attached)[number] | null = null;
    let referenceStatus: ReferenceStatus;
    if (attached.length === 0) {
      referenceStatus = "none";
    } else if (args.referenceFileName !== undefined) {
      selected = readable.find((row) => row.fileName === args.referenceFileName) ?? null;
      referenceStatus = selected
        ? "resolved"
        : unreadable.some((row) => row.fileName === args.referenceFileName)
          ? "unreadable"
          : "unknown_name";
    } else if (readable.length === 1 && readable[0] && complete) {
      // "The only one" is a claim about the whole project. An incomplete walk
      // cannot make it, so the writer must name the file (below: ambiguous).
      selected = readable[0];
      referenceStatus = "resolved";
    } else if (readable.length === 0) {
      referenceStatus = "unreadable";
    } else {
      referenceStatus = "ambiguous";
    }

    let reference: { fileName: string; sections: InventorySections } | null = null;
    if (selected) {
      const parsed = extractReportSections(selected.content ?? "");
      // Text that carries no `Line 242/244/246` skeleton has nothing this
      // comparison can anchor. Saying so beats inventing a difference per
      // paragraph against an empty section.
      if (!parsedIntoSections(parsed)) {
        referenceStatus = "unparsed";
      } else {
        reference = { fileName: selected.fileName, sections: parsed };
      }
    }

    return {
      found: report !== null,
      sections,
      notes,
      rulesStatus,
      rulesAvailable: rulesStatus === "available",
      reference,
      referenceStatus,
      referenceFileNames: readable.map((row) => row.fileName),
      unreadableReferenceFileNames: unreadable.map((row) => row.fileName),
      selectedReferenceFileName:
        selected?.fileName ?? args.referenceFileName ?? null,
      documentScanTruncated,
    };
  },
});

/**
 * Brief entry rows walked per turn. The derivation writes far fewer, and a
 * Brief past `briefs.ts`'s 500-entry edit bound is still readable here; the
 * walk filters as it goes (DW-138), so open questions behind hundreds of
 * glossary or exclusion rows are found, and the bound (rows or the read
 * budget) is reported as an inexact omitted count rather than silently
 * cutting the list.
 */
const MAX_BRIEF_ENTRY_SCAN = 2000;
/** CAP-14's evidence block is a prompt for the writer's next client call, not
 * a dump of the Confidence Map. */
export const MAX_OPEN_QUESTIONS = 20;

/**
 * Story 5 (CAP-14): the Confidence Map entries that are still open, from the
 * Brief the generation actually used (`briefId`). `established` and `partial`
 * are not open questions and never appear. Empty for a generation with no
 * Brief, which keeps the byte-stability contract for legacy projects intact
 * (the evidence block is omitted entirely for an empty list).
 *
 * `omitted` counts the open questions past `MAX_OPEN_QUESTIONS` so the evidence
 * block can say the list is a subset (DW-138); `exact` is false only when the
 * scan bound cut the walk, in which case the count is a lower bound.
 */
async function openQuestionsFor(
  ctx: QueryCtx,
  generation: Doc<"generations"> | null,
  budget: ReturnType<typeof chatReadBudget>
): Promise<{
  questions: ChatOpenQuestion[];
  omitted: ChatOpenQuestionsOmitted;
}> {
  const open: ChatOpenQuestion[] = [];
  let omitted = 0;
  if (!generation?.briefId) return { questions: open, omitted: { count: 0, exact: true } };
  const isOpen = (entry: Doc<"generationBriefEntries">) =>
    entry.group === "confidenceMap" &&
    // Narrowed, not defaulted: a Brief confidence value this block has no
    // wording for must be left out rather than relabelled as unresolved.
    (entry.confidence === "unresolved" || entry.confidence === "unreliable");
  const { rows, complete } = await budget.list(
    ctx.db
      .query("generationBriefEntries")
      .withIndex("by_briefId", (q) => q.eq("briefId", generation.briefId!)),
    MAX_BRIEF_ENTRY_SCAN,
    isOpen
  );
  const labels = new Map<Id<"generationSources">, string>();
  for (const entry of rows) {
    if (open.length >= MAX_OPEN_QUESTIONS) {
      omitted += 1;
      continue;
    }
    if (entry.confidence !== "unresolved" && entry.confidence !== "unreliable") continue;
    // Source rows carry full content. Each lookup is reserved BEFORE it is
    // started; when the budget is spent the question is kept with an
    // unavailable label rather than read (Astra review 2 of DW-138).
    if (!labels.has(entry.sourceId)) {
      const source = await budget.read(() => ctx.db.get(entry.sourceId));
      if (source.ok && source.value) labels.set(entry.sourceId, source.value.label);
    }
    open.push({
      text: entry.text,
      confidence: entry.confidence,
      sourceLabel: labels.get(entry.sourceId) ?? null,
    });
  }
  return { questions: open, omitted: { count: omitted, exact: complete } };
}

/** Grounding context for streamChatReply — thread history stays componentside. */
export const getChatContextV2 = internalQuery({
  args: { reportId: v.id("reports"), agentThreadId: v.string() },
  handler: async (ctx, args) => {
    // Charged in read order so the Brief walk at the end stops with headroom.
    // The document `.collect()` predates this budget and is charged, not
    // bounded: which documents reach the chat is evidence policy, not read
    // policy, and is out of this query's DW-138 scope.
    const budget = chatReadBudget();
    const report = budget.charge(await ctx.db.get(args.reportId));
    if (!report) throw new Error("Report not found");
    // Three small settings rows, reserved before they are read and charged as
    // a flat estimate; the defaults stand in if the reservation ever fails.
    const evidenceBudgetRead = await budget.read(() => chatEvidenceBudget(ctx), 3 * 1024);
    const evidenceBudget = evidenceBudgetRead.ok
      ? evidenceBudgetRead.value
      : DEFAULT_CHAT_EVIDENCE_BUDGET;

    // Ground on the generation that actually produced THIS report — the
    // latest project generation can belong to a newer report (or a failed
    // rerun) and its agentOutputs would describe a different analysis. We
    // fall back when the report predates generation linking OR its linked
    // generation stored no agentOutputs, and then only to a completed
    // generation that has agentOutputs to offer — a best-effort grounding
    // that can still describe an older draft of this project.
    const ownGeneration = report.generationId
      ? budget.charge(await ctx.db.get(report.generationId))
      : null;
    // A generation's outputs live on its row (legacy) or, since 2026-09-25,
    // in a generationArtifacts row, which is charged when it is read.
    const outputsOf = async (row: Doc<"generations">) =>
      outputsInArtifacts(row)
        ? budget.charge(await outputArtifact(ctx, row._id, "agent_outputs"))?.content
        : row.agentOutputs;
    let agentOutputs = ownGeneration ? await outputsOf(ownGeneration) : undefined;
    if (!agentOutputs) {
      const completed = budget.charge(
        await ctx.db
          .query("generations")
          .withIndex("by_projectId_and_status", (q) =>
            q.eq("projectId", report.projectId).eq("status", "completed")
          )
          .order("desc")
          .take(10)
      );
      for (const row of completed) {
        agentOutputs = await outputsOf(row);
        if (agentOutputs) break;
      }
    }

    const documents = budget.charge(
      await ctx.db
        .query("projectDocuments")
        .withIndex("by_projectId", (q) => q.eq("projectId", report.projectId))
        .collect()
    );

    // Recent edit decisions = the assistant's iteration memory (mirrors v1).
    const proposals = budget.charge(
      await ctx.db
        .query("chatProposals")
        .withIndex("by_agentThreadId", (q) =>
          q.eq("agentThreadId", args.agentThreadId)
        )
        .order("desc")
        // Twice the old window (12): highlights and record-only revisions are
        // filtered out below, and a run of them must not push the last real
        // edit decision out of the model's memory. Still bounded and charged.
        .take(24)
    );
    const decisions = proposals
      // Highlights and record-only revisions (DW-135) carry no edit the writer
      // decided on; listing one as "[Edit N: APPLIED]" with an empty target
      // would hand the model a decision nobody made.
      .filter((p) => p.kind !== "references" && !isRecordOnlyProposal(p))
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

    const openQuestions = await openQuestionsFor(ctx, ownGeneration, budget);

    return {
      reportContent: report.content ?? null,
      agentOutputs: agentOutputs ?? null,
      documents: documents
        .filter((d) => !d.archived) // BNH-24: archived docs are out of AI context
        // CAP-3/CAP-4: provenance travels with the document. Trust and the
        // marker label are derived from stored facts, so the action never
        // invents them; absent fields fail closed in `chatEvidence`.
        .map((d) => ({
          fileName: d.fileName,
          content: d.content,
          ...(d.category ? { category: d.category } : {}),
          ...(d.uploaderRole ? { uploaderRole: d.uploaderRole } : {}),
        })),
      decisions,
      // CAP-14: the unresolved and unreliable Confidence Map facts of THIS
      // report's Brief. The trigger is a question, so under the prompt's own
      // routing the assistant must answer without calling a tool; the facts
      // therefore have to be in the turn already, as evidence. `ownGeneration`,
      // never the analysis fallback: a report with no `generationId` (a copied
      // project's report) would otherwise be handed another draft's open
      // questions as its own.
      openQuestions: openQuestions.questions,
      // DW-138: how many open questions the 20 cap left out, so the block can
      // say it is a subset instead of looking complete.
      openQuestionsOmitted: openQuestions.omitted,
      // Resolved in the query, exactly as `getGenerationInput` resolves the
      // analyzer's: the action sends context, it does not decide policy.
      evidenceBudget,
    };
  },
});
