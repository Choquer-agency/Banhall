// The import dry run's logic (scripts/import-dry-run.mjs runs it). It walks a
// local copy of the firm's OneDrive folder and counts what the Import page
// would make of each file, with the server's own pure functions, so the
// counts match the app. Read-only: it sends nothing, needs no deployment or
// key, and writes nothing in the folder it reads.
//
// Privacy: the report holds counts, initials and name patterns with every
// word replaced by a placeholder. Never a file's text, a client name, a
// person's name or the folder's own path.

import { createHash } from "node:crypto";
import { promises as fs, type Dirent, type Stats } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  INGEST_EXTENSIONS,
  INGESTION_CATEGORIES,
  MAX_FILE_BYTES,
  extensionOf,
  isJunkPath,
  sanitizeRelPath,
  type IngestionCategory,
} from "../../convex/lib/ingestionClassify";
import { pathFieldsFor, takesInitialsWriter } from "../../convex/lib/ingestionSheet";
import { extractText } from "../../convex/ingestionSync";
import { parsePdFilename } from "../../shared/pdFilename";
import { writerInitialsKey } from "../../shared/importSheetRules";
import { writerNameForInitials, writerNamesFromText } from "../../shared/writerNameFromText";

export const PRIVACY_NOTE =
  "This report holds counts, initials and file name patterns with every word replaced. It holds no file text, no client names and no person names.";

export const HELP = `Import dry run: counts what the Import page would make of a folder of files.

Usage:
  node scripts/import-dry-run.mjs "<folder>" [--no-text] [--out report.json]

<folder>  The folder that holds the client folders, laid out as
          <Client>/<Fiscal year>/... (on a Mac, for example,
          ~/Library/CloudStorage/OneDrive-<Firm>/Applications).

Options:
  --no-text         Read file names and folders only. Skips reading each
                    file's text, so text sizes, writer names, duplicates and
                    unreadable files are not counted. Much faster.
  --out FILE        Also write the report as JSON to FILE. FILE must be
                    outside the folder being read.
  -h, --help        Show this help.

What it does not do: it sends nothing anywhere, needs no Convex deployment
and no API key, and changes no file in the folder. Files that OneDrive keeps
online only are not opened (that would download them); they are counted as
"not downloaded".

${PRIVACY_NOTE} You can send it to us as it is.`;

export type CliOptions = { folder?: string; readText: boolean; out?: string; help: boolean };

export function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = { readText: true, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") options.help = true;
    else if (arg === "--no-text") options.readText = false;
    else if (arg === "--out") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) throw new Error("--out needs a file name");
      options.out = value;
      i += 1;
    } else if (arg.startsWith("-")) throw new Error(`unknown option ${arg}`);
    else if (options.folder === undefined) options.folder = arg;
    else throw new Error("give one folder only (put a folder name with spaces in quotes)");
  }
  return options;
}

/** True when `file` is `folder` itself or inside it. */
export function isInside(folder: string, file: string): boolean {
  const relative = path.relative(path.resolve(folder), path.resolve(file));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

// ─── Name patterns ──────────────────────────────────────────────────────────

/** Words a file name pattern keeps as typed: scheme words, never names. */
const KEPT_WORDS = new Set([
  "pd",
  "final",
  "draft",
  "review",
  "reviewed",
  "submitted",
  "submit",
  "copy",
  "rev",
  "v",
  "version",
  "fy",
  "fye",
  "sred",
  "t",
  "s",
  "r",
]);

function wordShape(word: string): string {
  if (KEPT_WORDS.has(word.toLowerCase())) return word;
  const upper = word.toUpperCase();
  const lower = word.toLowerCase();
  if (word === upper) return word.length <= 3 ? "A".repeat(word.length) : "WORD";
  if (word === lower) return word.length === 1 ? "a" : "word";
  if (word[0] === upper[0] && word.slice(1) === lower.slice(1)) return "Word";
  return "WordWord";
}

/**
 * A file name with every letter run replaced by its shape ("Word", "word",
 * "WORD", "WordWord", "AA" for a short capital run such as initials). Digits,
 * spaces, punctuation and a document extension are kept, and so are a few
 * scheme words (PD, Final, Draft, R, T, ...). No client or person name
 * survives: "Cedarline Systems PD 2 final.docx" is "Word Word PD 2 final.docx".
 */
export function namePattern(fileName: string): string {
  const ext = extensionOf(fileName);
  const keepExt = INGEST_EXTENSIONS.has(ext);
  const stem = keepExt ? fileName.slice(0, fileName.length - ext.length - 1) : fileName;
  const shaped = stem.replace(/\p{L}+/gu, wordShape);
  return keepExt ? `${shaped}.${ext}` : shaped;
}

// ─── Cloud-only files ───────────────────────────────────────────────────────

export type CloudOnlyCheck = (absolutePath: string, stat: Stats) => boolean;

/**
 * On Windows, the files OneDrive keeps online only, from one PowerShell
 * listing (the Offline or RecallOnDataAccess attribute, as the client
 * uploader's Test-CloudOnly reads them). Null when PowerShell fails.
 */
function windowsCloudOnlyFiles(root: string): Set<string> | null {
  const script = [
    "[Console]::OutputEncoding = [Text.Encoding]::UTF8",
    "$bits = [int][IO.FileAttributes]::Offline -bor 0x400000",
    "Get-ChildItem -LiteralPath $env:IMPORT_DRY_RUN_ROOT -Recurse -File -Force -ErrorAction SilentlyContinue |",
    "  Where-Object { ([int]$_.Attributes -band $bits) -ne 0 } | ForEach-Object { $_.FullName }",
  ].join("\n");
  try {
    const output = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      encoding: "utf8",
      env: { ...process.env, IMPORT_DRY_RUN_ROOT: root },
      maxBuffer: 256 * 1024 * 1024,
    });
    return new Set(output.split(/\r?\n/).filter(Boolean).map((line) => path.resolve(line).toLowerCase()));
  } catch {
    return null;
  }
}

/**
 * How this machine tells an online-only file: on Windows its attributes; on
 * a Mac (and Linux) a file that has a size but no disk blocks, which is how
 * an online-only (dataless) file looks to stat.
 */
export function defaultCloudOnlyCheck(root: string): { check: CloudOnlyCheck; note?: string } {
  if (process.platform === "win32") {
    const files = windowsCloudOnlyFiles(root);
    if (files === null) {
      return {
        check: () => false,
        note: "PowerShell did not list online-only files, so none were skipped; OneDrive may download them while this runs.",
      };
    }
    return { check: (absolutePath) => files.has(path.resolve(absolutePath).toLowerCase()) };
  }
  return { check: (_absolutePath, stat) => stat.size > 0 && stat.blocks === 0 };
}

// ─── The report ─────────────────────────────────────────────────────────────

type Counter = Record<string, number>;

function bump(counter: Counter, key: string, by = 1): void {
  counter[key] = (counter[key] ?? 0) + by;
}

export type SizeStats = { count: number; min: number; median: number; p95: number; max: number } | null;

export function sizeStats(values: readonly number[]): SizeStats {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (q: number) => sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)];
  return { count: sorted.length, min: sorted[0], median: rank(0.5), p95: rank(0.95), max: sorted[sorted.length - 1] };
}

type WriterNameCounts = {
  /** Files with writer initials in their name whose category takes a writer. */
  withInitials: number;
  /** The text gives exactly one name after a writer cue that fits the initials (the server names the writer then). */
  textNameMatches: number;
  /** The text gives names after a writer cue, but not exactly one that fits. */
  textNamesNoMatch: number;
  /** No name after a writer cue in the text. */
  noTextName: number;
  /** The text was not read (not downloaded, unreadable or empty). */
  notRead: number;
};

export type DryRunReport = {
  privacy: string;
  readText: boolean;
  notes: string[];
  files: {
    seen: number;
    linksSkipped: number;
    foldersNotOpened: number;
    systemOrHidden: number;
    typeNotImported: number;
    typeNotImportedByExtension: Counter;
    empty: number;
    tooLarge: number;
    pathRefused: number;
    wouldImport: number;
    notDownloaded: number;
  };
  byCategory: Record<IngestionCategory, number>;
  company: { found: number; notFound: number; distinctCompanies: number; companyYearGroups: number };
  fiscalYear: { found: number; folderWithoutYear: number; noFolder: number; yearEndDayAssumed: number };
  finalPdNames: {
    total: number;
    parses: number;
    doesNotParse: number;
    withVersion: number;
    withWriterInitials: number;
    withReviewerInitials: number;
    withFiscalYearEnd: number;
    withPdNumber: number;
  };
  draftAndReviewNames: { total: number; withVersion: number };
  writerInitials: Counter;
  reviewerInitials: Counter;
  writerNames: { finalPd: WriterNameCounts; draftOrReview: WriterNameCounts } | null;
  text: {
    read: number;
    noText: Counter;
    couldNotRead: Counter;
    finalPdTextChars: SizeStats;
    sameTextGroups: number;
    filesInSameTextGroups: number;
    sameBytesGroups: number;
    filesInSameBytesGroups: number;
  } | null;
  unparsedFinalPdPatterns: { pattern: string; count: number }[];
  unparsedFinalPdPatternsTotal: number;
};

export type DryRunOptions = {
  readText: boolean;
  /** Defaults to defaultCloudOnlyCheck(root). */
  cloudOnly?: CloudOnlyCheck;
  onProgress?: (done: number, total: number) => void;
};

type Candidate = { absolutePath: string; relPath: string; name: string; stat: Stats; cloudOnly: boolean };

/** Visit every entry under `dir`, folders first opened in name order. Returns the folders it could not open. */
async function walk(dir: string, visit: (absolutePath: string, entry: Dirent) => Promise<void>, top = true): Promise<number> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (top) throw error;
    return 1;
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  let unopened = 0;
  for (const entry of entries) {
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) unopened += await walk(absolutePath, visit, false);
    else await visit(absolutePath, entry);
  }
  return unopened;
}

/** Why a reading has no text, as a fixed label (never the file's text). */
function noTextReason(note: string | undefined): string {
  if (!note) return "empty";
  if (/legacy \.doc/i.test(note)) return "legacy .doc (not read)";
  if (/no text layer/i.test(note)) return "PDF with no text layer";
  return "other";
}

function emptyWriterNameCounts(): WriterNameCounts {
  return { withInitials: 0, textNameMatches: 0, textNamesNoMatch: 0, noTextName: 0, notRead: 0 };
}

const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");

function groupsOf(keys: Map<string, number>): { groups: number; files: number } {
  let groups = 0;
  let files = 0;
  for (const count of keys.values()) {
    if (count > 1) {
      groups += 1;
      files += count;
    }
  }
  return { groups, files };
}

/** Walk `root` and count. Reads files; never writes, moves or deletes one. */
export async function runDryRun(root: string, options: DryRunOptions): Promise<DryRunReport> {
  const notes: string[] = [];
  let cloudOnly = options.cloudOnly;
  if (!cloudOnly) {
    const fallback = defaultCloudOnlyCheck(root);
    cloudOnly = fallback.check;
    if (fallback.note) notes.push(fallback.note);
  }

  const files: DryRunReport["files"] = {
    seen: 0,
    linksSkipped: 0,
    foldersNotOpened: 0,
    systemOrHidden: 0,
    typeNotImported: 0,
    typeNotImportedByExtension: {},
    empty: 0,
    tooLarge: 0,
    pathRefused: 0,
    wouldImport: 0,
    notDownloaded: 0,
  };
  const candidates: Candidate[] = [];
  files.foldersNotOpened = await walk(root, async (absolutePath, entry) => {
    if (entry.isSymbolicLink()) {
      files.linksSkipped += 1;
      return;
    }
    if (!entry.isFile()) return;
    files.seen += 1;
    const relPath = sanitizeRelPath(path.relative(root, absolutePath).split(path.sep).join("/"));
    if (relPath === null) {
      files.pathRefused += 1;
      return;
    }
    if (isJunkPath(relPath)) {
      files.systemOrHidden += 1;
      return;
    }
    const name = relPath.split("/").pop()!;
    const ext = extensionOf(name);
    if (!INGEST_EXTENSIONS.has(ext)) {
      files.typeNotImported += 1;
      bump(files.typeNotImportedByExtension, /^[a-z0-9]{1,5}$/.test(ext) ? `.${ext}` : "other");
      return;
    }
    let stat: Stats;
    try {
      stat = await fs.lstat(absolutePath);
    } catch {
      files.pathRefused += 1;
      return;
    }
    if (stat.size === 0) {
      files.empty += 1;
      return;
    }
    if (stat.size > MAX_FILE_BYTES) {
      files.tooLarge += 1;
      return;
    }
    const isCloudOnly = cloudOnly!(absolutePath, stat);
    if (isCloudOnly) files.notDownloaded += 1;
    candidates.push({ absolutePath, relPath, name, stat, cloudOnly: isCloudOnly });
  });
  files.wouldImport = candidates.length;

  const byCategory = Object.fromEntries(INGESTION_CATEGORIES.map((c) => [c, 0])) as Record<IngestionCategory, number>;
  const company = { found: 0, notFound: 0, distinctCompanies: 0, companyYearGroups: 0 };
  const fiscalYear = { found: 0, folderWithoutYear: 0, noFolder: 0, yearEndDayAssumed: 0 };
  const finalPdNames: DryRunReport["finalPdNames"] = {
    total: 0,
    parses: 0,
    doesNotParse: 0,
    withVersion: 0,
    withWriterInitials: 0,
    withReviewerInitials: 0,
    withFiscalYearEnd: 0,
    withPdNumber: 0,
  };
  const draftAndReviewNames = { total: 0, withVersion: 0 };
  const writerInitials: Counter = {};
  const reviewerInitials: Counter = {};
  const companies = new Set<string>();
  const companyYears = new Set<string>();
  const patterns = new Map<string, number>();
  const writerNames = { finalPd: emptyWriterNameCounts(), draftOrReview: emptyWriterNameCounts() };
  const text = {
    read: 0,
    noText: {} as Counter,
    couldNotRead: {} as Counter,
    finalPdTextChars: null as SizeStats,
    sameTextGroups: 0,
    filesInSameTextGroups: 0,
    sameBytesGroups: 0,
    filesInSameBytesGroups: 0,
  };
  const finalPdChars: number[] = [];
  const textKeys = new Map<string, number>();
  const byteKeys = new Map<string, number>();

  // Some readers warn on stderr about a damaged file; keep the output to the report.
  const quiet = { warn: console.warn, log: console.log, info: console.info };
  let done = 0;
  for (const file of candidates) {
    const fields = pathFieldsFor(file.relPath, file.name);
    const category = fields.category;
    byCategory[category] += 1;

    if (fields.clientName === undefined) company.notFound += 1;
    else company.found += 1;
    if (fields.companyKey !== undefined) companies.add(fields.companyKey);
    if (fields.fiscalYearEnd !== undefined) {
      fiscalYear.found += 1;
      if (fields.fiscalYearEndAssumed) fiscalYear.yearEndDayAssumed += 1;
      if (fields.companyKey !== undefined) companyYears.add(`${fields.companyKey}::${new Date(fields.fiscalYearEnd).getUTCFullYear()}`);
    } else if (fields.fiscalYearLabel !== undefined) fiscalYear.folderWithoutYear += 1;
    else fiscalYear.noFolder += 1;

    if (category === "final_pd") {
      finalPdNames.total += 1;
      if (parsePdFilename(file.name) === null) {
        finalPdNames.doesNotParse += 1;
        const pattern = namePattern(file.name);
        patterns.set(pattern, (patterns.get(pattern) ?? 0) + 1);
      } else finalPdNames.parses += 1;
      if (fields.versionCode !== undefined) finalPdNames.withVersion += 1;
      if (fields.writerInitials !== undefined) finalPdNames.withWriterInitials += 1;
      if (fields.reviewerInitials !== undefined) finalPdNames.withReviewerInitials += 1;
      if (fields.pdNumber !== undefined) finalPdNames.withPdNumber += 1;
      if (parsePdFilename(file.name)?.fiscalYearEnd !== undefined) finalPdNames.withFiscalYearEnd += 1;
    } else if (category === "draft" || category === "review_copy") {
      draftAndReviewNames.total += 1;
      if (fields.versionCode !== undefined) draftAndReviewNames.withVersion += 1;
    }
    if (fields.writerInitials !== undefined) bump(writerInitials, fields.writerInitials);
    if (fields.reviewerInitials !== undefined) bump(reviewerInitials, fields.reviewerInitials);

    const takesWriter = takesInitialsWriter(fields);
    const nameCounts = category === "final_pd" ? writerNames.finalPd : writerNames.draftOrReview;
    if (takesWriter) nameCounts.withInitials += 1;

    if (!options.readText) continue;
    let fileText: string | undefined;
    if (!file.cloudOnly) {
      let bytes: Uint8Array | null = null;
      try {
        bytes = new Uint8Array(await fs.readFile(file.absolutePath));
      } catch {
        bump(text.couldNotRead, "the file could not be opened");
      }
      if (bytes) {
        const key = sha256(bytes);
        byteKeys.set(key, (byteKeys.get(key) ?? 0) + 1);
        console.warn = console.log = console.info = () => {};
        try {
          const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
          const reading = await extractText(buffer, file.name);
          const trimmed = reading.text?.trim() ?? "";
          if (trimmed) {
            fileText = trimmed;
            text.read += 1;
          } else bump(text.noText, noTextReason(reading.note));
        } catch {
          bump(text.couldNotRead, "the reader failed (damaged or protected)");
        } finally {
          Object.assign(console, quiet);
        }
      }
    }
    if (fileText !== undefined) {
      const key = sha256(fileText.replace(/\s+/g, " "));
      textKeys.set(key, (textKeys.get(key) ?? 0) + 1);
      if (category === "final_pd") finalPdChars.push(fileText.length);
    }
    if (takesWriter) {
      if (fileText === undefined) nameCounts.notRead += 1;
      else {
        const names = writerNamesFromText(fileText);
        if (names.length === 0) nameCounts.noTextName += 1;
        else if (
          writerNameForInitials(names, writerInitialsKey(fields.writerInitials), { companyName: fields.clientName }) !== null
        ) {
          nameCounts.textNameMatches += 1;
        } else nameCounts.textNamesNoMatch += 1;
      }
    }
    done += 1;
    options.onProgress?.(done, candidates.length);
  }

  company.distinctCompanies = companies.size;
  company.companyYearGroups = companyYears.size;
  if (options.readText) {
    text.finalPdTextChars = sizeStats(finalPdChars);
    const sameText = groupsOf(textKeys);
    text.sameTextGroups = sameText.groups;
    text.filesInSameTextGroups = sameText.files;
    const sameBytes = groupsOf(byteKeys);
    text.sameBytesGroups = sameBytes.groups;
    text.filesInSameBytesGroups = sameBytes.files;
  }
  const sortedPatterns = [...patterns.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([pattern, count]) => ({ pattern, count }));

  return {
    privacy: PRIVACY_NOTE,
    readText: options.readText,
    notes,
    files,
    byCategory,
    company,
    fiscalYear,
    finalPdNames,
    draftAndReviewNames,
    writerInitials: sortCounter(writerInitials),
    reviewerInitials: sortCounter(reviewerInitials),
    writerNames: options.readText ? writerNames : null,
    text: options.readText ? text : null,
    unparsedFinalPdPatterns: sortedPatterns.slice(0, 20),
    unparsedFinalPdPatternsTotal: sortedPatterns.length,
  };
}

function sortCounter(counter: Counter): Counter {
  return Object.fromEntries(Object.entries(counter).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)));
}

// ─── Printing ───────────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<IngestionCategory, string> = {
  final_pd: "Final PD",
  draft: "Draft",
  review_copy: "Review copy",
  transcript: "Transcript",
  supporting: "Supporting",
  company_file: "Company file",
  unknown: "Unknown (no client folder)",
};

function counterLine(counter: Counter): string {
  const entries = Object.entries(counter);
  return entries.length === 0 ? "none" : entries.map(([key, count]) => `${key} ${count}`).join(", ");
}

function writerNameLines(label: string, counts: WriterNameCounts): string[] {
  return [
    `  ${label} with writer initials: ${counts.withInitials}`,
    `    text names one writer who fits the initials: ${counts.textNameMatches}`,
    `    text names someone, but not one who fits: ${counts.textNamesNoMatch}`,
    `    no name after "Prepared by", "Written by", "Author" and the like: ${counts.noTextName}`,
    `    text not read: ${counts.notRead}`,
  ];
}

/** The plain report. Counts and placeholders only. */
export function formatReport(report: DryRunReport): string {
  const f = report.files;
  const lines: string[] = [
    "Import dry run",
    `Privacy: ${report.privacy}`,
    "Nothing was sent anywhere and no file in the folder was changed.",
    "",
    "Files",
    `  seen: ${f.seen}`,
    `  would be imported: ${f.wouldImport}`,
    `  not downloaded (online only in OneDrive, so not opened): ${f.notDownloaded}`,
    `  left out, system or hidden files: ${f.systemOrHidden}`,
    `  left out, file type not imported: ${f.typeNotImported} (${counterLine(f.typeNotImportedByExtension)})`,
    `  left out, empty: ${f.empty}`,
    `  left out, larger than 15 MB: ${f.tooLarge}`,
    `  left out, links (not followed): ${f.linksSkipped}`,
  ];
  if (f.pathRefused > 0) lines.push(`  left out, path not usable: ${f.pathRefused}`);
  if (f.foldersNotOpened > 0) lines.push(`  folders that could not be opened: ${f.foldersNotOpened}`);
  lines.push("", "By category");
  for (const category of INGESTION_CATEGORIES) {
    lines.push(`  ${CATEGORY_LABELS[category]}: ${report.byCategory[category]}`);
  }
  const c = report.company;
  const y = report.fiscalYear;
  lines.push(
    "",
    "Company and fiscal year (from the folders)",
    `  company found: ${c.found}, not found: ${c.notFound}`,
    `  distinct companies: ${c.distinctCompanies}, company and year groups: ${c.companyYearGroups}`,
    `  fiscal year found: ${y.found}, year folder with no year in its name: ${y.folderWithoutYear}, no year folder: ${y.noFolder}`,
    `  year end day assumed (Dec 31, the folder and name did not give it): ${y.yearEndDayAssumed}`
  );
  const p = report.finalPdNames;
  lines.push(
    "",
    "Final PD file names",
    `  final PDs: ${p.total}`,
    `  name follows the PD scheme: ${p.parses}, does not: ${p.doesNotParse}`,
    `  with version: ${p.withVersion}, writer initials: ${p.withWriterInitials}, reviewer initials: ${p.withReviewerInitials}`,
    `  with fiscal year end date: ${p.withFiscalYearEnd}, PD number: ${p.withPdNumber}`,
    `  drafts and review copies: ${report.draftAndReviewNames.total}, with a version in the name: ${report.draftAndReviewNames.withVersion}`,
    "",
    "Initials in file names (initials only)",
    `  writer: ${counterLine(report.writerInitials)}`,
    `  reviewer: ${counterLine(report.reviewerInitials)}`
  );
  if (report.writerNames) {
    lines.push(
      "",
      "Writer names in the text (counts only)",
      ...writerNameLines("final PDs", report.writerNames.finalPd),
      ...writerNameLines("drafts and review copies", report.writerNames.draftOrReview)
    );
  }
  if (report.text) {
    const t = report.text;
    const s = t.finalPdTextChars;
    lines.push(
      "",
      "Text",
      `  files with text read: ${t.read}`,
      `  no text: ${counterLine(t.noText)}`,
      `  could not be read: ${counterLine(t.couldNotRead)}`,
      s
        ? `  final PD text size in characters (${s.count} PDs): min ${s.min}, median ${s.median}, p95 ${s.p95}, max ${s.max}`
        : "  final PD text size: no final PD text read",
      `  groups of files with the same text: ${t.sameTextGroups} (${t.filesInSameTextGroups} files)`,
      `  groups of files with the same bytes: ${t.sameBytesGroups} (${t.filesInSameBytesGroups} files)`
    );
  } else {
    lines.push("", "Text: not read (--no-text)");
  }
  lines.push("", `Final PD names that do not follow the scheme (${report.unparsedFinalPdPatternsTotal} patterns, up to 20 shown)`);
  if (report.unparsedFinalPdPatterns.length === 0) lines.push("  none");
  for (const { pattern, count } of report.unparsedFinalPdPatterns) lines.push(`  ${count} x ${pattern}`);
  lines.push(
    "  (each word is replaced: Word, word, WORD, WordWord, AA for short capitals; digits and scheme words such as PD, Final and R are kept)"
  );
  for (const note of report.notes) lines.push("", `Note: ${note}`);
  return `${lines.join("\n")}\n`;
}
