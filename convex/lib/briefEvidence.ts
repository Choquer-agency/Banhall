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
import { COMPANY_HISTORY_CATEGORIES, HAND_COMPANY_FILE_CATEGORIES, isCompanyHistoryCategory, pdNumberKey } from "./companyEvidence";
import { evidenceWords, foldForSearch } from "../../shared/evidenceChoice";
import { DOCUMENT_HEADROOM } from "./readBudget";
import { SEED_DECISION_READ_BYTES, SEED_DECISION_RESERVED_BYTES } from "./seedDecisionState";

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
 * Company files (2026-10-26, Phase C): at most this many, after the
 * project's own files; their text together at most FROZEN_COMPANY_CHARS;
 * and none once every frozen row together would pass FROZEN_TOTAL_BYTES
 * (UTF-8), so a project's own evidence never loses room and the Seed reads
 * stay within their budget. Since the F5 stress run (2026-10-27) a
 * project's own files stop at that total too (`frozenTotal`).
 *
 * 2026-11-17 (company history): which ones is `draftCompanyFiles`. These
 * two caps hold the files added by hand, exactly as before; imported
 * history comes on top, in its own places and within its own cap.
 */
export const FROZEN_COMPANY_FILES = 12;
export const FROZEN_COMPANY_CHARS = 600_000;
/**
 * 2026-11-17: imported history (the pinned final PDs now, relevance
 * excerpts with evidence layer step 2) is at most 60,000 characters of a
 * draft, the research's ceiling, on top of the hand-added files and within
 * what they leave of FROZEN_COMPANY_CHARS.
 */
export const COMPANY_HISTORY_CHARS = 60_000;
/**
 * 2026-11-17: the pinned final PDs, of the two fiscal years before the
 * project's (newest first), at most two a year and four in all, in places
 * of their own, sharing at most 32,000 characters of the history cap (a
 * shorter one leaves its share to the others).
 */
export const PINNED_FINAL_PD_YEARS = 2;
export const PINNED_FINAL_PDS_PER_YEAR = 2;
export const PINNED_FINAL_PDS = PINNED_FINAL_PD_YEARS * PINNED_FINAL_PDS_PER_YEAR;
export const PINNED_FINAL_PD_CHARS = 32_000;
/** Final PD rows of one fiscal year a draft looks at, newest first, before choosing two. */
const FINAL_PD_ROWS_PER_YEAR = 20;
/**
 * What a Seed attempt reads besides the frozen text, within the same budget:
 * the draft's decisions, its Brief and entries, digests and fact packs.
 */
export const SEED_DECISION_STATE_ALLOWANCE_BYTES = 1024 * 1024;
/**
 * Every frozen row's text together, in UTF-8 bytes. A Seed attempt reads it
 * all within the Seed read budget (SEED_DECISION_READ_BYTES), which counts
 * SEED_DECISION_RESERVED_BYTES as read from the start and wants one
 * document's headroom (DOCUMENT_HEADROOM) free before each read; the total
 * is what is left after SEED_DECISION_STATE_ALLOWANCE_BYTES, about 3 MiB.
 * F5 stress run, 2026-10-27: it was 5 MiB, "below the Seed read budget (8
 * MiB with 1 MiB of headroom)", which left out the reservation; a draft
 * frozen at 5.16 MB could not start its first Batch.
 */
export const FROZEN_TOTAL_BYTES =
  SEED_DECISION_READ_BYTES - SEED_DECISION_RESERVED_BYTES - DOCUMENT_HEADROOM - SEED_DECISION_STATE_ALLOWANCE_BYTES;
/** Company file rows a run looks at, newest first, before filtering (per hand-added category since 2026-11-17). */
const COMPANY_FILE_ROWS = 50;

/**
 * The frozen text so far against FROZEN_TOTAL_BYTES (UTF-8). `fits` adds a
 * file's text when every frozen row together stays within the total, and
 * otherwise adds nothing; the caller stops at the first file that does not
 * fit, so a later file never comes in ahead of an earlier one.
 *
 * F5 stress run, 2026-10-27: only company files were held to the total, so
 * a project's own 50 files of 200,000 characters froze about 10 MB, past
 * the Seed read budget, and no step's first Batch could start. A project's
 * own files now stop at the total as well; the transcripts count first and
 * are never left out by it.
 */
export function frozenTotal(frozenSoFar: readonly string[]): { fits(content: string): boolean } {
  const encoder = new TextEncoder();
  let bytes = frozenSoFar.reduce((sum, text) => sum + encoder.encode(text).length, 0);
  return {
    fits(content: string) {
      const size = encoder.encode(content).length;
      if (bytes + size > FROZEN_TOTAL_BYTES) return false;
      bytes += size;
      return true;
    },
  };
}
/**
 * The most rows one generation freezes: a transcript, its digest and its
 * fact pack each, the files, the Storyline, the company files added by
 * hand, and (2026-11-17) the pinned final PDs.
 */
export const MAX_FROZEN_SOURCE_ROWS =
  3 * MAX_TRANSCRIPTS_PER_PROJECT + FROZEN_DOCUMENT_ROWS + 1 + FROZEN_COMPANY_FILES + PINNED_FINAL_PDS;

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
   * 2026-10-28 (third): the company files the run could read and the writer
   * left in, but that did not fit in the frozen total, newest first.
   */
  companyFilesLeftOut?: Id<"companyFiles">[];
  /**
   * The names tied to the company (its other names, its projects' people),
   * hidden when its files are sent, as company file labels hide them.
   */
  companyNames: { organizations: string[]; people: string[] };
  /**
   * Every file and transcript row read, left-out ones included, so a draft's
   * leave-out list is checked without reading them again (B1 review, round 2).
   */
  documentIdsRead?: Id<"projectDocuments">[];
  transcriptIdsRead?: Id<"transcripts">[];
};

/**
 * The evidence a run reads (decision 56 leave-out lists applied): every
 * current transcript cut to FROZEN_TRANSCRIPT_CHARS, then the first
 * FROZEN_DOCUMENT_ROWS document rows that are not archived, not empty and
 * not left out, each cut to FROZEN_DOCUMENT_CHARS, up to the first that
 * would take every frozen row together past FROZEN_TOTAL_BYTES
 * (`frozenTotal`). `meter` counts every row and text piece it reads (a
 * draft's reservation, B1 review 2026-10-27).
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
  const total = frozenTotal(frozenTranscripts.map((item) => item.content));
  for (const document of documents) {
    if (document.archived || !documentHasText(document) || excludedDocuments.has(document._id)) continue;
    const text = await readDocumentText(ctx, document, 0, FROZEN_DOCUMENT_CHARS, meter);
    const content = frozenFileText(text, document.textFormat);
    if (!total.fits(content)) break;
    frozenDocuments.push({
      document,
      content,
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
  return {
    projectTranscripts,
    transcripts,
    frozenTranscripts,
    frozenDocuments,
    ...company,
    documentIdsRead: documents.map((document) => document._id),
    transcriptIdsRead: transcriptRows.map((row) => row._id),
  };
}

/**
 * The hand-added company files a draft can read, from those newest first
 * (Phase C): those with text, at most `places`, each read up to
 * FROZEN_DOCUMENT_CHARS and the last cut so all together stay within
 * `room`, as before. Imported history
 * (`isCompanyHistoryCategory`) never comes in this way. Decided before any
 * is left out, so the start dialog lists exactly these, and leaving one
 * out never brings in another.
 */
export function eligibleCompanyFiles<T extends Pick<Doc<"companyFiles">, "hasText" | "textLength" | "category">>(
  newestFirst: readonly T[],
  room: number = FROZEN_COMPANY_CHARS,
  places: number = FROZEN_COMPANY_FILES
): Array<{ file: T; limit: number }> {
  const eligible: Array<{ file: T; limit: number }> = [];
  let chars = 0;
  for (const file of newestFirst) {
    if (eligible.length >= places || chars >= room) break;
    if (!file.hasText || isCompanyHistoryCategory(file.category)) continue;
    const limit = Math.min(FROZEN_DOCUMENT_CHARS, room - chars, file.textLength);
    eligible.push({ file, limit });
    chars += limit;
  }
  return eligible;
}

/**
 * What a draft's company files are chosen for (2026-11-17): its project's
 * fiscal year, PD number and titles. A draft with no fiscal year pins no
 * final PD.
 */
export type CompanyDraftSubject = {
  fiscalYear: number | null;
  projectNumber?: string;
  titles: readonly string[];
};

export const NO_COMPANY_DRAFT_SUBJECT: CompanyDraftSubject = { fiscalYear: null, titles: [] };

export function companyDraftSubject(
  project: Pick<Doc<"projects">, "fiscalYearEnd" | "projectNumber" | "title" | "sredTitle"> | null
): CompanyDraftSubject {
  if (!project) return NO_COMPANY_DRAFT_SUBJECT;
  return {
    fiscalYear: dashboardFiscalYear(project.fiscalYearEnd),
    ...(project.projectNumber?.trim() ? { projectNumber: project.projectNumber } : {}),
    titles: [project.title, project.sredTitle ?? ""].filter((title) => title.trim() !== ""),
  };
}

type FinalPdFacts = Pick<
  Doc<"companyFiles">,
  "_id" | "_creationTime" | "archived" | "hasText" | "textLength" | "category" | "fiscalYear" | "pdNumber" | "fileName" | "labels"
>;

/**
 * The final PDs a draft pins from one fiscal year's rows: not archived,
 * with text, filed under that year, at most PINNED_FINAL_PDS_PER_YEAR.
 * When the year has more, those whose PD number matches the project's come
 * first, then those whose name or label title shares more words with the
 * project's titles, then the newest added, then by id, so the same rows
 * always give the same choice.
 */
export function pinnedFinalPdsOfYear<T extends FinalPdFacts>(rows: readonly T[], year: number, subject: CompanyDraftSubject): T[] {
  const wanted = pdNumberKey(subject.projectNumber);
  const titleWords = new Set(subject.titles.flatMap((title) => evidenceWords(foldForSearch(title))));
  const overlap = (file: T) => {
    const words = new Set(evidenceWords(foldForSearch(`${file.fileName} ${file.labels?.title ?? ""}`)));
    let shared = 0;
    for (const word of words) if (titleWords.has(word)) shared += 1;
    return shared;
  };
  return rows
    .filter((file) => !file.archived && file.hasText && file.category === "final_pd" && file.fiscalYear === year)
    .map((file) => ({ file, matches: wanted !== null && pdNumberKey(file.pdNumber) === wanted ? 1 : 0, shared: overlap(file) }))
    .sort(
      (a, b) =>
        b.matches - a.matches ||
        b.shared - a.shared ||
        b.file._creationTime - a.file._creationTime ||
        (a.file._id < b.file._id ? -1 : a.file._id > b.file._id ? 1 : 0)
    )
    .slice(0, PINNED_FINAL_PDS_PER_YEAR)
    .map(({ file }) => file);
}

/**
 * Each length's share of `total`, fairly (max-min): every file gets the
 * same share, and one shorter than its share leaves the rest to the
 * others. In the order given; whole characters.
 */
export function fairShares(lengths: readonly number[], total: number): number[] {
  const shares = lengths.map(() => 0);
  let left = Math.max(0, total);
  const order = lengths.map((length, index) => ({ length, index })).sort((a, b) => a.length - b.length || a.index - b.index);
  for (let position = 0; position < order.length; position += 1) {
    const { length, index } = order[position]!;
    const share = Math.min(length, Math.floor(left / (order.length - position)));
    shares[index] = share;
    left -= share;
  }
  return shares;
}

/** One company file a draft reads: how many characters, and whether it is a pinned final PD. */
export type DraftCompanyFile<T> = { file: T; limit: number; pinned: boolean };

/**
 * The company files a draft reads, in order (2026-11-17, company history;
 * pure, so the start dialog and every freeze decide alike):
 *
 * 1. The company files added by hand (every category but Import's), newest
 *    first, exactly as before (`eligibleCompanyFiles`): FROZEN_COMPANY_FILES
 *    places and FROZEN_COMPANY_CHARS. A company with no Import files reads
 *    exactly what it read before.
 * 2. Then, on top, pinned: the final PDs of the two fiscal years before the
 *    project's, newest year first, at most two a year
 *    (`pinnedFinalPdsOfYear`), in PINNED_FINAL_PDS places of their own,
 *    sharing fairly (`fairShares`) the least of PINNED_FINAL_PD_CHARS,
 *    COMPANY_HISTORY_CHARS and what the hand-added files left of
 *    FROZEN_COMPANY_CHARS.
 *
 * Imported drafts, review copies, transcripts, supporting files and final
 * PDs of other years are never read by a draft; the chat finds them by
 * search. Relevance filling from every file is evidence layer step 2.
 */
export function planDraftCompanyFiles<T extends FinalPdFacts>(input: {
  /** Final PD rows of each pinned year, newest year first. */
  finalPdsByYear: ReadonlyArray<{ year: number; rows: readonly T[] }>;
  /** Files added by hand, not archived, newest first. */
  handNewestFirst: readonly T[];
  subject: CompanyDraftSubject;
}): Array<DraftCompanyFile<T>> {
  const hand = eligibleCompanyFiles(input.handNewestFirst);
  const handChars = hand.reduce((sum, item) => sum + item.limit, 0);
  const pinnedFiles = input.finalPdsByYear
    .flatMap(({ year, rows }) => pinnedFinalPdsOfYear(rows, year, input.subject))
    .slice(0, PINNED_FINAL_PDS);
  const shares = fairShares(
    pinnedFiles.map((file) => file.textLength),
    Math.min(PINNED_FINAL_PD_CHARS, COMPANY_HISTORY_CHARS, FROZEN_COMPANY_CHARS - handChars)
  );
  const pinned = pinnedFiles
    .map((file, index) => ({ file, limit: shares[index]!, pinned: true }))
    .filter((item) => item.limit > 0);
  return [...hand.map((item) => ({ ...item, pinned: false })), ...pinned];
}

/**
 * Rows of several index ranges, each newest first, merged newest first, at
 * most `limit` in all: each range is read only as far as the merge needs
 * it, so reading N rows reads at most N plus one per range. `meter` is told
 * before and after every row read.
 */
async function newestFirstMerged(
  ranges: ReadonlyArray<AsyncIterable<Doc<"companyFiles">>>,
  limit: number,
  meter?: ReadCounter
): Promise<Doc<"companyFiles">[]> {
  const iterators = ranges.map((range) => range[Symbol.asyncIterator]());
  const pull = async (iterator: AsyncIterator<Doc<"companyFiles">>) => {
    if (meter?.mayRead && !meter.mayRead()) return null;
    await meter?.beforeRead?.();
    const next = await iterator.next();
    if (next.done) return null;
    meter?.read(next.value);
    return next.value;
  };
  const merged: Doc<"companyFiles">[] = [];
  try {
    const heads: Array<Doc<"companyFiles"> | null> = [];
    for (const iterator of iterators) heads.push(limit > 0 ? await pull(iterator) : null);
    while (merged.length < limit) {
      let best = -1;
      for (let index = 0; index < heads.length; index += 1) {
        const head = heads[index];
        if (!head) continue;
        const current = best >= 0 ? heads[best]! : null;
        if (!current || head._creationTime > current._creationTime || (head._creationTime === current._creationTime && head._id > current._id)) {
          best = index;
        }
      }
      if (best < 0) break;
      merged.push(heads[best]!);
      heads[best] = merged.length < limit ? await pull(iterators[best]!) : null;
    }
  } finally {
    for (const iterator of iterators) await iterator.return?.();
  }
  return merged;
}

/** A company's files of these categories, not archived, as index ranges newest first. */
function categoryRanges(ctx: Ctx, clientId: Id<"clients">, categories: ReadonlyArray<Doc<"companyFiles">["category"]>) {
  return categories.map((category) =>
    ctx.db
      .query("companyFiles")
      .withIndex("by_clientId_and_archived_and_category", (q) =>
        q.eq("clientId", clientId).eq("archived", undefined).eq("category", category)
      )
      .order("desc")
  );
}

/**
 * A company's files added by hand (every category but Import's, and none),
 * not archived, newest first, at most `limit`: one index range per
 * category, merged, so no number of imported files hides them, and the
 * rows read stay about what one newest-first read of `limit` rows took.
 */
export async function handCompanyFilesNewestFirst(
  ctx: Ctx,
  clientId: Id<"clients">,
  limit: number = COMPANY_FILE_ROWS,
  meter?: ReadCounter
): Promise<Doc<"companyFiles">[]> {
  return await newestFirstMerged(categoryRanges(ctx, clientId, HAND_COMPANY_FILE_CATEGORIES), limit, meter);
}

/**
 * A company's Import files (`COMPANY_HISTORY_CATEGORIES`), not archived,
 * newest added first, at most `limit`. Reads nothing for a company with no
 * Import files.
 */
export async function historyCompanyFilesNewestFirst(
  ctx: Ctx,
  clientId: Id<"clients">,
  limit: number,
  meter?: ReadCounter
): Promise<Doc<"companyFiles">[]> {
  return await newestFirstMerged(categoryRanges(ctx, clientId, COMPANY_HISTORY_CATEGORIES), limit, meter);
}

/**
 * historyCompanyFilesNewestFirst without final PDs: the Import drafts,
 * review copies, transcripts and supporting files (2026-11-19, from code
 * review), for the chat list's last pass, which lists final PDs only up to
 * CHAT_LISTED_FINAL_PDS in its own pass before it.
 */
export async function nonFinalHistoryCompanyFilesNewestFirst(
  ctx: Ctx,
  clientId: Id<"clients">,
  limit: number,
  meter?: ReadCounter
): Promise<Doc<"companyFiles">[]> {
  const categories = COMPANY_HISTORY_CATEGORIES.filter((category) => category !== "final_pd");
  return await newestFirstMerged(categoryRanges(ctx, clientId, categories), limit, meter);
}

/**
 * A company's final PDs of `year`, not archived, newest first, at most
 * `limit` (FINAL_PD_ROWS_PER_YEAR: a year with more chooses among its
 * newest 20).
 */
export async function companyFinalPdsOfYear(
  ctx: Ctx,
  clientId: Id<"clients">,
  year: number,
  limit: number = FINAL_PD_ROWS_PER_YEAR,
  meter?: ReadCounter
): Promise<Doc<"companyFiles">[]> {
  const rows: Doc<"companyFiles">[] = [];
  for await (const row of countedRows(
    ctx.db
      .query("companyFiles")
      .withIndex("by_clientId_and_category_and_archived_and_fiscalYear", (q) =>
        q.eq("clientId", clientId).eq("category", "final_pd").eq("archived", undefined).eq("fiscalYear", year)
      )
      .order("desc"),
    meter
  )) {
    rows.push(row);
    if (rows.length >= limit) break;
  }
  return rows;
}

/** The fiscal years a draft pins final PDs from, newest first: the two before the project's. */
export function pinnedYears(subject: CompanyDraftSubject): number[] {
  if (subject.fiscalYear === null) return [];
  return Array.from({ length: PINNED_FINAL_PD_YEARS }, (_, index) => subject.fiscalYear! - 1 - index);
}

/**
 * The company files a draft of `subject` reads from `clientId`
 * (`planDraftCompanyFiles`), with bounded, indexed reads: at most 20 final
 * PD rows for each pinned year, and the newest 50 hand-added rows (plus one
 * per category for the merge). `meter` is told before and after every row
 * read (a draft's reservation).
 */
export async function draftCompanyFiles(
  ctx: Ctx,
  clientId: Id<"clients">,
  subject: CompanyDraftSubject,
  meter?: ReadCounter
): Promise<Array<DraftCompanyFile<Doc<"companyFiles">>>> {
  const finalPdsByYear: Array<{ year: number; rows: Doc<"companyFiles">[] }> = [];
  for (const year of pinnedYears(subject)) {
    finalPdsByYear.push({ year, rows: await companyFinalPdsOfYear(ctx, clientId, year, FINAL_PD_ROWS_PER_YEAR, meter) });
  }
  const handNewestFirst = await handCompanyFilesNewestFirst(ctx, clientId, COMPANY_FILE_ROWS, meter);
  return planDraftCompanyFiles({ finalPdsByYear, handNewestFirst, subject });
}

/**
 * The project's company's files a run reads (Phase C, decision "2026-10-26",
 * part 1): of the company the project is linked to now, if it is active,
 * the files a draft reads (`draftCompanyFiles`) not left out, none once every
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
): Promise<Pick<FrozenEvidence, "frozenCompanyFiles" | "companyNames" | "companyFilesLeftOut">> {
  const project = await ctx.db.get(projectId);
  const client = project?.clientId ? await ctx.db.get(project.clientId) : null;
  return await selectCompanyFilesOf(ctx, client, excluded, frozenSoFar, projectId, meter, companyDraftSubject(project));
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
  meter?: ReadCounter,
  /** 2026-11-17: what the files are chosen for; none pins no final PD (a New project draft has no fiscal year). */
  subject: CompanyDraftSubject = NO_COMPANY_DRAFT_SUBJECT
): Promise<Pick<FrozenEvidence, "frozenCompanyFiles" | "companyNames" | "companyFilesLeftOut">> {
  const none = { frozenCompanyFiles: [], companyNames: { organizations: [], people: [] } };
  if (!client || client.status !== "active") return none;
  const leftOut = new Set<Id<"companyFiles">>(excluded?.companyFileIds ?? []);
  const total = frozenTotal(frozenSoFar);
  const frozenCompanyFiles: FrozenEvidence["frozenCompanyFiles"] = [];
  // 2026-10-28 (third, owner): the first file that does not fit and every
  // eligible one after it, unread, so the Inputs band can list them.
  const companyFilesLeftOut: Id<"companyFiles">[] = [];
  for (const { file, limit } of await draftCompanyFiles(ctx, client._id, subject, meter)) {
    if (leftOut.has(file._id)) continue;
    if (companyFilesLeftOut.length > 0) {
      companyFilesLeftOut.push(file._id);
      continue;
    }
    const text = await readCompanyFileTextOrNull(ctx, file, 0, limit, meter);
    if (text === null || !text.trim()) continue;
    const content = frozenFileText(text, file.textFormat);
    if (!total.fits(content)) {
      companyFilesLeftOut.push(file._id);
      continue;
    }
    frozenCompanyFiles.push({ file, content, truncated: text.length !== file.textLength });
  }
  if (frozenCompanyFiles.length === 0) return { ...none, companyFilesLeftOut };
  try {
    return {
      frozenCompanyFiles,
      companyNames: await companyIdentityNames(ctx, client, ownProjectId),
      companyFilesLeftOut,
    };
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
  /** 2026-11-17: a company file's fiscal year at the freeze, when it has one. */
  fiscalYear?: number;
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
 * prior work or scoping (`companyFileCategory`). Since 2026-11-17 each keeps
 * the file's fiscal year, when it has one, beside its file and text version.
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
      ...(typeof file.fiscalYear === "number" ? { fiscalYear: file.fiscalYear } : {}),
      label: companyFileLabel(file),
      content,
      contentHash: await sha256(content),
      truncated,
      originalLength: file.textLength,
    });
  }
  return rows;
}

/**
 * A frozen company file row's label, `<category>:<name>`. Since 2026-11-17
 * an Import file with a fiscal year adds it ("background:Pump PD.docx (FY
 * 2024)"), so two same-name final PDs of different years read apart; a
 * file added by hand keeps its label exactly, so its Brief reuse holds.
 */
export function companyFileLabel(file: Pick<Doc<"companyFiles">, "category" | "fileName" | "fiscalYear">): string {
  const year = isCompanyHistoryCategory(file.category) && typeof file.fiscalYear === "number" ? ` (FY ${file.fiscalYear})` : "";
  return `${companyFileCategory(file.category)}:${file.fileName}${year}`;
}

/**
 * A company file's category in a draft, chat and their trust labels:
 * background, or other. A company file filed as a previous-year report,
 * scoping notes or writer's notes is not this project's (the analyzer
 * weighs those as the project's own), so it reads as background (Phase C
 * review, 2026-10-26).
 *
 * 2026-11-17 (company history, decision 42): an imported final PD reads as
 * background, never as `previous_pd`, so it never passes for this project's
 * previous-year report; imported drafts, review copies, transcripts and
 * supporting files read as other.
 */
export function companyFileCategory(category: Doc<"companyFiles">["category"]): "background" | "other" {
  switch (category) {
    case "previous_pd":
    case "scoping_notes":
    case "writer_notes":
    case "background":
    case "final_pd":
      return "background";
    case "draft":
    case "review_copy":
    case "transcript":
    case "supporting":
    case "other":
    case undefined:
      return "other";
  }
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
  transcripts: Doc<"transcripts">[],
  /** A draft's reservation counts the originals it reads (B1 review, round 2). */
  meter?: ReadCounter
): Promise<Doc<"transcripts">[]> {
  const year = dashboardFiscalYear(project.fiscalYearEnd);
  if (year === null) return transcripts;
  const sourceYears = new Map<Id<"projects">, number | null>();
  const current: Doc<"transcripts">[] = [];
  for (const transcript of transcripts) {
    let original: Doc<"transcripts"> | null = null;
    if (transcript.copiedFromTranscriptId) {
      await meter?.beforeRead?.();
      original = await ctx.db.get(transcript.copiedFromTranscriptId);
      meter?.read(original);
    }
    if (!original) {
      current.push(transcript);
      continue;
    }
    if (!sourceYears.has(original.projectId)) {
      const source = await ctx.db.get(original.projectId);
      meter?.read(source);
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
