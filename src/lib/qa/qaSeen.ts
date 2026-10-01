/**
 * Browser-local "seen" state for a QA result (build brief: no backend work).
 * Key: `banhall_qa_seen:<generationId>:<postQaCompletedAt>`, so a re-run QA
 * pass (new completion time) is new again.
 *
 * - "unseen": the corner notice shows and the toggle carries the pink dot.
 * - "dismissed": the writer closed the notice (Later or close); the dot stays
 *   until QA is opened (ui-design-final.md section 7).
 * - "seen": QA was opened; no notice, no dot.
 *
 * Storage access is always guarded: private windows, blocked site data and
 * SSR have no usable localStorage, and a throwing accessor must never break
 * the report page. Without storage the state lives in memory for this tab.
 */
export type QaSeenState = "unseen" | "dismissed" | "seen";

export type QaSeenStorage = Pick<Storage, "getItem" | "setItem">;

const PREFIX = "banhall_qa_seen";
const memory = new Map<string, QaSeenState>();

export function qaSeenKey(generationId: string, postQaCompletedAt: number): string {
  return `${PREFIX}:${generationId}:${postQaCompletedAt}`;
}

function defaultStorage(): QaSeenStorage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

function resolveStorage(storage: QaSeenStorage | null | undefined): QaSeenStorage | null {
  return storage === undefined ? defaultStorage() : storage;
}

function parse(value: string | null | undefined): QaSeenState | null {
  return value === "seen" || value === "dismissed" ? value : null;
}

export function readQaSeen(
  generationId: string,
  postQaCompletedAt: number,
  storage?: QaSeenStorage | null
): QaSeenState {
  const key = qaSeenKey(generationId, postQaCompletedAt);
  const target = resolveStorage(storage);
  let stored: QaSeenState | null = null;
  if (target) {
    try {
      stored = parse(target.getItem(key));
    } catch {
      stored = null;
    }
  }
  const remembered = memory.get(key) ?? null;
  // "seen" outranks "dismissed" whichever layer holds it.
  if (stored === "seen" || remembered === "seen") return "seen";
  return stored ?? remembered ?? "unseen";
}

function write(key: string, value: QaSeenState, storage: QaSeenStorage | null | undefined) {
  memory.set(key, value);
  const target = resolveStorage(storage);
  if (!target) return;
  try {
    target.setItem(key, value);
  } catch {
    // Quota or blocked storage: the in-memory copy still covers this tab.
  }
}

/** The writer opened QA: clears the notice and the dot. */
export function markQaSeen(
  generationId: string,
  postQaCompletedAt: number,
  storage?: QaSeenStorage | null
): void {
  write(qaSeenKey(generationId, postQaCompletedAt), "seen", storage);
}

/** The writer closed the notice without opening QA. Never downgrades "seen". */
export function markQaDismissed(
  generationId: string,
  postQaCompletedAt: number,
  storage?: QaSeenStorage | null
): void {
  if (readQaSeen(generationId, postQaCompletedAt, storage) === "seen") return;
  write(qaSeenKey(generationId, postQaCompletedAt), "dismissed", storage);
}

/** Test seam: forget the in-memory fallback. */
export function __resetQaSeenMemory(): void {
  memory.clear();
}
