# Architecture — 20260903-client-sync

Three deliverables, three ticket chains. Order of delivery: C (uploader bug, client blocked), B (workspace gate, small), A (multiple transcripts, large). Principle citations are in brackets; each one changed a decision.

## Invariants

1. Exposure is not authorization. `workspaceRollout.getAccess` decides only whether the preview shell renders; every read and write inside it still passes `requireCapability` (`convex/lib/roleCapabilities.ts:43-66`, `docs/product-domain.md:765-766`). Removing the rollout gate grants no capability.
2. `?workspace=current` is resolved before any access query is subscribed (`src/lib/dashboard/workspaceExperience.ts:27`, `:51`, `:63-65`). No change to the gate may touch that branch.
3. Generation input is frozen per generation in `generationSources` and every provenance citation is validated byte-for-byte against one frozen source row (`convex/reports.ts:103-114`). Digests enter the pipeline only as frozen source rows, never as live text.
4. Every existing single-id field (`generations.transcriptId`, `reports.sourceTranscriptId`, `reportSnapshots.sourceTranscriptId`, `reportProvenance.sourceTranscriptId`) keeps being written with the first transcript of the set. New list fields sit alongside and are optional. Widen only; no backfill, no narrow (`docs/product-domain.md:226`, `:247`).
5. One read helper owns the definition of "a project's transcripts": ordered by `position` then `createdAt`, empty-content rows dropped (legacy placeholders from `convex/ingestionPort.ts:208-212`). The only direct `transcripts` queries outside it are the two that are not that definition: `deleteProject`'s cascade (`convex/projects.ts:1056`, must delete the empty rows too) and the admin orphan scan (`convex/debugTools.ts:201`) [10 model the domain]. Clients never subscribe to transcript text in bulk: `listTranscripts` is metadata, `getTranscriptContent` is one body at a time [7 experience first].
6. The condensation decision is a pure function of combined transcript length and repo constants; the digest for a transcript is keyed by `(transcriptId, contentHash, condenseVersion)` and is never regenerated for the same key; any change to the condense prompt, schema or size constants bumps `CONDENSE_VERSION` in the same commit [13 idempotent; 2 foundational: the key is right in the ticket that creates the table].
7. Condensation runs before the candidate fan-out and in parallel across transcripts; `generateCandidate` keeps its five-call budget (`convex/ai/providers.ts:47-49`, `:70`).
8. The uploader stays read-only, one endpoint, one key; the only file it writes is `upload-log.txt` beside itself (`DEV-HANDOFF.md:49`). Diagnostics print counts and extensions, never document names.
9. Agents propose, humans apply, is untouched: condensation is generation input, not report prose (`AGENTS.md:11`).

## Usage

### C — the client runs the uploader on OneDrive

```
> Run-Uploader.bat
Scanning C:\Users\michael\OneDrive - Client\Applications ...
Found 37 document(s) (.docx/.doc/.pdf/.txt/.vtt).
12 files are cloud-only and will be downloaded by OneDrive while uploading.
```

Zero-result run, the case that produced the bug report:

```
Found 0 document(s) (.docx/.doc/.pdf/.txt/.vtt).
  Walked: 418 files
  Skipped - link: 0   temp: 3   dotfile: 1   extension: 414
  Access errors: 0
  Extensions seen: .xlsx (301), .msg (60), .png (41), .pptx (12)
  Under OneDrive sync root: yes
Nothing to upload. Press Enter to close
```

The same lines land in `upload-log.txt` as `SCAN\t...`. The harness a reviewer reruns:

```
pwsh -NoProfile -File scripts/client-uploader/tests/run-tests.ps1
bash scripts/client-uploader/tests/run-tests.sh
```

### B — a writer opens the app

Any authenticated internal role lands on `/dashboard` in the preview workspace. `?workspace=current` still shows the old chrome. `/admin/users` no longer shows a "Workspace preview rollout" card. Backend:

```ts
export const getAccess = query({
  args: {},
  returns: v.object({ available: v.boolean() }),
  handler: async (ctx) => {
    await requireCapability(ctx, "project.readInternal");
    return { available: true };
  },
});
```

### A — Tracy attaches three transcripts and generates

New-project page, transcript step: a tablist "Upload / Paste" chooses how the next item is added; below it an ordered list of items, each with name, word count and Remove. Upload accepts several `.docx` at once. Paste adds "Pasted transcript 2". Duplicating a project prefills the list from `listTranscripts` metadata; those items are copied server-side by reference, so no transcript text is downloaded to the browser and re-uploaded. Submit:

```ts
const { projectId, transcriptIds } = await createProject({
  ...fields,
  transcripts: items.map((t) =>
    t.source.kind === "copy"
      ? { fromTranscriptId: t.source.fromTranscriptId, label: t.label }
      : { content: t.source.content, label: t.label }
  ),
});
await generateReport({ projectId, candidateMode, ... }); // no transcriptId
```

Project page, context pane: one disclosure per transcript from `listTranscripts` (label, word count); the open one subscribes `getTranscriptContent({ transcriptId })`, the rest cost nothing.

Generation progress log:

```
Read 3 frozen interview transcripts — 61,420 words (312,000 chars, over the 200,000 budget).
Condensing transcript 1 of 3 "2026-03-04 kickoff.docx" (118,000 chars)…
Reusing stored digest for transcript 2 of 3 "2026-04-11 follow-up.docx".
Condensing transcript 3 of 3 "Pasted transcript 3" (52,000 chars)…
Drafting from 3 digests (41,200 chars).
```

Under budget the line is `Read 2 frozen interview transcripts — 12,300 words.` and the full text is used, exactly as today. The generation row says which: `inputMode: "full" | "digest"`, `transcriptIds`, `digestIds`.

Backend assembly, used by both the compare and iterative flows:

```ts
const input = await ctx.runQuery(internal.generations.getGenerationInput, { generationId });
// input.transcript        prompt text: single part → raw content; N parts → "=== Transcript i: label ===" headers
// input.transcriptParts   [{ sourceId, contentHash, content, label }] for claim offset mapping
// input.inputMode         "full" | "digest"
```

Reviewing an existing PD from a project (BNH-39) copies every transcript row of the source. Duplicating a project prefills the list with every transcript of the source.

## Change

### C — `scripts/client-uploader/`

- New `uploader-lib.ps1`: `Test-RealLink`, `Get-UploadSkipReason`, `Get-UploadCandidates`, `Test-CloudOnly`, `Test-RootUsable`, `Get-ExtensionHistogram`, `Format-ScanDiagnostics`. Pure, duck-typed inputs, 5.1-compatible. Dot-sourced by `banhall-uploader.ps1` [9 build the lever: the function is what the harness proves].
- `banhall-uploader.ps1`: replace the inline `Where-Object` (`:209-215`) with `Get-UploadCandidates`; move log truncation and `Write-Log` (`:258-261`) above collection; zero-case prints and logs diagnostics; cloud-only count line; `Test-RootUsable` at both root checks (`:115`, `:155-159`).
- `banhall-uploader.sh`: `collect_candidates` function with skip counting, `READ_ERROR` branch around `sha256_of` (`:269`), root-is-file check, `SCAN` log lines, `BANHALL_UPLOADER_LIB_ONLY` source guard.
- New `tests/run-tests.ps1` and `tests/run-tests.sh`; `scripts/loop-verify.sh` runs both after `npm test`.
- Docs: `README.txt:20-38`, `DEV-HANDOFF.md:45-46` corrected.
- Deleted: the inline filter, the false "symlinks are skipped" sentence, the false "log lists exactly what was sent" sentence [4 subtract].

Data flow before: `Get-ChildItem | Where-Object (silent) → entries → "Found N"`. After: `Get-UploadCandidates → { Candidates, Skipped{...}, Errors, Walked, Extensions, CloudOnly } → "Found N" (+ diagnostics when 0, + cloud-only line when > 0) → SCAN log lines`.

### B — workspace gate

- `convex/workspaceRollout.ts` shrinks to `getAccess` (capability check, `available: true`). Deleted: `MASTER_KEY`, `masterRows`, `accessRows`, `masterEnabled`, `getAdminState`, `setMasterSwitch`, `setMasterSwitchInternal`, `setUserAccess`, `setUserAccessInternal`, `listEnabledAccess`, `listRolloutEvents` (`:36-67`, `:197-457`) [1 laziness; 14 migrate callers then delete, same wave].
- Deleted: `src/lib/components/admin/WorkspaceRolloutCard.svelte` (309 lines, the only consumer of the deleted functions), its component test `WorkspaceRolloutCard.component.test.ts` (imports the card at `:3`; left behind it breaks `svelte-check`), and its import/mount at `src/routes/admin/users/+page.svelte:10`, `:764-765` [14 same wave].
- `convex/workspaceRollout.test.ts` rewritten: one case per internal role gets `available: true`; the unauthenticated/anonymous/roleless denial case (`:316-321`) kept verbatim.
- Schema untouched: `workspaceDashboardAccess` (`schema.ts:1704-1712`), `workspaceDashboardRolloutEvents` (`:1718-1728`), the `appSettings` master row (`:1851-1859`) stay. Narrowing is a separate decision.
- Dead code removed with it (`workspace-2`): the `localDevelopment` branch in `src/lib/dashboard/workspaceExperience.ts:52` (hardcoded `false` at `WorkspaceGate.svelte:80`, `dev` import `:29` unused) and the whole of `resolveWorkspaceExperience` (`:22-31`), which has no production caller: `WorkspaceGate.svelte:36-37` imports only `resolveWorkspaceRouteState` and `shouldQueryWorkspaceAccess` [1 laziness; 4 subtract]. Test cases `workspaceExperience.test.ts:8-36`, `:60`, `:63-75` go with them.
- Client contract unchanged: `getAccess` still returns `{ available }`; `WorkspaceGate.svelte` keeps `loading`/`error` → `current` fallbacks for the pending subscription and for roleless users (NOT_AUTHORIZED → error → current).
- `docs/product-domain.md` (`workspace-2`, so `workspace-1` stays at two packages): 2026-09-03 amendment superseding the 2026-08-06 clause "the rollout gate (master switch AND per-user access, fail-closed) is reused unchanged" (`:763-766`) and recording the never-written 2026-08-11 admin short-circuit as history.

### A — transcripts

Data model (all additive, `convex/schema.ts`) [2 foundational thinking: the table shape first, the rest follows]:

```
transcripts            + label?: string          // file name or "Pasted transcript N"; legacy rows read "Interview transcript"
                       + position?: number       // 0-based order within the project; legacy rows order by createdAt
                       + contentHash?: string    // sha256 of content, set at insert; digest lookup key
transcriptDigests (new)  transcriptId, projectId, sourceContentHash, condenseVersion, content (rendered text fed to the prompt),
                         structured (JSON string of the validated digest object), model, promptVersion, charCount,
                         originalLength, createdAt
                         index by_transcriptId_and_sourceContentHash_and_condenseVersion, by_projectId
generations              transcriptId: v.id → v.optional(v.id)        // first transcript, absent when the project has none
                                                                      // lands in transcripts-2 with the readers at generations.ts:544/:580
                       + transcriptIds?: Id<"transcripts">[]          // the set, in position order
                       + inputMode?: "full" | "digest"
                       + digestIds?: Id<"transcriptDigests">[]
generationSources        kind + "transcript_digest"; + digestId?: Id<"transcriptDigests">
reports                + sourceTranscriptIds?: Id<"transcripts">[]
reportSnapshots        + sourceTranscriptIds?
reportProvenance       + sourceTranscriptIds?, + digestIds?
```

`generations.transcriptId` relaxes from required to optional because a project may now have zero transcripts and an empty placeholder row is not a transcript [12 illegal states unrepresentable]. Existing rows keep validating. The relaxation is the one non-additive schema edit and it lands in `transcripts-2`, the ticket that removes the two `ctx.db.get(...transcriptId)` readers (`generations.ts:544`, `:580`); `transcripts-1` stays purely additive so its "tsc green with nothing else changed" criterion is true as written [18 verifiable units].

Two caps guard the writers: `MAX_TRANSCRIPTS_PER_PROJECT = 20` and `MAX_TOTAL_TRANSCRIPT_CHARS = 2_000_000`. The second exists because `reserveGeneration` freezes every transcript into `generationSources` rows inside one mutation and Convex bounds the bytes a transaction writes; 20 rows at the browser cap of 400 000 chars would approach that bound [2 foundational; 11 boundary].

Modules:

- New `convex/lib/transcripts.ts` (default runtime, no `"use node"`): `listProjectTranscripts(ctx, projectId)` (invariant 5, full docs for server-side callers), `transcriptMetadata(doc)`, `insertTranscriptRow`, `copyTranscriptRow` (shared by `createProject` and `reviewFromProject`), `MAX_TRANSCRIPTS_PER_PROJECT = 20`, `MAX_TOTAL_TRANSCRIPT_CHARS`, `CONDENSE_VERSION`, `buildTranscriptPromptText(parts)` (single part raw, N parts headered), `findQuoteInParts(parts, quote)` → `{ partIndex, startOffset } | null`, `mapClaimToPart(parts, claim)`.
- `convex/transcripts.ts`: `listTranscripts` query (metadata: `_id, label, position, createdAt, charCount, wordCount, contentHash?`) and `getTranscriptContent({ transcriptId })` (one body, silent `null` without access) replace `getTranscript`. `getTranscript` survives only until its four UI callers move (`transcripts-5`), then is deleted [14].
- `convex/projects.ts` `createProject` (`:578`): `transcripts: v.array(v.union({ content, label? }, { fromTranscriptId, label? }))` replaces `transcriptContent`; content items insert one row per non-empty content with `position = index`, `contentHash`; `fromTranscriptId` items copy the source row after an access check on its project; both caps enforced before any insert; returns `{ projectId, transcriptIds }`. `getScienceCodeSuggestionContext` (`:550-576`) joins the list. `copyProjectInputRows` keeps `targetTranscriptId` (first) and also writes `sourceTranscriptIds` on the copied report. `convex/projectDuplication.ts:83` `targetTranscriptId` becomes optional (the inner `copyProjectContentBetween`, `:37`, already is) so a project with no transcripts can still be duplicated.
- `convex/generations.ts`: `reserveGeneration(ctx, project, requestedBy, ...)` loads the project's transcripts itself (retries no longer pass a transcript), freezes one `generationSources` row per transcript (existing 500 000 slice per row), writes `transcriptId` (first), `transcriptIds`, `inputMode` from `decideInputMode(totalChars)`. `requestGeneration.transcriptId` becomes optional and is ignored beyond a project-membership check for stale clients, then removed in `transcripts-2` with its callers. `getGenerationInput` returns `transcript`, `transcriptParts`, `inputMode`; in digest mode the parts are the `transcript_digest` rows. Report/snapshot writers (`:928`, `:941`, `:994`, `:2018`) add `sourceTranscriptIds`.
- New `convex/ai/condense.ts` (`"use node"`): `ensureCondensedInputs(ctx, generationId, log)`: for each transcript source row, look up `transcriptDigests` by `(transcriptId, contentHash, CONDENSE_VERSION)`; if absent, window the content (`CONDENSE_WINDOW_CHARS`), call `generateStructured` on `MODEL` through `instrumentedAnthropic` with callSite `generation:condense`, validate with zod, render to text, insert the digest and a `generationSources` row `kind: "transcript_digest"`. Parallel across transcripts. Called by `pipeline.generateReport` and `iterative.startIterativeGeneration` right after `getGenerationInput`, before Brain retrieval.
- New `convex/ai/condenseAgent.ts`: system prompt, zod schema (`participants`, `timeline[]`, `technologicalUncertainties[]`, `hypotheses[]`, `experiments[] {problem, approach, result, conclusion, dates}`, `resultsAndNumbers[]`, `namesAndSystems[]`, `keyQuotes[]` verbatim), JSON schema, `renderDigest(obj): string` (deterministic markdown, quotes verbatim so `findQuoteInParts` can still cite them).
- `convex/ai/promptProgram.ts`: `calls.condense` (`kind: "structured"`, `model: { kind: "fixed", modelId: MODEL }`) and `configuration.transcripts = { budgetChars: 200_000, condenseWindowChars: 160_000, digestTargetChars: 24_000 }`; `promptVersion` changes as intended.
- `convex/ai/pipeline.ts`: claims map through `findQuoteInParts` to `{ generationSourceId: part.sourceId, sourceContentHash: part.contentHash, startOffset }`; `createProvenance` receives `sourceTranscriptId` (first) plus `sourceTranscriptIds` and `digestIds`. `convex/reports.ts` `createProvenance` and `reviewClaimCitation` carry the lists. `convex/lib/snapshots.ts` `snapshotAuditFields` returns `sourceTranscriptIds` from the winning generation.
- `convex/reviewFromProject.ts`: copies every source row (label, position, contentHash), returns `transcriptIds`; `targetTranscriptId` for the report stamp is the first. `convex/pdReviews.ts` `getReviewInput` joins the list. `convex/debugTools.ts`, `convex/seed.ts` use the helper and new fields.
- Frontend: `src/routes/project/new/+page.svelte` transcript step becomes an ordered list (`{ id, label, wordCount, source }[]` where `source` is uploaded/pasted content or `{ kind: "copy", fromTranscriptId }`), `multiple` file input, paste adds an item, remove per item, prefill from `listTranscripts` metadata as copy items; `questionnaire/+page.svelte` passes `transcripts: [{ content, label: "Questionnaire answers" }]`; `FilesPanel`, `PreviewProjectPage`, `CurrentProjectPage` render the metadata list (one row per transcript in the files panel with per-item download fetched on click, one disclosure per transcript on the project pages with one `getTranscriptContent` subscription for the open one, first open by default), generation calls drop `transcriptId`.

Deleted: `getTranscript`, `transcriptContent`, `requestGeneration.transcriptId`, the `transcript: Doc<"transcripts">` parameter of `reserveGeneration`, the single `transcriptFileName` state and its chip [4 subtract].

Data flow after: `createProject(transcripts[] by content or by reference) → transcripts rows (position, hash) → requestGeneration(projectId) → reserveGeneration freezes N source rows + inputMode → generateReport: ensureCondensedInputs (digest mode only) → getGenerationInput (parts) → Brain retrieval + candidates → claims mapped per part → provenance with sets`.

## Trace

| Acceptance | Lands in | Proof |
|---|---|---|
| C1 placeholder kept, links skipped, reasons classified | `scripts/client-uploader/uploader-lib.ps1`, `banhall-uploader.ps1:209-215` | `scripts/client-uploader/tests/run-tests.ps1` (fake objects + temp tree), run by `scripts/loop-verify.sh` |
| C2 zero-result diagnostics, cloud-only count, root-is-file | `uploader-lib.ps1`, `banhall-uploader.ps1:115`, `:155-159`, `:225-229`, `:258-261`, `README.txt`, `DEV-HANDOFF.md` | `run-tests.ps1` formatter and helper cases; code walk for log order |
| C3 Mac parity, READ_ERROR, root check | `banhall-uploader.sh:195-206`, `:259`, `:269` | `scripts/client-uploader/tests/run-tests.sh`, run by the gate |
| B1 every internal role available; denial cases unchanged | `convex/workspaceRollout.ts:177-190` | `convex/workspaceRollout.test.ts` (rewritten; `:316-321` kept) |
| B2 rollout card and its component test gone, admin shell query-free | `src/lib/components/admin/WorkspaceRolloutCard.svelte` (deleted), `src/lib/components/admin/WorkspaceRolloutCard.component.test.ts` (deleted), `src/routes/admin/users/+page.svelte:10`, `:765` | `src/routes/admin/adminWorkspaceRoutes.test.ts:9-29` unchanged and green; `rg` finds no reference |
| B3 amendment (`workspace-2`) | `docs/product-domain.md` (after the second 2026-09-01 block, `:1439` onward) | `rg -n "2026-09-03" docs/product-domain.md` |
| B4 dead `localDevelopment` branch and callerless `resolveWorkspaceExperience` removed; `?workspace=current` pinned | `src/lib/dashboard/workspaceExperience.ts:22-31`, `:39`, `:52`, `src/lib/workspace/WorkspaceGate.svelte:29`, `:80` | `src/lib/dashboard/workspaceExperience.test.ts` (`resolveWorkspaceRouteState` cases byte-identical); `! rg resolveWorkspaceExperience src/`; component tests (local) |
| A1 additive schema widen + list helper + metadata list query + content query + amendment | `convex/schema.ts:487-491` (transcripts), `:493` (reports), `:600-602` (generations, additive fields only), `:1185` (reportSnapshots), `:1327` (generationSources), `:1344` (reportProvenance); `convex/lib/transcripts.ts` (new); `convex/transcripts.ts`; `docs/product-domain.md` | `convex/transcripts.test.ts` (new): ordering, legacy label default, empty rows dropped, metadata shape, `getTranscriptContent` silent null |
| A2 generation reads all transcripts, parts, provenance mapping, legacy identical; `generations.transcriptId` relaxed | `convex/schema.ts:602`; `convex/generations.ts:341-493`, `:495-532`, `:534-558`, `:562-700`, `:782-827`; `convex/ai/pipeline.ts:419-456`, `:650-689`; `convex/ai/iterative.ts:75` | `convex/generationInput.test.ts` (new): one row → text identical to content, N rows → headered parts, zero rows with docs allowed; `findQuoteInParts` / `mapClaimToPart` unit cases; `tsc` |
| A3 create with many (by content or by reference); new-page list UI; questionnaire; duplication validator | `convex/projects.ts:578` (`createProject`); `convex/projectDuplication.ts:83`; `convex/lib/transcripts.ts` (`insertTranscriptRow`, `copyTranscriptRow`); `src/routes/project/new/+page.svelte:127`, `:185-215`, `:229-258`, `:470-503`, `:655-668`, `:1025-1128`; `src/routes/project/questionnaire/+page.svelte:113-118`; `convex/generationAttribution.test.ts:449`, `:1534` | `convex/projects.test.ts`; `src/routes/project/new/newProjectTranscripts.component.test.ts` (new, local) |
| A4 review copy, review input, science-code context, debug, seed | `convex/reviewFromProject.ts:87-90`, `:163-167`; `convex/pdReviews.ts:256-267`; `convex/projects.ts:550-576`, `:841-843`; `convex/debugTools.ts:45-49`, `:201-209`; `convex/seed.ts:91-95` | `convex/reviewFromProject.test.ts:105-153` extended to two rows; `convex/projects.test.ts:292-354`; `-F` count predicates on the two files that keep one direct query |
| A5 UI readers use the metadata list and one body at a time; `getTranscript` deleted | `src/lib/components/editor/FilesPanel.svelte:124`, `:476-541`, `:810-841`; `src/lib/components/project/PreviewProjectPage.svelte:112`, `:768-783`, `:2195-2252`; `src/lib/components/project/CurrentProjectPage.svelte:87`, `:623`, `:1661-1734`; `convex/transcripts.ts` | `src/lib/components/project/PreviewProjectIntake.component.test.ts:50-100` (stub keys `listTranscripts` + `getTranscriptContent`, pinned text at `:100` renders because the first disclosure opens by default), `svelte-check`, `! rg getTranscript\b` |
| A6 provenance sets on reports, snapshots, provenance rows | `convex/generations.ts:928`, `:941`, `:994`, `:2018`; `convex/reports.ts:74-132`, `:160-207`; `convex/lib/snapshots.ts:11-24`, `:51-129`; `convex/snapshots.ts:165-191`, `:289-305`; `convex/projects.ts:841-843` | `convex/lib/snapshots.test.ts` (new, vitest; Map-backed fake db ported from `tests/snapshots.test.ts:116-120`, which is `bun:test` and outside the gate); `convex/reports.test.ts` (new, convex-test: `createProvenance` + `reviewClaimCitation`); `convex/generationAttribution.test.ts` case asserting lists |
| A7 condensation decision, digest persistence and reuse, prompt program, progress lines | `convex/ai/condense.ts` (new), `convex/ai/condenseAgent.ts` (new), `convex/ai/promptProgram.ts:254-318`, `:361-367`; `convex/transcriptDigests.ts` (new); `convex/generations.ts:445-457`, `:782-827`; `convex/ai/pipeline.ts:403-473`; `convex/ai/iterative.ts:59-258` | `convex/ai/condenseAgent.test.ts` (renderer, windowing, decision, `CONDENSE_VERSION` pinned to the prompt+schema hash); `convex/transcriptDigests.test.ts` (insert once, reuse on second reserve, new row on version bump); `convex/ai/promptScaffolds.test.ts` or a new case pinning `calls.condense` presence |

Every path above exists at `36df137` except the ones marked (new); verified with `ls`/`rg` during planning and re-checked during revision 1. Gate scope for every Proof column: `vitest.config.ts:19` runs `convex/**/*.test.ts`, `tests/aiUsage.test.ts`, `shared/**`, `src/**` (non-component); nothing else under `tests/` is a gate step.

## Alternatives considered

- **B: keep the rollout functions and mark the card inert.** Rejected: 300 lines of UI plus seven backend functions that do nothing, and a reader who must learn they do nothing [5 reader load, 1 laziness]. Tables stay because dropping them is a narrow.
- **B: drop the `getAccess` query entirely and render the preview for any authenticated user.** Rejected: roleless and anonymous users would render the shell and then fail on every inner query; `getAccess` is the cheap "internal user" probe the gate already has, and the idea names its contract ("available: true for `project.readInternal`") [11 boundary discipline].
- **A: keep one transcript row per project and append texts into `content`.** Rejected: loses file identity, ordering and per-transcript digest reuse; hits the 1 MB Convex string limit at two long transcripts [2 foundational].
- **A: store digests as `generationArtifacts` rows.** Rejected: artifacts are per generation, so a regeneration would re-pay every condensation; a digest keyed by `(transcriptId, contentHash)` is reused [13].
- **A: digest the concatenation rather than each transcript.** Rejected: one call cannot fit several long transcripts; per-transcript digests reuse across regenerations when only one transcript changes, and keep provenance per source row [3 first principles].
- **A: run condensation inside `generateCandidate` per model.** Rejected: the per-candidate action is sized for five sequential calls (`providers.ts:47-49`) and digests are model-independent; once before fan-out, in parallel [7 invariant].
- **A: cite claims against the original transcript even in digest mode by re-locating quotes.** Rejected for this plan: quotes surviving verbatim in the digest are found in the digest source row; re-locating in the full row is a later refinement. Recorded as a non-goal.
- **A: new `transcriptId`-free API in one big ticket.** Rejected: eight tickets, each green under the gate, is the only way the sequence proves itself [18 verifiable units].

## Risks

- `schema` (A1 additive; A2 relaxes `generations.transcriptId` required → optional). Convex accepts relaxing; existing docs validate. Rollback: revert the ticket; new optional fields on existing rows are ignored by old code.
- `provenance` (A2, A6, A7): A2 rewrites the claim → source-row mapping (`mapClaimToPart`), which decides every citation's `generationSourceId`, hash and offset; A6/A7 add lists next to the single id. `snapshotAuditFields` keeps its single-id conflict rules and only carries the list of the winning generation; no new rule can invalidate an old row. Rollback: revert; old readers never read the lists.
- `rights` (B): the gate is adjacent to authorization but decides exposure only. The denial cases are kept verbatim as the boundary pin.
- Prompt-program hash changes in A7 (`promptVersion`), which is the intended provenance signal, not a regression; `generationAttribution.test.ts` cases that pin a specific hash value must be checked.
- Cost: condensation adds one Sonnet call per transcript per content hash. Reuse makes regenerations free. Constants are repo constants; tuning is a one-line change with a version bump.
- Stale browser tabs after A3: `createProject` without `transcripts` fails validation until refresh. Accepted; small internal user base.
- Component tests are local-only; the gate cannot prove UI tickets beyond `svelte-check`. QA verdict floor `test-verified` is met by the Convex tests; UI tickets list the component test as a ticket-level verify command.
- C is proved under pwsh 7.6 on macOS, executed under Windows PowerShell 5.1 by the client. The lib avoids 7-only syntax; the harness also asserts the absence of `??`, ternaries and `#Requires`.

## Non-goals

- Narrowing any field or dropping `workspaceDashboardAccess`, `workspaceDashboardRolloutEvents`, the `appSettings` master row, or the empty placeholder row written by `ingestionPort.ts`.
- Per-project or per-user tuning of the condensation budget; a UI for editing or reordering transcripts after creation; editing a transcript's text.
- Re-locating digest-mode citations in the original transcript.
- Budgets for context documents (`generations.ts:458-477`) or a trusted-context module (architecture plan Phase 2).
- Changes to Brain ingestion (`convex/ingestion*.ts`), the Home composer's single-transcript handoff, or the OneDrive scraper's server side.
- A real Windows OneDrive reproduction of C; not reachable from this machine.

## Revision

### Revision 1 (2026-09-03, after `validation-1.md`)

Every `[high]` was a defect in how a ticket would be proved or closed, not in the shape of the design; the medium and low items sharpened the design in four places. Principles are named where they changed the decision.

1. **transcripts-6 proved with bun files the gate never runs** (high). `tests/snapshots.test.ts` and `tests/chatProposals.test.ts` import `bun:test` and match no vitest project. Proof moved into `convex/lib/snapshots.test.ts` (Map-backed fake db ported) and a new `convex/reports.test.ts` (convex-test). Bun files are left untouched; they are not gate steps. `research.md` Tests bullet and Trace A6 corrected [16 prove it works].
2. **transcripts-1 demanded tsc green while relaxing `generations.transcriptId`** (high). The relaxation moved to transcripts-2, which deletes the two `ctx.db.get(...transcriptId)` readers; transcripts-1 is purely additive [18 verifiable units].
3. **transcripts-3 predicate defeated by `transcriptIds`** (high). Word-bounded `\btranscriptId\b` [24 checkable predicate].
4. **transcripts-4 predicate forbade queries the ticket keeps** (high). While fixing it: `rg 'query("transcripts")'` treats the parens as a group and never matches the literal, so the original predicate was vacuous. Now `-F` on the two files that lose their query and `-cF ... = 1` counts on `projects.ts` and `debugTools.ts`, which each keep exactly one [24].
5. **`WorkspaceRolloutCard.component.test.ts` left dangling** (medium). Named for deletion in workspace-1 and Trace B2 [14 same wave].
6. **`projectDuplication.ts:83` validator required** (medium). Made optional in transcripts-3; the inner helper already was [11 boundary].
7. **`generationAttribution.test.ts:449`, `:1534` pass `transcriptId`** (medium). Listed in transcripts-3 verification and `verify`.
8. **Digest key unversioned** (medium). `condenseVersion` in the row and the index from transcripts-1; `CONDENSE_VERSION` lives in `convex/lib/transcripts.ts` so the node action and the default-runtime mutations share it; a test pins it to the prompt+schema hash [2 foundational; 23 encode lessons in structure].
9. **transcripts-2 untagged** (medium). `risky: [schema, provenance]`; plan-result updated [23].
10. **workspace-1 at three packages** (medium). The amendment moved to workspace-2 (`touches: [src, docs]`). Alternative rejected: declaring `docs` a non-package in `factory.toml`, which the planner may not write.
11. **`resolveWorkspaceExperience` reshaped instead of deleted** (medium). It has no production caller; deleted with its suite [1 laziness; 4 subtract].
12. **`listTranscripts` shipped full content** (medium). Split into a metadata list and `getTranscriptContent` per body. Consequence traced through the chain: the duplicate wizard now prefills by reference (`fromTranscriptId` items copied server-side by `createProject`), so transcript text never round-trips the browser; project pages subscribe one body at a time with the first disclosure open so the pinned intake test still renders [7 experience first; 11 boundary].
13. **Planner-found while applying 12**: `reserveGeneration` freezes every transcript in one mutation; 20 rows at the 400 000-char browser cap would approach Convex's per-transaction write bound. Added `MAX_TOTAL_TRANSCRIPT_CHARS = 2_000_000`, enforced in `createProject` beside the row cap and stated in the amendment [2 foundational].
14. **Low items**: `mapClaimToPart|findQuoteInParts` predicate on transcripts-2; uploader-2 note no longer calls the env-var probe a registry probe or reuses its result; `getTranscript` deletion attributed to transcripts-5; Trace line ranges refreshed (`createProject` :578, `getScienceCodeSuggestionContext` :550-576, `generationSources` :1327, `reportSnapshots` :1185, `reportProvenance` :1344, `startIterativeGeneration` :59-258).
15. **Correction to a low finding**: there is no `consultant` role. `shared/roles.ts:4` stores `writer | manager | admin` and displays `writer` as "Consultant". workspace-1 AC1 names the three stored roles and needs no new `setup()` identity [12 illegal states unrepresentable: do not invent a role to test].

Ticket keys, dependency order and count (12) are unchanged.
