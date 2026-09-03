---
key: transcripts-2-generation-reads-all
status: todo
kind: feature
deps: [transcripts-1-model-and-list]
touches: [convex]
risky: [schema, provenance]
verify: [npx vitest run convex/generationInput.test.ts convex/generationRecovery.test.ts convex/generationAttribution.test.ts]
done_when: [test -f convex/generationInput.test.ts, "rg -q 'transcriptParts' convex/generations.ts", "rg -q 'mapClaimToPart|findQuoteInParts' convex/ai/pipeline.ts", "! rg -q 'transcript: Doc<\\\"transcripts\\\">' convex/generations.ts", "! rg -qF 'ctx.db.get(failed.transcriptId)' convex/generations.ts", npx vitest run convex/generationInput.test.ts]
title: Generation freezes and consumes every transcript of the project; claims cite the part they came from
plan: 20260903-client-sync
deferred: []
updated: "2026-09-03T21:17:39.897Z"
---
## Intent
Generation currently reads one transcript by id, slices it once and computes every claim offset against that single string. After this ticket `reserveGeneration` loads the project's transcripts through the helper, freezes one source row per transcript, records the set and `inputMode: "full"`, and `getGenerationInput` hands the pipeline prompt text plus the parts needed to cite claims per source row. A legacy project with one transcript produces byte-identical prompt text and citations to today. `requestGeneration.transcriptId` becomes optional and ignored so stale clients keep working until `transcripts-3` removes it.

## Acceptance
- AC1: Given a project with one transcript, when a generation is reserved, then `input.transcript` equals that transcript's content (sliced at 500 000 as today), `generation.transcriptId` is its id, `transcriptIds` is `[id]`, `inputMode` is `full`.
- AC2: Given three transcripts with positions 0..2, when reserved, then three `generationSources` rows of kind `transcript` exist in that order with per-row `contentHash`, `truncated`, `originalLength`; `input.transcript` is the headered join; `input.transcriptParts` has three entries `{ sourceId, contentHash, content, label }`.
- AC3: Given zero transcripts and at least one readable context document, when reserved, then the generation is created with `transcriptId` absent, `transcriptIds: []`, and `getGenerationInput` returns `transcript: ""` and `transcriptParts: []` instead of `null`; given zero transcripts and no documents, then `INVALID_INPUT` as today (`generations.ts:375-378`). This is the ticket that relaxes `generations.transcriptId` from `v.id("transcripts")` to `v.optional(...)` in `convex/schema.ts:602`, because it is the ticket that removes the two readers that dereference it (`generations.ts:544`, `:580`); `npx tsc -p convex/tsconfig.json --noEmit` is green at the end of this ticket.
- AC4: Given a claim whose `sourceQuote` occurs only in the second part, when the candidate completes, then its citation carries the second part's `generationSourceId`, `sourceContentHash` and an offset within that part; `createProvenance` accepts it (byte check at `reports.ts:103-114`).
- AC5: `retryGeneration` and `retryFailedCandidates` re-freeze from the project's current transcripts and no longer read `failed.transcriptId`; `requestGeneration` accepts a missing `transcriptId` and, when one is given, only checks it belongs to the project.
- AC6: Progress log first line reads `Read N frozen interview transcripts — W words.` (singular wording for N = 1 unchanged from today) or the no-transcript line.

## Verification
- AC1, AC2, AC3, AC5 → `convex/generationInput.test.ts` (new): reserve via `api.generations.requestGeneration` with a stubbed provider config if needed (see how `convex/generationRecovery.test.ts` reserves), then read `internal.generations.getGenerationInput` through `t.run`/`t.query` and the `generationSources` rows.
- AC4 → unit test of the mapping function extracted from `pipeline.ts:650-679` (pure: `mapClaimToPart(parts, claim)`), placed in `convex/lib/transcripts.ts` next to `findQuoteInParts`, covered in `convex/transcripts.test.ts` or the new file. This mapping decides every citation's `generationSourceId`, `sourceContentHash` and `startOffset`, hence `risky: [provenance]`; a wrong mapping silently marks claims unsupported.
- AC3 (schema) → `npx tsc -p convex/tsconfig.json --noEmit`; the `done_when` predicate on `ctx.db.get(failed.transcriptId)`.
- AC6 → `convex/ai/pipeline.ts:451-456` and `convex/ai/iterative.ts:115-119` share one `describeTranscriptInput(parts)` helper; unit case.
- Existing suites `generationRecovery`, `generationAttribution`, `chatContext*`, `dashboard`, `reaper*`, `sanitizationBoundary` keep passing (they seed `generations.transcriptId` directly).

## Implementation notes
- `convex/generations.ts:341-493`: signature `reserveGeneration(ctx, project, requestedBy, lengthTarget, candidateMode, singleModelId, compareModelIds, retryOfGenerationId?, retryModelIds?, seededCandidates?)`. Inside: `const transcripts = await listProjectTranscripts(ctx, project._id)`; the empty check at `:368-380` becomes `transcripts.length === 0`. Insert `transcriptId: transcripts[0]?._id`, `transcriptIds`, `inputMode: "full"` (the digest decision arrives in `transcripts-7`; keep `decideInputMode` out of this ticket). Loop `:445-457` per transcript with `label: transcript.label`.
- `convex/schema.ts:602`: `transcriptId: v.optional(v.id("transcripts"))` with the comment `// 2026-09-03 widen: absent when the project has no transcript (docs-only generation)`. The other schema widening already landed in `transcripts-1`; this is the only schema line this ticket touches.
- `requestGeneration` (`:495-532`): `transcriptId: v.optional(v.id("transcripts"))`; if present, `TRANSCRIPT_PROJECT_MISMATCH` when it does not belong. Retries (`:534-558`, `:562-700`) drop the `ctx.db.get(failed.transcriptId)` and `ctx.db.get(generation.transcriptId)` lines; `:133`, `:191`, `:801` read `generation.transcriptId` as optional.
- `getGenerationInput` (`:782-827`): `.take(51)` → `.take(MAX_TRANSCRIPTS_PER_PROJECT + 51)`; select `kind === "transcript"` rows (digest selection comes in `transcripts-7`); build `transcriptParts` and `transcript = buildTranscriptPromptText(parts)`. Keep `transcriptId`, drop `transcriptSourceId`/`transcriptContentHash` after the pipeline stops reading them.
- `convex/ai/pipeline.ts:650-679`: map each claim with `findQuoteInParts`; `provenanceDrafts` (`:195-202`) keeps filtering on `transcript.includes(quote)`; the prompt text includes headers, so a quote spanning a header cannot match a part and becomes `unsupported`, which is correct. `createProvenance` call `:680-689` keeps `sourceTranscriptId: input.transcriptId` (lists come in `transcripts-6`).
- `convex/ai/iterative.ts:75`, `:115-119`: same input shape; analyzer receives `input.transcript`.
- Do not touch `reports.ts`, `snapshots`, UI, or `createProject`.

## Edge cases
- A transcript over 500 000 chars: still sliced per row; `truncated: true` on that row only.
- Duplicate quote in two parts: first part wins (deterministic).
- Transcript deleted between reserve and run: the frozen source rows carry the text; nothing re-reads the table after reserve.
- Concurrent reserve: unchanged `GENERATION_ACTIVE` guard `:393-396`.
- Regeneration after a transcript is added: new set frozen; old generations keep their rows.
