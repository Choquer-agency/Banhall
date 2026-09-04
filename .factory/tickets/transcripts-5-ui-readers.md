---
key: transcripts-5-ui-readers
status: todo
kind: feature
deps: [transcripts-3-create-with-many]
touches: [src, convex]
risky: []
verify: ["npx vitest run --config vitest.component.config.ts --no-file-parallelism src/lib/components/project/PreviewProjectIntake.component.test.ts 'src/routes/project/[id]/currentProjectTranscripts.component.test.ts'"]
done_when: ["! rg -q 'getTranscript\\\\b' convex/ src/ --glob '!convex/_generated/**'", "rg -q 'listTranscripts' src/lib/components/editor/FilesPanel.svelte src/lib/components/project/PreviewProjectPage.svelte src/lib/components/project/CurrentProjectPage.svelte", "rg -q 'getTranscriptContent' src/lib/components/editor/FilesPanel.svelte src/lib/components/project/PreviewProjectPage.svelte src/lib/components/project/CurrentProjectPage.svelte", npm run check]
deferred: ["8 component tests fail in Button, WorkspaceChrome, WorkspaceHeader, WorkspaceRail and workspaceRoutes. Verified pre-existing: the same five files fail identically at baseline f5d1cd9 with this diff removed. Untouched by this ticket.", "The Draft-generation gate accepts a whitespace-only document where the backend rejects it: the client reads listDocuments sizeChars > 0 (content.length) and reserveGeneration reads content.trim() (convex/generations.ts:375). The button appears and the mutation answers with the readable-text message. Publishing a trimmed count from the metadata was not in scope.", "docs/product-domain.md:1543 still describes the transcript authorization policy in terms of 'the getTranscript query they extend' and ':1547' says 'access policy on all three queries'; getTranscript is deleted. Left alone: it is a dated amendment record and docs are outside this ticket's touches [src, convex].", "The transcript label is used verbatim as the download file name (`<label>.txt`), per AC1, so a transcript labelled `kickoff.docx` downloads as `kickoff.docx.txt`. Stripping a known extension was not in scope.", "Closing every transcript disclosure (choice `null`) survives Previous/Next project paging, so the next project opens with its transcripts collapsed. The finding-1 fix resolves only an id the loaded list does not carry; an explicit \"nothing open\" is left as a choice.", "The paging branch of the list-resolved transcript choice in `CurrentProjectPage.svelte:96-111` (a chosen id the newly loaded list does not carry) has no component test. `src/routes/project/[id]/currentProjectTranscripts.component.test.ts` now mounts that chrome and covers the stacked rows, the default open row, the one-body rule and the hide rule, but not a list swap under a mounted component. Same expression as `PreviewProjectPage.svelte:120-135`, which is covered."]
title: Files panel and both project pages list every transcript and load one body at a time; getTranscript deleted
plan: 20260903-client-sync
updated: "2026-09-03T21:17:39.898Z"
---
## Intent
Writers open a project and see each transcript by name, with its word count, preview and download, in both the preview workspace and the `?workspace=current` chrome. The list comes from `listTranscripts` (metadata only) and a body is fetched with `getTranscriptContent` only for the transcript being read, so a project with many transcripts costs one subscription of a few hundred bytes per row instead of megabytes per component. The last four readers of `getTranscript` move, and `getTranscript` is deleted in the same wave. The maintainer inherits two queries for transcripts, one light and one per item.

## Acceptance
- AC1: Given a project with two transcripts, when the files panel renders, then there are two "Interview transcript" rows labelled with each transcript's label, each with word count (from metadata), a preview that loads that transcript's body through `getTranscriptContent` when opened, and a download named `<label>.txt` that fetches the body once through the Convex client on click; with zero transcripts, no transcript row and no crash.
- AC2: Given the preview project page in generate mode, when it renders, then the intake context pane shows one disclosure per transcript (label, word count) with the first transcript open by default and its body loaded through `getTranscriptContent`; opening another disclosure loads that body (one body subscription at a time, `"skip"` when none is open); the Draft-generation section is gated on "at least one transcript or a readable document" instead of `transcript` existing; `runGenerate` calls `requestGeneration({ projectId, ... })`.
- AC3: Given the preview page in review mode with no transcripts, then the transcript disclosure is hidden as today (`:2024`, `:2195`).
- AC4: `CurrentProjectPage.svelte` renders the transcripts stacked in its transcript block (`:1661-1734`) with the same hide rule and the same one-open-body pattern, and `runGenerate` (`:608-623`) no longer requires a transcript id.
- AC5: `PdReviewReport`'s `hasTranscript` is `transcripts.length > 0` at both mount sites (`PreviewProjectPage.svelte:1599`, `:2065`, `CurrentProjectPage.svelte:1648`).
- AC6: `convex/transcripts.ts` exports only `listTranscripts` and `getTranscriptContent`; the stub key in `PreviewProjectIntake.component.test.ts:50-54` becomes `transcripts:listTranscripts` with a one-element metadata array plus `transcripts:getTranscriptContent` with the body, and the pinned text at `:100` still renders (first disclosure open by default).

## Verification
- AC1, AC2, AC6 → `PreviewProjectIntake.component.test.ts` (local-only): add a two-transcript case next to the existing `:86` case asserting two disclosure rows, the first body visible and the second not until clicked (there is no `PreviewProjectPage.component.test.ts`). The stub keys by function name only, so `getTranscriptContent` returns the same body for either id; assert presence, not which body.
- AC4 → `npm run check`; `?workspace=current` manual pass recorded in evidence (`needs_operator` if no dev server is available to QA).
- AC5, AC6 → `rg` predicates; `npm run check`.
- Gate proof is `svelte-check` plus the `done_when` greps; QA verdict `typecheck-only` is expected to be raised to `test-verified` by the component run recorded in evidence.

## Implementation notes
- `FilesPanel.svelte:124`, `:139`, `:476-541`, `:810-841`: `transcriptsQ = useQuery(api.transcripts.listTranscripts, () => ({ projectId }))`; `{#each transcripts as t (t._id)}` around the row; `previewTranscriptId` state drives `useQuery(api.transcripts.getTranscriptContent, () => previewTranscriptId ? { transcriptId: previewTranscriptId } : "skip")` for the modal; download uses the existing `client` (`:125`) with `client.query(api.transcripts.getTranscriptContent, { transcriptId })`.
- `PreviewProjectPage.svelte:112-114`, `:209`, `:527-539`, `:768`, `:783`, `:1599`, `:2024`, `:2065`, `:2075`, `:2195-2252`: `transcripts` metadata list; `openTranscriptId` defaults to `transcripts[0]?._id` once loaded; one body query with `"skip"`; `transcriptWordCount` becomes the metadata total; one disclosure per transcript with stable ids `${reviewTranscriptBodyId}-${t._id}`.
- `CurrentProjectPage.svelte:87-89`, `:125`, `:608`, `:623`, `:1648`, `:1661-1734`: same, minimal markup change (frozen legacy chrome; no redesign).
- `GenerationProgress.svelte:227` copy: "Reruns all drafts from the same transcripts."
- Delete `getTranscript` from `convex/transcripts.ts`.
- Design tokens and type roles per `docs/design-system.md`; weight ≤ 500.

## Edge cases
- Query loading: render nothing for the transcript rows (no skeleton regression); the Draft-generation gate waits for `data !== undefined`.
- Body loading after a disclosure opens: keep the existing `Loading transcript...` text (`:2232`, `:2249`).
- A transcript with 400 000 chars in the preview modal: existing `<pre>` path; no new virtualisation.
- Unauthorised viewer: `listTranscripts` returns `[]`; panels show no transcript rows; `getTranscriptContent` is never subscribed.
- Transcript removed while its body is open: body query returns `null`; disclosure shows the loading text, no throw.
