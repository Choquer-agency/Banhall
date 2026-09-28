/**
 * The underline rule moved to shared/exactQuote.ts (2026-09-27, third
 * amendment) so the Seed contract on the server checks quotes with the same
 * rule the card draws; re-exported unchanged.
 */
export { MIN_QUOTE_WORDS, findExactQuoteSpans, segmentBullet, type ExactQuoteSpan } from "../../../../shared/exactQuote";
