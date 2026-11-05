/**
 * The company summary's limits (2026-11-04, docs/product-domain.md "The
 * company profile"), shared by the server, the AI draft and the card.
 */

/** The most characters a person's summary may hold. */
export const MAX_COMPANY_SUMMARY_CHARS = 1_000;
/** The most characters of the website text the AI draft reads (its opening). */
export const COMPANY_SUMMARY_INPUT_CHARS = 16_000;
/** The most characters a drafted summary keeps. */
export const MAX_DRAFTED_SUMMARY_CHARS = 600;
