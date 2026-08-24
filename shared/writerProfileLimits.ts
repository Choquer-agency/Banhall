/**
 * Maximum length of a writer's personal report-writing instructions.
 * Shared by the client and Convex so counters and server validation cannot drift.
 */
// 75,000 (bumped 2026-08-24 on writer request; was 60,000).
export const MAX_INSTRUCTIONS_CHARS = 75_000;
