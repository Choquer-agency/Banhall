/**
 * Report chat parity, Phase B (2026-10-20), W2: the "reply ready" signal.
 * The Assistant panel is lazy-mounted, so this lives at page level and reads
 * `chatV2.reportChatActivity`:
 * - a working ring on the Assistant launcher while any reply on the report
 *   runs;
 * - a dot when one of your replies finished after you last had the panel
 *   open ("seen" is kept per report in localStorage);
 * - the tab title prefix "Reply ready - " while the tab is hidden, removed
 *   when you come back;
 * - an optional browser notification, opted into from the panel's menu,
 *   fired only while the tab is hidden, with generic text only (never any
 *   client or report text).
 */
import { useQuery } from "convex-svelte";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

export const REPLY_READY_TITLE_PREFIX = "Reply ready - ";
export const REPLY_NOTIFICATION_TITLE = "Banhall";
export const REPLY_NOTIFICATION_BODY = "Your reply is ready.";
export const NOTIFY_REPLIES_KEY = "banhall.chat.notifyReplies";
const SEEN_KEY_PREFIX = "banhall.chat.replySeen.";
/**
 * A finished link of a long job is followed by the next one within a moment;
 * the signal waits this long and fires only if none of your replies runs.
 */
export const REPLY_SETTLE_MS = 2_000;

/** What the Assistant launcher shows: a working ring, a ready dot, or nothing. */
export type AssistantSignal = "working" | "ready" | null;

export function seenKey(reportId: string): string {
  return `${SEEN_KEY_PREFIX}${reportId}`;
}

export function readSeen(reportId: string): number | null {
  try {
    const raw = localStorage.getItem(seenKey(reportId));
    const value = raw === null ? NaN : Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeSeen(reportId: string, finishedAt: number): void {
  try {
    localStorage.setItem(seenKey(reportId), String(finishedAt));
  } catch {
    /* storage unavailable: the dot just shows again next time */
  }
}

/** Whether this browser can show notifications at all. */
export function notificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

/** The writer opted in, and the browser still allows it. */
export function notifyRepliesEnabled(): boolean {
  if (!notificationsSupported()) return false;
  try {
    return localStorage.getItem(NOTIFY_REPLIES_KEY) === "1" && Notification.permission === "granted";
  } catch {
    return false;
  }
}

/**
 * Turn the notification on (asking the browser's permission) or off.
 * Returns whether it is on afterwards: a refused permission leaves it off.
 */
export async function setNotifyReplies(on: boolean): Promise<boolean> {
  if (!on || !notificationsSupported()) {
    try {
      localStorage.removeItem(NOTIFY_REPLIES_KEY);
    } catch {
      /* ignore */
    }
    return false;
  }
  let permission = Notification.permission;
  if (permission === "default") {
    try {
      permission = await Notification.requestPermission();
    } catch {
      permission = "denied";
    }
  }
  const granted = permission === "granted";
  try {
    if (granted) localStorage.setItem(NOTIFY_REPLIES_KEY, "1");
    else localStorage.removeItem(NOTIFY_REPLIES_KEY);
  } catch {
    /* ignore */
  }
  return granted;
}

export function addTitlePrefix(doc: Document = document): void {
  if (!doc.title.startsWith(REPLY_READY_TITLE_PREFIX)) doc.title = `${REPLY_READY_TITLE_PREFIX}${doc.title}`;
}

export function removeTitlePrefix(doc: Document = document): void {
  if (doc.title.startsWith(REPLY_READY_TITLE_PREFIX)) doc.title = doc.title.slice(REPLY_READY_TITLE_PREFIX.length);
}

/** The launcher's state from the activity and what was last seen. */
export function assistantSignal(args: {
  active: boolean;
  mineActive: boolean;
  mineLastFinishedAt: number | null;
  seen: number | null;
  panelOpen: boolean;
}): AssistantSignal {
  if (args.active) return "working";
  if (args.panelOpen || args.mineLastFinishedAt === null || args.seen === null) return null;
  return args.mineLastFinishedAt > args.seen ? "ready" : null;
}

/**
 * Page-level reply signal. Call during component setup. `panelOpen` is
 * whether the Assistant panel is on screen now.
 */
export function useReplySignal(read: () => { reportId: Id<"reports"> | null | undefined; panelOpen: boolean }) {
  const activityQ = useQuery(api.chatV2.reportChatActivity, () => {
    const { reportId } = read();
    return reportId ? { reportId } : "skip";
  });
  // Review R2 P3-7a: everything below belongs to one report. When the page
  // shows another report, `seen`, the last finish this page watched and a
  // pending title timer all start over, so one report's timestamps never
  // signal on another.
  let seen = $state<number | null>(null);
  let seenFor = $state<string | null>(null);
  let lastFinished: number | null | undefined;
  let watchedFor: string | null = null;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;

  /** The activity, only once it is the current report's own answer. */
  const current = () => {
    const { reportId } = read();
    const data = activityQ.data;
    return reportId && data && !activityQ.isStale ? { reportId, data } : null;
  };

  // Load what was seen for this report; with nothing stored, today's newest
  // reply counts as seen, so an old reply never shows a dot.
  $effect(() => {
    const { reportId, panelOpen } = read();
    if (seenFor !== (reportId ?? null)) {
      seenFor = reportId ?? null;
      seen = null;
    }
    const now = current();
    if (!now) return;
    const finished = now.data.mineLastFinishedAt;
    if (seen === null) {
      const stored = readSeen(now.reportId);
      seen = stored ?? finished ?? 0;
      if (stored === null) writeSeen(now.reportId, seen);
    }
    if (panelOpen && finished !== null && finished > seen) {
      seen = finished;
      writeSeen(now.reportId, finished);
    }
  });

  // The tab title and the notification: only for a reply that finished while
  // this page watched this report, and only once none of yours still runs.
  $effect(() => {
    const reportId = read().reportId ?? null;
    if (watchedFor !== reportId) {
      watchedFor = reportId;
      lastFinished = undefined;
      clearTimeout(settleTimer);
    }
    const now = current();
    if (!now) return;
    const finished = now.data.mineLastFinishedAt;
    const previous = lastFinished;
    lastFinished = finished;
    if (previous === undefined || finished === null || (previous !== null && finished <= previous)) return;
    clearTimeout(settleTimer);
    const firedFor = now.reportId;
    settleTimer = setTimeout(() => {
      const later = current();
      if (!later || later.reportId !== firedFor || later.data.mineActive) return;
      if (typeof document === "undefined" || document.visibilityState !== "hidden") return;
      addTitlePrefix();
      if (notifyRepliesEnabled()) {
        try {
          new Notification(REPLY_NOTIFICATION_TITLE, { body: REPLY_NOTIFICATION_BODY });
        } catch {
          /* a browser that refuses is not an error the writer needs */
        }
      }
    }, REPLY_SETTLE_MS);
  });

  $effect(() => {
    if (typeof document === "undefined") return;
    const restore = () => {
      if (document.visibilityState === "visible") removeTitlePrefix();
    };
    document.addEventListener("visibilitychange", restore);
    window.addEventListener("focus", restore);
    return () => {
      clearTimeout(settleTimer);
      document.removeEventListener("visibilitychange", restore);
      window.removeEventListener("focus", restore);
      removeTitlePrefix();
    };
  });

  return {
    get signal(): AssistantSignal {
      const now = current();
      if (!now || seenFor !== now.reportId) return null;
      return assistantSignal({ ...now.data, seen, panelOpen: read().panelOpen });
    },
  };
}
