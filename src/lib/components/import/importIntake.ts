/**
 * Adding files on the Import page (2026-11-12, Paper Files 1 to 3): what a
 * drop or Add files brings in, which files are left out and why, the words
 * of the dark bar while files are dragged over the page, the one status
 * line under the toolbar and the History rows. Pure: no Svelte, no Convex
 * client. The page sends the files with importUploads.svelte.ts.
 *
 * The type and size rules are the upload route's own (convex/http.ts reads
 * them from convex/lib/ingestionClassify.ts, as this does), and the junk
 * rule is the one the server checks again when it stages a file.
 */
import type { FunctionReturnType } from "convex/server";
import type { api } from "../../../../convex/_generated/api";
import {
  extensionOf,
  fiscalYearOfLabel,
  INGEST_EXTENSIONS,
  isJunkPath,
  MAX_FILE_BYTES,
  sanitizeRelPath,
} from "../../../../convex/lib/ingestionClassify";
import { formatCount, plural } from "./importFormat";

/** One file to add, with its path relative to what was dropped or picked ("Halden Foods/2025/Submitted/PD.docx"). */
export type IntakeFile = { file: File; path: string };

/** Why a file was left out of a drop. */
export type LeftOutReason = "junk" | "type" | "size" | "empty";

/** Whether a file goes in, or why it is left out: junk first, then empty, type and size. */
export function intakeVerdict(path: string, size: number): "add" | LeftOutReason {
  if (isJunkPath(path)) return "junk";
  if (size <= 0) return "empty";
  const name = path.split("/").pop() ?? path;
  if (!INGEST_EXTENSIONS.has(extensionOf(name))) return "type";
  if (size > MAX_FILE_BYTES) return "size";
  return "add";
}

export type SortedIntake = { add: IntakeFile[]; leftOut: Record<LeftOutReason, number> };

/**
 * Paths the way the server reads them: the first folder is the company and
 * the next one the fiscal year ("Halden Foods/2025 - Mar 31/..."). A
 * dropped or picked folder is either one company's folder or a folder that
 * holds company folders (the one the uploader is pointed at). Each dropped
 * folder is read on its own, by where its fiscal year folders sit (a folder
 * whose name gives a year, read as classify reads one):
 * - one level below it ("Halden Foods/2025 - Mar 31/..."): it is the
 *   company, and its paths stay as they are;
 * - two levels below it ("Clients/Halden Foods/2025 - Mar 31/..."): it
 *   holds companies, and its own name is taken off every path under it;
 * - at both levels: the level with more of them wins, and a tie keeps the
 *   paths as they are;
 * - at neither: the paths stay as they are.
 * Loose files (in no folder) stay as they are.
 */
export function companyFolderPaths(files: readonly IntakeFile[]): IntakeFile[] {
  const isYear = (name: string | undefined) => name !== undefined && fiscalYearOfLabel(name) !== undefined;
  // For each dropped folder: its fiscal year folders, and its company folders (those with fiscal year folders in them).
  const years = new Map<string, Set<string>>();
  const companies = new Map<string, Set<string>>();
  const note = (map: Map<string, Set<string>>, top: string, folder: string) => {
    const set = map.get(top) ?? new Set<string>();
    set.add(folder);
    map.set(top, set);
  };
  for (const { path } of files) {
    const [top, first, second] = path.split("/").slice(0, -1);
    if (first === undefined) continue;
    if (isYear(first)) note(years, top, first);
    else if (isYear(second)) note(companies, top, first);
  }
  const holders = new Set(
    [...companies].filter(([top, held]) => held.size > (years.get(top)?.size ?? 0)).map(([top]) => top)
  );
  if (holders.size === 0) return [...files];
  return files.map((entry) => {
    const [top, ...rest] = entry.path.split("/");
    return rest.length > 0 && holders.has(top) ? { file: entry.file, path: rest.join("/") } : entry;
  });
}

/**
 * The files a drop or a pick brings in, each path cleaned the way the server
 * cleans it and read for the company folders (companyFolderPaths), with how
 * many were left out for each reason. A path the server would refuse
 * outright (nothing safe left) counts as junk. Two files with one path both
 * go in: only their bytes can tell whether they are one file, and the
 * sender skips the same bytes twice (importUploads.svelte.ts).
 */
export function sortIntake(files: readonly IntakeFile[]): SortedIntake {
  const leftOut: Record<LeftOutReason, number> = { junk: 0, type: 0, size: 0, empty: 0 };
  const cleaned: IntakeFile[] = [];
  for (const entry of files) {
    const path = sanitizeRelPath(entry.path);
    if (!path || isJunkPath(path)) {
      leftOut.junk += 1;
      continue;
    }
    cleaned.push({ file: entry.file, path });
  }
  const add: IntakeFile[] = [];
  for (const entry of companyFolderPaths(cleaned)) {
    const verdict = intakeVerdict(entry.path, entry.file.size);
    if (verdict !== "add") {
      leftOut[verdict] += 1;
      continue;
    }
    add.push(entry);
  }
  return { add, leftOut };
}

/**
 * "3 files were left out: 2 are not a type Banhall reads, 1 is over 15 MB."
 * Junk (hidden and system files, Office lock files) is left out without a
 * word: nobody meant to add it. Null when nothing worth saying was left out.
 */
export function leftOutText(leftOut: Record<LeftOutReason, number>): string | null {
  const parts: string[] = [];
  if (leftOut.type > 0) parts.push(`${formatCount(leftOut.type)} ${leftOut.type === 1 ? "is not a type" : "are not a type"} Banhall reads`);
  if (leftOut.size > 0) parts.push(`${formatCount(leftOut.size)} ${leftOut.size === 1 ? "is" : "are"} over 15 MB`);
  if (leftOut.empty > 0) parts.push(`${formatCount(leftOut.empty)} ${leftOut.empty === 1 ? "is" : "are"} empty`);
  const count = leftOut.type + leftOut.size + leftOut.empty;
  if (count === 0) return null;
  return `${plural(count, "file")} ${count === 1 ? "was" : "were"} left out: ${parts.join(", ")}.`;
}

/** A file picked with a file input: a folder pick gives each file its path inside the folder. */
export function filesFromInput(list: FileList | readonly File[] | null): IntakeFile[] {
  return [...(list ?? [])].map((file) => ({ file, path: file.webkitRelativePath || file.name }));
}

// ─── A drop: walking folders ────────────────────────────────────────────────

/** The entry API's pieces this needs (webkitGetAsEntry), so tests can hand in their own. */
export type DropEntry = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath: string;
  file?: (success: (file: File) => void, failure?: (error: unknown) => void) => void;
  createReader?: () => { readEntries: (success: (entries: DropEntry[]) => void, failure?: (error: unknown) => void) => void };
};

/** The entries a drop carries. Call it while the drop event runs: the browser empties them after. */
export function dropEntries(transfer: DataTransfer | null): DropEntry[] {
  if (!transfer) return [];
  const entries: DropEntry[] = [];
  for (const item of [...transfer.items]) {
    if (item.kind !== "file") continue;
    const entry = item.webkitGetAsEntry?.() as DropEntry | null | undefined;
    if (entry) entries.push(entry);
  }
  // No entry API: the plain files, with no folders.
  if (entries.length === 0 && transfer.files.length > 0) {
    return [...transfer.files].map((file) => ({ isFile: true, isDirectory: false, name: file.name, fullPath: `/${file.name}`, file: (ok: (file: File) => void) => ok(file) }));
  }
  return entries;
}

function readAll(entry: DropEntry): Promise<DropEntry[]> {
  const reader = entry.createReader?.();
  if (!reader) return Promise.resolve([]);
  const all: DropEntry[] = [];
  return new Promise((resolve) => {
    // readEntries gives up to 100 at a time: read until it gives none.
    const next = () =>
      reader.readEntries(
        (batch) => {
          if (batch.length === 0) resolve(all);
          else {
            all.push(...batch);
            next();
          }
        },
        () => resolve(all)
      );
    next();
  });
}

function fileOf(entry: DropEntry): Promise<File | null> {
  return new Promise((resolve) => {
    if (!entry.file) resolve(null);
    else entry.file(resolve, () => resolve(null));
  });
}

/**
 * Every file under the dropped entries, each with its path relative to what
 * was dropped: a dropped folder's own name is the path's first part, as it
 * is for a picked folder, so "Halden Foods/2025/..." reads as the company
 * and fiscal year (sortIntake then takes off the name of a folder that
 * holds company folders, companyFolderPaths). Hidden folders are not
 * walked. A folder that cannot be read is skipped. Yields to the page
 * between folders, so a big folder never freezes it.
 */
export async function walkDrop(entries: readonly DropEntry[]): Promise<IntakeFile[]> {
  const files: IntakeFile[] = [];
  const queue = [...entries];
  while (queue.length > 0) {
    const entry = queue.shift()!;
    if (entry.name.startsWith(".")) continue;
    if (entry.isDirectory) {
      queue.push(...(await readAll(entry)));
      await new Promise((resolve) => setTimeout(resolve, 0));
      continue;
    }
    if (!entry.isFile) continue;
    const file = await fileOf(entry);
    if (file) files.push({ file, path: entry.fullPath.replace(/^\/+/, "") || entry.name });
  }
  return files;
}

// ─── While files are dragged over the page ──────────────────────────────────

/** MIME types of the files Banhall reads. */
const READ_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "application/pdf",
  "text/plain",
  "text/vtt",
]);

/** Whether a drag carries files (not text or a link). */
export function dragHasFiles(transfer: DataTransfer | null): boolean {
  return Boolean(transfer && [...transfer.types].includes("Files"));
}

/**
 * How many files a drag will add, when the browser lets the page tell:
 * while dragging, a folder cannot be opened, and it looks like a file with
 * no type. So the files are counted only when every one has a type Banhall
 * reads; otherwise null.
 */
export function dragFileCount(transfer: DataTransfer | null): number | null {
  if (!transfer) return null;
  const items = [...transfer.items].filter((item) => item.kind === "file");
  if (items.length === 0) return null;
  return items.every((item) => READ_TYPES.has(item.type)) ? items.length : null;
}

/** The dark bar's first words: "Drop to add 64 files", or "Drop to add these files" when they cannot be counted. */
export function dropBarText(count: number | null): string {
  return count === null ? "Drop to add these files" : `Drop to add ${plural(count, "file")}`;
}

/** The dark bar's second half (Paper Files 1). */
export const DROP_BAR_NOTE = "Banhall sorts them by company, category and fiscal year";

// ─── The status line under the toolbar ──────────────────────────────────────

export type ActivityBatch = NonNullable<FunctionReturnType<typeof api.ingestion.importActivity>>[number];

/** What this browser tab is doing with a drop or Add files (importUploads.svelte.ts). */
export type LocalSending = {
  batchId: string | null;
  phase: "checking" | "sending" | "done";
  /** Files being checked (hashed and looked up). */
  checking: number;
  checked: number;
  /** Files to send, after leaving out those already here. */
  toSend: number;
  sent: number;
  /**
   * Files this tab could not send, and can try again: every batch's, not only
   * `batchId`'s, since "Try again" sends them all (each into its own batch).
   */
  failed: number;
};

/** A batch whose files stopped arriving this long ago is not running any more. */
export const RUNNING_GAP_MS = 2 * 60_000;
/** A page batch still "sending" after this long was left (its tab closed). */
export const ABANDONED_MS = 10 * 60_000;
/** A batch whose files are all read keeps its line this long, then it goes. */
export const DONE_LINGER_MS = 90_000;
/** A batch read for longer than this with files still unread is not shown any more. */
const STALE_MS = 6 * 60 * 60_000;

export type StatusLine = { text: string; retry: boolean };

function readSoFar(batch: Pick<ActivityBatch, "added" | "read">): string {
  return batch.read >= batch.added ? "All read." : `${formatCount(batch.read)} read so far.`;
}

function fullyRead(batch: ActivityBatch): boolean {
  return batch.sendingDone && batch.read >= batch.added;
}

/** Whether a batch is done long enough ago that its line has gone. */
function gone(batch: ActivityBatch, now: number): boolean {
  if (fullyRead(batch)) return now - Math.max(batch.lastFileAt, batch.lastReadAt ?? 0) > DONE_LINGER_MS;
  return now - Math.max(batch.lastFileAt, batch.lastReadAt ?? 0) > STALE_MS;
}

/**
 * "52 files added, 12 were already here. 31 read so far." for the signed-in
 * admin's own batch, with "Sending 64 files. 20 sent so far." while it is
 * still being sent, and how many could not be sent.
 */
function ownLine(batch: ActivityBatch, local: LocalSending | null, now: number): StatusLine | null {
  const failed = local && local.batchId === batch._id ? local.failed : batch.failed;
  const retry = Boolean(local && local.batchId === batch._id && local.phase === "done" && local.failed > 0);
  if (!batch.sendingDone && now - batch.lastFileAt <= ABANDONED_MS) {
    return { text: `Sending ${plural(batch.toSend ?? batch.added, "file")}. ${formatCount(batch.added)} sent so far.`, retry: false };
  }
  if (gone(batch, now) && !retry) return null;
  const parts: string[] = [];
  if (batch.added === 0 && batch.alreadyHere > 0) {
    parts.push(`No new files. ${plural(batch.alreadyHere, "file")} ${batch.alreadyHere === 1 ? "was" : "were"} already here.`);
  } else {
    const here = batch.alreadyHere > 0 ? `, ${formatCount(batch.alreadyHere)} ${batch.alreadyHere === 1 ? "was" : "were"} already here` : "";
    parts.push(`${plural(batch.added, "file")} added${here}.`);
    if (batch.added > 0) parts.push(readSoFar(batch));
  }
  if (failed > 0) parts.push(`${formatCount(failed)} could not be sent.`);
  return { text: parts.join(" "), retry };
}

/** "Sam Okafor is uploading 412 files. 180 here so far." while another admin's batch is coming in. */
function othersLine(batch: ActivityBatch, now: number): StatusLine | null {
  const who = batch.addedByName ?? "Another admin";
  if (!batch.sendingDone) {
    if (now - batch.lastFileAt > ABANDONED_MS) return null;
    return { text: `${who} is uploading ${plural(batch.toSend ?? batch.added, "file")}. ${formatCount(batch.added)} here so far.`, retry: false };
  }
  if (batch.added === 0 || gone(batch, now)) return null;
  return { text: `${who} added ${plural(batch.added, "file")}. ${readSoFar(batch)}`, retry: false };
}

/**
 * "The uploader is sending files. 180 here so far." The uploader says neither
 * who sends nor how many, so the line says only what has arrived.
 */
function feederLine(batch: ActivityBatch, now: number): StatusLine | null {
  const running = now - batch.lastFileAt <= RUNNING_GAP_MS;
  const name = batch.source === "uploader" ? "The uploader" : "OneDrive";
  if (running) {
    const doing = batch.source === "uploader" ? "is sending files" : "is syncing";
    return { text: `${name} ${doing}. ${formatCount(batch.added)} here so far.`, retry: false };
  }
  if (batch.added === 0 || gone(batch, now)) return null;
  const did = batch.source === "uploader" ? `${name} sent ${plural(batch.added, "file")}` : `OneDrive added ${plural(batch.added, "file")}`;
  return { text: `${did}. ${readSoFar(batch)}`, retry: false };
}

/**
 * The one line under the toolbar (Paper Files 2 and 3), or null for none.
 * This tab's own check and send come first, then the admin's own latest
 * batch, then another admin's, then the uploader's or a OneDrive sync's.
 * Plain words, no progress bar; a batch's line goes a short while after its
 * files are all read.
 */
export function statusLine(local: LocalSending | null, batches: readonly ActivityBatch[], now: number): StatusLine | null {
  if (local?.phase === "checking") {
    return { text: `Checking ${plural(local.checking, "file")}. ${formatCount(local.checked)} checked so far.`, retry: false };
  }
  if (local?.phase === "sending") {
    return { text: `Sending ${plural(local.toSend, "file")}. ${formatCount(local.sent)} sent so far.`, retry: false };
  }
  const order = (batch: ActivityBatch) =>
    local?.batchId === batch._id ? 0 : batch.mine && batch.source === "page" ? 1 : batch.source === "page" ? 2 : 3;
  const sorted = [...batches].sort((a, b) => order(a) - order(b) || b.lastFileAt - a.lastFileAt);
  for (const batch of sorted) {
    const line =
      batch.source !== "page" ? feederLine(batch, now) : batch.mine ? ownLine(batch, local, now) : othersLine(batch, now);
    if (line) return line;
  }
  return null;
}

// ─── What a screen reader hears of the status line ──────────────────────────

/** A new sentence is spoken this soon after it shows, so a quick run of changes is heard once. */
export const SPOKEN_SOON_MS = 150;
/** A count changing on its own is spoken at most this often. */
export const SPOKEN_COUNT_PACE_MS = 60_000;

/** The status line's words with its numbers taken out: what changes when the sentence does. */
function sentenceOf(text: string): string {
  return text.replace(/\d[\d,]*/g, "#");
}

/**
 * When the spoken copy of the status line should next take the words on
 * screen, or null when it already says them. The status line's counts move
 * with every file, and a screen reader would read each one out. So a new
 * sentence ("Sending 64 files." after "Checking 64 files.", or "All read.")
 * is spoken soon, and a count that changes on its own is spoken at most once
 * a minute. `said` and `saidAt`: the words last spoken, and when.
 */
export function spokenDueAt(said: string, saidAt: number, next: string, now: number): number | null {
  if (next === said) return null;
  if (sentenceOf(next) !== sentenceOf(said)) return now + SPOKEN_SOON_MS;
  return Math.max(now + SPOKEN_SOON_MS, saidAt + SPOKEN_COUNT_PACE_MS);
}

// ─── History ────────────────────────────────────────────────────────────────

export type HistoryRow = FunctionReturnType<typeof api.ingestion.importHistory>["page"][number];

/** How a batch came. */
export const HOW_IT_CAME: Record<HistoryRow["source"], string> = {
  page: "Added on this page",
  uploader: "The uploader",
  onedrive: "OneDrive sync",
};

/** Who added a batch: the uploader sends no name. */
export function historyWho(row: Pick<HistoryRow, "who" | "source">): string {
  if (row.who) return row.who;
  return row.source === "uploader" ? "Not recorded" : "Not known";
}

/** "Nov 12, 2:14 PM", or with the year when it is not this year's. */
export function historyWhen(at: number, now: number = Date.now()): string {
  const date = new Date(at);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
  });
}

/** A count cell: the number, or "Not counted" where nothing counted it (an old sync run). */
export function historyCount(count: number | null): string {
  return count === null ? "Not counted" : formatCount(count);
}

/** Rows History lists at first, and how many more "Show more" asks for. */
export const HISTORY_PAGE = 25;
