function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Domain error code (convex/lib/contracts.ts) carried by a ConvexError, if any. */
export function userErrorCode(error: unknown): string | null {
  const data = userErrorData(error);
  return data && typeof data.code === "string" ? data.code : null;
}

/**
 * The structured data a domain error carries (`{ code, message, ... }`),
 * from the ConvexError itself or, when only its text survives, from the
 * "Uncaught ConvexError: {...}" line the Convex client writes.
 */
export function userErrorData(error: unknown): Record<string, unknown> | null {
  if (isRecord(error) && isRecord(error.data) && typeof error.data.code === "string") {
    return error.data;
  }
  if (error instanceof Error) {
    const marker = "Uncaught ConvexError: ";
    const markerIndex = error.message.indexOf(marker);
    if (markerIndex >= 0) {
      const payload = error.message.slice(markerIndex + marker.length).split("\n", 1)[0];
      try {
        const parsed: unknown = JSON.parse(payload);
        if (isRecord(parsed) && typeof parsed.code === "string") return parsed;
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * Domain refusals the pages that trigger them already explain in their own
 * UI: F6's "already running" callout and the project page's inline start
 * error (GENERATION_ACTIVE), and the refresh prompts for a stale revision
 * (STALE_REVISION, BRIEF_STALE). They are expected, not crashes.
 */
export const HANDLED_REFUSAL_CODES: ReadonlySet<string> = new Set([
  "GENERATION_ACTIVE",
  "STALE_REVISION",
  "BRIEF_STALE",
  // Decision 65, stage 2: a run or review asked for while the new project
  // is still being set up from its intake draft; the page says so plainly.
  "PROJECT_SETTING_UP",
  // Decision 65, stage 2: a private intake draft that ended, the day's
  // draft cap and a draft's text caps; New project says so in plain words.
  "INTAKE_DRAFT_GONE",
  "INTAKE_DRAFT_LIMIT",
  "INTAKE_TEXT_LIMIT",
  // Audit wave 2: a per-user or per-project limit on a paid AI action. The
  // page that started it shows the server's message (with the wait) inline.
  "RATE_LIMITED",
  // 2026-10-14 saved clients: a client name that already exists. New client
  // shows the server's message inline next to the name.
  "CLIENT_EXISTS",
  // Chat parity Phase A (2026-10-19): report chat refusals. The composer
  // explains each in plain words on the unsent message, with Retry.
  "CHAT_TURN_ACTIVE",
  "CHAT_SPEND_BUDGET_EXCEEDED",
  "CHAT_QUEUE_LIMIT_EXCEEDED",
  "CHAT_MESSAGE_TOO_LONG",
  // Chat parity Phase B: an Undo whose passage changed after the apply. The
  // card says so in its own error slot and points to Version history.
  "PROPOSAL_UNDO_CONFLICT",
]);

/**
 * True for the Convex client's own log line about a function that failed
 * with a handled refusal ("[CONVEX M(generations:requestGeneration)] ...
 * Uncaught ConvexError: {"code":"GENERATION_ACTIVE",...}"). The client logs
 * every failed call before the caller's catch runs, so ErrorMonitor uses this
 * to keep an expected refusal from raising the crash toast. Any other failure,
 * including a refusal with another code, is not one.
 */
export function isHandledRefusalLog(line: string): boolean {
  const call = /^\[CONVEX [QMA?]\(([^)]*)\)\]/.exec(line);
  if (!call) return false;
  const code = userErrorCode(new Error(line));
  if (code === null) return false;
  return HANDLED_REFUSAL_CODES.has(code) || HANDLED_REFUSAL_FUNCTIONS.has(call[1]);
}

/**
 * Functions whose every domain refusal (any `code`) the caller explains in
 * its own UI. Chat parity Phase A: Stop (`chatV2.abortStreaming`) says
 * "The reply could not be stopped" in the panel, so a refused Stop is not a
 * crash. A failure with no domain code still raises the toast.
 */
export const HANDLED_REFUSAL_FUNCTIONS: ReadonlySet<string> = new Set([
  "chatV2:abortStreaming",
  // Chat parity Phase B: Undo on a card and the web search switch say what
  // went wrong where it happened.
  "chatV2:undoProposal",
  "chatV2:setThreadWebSearch",
]);

/** The `reason` detail a domain error carries (for example "DRAFT_COMPLETE"), if any. */
export function userErrorReason(error: unknown): string | null {
  if (isRecord(error) && isRecord(error.data) && typeof error.data.reason === "string") {
    return error.data.reason;
  }
  return null;
}

export function userErrorMessage(error: unknown, fallback: string): string {
  if (isRecord(error) && isRecord(error.data) && typeof error.data.message === "string") {
    return error.data.message;
  }
  if (!(error instanceof Error)) return fallback;
  const marker = "Uncaught ConvexError: ";
  const markerIndex = error.message.indexOf(marker);
  if (markerIndex >= 0) {
    const payload = error.message.slice(markerIndex + marker.length).split("\n", 1)[0];
    try {
      const parsed: unknown = JSON.parse(payload);
      if (isRecord(parsed) && typeof parsed.message === "string") return parsed.message;
    } catch {
      return fallback;
    }
  }
  if (error.message.startsWith("[CONVEX ") || error.message === "Server Error") return fallback;
  return error.message || fallback;
}
