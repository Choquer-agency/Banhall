import { query, mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  getInternalProjectAccessOrNull,
  getProjectAccess,
  requireFilingReady,
  requireInternalProjectAccess,
  requireRole,
} from "./lib/auth";
import {
  assertBoundedCitations,
  claimCitationValidator,
  domainError,
  sha256,
} from "./lib/contracts";
import { extractPlainText } from "./lib/reportEdits";
import { normalizeCraScienceCode } from "../shared/craScienceCodes";
export const getLatestReport = query({
  args: {
    projectId: v.id("projects"),
    shareToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const access = await getProjectAccess(ctx, args.projectId, args.shareToken);
    if (access.kind === "denied") return null;
    if (access.kind === "client_review") {
      const reportId = access.project.sharedReportId;
      if (!reportId) return null;
      const report = await ctx.db.get(reportId);
      if (!report || report.projectId !== args.projectId) return null;
      return report;
    }
    return await ctx.db
      .query("reports")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .first();
  },
});

export const updateReportContent = mutation({
  args: {
    reportId: v.id("reports"),
    content: v.string(),
    expectedRevisionNumber: v.number(),
  },
  handler: async (ctx, args) => {
    const report = await ctx.db.get(args.reportId);
    if (!report) domainError("NOT_FOUND", "Report not found");
    await requireInternalProjectAccess(ctx, report.projectId);
    const revisionNumber = report.revisionNumber ?? 0;
    if (args.expectedRevisionNumber !== revisionNumber) {
      domainError("STALE_REVISION", "The report changed before this save completed");
    }
    if (!args.content.trim() || args.content.length > 1_000_000) {
      domainError("INVALID_INPUT", "Report content is empty or exceeds 1,000,000 characters");
    }
    await ctx.db.patch(args.reportId, {
      content: args.content,
      contentHash: await sha256(args.content),
      revisionNumber: revisionNumber + 1,
      // Any writer edit requires a new provenance review for the exact revision.
      provenanceId: undefined,
      updatedAt: Date.now(),
    });
    return revisionNumber + 1;
  },
});

export const createProvenance = internalMutation({
  args: {
    projectId: v.id("projects"),
    generationId: v.optional(v.id("generations")),
    sourceTranscriptId: v.optional(v.id("transcripts")),
    content: v.string(),
    claims: v.array(claimCitationValidator),
  },
  handler: async (ctx, args) => {
    assertBoundedCitations(args.claims);
    const contentHash = await sha256(args.content);
    const reportText = extractPlainText(args.content);
    const checkedSources = new Map<
      Id<"generationSources">,
      Doc<"generationSources"> | null
    >();
    for (const claim of args.claims) {
      if (!reportText.includes(claim.claimText)) {
        domainError("INVALID_INPUT", `Claim ${claim.claimId} is not present in the report`);
      }
      if (claim.claimTextHash !== (await sha256(claim.claimText))) {
        domainError("INVALID_INPUT", `Claim ${claim.claimId} has an invalid text hash`);
      }
      for (const citation of claim.sources) {
        let source = checkedSources.get(citation.generationSourceId);
        if (!source) {
          source = await ctx.db.get(citation.generationSourceId);
          checkedSources.set(citation.generationSourceId, source);
        }
        if (
          !source ||
          source.projectId !== args.projectId ||
          (args.generationId && source.generationId !== args.generationId) ||
          source.contentHash !== citation.sourceContentHash ||
          citation.startOffset < 0 ||
          citation.endOffset <= citation.startOffset ||
          citation.endOffset > source.content.length ||
          source.content.slice(citation.startOffset, citation.endOffset) !==
            citation.exactExcerpt
        ) {
          domainError("INVALID_INPUT", `Claim ${claim.claimId} has an invalid source citation`);
        }
      }
    }
    const generation = args.generationId
      ? await ctx.db.get(args.generationId)
      : null;
    return await ctx.db.insert("reportProvenance", {
      projectId: args.projectId,
      generationId: args.generationId,
      sourceTranscriptId: args.sourceTranscriptId,
      contentHash,
      status: "needs_review",
      claims: args.claims,
      createdAt: Date.now(),
      createdBy: generation?.requestedBy,
    });
  },
});

export const getProvenance = query({
  args: { reportId: v.id("reports") },
  handler: async (ctx, args) => {
    const report = await ctx.db.get(args.reportId);
    if (!report) return null;
    if (!(await getInternalProjectAccessOrNull(ctx, report.projectId))) return null;
    if (!report.provenanceId) {
      return {
        status: "unavailable_legacy" as const,
        contentHash: report.contentHash,
        claims: [],
      };
    }
    const provenance = await ctx.db.get(report.provenanceId);
    if (!provenance || provenance.projectId !== report.projectId) return null;
    return {
      id: provenance._id,
      status: provenance.status,
      contentHash: provenance.contentHash,
      claims: provenance.claims,
      reviewedAt: provenance.reviewedAt,
      reviewedBy: provenance.reviewedBy,
    };
  },
});

export const reviewClaimCitation = mutation({
  args: {
    reportId: v.id("reports"),
    provenanceId: v.id("reportProvenance"),
    claimId: v.string(),
    state: v.union(v.literal("approved"), v.literal("unsupported")),
  },
  handler: async (ctx, args) => {
    const reviewer = await requireRole(ctx, ["manager", "admin"]);
    const report = await ctx.db.get(args.reportId);
    const provenance = await ctx.db.get(args.provenanceId);
    if (
      !report ||
      !provenance ||
      report.projectId !== provenance.projectId ||
      report.provenanceId !== provenance._id
    ) {
      domainError("STALE_REVISION", "The report provenance changed before review");
    }
    const claims = provenance.claims.map((claim) =>
      claim.claimId === args.claimId ? { ...claim, state: args.state } : claim
    );
    if (!claims.some((claim) => claim.claimId === args.claimId)) {
      domainError("NOT_FOUND", "Claim not found");
    }
    const hasUnsupported = claims.some(
      (claim) => claim.material && claim.state === "unsupported"
    );
    const allApproved = claims.every(
      (claim) => !claim.material || claim.state === "approved"
    );
    const now = Date.now();
    const nextId = await ctx.db.insert("reportProvenance", {
      projectId: provenance.projectId,
      generationId: provenance.generationId,
      sourceTranscriptId: provenance.sourceTranscriptId,
      contentHash: provenance.contentHash,
      status: hasUnsupported ? "rejected" : allApproved ? "approved" : "needs_review",
      claims,
      createdAt: now,
      createdBy: provenance.createdBy,
      reviewedAt: now,
      reviewedBy: reviewer._id,
    });
    await ctx.db.patch(report._id, { provenanceId: nextId, updatedAt: now });
    return nextId;
  },
});

export const listReportVersions = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    if (!(await getInternalProjectAccessOrNull(ctx, args.projectId))) return [];
    const reports = await ctx.db
      .query("reports")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .take(1_000);
    return await Promise.all(
      reports.map(async (report) => {
        const provenance = report.provenanceId
          ? await ctx.db.get(report.provenanceId)
          : null;
        return {
          reportId: report._id,
          reportVersion: report.version,
          revisionNumber: report.revisionNumber ?? 0,
          content: report.content,
          generatedAt: report.generatedAt,
          updatedAt: report.updatedAt,
          generationId: report.generationId,
          provenanceStatus: provenance?.status ?? "unavailable_legacy",
        };
      })
    );
  },
});

const TEMPLATE_VERSION = "schedule60-2026-05";

async function exportSnapshot(
  ctx: Parameters<typeof requireInternalProjectAccess>[0],
  report: Doc<"reports">,
  project: Doc<"projects">,
  contentHash: string
) {
  const supportingDocuments = await ctx.db
    .query("projectDocuments")
    .withIndex("by_projectId", (q) => q.eq("projectId", project._id))
    .take(250);
  return {
    reportId: report._id,
    reportVersion: report.version,
    revisionNumber: report.revisionNumber ?? 0,
    contentHash,
    content: report.content,
    templateVersion: TEMPLATE_VERSION,
    supportingDocumentCount: supportingDocuments.filter(
      (document) => !document.archived
    ).length,
    project: {
      title: project.sredTitle ?? project.title,
      clientName: project.clientName,
      fiscalYearEnd: project.fiscalYearEnd,
      scienceCode: project.scienceCode?.trim() || undefined,
    },
  };
}

/**
 * Freeze the exact report and project metadata that client-side content
 * validation inspects. Filing readiness is intentionally deferred until the
 * user has seen every mapped content error and overridable warning.
 */
export const preflightExport = query({
  args: {
    reportId: v.id("reports"),
  },
  handler: async (ctx, args) => {
    const report = await ctx.db.get(args.reportId);
    if (!report) domainError("NOT_FOUND", "Report not found");
    const { project } = await requireInternalProjectAccess(ctx, report.projectId);
    const contentHash = await sha256(report.content);
    if (report.contentHash && report.contentHash !== contentHash) {
      domainError("STALE_REVISION", "The stored report hash does not match its content");
    }
    return await exportSnapshot(ctx, report, project, contentHash);
  },
});

/**
 * Authorize only the immutable revision that passed preflight. This is the
 * final filing-readiness gate and must run immediately before DOCX generation.
 */
export const authorizeExport = mutation({
  args: {
    reportId: v.id("reports"),
    expectedRevisionNumber: v.number(),
    expectedContentHash: v.string(),
  },
  handler: async (ctx, args) => {
    const report = await ctx.db.get(args.reportId);
    if (!report) domainError("NOT_FOUND", "Report not found");
    const { project, user } = await requireInternalProjectAccess(ctx, report.projectId);
    const revisionNumber = report.revisionNumber ?? 0;
    if (revisionNumber !== args.expectedRevisionNumber) {
      domainError("STALE_REVISION", "The report changed after export preflight");
    }
    const contentHash = await sha256(report.content);
    if (
      contentHash !== args.expectedContentHash ||
      (report.contentHash && report.contentHash !== contentHash)
    ) {
      domainError("STALE_REVISION", "The report content changed after export preflight");
    }
    if (!normalizeCraScienceCode(project.scienceCode)) {
      domainError(
        "INVALID_INPUT",
        "A valid CRA T4088 line 206 field-of-science code is required for export"
      );
    }
    await requireFilingReady(ctx, project, {
      ...report,
      contentHash,
      revisionNumber,
    });
    const exportId = await ctx.db.insert("reportExports", {
      projectId: project._id,
      reportId: report._id,
      reportVersion: report.version,
      revisionNumber,
      provenanceId: report.provenanceId,
      contentHash,
      templateVersion: TEMPLATE_VERSION,
      actorId: user._id,
      status: "authorized",
      authorizedAt: Date.now(),
    });
    return {
      exportId,
      reportId: report._id,
      revisionNumber,
      contentHash,
    };
  },
});

export const completeExport = mutation({
  args: {
    exportId: v.id("reportExports"),
    canonicalDtoHash: v.string(),
    documentHash: v.string(),
  },
  handler: async (ctx, args) => {
    const record = await ctx.db.get(args.exportId);
    if (!record) domainError("EXPORT_NOT_AUTHORIZED", "Export authorization not found");
    const { user } = await requireInternalProjectAccess(ctx, record.projectId);
    if (record.actorId !== user._id && user.role !== "admin") {
      domainError("NOT_AUTHORIZED", "Only the export actor or an administrator can complete it");
    }
    if (record.status !== "authorized") {
      domainError("EXPORT_NOT_AUTHORIZED", "Export authorization is no longer active");
    }
    const hashPattern = /^[a-f0-9]{64}$/;
    if (!hashPattern.test(args.canonicalDtoHash) || !hashPattern.test(args.documentHash)) {
      domainError("INVALID_INPUT", "Export hashes must be SHA-256 hex values");
    }
    await ctx.db.patch(record._id, {
      canonicalDtoHash: args.canonicalDtoHash,
      documentHash: args.documentHash,
      status: "completed",
      completedAt: Date.now(),
    });
  },
});

export const failExport = mutation({
  args: {
    exportId: v.id("reportExports"),
    failureCode: v.string(),
  },
  handler: async (ctx, args) => {
    const record = await ctx.db.get(args.exportId);
    if (!record) return;
    const { user } = await requireInternalProjectAccess(ctx, record.projectId);
    if (record.actorId !== user._id && user.role !== "admin") {
      domainError("NOT_AUTHORIZED", "Only the export actor or an administrator can fail it");
    }
    if (record.status !== "authorized") return;
    await ctx.db.patch(record._id, {
      status: "failed",
      failureCode: args.failureCode.slice(0, 100),
      completedAt: Date.now(),
    });
  },
});

// ─── BNH-10 flywheel: post-edit distance ─────────────────────────────────────

/** Lowercased word multiset — cheap, order-insensitive edit signal. */
function wordBag(text: string): Map<string, number> {
  const bag = new Map<string, number>();
  for (const raw of text.toLowerCase().split(/\s+/)) {
    const w = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    if (!w) continue;
    bag.set(w, (bag.get(w) ?? 0) + 1);
  }
  return bag;
}

function bagOverlap(a: Map<string, number>, b: Map<string, number>): number {
  let n = 0;
  for (const [w, ca] of a) n += Math.min(ca, b.get(w) ?? 0);
  return n;
}

function bagSize(bag: Map<string, number>): number {
  let n = 0;
  for (const c of bag.values()) n += c;
  return n;
}

const normalizePara = (p: string) => p.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Post-edit distance (PED): how much of the AI draft the writer changed before
 * the report's current state — the north-star "is the system improving" metric
 * (regulatory-writing shops track exactly this; falling PED over time = better
 * drafts, >40-50% sustained = fix prompts/retrieval, not writers).
 *
 * v1 is deliberately cheap and order-insensitive: word-multiset similarity
 * (Sørensen–Dice) + unchanged-paragraph ratio against the "generated" baseline
 * snapshot frozen at candidate selection. It trends correctly; it does not
 * attribute edits to positions. Returns null for reports predating baseline
 * snapshots.
 */
export const postEditDistance = query({
  args: {
    reportId: v.id("reports"),
    shareToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const report = await ctx.db.get(args.reportId);
    if (!report) return null;
    const access = await getProjectAccess(ctx, report.projectId, args.shareToken);
    if (access.kind === "denied") return null;
    if (
      access.kind === "client_review" &&
      access.project.sharedReportId !== report._id
    ) {
      return null;
    }

    const baseline = await ctx.db
      .query("reportSnapshots")
      .withIndex("by_reportId", (q) => q.eq("reportId", args.reportId))
      .filter((q) => q.eq(q.field("reason"), "generated"))
      .first();
    if (!baseline) return null;

    const draftText = extractPlainText(baseline.content);
    const currentText = extractPlainText(report.content);

    const draftBag = wordBag(draftText);
    const currentBag = wordBag(currentText);
    const draftWords = bagSize(draftBag);
    const currentWords = bagSize(currentBag);
    const similarity =
      draftWords + currentWords === 0
        ? 1
        : (2 * bagOverlap(draftBag, currentBag)) / (draftWords + currentWords);

    const draftParas = draftText.split(/\n{2,}|\n/).map(normalizePara).filter(Boolean);
    const currentParas = new Map<string, number>();
    for (const p of currentText.split(/\n{2,}|\n/).map(normalizePara).filter(Boolean)) {
      currentParas.set(p, (currentParas.get(p) ?? 0) + 1);
    }
    let unchanged = 0;
    for (const p of draftParas) {
      const left = currentParas.get(p) ?? 0;
      if (left > 0) {
        unchanged += 1;
        currentParas.set(p, left - 1);
      }
    }

    return {
      /** 0 = untouched draft, 1 = fully rewritten. */
      ped: 1 - similarity,
      wordSimilarity: similarity,
      draftWords,
      currentWords,
      paragraphsTotal: draftParas.length,
      paragraphsUnchanged: unchanged,
      draftLabel: baseline.label,
      baselineAt: baseline.createdAt,
    };
  },
});
