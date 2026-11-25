// Pure classification helpers for OneDrive corpus ingestion (BNH-17).
// Shared by the Graph delta sync (convex/ingestionSync.ts, node) and the
// crawler upload endpoint (convex/http.ts, default runtime) — keep this file
// framework-free and Node-free.

import { dashboardCompanyKey } from "../../shared/dashboardProjection";
import {
  parsePdFilename,
  splitCamelCase,
  type ParsedPdFilename,
  type PdVersionCode,
} from "../../shared/pdFilename";

// File types worth staging. Everything else (xlsx, images, …) is skipped —
// Michael deprioritized drawings/spreadsheets for the Brain corpus.
export const INGEST_EXTENSIONS = new Set(["docx", "doc", "pdf", "txt", "vtt"]);
export const MAX_FILE_BYTES = 15 * 1024 * 1024;

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

/**
 * What a file is, for the Import sheet (2026-11-11). Finer than `docKind`,
 * which pairing, approval and porting still read and which stays as it was.
 */
export const INGESTION_CATEGORIES = [
  "final_pd", // a Word file in a submission folder, same test as docKind "pd"
  "draft", // under a draft or work-in-progress folder
  "review_copy", // under a folder for documents in review
  "transcript", // under an Audio folder, same test as docKind "transcript"
  "supporting", // anything else inside a fiscal year folder
  "company_file", // at the client level, outside any fiscal year folder
  "unknown", // no client folder at all
] as const;
export type IngestionCategory = (typeof INGESTION_CATEGORIES)[number];

export type Classified = {
  clientName?: string;
  fiscalYearLabel?: string;
  fiscalYear?: number;
  docKind: "pd" | "transcript" | "supporting" | "unknown";
  pairGroupKey: string;
  category: IngestionCategory;
  /** dashboardCompanyKey(clientName), the key projects are grouped by. */
  companyKey?: string;
  /**
   * From readLabelFiscalYearEnd; set whenever the label holds a year. A
   * final PD's own file name date fills in a day the label left out.
   */
  fiscalYearEnd?: number;
  /** True when neither the label nor a final PD's name gave the day. */
  fiscalYearEndAssumed?: boolean;
  // From the file name (shared/pdFilename.ts): for a final_pd whose name
  // follows the PD scheme, and for a review_copy or draft whose name follows
  // it and carries a version token. Initials are text only, never linked to
  // a user.
  pdNumber?: string;
  versionCode?: PdVersionCode;
  versionNumber?: number;
  writerInitials?: string;
  reviewerInitials?: string;
  /** True when slot 2 reviewer initials in the filename were all lowercase (e.g. ".mo"). */
  reviewerInProgress?: boolean;
  /** Slot 3 initials from the filename (accepted client edits). */
  clientInitials?: string;
  /** Slot 4 initials from the filename (financial reviewer). */
  financialInitials?: string;
  /**
   * 2026-11-17: every initials group of a version token with three or four
   * ("T0.DW.PN.KT"), kept alongside the unpacked positional slots.
   */
  initialsGroups?: string[];
  pdTitle?: string;
};

/** The stage a folder name marks. */
type FolderStage = "submit" | "review" | "draft";

/** True when `word` starts a word in `name`: at the start or after a non-letter. */
function startsWord(name: string, word: string): boolean {
  return new RegExp(`(?:^|[^a-z])${word}`).test(name);
}

/**
 * Folder names that mark a stage. Each folder name is tried against these in
 * order, so "Submitted for review" is a submit folder. Names are compared
 * after stageFolderName, so case, punctuation, extra spaces, CamelCase and
 * numbering prefixes ("2. In Review", "Work-in-Progress", "InReview") do not
 * matter.
 *
 * "submit", "review" and "draft" must start a word, so "Reviewed",
 * "2. Drafts" and "To be submitted" match but "Preview images", "Overdraft
 * facility" and "Resubmittal" do not; "wip" and "work in progress" must be
 * whole words. The submit rule here only stops the walk up the path: whether
 * a file is a final PD is still docKind's plain "submit" substring test on
 * the file's own folder, unchanged from main.
 */
const STAGE_FOLDER_RULES: ReadonlyArray<{
  stage: FolderStage;
  test: (name: string) => boolean;
}> = [
  { stage: "submit", test: (name) => startsWord(name, "submit") },
  { stage: "review", test: (name) => startsWord(name, "review") },
  {
    stage: "draft",
    test: (name) =>
      startsWord(name, "draft") || /\bwork in progress\b/.test(name) || /\bwip\b/.test(name),
  },
];

/** Facts about a path that the category rules read. */
type PathFacts = {
  clientName?: string;
  fiscalYear?: number;
  docKind: Classified["docKind"];
  /** The stage of the nearest folder below the fiscal year folder that marks one. */
  nearestStage?: FolderStage;
};

/**
 * The category rules. The first rule that matches wins; when none does the
 * file is "supporting".
 *
 * Precedence: an Audio folder anywhere on the path wins, because it says what
 * the file is, not how far along it is. A final PD comes next; its test looks
 * at the file's own folder, the nearest one. Then a path with no client
 * folder is unknown, and a path with no fiscal year folder is a company file.
 * Inside a fiscal year folder, the nearest folder to the file that marks a
 * stage decides: "Drafts/In Review/x.docx" is a review copy and
 * "In Review/Drafts/x.docx" is a draft. A nearest submit folder that does not
 * make a final PD (a PDF, or a subfolder such as "To be submitted/Old")
 * leaves the file as supporting rather than looking further up.
 */
const CATEGORY_RULES: ReadonlyArray<{
  category: IngestionCategory;
  when: (facts: PathFacts) => boolean;
}> = [
  { category: "transcript", when: (f) => f.docKind === "transcript" },
  { category: "final_pd", when: (f) => f.docKind === "pd" },
  { category: "unknown", when: (f) => f.clientName === undefined },
  { category: "company_file", when: (f) => f.fiscalYear === undefined },
  { category: "review_copy", when: (f) => f.nearestStage === "review" },
  { category: "draft", when: (f) => f.nearestStage === "draft" },
];

/**
 * Split CamelCase ("InReview" → "In Review"), lower-case, read punctuation
 * and underscores as spaces, collapse spaces.
 */
function stageFolderName(segment: string): string {
  return splitCamelCase(segment)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Walk the folders below the fiscal year folder, nearest to the file first. */
function nearestStage(segments: string[]): FolderStage | undefined {
  for (let i = segments.length - 1; i >= 2; i--) {
    const name = stageFolderName(segments[i]);
    const rule = STAGE_FOLDER_RULES.find((r) => r.test(name));
    if (rule) return rule.stage;
  }
  return undefined;
}

/** The categories whose file name is read for the PD scheme fields. */
const PD_NAME_CATEGORIES: ReadonlySet<IngestionCategory> = new Set([
  "final_pd",
  "review_copy",
  "draft",
]);

/** A parsed name's fiscal year end (calendar-valid yyyy-mm-dd), as numbers. */
function nameFiscalYearEnd(
  parsed: ParsedPdFilename | null
): { year: number; month: number; day: number } | undefined {
  if (!parsed?.fiscalYearEnd) return undefined;
  const [year, month, day] = parsed.fiscalYearEnd.split("-").map(Number);
  return { year, month: month - 1, day };
}

/**
 * The fiscal year a fiscal year folder's name gives ("2025 - Mar 31" gives
 * 2025): its first 19xx or 20xx, or undefined when it has none. classify
 * reads a path's second folder with it, and the Import page reads a dropped
 * folder's shape with it (src/lib/components/import/importIntake.ts).
 */
export function fiscalYearOfLabel(label: string | undefined): number | undefined {
  const yearMatch = label?.match(/(19|20)\d{2}/);
  return yearMatch ? Number(yearMatch[0]) : undefined;
}

/**
 * `<Client>/<Fiscal year>/…` convention (Jun 19 meeting): PDs are Word docs
 * whose immediate folder is a submission folder ("Submitted",
 * "To be submitted", …); transcripts live under an Audio folder inside
 * WIP/Technical.
 */
export function classify(
  relPath: string,
  fileName: string,
  categoryOverride?: Classified["category"]
): Classified {
  const segments = relPath.split("/").filter(Boolean);
  const clientName = segments[0];
  const fiscalYearLabel = segments[1];
  const fiscalYear = fiscalYearOfLabel(fiscalYearLabel);
  const lower = segments.map((s) => s.toLowerCase());
  const parent = lower[lower.length - 1] ?? "";
  const ext = extensionOf(fileName);

  const parsedForSubmitPdf =
    parent.includes("submit") && ext === "pdf" ? parsePdFilename(fileName) : null;
  let docKind: Classified["docKind"] = "supporting";
  if (lower.includes("audio")) {
    docKind = "transcript";
  } else if (
    parent.includes("submit") &&
    (ext === "docx" || ext === "doc" || parsedForSubmitPdf?.versionCode === "S")
  ) {
    docKind = "pd";
  } else if (!clientName || !fiscalYearLabel) {
    docKind = "unknown";
  }

  const facts: PathFacts = {
    clientName,
    fiscalYear,
    docKind,
    nearestStage: nearestStage(segments),
  };
  // A category a person set wins, and the file name is read for it: a PD
  // named by the scheme but kept in a supporting folder still gives its
  // number, version and initials once a person makes it a final PD.
  const category =
    categoryOverride ?? CATEGORY_RULES.find((rule) => rule.when(facts))?.category ?? "supporting";

  const companyKey = clientName === undefined ? undefined : dashboardCompanyKey(clientName);
  const classified: Classified = {
    clientName,
    fiscalYearLabel,
    fiscalYear,
    docKind,
    pairGroupKey: pairGroupKeyFor(companyKey, fiscalYear),
    category,
  };
  if (companyKey !== undefined) classified.companyKey = companyKey;

  const parsed = PD_NAME_CATEGORIES.has(category) ? (parsedForSubmitPdf ?? parsePdFilename(fileName)) : null;

  if (fiscalYear !== undefined) {
    const end = readLabelFiscalYearEnd(fiscalYearLabel, fiscalYear);
    classified.fiscalYearEnd = end.fiscalYearEnd;
    classified.fiscalYearEndAssumed = end.assumed;
    // A final PD's name carries the fiscal year end ("… 2025-03-31 …"). Use
    // it when the label left the day out, if it is in the label's year (and
    // in the label's month, when the label names one).
    const fromName = category === "final_pd" ? nameFiscalYearEnd(parsed) : undefined;
    if (
      end.assumed &&
      fromName &&
      fromName.year === fiscalYear &&
      (end.month === undefined || end.month === fromName.month)
    ) {
      classified.fiscalYearEnd = Date.UTC(fromName.year, fromName.month, fromName.day);
      classified.fiscalYearEndAssumed = false;
    }
  }

  // A final PD's name is read whenever it parses. A review copy's or draft's
  // only when it also carries a version token ("R2.DW"), which marks a PD.
  if (parsed && (category === "final_pd" || parsed.versionCode !== undefined)) {
    if (parsed.projectNumber !== undefined) classified.pdNumber = parsed.projectNumber;
    if (parsed.versionCode !== undefined) classified.versionCode = parsed.versionCode;
    if (parsed.revision !== undefined) classified.versionNumber = Number(parsed.revision);
    if (parsed.writerInitials !== undefined) classified.writerInitials = parsed.writerInitials;
    if (parsed.reviewerInitials !== undefined) classified.reviewerInitials = parsed.reviewerInitials;
    if (parsed.reviewerInProgress !== undefined) classified.reviewerInProgress = parsed.reviewerInProgress;
    if (parsed.clientInitials !== undefined) classified.clientInitials = parsed.clientInitials;
    if (parsed.financialInitials !== undefined) classified.financialInitials = parsed.financialInitials;
    if (parsed.initialsGroups !== undefined) classified.initialsGroups = parsed.initialsGroups;
    if (parsed.title !== undefined) classified.pdTitle = parsed.title;
  }
  return classified;
}

/** The labels stored on an ingestionItems row, worked out from its path. */
export type IngestionLabels = Pick<
  Classified,
  | "category"
  | "companyKey"
  | "fiscalYearEnd"
  | "fiscalYearEndAssumed"
  | "pdNumber"
  | "versionCode"
  | "versionNumber"
  | "writerInitials"
  | "reviewerInitials"
  | "reviewerInProgress"
  | "clientInitials"
  | "financialInitials"
  | "initialsGroups"
  | "pdTitle"
>;

/**
 * The pairing group of a company and fiscal year (2026-11-11): the company key
 * (dashboardCompanyKey of the client name) and the fiscal year number, "?" for
 * either one missing. Main built it from the raw client folder name and the
 * raw fiscal year folder label, so a person's fix to a year end, or a company
 * name typed with other capitals or spacing, moved a file out of its pair.
 * Two rows of one company and one fiscal year now always share a group,
 * whatever their folders are called.
 *
 * Known and accepted: two fiscal year ends in one calendar year (a company
 * that changed its year end, say Mar 31 and Dec 31 2025) share one group.
 */
export function pairGroupKeyFor(companyKey?: string, fiscalYear?: number): string {
  return `${companyKey ?? "?"}::${fiscalYear ?? "?"}`;
}

/** classify for a stored item: its `path` holds the folders and the file. */
export function classifyItemPath(
  path: string,
  name: string,
  categoryOverride?: Classified["category"]
): Classified {
  const folders = path.split("/").filter(Boolean).slice(0, -1).join("/");
  return classify(folders, name, categoryOverride);
}

/**
 * The stored labels for an item, from its stored `path` (folders and file)
 * and `name`. Every key is present, undefined when it does not apply, so a
 * patch after a move also clears a label the old path had.
 */
export function labelsForItemPath(path: string, name: string): IngestionLabels {
  return labelsOf(classifyItemPath(path, name));
}

/** The label fields of a classify result, every key present. */
export function labelsOf(c: Classified): IngestionLabels {
  return {
    category: c.category,
    companyKey: c.companyKey,
    fiscalYearEnd: c.fiscalYearEnd,
    fiscalYearEndAssumed: c.fiscalYearEndAssumed,
    pdNumber: c.pdNumber,
    versionCode: c.versionCode,
    versionNumber: c.versionNumber,
    writerInitials: c.writerInitials,
    reviewerInitials: c.reviewerInitials,
    reviewerInProgress: c.reviewerInProgress,
    clientInitials: c.clientInitials,
    financialInitials: c.financialInitials,
    initialsGroups: c.initialsGroups,
    pdTitle: c.pdTitle,
  };
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * Fiscal-year folder label ("2025 - Dec 31") → a projects.fiscalYearEnd
 * timestamp. Grouping only depends on the UTC year (dashboardFiscalYear), so
 * when no month/day suffix parses the Dec 31 fallback is safe.
 *
 * Known gap, kept on purpose: it can take the day out of the year ("FYE June
 * 2025" gives June 20, "31 December 2025" gives Dec 20) and does not check
 * the day fits the month. Porting depends on these exact results, so it is
 * left as it is; the Import labels use the stricter readLabelFiscalYearEnd.
 */
export function fiscalYearEndFromLabel(
  label: string | undefined,
  fiscalYear: number
): number {
  const match = label?.match(
    /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*(\d{1,2})/i
  );
  if (match) {
    const monthIdx = MONTHS.indexOf(match[1].toLowerCase());
    const day = Number(match[2]);
    if (monthIdx >= 0 && day >= 1 && day <= 31) {
      return Date.UTC(fiscalYear, monthIdx, day);
    }
  }
  return Date.UTC(fiscalYear, 11, 31);
}

/** A whole month name or its short form ("Mar", "March", "Sept."), lower case. */
const MONTH_WORD =
  /(?:^|[^a-z])(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?![a-z])\.?/;
/** A day right after the month: "Mar 31", "March 31,", "Mar-31", "Mar 31st". */
const DAY_AFTER_MONTH = /^[\s,_-]*(\d{1,2})(?:st|nd|rd|th)?(?![0-9a-z])/;
/** A day right before the month, not part of a longer number: "31 March", "31-Mar". */
const DAY_BEFORE_MONTH = /(?:^|[^0-9a-z._-])(\d{1,2})(?:st|nd|rd|th)?[\s._-]*$/;
/** A numeric date, year first, one separator throughout: 2025-03-31, 2025.03.31, 2025_03_31. */
const NUMERIC_DATE = /(?:^|[^0-9])(\d{4})([-._])(\d{1,2})\2(\d{1,2})(?![0-9])/g;

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** The day when `digits` is one that `month` of `year` has. */
function validDay(digits: string | undefined, year: number, month: number): number | undefined {
  if (digits === undefined) return undefined;
  const day = Number(digits);
  return day >= 1 && day <= daysInMonth(year, month) ? day : undefined;
}

/**
 * The fiscal year end a fiscal year folder label states, for the Import
 * labels. Stricter than fiscalYearEndFromLabel, which porting still uses.
 * The year is always `fiscalYear`, the one classify read from the label.
 *
 * - A numeric date in that year ("2025-03-31", "2025.03.31", "2025_03_31"),
 *   or a month name with a day next to it ("2025 - Mar 31", "March 31,
 *   2025", "31 Mar 2025"), gives that day: assumed false.
 * - A month name with no day ("FYE June 2025") gives the last day of that
 *   month: assumed true, and `month` says which month the label named.
 * - Anything else ("2025", "FY 2025") gives Dec 31: assumed true.
 *
 * A day is a one or two digit number that is not part of a longer number,
 * so it is never taken out of the year, and it must exist in that month.
 */
export function readLabelFiscalYearEnd(
  label: string | undefined,
  fiscalYear: number
): { fiscalYearEnd: number; assumed: boolean; month?: number } {
  const text = label?.toLowerCase() ?? "";

  for (const match of text.matchAll(NUMERIC_DATE)) {
    if (Number(match[1]) !== fiscalYear) continue;
    const month = Number(match[3]) - 1;
    if (month < 0 || month > 11) continue;
    const day = validDay(match[4], fiscalYear, month);
    if (day !== undefined) {
      return { fiscalYearEnd: Date.UTC(fiscalYear, month, day), assumed: false };
    }
  }

  // A label written as a range ("Apr 1 - Mar 31") names two months: the
  // year end is the last one.
  const monthMatches = [...text.matchAll(new RegExp(MONTH_WORD.source, "g"))];
  const monthMatch = monthMatches[monthMatches.length - 1];
  if (monthMatch) {
    const month = MONTHS.indexOf(monthMatch[1].slice(0, 3));
    // The match may begin with the non-letter before the month name.
    const monthStart = monthMatch.index + monthMatch[0].indexOf(monthMatch[1]);
    const monthEnd = monthMatch.index + monthMatch[0].length;
    const day =
      validDay(DAY_AFTER_MONTH.exec(text.slice(monthEnd))?.[1], fiscalYear, month) ??
      validDay(DAY_BEFORE_MONTH.exec(text.slice(0, monthStart))?.[1], fiscalYear, month);
    if (day !== undefined) {
      return { fiscalYearEnd: Date.UTC(fiscalYear, month, day), assumed: false };
    }
    return {
      fiscalYearEnd: Date.UTC(fiscalYear, month, daysInMonth(fiscalYear, month)),
      assumed: true,
      month,
    };
  }

  return { fiscalYearEnd: Date.UTC(fiscalYear, 11, 31), assumed: true };
}

/** File names a person never means to add (2026-11-12, the Import page's drop). */
const JUNK_FILE_NAMES = new Set([".ds_store", "thumbs.db", "desktop.ini"]);

/**
 * A file the Import page leaves out of a drop or a picked folder: a hidden
 * file or one inside a hidden folder (a name starting with "."), the
 * system's own files (.DS_Store, Thumbs.db, desktop.ini) and an Office lock
 * file ("~$Report.docx"). The client uploader skips the same (its README).
 */
export function isJunkPath(path: string): boolean {
  const segments = path.split("/").filter(Boolean);
  const name = segments[segments.length - 1] ?? "";
  if (JUNK_FILE_NAMES.has(name.toLowerCase())) return true;
  if (name.startsWith("~$")) return true;
  return segments.some((segment) => segment.startsWith("."));
}

/** The fields an uploaded file is staged with (upsertDiscoveredItem's arguments). */
export type UploadUpsertFields = {
  driveItemId: string;
  path: string;
  name: string;
  clientName?: string;
  fiscalYearLabel?: string;
  fiscalYear?: number;
  docKind: Classified["docKind"];
  size: number;
  lastModifiedAt: number;
  contentHash: string;
  pairGroupKey: string;
};

/**
 * What a file sent with its path relative to the folders it came from is
 * staged as. The upload route (convex/http.ts, the uploader) and the Import
 * page's drop and Add files (ingestion.stageImportFiles) both build their
 * rows here, so a file is classified the same whichever way it arrives. The
 * row's key is "local:<path>": for the uploader the same path is the same
 * synced file. The page keeps that key only for the first file with a path;
 * a different file with the same path gets a key of its own there
 * (ingestion.ts pageItemKey).
 */
export function uploadUpsertFields(
  relPath: string,
  size: number,
  lastModifiedAt: number,
  contentHash: string
): UploadUpsertFields {
  const segments = relPath.split("/");
  const name = segments[segments.length - 1]!;
  const meta = classify(segments.slice(0, -1).join("/"), name);
  return {
    driveItemId: `local:${relPath}`,
    path: relPath,
    name,
    clientName: meta.clientName,
    fiscalYearLabel: meta.fiscalYearLabel,
    fiscalYear: meta.fiscalYear,
    docKind: meta.docKind,
    size,
    lastModifiedAt: Number.isFinite(lastModifiedAt) && lastModifiedAt > 0 ? lastModifiedAt : Date.now(),
    contentHash,
    pairGroupKey: meta.pairGroupKey,
  };
}

/**
 * Normalize a client-supplied relative path: forward slashes, no leading
 * separators, no traversal segments, bounded length. Returns null when
 * nothing safe remains.
 */
export function sanitizeRelPath(raw: string): string | null {
  const cleaned = raw
    .replace(/\\/g, "/")
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== "." && s !== "..")
    .join("/");
  if (!cleaned || cleaned.length > 1024) return null;
  return cleaned;
}
