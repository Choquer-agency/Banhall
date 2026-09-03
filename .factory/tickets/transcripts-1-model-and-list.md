---
key: transcripts-1-model-and-list
status: todo
kind: feature
deps: []
touches: [convex, docs]
risky: [schema]
verify: [npx vitest run convex/transcripts.test.ts]
done_when: [test -f convex/lib/transcripts.ts, test -f convex/transcripts.test.ts, "rg -q 'transcriptDigests: defineTable' convex/schema.ts", "rg -q 'by_transcriptId_and_sourceContentHash_and_condenseVersion' convex/schema.ts", "rg -q 'export const listTranscripts' convex/transcripts.ts", "rg -q 'export const getTranscriptContent' convex/transcripts.ts", "rg -q 'transcript_digest' convex/schema.ts", "rg -q 'Multiple transcripts per project' docs/product-domain.md", npx vitest run convex/transcripts.test.ts]
title: "Widen the schema for N transcripts, digests and provenance sets; one read helper, a metadata list query and a content query; domain amendment"
plan: 20260903-client-sync
updated: "2026-09-03T21:17:39.896Z"
---
## Intent
Tracy needs several transcripts on one project and a two-hour transcript must not blow the model's window. This ticket lays the data structures every later transcripts ticket builds on, all additive: labelled, ordered transcript rows; a digest table keyed by transcript content and condense version; the generation's set of transcripts and its input mode; digest source rows; list fields beside every `sourceTranscriptId`. It also defines, in one helper, what "a project's transcripts" means, and splits the client read into a light metadata list and a per-transcript content query so the project page never subscribes to megabytes of text. The domain amendment lands here so no code relies on the new contract before it is recorded.

## Acceptance
- AC1: Given rows inserted with `position` 2, 0, 1 for one project, when `listTranscripts` runs, then they come back in position order as metadata `{ _id, label, position, createdAt, charCount, wordCount, contentHash? }` with no `content` field; given legacy rows without `position` or `label`, then they come back in `createdAt` order with label `Interview transcript`.
- AC2: Given a legacy row with empty `content`, when `listTranscripts` runs, then it is not returned.
- AC3: Given a caller without internal access, when `listTranscripts` runs, then it returns `[]`, and `getTranscriptContent({ transcriptId })` returns `null` (same silent-null policy as `getTranscript` today, `convex/transcripts.ts:8`); given a caller with access, `getTranscriptContent` returns `{ _id, label, content }`.
- AC4: `convex/schema.ts` has: `transcripts.label?`, `position?`, `contentHash?`; new `transcriptDigests` table with indexes `by_transcriptId_and_sourceContentHash_and_condenseVersion` and `by_projectId`; `generations.transcriptIds?`, `inputMode?` (`full | digest`), `digestIds?` (the `generations.transcriptId` required to optional change is NOT in this ticket; it lands in `transcripts-2` with the readers that stop dereferencing it); `generationSources.kind` admits `transcript_digest` and `digestId?`; `sourceTranscriptIds?` on `reports`, `reportSnapshots`, `reportProvenance`; `digestIds?` on `reportProvenance`. `npx tsc -p convex/tsconfig.json --noEmit` passes with no other file changed except comments.
- AC5: `docs/product-domain.md` gains a 2026-09-03 amendment "Multiple transcripts per project" covering cardinality (zero or more, ordered, labelled, immutable text, at most 20 rows and at most `MAX_TOTAL_TRANSCRIPT_CHARS` combined), the digest artifact and its key `(transcriptId, sourceContentHash, condenseVersion)`, the provenance shape (single id = first transcript kept for old readers; lists alongside), the widen-only status, tests, and approval.
- AC6: `getTranscript` still exists and now returns the first element of the helper's list (so callers see no change until they migrate in `transcripts-5`).

## Verification
- AC1, AC2, AC3, AC6 → `convex/transcripts.test.ts` (new, convex-test; seed pattern from `convex/generationRecovery.test.ts:311-331`, identities from `convex/workspaceRollout.test.ts` `setup()`).
- AC4 → `npx tsc -p convex/tsconfig.json --noEmit`; `npm test` (existing suites keep inserting `generations` with `transcriptId`, which stays valid and required here).
- AC5 → `rg -n "Multiple transcripts per project" docs/product-domain.md`.

## Implementation notes
- `convex/lib/transcripts.ts` (default runtime): `MAX_TRANSCRIPTS_PER_PROJECT = 20`; `MAX_TOTAL_TRANSCRIPT_CHARS = 2_000_000` (keeps `reserveGeneration`'s frozen source rows under Convex's per-transaction write limit; writers enforce it in `transcripts-3`); `CONDENSE_VERSION = "1"` (bumped by hand when the condense prompt, schema or size constants change; `transcripts-7` reads it); `listProjectTranscripts(ctx, projectId)` = `withIndex("by_projectId").take(MAX + 1)`, drop `!content.trim()`, sort by `(position ?? Infinity, createdAt)`, map `label ?? "Interview transcript"`, return full docs (server-side callers need content); `transcriptLabel(doc)`; `transcriptMetadata(doc)` → the AC1 shape with `charCount = content.length` and `wordCount` from `split(/\s+/)`. Also export pure `buildTranscriptPromptText(parts: { label, content }[])` (one part → `content` unchanged; N parts → `=== Transcript ${i+1}: ${label} ===\n${content}` joined by two newlines) and `findQuoteInParts(parts, quote)` returning `{ partIndex, startOffset } | null` (first part containing it). These two are used by `transcripts-2`; write their unit cases now in `convex/transcripts.test.ts`.
- `convex/transcripts.ts`: `listTranscripts` query `{ projectId }` → metadata array (no content); `getTranscriptContent` query `{ transcriptId }` → `{ _id, label, content } | null`, access checked through the transcript's `projectId` with `getInternalProjectAccessOrNull`; `getTranscript` delegates to the helper's first element. No `"use node"`.
- Schema comments name the phase: `// 2026-09-03 widen: multiple transcripts per project`. Everything in this ticket is additive; do not relax `generations.transcriptId` here (`convex/generations.ts:544` and `:580` dereference it and would not type-check).
- `transcriptDigests` row: `transcriptId, projectId, sourceContentHash, condenseVersion, content, structured, model, promptVersion, charCount, originalLength, createdAt`.
- Amendment: shape from `docs/product-domain.md:876-892`, with a Tests bullet listing `convex/transcripts.test.ts` and the tests the later tickets add. Cite migration rule `:226`, D7 `:220`, narrow rule `:247`.
- Do NOT change writers, generation, UI or ingestion in this ticket.

## Edge cases
- Two rows with the same `position`: tie-break by `createdAt`, then `_id`.
- More than 20 rows: helper returns the first 20 by order and the amendment states the cap; writers enforce both caps in `transcripts-3`.
- Whitespace-only content: treated as empty, dropped.
- `getTranscriptContent` with an id from another project the caller cannot read: `null`, never a throw.
- Cross-project id passed to nothing else here; the helper is project-scoped by index.
