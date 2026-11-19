// The import dry run's logic (scripts/import-dry-run.mjs runs it). It walks a
// local copy of the firm's OneDrive folder and counts what the Import page
// would make of each file, with the server's own pure functions, so the
// counts match the app. Read-only: it sends nothing, needs no deployment or
// key, and writes nothing in the folder it reads.
//
// Privacy: the report holds counts, initials and name patterns with every
// word replaced by a placeholder. Never a file's text, a client name, a
// person's name or the folder's own path.
//
// Online-only OneDrive files are never opened: opening one makes OneDrive
// download it. The walk decides file or folder with lstat, which does not
// download anything, and never follows a link.

import { createHash } from "node:crypto";
import { existsSync, promises as fs, realpathSync, type Dirent, type Stats } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import {
  INGEST_EXTENSIONS,
  INGESTION_CATEGORIES,
  MAX_FILE_BYTES,
  extensionOf,
  fiscalYearOfLabel,
  isJunkPath,
  sanitizeRelPath,
  type IngestionCategory,
} from "../../convex/lib/ingestionClassify";
import { pathFieldsFor, takesInitialsWriter } from "../../convex/lib/ingestionSheet";
import { extractText } from "../../convex/ingestionSync";
import { parsePdFilename } from "../../shared/pdFilename";
import { writerInitialsKey } from "../../shared/importSheetRules";
import { writerNameForInitials, writerNamesFromText } from "../../shared/writerNameFromText";
import { companyFolderPaths } from "../../src/lib/components/import/importIntake";

export const PRIVACY_NOTE =
  "This report holds counts, initials and file name patterns with every word replaced. It holds no file text, no client names and no person names.";

const INITIALS_NOTE =
  "Initials are 2 or 3 letters from file names. A 3-letter one can be a short name\n(for example a first name); it is shown as it is.";

export const HELP = `Import dry run: counts what the Import page would make of a folder of files.

Usage (from the Banhall folder, after npm ci):
  node scripts/import-dry-run.mjs "<folder>" [--no-text] [--out report.json]

<folder>  The folder that holds the client folders, laid out as
          <Client>/<Fiscal year>/... (on a Mac, for example,
          ~/Library/CloudStorage/OneDrive-<Firm>/Applications).

Options:
  --no-text         Read file names and folders only. Skips reading each
                    file's text, so text sizes, writer names, duplicates and
                    unreadable files are not counted. Much faster.
  --out FILE        Also write the report as JSON to FILE (--out=FILE works
                    too). FILE must be new and outside the folder being read.
  -h, --help        Show this help.

What it does not do: it sends nothing anywhere, needs no Convex deployment
and no API key, and changes no file in the folder. Files that OneDrive keeps
online only are not opened (that would download them); they are counted as
"online only". On Windows it asks PowerShell which files are on this
computer and reads only those; if PowerShell cannot say, it reads no text.

On a Mac, if it says a folder could not be opened, give Terminal access to
~/Library/CloudStorage (System Settings, Privacy and Security, Files and
Folders, or Full Disk Access) and run it again.

${INITIALS_NOTE}

${PRIVACY_NOTE} You can send it to us as it is.`;

export type CliOptions = { folder?: string; readText: boolean; out?: string; help: boolean };

export function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = { readText: true, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") options.help = true;
    else if (arg === "--no-text") options.readText = false;
    else if (arg.startsWith("--out=")) {
      options.out = arg.slice("--out=".length);
      if (!options.out) throw new Error("--out needs a file name");
    } else if (arg === "--out") {
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

/** True when `file` is `folder` itself or inside it, as given (no links resolved). */
export function isInside(folder: string, file: string): boolean {
  const relative = path.relative(path.resolve(folder), path.resolve(file));
  const outside = relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
  return !outside;
}

/** A path with every link resolved; for a file that does not exist yet, its folder's real path. */
function realPathOf(file: string): string {
  const absolute = path.resolve(file);
  try {
    return realpathSync(absolute);
  } catch {
    const parent = path.dirname(absolute);
    return parent === absolute ? absolute : path.join(realPathOf(parent), path.basename(absolute));
  }
}

/** Why --out cannot be written, or null. Inside the folder (links resolved) or an existing file is refused. */
export function outRefusal(folder: string, out: string): string | null {
  if (isInside(folder, out) || isInside(realPathOf(folder), realPathOf(out))) {
    return "--out must be outside the folder being read, so the folder is not changed";
  }
  if (existsSync(out)) return "--out names a file that already exists; give a new file name";
  return null;
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
  const letters = [...word.replace(/\p{M}/gu, "")];
  const upper = word.toUpperCase();
  const lower = word.toLowerCase();
  if (word === upper) return letters.length <= 3 ? "A".repeat(letters.length) : "WORD";
  if (word === lower) return letters.length === 1 ? "a" : "word";
  if (word[0] === upper[0] && word.slice(1) === lower.slice(1)) return "Word";
  return "WordWord";
}

/**
 * Digits next to another digit group (joined by a space, - . / or brackets)
 * are part of a phone or account number, never a kept year or date.
 */
const NOT_AFTER_DIGITS = String.raw`(?<!\p{Nd})(?<!\p{Nd}[\s\-./()])`;
const NOT_BEFORE_DIGITS = String.raw`(?!\p{Nd})(?![\s\-./()]\p{Nd})`;
const NAME_TOKEN = new RegExp(
  [
    // 1: a yyyy-mm-dd date in 19xx or 20xx, standing alone, kept.
    `(${NOT_AFTER_DIGITS}(?:19|20)\\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])${NOT_BEFORE_DIGITS})`,
    // 2: a 19xx or 20xx year, standing alone, kept.
    `(${NOT_AFTER_DIGITS}(?:19|20)\\d{2}${NOT_BEFORE_DIGITS})`,
    // 3: two or more digit groups in a row ("06 12 34 56 78", "416-555-0199"),
    //    any digits (Unicode too): every digit becomes #.
    String.raw`(\p{Nd}+(?:[\s\-./()]+\p{Nd}+)+)`,
    // 4: one digit run: kept only when it is 1 or 2 ASCII digits.
    String.raw`(\p{Nd}+)`,
    // 5: a word, letters with their combining marks.
    String.raw`([\p{L}\p{M}]+)`,
  ].join("|"),
  "gu"
);

/**
 * A file name with every word replaced by its shape ("Word", "word", "WORD",
 * "WordWord", "AA" for a short capital run such as initials), and every
 * digit run longer than 2 replaced by # marks, except a 19xx or 20xx year or
 * a yyyy-mm-dd date. Kept: 1 or 2 digit numbers (PD numbers, versions),
 * spaces, punctuation, a document extension and a few scheme words (PD,
 * Final, Draft, R, T, ...). "1234567 Cedarline Inc PD 2 final.docx" is
 * "####### Word Word PD 2 final.docx".
 */
export function namePattern(fileName: string): string {
  const ext = extensionOf(fileName);
  const keepExt = INGEST_EXTENSIONS.has(ext);
  const stem = keepExt ? fileName.slice(0, fileName.length - ext.length - 1) : fileName;
  const shaped = stem.replace(
    NAME_TOKEN,
    (token, date?: string, year?: string, sequence?: string, digits?: string) => {
      if (date !== undefined || year !== undefined) return token;
      if (sequence !== undefined) return sequence.replace(/\p{Nd}/gu, "#");
      if (digits !== undefined) return /^[0-9]{1,2}$/.test(digits) ? digits : digits.replace(/\p{Nd}/gu, "#");
      return wordShape(token);
    }
  );
  return keepExt ? `${shaped}.${ext}` : shaped;
}

/** File types reported by name when they are not imported; anything else is "other". */
const KNOWN_EXTENSIONS = new Set(
  (
    "xlsx xls xlsm xlsb csv ods numbers pptx ppt pptm odp key rtf odt pages docm dotx dot md html htm xml json " +
    "msg eml mbox ics vcf png jpg jpeg gif bmp tif tiff heic webp svg psd ai eps mp3 m4a wav wma aac ogg mp4 mov " +
    "avi wmv mkv zip rar 7z gz tar dwg dxf step stp mpp vsdx one onetoc2 xps lnk url ini log bak tmp db exe"
  ).split(" ")
);

export function extensionLabel(fileName: string): string {
  const ext = extensionOf(fileName);
  return KNOWN_EXTENSIONS.has(ext) ? `.${ext}` : "other";
}

/** The version token's initials groups in a name ("T0.DW.PN.SO" has 3), or 0 when it has no version token. */
export function versionInitialsGroups(fileName: string): string[] | null {
  const stem = fileName.replace(/\.(docx|doc|pdf|txt|vtt)$/i, "");
  for (const token of stem.split(/\s+/)) {
    const match = /^[RrSsTt]\d+((?:\.[A-Za-z]{2,3})+)$/.exec(token);
    if (match) return match[1].slice(1).split(".").map((part) => part.toUpperCase());
  }
  return null;
}

// ─── Walking ────────────────────────────────────────────────────────────────

/** What the walk needs from the file system; tests pass their own. */
export type WalkIo = {
  readdir: (dir: string) => Promise<Pick<Dirent, "name" | "isFile" | "isDirectory" | "isSymbolicLink">[]>;
  lstat: (file: string) => Promise<Pick<Stats, "isFile" | "isDirectory" | "isSymbolicLink">>;
};

const realIo: WalkIo = {
  readdir: (dir) => fs.readdir(dir, { withFileTypes: true }),
  lstat: (file) => fs.lstat(file),
};

export type WalkCounts = { links: number; foldersNotOpened: number; entriesNotOpened: number; folderError?: string };

/**
 * Visit every file under `root`, in name order. On Windows Node's readdir
 * calls every reparse point a link, and OneDrive placeholders (files and
 * folders) are reparse points, so an entry that looks like a link, and every
 * entry on Windows, is checked with lstat: a real link stays a link and is
 * never followed, a placeholder is the file or folder it is. Neither call
 * downloads a file.
 */
export async function walkFolder(
  root: string,
  visit: (absolutePath: string) => Promise<void>,
  options: { io?: WalkIo; platform?: NodeJS.Platform; onFolder?: () => void } = {}
): Promise<WalkCounts> {
  const io = options.io ?? realIo;
  const windows = (options.platform ?? process.platform) === "win32";
  const counts: WalkCounts = { links: 0, foldersNotOpened: 0, entriesNotOpened: 0 };
  const walk = async (dir: string, top: boolean): Promise<void> => {
    options.onFolder?.();
    let entries: Awaited<ReturnType<WalkIo["readdir"]>>;
    try {
      entries = await io.readdir(dir);
    } catch (error) {
      if (top) throw error;
      counts.foldersNotOpened += 1;
      counts.folderError ??= (error as NodeJS.ErrnoException)?.code;
      return;
    }
    entries = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const absolutePath = path.join(dir, entry.name);
      let kind: "file" | "folder" | "link" | "other";
      if (windows || entry.isSymbolicLink()) {
        try {
          const stat = await io.lstat(absolutePath);
          kind = stat.isSymbolicLink() ? "link" : stat.isDirectory() ? "folder" : stat.isFile() ? "file" : "other";
        } catch {
          counts.entriesNotOpened += 1;
          continue;
        }
      } else kind = entry.isDirectory() ? "folder" : entry.isFile() ? "file" : "other";
      if (kind === "link") counts.links += 1;
      else if (kind === "folder") await walk(absolutePath, false);
      else if (kind === "file") await visit(absolutePath);
    }
  };
  await walk(root, true);
  return counts;
}

// ─── Online-only files ──────────────────────────────────────────────────────

/** Whether a file is on this computer, so it can be opened without a download. */
export type LocalCheck = (absolutePath: string, stat: Stats) => boolean;

/**
 * On Windows, the files under `root` that are on this computer, from one
 * PowerShell listing: a file with the Offline, RecallOnOpen or
 * RecallOnDataAccess attribute is online only (the client uploader reads the
 * same bits). Null when PowerShell is missing or fails. A file PowerShell
 * does not list is treated as online only, so nothing is ever downloaded.
 */
export function listLocalFilesWithPowerShell(root: string): Promise<Set<string> | null> {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "[Console]::OutputEncoding = [Text.Encoding]::UTF8",
    "$cloud = [int][IO.FileAttributes]::Offline -bor 0x40000 -bor 0x400000",
    "Get-ChildItem -LiteralPath $env:IMPORT_DRY_RUN_ROOT -Recurse -File -Force -ErrorAction SilentlyContinue |",
    "  Where-Object { ([int]$_.Attributes -band $cloud) -eq 0 } | ForEach-Object { $_.FullName }",
  ].join("\n");
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { encoding: "utf8", env: { ...process.env, IMPORT_DRY_RUN_ROOT: root }, maxBuffer: 512 * 1024 * 1024, windowsHide: true },
      (error, stdout) => {
        if (error) return resolve(null);
        resolve(new Set(stdout.split(/\r?\n/).filter(Boolean).map((line) => path.resolve(line).toLowerCase())));
      }
    );
  });
}

/** On a Mac (and Linux) a file is local when it has disk blocks; an online-only (dataless) file has a size but none. */
const blocksCheck: LocalCheck = (_absolutePath, stat) =>
  typeof stat.blocks === "number" && Number.isFinite(stat.blocks) && (stat.blocks > 0 || stat.size === 0);

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
  /** The text was not read (online only, unreadable or empty). */
  notRead: number;
};

export type DryRunReport = {
  privacy: string;
  readText: boolean;
  /** Said at the top of the report: why text was not read, and a folder that looks like the wrong level. */
  warnings: string[];
  files: {
    seen: number;
    linksSkipped: number;
    foldersNotOpened: number;
    filesNotOpened: number;
    systemOrHidden: number;
    looseTopLevel: number;
    typeNotImported: number;
    typeNotImportedByExtension: Counter;
    empty: number;
    tooLarge: number;
    pathRefused: number;
    /** On this computer: would be imported, and read. */
    wouldImport: number;
    /** Online only: would be imported once downloaded; never opened here. */
    onlineOnly: number;
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
    /** Final PD names by how many initials groups their version token has ("0" for no version token). */
    byInitialsGroups: Counter;
  };
  draftAndReviewNames: { total: number; withVersion: number };
  writerInitials: Counter;
  reviewerInitials: Counter;
  /** From final PD version tokens with 3 or more initials groups, which the scheme does not read yet. */
  longVersionInitials: { firstGroup: Counter; laterGroups: Counter };
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
  /** Defaults to process.platform. */
  platform?: NodeJS.Platform;
  /** Overrides how a file is found to be on this computer. */
  isLocal?: LocalCheck;
  /** Windows: the files on this computer, or null when that cannot be told. Defaults to PowerShell. */
  listLocalFiles?: (root: string) => Promise<Set<string> | null>;
  io?: WalkIo;
  onProgress?: (stage: "walk" | "local" | "read", done: number, total?: number) => void;
};

type Candidate = { absolutePath: string; relPath: string; name: string; local: boolean };

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

/** Warnings when the folder looks like the wrong level. Counts only, no names. */
function levelWarnings(relPaths: readonly string[], fiscalYearsFound: number, distinctCompanies: number): string[] {
  const warnings: string[] = [];
  if (relPaths.length === 0) return warnings;
  // The Import page's own rule: a folder whose folders hold company folders is one level too high.
  const asDropped = relPaths.map((p) => ({ file: undefined as unknown as File, path: p }));
  const moved = companyFolderPaths(asDropped).filter((entry, i) => entry.path !== relPaths[i]).length;
  if (moved > 0) {
    warnings.push(
      `${moved} files sit one folder deeper than expected (<folder>/<something>/<Client>/<Fiscal year>/...). This folder looks like the one above the client folders; run it on the folder that holds the client folders.`
    );
  }
  const yearAtTop = relPaths.filter((p) => {
    const segments = p.split("/");
    return segments.length > 1 && fiscalYearOfLabel(segments[0]) !== undefined;
  }).length;
  const yearSecond = relPaths.filter((p) => fiscalYearOfLabel(p.split("/")[1]) !== undefined && p.split("/").length > 2).length;
  if (yearAtTop > yearSecond) {
    warnings.push(
      `${yearAtTop} files sit in fiscal year folders right under this folder. This looks like one company's folder; run it on the folder that holds the client folders.`
    );
  }
  if (fiscalYearsFound === 0) {
    warnings.push("No fiscal year folder was found (a folder under a client folder whose name has a year, such as \"2025 - Mar 31\").");
  }
  if (distinctCompanies === 1 && relPaths.length >= 20) {
    warnings.push("Every file is under one client folder. If this folder holds more than one client, it may be the wrong level.");
  }
  return warnings;
}

/** Walk `root` and count. Reads files that are on this computer; never writes, moves or deletes one. */
export async function runDryRun(root: string, options: DryRunOptions): Promise<DryRunReport> {
  const platform = options.platform ?? process.platform;
  const warnings: string[] = [];
  let readText = options.readText;

  let isLocal = options.isLocal;
  if (!isLocal && platform === "win32") {
    options.onProgress?.("local", 0);
    const local = await (options.listLocalFiles ?? listLocalFilesWithPowerShell)(root);
    options.onProgress?.("local", 1);
    if (local === null) {
      isLocal = () => false;
      if (readText) {
        readText = false;
        warnings.push(
          "Text was not read: PowerShell could not tell which files are on this computer, and opening an online-only file would make OneDrive download it. File names and folders were still counted."
        );
      }
    } else isLocal = (absolutePath) => local.has(path.resolve(absolutePath).toLowerCase());
  }
  isLocal ??= blocksCheck;

  const files: DryRunReport["files"] = {
    seen: 0,
    linksSkipped: 0,
    foldersNotOpened: 0,
    filesNotOpened: 0,
    systemOrHidden: 0,
    looseTopLevel: 0,
    typeNotImported: 0,
    typeNotImportedByExtension: {},
    empty: 0,
    tooLarge: 0,
    pathRefused: 0,
    wouldImport: 0,
    onlineOnly: 0,
  };
  const candidates: Candidate[] = [];
  const walked = await walkFolder(
    root,
    async (absolutePath) => {
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
      // The upload route (convex/http.ts) refuses a file that is not in a client folder.
      if (relPath.split("/").length < 2) {
        files.looseTopLevel += 1;
        return;
      }
      const name = relPath.split("/").pop()!;
      if (!INGEST_EXTENSIONS.has(extensionOf(name))) {
        files.typeNotImported += 1;
        bump(files.typeNotImportedByExtension, extensionLabel(name));
        return;
      }
      let stat: Stats;
      try {
        stat = await fs.lstat(absolutePath);
      } catch {
        files.filesNotOpened += 1;
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
      const local = isLocal!(absolutePath, stat);
      if (local) files.wouldImport += 1;
      else files.onlineOnly += 1;
      candidates.push({ absolutePath, relPath, name, local });
    },
    { io: options.io, platform, onFolder: () => options.onProgress?.("walk", files.seen) }
  );
  files.linksSkipped = walked.links;
  files.foldersNotOpened = walked.foldersNotOpened;
  files.filesNotOpened += walked.entriesNotOpened;
  if (walked.folderError === "EACCES" || walked.folderError === "EPERM") {
    warnings.push(
      "Some folders could not be opened (no permission). On a Mac, give Terminal access to ~/Library/CloudStorage (System Settings, Privacy and Security, Files and Folders, or Full Disk Access) and run it again."
    );
  }

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
    byInitialsGroups: {},
  };
  const draftAndReviewNames = { total: 0, withVersion: 0 };
  const writerInitials: Counter = {};
  const reviewerInitials: Counter = {};
  const longVersionInitials = { firstGroup: {} as Counter, laterGroups: {} as Counter };
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
      const parsed = parsePdFilename(file.name);
      if (parsed === null) {
        finalPdNames.doesNotParse += 1;
        const pattern = namePattern(file.name);
        patterns.set(pattern, (patterns.get(pattern) ?? 0) + 1);
      } else finalPdNames.parses += 1;
      if (fields.versionCode !== undefined) finalPdNames.withVersion += 1;
      if (fields.writerInitials !== undefined) finalPdNames.withWriterInitials += 1;
      if (fields.reviewerInitials !== undefined) finalPdNames.withReviewerInitials += 1;
      if (fields.pdNumber !== undefined) finalPdNames.withPdNumber += 1;
      if (parsed?.fiscalYearEnd !== undefined) finalPdNames.withFiscalYearEnd += 1;
      const groups = versionInitialsGroups(file.name);
      bump(finalPdNames.byInitialsGroups, String(groups?.length ?? 0));
      if (groups && groups.length >= 3) {
        bump(longVersionInitials.firstGroup, groups[0]);
        for (const later of groups.slice(1)) bump(longVersionInitials.laterGroups, later);
      }
    } else if (category === "draft" || category === "review_copy") {
      draftAndReviewNames.total += 1;
      if (fields.versionCode !== undefined) draftAndReviewNames.withVersion += 1;
    }
    if (fields.writerInitials !== undefined) bump(writerInitials, fields.writerInitials);
    if (fields.reviewerInitials !== undefined) bump(reviewerInitials, fields.reviewerInitials);

    const takesWriter = takesInitialsWriter(fields);
    const nameCounts = category === "final_pd" ? writerNames.finalPd : writerNames.draftOrReview;
    if (takesWriter) nameCounts.withInitials += 1;

    if (!readText) continue;
    let fileText: string | undefined;
    if (file.local) {
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
    options.onProgress?.("read", done, candidates.length);
  }

  company.distinctCompanies = companies.size;
  company.companyYearGroups = companyYears.size;
  warnings.push(...levelWarnings(candidates.map((c) => c.relPath), fiscalYear.found, companies.size));
  if (readText) {
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
    readText,
    warnings,
    files,
    byCategory,
    company,
    fiscalYear,
    finalPdNames: { ...finalPdNames, byInitialsGroups: sortCounter(finalPdNames.byInitialsGroups) },
    draftAndReviewNames,
    writerInitials: sortCounter(writerInitials),
    reviewerInitials: sortCounter(reviewerInitials),
    longVersionInitials: {
      firstGroup: sortCounter(longVersionInitials.firstGroup),
      laterGroups: sortCounter(longVersionInitials.laterGroups),
    },
    writerNames: readText ? writerNames : null,
    text: readText ? text : null,
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
    "Nothing was sent anywhere and no file in the folder was changed. Online-only files were not opened.",
  ];
  for (const warning of report.warnings) lines.push(`Warning: ${warning}`);
  lines.push(
    "",
    "Files",
    `  seen: ${f.seen}`,
    `  would be imported, on this computer: ${f.wouldImport}`,
    `  would be imported, online only (not opened): ${f.onlineOnly}`,
    `  left out, not in a client folder: ${f.looseTopLevel}`,
    `  left out, system or hidden files: ${f.systemOrHidden}`,
    `  left out, file type not imported: ${f.typeNotImported} (${counterLine(f.typeNotImportedByExtension)})`,
    `  left out, empty: ${f.empty}`,
    `  left out, larger than 15 MB: ${f.tooLarge}`,
    `  left out, links (not followed): ${f.linksSkipped}`
  );
  if (f.pathRefused > 0) lines.push(`  left out, path not usable: ${f.pathRefused}`);
  if (f.filesNotOpened > 0) lines.push(`  files that could not be opened: ${f.filesNotOpened}`);
  if (f.foldersNotOpened > 0) lines.push(`  folders that could not be opened: ${f.foldersNotOpened}`);
  lines.push("", "By category (files that would be imported, on this computer or online only)");
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
    `  by initials groups in the version token (such as T1.AA.BB): ${counterLine(p.byInitialsGroups)} (0 means no version token)`,
    `  drafts and review copies: ${report.draftAndReviewNames.total}, with a version in the name: ${report.draftAndReviewNames.withVersion}`,
    "",
    "Initials in file names (initials only)",
    `  writer: ${counterLine(report.writerInitials)}`,
    `  reviewer: ${counterLine(report.reviewerInitials)}`,
    "  in final PD version tokens with 3 or more groups, which the scheme does not read yet:",
    `    first group: ${counterLine(report.longVersionInitials.firstGroup)}`,
    `    later groups: ${counterLine(report.longVersionInitials.laterGroups)}`,
    `  ${INITIALS_NOTE.replace("\n", " ")}`
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
        ? `  final PD text size in characters (${s.count} PDs): shortest ${s.min}, middle ${s.median}, 95 in 100 are at most ${s.p95}, longest ${s.max}`
        : "  final PD text size: no final PD text read",
      `  groups of files with the same text: ${t.sameTextGroups} (${t.filesInSameTextGroups} files)`,
      `  groups of files with the same bytes: ${t.sameBytesGroups} (${t.filesInSameBytesGroups} files)`
    );
  } else {
    lines.push("", "Text: not read");
  }
  lines.push("", `Final PD names that do not follow the scheme (${report.unparsedFinalPdPatternsTotal} patterns, up to 20 shown)`);
  if (report.unparsedFinalPdPatterns.length === 0) lines.push("  none");
  for (const { pattern, count } of report.unparsedFinalPdPatterns) lines.push(`  ${count} x ${pattern}`);
  lines.push(
    "  (each word is replaced: Word, word, WORD, WordWord, AA for short capitals; numbers longer than 2 digits become #, except years and dates; PD numbers, versions and scheme words such as PD, Final and R are kept)"
  );
  return `${lines.join("\n")}\n`;
}
