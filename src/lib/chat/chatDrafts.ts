/**
 * Unsent composer drafts and the last conversation used (Phase A, task 9).
 *
 * Drafts can hold client text, so they live in `sessionStorage`: they survive
 * a conversation switch and a reload, and go when the tab closes. The last
 * conversation is only a thread id. Every read and write tolerates storage
 * that is missing, full or blocked; a draft is a convenience, never a reason
 * for the panel to fail.
 */
const DRAFT_PREFIX = "banhall.chat.draft.";
const LAST_THREAD_PREFIX = "banhall.chat.lastThread.";

function sessionStore(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** Storage key for one report's conversation ("thread:<id>" or "draft:<id>"). */
export function draftKey(reportId: string, scope: string): string {
  return `${DRAFT_PREFIX}${reportId}.${scope}`;
}

export function readDraft(key: string): string {
  try {
    return sessionStore()?.getItem(key) ?? "";
  } catch {
    return "";
  }
}

/** Save a draft, or forget it when it is only whitespace. */
export function writeDraft(key: string, text: string): void {
  try {
    const store = sessionStore();
    if (!store) return;
    if (text.trim()) store.setItem(key, text);
    else store.removeItem(key);
  } catch {
    /* storage full or blocked: keep the draft in memory only */
  }
}

export function clearDraft(key: string): void {
  writeDraft(key, "");
}

export function readLastThread(reportId: string): string | null {
  try {
    return sessionStore()?.getItem(`${LAST_THREAD_PREFIX}${reportId}`) ?? null;
  } catch {
    return null;
  }
}

export function writeLastThread(reportId: string, threadId: string): void {
  try {
    sessionStore()?.setItem(`${LAST_THREAD_PREFIX}${reportId}`, threadId);
  } catch {
    /* ignore */
  }
}
