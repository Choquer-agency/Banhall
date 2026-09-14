---
title: 'Brief panel and context-inclusion visibility'
type: 'feature'
created: '2026-09-11'
status: 'done'
baseline_revision: 'db84a572c94a46e18aea998acccf934ca30c9199'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/convex/_generated/ai/guidelines.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-Banhall-2026-09-09/DESIGN.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-Banhall-2026-09-09/EXPERIENCE.md'
  - '{project-root}/docs/design-system.md'
warnings: [oversized]
deferred:
  - summary: >-
      A failed Brief read renders exactly like a legacy generation: the rail and its
      launcher simply disappear, with no error surfaced.
    evidence: |-
      BriefRailPanel.svelte reads only briefQ.data / inclusionQ.data / writerQ.data;
      `.error` and `.isLoading` are never consulted, and `available` is false while any
      of them is undefined. A writer cannot tell a broken read from a project that has
      no Brief. Fixing it needs an error state and its copy, not a one-line change.
    location: >-
      src/lib/components/brief/BriefRailPanel.svelte
    severity: medium
  - summary: >-
      A Storyline question raised while the writer is in chat or QA is never announced
      and leaves no trace on the Brief launcher.
    evidence: |-
      The aria-live region lives inside BriefRail, which is mounted only while
      railView === "brief" and sits inside a container carrying inert={!open}.
      EXPERIENCE.md's count pill ("Brief · 1", its own [ASSUMPTION: toggle badge]) is
      not implemented, so there is no out-of-rail signal at all.
    location: >-
      src/lib/components/brief/BriefRail.svelte; src/lib/components/brief/BriefLauncher.svelte
    severity: medium
  - summary: >-
      In compare and iterative modes every candidate re-records the context budget over
      the same generationSources rows, last writer wins, and no test covers it.
    evidence: |-
      recordContextBudget runs once per candidate (convex/ai/pipeline.ts, iterative.ts),
      each pass patching `inclusion` on the same rows. getGenerationInput's own comment
      notes an admin retune mid-generation can disagree with what was already recorded.
      The Brief presents one authoritative inclusion set with no candidate attribution;
      both inclusion suites exercise a single recording pass only.
    location: >-
      convex/generations.ts recordContextBudget
    severity: medium
  - summary: >-
      Inclusion rows are inert: EXPERIENCE.md specifies that clicking a document opens it
      in FilesPanel.
    evidence: |-
      EXPERIENCE.md Component Patterns > inclusion-row says "Clicking a document opens it
      in FilesPanel behaviour (existing)". BriefRail renders each row as a plain <li> with
      a label span and a status span, so a writer cannot get from
      "not included - could not read" to the file that caused it.
    location: >-
      src/lib/components/brief/BriefRail.svelte
    severity: low
  - summary: >-
      BriefRailPanel and BriefLauncher are imported eagerly, while every other rail
      occupant loads through LazyModule.
    evidence: |-
      CurrentProjectPage.svelte statically imports both, whereas QARailPanel and
      AgentChatPanel go through LazyModule. The Brief subtree, including the bits-ui
      Popover pulled in by BriefSourceChip, now loads on every visit to the report route,
      including legacy projects where the rail never appears. Bundle weight only; no
      behavioural effect.
    location: >-
      src/lib/components/project/CurrentProjectPage.svelte
    severity: low
  - summary: >-
      A project with more than 100 total documents can silently undercount the Brief's
      Inputs band: attached documents past the fetch bound vanish from documentsTotal and
      the not-captured reasons list.
    evidence: |-
      getContextInclusion reads projectDocuments with a flat `.take(100)` (no pagination),
      while documents.uploadDocument has no count limit — the Code Map notes this directly.
      The reservation itself is bounded at 50 documents per generation, so the frozen-source
      side is safe, but a project's cumulative document count is unbounded across its
      lifetime. No test exercises a project anywhere near 100 total documents; the largest
      covers 51.
    location: >-
      convex/generations.ts getContextInclusion
    severity: medium
  - summary: >-
      BriefEditableText gives no visual feedback while a save is in flight.
    evidence: |-
      `busy` is a plain (non-reactive) local variable checked only inside `commit()`'s
      early-return guard; the template never reads it, so the textarea stays fully
      editable and unstyled during the awaited `onSave` call. A slow save leaves the
      writer with no "saving" indication.
    location: >-
      src/lib/components/brief/BriefEditableText.svelte
    severity: low
---

<intent-contract>

## Intent

**Problem:** Stories 1–3 store a Generation Brief, per-source context-budget outcomes and the Writer Profile record, but no writer ever sees them. There is no Brief beside the draft, no way to edit it, and no per-document included/condensed/not included line with the cap. The "no Writer Profile applied" line is missing too (ledger DW-125). Worse, `briefs.getBrief` is an unauthenticated read, and a Storyline edit overwrites the whole Storyline with one claim.

**Approach:** Add a Brief view to the report workspace's right rail. While a generation runs, show it under the generation progress. It holds an Inputs band (one inclusion row per document, the cap, the no-profile line and the save offer) and the Storyline, Claim Exclusions, Confidence Map and Glossary Terms groups. Entries are edited inline through `briefs.saveEntryEdit`, which always inserts a new version with its edit magnitude; the next run reuses that version. Inclusion is recorded once per `generationSources` row (AD-30) and read through one query. CAP-3, CAP-11 and CAP-17 define success.

## Boundaries & Constraints

**Always:**
- The Brief never gates anything. Generation, apply and navigation proceed with zero Brief interaction. The only Brief writer actions are: supply a Storyline (type into an empty one), edit an entry, or leave it. The one generation action, "Regenerate with this Brief", appears only when the displayed version is newer than the generation's own.
- Every edit goes through `briefs.saveEntryEdit`, which inserts a new version (origin `edited`, `editMagnitude`) and never mutates a row. A save whose text equals the current text inserts nothing.
- `generationBriefs` keeps exactly two writers (AD-23). `generationSources.inclusion` is written only by `generations.recordContextBudget`.
- A document is shown as `included` only when it entered the analyzer's context with at least one character. An unrecorded status shows no status word; it never defaults to `included`.
- All Brief and inclusion reads require project access (`getInternalProjectAccessOrNull`) and return `null` to outsiders.
- Design system: bits-ui primitives (Popover for source chips, the shared `ui/Disclosure` plus `DisclosureChevron` for groups), weight ≤ 500, type roles `text-title`/`text-label`/`text-body`/`text-data`, and tokens only (gray ramp, ink tiers, `primary-selected`, `gap-bg`/`gap-text`, `chrome`, `primary-wash`, `line`/`line-soft`). No hex, no bold, no cards inside the rail. 44px targets.
- Copy follows EXPERIENCE.md's Voice and Tone verbatim. Never "AI", never "!", never "successfully".

**Block If:**
- `convex/_generated/api.d.ts` would need a new module entry (it cannot be regenerated here). Put every new public function in an existing module (`briefs`, `generations`, `writerProfiles`). If that proves impossible, HALT with `codegen required`.

**Never:**
- Open the Brief as a modal, or add an approval step before a section.
- Render Compliance lines, drafted-section streaming, Stop, "Generate the rest" or the New-project Storyline slot. These stay in ledger DW-115/DW-116 and later stories.
- Change the context cap (12), `trustedContext` allocation, Brain paths, chat evidence copy or `applyProposal`.
- Backfill Briefs or inclusion for pre-feature generations.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| 40 attachments, default cap | 1 Transcript + 40 readable internal documents, generation recorded | All 40 frozen. Inputs header reads "12 of 40 documents in context · cap 12". 12 rows `included`/`condensed`, 28 `not included`. | None |
| Over-budget Transcript (digest mode) | Transcript read through its `transcript_digest` row | Transcript row reads `condensed`. Its Brief entries' source chip says "digest". | None |
| Archived / unreadable document | A document at reservation that is archived or has empty text | Listed as `not included · archived` or `not included · could not read` | None |
| Legacy generation | `getBrief` null, every inclusion row `inclusion: null`, writer settings null | The rail's Brief view and launcher are absent, not empty | None |
| Brief derivation failed | Inclusion and writer settings recorded, no `briefId` | Inputs band shown, no groups | None |
| No profile | `profileState` disabled/missing | Inputs shows "No Writer Profile applied — House Rules in full." | None |
| Settings document applied | `offer` non-null | Banner: "Your customized settings were found in Writer's Notes. Save to your Writer Profile?" (or "in an attachment"). Its button links to `/settings/writing?fromGeneration=<id>`. Dismiss hides it for this project. | None |
| Edit a Storyline | Writer edits the Brief-level Storyline | New version: `storylineText` is verbatim, `storylineOrigin` is `edited`, `editMagnitude.storylineEditDistance` > 0 | Stale version gives `BRIEF_STALE`; the rail says "The Brief changed while you were editing. Your edit was not saved." and keeps the draft |
| Supply a Storyline | Empty `storylineText`, writer types one | New version with `storylineOrigin` `writer` | Empty text is rejected (`INVALID_INPUT`) |
| Edit a Storyline claim / other entry | Entry text changed | Entry copied with `edited: true`. `storylineText` unchanged. The reason chip is kept. | Same as above |
| Storyline question | Unresolved `storylineQuestion` entry | Callout at the top with both sides. "Use the section's evidence" sets `storylineText` to the question's alternative. "Keep the Storyline" leaves it. The question hides once resolved. | Same as above |
| Viewer without edit capability | `canEdit` false | Read-only rows; no edit affordance | Server still enforces `requireReportEditAccess` |

</intent-contract>

## Code Map

Backend:
- `convex/schema.ts:1499-1544` (`generationSources`): widen with optional `inclusion: "included"|"condensed"|"not_included"`, and add optional `maxDocuments` inside `contextBudget`.
- `convex/schema.ts:2111-2205` (Brief tables): widen `generationBriefs` with optional `storylineOrigin: writer|derived|edited`, and `generationBriefEntries` with optional `edited: boolean`. `generationBriefs` already has an index `by_projectId`.
- `convex/ai/trustedContext.ts:185-200` (`TrustedContextSource`): add the pure `sourceInclusion({included, includedLength, truncated})`:
  - `!included || includedLength === 0` → `not_included`;
  - `truncated` → `condensed`;
  - otherwise `included`.

  It has no DB imports; `appSettings.ts` already imports this module.
- `convex/ai/pipeline.ts:267-289` (`recordContextBudget` helper): also pass `maxDocuments: report.budget.maxDocuments`. The iterative path (`iterative.ts:155`) calls the same helper.
- `convex/generations.ts:939-970` (`recordContextBudget` mutation): accept optional `maxDocuments`, and patch `inclusion: sourceInclusion(entry)` plus `contextBudget.maxDocuments`.
- `convex/lib/contextInclusion.ts` (new, pure): `assembleContextInclusion({sources, unfrozenDocuments, fallbackCap})` → `{cap, documentsInContext, documentsTotal, rows: [{key, kind: "transcript"|"document", label, inclusion: Inclusion|null, reason?: "archived"|"unreadable"}]}`.
  - Transcript rows come first, in reservation order.
  - A transcript that has a `transcript_digest` row (matched on `transcriptId`) takes the digest's outcome: an included digest reads `condensed`, an excluded one `not_included`.
  - Rows are skipped for kinds `writer_storyline` and `transcript_digest`.
  - Document labels come from `parseSourceLabel(label).fileName` (`convex/lib/settingsDocument.ts:119`).
  - Status is `row.inclusion ?? (row.contextBudget ? sourceInclusion(row.contextBudget) : null)`.
  - The cap is the largest recorded `contextBudget.maxDocuments`, or `fallbackCap` if none is recorded.
  - `documentsInContext` counts document rows that are included or condensed; `documentsTotal` counts all document rows. Transcripts are excluded from both counts (glossary: Supporting Documents).
- `convex/generations.ts` (new public query `getContextInclusion({generationId})`):
  - Returns `null` for an outsider or a missing generation, following the auth pattern at `getGeneration` (`:190-199`).
  - Reads sources `by_generationId` (`.take(200)`), and project documents `by_projectId` (`.take(100)`) with `createdAt <= generation.startedAt` and no frozen row. Those are unfrozen: `archived` → reason `archived`; empty text → `unreadable`. They mirror the skip rule of `reserveGeneration` at `:512`.
  - `fallbackCap` comes from `analyzerContextBudget(ctx)` (already imported, `:929`).
  - Reservation takes `.take(50)` documents (`:508-511`), so 40 fit. Upload (`documents.ts:45`) has no count limit.
- `convex/lib/roleCapabilities.ts:82-105`: add `getReportEditAccessOrNull(ctx, projectId)`, with the same decision as `requireReportEditAccess` but non-throwing. Refactor the throwing one onto it.
- `convex/briefs.ts` (`getBrief` and `listBriefEntries` currently have no auth and use unbounded `.collect()`):
  - `getBrief({generationId})`:
    - checks access;
    - resolves the generation's Brief, then the latest version for its `(projectId, inputsHash)` (`by_projectId_and_inputsHash` desc, first);
    - reads entries with `.take(500)`, each joined to its source's `label` and `kind` (the distinct `sourceId`s);
    - returns the brief fields plus `entries`, `generationBriefId`, `editedSinceGeneration` (`latest._id !== generation.briefId`), `canEdit` and `storylineOrigin` (stored, or else derived from `origin`).
  - `listBriefEntries`: access check and `.take(500)`.
  - `saveEntryEdit`, `:72-226`:
    - `entryId` becomes optional, with a new `editedStorylineText` for the Brief-level Storyline.
    - Editing a `storyline` *entry* no longer writes `storylineText`.
    - `use_evidence` sets `storylineText` to `args.alternativeText ?? question.alternativeText`.
    - `storylineOrigin` is computed as follows:
      - `writer` when the previous text was empty and the new text is non-empty;
      - `edited` for any other Storyline change;
      - otherwise carried over.
    - The storyline edit distance is computed on `storylineText` (`computeEditDistance(...).ped`).
    - The edited entry copy gets `edited: true`.
    - Empty text gives `domainError("INVALID_INPUT")`. An unchanged save returns the current `briefId`.
    - Replace the `as any` with literal-union validators, and `.collect()` with `.take(500)`.
    - The `BRIEF_STALE` fence is unchanged.
- `convex/writerProfiles.ts:703-778` (`getGenerationWriterSettings`): read-only reuse. It supplies `noProfileLine` and `offer.supplyPath`. Import `settingsSupplyLabel` for the banner sentence (`src/lib/settingsPrefill.ts:20` shows the import path).
- Reuse the tests' harnesses: `convex/ai/brief.test.ts` `briefFixture` (`:749-757` shows the `anyApi.briefs.*` calls), and `convex/ai/trustedContext.test.ts:244` ("renders at most maxDocuments").

Frontend:
- `src/lib/brief.ts` (new, pure) holds:
  - label maps: inclusion words, eligibility reasons, confidence words;
  - `inclusionHeader(...)` → "12 of 40 documents in context · cap 12";
  - `groupBrief(entries)` (storyline claims, exclusions, confidence map, glossary, open questions);
  - `changeSummary(groupEntries)` → "2 added · 1 removed", or `null`;
  - `entryOrigin(entry)` (`edited` or `derived`);
  - `sourceChipLabel(entry)`, which appends "digest" for `transcript_digest` sources;
  - `offerSentence(offer)`, built on `settingsSupplyLabel`.
- `src/lib/components/brief/BriefRail.svelte` (new, presentational):
  - Props are data plus callbacks only: `{brief, inclusion, writerSettings, generationId, canEdit, offerDismissed, onSaveEntry, onSaveStoryline, onResolveQuestion, onDismissOffer, onRegenerate?, saveError}`.
  - Layout: `aside aria-label="Brief"`. Groups are headings with a Disclosure each; Inputs and Storyline start open, the rest closed.
  - Inline edit: click or Enter opens a `field-control` textarea on `bg-chrome` with a primary-light focus ring. Blur or Cmd/Ctrl+Enter saves; Esc reverts.
  - Chips: origin, reason and source pills. The source chip is a bits-ui `Popover` showing the source label and `exactExcerpt`; focus returns to the chip.
  - Question callout, with an `aria-live="polite"` announcement.
  - Diff marker: a 2px left bar.
  - "Regenerate with this Brief" is a secondary `Button` at the bottom.
  - Visual specs are in DESIGN.md Components › brief-rail, brief-entry, origin-chip, source-chip, storyline-question, inclusion-row and save-settings-banner.
- `src/lib/components/brief/BriefRailPanel.svelte` (new, container):
  - Uses `useQuery` on `api.briefs.getBrief`, `api.generations.getContextInclusion` and `api.writerProfiles.getGenerationWriterSettings`, plus `useMutation(api.briefs.saveEntryEdit)` with `expectedBriefVersion`.
  - Maps `BRIEF_STALE` to the stale copy via `userErrorCode` (`$lib/errors`).
  - Stores offer dismissal in localStorage `banhall_brief_offer_dismissed:<projectId>` inside try/catch.
  - In rail mode it wears QARailPanel's card chrome (`qa/QARailPanel.svelte:51-81`: header with a close button). It renders nothing when all three queries resolve empty.
- `src/lib/components/brief/BriefLauncher.svelte` (new): a pill cloned from `qa/QALauncher.svelte`, labelled "Open Brief".
- `src/lib/components/project/CurrentProjectPage.svelte`:
  - `railView` (`:469`) gains `"brief"`, with `briefOpen` exclusive with chat and QA. Every place that opens chat or QA (`:442`, `:449`, `:1426`, `:1442`) also closes the Brief.
  - Persist `banhall_brief_open` like `banhall_qa_open` (`:489-504`).
  - The divider and `aside` width conditions (`:1318`, `:1348-1351`) include `briefOpen`.
  - Launcher `right` offsets step 3.5rem per visible pill.
  - The rail renders `BriefRailPanel` for `report.generationId ?? generation._id`.
  - The page subscribes to the same three queries, so the Convex client shares the subscriptions. It derives `briefAvailable = !!brief || !!writerSettings || inclusion?.rows.some(r => r.inclusion !== null)` and shows the launcher and the rail view only when that holds.
  - `onRegenerate` calls the existing `handleRegenerate()` (`:687`), so no new generation path is added.
  - While `isGenerating` (`:918-921`), render `BriefRailPanel` (no close button) between `GenerationProgress` and `FilesPanel` (`:1219-1229`) for `generation._id`.
- Test harness: `src/lib/components/generation/GenerationRecoveryPanel.component.test.ts` (`render` from `vitest-browser-svelte`, the 44px check), and `src/lib/test/convex-svelte-stub.svelte.ts` (`__setQueryData("briefs:getBrief", …)`, `__mutationCalls`, `__resetConvexStub`).

## Tasks & Acceptance

**Execution:**
- `convex/schema.ts` -- the four optional widens (AD-10; no backfill).
- `convex/ai/trustedContext.ts`, `convex/ai/pipeline.ts`, `convex/generations.ts` (`recordContextBudget`) -- `sourceInclusion`, record `inclusion` and `maxDocuments`.
- `convex/lib/contextInclusion.ts` + `convex/generations.ts` `getContextInclusion` -- the one inclusion read.
- `convex/lib/roleCapabilities.ts` -- `getReportEditAccessOrNull`.
- `convex/briefs.ts` -- the auth'd, latest-version `getBrief`; `listBriefEntries` auth; the `saveEntryEdit` changes.
- `src/lib/brief.ts`, `src/lib/components/brief/{BriefRail,BriefRailPanel,BriefLauncher}.svelte`, `CurrentProjectPage.svelte` -- the rail view, the generating placement and the launcher.
- Tests (never skipped, never vacuous):
  - `convex/ai/trustedContext.test.ts`: 40 documents under the default budget give 12 `included` document sources and 28 not; `sourceInclusion` covers all three outcomes plus a zero-length inclusion.
  - `convex/lib/contextInclusion.test.ts`: digest to `condensed`; the archived and unreadable reasons; a legacy row gives `null`; the cap fallback; counts exclude transcripts.
  - `convex/contextInclusion.test.ts` (convex-test):
    - 40 `documents.uploadDocument` calls, then `requestGeneration`, give 40 `project_document` sources;
    - `recordContextBudget`, fed from a real `buildTrustedContext` report, then gives `getContextInclusion` → 12 in context, 40 total, cap 12, and per-row `inclusion` stored;
    - an outsider gets `null`.
  - `convex/briefs.test.ts` (convex-test, reusing the `brief.test.ts` fixture pattern):
    - outsider → `null`;
    - after an edit, `getBrief` returns the new version with `editedSinceGeneration`;
    - the Storyline edit, the supply-into-empty and the claim edit, each per the matrix;
    - `use_evidence` versus `keep_storyline`;
    - an unchanged save inserts nothing;
    - empty text is rejected;
    - `canEdit` is false for a user lacking `report.editProse`;
    - the next generation with the same `inputsHash` reuses the edited version, and `renderBriefForGeneration` contains the edited text verbatim.
  - `src/lib/brief.test.ts`: every helper.
  - `src/lib/components/brief/BriefRail.component.test.ts` and `BriefRailPanel.component.test.ts` (browser; run `npm run test:component`) -- every AC below at the component surface.

**Acceptance Criteria:**
- Given a generation with 40 attached documents and cap 12, when the Brief rail renders, then it lists every document with exactly one of included, condensed or not included, the header reads "12 of 40 documents in context · cap 12", and no `not_included` document shows the word "included".
- Given a Brief, when the writer edits the Storyline or an entry and saves with Cmd/Ctrl+Enter, then `saveEntryEdit` is called once with `projectId`, `briefId`, `expectedBriefVersion` and the verbatim text. Esc or an unchanged blur calls nothing.
- Given a stored edit, when the rail re-renders, then the edited entry carries the *edited* origin chip and "Regenerate with this Brief" appears. Pressing it invokes the page's existing regenerate action.
- Given an unresolved Storyline question, when the writer presses "Use the section's evidence" or "Keep the Storyline", then `saveEntryEdit` receives `resolvedBy` `use_evidence` or `keep_storyline` respectively.
- Given `noProfileLine` or an `offer`, when the Inputs band renders, then the line shows, the banner's button links to `/settings/writing?fromGeneration=<id>`, and dismiss hides it.
- Given a generation that is still running, when the progress view renders, then the Brief's Inputs band is visible below the progress card before any report exists.
- Given a rendered Brief rail, when its elements are inspected, then no element's computed `font-weight` exceeds 500, every button and disclosure header is at least 44px tall, and no button reads approve, accept or confirm.

## Spec Change Log

## Review Triage Log

### 2026-09-11 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 9: (high 0, medium 4, low 5)
- defer: 5: (high 0, medium 3, low 2)
- reject: 14: (high 0, medium 4, low 10)
- addressed_findings:
  - `[medium]` `[patch]` A legacy generation could still light up the Brief: `getContextInclusion` synthesized a `not_included` row for every archived or unreadable unfrozen document, and both availability gates tested "any row has a status", so a pre-feature generation with one archived file rendered the launcher and an Inputs band headed "0 of N documents in context · cap 12" — a cap that run never used. The assembler now reports `recorded` (true only when a frozen row carries `inclusion` or `contextBudget`), and both gates read it.
  - `[medium]` `[patch]` The rail and the generating panel described different generations: the page derived `report.generationId ?? latest` while the `isGenerating` branch passed `generation._id`, so a regeneration showed two disagreeing Briefs at once. One derived `briefGenerationId` now feeds both.
  - `[medium]` `[patch]` A readable document the reservation's `.take(50)` never froze vanished from the band and from `documentsTotal`, breaking CAP-17's "lists every document". Every pre-reservation document now gets a row; the third reason is `not_captured`.
  - `[medium]` `[patch]` No test covered the page wiring the story's acceptance depends on (rail exclusivity, `banhall_brief_open` persistence and its precedence, launcher offsets, legacy absence, the generating placement). Added `src/lib/components/project/BriefWorkspace.component.test.ts`.
  - `[low]` `[patch]` `saveEntryEdit`'s version copy read a bounded 500 entries and re-inserted that prefix, so a larger Brief would lose entries permanently on every edit. It now reads one past the bound and fails loudly instead.
  - `[low]` `[patch]` `listBriefEntries` checked existence before access, so an outsider could tell a real `briefId` from a fabricated one. Access resolves first and both cases return `null`.
  - `[low]` `[patch]` `saveError` never cleared: a `BRIEF_STALE` alert survived abandoning the edit. It now clears on cancel and on any Brief version change.
  - `[low]` `[patch]` Resolving a Storyline question with `use_evidence` against an empty Storyline labelled its origin `writer`, although the text came from the section's evidence. A resolution is always `edited`.
  - `[low]` `[patch]` Two coverage gaps closed: an `inclusion: null` row is now rendered in the component fixture (label, no status word, never "included"), and the computed-weight and 44px audit now also walks the panel's rail-card chrome.

### 2026-09-11 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 1: (high 0, medium 1, low 0)
- defer: 2: (high 0, medium 1, low 1)
- reject: 14: (high 0, medium 0, low 14)
- addressed_findings:
  - `[medium]` `[patch]` `BriefRailPanel.svelte`'s `save()` derived `briefId`/`expectedBriefVersion` from the live `briefQ.data` subscription at commit time instead of the version an edit began on. Since the query is reactive, a concurrent edit landing while a field was still open would silently update `current` before save, so the mutation always passed the freshest version and `BRIEF_STALE` could never fire for the exact scenario the matrix specifies ("Stale version gives BRIEF_STALE ... keeps the draft"). `BriefEditableText` now reports when a field opens (`onOpen`), `BriefRailPanel` pins that version (`pinnedBrief`), and `save()` fences against the pin, not the live query. Added a regression test simulating a version landing mid-edit.

Findings rejected this pass, for completeness: silent no-ops for editing a mismatched-entry-group field and for re-resolving an already-resolved question (both unreachable through the current UI, which only ever sends fields matching an entry's own group and hides a question once resolved); untrimmed Storyline/entry text (the matrix specifies verbatim storage); the >500-entry edit lockout (already accepted by design in the prior pass's Design Notes); a `getBrief` N+1 read over an entry's distinct source ids and a second `canEdit` access check (both bounded, low-impact); a hypothetical future import hazard in `src/lib/brief.ts`; missing dedicated `BriefSourceChip` popover coverage; hand-computed launcher-offset arithmetic; an unverified duplicate-`transcript_digest`-row scenario; an `onSave`-rejects-forever path that cannot occur since `save()` never rejects; an unreachable empty-`inclusion.rows` render path; and the browser component suite's exclusion from the default `loop-verify.sh` gate, which is the repo's existing, AGENTS.md-documented verification architecture (a second CI job runs it), not something this story changed.

## Design Notes

**Which version the rail shows.** It shows the latest version for the generation's `(projectId, inputsHash)`, the same one the next identical-input run reuses (story 1: `MAX(version)`). "Edited since this draft" is therefore `latest._id !== generation.briefId`, a fact that survives reloads rather than a client flag.

**Storyline model.** `storylineText` is the Storyline, and the only Storyline text `renderBriefBlock` puts in prompts. `storyline` entries are its cited supporting claims. Editing a claim changes that claim; editing the Storyline changes `storylineText`. The old behaviour, which overwrote `storylineText` with one claim, dropped the rest of the Storyline from the next prompt.

**Counting.** The header counts Supporting Documents against the cap, because the cap (`maxDocuments`) applies only to documents. Transcripts still get rows, since CAP-11's over-budget Transcript must read "condensed".

## Verification

**Commands:**
- `npx vitest run convex/ai/trustedContext.test.ts convex/lib/contextInclusion.test.ts convex/contextInclusion.test.ts convex/briefs.test.ts convex/ai/brief.test.ts src/lib/brief.test.ts` -- expected: all pass
- `npx tsc --noEmit -p convex/tsconfig.json` -- expected: 0 errors
- `bash scripts/loop-verify.sh` -- expected: all steps green
- `npm run test:component` -- expected: all pass, including both Brief suites

**Manual checks:**
- `grep -rn 'insert("generationBriefs"' convex --include='*.ts'` shows only `persistDerivedBrief` and `saveEntryEdit`.
- `grep -rn 'inclusion:' convex/generations.ts` shows the patch only in `recordContextBudget`.
- `grep -rnE 'font-(semibold|bold)|#[0-9a-fA-F]{3,6}' src/lib/components/brief` returns nothing.

## Auto Run Result

Status: done

**Summary of this pass.** This was the follow-up review pass the previous pass recommended (score 17). No new feature work was in scope; four review layers (blind hunter, edge-case hunter, verification-gap, intent-alignment) re-examined the full story-4 diff since `baseline_revision`. One real defect surfaced and was patched: the Brief rail's optimistic-concurrency fence was silently defeated for the exact scenario the spec's own I/O matrix names. Two pre-existing-shape gaps were logged as deferred work; fourteen other findings were traced to source and rejected as either matching documented, deliberate design (verbatim Storyline storage, the >500-entry lockout), unreachable through the current UI, bounded/low-impact, unverified in the actual code, or the repo's existing (AGENTS.md-documented) verification architecture rather than something this story introduced.

**Files changed this pass:**
- `src/lib/components/brief/BriefEditableText.svelte` — added an `onOpen` callback, fired when a field starts editing.
- `src/lib/components/brief/BriefRail.svelte` — added and forwarded an `onBeginEdit` prop to both `BriefEditableText` instances (the Storyline field and each entry row).
- `src/lib/components/brief/BriefRailPanel.svelte` — pins the Brief version (`pinnedBrief`) when a field opens; `save()` fences against the pin instead of the live query, and clears it once a save succeeds.
- `src/lib/components/brief/BriefRailPanel.component.test.ts` — added a regression test: a concurrent edit lands (new `_id`/version) while a field is open, and the eventual save still fences against the version the edit began on.

**Review findings breakdown:** patch 1 (medium 1, low 0, high 0); defer 2 (medium 1, low 1); reject 14 (all low); intent_gap 0; bad_spec 0.

**Follow-up review recommendation:** `false`. Patched findings this pass: high 0, medium 1, low 0; score = 3 × 1 + 1 × 0 = 3, below the threshold of 5.

**Verification performed:**
- `npx vitest run --project component src/lib/components/brief/BriefRailPanel.component.test.ts src/lib/components/brief/BriefRail.component.test.ts src/lib/components/project/BriefWorkspace.component.test.ts` — exit 0, 26 tests, including the new regression test.
- `VERIFY_COMPONENT=1 bash scripts/loop-verify.sh` — exit 0, all 10 steps: preflight, no skipped tests, Convex typecheck, svelte-check, unit tests, discovery guard, production build, both uploader harnesses, component suite (613 tests, 81 files).
- `npx tsc --noEmit -p convex/tsconfig.json` — 0 errors.
- Focused set (`trustedContext`, `lib/contextInclusion`, `contextInclusion`, `briefs`, `ai/brief`, `src/lib/brief`) — 114 tests, all passing.
- Manual checks re-run: `generationBriefs` inserts are still only the two production writers plus test fixtures; `inclusion:` in `generations.ts` is still only the `recordContextBudget` patch plus its read mapping; the hex/bold grep's only matches are `{#each}`/`{#if}` Svelte template syntax (pre-existing false positives), not real hex colors or bold weights.

**Residual risks:**
- The two newly deferred items (a >100-total-document project can undercount the Inputs band; `BriefEditableText` shows no saving indicator), plus the five carried over from the previous pass.
- The staleness fence now protects correctly against a version that changes *during* an open edit; it still cannot protect against a change landing in the sub-second window between reading the pinned value and the mutation reaching the server — an accepted, much narrower race inherent to optimistic concurrency generally, not specific to this diff.
- The browser component suite remains outside the default `loop-verify.sh` gate; this run explicitly ran it (`VERIFY_COMPONENT=1`), but a plain `bash scripts/loop-verify.sh` alone would not catch a regression in these components.

