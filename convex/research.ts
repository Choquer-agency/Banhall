import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import {
  cancel,
  vResultValidator,
  vWorkflowId,
  type WorkflowId,
} from "@convex-dev/workflow";
import { requireInternalProjectAccess, getInternalProjectAccessOrNull } from "./lib/auth";
import { domainError } from "./lib/contracts";
import { requireOpenRouterConfigured } from "./lib/providerConfig";
import { scrubBannedWords } from "./lib/reportEdits";
import { researchWorkflowManager } from "./ai/research/manager";
import {
  MAX_CONTEXT_TEXT,
  MAX_INSTRUCTION,
  MAX_SELECTED_TEXT,
  buildExternalBrief,
  canonicalizeSourceUrl,
  projectEvidenceSearchQuery,
  selectProjectEvidence,
} from "./ai/research/core";

const ACTIVE_STATUSES = new Set(["queued", "researching", "reviewing"]);

const runProviderValidator = v.union(
  v.literal("gpt"),
  v.literal("perplexity"),
  v.literal("reviewer")
);

const confidenceValidator = v.union(
  v.literal("high"),
  v.literal("medium"),
  v.literal("low")
);

const evidenceKindValidator = v.union(
  v.literal("external"),
  v.literal("project"),
  v.literal("mixed")
);

const supportValidator = v.union(
  v.literal("supported"),
  v.literal("qualified"),
  v.literal("conflicting"),
  v.literal("unsupported")
);

function bounded(value: string, maximum: number, label: string): string {
  const trimmed = value.replace(/\u0000/g, "").trim();
  if (trimmed.length > maximum) {
    domainError("INVALID_INPUT", `${label} is too long`);
  }
  return trimmed;
}

function fiscalYearLabel(project: Doc<"projects">): string | undefined {
  if (!project.fiscalYearEnd) return undefined;
  const year = new Date(project.fiscalYearEnd).getUTCFullYear();
  return Number.isFinite(year) ? String(year) : undefined;
}

export const startResearch = mutation({
  args: {
    reportId: v.id("reports"),
    selectedText: v.string(),
    selectionFrom: v.number(),
    selectionTo: v.number(),
    surroundingContext: v.string(),
    instruction: v.string(),
  },
  returns: v.id("researchSessions"),
  handler: async (ctx, args): Promise<Id<"researchSessions">> => {
    const report = await ctx.db.get(args.reportId);
    if (!report) domainError("NOT_FOUND", "Report not found");
    const { project, user } = await requireInternalProjectAccess(ctx, report.projectId);
    requireOpenRouterConfigured();

    if (
      !Number.isInteger(args.selectionFrom) ||
      !Number.isInteger(args.selectionTo) ||
      args.selectionFrom < 0 ||
      args.selectionTo <= args.selectionFrom
    ) {
      domainError("INVALID_INPUT", "Research selection is invalid");
    }
    const selectedText = bounded(args.selectedText, MAX_SELECTED_TEXT, "Selected text");
    if (!selectedText) domainError("INVALID_INPUT", "Select report text to research");
    const surroundingContext = bounded(
      args.surroundingContext,
      MAX_CONTEXT_TEXT,
      "Surrounding context"
    );
    const instruction = bounded(args.instruction, MAX_INSTRUCTION, "Research instruction");

    // One active run per writer/report prevents double-clicks from creating two
    // expensive sets of provider calls.
    const recent = await ctx.db
      .query("researchSessions")
      .withIndex("by_reportId_and_requestedBy", (q) =>
        q.eq("reportId", report._id).eq("requestedBy", user._id)
      )
      .order("desc")
      .take(5);
    if (recent.some((session) => ACTIVE_STATUSES.has(session.status))) {
      domainError("INVALID_INPUT", "Research is already running for this report");
    }

    const knownNames = [
      project.clientName,
      project.writer,
      project.interviewer,
      ...(project.interviewees ?? []),
    ].filter((name): name is string => Boolean(name?.trim()));
    const externalBrief = buildExternalBrief({
      selectedText,
      surroundingContext,
      instruction,
      projectTitle: project.sredTitle ?? project.title,
      industry: project.industry,
      scienceCode: project.scienceCode,
      fiscalYear: fiscalYearLabel(project),
      knownNames,
    });
    const now = Date.now();
    const sessionId = await ctx.db.insert("researchSessions", {
      projectId: project._id,
      reportId: report._id,
      requestedBy: user._id,
      selectedText,
      selectionFrom: args.selectionFrom,
      selectionTo: args.selectionTo,
      surroundingContext,
      instruction,
      externalBrief,
      reportRevisionNumber: report.revisionNumber ?? 0,
      status: "queued",
      createdAt: now,
      updatedAt: now,
    });

    const workflowId: WorkflowId = await researchWorkflowManager.start(
      ctx,
      internal.ai.research.workflow.runResearch,
      { sessionId },
      {
        onComplete: internal.research.completeResearchWorkflow,
        context: { sessionId },
        startAsync: true,
      }
    );
    await ctx.db.patch(sessionId, { workflowId, updatedAt: Date.now() });
    return sessionId;
  },
});

export const listSessions = query({
  args: { reportId: v.id("reports") },
  handler: async (ctx, args) => {
    const report = await ctx.db.get(args.reportId);
    if (!report || !(await getInternalProjectAccessOrNull(ctx, report.projectId))) return [];
    const sessions = await ctx.db
      .query("researchSessions")
      .withIndex("by_reportId", (q) => q.eq("reportId", args.reportId))
      .order("desc")
      .take(20);
    // Summary projection: the feed renders at most ~220 chars of the selection
    // and reads the answer/details from getSessionDetails, so don't re-ship
    // 12KB selections × 20 sessions on every workflow status patch.
    return sessions.map((session) => ({
      _id: session._id,
      selectedText:
        session.selectedText.length > 240
          ? `${session.selectedText.slice(0, 239)}…`
          : session.selectedText,
      instruction: session.instruction,
      status: session.status,
      createdAt: session.createdAt,
    }));
  },
});

export const getSessionDetails = query({
  args: { sessionId: v.id("researchSessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session || !(await getInternalProjectAccessOrNull(ctx, session.projectId))) return null;
    const [sources, claims, runs, proposal] = await Promise.all([
      ctx.db
        .query("researchSources")
        .withIndex("by_sessionId", (q) => q.eq("sessionId", session._id))
        .order("asc")
        .take(80),
      ctx.db
        .query("researchClaims")
        .withIndex("by_sessionId", (q) => q.eq("sessionId", session._id))
        .order("asc")
        .take(20),
      ctx.db
        .query("researchRuns")
        .withIndex("by_sessionId", (q) => q.eq("sessionId", session._id))
        .order("asc")
        .take(10),
      session.proposalId ? ctx.db.get(session.proposalId) : Promise.resolve(null),
    ]);
    // Projections match what ResearchFeed renders. This query re-runs on every
    // workflow status patch, so don't ship the 30KB brief, 12KB selection, or
    // 100KB researcher memos the panel never reads.
    return {
      session: {
        _id: session._id,
        status: session.status,
        answer: session.answer ?? null,
        evidenceBoundary: session.evidenceBoundary ?? null,
        warnings: session.warnings ?? [],
        errorMessage: session.errorMessage ?? null,
        feedback: session.feedback ?? null,
      },
      sources,
      claims: claims.map((claim) => ({
        _id: claim._id,
        text: claim.text,
        evidenceKind: claim.evidenceKind,
        support: claim.support,
        sourceIds: claim.sourceIds,
      })),
      proposal,
      runs: runs.map((run) => ({
        provider: run.provider,
        status: run.status,
      })),
    };
  },
});

export const submitFeedback = mutation({
  args: {
    sessionId: v.id("researchSessions"),
    rating: v.union(v.literal("helpful"), v.literal("not_helpful")),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) domainError("NOT_FOUND", "Research session not found");
    const { user } = await requireInternalProjectAccess(ctx, session.projectId);
    if (session.status !== "completed") {
      domainError("INVALID_INPUT", "Rate research after it completes");
    }
    // Idempotent: the first rating wins; a remounted panel resubmitting is a
    // no-op instead of a duplicate Brain feedback row.
    if (session.feedback) return null;

    const proposal = session.proposalId ? await ctx.db.get(session.proposalId) : null;
    const now = Date.now();
    await ctx.db.insert("brainFeedbackQueue", {
      fromUserId: user._id,
      fromName: user.name,
      reportId: session.reportId,
      projectId: session.projectId,
      body: [
        `Contextual research response rated ${args.rating === "helpful" ? "helpful" : "not helpful"}.`,
        `Research direction: ${session.instruction || "No additional direction"}`,
        `Selected passage: ${session.selectedText}`,
        session.answer ? `Research response: ${session.answer}` : "",
        proposal?.newText?.trim() ? `Suggested revision: ${proposal.newText.trim()}` : "",
      ]
        .filter(Boolean)
        .join("\n\n")
        .slice(0, 40_000),
      status: "pending",
      createdAt: now,
    });
    await ctx.db.patch(session._id, {
      feedback: { rating: args.rating, submittedBy: user._id, submittedAt: now },
      updatedAt: now,
    });
    return null;
  },
});

export const cancelResearch = mutation({
  args: { sessionId: v.id("researchSessions") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) return null;
    await requireInternalProjectAccess(ctx, session.projectId);
    if (!ACTIVE_STATUSES.has(session.status)) return null;
    if (session.workflowId) {
      await cancel(ctx, components.researchWorkflow, session.workflowId as WorkflowId);
    }
    await ctx.db.patch(session._id, {
      status: "canceled",
      errorMessage: undefined,
      updatedAt: Date.now(),
      completedAt: Date.now(),
    });
    return null;
  },
});

// ── Internal workflow support ───────────────────────────────────────────────

/**
 * Deterministic private-document retrieval, run as a workflow step so the
 * writer's click returns without scanning the project corpus. The excerpts
 * never enter either external research prompt.
 */
export const collectProjectEvidence = internalMutation({
  args: { sessionId: v.id("researchSessions") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.status === "canceled") return null;
    const query = `${session.instruction}\n${session.selectedText}`;
    const evidenceQuery = projectEvidenceSearchQuery(query);
    const documents = evidenceQuery
      ? await ctx.db
          .query("projectDocuments")
          .withSearchIndex("search_content", (q) =>
            q.search("content", evidenceQuery).eq("projectId", session.projectId)
          )
          .take(12)
      : await ctx.db
          .query("projectDocuments")
          .withIndex("by_projectId", (q) => q.eq("projectId", session.projectId))
          .order("desc")
          .take(8);
    const evidence = selectProjectEvidence(
      documents
        .filter((document) => !document.archived && document.content.trim())
        .map((document) => ({
          id: document._id,
          title: document.fileName,
          content: document.content,
        })),
      query,
      6
    );
    const now = Date.now();
    for (const item of evidence) {
      const documentId = ctx.db.normalizeId("projectDocuments", item.documentId);
      if (!documentId) continue;
      await ctx.db.insert("researchSources", {
        sessionId: session._id,
        projectId: session.projectId,
        kind: "project_document",
        title: item.title,
        excerpt: item.excerpt,
        projectDocumentId: documentId,
        verification: "project_evidence",
        createdAt: now,
      });
    }
    return null;
  },
});

export const markResearchStarted = internalMutation({
  args: { sessionId: v.id("researchSessions") },
  returns: v.boolean(),
  handler: async (ctx, args): Promise<boolean> => {
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.status === "canceled") return false;
    if (session.status === "queued") {
      await ctx.db.patch(session._id, { status: "researching", updatedAt: Date.now() });
    }
    return true;
  },
});

export const markResearchReviewing = internalMutation({
  args: { sessionId: v.id("researchSessions") },
  returns: v.boolean(),
  handler: async (ctx, args): Promise<boolean> => {
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.status === "canceled") return false;
    await ctx.db.patch(session._id, { status: "reviewing", updatedAt: Date.now() });
    return true;
  },
});

/**
 * Slim context for the researcher/Brain steps: they need only the session and
 * a few project/user fields. The full getActionContext (sources + runs) is
 * reserved for the reviewer, which actually consolidates them.
 */
export const getSessionForRun = internalQuery({
  args: { sessionId: v.id("researchSessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) throw new Error("Research session not found");
    const project = await ctx.db.get(session.projectId);
    if (!project) throw new Error("Research context is incomplete");
    return {
      session,
      project: {
        _id: project._id,
        industry: project.industry,
        scienceCode: project.scienceCode,
      },
      userId: session.requestedBy,
    };
  },
});

export const getActionContext = internalQuery({
  args: { sessionId: v.id("researchSessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) throw new Error("Research session not found");
    const [project, report, user, sources, runs] = await Promise.all([
      ctx.db.get(session.projectId),
      ctx.db.get(session.reportId),
      ctx.db.get(session.requestedBy),
      ctx.db
        .query("researchSources")
        .withIndex("by_sessionId", (q) => q.eq("sessionId", session._id))
        .order("asc")
        .take(80),
      ctx.db
        .query("researchRuns")
        .withIndex("by_sessionId", (q) => q.eq("sessionId", session._id))
        .order("asc")
        .take(10),
    ]);
    if (!project || !report || !user) throw new Error("Research context is incomplete");
    if (report.projectId !== project._id) throw new Error("Research report/project mismatch");
    return { session, project, report, user, sources, runs };
  },
});

export const reserveRun = internalMutation({
  args: {
    sessionId: v.id("researchSessions"),
    provider: runProviderValidator,
    model: v.string(),
  },
  returns: v.object({ runId: v.id("researchRuns"), shouldRun: v.boolean() }),
  handler: async (ctx, args): Promise<{ runId: Id<"researchRuns">; shouldRun: boolean }> => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) throw new Error("Research session not found");
    const existing = await ctx.db
      .query("researchRuns")
      .withIndex("by_sessionId_and_provider", (q) =>
        q.eq("sessionId", args.sessionId).eq("provider", args.provider)
      )
      .unique();
    if (existing) return { runId: existing._id, shouldRun: false };
    if (session.status === "canceled") throw new Error("Research was canceled");
    const runId = await ctx.db.insert("researchRuns", {
      sessionId: session._id,
      projectId: session.projectId,
      provider: args.provider,
      model: args.model,
      status: "running",
      startedAt: Date.now(),
    });
    return { runId, shouldRun: true };
  },
});

const citationValidator = v.object({
  url: v.string(),
  title: v.string(),
  content: v.optional(v.string()),
});

export const completeResearcherRun = internalMutation({
  args: {
    runId: v.id("researchRuns"),
    provider: v.union(v.literal("gpt"), v.literal("perplexity")),
    responseText: v.string(),
    providerResponseId: v.optional(v.string()),
    citations: v.array(citationValidator),
    inputTokens: v.number(),
    outputTokens: v.number(),
    costUsd: v.optional(v.number()),
    webSearchRequests: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.provider !== args.provider) throw new Error("Research run mismatch");
    const now = Date.now();
    await ctx.db.patch(run._id, {
      status: "completed",
      responseText: args.responseText.slice(0, 100_000),
      providerResponseId: args.providerResponseId,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      costUsd: args.costUsd,
      webSearchRequests: args.webSearchRequests,
      completedAt: now,
      errorMessage: undefined,
    });

    // One indexed read for the session's sources, then upsert from a map —
    // instead of a serialized .unique() lookup per citation (up to 40).
    const existingSources = await ctx.db
      .query("researchSources")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", run.sessionId))
      .take(80);
    const byCanonicalUrl = new Map(
      existingSources
        .filter((source) => source.canonicalUrl)
        .map((source) => [source.canonicalUrl!, source])
    );
    for (const citation of args.citations.slice(0, 40)) {
      const canonicalUrl = canonicalizeSourceUrl(citation.url);
      if (!canonicalUrl) continue;
      const existing = byCanonicalUrl.get(canonicalUrl);
      const gpt = args.provider === "gpt" || existing?.citedByGpt === true;
      const perplexity = args.provider === "perplexity" || existing?.citedByPerplexity === true;
      let domain: string | undefined;
      try {
        domain = new URL(canonicalUrl).hostname.replace(/^www\./, "");
      } catch {
        /* canonicalizeSourceUrl already validated this */
      }
      if (existing) {
        const title =
          existing.title.length < citation.title.length
            ? citation.title.slice(0, 300)
            : existing.title;
        const excerpt =
          (citation.content?.length ?? 0) > (existing.excerpt?.length ?? 0)
            ? citation.content!.slice(0, 5_000)
            : existing.excerpt;
        await ctx.db.patch(existing._id, {
          citedByGpt: gpt,
          citedByPerplexity: perplexity,
          verification: gpt && perplexity ? "cross_provider" : "provider_cited",
          title,
          ...(excerpt !== undefined ? { excerpt } : {}),
        });
      } else {
        // Citations are already URL-deduped per response in
        // parseOpenRouterResearchResponse, so no map update is needed here.
        await ctx.db.insert("researchSources", {
          sessionId: run.sessionId,
          projectId: run.projectId,
          kind: "external",
          title: citation.title.slice(0, 300),
          canonicalUrl,
          ...(domain ? { domain } : {}),
          ...(citation.content ? { excerpt: citation.content.slice(0, 5_000) } : {}),
          citedByGpt: gpt,
          citedByPerplexity: perplexity,
          verification: "provider_cited",
          createdAt: now,
        });
      }
    }
    return null;
  },
});

export const failRun = internalMutation({
  args: { runId: v.id("researchRuns"), errorMessage: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.status === "completed") return null;
    await ctx.db.patch(run._id, {
      status: "failed",
      errorMessage: args.errorMessage.slice(0, 2_000),
      completedAt: Date.now(),
    });
    return null;
  },
});

export const saveBrainEvidence = internalMutation({
  args: {
    sessionId: v.id("researchSessions"),
    degraded: v.boolean(),
    sources: v.array(
      v.object({
        title: v.string(),
        excerpt: v.string(),
        brainSourceId: v.optional(v.id("brainSources")),
      })
    ),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.status === "canceled") return null;
    const now = Date.now();
    for (const source of args.sources.slice(0, 3)) {
      await ctx.db.insert("researchSources", {
        sessionId: session._id,
        projectId: session.projectId,
        kind: "brain_pattern",
        title: source.title.slice(0, 300),
        excerpt: source.excerpt.slice(0, 5_000),
        brainSourceId: source.brainSourceId,
        verification: "brain_pattern",
        createdAt: now,
      });
    }
    await ctx.db.patch(session._id, {
      brainStatus: args.degraded ? "degraded" : args.sources.length ? "complete" : "empty",
      updatedAt: now,
    });
    return null;
  },
});

export const completeReviewerRun = internalMutation({
  args: {
    runId: v.id("researchRuns"),
    responseText: v.string(),
    providerResponseId: v.optional(v.string()),
    inputTokens: v.number(),
    outputTokens: v.number(),
    costUsd: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.provider !== "reviewer") throw new Error("Reviewer run mismatch");
    await ctx.db.patch(run._id, {
      status: "completed",
      responseText: args.responseText.slice(0, 100_000),
      providerResponseId: args.providerResponseId,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      costUsd: args.costUsd,
      completedAt: Date.now(),
      errorMessage: undefined,
    });
    return null;
  },
});

export const saveReviewResult = internalMutation({
  args: {
    sessionId: v.id("researchSessions"),
    answer: v.string(),
    evidenceBoundary: v.string(),
    confidence: confidenceValidator,
    warnings: v.array(v.string()),
    claims: v.array(
      v.object({
        text: v.string(),
        evidenceKind: evidenceKindValidator,
        support: supportValidator,
        sourceIds: v.array(v.id("researchSources")),
      })
    ),
    proposedText: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.status === "canceled") return null;
    const now = Date.now();
    // Snapshot provenance for an applied edit. Brain patterns guide voice
    // only — never evidence — so they don't count; chatV2.applyProposal copies
    // this number instead of re-deriving the policy.
    const evidenceSourceCount = (
      await ctx.db
        .query("researchSources")
        .withIndex("by_sessionId", (q) => q.eq("sessionId", session._id))
        .take(80)
    ).filter((source) => source.kind !== "brain_pattern").length;
    const oldClaims = await ctx.db
      .query("researchClaims")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", session._id))
      .take(50);
    for (const claim of oldClaims) await ctx.db.delete(claim._id);
    for (const claim of args.claims.slice(0, 20)) {
      await ctx.db.insert("researchClaims", {
        sessionId: session._id,
        projectId: session.projectId,
        text: claim.text.slice(0, 2_000),
        evidenceKind: claim.evidenceKind,
        support: claim.support,
        sourceIds: claim.sourceIds.slice(0, 10),
        createdAt: now,
      });
    }

    const proposedText = scrubBannedWords(args.proposedText).trim();
    let proposalId = session.proposalId;
    if (proposedText && proposedText !== session.selectedText.trim()) {
      if (proposalId) {
        const proposal = await ctx.db.get(proposalId);
        if (proposal?.state === "pending") {
          await ctx.db.patch(proposalId, { newText: proposedText.slice(0, 12_000) });
        }
      } else {
        proposalId = await ctx.db.insert("chatProposals", {
          agentThreadId: `research:${session._id}`,
          projectId: session.projectId,
          reportId: session.reportId,
          kind: "edit",
          targetText: session.selectedText,
          newText: proposedText.slice(0, 12_000),
          researchSessionId: session._id,
          requireUniqueTarget: true,
          state: "pending",
          createdAt: now,
        });
      }
    }
    await ctx.db.patch(session._id, {
      status: "completed",
      answer: args.answer.slice(0, 16_000),
      evidenceBoundary: args.evidenceBoundary.slice(0, 4_000),
      evidenceSourceCount,
      confidence: args.confidence,
      // Dedupe: the UI keys its warning list by text, and a duplicate string
      // (reviewer output + our appended cross-provider note) would crash the
      // keyed each — the exact each_key_duplicate class from the Jul 10 alert.
      warnings: Array.from(new Set(args.warnings))
        .slice(0, 10)
        .map((warning) => warning.slice(0, 1_000)),
      ...(proposalId ? { proposalId } : {}),
      errorMessage: undefined,
      updatedAt: now,
      completedAt: now,
    });
    return null;
  },
});

export const failSession = internalMutation({
  args: { sessionId: v.id("researchSessions"), errorMessage: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const session = await ctx.db.get(args.sessionId);
    if (
      !session ||
      session.status === "completed" ||
      session.status === "failed" ||
      session.status === "canceled"
    ) {
      return null;
    }
    await ctx.db.patch(session._id, {
      status: "failed",
      errorMessage: args.errorMessage.slice(0, 2_000),
      updatedAt: Date.now(),
      completedAt: Date.now(),
    });
    return null;
  },
});

export const completeResearchWorkflow = internalMutation({
  args: {
    workflowId: vWorkflowId,
    result: vResultValidator,
    context: v.object({ sessionId: v.id("researchSessions") }),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const session = await ctx.db.get(args.context.sessionId);
    if (
      !session ||
      session.status === "completed" ||
      session.status === "failed" ||
      session.status === "canceled"
    ) {
      return null;
    }
    if (args.result.kind === "canceled") {
      await ctx.db.patch(session._id, {
        status: "canceled",
        updatedAt: Date.now(),
        completedAt: Date.now(),
      });
    } else if (args.result.kind === "failed") {
      await ctx.db.patch(session._id, {
        status: "failed",
        errorMessage: args.result.error.slice(0, 2_000),
        updatedAt: Date.now(),
        completedAt: Date.now(),
      });
    } else {
      // A successful workflow should have been finalized by saveReviewResult.
      // Fencing this state prevents a silent forever-spinner if that invariant
      // is broken by a future workflow edit.
      await ctx.db.patch(session._id, {
        status: "failed",
        errorMessage: "Research finished without a consolidated result.",
        updatedAt: Date.now(),
        completedAt: Date.now(),
      });
    }
    return null;
  },
});
