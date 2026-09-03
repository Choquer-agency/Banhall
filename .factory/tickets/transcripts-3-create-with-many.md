---
key: transcripts-3-create-with-many
status: todo
kind: feature
deps: [transcripts-2-generation-reads-all]
touches: [convex, src]
risky: []
verify: [npx vitest run convex/projects.test.ts convex/reviewFromProject.test.ts convex/generationAttribution.test.ts, npx vitest run --config vitest.component.config.ts --no-file-parallelism src/routes/project/new/newProjectTranscripts.component.test.ts src/routes/project/new/newProjectPrefill.component.test.ts]
done_when: ["! rg -q 'transcriptContent' convex/projects.ts src/routes", "rg -q 'transcripts: v.array' convex/projects.ts", "! rg -q '\\\\btranscriptId\\\\b' src/routes/project/new/+page.svelte src/routes/project/questionnaire/+page.svelte", "rg -Uq 'type=\\\"file\\\"[^>]*multiple' src/routes/project/new/+page.svelte", test -f src/routes/project/new/newProjectTranscripts.component.test.ts, "! rg -q 'transcriptId: v.optional' convex/generations.ts", "rg -qF 'targetTranscriptId: v.optional(v.id(\\\"transcripts\\\"))' convex/projectDuplication.ts", npx vitest run convex/projects.test.ts]
title: "New-project page takes an ordered list of transcripts (multi .docx upload, paste, remove, copy-by-reference); createProject stores them; generation no longer takes a transcript id"
plan: 20260903-client-sync
updated: "2026-09-03T21:17:39.897Z"
---
## Intent
Tracy attaches several `.docx` files at once, or one at a time, or pastes, sees them as an ordered list, removes one, and generates. `createProject` stores one row per transcript with its label and position. The duplicate wizard prefills every transcript of the source project as removable items that are copied server-side by reference, so no transcript text is downloaded to the browser and re-uploaded. `requestGeneration` drops `transcriptId` entirely. The maintainer inherits a list-shaped intake state that mirrors the context-document rows already on the page, and one copy helper shared with the review-from-project flow.

## Acceptance
- AC1: Given the Upload tab, when the user selects three `.docx` files in one chooser (or drops them), then three items appear in order with file name and word count, non-`.docx` files are rejected with the existing message, and the chooser can be reused to append more.
- AC2: Given the Paste tab, when the user adds pasted text, then an item labelled `Pasted transcript N` is appended and the textarea clears; the `#transcript` textarea id is kept so `newProjectPrefill.component.test.ts:86` still passes with the Home handoff seeding one item.
- AC3: Given a list of items, when the user clicks Remove on one, then it disappears and the remaining order is unchanged; with no items and no context documents the submit is blocked with the existing message.
- AC4: Given submit, when the project is created, then `createProject` is called with `transcripts: [...]` in list order (each item either `{ content, label }` or `{ fromTranscriptId, label }`), rows have `position` 0..N-1, `label`, `contentHash`, and `generateReport` is called with `{ projectId, ... }` and no `transcriptId`.
- AC5: Given `/project/new?from=<id>`, when the source has two transcripts, then both are prefilled as items from `listTranscripts` metadata (labels and word counts kept, no content fetched), each removable; on submit they are passed as `{ fromTranscriptId }` items and the server copies `content`, `label`, `contentHash` from the source rows; `copyProjectContent` receives `targetTranscriptId` of the first created row when there is one and omits it when there is none.
- AC6: `createProject` rejects more than 20 transcripts or more than `MAX_TOTAL_TRANSCRIPT_CHARS` combined with `INVALID_INPUT`, rejects a `fromTranscriptId` whose project the caller cannot read with `NOT_AUTHORIZED`, skips empty-content entries, and returns `{ projectId, transcriptIds }`; the questionnaire page passes one item labelled `Questionnaire answers`.

## Verification
- AC4 (backend), AC6 → `convex/projects.test.ts`: create with three content items, read rows through `api.transcripts.listTranscripts`; create with two `fromTranscriptId` items from a seeded source project and assert copied `content`/`contentHash`; create with 21 → error; over the chars cap → error; empty entries skipped; foreign `fromTranscriptId` → `NOT_AUTHORIZED`. Update `convex/reviewFromProject.test.ts:38` and any test calling `createProject` with `transcriptContent`.
- AC4 (no `transcriptId` on `requestGeneration`) → `convex/generationAttribution.test.ts:449` and `:1534` pass `transcriptId` to `requestGeneration` today; remove the arg at both sites (the fixture still inserts its own transcript row, which the project now picks up through the helper). `rg` predicates in `done_when`; `npm run check`.
- AC1, AC2, AC3, AC5 (client) → `src/routes/project/new/newProjectTranscripts.component.test.ts` (new, local-only): render the page like `newProjectPrefill.component.test.ts:19-30`; add items via the textarea path (file parsing needs real `.docx` bytes; use paste for list behaviour and a fixture `.docx` only if `mammoth` in the browser project handles it within the timeout); assert list rows, Remove, and prefill from `__setQueryData("transcripts:listTranscripts", [{ _id, label, wordCount, ... }])`. The convex stub's `useMutation` is a no-op (`src/lib/test/convex-svelte-stub.svelte.ts:125-127`); assert call args by extending the stub with a recorded-calls array if that is a small change, otherwise pin AC4 in the convex test only and say so in evidence.

## Implementation notes
- `src/routes/project/new/+page.svelte`: replace `transcript` (`:127`), `transcriptFileName` (`:229`) and the chip (`:1049-1071`) with `transcriptItems: { id, label, wordCount, source: { kind: "upload" | "paste", content } | { kind: "copy", fromTranscriptId } }[]` and `pasteDraft`. Input at `:1118-1128` gets `multiple`; handle `Array.from(files)` like `CategoryRow.svelte:191-201`; drop handler `:1079-1084` likewise. Keep `parseFileToText` and the 400 000 cap. Row list: copy the chip grammar of `CategoryRow.svelte:117-138` (`aria-label="Remove <name>"`), Button variants from `src/lib/components/ui/Button.svelte`, weight ≤ 500, design tokens only.
- Home handoff `:140-150` seeds one paste item (`transcriptText`, `transcriptFileName`); `projectIntentHandoff.ts` unchanged.
- Prefill `:185-189` → `api.transcripts.listTranscripts` (metadata only); effect `:210-215` seeds all items once as `copy` items, does not force the paste tab.
- Submit `:470-489`: `transcripts: transcriptItems.map(...)`; `:499-503` `targetTranscriptId: transcriptIds[0]`, omitted when the array is empty; `:655-668` drop `transcriptId`. `wordCount` `:302` and review row `:1237` become totals and a count of transcripts.
- `convex/projectDuplication.ts:83`: `targetTranscriptId: v.optional(v.id("transcripts"))`; the inner `copyProjectContentBetween` (`:37`) is already optional, so only the action's validator changes.
- `src/routes/project/questionnaire/+page.svelte:113-118`: `transcripts: [{ content, label: "Questionnaire answers" }]`, `generateReport({ projectId })`.
- `convex/lib/transcripts.ts`: add `insertTranscriptRow(ctx, { projectId, content, label, position })` (computes `contentHash`, drops empty) and `copyTranscriptRow(ctx, source, { projectId, position })`; `transcripts-4` reuses both in `reviewFromProject.ts` and `seed.ts`.
- `convex/projects.ts:578` `createProject`: arg `transcripts: v.array(v.union(v.object({ content: v.string(), label: v.optional(v.string()) }), v.object({ fromTranscriptId: v.id("transcripts"), label: v.optional(v.string()) })))`; for `fromTranscriptId` load the source row, check `getInternalProjectAccessOrNull` on its project, copy with `copyTranscriptRow`; insert content items with `insertTranscriptRow` and `label ?? "Interview transcript"`; enforce `MAX_TRANSCRIPTS_PER_PROJECT` and `MAX_TOTAL_TRANSCRIPT_CHARS` before any insert. Return `{ projectId, transcriptIds }`.
- `convex/generations.ts`: remove `transcriptId` from `requestGeneration` args; also remove it from the `runGenerate` calls in `PreviewProjectPage.svelte:783` and `CurrentProjectPage.svelte:623` (Convex validators reject unknown args, so the two calls must stop sending `transcriptId` in this ticket: change just those two lines here; the pages are otherwise migrated in `transcripts-5`).
- Design-system note: the 2026-08-14 amendment (`docs/design-system.md:1003`) constrains the Home composer, not the wizard; the wizard keeps its tablist as the "how to add the next item" chooser.

## Edge cases
- Same file selected twice: allowed as two items (user can remove one); label unchanged.
- A `.docx` that parses to empty text: rejected with a toast, not added.
- Paste tab with an empty draft: Add disabled.
- Review mode (`mode === "review"`): transcripts optional as today.
- Prefill arriving after the user already added items: skipped (`prefilled` flag).
- 21st item, or combined size over the cap: client blocks with a message (metadata `charCount` is enough to compute it); server also rejects.
- `fromTranscriptId` row deleted between prefill and submit: server skips it and the project is created with the remaining items.
