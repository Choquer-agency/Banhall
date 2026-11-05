/**
 * Download original (2026-11-04): one file is saved as itself, several as
 * one zip. jszip and file-saver load only when a download starts. Files
 * with no stored original are left out and counted. A download takes at
 * most 200 files and 500 MB of originals, fetched four at a time, and lets
 * go of every original once it is saved.
 */
export type DownloadableFile = { fileName: string; url: string | null; bytes?: number | null };

export const MAX_DOWNLOAD_FILES = 200;
export const MAX_DOWNLOAD_BYTES = 500 * 1024 * 1024;
export const DOWNLOAD_CONCURRENCY = 4;
export const TOO_MUCH_MESSAGE = "Too much to download at once. Select fewer files.";

export class NoOriginalsError extends Error {
  constructor() {
    super("These files have no original to download.");
    this.name = "NoOriginalsError";
  }
}

/** Over the file count or the size budget: refused before (or while) fetching. */
export class TooMuchToDownloadError extends Error {
  constructor() {
    super(TOO_MUCH_MESSAGE);
    this.name = "TooMuchToDownloadError";
  }
}

async function fetchBlob(url: string, signal: AbortSignal): Promise<Blob> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error("The original could not be downloaded.");
  return await response.blob();
}

/** "a.pdf", "a.pdf" becomes "a.pdf", "a (2).pdf", so no entry in the zip replaces another. */
export function uniqueNames(names: readonly string[]): string[] {
  const used = new Set<string>();
  return names.map((name) => {
    if (!used.has(name.toLowerCase())) {
      used.add(name.toLowerCase());
      return name;
    }
    const dot = name.lastIndexOf(".");
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : "";
    for (let n = 2; ; n++) {
      const candidate = `${stem} (${n})${ext}`;
      if (!used.has(candidate.toLowerCase())) {
        used.add(candidate.toLowerCase());
        return candidate;
      }
    }
  });
}

/**
 * Runs `work` on every item, at most `limit` at a time, in order of start.
 * The first failure stops new work (`signal`) and is thrown once running
 * work settles.
 */
export async function eachLimited<T>(
  items: readonly T[],
  limit: number,
  work: (item: T, index: number, signal: AbortSignal) => Promise<void>
): Promise<void> {
  const controller = new AbortController();
  let next = 0;
  let failure: unknown = null;
  const lane = async () => {
    while (next < items.length && !controller.signal.aborted) {
      const index = next++;
      try {
        await work(items[index]!, index, controller.signal);
      } catch (error) {
        if (failure === null) failure = error;
        controller.abort();
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  if (failure !== null) throw failure;
}

/**
 * Saves the originals: one as itself, several as `<zipName>.zip`. Returns
 * how many were left out for having no original. Throws
 * TooMuchToDownloadError past 200 files or 500 MB (known sizes first, then
 * what was actually fetched).
 */
export async function downloadOriginals(
  files: readonly DownloadableFile[],
  zipName: string,
  limits: { maxFiles?: number; maxBytes?: number; concurrency?: number } = {}
): Promise<{ skipped: number }> {
  const maxFiles = limits.maxFiles ?? MAX_DOWNLOAD_FILES;
  const maxBytes = limits.maxBytes ?? MAX_DOWNLOAD_BYTES;
  const withUrl = files.filter((file): file is DownloadableFile & { url: string } => Boolean(file.url));
  if (withUrl.length === 0) throw new NoOriginalsError();
  if (withUrl.length > maxFiles) throw new TooMuchToDownloadError();
  if (withUrl.reduce((total, file) => total + (file.bytes ?? 0), 0) > maxBytes) throw new TooMuchToDownloadError();
  const { saveAs } = await import("file-saver");
  if (withUrl.length === 1) {
    const [only] = withUrl;
    const blob = await fetchBlob(only!.url, new AbortController().signal);
    if (blob.size > maxBytes) throw new TooMuchToDownloadError();
    saveAs(blob, only!.fileName);
    return { skipped: files.length - 1 };
  }
  const { default: JSZip } = await import("jszip");
  let zip: InstanceType<typeof JSZip> | null = new JSZip();
  const names = uniqueNames(withUrl.map((file) => file.fileName));
  let fetched = 0;
  try {
    await eachLimited(withUrl, limits.concurrency ?? DOWNLOAD_CONCURRENCY, async (file, index, signal) => {
      const blob = await fetchBlob(file.url, signal);
      fetched += blob.size;
      if (fetched > maxBytes) throw new TooMuchToDownloadError();
      zip?.file(names[index]!, blob);
    });
    saveAs(await zip.generateAsync({ type: "blob" }), `${zipName}.zip`);
  } finally {
    // The zip holds every original until it is dropped.
    zip = null;
  }
  return { skipped: files.length - withUrl.length };
}
