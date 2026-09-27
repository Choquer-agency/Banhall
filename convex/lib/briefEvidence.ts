/**
 * Shared operation "freeze evidence" (2026-09-26, decision 65): which of a
 * project's transcripts and files a run reads, cut to the frozen sizes, in
 * the order the Brief request spends its budget, and the placeholder map
 * that hides names from every call. `reserveGeneration` freezes a
 * generation's `generationSources` with it and a Brief preparation freezes
 * its `briefPreparationSources` with it, so both read the same bytes in the
 * same order and the preparation key can compare them.
 */
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { sha256 } from "./contracts";
import {
  FROZEN_TRANSCRIPT_CHARS,
  TRANSCRIPT_BUDGET_CHARS,
  listProjectTranscripts,
  transcriptLabel,
} from "./transcripts";
import { transcriptPlaceholdersEnabled } from "../appSettings";
import { projectPlaceholderMap } from "./transcriptPlaceholders";
import type { PlaceholderEntry } from "./deidentify";
import { dashboardFiscalYear } from "../../shared/dashboardProjection";

type Ctx = QueryCtx | MutationCtx;

/** Characters of one document a run freezes. */
export const FROZEN_DOCUMENT_CHARS = 200_000;
/** Document rows a run looks at, in index order, before filtering. */
export const FROZEN_DOCUMENT_ROWS = 50;

export type ExcludedSourceIds = {
  documentIds: Id<"projectDocuments">[];
  transcriptIds: Id<"transcripts">[];
};

export type FrozenEvidence = {
  /** Every current transcript, left-out ones included (they feed the placeholder map). */
  projectTranscripts: Doc<"transcripts">[];
  /** The transcripts the run reads, after the leave-out list. */
  transcripts: Doc<"transcripts">[];
  frozenTranscripts: Array<{ row: Doc<"transcripts">; content: string }>;
  frozenDocuments: Array<{ document: Doc<"projectDocuments">; content: string }>;
};

/**
 * The evidence a run reads (decision 56 leave-out lists applied): every
 * current transcript cut to FROZEN_TRANSCRIPT_CHARS, then the first
 * FROZEN_DOCUMENT_ROWS document rows that are not archived, not empty and
 * not left out, each cut to FROZEN_DOCUMENT_CHARS.
 */
export async function selectFrozenEvidence(
  ctx: Ctx,
  projectId: Id<"projects">,
  excluded?: ExcludedSourceIds
): Promise<FrozenEvidence> {
  const excludedTranscripts = new Set<Id<"transcripts">>(excluded?.transcriptIds ?? []);
  const excludedDocuments = new Set<Id<"projectDocuments">>(excluded?.documentIds ?? []);
  const projectTranscripts = await listProjectTranscripts(ctx, projectId);
  const transcripts = projectTranscripts.filter((row) => !excludedTranscripts.has(row._id));
  const frozenTranscripts = transcripts.map((row) => ({
    row,
    content: row.content.slice(0, FROZEN_TRANSCRIPT_CHARS),
  }));
  const documents = await ctx.db
    .query("projectDocuments")
    .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
    .take(FROZEN_DOCUMENT_ROWS);
  const frozenDocuments = documents.flatMap((document) =>
    document.archived || !document.content.trim() || excludedDocuments.has(document._id)
      ? []
      : [{ document, content: document.content.slice(0, FROZEN_DOCUMENT_CHARS) }]
  );
  return { projectTranscripts, transcripts, frozenTranscripts, frozenDocuments };
}

/**
 * Owner decision 26: the placeholder map for everything the run's calls
 * send, or none when an admin switched placeholders off. Every current
 * transcript's names are hidden, left-out ones included, so a speaker named
 * in a kept document is still hidden.
 */
export async function frozenPlaceholders(
  ctx: Ctx,
  project: Doc<"projects">,
  evidence: FrozenEvidence,
  extraTexts: readonly string[] = []
): Promise<PlaceholderEntry[]> {
  if (!(await transcriptPlaceholdersEnabled(ctx))) return [];
  return [
    ...(await projectPlaceholderMap(ctx, project, evidence.projectTranscripts, [
      ...evidence.frozenTranscripts.map((item) => item.content),
      ...evidence.frozenDocuments.map((item) => item.content),
      ...extraTexts,
    ])),
  ];
}

/** Full text or a digest per transcript, over the combined frozen characters. */
export function decideInputMode(totalChars: number): "full" | "digest" {
  return totalChars > TRANSCRIPT_BUDGET_CHARS ? "digest" : "full";
}

export function frozenTranscriptChars(evidence: FrozenEvidence): number {
  return evidence.frozenTranscripts.reduce((total, item) => total + item.content.length, 0);
}

/** The fields of one frozen source row, whichever table holds it. */
export type FrozenSourceFields = {
  kind: "transcript" | "project_document";
  transcriptId?: Id<"transcripts">;
  projectDocumentId?: Id<"projectDocuments">;
  /** A private intake draft's row (decision 65, stage 2): its source and stable key. */
  intakeSourceId?: Id<"intakeSources">;
  sourceKey?: string;
  label: string;
  content: string;
  contentHash: string;
  truncated: boolean;
  originalLength: number;
  uploaderRole?: "writer" | "manager" | "admin";
};

/** Transcripts first, then documents: the order the Brief spends its budget in. */
export async function frozenSourceFields(evidence: FrozenEvidence): Promise<FrozenSourceFields[]> {
  const rows: FrozenSourceFields[] = [];
  for (const { row, content } of evidence.frozenTranscripts) {
    rows.push({
      kind: "transcript",
      transcriptId: row._id,
      label: transcriptLabel(row),
      content,
      contentHash: await sha256(content),
      truncated: content.length !== row.content.length,
      originalLength: row.content.length,
    });
  }
  for (const { document, content } of evidence.frozenDocuments) {
    rows.push({
      kind: "project_document",
      projectDocumentId: document._id,
      label: `${document.category ?? "other"}:${document.fileName}`,
      content,
      contentHash: await sha256(content),
      truncated: content.length !== document.content.length,
      originalLength: document.content.length,
      // CAP-3: trust is pinned to the freeze, never re-read live. Absent
      // (legacy document rows) means client trust downstream.
      ...(document.uploaderRole ? { uploaderRole: document.uploaderRole } : {}),
    });
  }
  return rows;
}

/**
 * Decision 42, lead note of 2026-09-25: a transcript a duplicate copied from
 * a project with an earlier fiscal year is last year's transcript, not a
 * current-year source. Every other transcript counts, including a copy whose
 * original row is gone or whose fiscal years are not both set.
 */
export async function currentYearTranscripts(
  ctx: Ctx,
  project: Doc<"projects">,
  transcripts: Doc<"transcripts">[]
): Promise<Doc<"transcripts">[]> {
  const year = dashboardFiscalYear(project.fiscalYearEnd);
  if (year === null) return transcripts;
  const sourceYears = new Map<Id<"projects">, number | null>();
  const current: Doc<"transcripts">[] = [];
  for (const transcript of transcripts) {
    const original = transcript.copiedFromTranscriptId
      ? await ctx.db.get(transcript.copiedFromTranscriptId)
      : null;
    if (!original) {
      current.push(transcript);
      continue;
    }
    if (!sourceYears.has(original.projectId)) {
      const source = await ctx.db.get(original.projectId);
      sourceYears.set(original.projectId, dashboardFiscalYear(source?.fiscalYearEnd));
    }
    const sourceYear = sourceYears.get(original.projectId) ?? null;
    if (sourceYear === null || year <= sourceYear) current.push(transcript);
  }
  return current;
}
