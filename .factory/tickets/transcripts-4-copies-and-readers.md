---
key: transcripts-4-copies-and-readers
status: todo
kind: feature
deps: [transcripts-3-create-with-many]
touches: [convex]
risky: []
verify: [npx vitest run convex/reviewFromProject.test.ts convex/projects.test.ts convex/reportAuthz.test.ts]
done_when: ["! rg -qF 'query(\\\"transcripts\\\")' convex/reviewFromProject.ts convex/pdReviews.ts", "test \\\"$(rg -cF 'query(\\\"transcripts\\\")' convex/projects.ts)\\\" = 1", "test \\\"$(rg -cF 'query(\\\"transcripts\\\")' convex/debugTools.ts)\\\" = 1", "rg -q 'transcriptIds' convex/reviewFromProject.ts", "rg -q 'copyTranscriptRow' convex/reviewFromProject.ts", "rg -q 'position' convex/seed.ts", npx vitest run convex/reviewFromProject.test.ts]
title: "Review-from-project copies every transcript; review input, science-code context, debug tools and seed read the list"
plan: 20260903-client-sync
updated: "2026-09-03T21:17:39.898Z"
---
## Intent
BNH-39 "review an existing PD from a project" must carry all transcripts of the source, and every remaining backend reader of the single row must see the set. After this ticket the only direct `transcripts` queries outside `convex/lib/transcripts.ts` are the two that are not "a project's transcripts": `deleteProject`'s cascade (`convex/projects.ts:1056`, must also delete empty placeholder rows the helper drops) and the admin orphan scan (`convex/debugTools.ts:201`, whole-table `collect()`), plus ingestion's placeholder writer, which is out of scope. The `done_when` count predicates pin exactly one remaining call in each of those two files. Note: `rg` treats `(` as a group, so the predicates use `-F`; a plain `rg 'query("transcripts")'` never matches the literal.

## Acceptance
- AC1: Given a source project with two transcripts (positions 0 and 1, labels A and B), when `createReviewFromProject` runs, then the review project has two rows with the same labels, positions, content and `contentHash`, and the returned record carries `transcriptIds` in order; `copyProjectContentBetween` receives the first id as `targetTranscriptId`.
- AC2: Given a source project with no transcripts, when the review project is created, then it has no transcript rows (no empty placeholder) and the review still starts.
- AC3: `pdReviews.getReviewInput` returns the headered join of all transcripts (`buildTranscriptPromptText`), empty string when none.
- AC4: `projects.getScienceCodeSuggestionContext` returns the same join (the caller's 80 000 slice at `scienceCodeSuggestions.ts:29-38` still applies).
- AC5: `debugTools` reports `transcriptCount` and total chars instead of the first row's length; orphan detection unchanged.
- AC6: `seed.ts` inserts its transcript with `label`, `position: 0`, `contentHash`.

## Verification
- AC1, AC2 → `convex/reviewFromProject.test.ts:105-153` extended: seed two rows, assert both copied in order; a second case with zero rows.
- AC3 → new case in `convex/reviewFromProject.test.ts` or `convex/pdReviews.test.ts` if it exists, reading `internal.pdReviews.getReviewInput` via `t.run`.
- AC4, AC5 → `convex/projects.test.ts` cases via `t.run` on the internal queries.
- AC6 → `rg -n position convex/seed.ts`; `npm test`.

## Implementation notes
- `convex/reviewFromProject.ts:87-90`, `:163-167`: loop over `listProjectTranscripts(ctx, source._id)` and insert with `copyTranscriptRow` from `convex/lib/transcripts.ts` (added in `transcripts-3`); `returns` validator adds `transcriptIds: v.array(v.id("transcripts"))` and `transcriptId` becomes optional (first). `:234-253`: pass `targetTranscriptId: created.transcriptIds[0]` (already optional on `copyProjectContentBetween`, `projectDuplication.ts:37`).
- `convex/pdReviews.ts:256-267`, `convex/projects.ts:550-576` (`getScienceCodeSuggestionContext`): use the helper and `buildTranscriptPromptText`.
- `convex/debugTools.ts:45-55`: helper for the per-project read; `:201-209` orphan scan keeps its `collect()` (admin debug only).
- `convex/seed.ts:91-95`: `insertTranscriptRow` (sets `label`, `position: 0`, `contentHash`).
- `convex/projects.ts:841-843` keeps stamping `sourceTranscriptId` from `targetTranscriptId`; lists are added in `transcripts-6`.
- Do not touch UI or `convex/transcripts.ts`.

## Edge cases
- Source transcript over the 20 cap (cannot happen after `transcripts-3`; legacy data could): copy at most 20 in order and log nothing (the helper caps).
- Source row with empty content: not copied (helper drops it).
- Copy runs twice (action retry): the mutation is a single transaction; a second run creates a second review project, same as today.
