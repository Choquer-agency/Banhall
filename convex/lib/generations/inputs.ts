/**
 * The frozen generation inputs the pipeline reads, the context-budget record
 * and the Brief inputs band (context inclusion).
 *
 * Split out of convex/generations.ts (2026-09-25, phase 4). The Convex
 * functions stay registered in convex/generations.ts under their old names;
 * this module holds their handlers and helpers.
 */
import { v, type ObjectType } from "convex/values";
import type { QueryCtx, MutationCtx } from "../../_generated/server";
import { resolveGatedWorkflow } from "../gatedWorkflow";
import {
  MAX_TRANSCRIPTS_PER_PROJECT,
  generationTranscriptIds,
  buildTranscriptPromptText,
} from "../transcripts";
import type { Doc } from "../../_generated/dataModel";
import { factQuotePool } from "../seedFacts";
import { analyzerContextBudget } from "../../appSettings";
import { sourceInclusion } from "../../ai/trustedContext";
import { getInternalProjectAccessOrNull } from "../auth";
import { createReadBudget } from "../readBudget";
import { type UnfrozenDocument, assembleContextInclusion } from "../contextInclusion";

/** Argument validators of generations.getGenerationPlaceholders. */
export const getGenerationPlaceholdersArgs = { generationId: v.id("generations") };

/** Handler of generations.getGenerationPlaceholders. */
export async function getGenerationPlaceholdersHandler(
  ctx: QueryCtx,
  args: ObjectType<typeof getGenerationPlaceholdersArgs>
) {
  const generation = await ctx.db.get(args.generationId);
  return generation?.placeholders ?? [];
}

/** Argument validators of generations.getGenerationInput. */
export const getGenerationInputArgs = { generationId: v.id("generations") };

/** Handler of generations.getGenerationInput. */
export async function getGenerationInputHandler(
  ctx: QueryCtx,
  args: ObjectType<typeof getGenerationInputArgs>
) {
  const generation = await ctx.db.get(args.generationId);
  if (!generation) return null;
  const project = await ctx.db.get(generation.projectId);
  if (!project || project.deletionStartedAt !== undefined || project.activeGenerationId !== generation._id) return null;
  let reportTitle = project.title;
  if (
    resolveGatedWorkflow(generation) === "seeds" &&
    generation.summaryVersionId !== undefined
  ) {
    const summary = await ctx.db.get(generation.summaryVersionId);
    if (
      !summary ||
      summary.projectId !== generation.projectId ||
      summary.originGenerationId !== (generation.originGenerationId ?? generation._id) ||
      summary.reportTitle === undefined
    ) {
      return null;
    }
    reportTitle = summary.reportTitle;
  }
  const sources = await ctx.db
    .query("generationSources")
    .withIndex("by_generationId", (q) => q.eq("generationId", generation._id))
    // One transcript row and one digest row per transcript, plus the 50
    // context documents. A tighter bound would drop the digest rows of a
    // many-transcript project — the case digest mode exists for — and hand
    // the model the over-budget full text instead.
    .take(3 * MAX_TRANSCRIPTS_PER_PROJECT + 51);
  const transcriptIds = generationTranscriptIds(generation);
  const inputMode = generation.inputMode ?? "full";
  const toPart = (source: Doc<"generationSources">) => ({
    sourceId: source._id,
    contentHash: source.contentHash,
    content: source.content,
    label: source.label,
  });
  // Digest rows are written concurrently, so the frozen transcript set — not
  // insertion order — decides which digest is part 1. A generation in digest
  // mode that has not been condensed yet reads its transcript rows; the
  // pipeline condenses and reads again.
  const digestRows = sources.filter(
    (source) => source.kind === "transcript_digest"
  );
  const orderedDigests = (transcriptIds ?? []).flatMap((id) => {
    const row = digestRows.find((source) => source.transcriptId === id);
    return row ? [row] : [];
  });
  const digestParts =
    inputMode === "digest" &&
    transcriptIds !== undefined &&
    orderedDigests.length === transcriptIds.length
      ? orderedDigests
      : undefined;
  // 2026-09-24 (transcript method): a generation that froze a fact pack for
  // every transcript reads the packs; with any pack missing it reads what
  // it read before (digests over the budget, full text under it).
  const factRows = sources.filter((source) => source.kind === "transcript_facts");
  const orderedFacts = (transcriptIds ?? []).flatMap((id) => {
    const row = factRows.find((source) => source.transcriptId === id);
    return row ? [row] : [];
  });
  const factParts =
    generation.transcriptFacts === true &&
    transcriptIds !== undefined &&
    transcriptIds.length > 0 &&
    orderedFacts.length === transcriptIds.length
      ? orderedFacts
      : undefined;
  const fullTranscriptRows = sources.filter((source) => source.kind === "transcript");
  // Insertion order is reservation order, which is the project's transcript
  // order; every offset the pipeline cites is relative to one of these rows.
  const transcriptParts = (factParts ?? digestParts ?? fullTranscriptRows).map(toPart);
  // Plan step 8: reading facts, report claims cite the packs' verified
  // client quotes on the frozen transcript rows, never the packs.
  const factQuotes = factParts
    ? factQuotePool(
        sources.map((source) => ({
          sourceId: source._id,
          kind: source.kind,
          content: source.content,
          contentHash: source.contentHash,
          transcriptId: source.transcriptId,
          factSpans: source.factSpans,
        }))
      )
    : undefined;
  return {
    inputMode,
    transcriptFacts: generation.transcriptFacts === true,
    // What `transcriptParts` holds: fact packs, digests or full text.
    transcriptReading: factParts ? ("facts" as const) : digestParts ? ("digest" as const) : ("full" as const),
    // Reading fact packs only: the frozen full-text transcript rows, which
    // claims read from a pack cite (decision 25 and the provenance
    // contract). Left out otherwise, so no other generation carries the
    // full text twice (review 2026-09-25, P3-3).
    ...(factParts ? { transcriptRows: fullTranscriptRows.map(toPart) } : {}),
    ...(factQuotes ? { factQuotes } : {}),
    // Owner decision 26: the frozen name map, for work that leaves the
    // app without a model call (the Brain query built from facts).
    placeholders: generation.placeholders ?? [],
    digestIds: generation.digestIds,
    generationId: generation._id,
    projectId: project._id,
    // Usage attribution: the user who requested this generation (may differ
    // from the project creator, e.g. an admin retry).
    requestedBy: generation.requestedBy,
    transcriptId: generation.transcriptId,
    transcriptIds,
    transcript: buildTranscriptPromptText(transcriptParts),
    transcriptParts,
    title: reportTitle,
    lengthTarget: generation.lengthTarget ?? "standard",
    candidateMode: generation.candidateMode ?? "compare",
    singleModelId: generation.singleModelId,
    gatedWorkflow: resolveGatedWorkflow(generation),
    compareModelIds: generation.compareModelIds,
    retryModelIds: generation.retryModelIds,
    seededCandidates: generation.seededCandidates ?? 0,
    industry: project.industry,
    scienceCode: project.scienceCode,
    contextDocs: sources
      .filter((source) => source.kind === "project_document")
      .map((source) => {
        const separator = source.label.indexOf(":");
        const category = separator >= 0 ? source.label.slice(0, separator) : "other";
        return {
          sourceId: source._id,
          category,
          fileName: separator >= 0 ? source.label.slice(separator + 1) : source.label,
          content: source.content,
          // CAP-3: frozen at reservation. Absent = client trust.
          ...(source.uploaderRole ? { uploaderRole: source.uploaderRole } : {}),
        };
      }),
    // Analyzer context budget as configured right now. Each candidate
    // re-reads this query, so an admin retune mid-generation does reach
    // later candidates and can disagree with the budget already recorded on
    // the source rows — the recorded report describes the run that wrote it.
    contextBudget: await analyzerContextBudget(ctx),
  };
}

/** Argument validators of generations.recordContextBudget. */
export const recordContextBudgetArgs = {
  generationId: v.id("generations"),
  budgetTokens: v.number(),
  // Story 4: the document cap the report ran under ("cap N" in the Brief).
  maxDocuments: v.optional(v.number()),
  applied: v.array(
    v.object({
      sourceId: v.id("generationSources"),
      included: v.boolean(),
      includedLength: v.number(),
      truncated: v.boolean(),
    })
  ),
};

/** Handler of generations.recordContextBudget. */
export async function recordContextBudgetHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof recordContextBudgetArgs>
) {
  for (const entry of args.applied) {
    const row = await ctx.db.get(entry.sourceId);
    // A row deleted mid-generation, or an id from another generation, is
    // skipped rather than thrown: the budget report is telemetry, and
    // failing here would kill an otherwise-good generation.
    if (!row || row.generationId !== args.generationId) continue;
    await ctx.db.patch(entry.sourceId, {
      contextBudget: {
        budgetTokens: args.budgetTokens,
        included: entry.included,
        includedLength: entry.includedLength,
        truncated: entry.truncated,
        ...(args.maxDocuments !== undefined
          ? { maxDocuments: args.maxDocuments }
          : {}),
      },
      // Story 4 (AD-30): the only writer of `inclusion`.
      inclusion: sourceInclusion(entry),
    });
  }
  return null;
}

// DW-133: getContextInclusion runs every read under ONE budget, because no
// single population is small enough to ignore. Frozen generationSources hold
// transcripts of up to FROZEN_TRANSCRIPT_CHARS (500k) and documents of up to
// 200k characters — up to 20 transcripts and 50 documents can exceed Convex's
// 16 MiB transaction read limit on their own — and each projectDocuments row
// carries its full extracted text (≤ 1 MiB). Every row read outside a list
// walk — the generation, the authorization rows and the four analyzer
// settings (whose `value` is an unrestricted string) — is read FIRST and
// charged at its actual size; each list then reserves a maximum-size
// document before every read. Whatever the budget could not read is reported
// as truncated, never thrown. Worst case actually read: the seven up-front
// rows (≤ 7 MiB, charged) plus list reads up to the 14 MiB total, 2 MiB
// under the limit.
export const INCLUSION_READ_BYTES = 14 * (1 << 20);

// The reservation freezes at most 2×20 transcript rows + 51 documents; 200
// keeps a wide margin, so bytes are the real bound.
export const INCLUSION_SOURCE_ROWS = 200;

export const INCLUSION_DOCUMENT_ROWS = 1000;

/** Argument validators of generations.getContextInclusion. */
export const getContextInclusionArgs = { generationId: v.id("generations") };

/** Handler of generations.getContextInclusion. */
export async function getContextInclusionHandler(
  ctx: QueryCtx,
  args: ObjectType<typeof getContextInclusionArgs>
) {
  const generation = await ctx.db.get(args.generationId);
  if (!generation) return null;
  const access = await getInternalProjectAccessOrNull(ctx, generation.projectId);
  if (!access) return null;
  const reads = createReadBudget({ maxBytes: INCLUSION_READ_BYTES });
  reads.account(generation);
  reads.account(access.user);
  reads.account(access.project);
  // The four settings rows are read before any walk and charged as read,
  // so a large (still parseable) setting shrinks what the walks may read
  // instead of landing on top of them after the budget was spent.
  const budget = await analyzerContextBudget(ctx, (row) => reads.account(row));

  const sourceRead = await reads.list(
    ctx.db
      .query("generationSources")
      .withIndex("by_generationId", (q) => q.eq("generationId", generation._id)),
    INCLUSION_SOURCE_ROWS
  );
  const sources = sourceRead.rows;
  const sourcesTruncated = !sourceRead.complete;
  const frozenDocumentIds = new Set(
    sources.flatMap((row) => (row.projectDocumentId ? [row.projectDocumentId] : []))
  );
  // DW-133: a project's lifetime document count is unbounded (uploadDocument
  // has no cap), so the listing walks the whole index range under the
  // shared budget instead of a flat take(100), and reports when it had to
  // stop rather than letting the totals silently undercount. With a partial
  // source set an unread frozen row is indistinguishable from an unfrozen
  // document, so the walk is skipped and reported as truncated instead of
  // mislabelling frozen documents as never captured.
  let unfrozenDocuments: UnfrozenDocument[] = [];
  let documentsTruncated = true;
  if (!sourcesTruncated) {
    const documentRead = await reads.list(
      ctx.db
        .query("projectDocuments")
        .withIndex("by_projectId", (q) => q.eq("projectId", generation.projectId)),
      INCLUSION_DOCUMENT_ROWS
    );
    documentsTruncated = !documentRead.complete;
    // CAP-17: every document attached before the reservation is listed. The
    // reasons mirror reserveGeneration's skip rule (archived, no readable
    // text); a readable one it never captured — the reservation freezes a
    // bounded number of documents — is listed as not captured rather than
    // silently dropped from the band and its counts.
    unfrozenDocuments = documentRead.rows.flatMap((document): UnfrozenDocument[] => {
      if (document.createdAt > generation.startedAt) return [];
      if (frozenDocumentIds.has(document._id)) return [];
      const reason = document.archived
        ? ("archived" as const)
        : !document.content.trim()
          ? ("unreadable" as const)
          : ("not_captured" as const);
      return [{ _id: document._id, fileName: document.fileName, reason }];
    });
  }
  return assembleContextInclusion({
    sources: sources.map((row) => ({
      _id: row._id,
      kind: row.kind,
      label: row.label,
      ...(row.transcriptId ? { transcriptId: row.transcriptId } : {}),
      ...(row.inclusion ? { inclusion: row.inclusion } : {}),
      ...(row.contextBudget ? { contextBudget: row.contextBudget } : {}),
    })),
    unfrozenDocuments,
    fallbackCap: budget.maxDocuments,
    documentsTruncated,
    sourcesTruncated,
  });
}
