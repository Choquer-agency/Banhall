/**
 * Size limits on one report chat message (2026-10-19, chat parity Phase A).
 * Shared by the client and Convex so the composer's counter and the server's
 * check in `chatV2.sendMessage` cannot drift. Counted in JavaScript string
 * length (UTF-16 code units), the same measure the composer shows.
 */

/** The writer's own text in one message. */
export const MAX_CHAT_MESSAGE_CHARS = 20_000;

/** The report text a writer highlights and sends with a message. */
export const MAX_CHAT_HIGHLIGHT_CHARS = 12_000;

/**
 * Phase C (2026-10-20): project files a writer may pin to one message, so
 * the reply reads them in full. The picker and `chatV2.sendMessage` share it.
 */
export const CHAT_MAX_PINNED_FILES = 5;
