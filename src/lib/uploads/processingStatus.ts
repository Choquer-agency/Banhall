import {
  SUPPORTED_LABEL,
  type ReceiptStatus,
} from "../../../shared/documentStatus";

/**
 * PSOS-04: every word the receipt shows a user about a file's outcome.
 *
 * This is the third of three structural defences that keep provider and
 * internal error text away from users. The first two are that no client sends a
 * message and no schema field can store one; this one is that every string a
 * user reads is written here, in advance, by a person. No component
 * interpolates a caught error, and a test asserts none of these strings looks
 * like one.
 *
 * Copy is deliberately plain: the reader is a low-tech user who wants to know
 * whether their file will be used and what to do if not.
 */

/**
 * Which affordances the row actually renders. Advice that names a button the
 * user cannot see is worse than no advice, so the copy is told what exists.
 */
export type ActionFlags = { canRetry: boolean; canReplace: boolean };

export type StatusCopy = {
  /** Shown in the badge, always as text — colour is never the only signal. */
  label: string;
  /** What happened, in the user's terms. */
  explanation: string;
  /**
   * What to do about it. `null` where nothing is needed. Two statuses vary:
   * `upload_failed`, because after a reload the bytes are gone and "try again"
   * is advice the user cannot act on; and `could_not_read`, because the live
   * chat receipt offers no Replace button for a file it already stored.
   */
  action: string | ((flags: ActionFlags) => string) | null;
};

export const PROCESSING_STATUS_COPY: Record<ReceiptStatus, StatusCopy> = {
  ready: {
    label: "Ready for AI",
    explanation: "Text was read from this file.",
    action: null,
  },
  ready_truncated: {
    label: "Ready — text truncated",
    explanation:
      "This file was too long to read completely, so only the first part was captured. Anything after the cut-off won't be used when the report is written or reviewed.",
    action:
      "If the later pages matter, split the file and upload that section on its own.",
  },
  reference_only: {
    label: "Reference only",
    explanation:
      "Images are kept for people to open and download. No text is read from them, so the assistant can't use what they show.",
    action:
      "If the content matters to the report, describe it in the chat or upload a text version.",
  },
  could_not_read: {
    label: "Could not read",
    explanation:
      "No readable text was found in this file. It's saved in the project, but the assistant can't use its contents.",
    action: ({ canReplace }) =>
      canReplace
        ? 'This usually means a scan or a photo of a page. Use "Replace file…" with a text-based version, or paste the text into the chat.'
        : "This usually means a scan or a photo of a page. Upload a text-based version, or paste the text into the chat.",
  },
  skipped_unsupported: {
    label: "Skipped — unsupported type",
    explanation:
      "This file type can't be read, so nothing was added to the project.",
    action: `Supported: ${SUPPORTED_LABEL}. Convert the file, or paste the text into the chat.`,
  },
  upload_failed: {
    label: "Upload failed",
    explanation: "This file didn't reach the project — nothing was saved.",
    action: ({ canRetry }) =>
      canRetry
        ? "Check your connection and try again."
        : 'Use "Replace file…" to choose it again and upload it.',
  },
};

/** Shown while a file is still being read. */
export const LOADING_COPY = {
  label: "Reading…",
} as const;

/**
 * The noun each status contributes to the one-line batch summary
 * ("6 files: 4 ready, 1 reference only, 1 failed"). Adjectival, so counts read
 * naturally without pluralising them.
 *
 * Lives here rather than in the row builder so that every word a user reads
 * still comes from this one module — including the banned-substring test.
 */
export const SUMMARY_CLAUSE: Record<ReceiptStatus, string> = {
  ready: "ready",
  // Its own clause, never folded into "ready": the summary must not contradict
  // the badge that exists to flag the cut-off.
  ready_truncated: "truncated",
  reference_only: "reference only",
  could_not_read: "unreadable",
  skipped_unsupported: "skipped",
  upload_failed: "failed",
};

/** Summary clause for rows still being read. */
export const SUMMARY_LOADING_CLAUSE = "still reading";

/** Shown when a replacement dedupes into the row it was meant to replace. */
export const REPLACE_UNCHANGED_COPY =
  "That file is identical to the one already saved, so nothing was changed.";

/**
 * Shown when the attempts query reports no access. Distinct from the empty
 * state on purpose: "nothing here" and "you may not see what is here" are
 * different facts, and conflating them hides a permissions problem.
 */
export const DENIED_COPY = {
  label: "No access",
  explanation: "You don't have permission to view this project's files.",
} as const;

export function statusLabel(status: ReceiptStatus | null): string {
  return status === null ? LOADING_COPY.label : PROCESSING_STATUS_COPY[status].label;
}

export function statusAction(
  status: ReceiptStatus,
  flags: ActionFlags
): string | null {
  const { action } = PROCESSING_STATUS_COPY[status];
  return typeof action === "function" ? action(flags) : action;
}
