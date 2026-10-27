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
import { domainError, sha256 } from "./contracts";
import {
  FROZEN_TRANSCRIPT_CHARS,
  MAX_TRANSCRIPTS_PER_PROJECT,
  TRANSCRIPT_BUDGET_CHARS,
  listActiveTranscriptRows,
  projectTranscriptsFrom,
  transcriptLabel,
} from "./transcripts";
import { transcriptPlaceholdersEnabled } from "../appSettings";
import { projectPlaceholderMap } from "./transcriptPlaceholders";
import type { PlaceholderEntry } from "./deidentify";
import { dashboardFiscalYear } from "../../shared/dashboardProjection";
import { documentHasText, documentTextLength, readDocumentText } from "./documentText";
import { readCompanyFileTextOrNull } from "./companyFileText";
import { companyIdentityNames } from "./clients";
import { quotableFileText } from "../../shared/wordMarkdown";
import { countedRows, type ReadCounter } from "./readMeter";

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
 * FROZEN_TOTAL_BYTES (UTF-8), so a project's own evidence never loses room
 * and the Seed reads stay within their budget.
 */
export const FROZEN_COMPANY_FILES = 12;
export const FROZEN_COMPANY_CHARS = 600_000;
/**
 * Below the Seed read budget (8 MiB with 1 MiB of headroom), which also
 * holds the Brief, its entries, digests and fact packs (review, 2026-10-26).
 */
export const FROZEN_TOTAL_BYTES = 5 * 1024 * 1024;
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
  /**
   * The names tied to the company (its other names, its projects' people),
   * hidden when its files are sent, as company file labels hide them.
   */
  companyNames: { organizations: string[]; people: string[] };
};

/**
 * The evidence a run reads (decision 56 leave-out lists applied): every
 * current transcript cut to FROZEN_TRANSCRIPT_CHARS, then the first
 * FROZEN_DOCUMENT_ROWS document rows that are not archived, not empty and
 * not left out, each cut to FROZEN_DOCUMENT_CHARS. `meter` counts every
 * row and text piece it reads (a draft's reservation, B1 review 2026-10-27).
 */
export async function selectFrozenEvidence(
  ctx: Ctx,
  projectId: Id<"projects">,
  excluded?: ExcludedSourceIds,
  meter?: ReadCounter
): Promise<FrozenEvidence> {
  const excludedTranscripts = new Set<Id<"transcripts">>(excluded?.transcriptIds ?? []);
  const excludedDocuments = new Set<Id<"projectDocuments">>(excluded?.documentIds ?? []);
  const transcriptRows = await listActiveTranscriptRows(ctx, projectId, meter);
  const projectTranscripts = projectTranscriptsFrom(transcriptRows);
  const transcripts = projectTranscripts.filter((row) => !excludedTranscripts.has(row._id));
  const frozenTranscripts = transcripts.map((row) => ({
    row,
    content: row.content.slice(0, FROZEN_TRANSCRIPT_CHARS),
  }));
  // Row by row, so a meter stops before a transaction's reads: an older
  // file row holds its whole text (B1 review, 2026-10-27).
  const documents: Doc<"projectDocuments">[] = [];
  for await (const document of countedRows(
    ctx.db.query("projectDocuments").withIndex("by_projectId", (q) => q.eq("projectId", projectId)),
    meter
  )) {
    documents.push(document);
    if (documents.length >= FROZEN_DOCUMENT_ROWS) break;
  }
  // 2026-10-22 (fourth): the same slices, read through the text helper,
  // which returns exactly `content.slice(0, FROZEN_DOCUMENT_CHARS)` (rule 2).
  // 2026-10-26: Word Markdown is frozen without its bold and italic marks.
  const frozenDocuments: FrozenEvidence["frozenDocuments"] = [];
  for (const document of documents) {
    if (document.archived || !documentHasText(document) || excludedDocuments.has(document._id)) continue;
    const text = await readDocumentText(ctx, document, 0, FROZEN_DOCUMENT_CHARS, meter);
    frozenDocuments.push({
      document,
      content: frozenFileText(text, document.textFormat),
      truncated: text.length !== documentTextLength(document),
    });
  }
  const company = await selectCompanyFiles(
    ctx,
    projectId,
    excluded,
    [...frozenTranscripts.map((item) => item.content), ...frozenDocuments.map((item) => item.content)],
    meter
  );
  return { projectTranscripts, transcripts, frozenTranscripts, frozenDocuments, ...company };
}

/**
 * The company files a draft can read, from its company's files newest first
 * (Phase C): those with text, at most FROZEN_COMPANY_FILES, each read up to
 * FROZEN_DOCUMENT_CHARS and the last cut so all together stay within
 * FROZEN_COMPANY_CHARS. Decided before any is left out, so the start dialog
 * lists exactly these, and leaving one out never brings in another.
 */
export function eligibleCompanyFiles<T extends Pick<Doc<"companyFiles">, "hasText" | "textLength">>(
  newestFirst: readonly T[]
): Array<{ file: T; limit: number }> {
  const eligible: Array<{ file: T; limit: number }> = [];
  let chars = 0;
  for (const file of newestFirst) {
    if (eligible.length >= FROZEN_COMPANY_FILES || chars >= FROZEN_COMPANY_CHARS) break;
    if (!file.hasText) continue;
    const limit = Math.min(FROZEN_DOCUMENT_CHARS, FROZEN_COMPANY_CHARS - chars, file.textLength);
    eligible.push({ file, limit });
    chars += limit;
  }
  return eligible;
}

/** A company's files that are not archived, newest first, as many as a draft looks at. */
export async function companyFilesNewestFirst(ctx: Ctx, clientId: Id<"clients">): Promise<Doc<"companyFiles">[]> {
  return await ctx.db
    .query("companyFiles")
    .withIndex("by_clientId_and_archived", (q) => q.eq("clientId", clientId).eq("archived", undefined))
    .order("desc")
    .take(COMPANY_FILE_ROWS);
}

/**
 * The project's company's files a run reads (Phase C, decision "2026-10-26",
 * part 1): of the company the project is linked to now, if it is active,
 * the eligible files (`eligibleCompanyFiles`) not left out, none once every
 * frozen row together would pass FROZEN_TOTAL_BYTES. A file whose stored
 * text is damaged is left out. Nothing at all for a project with no
 * company, or when the company's names cannot all be read (nothing goes out
 * with a name it could not hide).
 */
async function selectCompanyFiles(
  ctx: Ctx,
  projectId: Id<"projects">,
  excluded: ExcludedSourceIds | undefined,
  frozenSoFar: readonly string[],
  meter?: ReadCounter
): Promise<Pick<FrozenEvidence, "frozenCompanyFiles" | "companyNames">> {
  const project = await ctx.db.get(projectId);
  const client = project?.clientId ? await ctx.db.get(project.clientId) : null;
  return await selectCompanyFilesOf(ctx, client, excluded, frozenSoFar, projectId, meter);
}

/**
 * The company files a draft reads from `client` (a project's company, or the
 * company a New project draft names): see `selectCompanyFiles`. Shared, so a
 * New project's head start freezes what its first run will (Phase C review).
 */
export async function selectCompanyFilesOf(
  ctx: Ctx,
  client: Doc<"clients"> | null,
  excluded: ExcludedSourceIds | undefined,
  frozenSoFar: readonly string[],
  /** The draft's own project, left out of the company's names (`companyIdentityNames`). */
  ownProjectId?: Id<"projects">,
  meter?: ReadCounter
): Promise<Pick<FrozenEvidence, "frozenCompanyFiles" | "companyNames">> {
  const none = { frozenCompanyFiles: [], companyNames: { organizations: [], people: [] } };
  if (!client || client.status !== "active") return none;
  const leftOut = new Set<Id<"companyFiles">>(excluded?.companyFileIds ?? []);
  const encoder = new TextEncoder();
  let bytes = frozenSoFar.reduce((total, text) => total + encoder.encode(text).length, 0);
  const frozenCompanyFiles: FrozenEvidence["frozenCompanyFiles"] = [];
  const newestFirst = await companyFilesNewestFirst(ctx, client._id);
  for (const file of newestFirst) meter?.read(file);
  for (const { file, limit } of eligibleCompanyFiles(newestFirst)) {
    if (leftOut.has(file._id)) continue;
    const text = await readCompanyFileTextOrNull(ctx, file, 0, limit, meter);
    if (text === null || !text.trim()) continue;
    const content = frozenFileText(text, file.textFormat);
    const size = encoder.encode(content).length;
    if (bytes + size > FROZEN_TOTAL_BYTES) break;
    bytes += size;
    frozenCompanyFiles.push({ file, content, truncated: text.length !== file.textLength });
  }
  if (frozenCompanyFiles.length === 0) return none;
  try {
    return { frozenCompanyFiles, companyNames: await companyIdentityNames(ctx, client, ownProjectId) };
  } catch (error) {
    console.warn(`company files left out of a draft: ${(error as Error).message}`);
    return none;
  }
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
  rows.push(...(await companyFileSourceFields(evidence.frozenCompanyFiles)));
  return rows;
}

/**
 * Frozen company file rows (Phase C), last, with client trust always (no
 * uploader role), and a category that can never pass for this project's own
 * prior work or scoping (`companyFileCategory`).
 */
export async function companyFileSourceFields(
  files: FrozenEvidence["frozenCompanyFiles"]
): Promise<FrozenSourceFields[]> {
  const rows: FrozenSourceFields[] = [];
  for (const { file, content, truncated } of files) {
    rows.push({
      kind: "company_file",
      companyFileId: file._id,
      clientId: file.clientId,
      label: `${companyFileCategory(file.category)}:${file.fileName}`,
      content,
      contentHash: await sha256(content),
      truncated,
      originalLength: file.textLength,
    });
  }
  return rows;
}

/**
 * A company file's category in a draft: background, or other. A company
 * file filed as a previous-year report, scoping notes or writer's notes is
 * not this project's (the analyzer weighs those as the project's own), so
 * it reads as background (Phase C review, 2026-10-26).
 */
export function companyFileCategory(category: Doc<"companyFiles">["category"]): "background" | "other" {
  return category === "other" || category === undefined ? "other" : "background";
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

/** Merges followed from a frozen company to the project's company now. */
const LINEAGE_HOPS = 10;

/** Why a draft that read the files of a company the project has left goes no further. */
export const COMPANY_CHANGED_MESSAGE =
  "This draft used files of a company the project no longer belongs to. Start a new draft.";

/**
 * Refuses (`COMPANY_CHANGED`) when `rows` hold a company file of a company
 * the project no longer belongs to (Phase C review 2, 2026-10-26). For a
 * step that reads what earlier steps made from those rows, such as the
 * Brief's storyline and entries, which no filter can take the files out of.
 */
export async function refuseWhenCompanyLeft(
  ctx: { db: QueryCtx["db"] },
  projectId: Id<"projects">,
  rows: readonly { kind: string; clientId?: Id<"clients"> }[]
): Promise<void> {
  if ((await withCurrentCompanyFiles(ctx, projectId, rows)).length !== rows.length) {
    domainError("INVALID_STATE", COMPANY_CHANGED_MESSAGE, { reason: "COMPANY_CHANGED" });
  }
}

/**
 * A draft's frozen rows without company files of a company the project no
 * longer belongs to (Phase C review, 2026-10-26): a company file row stays
 * only while its company is the project's company now, or was merged into
 * it. Every reader that sends frozen rows to the AI goes through this, so a
 * project relinked to another company mid-draft never sends the earlier
 * company's files. Other rows pass unchanged.
 */
export async function withCurrentCompanyFiles<T extends { kind: string; clientId?: Id<"clients"> }>(
  ctx: { db: QueryCtx["db"] },
  projectId: Id<"projects">,
  rows: readonly T[]
): Promise<T[]> {
  if (!rows.some((row) => row.kind === "company_file")) return [...rows];
  const project = await ctx.db.get(projectId);
  const current = project?.clientId ?? null;
  const verdicts = new Map<string, boolean>();
  const belongs = async (clientId: Id<"clients"> | undefined): Promise<boolean> => {
    if (!clientId || !current) return false;
    const known = verdicts.get(clientId);
    if (known !== undefined) return known;
    let at: Id<"clients"> | undefined = clientId;
    let verdict = false;
    for (let hop = 0; at && hop <= LINEAGE_HOPS; hop++) {
      if (at === current) {
        verdict = true;
        break;
      }
      at = (await ctx.db.get(at))?.mergedIntoClientId;
    }
    verdicts.set(clientId, verdict);
    return verdict;
  };
  const kept: T[] = [];
  for (const row of rows) {
    if (row.kind !== "company_file" || (await belongs(row.clientId))) kept.push(row);
  }
  return kept;
}
