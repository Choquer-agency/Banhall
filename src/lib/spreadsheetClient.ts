import { isSpreadsheetResponse, type SpreadsheetProgress } from "./spreadsheetProtocol";

const ACTIVE_PARSE_TIMEOUT_MS = 120_000;

export interface SpreadsheetParseOptions {
  signal?: AbortSignal;
  onProgress?: (progress: SpreadsheetProgress) => void;
}

export function isParseAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function aborted(): DOMException {
  return new DOMException("Spreadsheet extraction canceled", "AbortError");
}

// One workbook at a time across upload surfaces. Queued files retain their File,
// not a second in-memory ArrayBuffer. Abort removes a waiter immediately.
let active = false;
const waiting: Array<() => void> = [];
function acquire(signal?: AbortSignal): Promise<() => void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(aborted()); return; }
    const cancel = () => {
      const index = waiting.indexOf(start);
      if (index >= 0) waiting.splice(index, 1);
      reject(aborted());
    };
    const start = () => {
      signal?.removeEventListener("abort", cancel);
      active = true;
      resolve(() => {
        const next = waiting.shift();
        if (next) next();
        else active = false;
      });
    };
    if (!active) start();
    else {
      waiting.push(start);
      signal?.addEventListener("abort", cancel, { once: true });
    }
  });
}

export async function parseSpreadsheet(file: File, options: SpreadsheetParseOptions = {}): Promise<string> {
  const { signal, onProgress } = options;
  if (signal?.aborted) throw aborted();
  onProgress?.({ kind: "queued" });
  const release = await acquire(signal);
  try {
    if (signal?.aborted) throw aborted();
    // Node tests exercise the same conversion. A browser must never fall back
    // to synchronous parsing when workers are unavailable or fail to load.
    if (typeof window === "undefined") {
      const { spreadsheetText } = await import("./spreadsheetText");
      const buffer = await file.arrayBuffer();
      if (signal?.aborted) throw aborted();
      return spreadsheetText(buffer, onProgress);
    }
    return await new Promise<string>((resolve, reject) => {
      let worker: Worker | undefined;
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", cancel);
        worker?.terminate();
      };
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const cancel = () => fail(aborted());
      signal?.addEventListener("abort", cancel, { once: true });
      if (signal?.aborted) { cancel(); return; }
      timer = setTimeout(() => fail(new Error("Spreadsheet extraction timed out. Try a smaller workbook.")), ACTIVE_PARSE_TIMEOUT_MS);
      try {
        worker = new Worker(new URL("./spreadsheet.worker.ts", import.meta.url), { type: "module" });
        worker.onerror = event => { event.preventDefault(); fail(new Error(event.message || "Spreadsheet worker failed")); };
        worker.onmessageerror = () => fail(new Error("Invalid spreadsheet worker message"));
        worker.onmessage = (event: MessageEvent<unknown>) => {
          if (settled) return;
          if (!isSpreadsheetResponse(event.data)) { fail(new Error("Invalid spreadsheet worker response")); return; }
          const response = event.data;
          switch (response.kind) {
            case "progress":
              try { onProgress?.(response.progress); } catch (error) { fail(error); }
              break;
            case "error": fail(new Error(response.message)); break;
            case "complete":
              settled = true;
              cleanup();
              resolve(response.content);
              break;
          }
        };
        const target = worker;
        void file.arrayBuffer().then(buffer => {
          if (settled) return;
          target.postMessage(buffer, [buffer]);
        }).catch(fail);
      } catch (error) { fail(error); }
    });
  } finally { release(); }
}
