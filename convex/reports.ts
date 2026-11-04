import { getSourceRowWithText, type SourceRowWithText } from "./lib/sourceText";
import { persistDeterministicFindings } from "./lib/qaFindings";
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
import { requireReportEditAccess } from "./lib/roleCapabilities";
import { provenanceForEdit } from "./lib/editProvenance";
import {
  assertBoundedCitations,
  claimCitationValidator,
  domainError,
  sha256,
} from "./lib/contracts";
import { isProjectDeleting } from "./lib/projectDeletion";
import { citationSpeakerReader, evidenceSpan } from "./lib/citationSpeakers";
import { extractPlainText } from "./lib/reportEdits";
import { computeEditDistance, noteReportEditForSize } from "./lib/editDistance";
import { normalizeCraScienceCode } from "../shared/craScienceCodes";
import { reportSectionMetrics } from "../src/lib/reportSections";
import { getPendingReportProvenance, getReportBody, reportWithBody, writeReportBody, type ReportWithBody } from "./lib/reportBodies";
import { deleteProvenanceIfUnheld, materializePendingReportProvenance, stageProvenanceForEdit } from "./lib/editProvenance";
import { internal } from "./_generated/api";
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
      return await reportWithBody(ctx, report);
    }
    const report = await ctx.db
      .query("reports")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .first();
    return report ? await reportWithBody(ctx, report) : null;
  },
});

export const updateReportContent = mutation({
  args: {
    reportId: v.id("reports"),
    content: v.string(),
    expectedRevisionNumber: v.number(),
  },
  handler: async (ctx, args) => {
    const stored = await ctx.db.get(args.reportId);
    if (!stored) domainError("NOT_FOUND", "Report not found");
    const report = await reportWithBody(ctx, stored);
    // report.editProse (matrix: Consultant = own, Manager/Admin = all) is
    // enforced at this final mutation boundary, not only in the UI.
    const { user } = await requireReportEditAccess(ctx, report.projectId);
    const revisionNumber = report.revisionNumber ?? 0;
    if (args.expectedRevisionNumber !== revisionNumber) {
      domainError("STALE_REVISION", "The report changed before this save completed");
    }
    if (!args.content.trim() || args.content.length > 1_000_000) {
      domainError("INVALID_INPUT", "Report content is empty or exceeds 1,000,000 characters");
    }
    const now = Date.now();
    const body = await getReportBody(ctx, args.reportId);
    if (body?.postSaveJobId) {
      try { await ctx.scheduler.cancel(body.postSaveJobId); }
      catch { /* A job that already started checks its revision before writing. */ }
    }
    const lastProvenanceId =
      (await getPendingReportProvenance(ctx, args.reportId))?.sourceProvenanceId ?? report.provenanceId;
    const carried = await stageProvenanceForEdit(ctx, report, args.content, {
      actorId: user._id,
      nextRevisionNumber: revisionNumber + 1,
      now,
    });
    const postSaveJobId = await ctx.scheduler.runAfter(3_000, internal.reports.finishReportSave, {
      reportId: args.reportId,
      revisionNumber: revisionNumber + 1,
    });
    await writeReportBody(ctx, report, {
      content: args.content,
      contentHash: await sha256(args.content),
      revisionNumber: revisionNumber + 1,
      // The pending claims carry exact review state until the coalesced job
      // materializes their immutable record.
      provenanceId: undefined,
      updatedAt: now,
      postSaveJobId,
    });
    // Claims could not be carried to this revision, so it has no record; the
    // last one is released unless a snapshot, export or another row holds it.
    if (!carried && lastProvenanceId) await deleteProvenanceIfUnheld(ctx, lastProvenanceId);
    // Phase E (E3): the editing burst's size is read 10 minutes after its
    // first save.
    await noteReportEditForSize(ctx, report, user._id);
    return revisionNumber + 1;
  },
});

export const finishReportSave = internalMutation({
  args: { reportId: v.id("reports"), revisionNumber: v.number() },
  handler: async (ctx, args) => {
    const report = await ctx.db.get(args.reportId);
    if (!report || await isProjectDeleting(ctx, report.projectId)) return;
    const body = await getReportBody(ctx, args.reportId);
    if (!body || body.revisionNumber !== args.revisionNumber) return;
    const provenanceId = await materializePendingReportProvenance(ctx, args.reportId);
    if (!provenanceId && !body.provenanceId && report.provenanceId) {
      await deleteProvenanceIfUnheld(ctx, report.provenanceId);
    }
    await persistDeterministicFindings(ctx, args.reportId);
    const current = await getReportBody(ctx, args.reportId);
    if (current?.revisionNumber === args.revisionNumber && current.postSaveJobId) {
      await ctx.db.patch(current._id, { postSaveJobId: undefined });
    }
  },
});

export const createProvenance = internalMutation({
  args: {
    projectId: v.id("projects"),
    generationId: v.optional(v.id("generations")),
    sourceTranscriptId: v.optional(v.id("transcripts")),
    sourceTranscriptIds: v.optional(v.array(v.id("transcripts"))),
    digestIds: v.optional(v.array(v.id("transcriptDigests"))),
    content: v.string(),
    claims: v.array(claimCitationValidator),
  },
  handler: async (ctx, args) => {
    if (await isProjectDeleting(ctx, args.projectId)) {
      domainError("INVALID_STATE", "Project is being deleted");
    }
    assertBoundedCitations(args.claims);
    const contentHash = await sha256(args.content);
    const reportText = extractPlainText(args.content);
    const checkedSources = new Map<Id<"generationSources">, SourceRowWithText | null>();
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
          // B1, second part: the row's text, wherever it is kept.
          source = await getSourceRowWithText(ctx, citation.generationSourceId);
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
    // Owner decision 25 (2026-09-25): a quote that is only the interviewer's
    // or another speaker's words never backs a claim. It moves to another
    // place of the same words in the same transcript row that is not, or it
    // is dropped, and a claim left with no source is unsupported. Rows
    // without stored speaker turns, and digests, keep today's byte check.
    const speakerOf = citationSpeakerReader(ctx);
    const claims: typeof args.claims = [];
    for (const claim of args.claims) {
      const sources: typeof claim.sources = [];
      for (const citation of claim.sources) {
        const source = checkedSources.get(citation.generationSourceId);
        const kept = source ? await evidenceSpan(speakerOf, source, citation) : null;
        if (!kept) continue;
        if (kept.startOffset === citation.startOffset) {
          sources.push(citation);
          continue;
        }
        // Moved: the old place's speaker and time stamps no longer apply.
        const {
          speaker: _speaker,
          timestampStart: _timestampStart,
          timestampEnd: _timestampEnd,
          ...rest
        } = citation;
        sources.push({ ...rest, startOffset: kept.startOffset, endOffset: kept.endOffset });
      }
      claims.push(
        sources.length === claim.sources.length &&
          sources.every((citation, index) => citation === claim.sources[index])
          ? claim
          : {
              ...claim,
              sources,
              ...(sources.length === 0 ? { state: "unsupported" as const } : {}),
            }
      );
    }
    const generation = args.generationId
      ? await ctx.db.get(args.generationId)
      : null;
    return await ctx.db.insert("reportProvenance", {
      projectId: args.projectId,
      generationId: args.generationId,
      sourceTranscriptId: args.sourceTranscriptId,
      sourceTranscriptIds: args.sourceTranscriptIds,
      digestIds: args.digestIds,
      contentHash,
      status: "needs_review",
      claims,
      createdAt: Date.now(),
      createdBy: generation?.requestedBy,
    });
  },
});

export const getProvenance = query({
  args: { reportId: v.id("reports") },
  handler: async (ctx, args) => {
    const stored = await ctx.db.get(args.reportId);
    if (!stored) return null;
    const report = await reportWithBody(ctx, stored);
    if (!(await getInternalProjectAccessOrNull(ctx, report.projectId))) return null;
    const pending = await getPendingReportProvenance(ctx, report._id);
    if (pending?.revisionNumber === (report.revisionNumber ?? 0) && pending.contentHash === report.contentHash) {
      return {
        id: pending.sourceProvenanceId,
        status: pending.status,
        contentHash: pending.contentHash,
        claims: pending.claims,
        reviewedAt: pending.reviewedAt,
        reviewedBy: pending.reviewedBy,
      };
    }
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
    // The claim wording the reviewer saw. Saves keep one pending record id
    // across an editing burst, so the id alone no longer proves the claim
    // is unchanged; a different hash is refused as stale. Required, so a tab
    // still running an older build must reload before it can review.
    claimTextHash: v.string(),
  },
  handler: async (ctx, args) => {
    const reviewer = await requireRole(ctx, ["manager", "admin"]);
    const stored = await ctx.db.get(args.reportId);
    let report = stored ? await reportWithBody(ctx, stored) : null;
    const pending = report ? await getPendingReportProvenance(ctx, report._id) : null;
    const pendingReview = pending?.sourceProvenanceId === args.provenanceId &&
      pending.revisionNumber === (report?.revisionNumber ?? -1);
    const materializedId = pendingReview && report
      ? await materializePendingReportProvenance(ctx, report._id)
      : undefined;
    if (materializedId && stored) report = await reportWithBody(ctx, stored);
    const provenance = await ctx.db.get(materializedId ?? args.provenanceId);
    if (
      !report ||
      !provenance ||
      report.projectId !== provenance.projectId ||
      report.provenanceId !== provenance._id
    ) {
      domainError("STALE_REVISION", "The report provenance changed before review");
    }
    const target = provenance.claims.find((claim) => claim.claimId === args.claimId);
    if (!target) domainError("NOT_FOUND", "Claim not found");
    if (target.claimTextHash !== args.claimTextHash) {
      domainError("STALE_REVISION", "The claim changed before review");
    }
    const claims = provenance.claims.map((claim) =>
      claim.claimId === args.claimId ? { ...claim, state: args.state } : claim
    );
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
      sourceTranscriptIds: provenance.sourceTranscriptIds,
      digestIds: provenance.digestIds,
      contentHash: provenance.contentHash,
      status: hasUnsupported ? "rejected" : allApproved ? "approved" : "needs_review",
      claims,
      createdAt: now,
      createdBy: provenance.createdBy,
      reviewedAt: now,
      reviewedBy: reviewer._id,
    });
    await writeReportBody(ctx, report, {
      content: report.content,
      revisionNumber: report.revisionNumber ?? 0,
      contentHash: report.contentHash,
      provenanceId: nextId,
      updatedAt: now,
    });
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
      reports.map(async (stored) => {
        const report = await reportWithBody(ctx, stored);
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
  report: ReportWithBody,
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
    const stored = await ctx.db.get(args.reportId);
    if (!stored) domainError("NOT_FOUND", "Report not found");
    const report = await reportWithBody(ctx, stored);
    const { project } = await requireInternalProjectAccess(ctx, report.projectId);
    const contentHash = await sha256(report.content);
    if (report.contentHash && report.contentHash !== contentHash) {
      domainError("STALE_REVISION", "The stored report hash does not match its content");
    }
    return await exportSnapshot(ctx, report, project, contentHash);
  },
});

const CRA_LINE_LABELS = { s242: "Line 242", s244: "Line 244", s246: "Line 246" } as const;

/** Each Line over its CRA form limit, in plain words; empty when all fit. */
export function craLimitMessages(content: string): string[] {
  const metrics = reportSectionMetrics(content);
  const messages: string[] = [];
  for (const key of ["s242", "s244", "s246"] as const) {
    const m = metrics[key];
    if (!m.overLimit) continue;
    const parts: string[] = [];
    if (m.lines > m.limit) parts.push(`${m.lines} of ${m.limit} form lines`);
    if (m.words > m.wordCap) parts.push(`${m.words} of ${m.wordCap} words`);
    messages.push(
      `${CRA_LINE_LABELS[key]} is over the CRA limit (${parts.join(", ")}). Shorten it before export, or the CRA form will cut it off.`
    );
  }
  return messages;
}

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
    const stored = await ctx.db.get(args.reportId);
    if (!stored) domainError("NOT_FOUND", "Report not found");
    let report = await reportWithBody(ctx, stored);
    // Producing the filing document is for the people who may edit the
    // report (audit 2026-09-25, a2 P2-3).
    const { project, user } = await requireReportEditAccess(ctx, report.projectId);
    await materializePendingReportProvenance(ctx, report._id);
    report = await reportWithBody(ctx, stored);
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
    // 2026-11-02 (owner): a manager may apply an Assistant change that runs a
    // Line past its CRA limit (report.overrideRules), but the filing form
    // cannot hold it: the export dialog already refuses, and the server
    // refuses too, so no download ever loses lines or words.
    const overLimit = craLimitMessages(report.content);
    if (overLimit.length > 0) domainError("INVALID_INPUT", overLimit.join("\n"));
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
    const stored = await ctx.db.get(args.reportId);
    if (!stored) return null;
    const report = await reportWithBody(ctx, stored);
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

    const result = computeEditDistance(
      extractPlainText(baseline.content),
      extractPlainText(report.content)
    );

    return {
      ...result,
      draftLabel: baseline.label,
      baselineAt: baseline.createdAt,
    };
  },
});
