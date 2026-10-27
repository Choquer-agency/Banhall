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
  MAX_TRANSCRIPTS_PER_PROJECT,
  TRANSCRIPT_BUDGET_CHARS,
  listProjectTranscripts,
  transcriptLabel,
} from "./transcripts";
import { transcriptPlaceholdersEnabled } from "../appSettings";
import { projectPlaceholderMap } from "./transcriptPlaceholders";
import type { PlaceholderEntry } from "./deidentify";
import { dashboardFiscalYear } from "../../shared/dashboardProjection";
import { documentHasText, documentTextLength, readDocumentText } from "./documentText";
import { readCompanyFileTextOrNull } from "./companyFileText";
import { companyOtherNames } from "./clients";
import { quotableFileText } from "../../shared/wordMarkdown";

/**
 * The text a draft freezes from a file's text: Word Markdown without its
 * bold and italic marks (owner, 2026-10-26), so quotes the AI gives without
 * them are checked exactly as before; any other text as it is.
 */
export const frozenFileText = quotableFileText;

type Ctx = QueryCtx | MutationCtx;

/** Characters of one document a run freezes. */
export const FROZEN_DOCUMENT_CHARS = 200_000;
/** Document rows a run looks at, in index order, before filtering. */
export const FROZEN_DOCUMENT_ROWS = 50;
/**
 * Company files (2026-10-26, Phase C): at most this many, newest first,
 * after the project's own files; their text together at most
 * FROZEN_COMPANY_CHARS; and none once every frozen row together would pass
 * FROZEN_TOTAL_BYTES (UTF-8), so a project's own evidence never loses room.
 */
export const FROZEN_COMPANY_FILES = 12;
export const FROZEN_COMPANY_CHARS = 600_000;
export const FROZEN_TOTAL_BYTES = 8 * 1024 * 1024;
/** Company file rows a run looks at, newest first, before filtering. */
const COMPANY_FILE_ROWS = 50;
/**
 * The most rows one generation freezes: a transcript, its digest and its
 * fact pack each, the files, the Storyline, and the company files.
 */
export const MAX_FROZEN_SOURCE_ROWS = 3 * MAX_TRANSCRIPTS_PER_PROJECT + FROZEN_DOCUMENT_ROWS + 1 + FROZEN_COMPANY_FILES;

export type ExcludedSourceIds = {
  documentIds: Id<"projectDocuments">[];
  transcriptIds: Id<"transcripts">[];
  companyFileIds?: Id<"companyFiles">[];
};

export type FrozenEvidence = {
  /** Every current transcript, left-out ones included (they feed the placeholder map). */
  projectTranscripts: Doc<"transcripts">[];
  /** The transcripts the run reads, after the leave-out list. */
  transcripts: Doc<"transcripts">[];
  frozenTranscripts: Array<{ row: Doc<"transcripts">; content: string }>;
  /** `truncated`: the file's text is longer than the part frozen. */
  frozenDocuments: Array<{ document: Doc<"projectDocuments">; content: string; truncated: boolean }>;
  /** The project's company's files (Phase C), after the project's own; empty without a company. */
  frozenCompanyFiles: Array<{ file: Doc<"companyFiles">; content: string; truncated: boolean }>;
  /** The company's other names (earlier names, merged companies), hidden when its files are sent. */
  companyNames: string[];
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
  // 2026-10-22 (fourth): the same slices, read through the text helper,
  // which returns exactly `content.slice(0, FROZEN_DOCUMENT_CHARS)` (rule 2).
  // 2026-10-26: Word Markdown is frozen without its bold and italic marks.
  const frozenDocuments: FrozenEvidence["frozenDocuments"] = [];
  for (const document of documents) {
    if (document.archived || !documentHasText(document) || excludedDocuments.has(document._id)) continue;
    const text = await readDocumentText(ctx, document, 0, FROZEN_DOCUMENT_CHARS);
    frozenDocuments.push({
      document,
      content: frozenFileText(text, document.textFormat),
      truncated: text.length !== documentTextLength(document),
    });
  }
  const company = await selectCompanyFiles(ctx, projectId, excluded, [
    ...frozenTranscripts.map((item) => item.content),
    ...frozenDocuments.map((item) => item.content),
  ]);
  return { projectTranscripts, transcripts, frozenTranscripts, frozenDocuments, ...company };
}

/**
 * The project's company's files a run reads (Phase C, decision "2026-10-26",
 * part 1): the company the project is linked to now, if it is active; its
 * files that are not archived, have text and are not left out, newest
 * first, within the caps above. A file whose stored text is damaged is left
 * out. Nothing at all for a project with no company.
 */
async function selectCompanyFiles(
  ctx: Ctx,
  projectId: Id<"projects">,
  excluded: ExcludedSourceIds | undefined,
  frozenSoFar: readonly string[]
): Promise<Pick<FrozenEvidence, "frozenCompanyFiles" | "companyNames">> {
  const none = { frozenCompanyFiles: [], companyNames: [] };
  const project = await ctx.db.get(projectId);
  const client = project?.clientId ? await ctx.db.get(project.clientId) : null;
  if (!client || client.status !== "active") return none;
  const leftOut = new Set<Id<"companyFiles">>(excluded?.companyFileIds ?? []);
  const encoder = new TextEncoder();
  let bytes = frozenSoFar.reduce((total, text) => total + encoder.encode(text).length, 0);
  let chars = 0;
  const rows = await ctx.db
    .query("companyFiles")
    .withIndex("by_clientId_and_archived", (q) => q.eq("clientId", client._id).eq("archived", undefined))
    .order("desc")
    .take(COMPANY_FILE_ROWS);
  const frozenCompanyFiles: FrozenEvidence["frozenCompanyFiles"] = [];
  for (const file of rows) {
    if (frozenCompanyFiles.length >= FROZEN_COMPANY_FILES || chars >= FROZEN_COMPANY_CHARS) break;
    if (!file.hasText || leftOut.has(file._id)) continue;
    const limit = Math.min(FROZEN_DOCUMENT_CHARS, FROZEN_COMPANY_CHARS - chars);
    const text = await readCompanyFileTextOrNull(ctx, file, 0, limit);
    if (text === null || !text.trim()) continue;
    const content = frozenFileText(text, file.textFormat);
    const size = encoder.encode(content).length;
    if (bytes + size > FROZEN_TOTAL_BYTES) break;
    bytes += size;
    chars += text.length;
    frozenCompanyFiles.push({ file, content, truncated: text.length !== file.textLength });
  }
  if (frozenCompanyFiles.length === 0) return none;
  return { frozenCompanyFiles, companyNames: await companyOtherNames(ctx, client) };
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
    ...(await projectPlaceholderMap(
      ctx,
      project,
      evidence.projectTranscripts,
      [
        ...evidence.frozenTranscripts.map((item) => item.content),
        ...evidence.frozenDocuments.map((item) => item.content),
        ...evidence.frozenCompanyFiles.map((item) => item.content),
        ...extraTexts,
      ],
      evidence.companyNames
    )),
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
  kind: "transcript" | "project_document" | "company_file";
  transcriptId?: Id<"transcripts">;
  projectDocumentId?: Id<"projectDocuments">;
  companyFileId?: Id<"companyFiles">;
  clientId?: Id<"clients">;
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

/** Transcripts first, then documents, then company files: the order the Brief spends its budget in. */
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
  for (const { document, content, truncated } of evidence.frozenDocuments) {
    rows.push({
      kind: "project_document",
      projectDocumentId: document._id,
      label: `${document.category ?? "other"}:${document.fileName}`,
      content,
      contentHash: await sha256(content),
      truncated,
      originalLength: documentTextLength(document),
      // CAP-3: trust is pinned to the freeze, never re-read live. Absent
      // (legacy document rows) means client trust downstream.
      ...(document.uploaderRole ? { uploaderRole: document.uploaderRole } : {}),
    });
  }
  // Phase C: company files last, with client trust always (no uploader role).
  for (const { file, content, truncated } of evidence.frozenCompanyFiles) {
    rows.push({
      kind: "company_file",
      companyFileId: file._id,
      clientId: file.clientId,
      label: `${file.category ?? "other"}:${file.fileName}`,
      content,
      contentHash: await sha256(content),
      truncated,
      originalLength: file.textLength,
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
