---
title: 'One-pass convergence and Reference PD comparison'
type: 'feature'
created: '2026-09-11'
status: 'done'
baseline_revision: 'ba845a8150fba18db589e19ff794b772c75aa192'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/convex/_generated/ai/guidelines.md'
  - '{project-root}/_bmad-output/specs/spec-pd-generation/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-pd-generation/glossary.md'
  - '{project-root}/_bmad-output/specs/spec-pd-generation/touchpoints.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-Banhall-2026-09-03/ARCHITECTURE-SPINE.md'
  - '{project-root}/docs/product-domain.md'
warnings:
  - oversized
deferred:
  - summary: >-
      An all-blocked Coordinated Revision cannot be submitted, so the one case the Completion Report exists to record writes no rows.
    evidence: |-
      `bulkEditInputSchema` requires `edits.min(1)` and the coverage check requires every edit to be
      claimed by a `resolved` finding, and the prompt correctly forbids inventing a dummy edit. A
      revision where every item is blocked or conflicting therefore has no proposal, and AD-28 ties
      `chatProposalItems` to a `proposalId`, so the findings live only in the reply text. Closing it
      means either zero-edit proposals or a parentless item row; both are AD-28 amendments.
    location: >-
      convex/lib/completionReport.ts bulkEditInputSchema
    severity: medium
  - summary: >-
      Item ids renumber between turns and the persisted rows carry no revision or inventory pin, so a stored itemId cannot be resolved back to what it meant.
    evidence: |-
      Ids are positional (`r-<section>-<paragraph>-<n>`), so resolving one deviation, a note flipping
      to `applied`, or an inserted paragraph renumbers the survivors, while the prompt tells the model
      never to renumber and `chatProposalItems.itemId` stores them as durable. Pinning needs a content
      hash or `(reportId, revisionNumber)` on the row, which is a schema and AD-28 change.
    location: >-
      convex/lib/deviationInventory.ts itemId; convex/schema.ts chatProposalItems
    severity: medium
  - summary: >-
      Reference PD counterpart pairing is positional with no alignment step, so one inserted paragraph shifts every later pair.
    evidence: |-
      `assembleDeviationInventory` pairs draft paragraph k with reference paragraph k. The model is
      then asked to name wording and terminology differences from a counterpart that may belong to a
      different part of the narrative. Real alignment (structural or similarity-based) is a design
      addition, not a patch.
    location: >-
      convex/lib/deviationInventory.ts referenceTexts
    severity: medium
  - summary: >-
      Every bounded read behind the inventory and the open questions truncates silently, with no signal to the model, and Brief entries are taken before they are filtered.
    evidence: |-
      `MAX_INVENTORY_NOTES` (1000), `MAX_PROJECT_DOCUMENT_ROWS` (200) and `MAX_BRIEF_ENTRY_ROWS`
      (500) all cut before filtering. A Brief with more than 500 entries of other groups can return
      zero open questions while the prompt asserts that an absent block means no Brief. Nothing is
      reported as truncated and no test covers an over-limit read.
    location: >-
      convex/chatV2.ts getDeviationInventoryContext, openQuestionsFor
    severity: medium
  - summary: >-
      The evidence budget's spend order can starve the open-questions block on exactly the large reports where converging matters.
    evidence: |-
      Defaults are `totalTokens: 60_000` against `report 40_000 + analysis 15_000 + decisions 10_000`,
      and open questions are spent after the decisions. On a full-length report the remaining total is
      already exhausted, so the block renders as a bare omission notice while the prompt instructs the
      model to quote from it. Reordering the spend is a budget-policy decision.
    location: >-
      convex/ai/chatEvidence.ts buildChatEvidence
    severity: medium
  - summary: >-
      No reader exists for chatProposalItems: the rows have one writer and no consumer.
    evidence: |-
      The spec defers the ProposalCard surface, and the diff adds no audit query either, so the
      persisted Completion Report is observable only from tests. A writer-facing card and an internal
      audit read are both still owed.
    location: >-
      convex/schema.ts chatProposalItems
    severity: medium
  - summary: >-
      A Coordinated Revision's replacement prose gets no server-side line or word cap check, so the CAP-15 Locked-cap guarantee rests on the model plus one never-run live fixture.
    evidence: |-
      `newText` passes only through `scrubBannedWordsUnlessWaived`. `sectionMetrics` and the Locked
      caps are already available (`convex/lib/lineLimits.ts`, used by the generation Self-check), but
      nothing applies them to a proposal, and no test asserts that a cap-breaching proposal is refused
      or reported `conflicting`.
    location: >-
      convex/chatV2.ts saveProposal
    severity: medium
  - summary: >-
      docs/product-domain.md and docs/system-map.md were not updated for the new table, the two new chat tools and the new evidence block.
    evidence: |-
      Story 3 recorded `settingsDocumentAnalyses` and its AD-19 scoping in `docs/product-domain.md`.
      This story adds `chatProposalItems`, `deviationInventory`, `compareReferencePd` and the
      OPEN QUESTIONS block with no corresponding entry, and `docs/system-map.md` still reads
      "8 of 49 tables".
    location: >-
      docs/product-domain.md; docs/system-map.md
    severity: low
  - summary: >-
      The prompt states a 30-item ceiling for one card while the schema accepts 80, and nothing tells the model what to do with a longer list.
    evidence: |-
      `COMPLETION_REPORT_TARGET_ITEMS` is the spec's N <= 30 bound inside the tool's own 40-edit /
      80-finding caps. A 35-item writer list has no sanctioned behaviour, and the most likely reading
      (two cards) breaks the one-proposal guarantee the harness fixture asserts.
    location: >-
      convex/ai/prompts.ts buildChatSystemPromptV2; convex/lib/completionReport.ts
    severity: low
  - summary: >-
      The harness's mixedProvenance check can pass without the model ever forwarding the writer's content Deviations, because the stubbed inventory ignores its input.
    evidence: |-
      `stubbedInventory()` in `scripts/chat-behavior-eval.mjs` always renders the six content items,
      whatever the model passed as `contentDeviations`, so the c- ids are in the tool result either
      way and the InventoryAnchorError retry path is never exercised live. The stub also hardcodes
      copies of the production refusal strings rather than importing them.
    location: >-
      scripts/chat-behavior-eval.mjs stubbedInventory
    severity: low
  - summary: >-
      The harness records the two read-only tool calls as rejected proposals.
    evidence: |-
      The stub computes `pairs = []` for `deviationInventory` and `compareReferencePd`, so
      `validation.ok` is false and each call is captured with `accepted: false`. No current check
      reads that field for these tools, but any future check on acceptance counts would score a
      successful inventory call as a failure.
    location: >-
      scripts/chat-behavior-eval.mjs tool stub executor
    severity: low
  - summary: >-
      The live chat-behaviour re-run for Open Question 7 is outstanding; no live-model verdict exists for any of the three fixtures.
    evidence: |-
      `ANTHROPIC_API_KEY` is unset in this worktree and the harness is opt-in and billable, so the
      16/16 bar (CAP-13), the converge guard (CAP-14) and the Reference PD comparison (CAP-15) are
      proven only deterministically. The exact commands, the before/after `--baseline 6c4f50b`
      comparison and the pass criteria are recorded in
      `docs/oq7-rev-g-bulk-edit-replay-2026-09-11.md`; owner is the key holder.
    location: >-
      scripts/chat-behavior-eval.mjs; docs/oq7-rev-g-bulk-edit-replay-2026-09-11.md
    severity: high
---

<intent-contract>

## Intent

**Problem:** CAP-12 to CAP-15 are unbuilt. The assistant cannot list the draft's paragraphs against the Writer Profile, so a writer's 16-item Deviation list is re-typed each turn and answered partially (Larry's Rev G list: 4 of 16). PR #8's `proposeBulkEdits` proves every *edit* maps to a finding but nothing ties the findings back to the items the writer actually listed, there is no `resolved | blocked | conflicting` Completion Report, findings are not persisted, "how do I help you converge?" can still answer with a document for the writer to author, and a Reference PD cannot be compared.

**Approach:** Realize AD-28. Two new read-only chat tools (`deviationInventory`, `compareReferencePd`) build the same paragraph-anchored item list — one entry per report paragraph, rule Deviations from stored `complianceNotes`, writer-added content Deviations and Reference PD differences joined into the same shape with stable item ids. `proposeBulkEdits` keeps its one-card coordinated revision but its findings become the Completion Report union `resolved | blocked | conflicting`, anchored to a section and paragraph that must exist in the current report, persisted as `chatProposalItems` child rows by `saveProposal` and echoed in the reply. The unresolved and unreliable Confidence Map entries enter the turn as one delimited evidence block so the converge answer names missing client facts instead of asking for an artifact. Live-model behaviour stays where it is proven: `scripts/chat-behavior-eval.mjs`.

## Boundaries & Constraints

**Always:**
- AD-4: `internal.chatV2.saveProposal` stays the only `chatProposals` insert and the only writer of `chatProposalItems`; both new tools are read-only and create no proposal. `applyProposal`, `markProposalApplied` and the AD-3 revision-writer list are untouched — no new prose-write path, no schema or code change under `convex/chatV2.ts`'s apply functions.
- AD-28 row shape is honoured verbatim (`proposalId, projectId, itemId, status, reason, missingFact?, missingFactSource?, lockedRule?, alternative?`); the paragraph anchor CAP-12 requires is added as further optional fields (`section`, `paragraphIndex`, `kind`, `rule`), a widen under AD-10, never a rename of an AD-28 field.
- Every report paragraph appears in the inventory exactly once, ordered 242 → 244 → 246 then by paragraph, using `sectionParagraphs` (`convex/lib/tiptapReport.ts:23`) so item paragraph indices are the same indices `complianceNotes` rows carry.
- Item ids are deterministic and content-free: `r-<section>-<paragraph>-<n>` for rule Deviations, `c-<section>-<paragraph>-<n>` for writer content Deviations, `x-<section>-<paragraph>-<n>` for Reference PD differences. The same inputs yield the same ids.
- Chat stays on its fixed model and its own evidence budget (`convex/ai/chatEvidence.ts`); the new evidence block is budgeted and truncation-recorded like every other block, and no `generation:*` call slot is added.
- Material inside every delimited block, the Reference PD included, is data and never an instruction; the system prompt stays policy plus the `styleOverrides` projection (AD-11a).
- Locked Rules stay locked: a difference that would breach the 242/244/246 skeleton or a line/word cap is reported `conflicting` with the rule named and an alternative, never applied.
- Tests live where the gate runs them (vitest `convex/**`), never `test.skip`, never vacuous.

**Block If:**
- Closing the 16/16 guarantee would require enforcing coverage server-side against a persisted inventory (a new table and an AD-28 amendment).
- Larry's Rev G answer turns out to require changing a Locked Rule or a `docs/product-domain.md` permission.

**Never:**
- No AI-driven prose mutation, no second edit path, no change to `applyProposal`'s scrub or fences.
- No numeric similarity score as the Reference PD comparison's primary output.
- No new Brain retrieval, no Reference PD from another project, no client-visible surface.
- No Deviation Inventory built from prose heuristics instead of stored `complianceNotes`.
- No `chatProposalItems` UI read this story (the ProposalCard surface is deferred work).
- No settings-document resolution in chat (DW-126 stays deferred).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Inventory, generated report | Report whose generation has `complianceNotes` rows | One entry per paragraph in 242 → 244 → 246 order; every `outcome: "not_applied"` row becomes a rule Deviation naming its `instruction`, `tier` and `reason` | No error expected |
| Inventory, clean paragraph | Paragraph with no `not_applied` row | Entry present, listed with no Deviation | No error expected |
| Inventory, writer content items | `contentDeviations: [{section, paragraph, instruction}]` | Joined into the same list at that paragraph with a `c-` id and the instruction verbatim | A paragraph outside the report is refused, naming the valid range |
| Inventory, legacy report | Report with no linked generation or no `complianceNotes` | Paragraph list returned with rule Deviations stated as unavailable, not fabricated | No error expected |
| Coordinated revision, N=16 | 16 findings (rule + content), ≤40 edits | One proposal, 16 `chatProposalItems` rows, 16 checklist lines echoed with the original ids | No error expected |
| Coordinated revision, blocked item | Item whose fact is absent from the Dump | `blocked` with `reason`, `missingFact` and `missingFactSource`, no edit mapped | Schema refuses `blocked` without a missing fact and its source |
| Coordinated revision, conflicting item | Item that would breach a Locked cap | `conflicting` with `reason`, `lockedRule` and `alternative` | Schema refuses `conflicting` without a locked rule and an alternative |
| Coordinated revision, bad anchor | Finding naming paragraph 9 of a 5-paragraph section | Proposal NOT created; tool returns the section's real paragraph count so the model retries | Refused in `saveProposal`, no rows written |
| Coordinated revision, uncovered edit | An edit no finding maps to | Rejected by the tool schema before any mutation | `superRefine` message names the coverage rule |
| Converge question | "What can I do to help you converge?" | Text answer: concrete changes, or the unresolved/unreliable Confidence Map facts as questions for the client | No tool call; a reply asking the writer to author a document fails the harness fixture |
| Reference PD comparison | `previous_pd` document named in the request | Paragraph-anchored differences (structure, Storyline, terminology) as `x-` items offered as a Coordinated Revision | Unknown or archived file: the tool lists the available `previous_pd` file names |
| Reference PD absent | Project has no `previous_pd` document | Tool says none is attached and how to attach one | No error expected |

</intent-contract>

## Code Map

Line numbers drift; grep the symbol. Baseline `ba845a8`.

- `convex/ai/chatAgentV2.ts:114-160` -- `makeProposeBulkEdits`. Replace the inline zod object with `bulkEditInputSchema` from the new pure module; pass `findings` through to `saveProposal` as `items`; keep the existing `saveProposal` result handling (`:150-159`) and the checklist echo, reworded to the new statuses. `:267-275` `buildChatTools` gains `deviationInventory` and `compareReferencePd`; `CHAT_TOOLS` (`:275`) and the per-turn build at `:426` both pick them up automatically. `searchBrain` (`:170-232`) is the pattern for a read-only tool that resolves its own context through `ctx.runQuery(internal.chatV2.getThreadBrainContext, {agentThreadId})` — copy that shape, do not add args the model could use to reach another project.
- `convex/lib/completionReport.ts` (new, pure; imports `zod` and `convex/lib/tiptapReport` only) --
  - `completionReportFindingSchema`: discriminated union on `status` over `resolved` (`editNumbers`), `blocked` (`reason`, `missingFact`, `missingFactSource`), `conflicting` (`reason`, `lockedRule`, `alternative`); every member carries `id`, `section`, `paragraph` (1-based), `kind: "rule"|"content"|"reference"`, and `rule` required when `kind === "rule"`.
  - `bulkEditInputSchema`: the existing `edits` array (min 1, max 40) plus `findings` (min 1, max 80) and the existing `superRefine` coverage check (unique ids, every edit number in range, every edit covered) extended with the `kind`/`rule` rule.
  - `completionReportRows(findings, {proposalId, projectId})`: AD-28 rows, one per finding, in input order.
  - `completionReportChecklist(findings)`: the reply's echo text, `id: status: detail`, ids preserved verbatim.
  - `COMPLETION_REPORT_TARGET_ITEMS = 30` as the documented spec bound inside the tool's own 80 cap.
- `convex/lib/deviationInventory.ts` (new, pure; imports `convex/lib/tiptapReport` and `shared/styleOverrides` only) -- `assembleDeviationInventory({sections, notes, contentDeviations, referenceSections})` returns `{paragraphs: [{section, paragraph, text, items}], items: [...], rulesAvailable: boolean}`. Paragraph order 242 → 244 → 246; `sectionParagraphs` for the split; rule items from `notes` where `outcome === "not_applied"`, grouped by `(section, paragraphIndex)` with whole-section rows attached to paragraph 1 and labelled as section-scoped; `n` is the 1-based position within a paragraph's items of that kind, so ids are stable. `renderInventory(result)` produces the tool's reply text. No DB and no Convex imports, so it is unit-testable without `convexTest`.
- `convex/chatV2.ts:885-1010` -- `saveProposal` gains `items: v.optional(v.array(completionReportItemValidator))`. After the existing `chatProposals` insert (`:994`), insert one `chatProposalItems` row per item with `proposalId` and `thread.projectId`. Before inserting, validate every item's `(section, paragraph)` against the report's own paragraph counts (`extractReportSections` + `sectionParagraphs`) and return `{ok: false, reason}` naming the real counts when one is out of range — the same fail-closed shape the target checks at `:961-975` already use, so no rows are written on refusal. The `toolCallId` idempotency short-circuit (`:929-936`) must return before any item insert so a retried tool call cannot double-write rows.
- `convex/chatV2.ts:1016-1030` -- `getThreadBrainContext` is the template for the two new internal queries. Add:
  - `getDeviationInventoryContext({agentThreadId, referenceFileName?})`: resolves the thread's report, its `generationId` (falling back exactly as `getChatContextV2:...` does — linked generation first, never a different project), reads `complianceNotes` `by_generationId_and_section` (`.take(1000)`, candidate-scoped through the same selected-candidate resolution `convex/complianceNotes.ts:30-52` performs), returns the three section texts from `extractReportSections`, the `not_applied` rows, and — when `referenceFileName` is set — the matching non-archived `previous_pd` `projectDocuments` row's content plus the list of available `previous_pd` file names. Bounded reads only.
- `convex/chatV2.ts:836-884` -- `getChatContextV2` returns `openQuestions`: at most 20 `generationBriefEntries` of group `confidenceMap` with `confidence` in `unresolved | unreliable` from the generation's Brief (`briefId`), each as `{text, confidence, sourceLabel}`; `[]` when there is no Brief. Read the brief entries `by_briefId` (see `convex/briefs.ts:82-127` for the join to `generationSources.label`) with an explicit `.take(500)` then filter, so the read is bounded.
- `convex/ai/chatEvidence.ts:94-103,123-130,311-472,485-511` -- `EVIDENCE_LABELS` gains an open-questions label; `ChatTurnContext` gains `openQuestions?`; `buildChatEvidence` emits one `labelledBlock` after the decisions block, under the same per-block budget and truncation accounting, and omits it entirely when the list is empty (so the byte-stability tests for the no-Brief case keep passing).
- `convex/ai/prompts.ts:962-990` -- `buildChatSystemPromptV2`'s "How to act" and "Rules for edit tools". Add the two read-only tools to the decision list; restate the bulk checklist statuses as `resolved | blocked | conflicting`; add the CAP-14 guard ("never ask the writer to author a settings document, storyline, exclusion list or glossary; name the missing client facts from the open questions block instead") and the CAP-15 rule (name paragraphs, never a score; a Locked-Rule breach is `conflicting`). `:976` and `:986` are the two existing lines that must move to the new status names so the prompt and the tool cannot drift.
- `convex/schema.ts:917-970` -- add `chatProposalItems` after `chatProposals`: `{proposalId: v.id("chatProposals"), projectId: v.id("projects"), itemId: v.string(), status: resolved|blocked|conflicting, reason: v.string(), missingFact?: v.string(), missingFactSource?: v.string(), lockedRule?: v.string(), alternative?: v.string(), section?: "242"|"244"|"246", paragraphIndex?: v.number(), kind?: rule|content|reference, rule?: v.string(), createdAt: v.number()}`, index `by_proposalId`. Register it project-scoped for AD-19 alongside the story-1/3 tables (`convex/lib/projectScopedTables.ts`).
- `scripts/chat-behavior-eval.mjs:36-60,88-110` -- the `sixteen-profile-deviations` fixture's `everyFindingMapped` check moves from `"proposed"` to `"resolved"`; its instruction list becomes 10 rule plus 6 content Deviations routed through a stubbed `deviationInventory`, so the fixture is the mixed list AD-28 requires. Add `converge-request` (prompt "what can I do to help you converge?"; checks: no edit tool, no request for a writer-authored document, references an open question) and `reference-pd-diff` (checks: `compareReferencePd` called, paragraphs named, no bare numeric score, any Locked-Rule breach reported `conflicting`). The stub executor at `:103-118` is where the two new tools return synthetic results.
- `docs/oq7-rev-g-bulk-edit-replay-2026-09-11.md` (new) -- the Open Question 7 record (see Design Notes).
- `convex/ai/chatAgentV2.ts` (review pass) -- the three tool bodies are exported as `runDeviationInventory`, `runCompareReferencePd` and `runProposeBulkEdits` over a minimal `ChatToolCtx` (`threadId?`, `messageId?`, `runQuery`, `runMutation`); each `createTool` `execute` is a one-line delegation. `createTool` injects its ctx through `this`, so the bodies are the only testable seam for the `items`, `referenceSections` and `contentDeviations` hand-offs.
- `convex/complianceNotes.ts` (review pass) -- `selectedCandidateRunId` is exported and shared with `getDeviationInventoryContext`, so the selected-candidate scoping exists once.
- `src/lib/chat/turnParts.ts` (review pass) -- writer-facing trace copy for `proposeBulkEdits`, `deviationInventory` and `compareReferencePd`; only `proposeBulkEdits` joins `ARTIFACT_TOOLS`, because the two read-only results are model-facing text, not a card.
- `scripts/chat-behavior-checks.mjs` (new, plain JS) -- the harness's CAP-14 and CAP-15 grading predicates (`asksWriterForArtifact`, `mentionsNumericScore`, `namesParagraph`), extracted from the fixture bodies so the only enforcement of the converge guard and the no-score rule is unit-testable in the gate. Harness-side on purpose: `--baseline` rewrites `convex/` and `shared/` from the revision under test, and the grading rules must not be rewritten with it.
- Read-only evidence, do not change: `convex/lib/passageEdits.ts` (the coordinated-revision validator already enforces unique, non-overlapping targets), `convex/complianceNotes.ts` (the one `complianceNotes` read), `convex/lib/tiptapReport.ts:23,133` (`sectionParagraphs`, `extractReportSections`), `convex/lib/selfCheckRules.ts` (the row producer whose `paragraphIndex` the inventory must match), `.factory/intake/20260908-chat-behavior-and-privacy/answer.md` (the Rev G incident record and the proposed response contract), `convex/chatProposals.test.ts` (the `convexTest` + `@convex-dev/agent/test` setup the new suite reuses).

## Tasks & Acceptance

**Execution (every item is in scope for this run):**
- `convex/lib/completionReport.ts` -- new pure module: findings schema, `bulkEditInputSchema`, row builders, checklist renderer -- so the Completion Report contract is testable without the agent SDK and the prompt, the tool and the rows cannot drift.
- `convex/lib/deviationInventory.ts` -- new pure module: `assembleDeviationInventory` + `renderInventory` -- CAP-12's "every paragraph exactly once" is a pure function, not a tool-body side effect.
- `convex/schema.ts` -- add `chatProposalItems` and register it project-scoped.
- `convex/chatV2.ts` -- `saveProposal` accepts and persists `items` with anchor validation and idempotency; add `getDeviationInventoryContext`; extend `getChatContextV2` with `openQuestions`.
- `convex/ai/chatEvidence.ts` -- the open-questions evidence block.
- `convex/ai/chatAgentV2.ts` -- `deviationInventory` and `compareReferencePd` tools; `proposeBulkEdits` on the new schema, passing `items` and echoing the new checklist.
- `convex/ai/prompts.ts` -- tool routing, status rename, CAP-14 guard, CAP-15 rule.
- `docs/oq7-rev-g-bulk-edit-replay-2026-09-11.md` -- the Open Question 7 record: per Rev G item class, what PR #8's contract already guarantees, what it does not, and the live-model command that is still outstanding, each claim citing an assertion in `convex/lib/completionReport.test.ts` or a `git show 6c4f50b:<file>` inspection.
- `scripts/chat-behavior-eval.mjs` -- the mixed 16-item fixture and the two new fixtures.
- `scripts/chat-behavior-checks.mjs` -- extract the harness's content predicates so they are gate-testable.
- Tests:
  - `convex/lib/deviationInventory.test.ts` (new): every paragraph once and in build order for a three-section report; a `not_applied` row becomes a rule Deviation naming rule, tier and reason; an `applied` row produces none; a whole-section row lands on paragraph 1 labelled section-scoped; writer content Deviations join at their paragraph with the instruction verbatim; ids are stable across two identical calls and unique across 40 items; a legacy report with no notes reports rules unavailable rather than an empty clean bill; a paragraph index outside the section is refused.
  - `convex/lib/completionReport.test.ts` (new): the schema accepts a 16-item mixed list of which 14 `resolved`, 1 `blocked`, 1 `conflicting`; rejects a duplicate id, an uncovered edit, an out-of-range edit number, `blocked` without `missingFact`/`missingFactSource`, `conflicting` without `lockedRule`/`alternative`, and `kind: "rule"` without `rule`; `completionReportRows` is 1:1 and order-preserving; `completionReportChecklist` prints every id exactly once. Plus the **Rev G replay** block: the historical 4-of-16 call shape is schema-valid under PR #8's contract and remains schema-valid now (coverage of a writer's *listed* items is not a server guarantee), while a finding whose paragraph anchor does not exist is refused — the two assertions the OQ7 record cites.
  - `convex/chatProposalItems.test.ts` (new, `convexTest`): a bulk proposal with 16 items writes exactly 16 rows carrying the tool's ids, statuses and anchors; a second `saveProposal` with the same `toolCallId` writes none; an out-of-range anchor writes neither the proposal nor any row; a stopped turn writes neither; `applyProposal` on that proposal behaves exactly as before and leaves the rows untouched.
  - `convex/chatContext.test.ts` (extend): `getChatContextV2` returns at most 20 unresolved/unreliable `confidenceMap` entries for the report's own generation, `[]` with no Brief, and never an `established` entry.
  - `convex/ai/chatEvidence.test.ts` (extend): the open-questions block is delimited and labelled, absent when the list is empty, and the system string stays byte-identical with and without it (AD-11a).
  - `convex/ai/prompts.test.ts` (extend): the chat prompt names all five tools, carries the three Completion Report statuses and no longer contains `proposed`/`gap`/`conflict` as status words, and carries the CAP-14 no-writer-artifact guard.
  - `convex/chatDeviationInventory.test.ts` (new, `convexTest`): `getDeviationInventoryContext` returns the report's sections and only its own generation's `complianceNotes`; reports rules unavailable for a report with no generation; returns nothing for an unknown thread; resolves a lone `previous_pd` unnamed; names every available file when the requested one is unknown; treats an archived `previous_pd` as absent; offers none when the project has no `previous_pd`; and never reaches another project's `previous_pd`.
  - `tests/chatBehaviorChecks.test.ts` (new): the CAP-14 converge guard flags every request for a writer-authored artifact and allows a missing-client-fact answer, a tool-side mention of an artifact it already holds, and a cross-sentence false positive; the CAP-15 no-score predicate flags percentages, named similarity scores and n/10 ratings while allowing paragraph and section numbers.

**Acceptance Criteria:**
- Given a generated report whose sections hold 5, 7 and 6 paragraphs, when the writer asks for the Deviation Inventory, then the reply lists 18 paragraph entries in 242 → 244 → 246 order, each exactly once, and every `complianceNotes` row with `outcome: "not_applied"` appears as a rule Deviation naming its rule.
- Given the writer adds two content corrections to that list, when the inventory is rebuilt, then both appear at the paragraphs they name with their instructions verbatim, and `proposeBulkEdits` accepts their ids on the same footing as rule ids.
- Given a 16-item list mixing rule and content Deviations, when the writer asks to bring all sixteen into alignment, then exactly one `chatProposals` row is created, 16 `chatProposalItems` rows are written in input order with the tool's ids, and the reply echoes 16 lines each marked `resolved`, `blocked` or `conflicting`.
- Given an item whose supporting fact is absent from the Dump, when the Coordinated Revision is proposed, then that item is `blocked` with the missing fact and the source that should have carried it, no edit is mapped to it, and the other items still land in the same single proposal.
- Given an item that would breach a Locked line or word cap, when the Coordinated Revision is proposed, then it is `conflicting` with the locked rule named and an alternative offered, and nothing in the proposal exceeds the cap.
- Given a finding that names a paragraph the current report does not have, when the tool calls `saveProposal`, then no proposal and no item rows are written and the tool result names the section's real paragraph count.
- Given the writer asks how to help the assistant converge, when the turn runs, then the reply proposes concrete changes or names missing client facts drawn from the unresolved and unreliable Confidence Map entries, and never asks the writer to produce a settings document, Storyline, exclusion list or glossary.
- Given a `previous_pd` document attached to the project, when the writer asks how the draft differs from it, then the differences are reported per paragraph with `x-` item ids and offered as a Coordinated Revision, with no numeric score as the primary output and any Locked-Rule breach listed `conflicting`.
- Given the project has no `previous_pd` document, when the comparison is requested, then the tool says none is attached and proposes nothing.
- Given the whole change, when `applyProposal` and `markProposalApplied` are exercised, then their behaviour, fences and snapshot writes are byte-identical to the baseline and `chatProposals` remains the only table `saveProposal` inserts into besides `chatProposalItems`.
- Given Open Question 7, when the run finishes, then `docs/oq7-rev-g-bulk-edit-replay-2026-09-11.md` records per item class what PR #8 already guarantees with a cited deterministic assertion, what it does not, and that the live-model re-run is outstanding with the exact command and the reason it could not run here.

## Spec Change Log

## Review Triage Log

### 2026-09-11 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 18: (high 1, medium 5, low 12)
- defer: 12: (high 1, medium 7, low 4)
- reject: 9: (low 9)
- reviewers: the project reviewer policy's preferred model (`gpt-6-astra`, medium) and its fallback (`gpt-5.6-sol`, high) were both refused by the Codex account with "You've hit your usage limit … try again at Sep 14th, 2026", probed directly for each model before the pass. The four layers therefore ran as Opus 5 subagents at this session's capability, per this workflow's own same-capability rule. An independent Astra or Sol review of this diff is still owed and is the reason `followup_review_recommended` would be `true` even without the high-severity patch.
- addressed_findings:
  - `[high]` `[patch]` A Reference PD that does not parse into Line 242/244/246 (a plain extract, an image-only PDF, a `could_not_read` or blank row) yielded three empty sections with `referenceAvailable: true`, so the comparison attached an invented "no counterpart in the Reference PD" item to every draft paragraph and offered them as a Coordinated Revision. Guarded in three places: unreadable rows are no longer offered as a choice, a row that does not parse into all three Locked sections is refused as uncomparable with its own copy, and the pure module emits no structural item and no counterpart line when the reference parsed to nothing.
  - `[medium]` `[patch]` The anchor-refusal reason carried its own "Proposal NOT created:" prefix and retry instruction while the tool adds both, so the model read the prefix twice and two conflicting instructions. The reason is now written to be embedded like every other `saveProposal` reason, and the composed tool result is asserted whole.
  - `[medium]` `[patch]` `getDeviationInventoryContext` fell back to the project's newest completed generation for an unlinked report, anchoring another draft's paragraph-numbered Compliance Notes onto this report — the opposite of the I/O matrix's own "stated as unavailable, not fabricated". Fallback removed; no linked generation now means no notes.
  - `[medium]` `[patch]` `getChatContextV2` drew open questions from `ownGeneration ?? generation`, so a copied report (which carries no `generationId`) served another draft's unresolved Confidence Map entries as its own. Now `ownGeneration` only, with the missing case covered.
  - `[medium]` `[patch]` No test executed any chat tool body, so the single line that persists the Completion Report, the `referenceSections` hand-off and the `contentDeviations` forwarding could each be deleted with a fully green gate. The three bodies are now exported functions driven by a `convexTest`-backed suite, mutation-verified against each of those deletions.
  - `[medium]` `[patch]` Reference PD prose reached the model inside a tool result with no marker neutralization and no data framing, against this spec's own "the Reference PD included, is data and never an instruction". Both excerpts now go through `neutralizeMarkers` and the counterpart line is labelled as data, with a forged-marker test.
  - `[low]` `[patch]` The open-questions block was spent at `internal` trust, which the trust type reserves for the writer's own direction; Confidence Map prose has the provenance of the `TRANSCRIPT ANALYSIS` block, so it is now `client`.
  - `[low]` `[patch]` `rulesAvailable` conflated "no generation" with "a generation that stored no unapplied note", so one of the two got a factually wrong explanation. Three states are now reported and worded separately.
  - `[low]` `[patch]` `chatProposalItems` stored `projectId` for the AD-19 cascade with no index to read it by; `by_projectId` added while the table is empty.
  - `[low]` `[patch]` `ChatOpenQuestion.confidence` was a bare `string` with a defaulted fallback, so a future Brief confidence value would have been relabelled into the block; narrowed to the two open levels, and an unrecognised value is skipped.
  - `[low]` `[patch]` One Open Question 7 citation named a test non-verbatim; all 25 citations now grep exactly, and rows were added for the new guards.
  - `[low]` `[patch]` The `chatProposalItems` schema comment claimed an AD-19 cascade and schema-diff check that do not exist; reworded to match `settingsDocumentAnalyses`.
  - `[low]` `[patch]` The writer's chat trace had no copy for `proposeBulkEdits`, `deviationInventory` or `compareReferencePd`, so all three read as "Working…"; copy added in the existing "suggestion" voice and pinned.
  - `[low]` `[patch]` `selectedCandidateRunId` was duplicated line-for-line from `complianceNotes.listForGeneration`; one exported helper now serves both.
  - `[low]` `[patch]` `mentionsNumericScore` flagged legitimate arithmetic ("5/10 paragraphs were rewritten", "100% of the Locked caps hold"); a ratio or percentage attached to a countable noun is no longer a score, with those negative cases added.
  - `[low]` `[patch]` `asksWriterForArtifact` missed "need", "require", "send over" and the short forms, so "I need your settings doc" passed; widened, negation-checked on the explicit form too, and its structural limit (a fixed list cannot grade the prompt's open-ended rule) stated in the module and in the OQ7 record.
  - `[low]` `[patch]` `chatProposalItems.paragraphIndex` stored a 1-based number under the name `complianceNotes` uses for a 0-based one; renamed to `paragraphNumber` while the table is empty.
  - `[low]` `[patch]` The prompt's (a) and (d) routes both claimed a comparison question with no stated precedence; (d) now explicitly beats (a) for inventory and comparison questions, pinned by a test.

### 2026-09-11 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 1, low 3)
- defer: 0
- reject: 14: (high 1, medium 7, low 6)
- reviewers: the project reviewer policy's preferred model (`gpt-6-astra`, medium) and its fallback (`gpt-5.6-sol`, high) were both probed directly via `codex exec` before this pass and both returned "You've hit your usage limit … try again at Sep 14th, 2026 7:46 PM." (same account limit the prior pass recorded). The four layers therefore ran as Sonnet 5 subagents at this session's capability, per this workflow's own same-capability rule. An independent Astra or Sol review of this diff is still owed.
- addressed_findings:
  - `[medium]` `[patch]` `getDeviationInventoryContext`'s candidate-scoped Compliance Notes read (the default `"compare"` candidateMode path, exercised on every report generated through the normal multi-candidate workflow) had no test constructing an actual selected-candidate generation; every existing case, old and new, seeded `candidateMode: "single"`. A regression in `selectedCandidateRunId`'s index arguments could silently return zero or cross-candidate rule Deviations with nothing in the gate able to catch it. Added `convex/chatDeviationInventory.test.ts` "scopes rule Deviations to the selected candidate on a compare-mode generation," seeding two `generationCandidateRuns` and a `modelSelections` row and asserting only the selected run's note reaches the inventory.
  - `[low]` `[patch]` The Reference PD structural-diff loop in `assembleDeviationInventory` only reported a missing-counterpart item when the draft's own Locked section held at least one paragraph (`draftCount > 0`), so a section entirely missing from the draft — the single largest possible structural difference — produced no reference item at all. Removed the `draftCount > 0` guard; the zero-paragraph case now falls into the existing unanchored/section-scoped path, exactly like a rule note whose section has no paragraphs. Test added.
  - `[low]` `[patch]` `completionReportLine` (the reply's echo) rendered `reason`/`missingFact`/`missingFactSource`/`lockedRule`/`alternative` untruncated, while `completionReportItem` truncates the same fields to 1000 characters before persisting the `chatProposalItems` row — a long finding could make the writer-visible checklist line diverge from the audit row, against the module's own stated goal that the prompt, the tool and the persisted rows cannot drift. `completionReportLine` now applies the same bound. Test added.
  - `[low]` `[patch]` `completionReportFindingSchema` accepted a finding whose `id` named a different kind or section than its own `kind`/`section` fields (e.g. an id starting `c-244-...` on a finding whose `section` field said `242`), so a self-contradictory anchor could reach a persisted row undetected. Added a `superRefine` cross-check between the id's embedded prefix/section and the finding's own `kind`/`section`; every existing finding fixture already agrees, so this only tightens the boundary. Two rejection tests added.

### 2026-09-11 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 1, medium 0, low 3)
- defer: 0
- reject: 18: (high 0, medium 6, low 12)
- reviewers: the project reviewer policy's preferred model (`gpt-6-astra`, medium) and its fallback (`gpt-5.6-sol`, high) were both probed directly via `codex exec` before this pass and both returned "You've hit your usage limit … try again at Sep 14th, 2026 7:46 PM." (the same account limit the two prior passes recorded, unchanged). The four layers therefore ran as Sonnet 5 subagents at this session's capability, per this workflow's own same-capability rule. An independent Astra or Sol review of this diff is still owed.
- addressed_findings:
  - `[high]` `[patch]` `renderInventory`'s per-item text (`instruction`/`reason`, sourced from `complianceNotes` rows that can be `source: "model"` free text, and from writer-supplied `contentDeviations[].instruction`) reached the model inside the `deviationInventory`/`compareReferencePd` tool result with no marker neutralization, while the paragraph body and Reference PD counterpart text in the same reply already go through `neutralizeMarkers` (added in the prior pass). This left one half of AD-11a's "data, never an instruction" boundary open to a forged `--- BEGIN/END [...] ---` delimiter riding in a Self-check verdict's `reason`/`instruction` or an echoed content Deviation. `bounded()`, the one function both `attach()` call sites route `instruction`/`reason` through, now also calls `neutralizeMarkers`, closing the gap at its single choke point. Test added (`convex/lib/deviationInventory.test.ts` "neutralizes markers forged inside an item's instruction or reason text").
  - `[low]` `[patch]` `namesParagraph` (`scripts/chat-behavior-checks.mjs`, the CAP-15 harness grading predicate this story added) matched `/paragraph\s*\d/i`, so a correct reply phrased as "the differences are in paragraphs 3 and 4" (plural) failed the check and could fail the `reference-pd-diff` fixture on genuinely correct model output. Widened to `/paragraphs?\s*\d/i`. Regression case added to `tests/chatBehaviorChecks.test.ts`.
  - `[low]` `[patch]` A writer content Deviation naming a Locked section with zero paragraphs in the current draft threw `InventoryAnchorError` with "Use a paragraph between 1 and 0" — retry guidance the model cannot act on, since no valid paragraph exists. The zero-paragraph case now gets its own message naming the section as unanchorable, instead of an impossible range. Test added.
  - `[low]` `[patch]` The CAP-14 converge-guidance prompt said the writer's "interview transcripts, attachments and saved settings are the maximum input this tool may require" inside the branch that explicitly forbids calling a tool, an orphaned reference pinned only by a literal-substring test. Reworded to "the maximum input converging may require"; the pinning test updated to match.
  - the 18 reject findings were duplicates of this story's own recorded `deferred` items (stubbed-inventory fidelity, no `chatProposalItems` reader, docs not updated, the 30-vs-80 item cap, the bounded-read truncation and evidence-budget spend order, each re-surfaced by more than one reviewer layer), Code Map cross-references now stale relative to code a prior pass already patched (`complianceNotes.ts`'s shared helper, `chatProposalItems`'s AD-19 scoping via a direct `projectId` field rather than a `projectScopedTables.ts` registry that has never existed in this codebase), or edge cases with no demonstrated reachable consequence given the schema's own required-field pairing (a partial section/paragraph anchor cannot occur through the validated `proposeBulkEdits` input path) or existing per-item independence (one edit resolving more than one finding, and a `chatProposalItems.status` recorded independently of `chatProposals.state`, both consistent with the AD-28 row's own stated shape). No prior deferred entry was reopened, modified, or reworded.

## Design Notes

**Why the inventory is a pure function.** CAP-12's "every paragraph appears exactly once" is the one property most easily lost inside a tool body that also does DB reads and prose rendering. `assembleDeviationInventory` takes the three section texts, the `not_applied` rows, the writer's content items and (optionally) the Reference PD's sections, and returns the list. The internal query does the reads; the tool does the rendering. That keeps the paragraph-identity property unit-testable without `convexTest` and makes the rule-Deviation source unmistakably `complianceNotes`, never a prose heuristic.

**Item ids.** `r-242-3-1` is the first rule Deviation on paragraph 3 of Line 242. Ids are positional, not hashed, so they are short enough for the model to carry through a turn and stable for identical inputs — the property the Rev G failure needed, where the assistant renumbered its own list between listing and fixing. `c-` and `x-` keep the three provenances distinguishable while CAP-13 treats them identically.

**What the server can and cannot guarantee about 16/16.** The tool enforces: unique ids, every edit mapped to a finding, every finding anchored to a paragraph that exists, and each status carrying its required evidence. It cannot enforce that the findings cover the items the writer listed, because the list is partly writer-authored text the server never stored — doing so would need a persisted inventory table and an AD-28 amendment (recorded in **Block If**). So the 16/16 bar stays where CAP-13 puts it: the live-model harness fixture. This is the honest split, and it is what the OQ7 record says.

**Open Question 7 record.** Larry's Rev G list is the 2026-09-01 incident in `.factory/intake/20260908-chat-behavior-and-privacy/answer.md`: 16 deviations from his customized PD settings, 4 addressed. PR #8 (`6c4f50b`, `d13abe7`) added `proposeBulkEdits`, `applyPassageEdits` and the `sixteen-profile-deviations` fixture. The record must separate three things:
1. *Already passing, deterministically shown:* one coordinated card for many passages; unique, non-overlapping, single-match targets (`applyPassageEdits`); every edit mapped to a finding; the checklist echoed with the model's own ids; human apply unchanged.
2. *Not addressed by PR #8:* no `resolved | blocked | conflicting` statuses and so no missing-fact or Locked-Rule evidence per item; findings not persisted; findings not anchored to paragraphs; a 4-of-16 call is schema-valid; no inventory to number the items against; the converge answer unguarded.
3. *Outstanding:* the live re-run. `ANTHROPIC_API_KEY` is not set in this worktree and the harness is opt-in and billable, so record the command rather than a result:
   `ANTHROPIC_API_KEY=… node scripts/chat-behavior-eval.mjs --case sixteen-profile-deviations --out .audit/chat-behavior`
   plus the same command against `--baseline 6c4f50b` for the before/after comparison. Do not report a live-model verdict that was not produced.

**A Reference PD is only comparable when it parses.** `extractReportSections` needs the `Line 242/244/246` headings, and a real previous-year PD often arrives as a plain extract, an image-only PDF, or a `could_not_read` row. Without a guard the comparison reads "the Reference PD's Line 242 has 0 paragraphs" against every draft paragraph and offers those invented differences as a Coordinated Revision. So the query reports one of `none | resolved | unknown_name | unreadable | unparsed | ambiguous`: a blank or unreadable row is never offered as a choice, and a row that does not parse into all three Locked sections is refused as uncomparable rather than compared against nothing. The pure module repeats the check, because a caller that passes empty reference sections must produce no differences rather than N false ones. Heading-less prose lands entirely under Line 242, which is why the rule is "all three sections hold at least one paragraph", not "any paragraph anywhere".

**Reference PD is a `previous_pd` document.** `projectDocuments.category` already carries `previous_pd`, and archived rows are already excluded from AI context. No new ingestion path, no cross-project read: the tool matches by file name within the thread's own project and, on a miss, lists the project's `previous_pd` file names so the writer can pick.

**Open questions block, not a tool.** CAP-14's trigger is a question, so under the prompt's own routing the assistant must answer without calling a tool. The unresolved and unreliable Confidence Map entries therefore have to be in the turn already, which makes them evidence, not a tool result — one bounded delimited block after the decisions block, absent when there is no Brief so the byte-stability contract for legacy projects is unaffected.

## Verification

**Commands:**
- `npx vitest run convex/lib/deviationInventory.test.ts convex/lib/completionReport.test.ts convex/chatProposalItems.test.ts convex/chatDeviationInventory.test.ts convex/chatProposals.test.ts convex/chatContext.test.ts convex/ai/chatEvidence.test.ts convex/chatEvidenceBoundary.test.ts convex/ai/prompts.test.ts convex/ai/contextBoundary.test.ts convex/lib/passageEdits.test.ts tests/chatBehaviorChecks.test.ts` -- expected: all pass
- `npx tsc --noEmit -p convex/tsconfig.json` -- expected: 0 errors
- `bash scripts/loop-verify.sh` -- expected: exit 0, every numbered step green, no skipped or vacuous tests
- `node --check scripts/chat-behavior-eval.mjs` -- expected: exit 0 (the harness is opt-in and billable; it is not run by the gate)

**Manual checks:**
- `grep -rn 'insert("chatProposals"\|insert("chatProposalItems"' convex --include='*.ts'` shows both only inside `saveProposal`.
- `git diff ba845a8 -- convex/chatV2.ts` shows no change inside `applyProposal`, `markProposalApplied`, `rejectProposal` or `updateProposalWording`.
- `grep -n 'proposed\|gap\|conflict' convex/ai/prompts.ts` shows no surviving use of the old finding status words in the chat prompt.
- `grep -rn 'previous_pd' convex/ai/chatAgentV2.ts convex/chatV2.ts` shows the Reference PD lookup scoped to the thread's own project.

## Auto Run Result

**Summary.** This run was a follow-up review pass only (invoked directly against this already-`done` spec); no new feature work was in scope. Four review layers (Blind Hunter, Edge Case Hunter, Verification Gap, Intent Alignment Auditor) ran against the full diff since `baseline_revision` (excluding the orchestrator-owned `deferred-work.md` ledger). 22 distinct findings were triaged: 4 `patch` (auto-fixed below, one of them high severity), 0 `defer` (every non-patched finding was either a duplicate of an already-recorded DW ledger / `deferred:` item, a stale planning-doc cross-reference, or an edge case with no reachable consequence through the validated input path), 0 `intent_gap`, 0 `bad_spec`, 18 `reject` — see the 2026-09-11 Review Triage Log entry above for the full breakdown. No prior deferred entry was reopened, modified, or reworded.

**Files changed this pass, with one-line descriptions:**
- `convex/lib/deviationInventory.ts` — `bounded()` now neutralizes forged trust-boundary markers in an item's `instruction`/`reason` text (closing a gap the prior pass's marker-neutralization fix left open for this surface); a content Deviation naming a Locked section with zero paragraphs now gets an unanchorable-section message instead of an impossible "between 1 and 0" retry range.
- `convex/lib/deviationInventory.test.ts` — tests for both of the above.
- `scripts/chat-behavior-checks.mjs` — `namesParagraph` now matches the plural "paragraphs N" phrasing, not only the singular.
- `tests/chatBehaviorChecks.test.ts` — regression case for the plural phrasing.
- `convex/ai/prompts.ts` — reworded the CAP-14 converge-guidance section's orphaned "this tool" reference (inside the branch that forbids calling a tool) to "converging".
- `convex/ai/prompts.test.ts` — updated the pinning assertion to match the reworded text.
- `_bmad-output/specs/spec-pd-generation/stories/5-one-pass-convergence-and-reference-pd-comparison.md` — this file: status transitions (`done` → `in-review` → `done`), the new Review Triage Log entry, this Auto Run Result.

**Review findings breakdown:** 4 patched (high 1, medium 0, low 3), 0 deferred (0 new), 18 rejected (high 0, medium 6, low 12 — duplicates of already-recorded deferred items re-surfaced by more than one reviewer layer, stale Code Map cross-references to planning-only artifacts, and edge cases unreachable through the validated `proposeBulkEdits` input path or consistent with the AD-28 row's own documented independence from `chatProposals.state`).

**Follow-up review recommendation:** `true`. Counting only this pass's own `patch` findings (never defer/reject): high 1, medium 0, low 3 — a high-severity patched finding alone sets the recommendation to `true` regardless of the `3×medium + 1×low` score (which is `3×0 + 1×3 = 3`, itself below 5). `followup_review_recommended` is set to `true` in frontmatter accordingly. Reviewers were the project's own policy preference (`gpt-6-astra`, medium) and fallback (`gpt-5.6-sol`, high), both probed directly via `codex exec` before this pass and both refused with the same usage-limit error as the two prior passes ("try again at Sep 14th, 2026 7:46 PM"); the four layers ran as Sonnet 5 subagents at this session's capability per this workflow's same-capability rule, so an independent Astra/Sol pass over this diff — and specifically over this pass's own high-severity patch — is still owed.

**Verification performed:**
- `npx vitest run` over the full command in this file's Verification section (12 files) — 247 tests, all pass.
- `npx tsc --noEmit -p convex/tsconfig.json` — 0 errors.
- `bash scripts/loop-verify.sh` — exit 0, all 9 numbered steps green (preflight, Convex typecheck, `npm run check`, unit tests, test-discovery guard, production build, both uploader harnesses), no skipped or vacuous tests.
- `node --check scripts/chat-behavior-eval.mjs` — exit 0 (not run; opt-in and billable, `ANTHROPIC_API_KEY` unset in this worktree, unchanged from prior passes).
- All four manual checks in this file's Verification section re-run and still hold.

**Residual risks:**
- The live-model harness (CAP-13/14/15) remains unrun in this worktree (DW-146, unchanged) — the four fixtures have no observed live-model verdict.
- An independent Astra/Sol review of this diff, and specifically of this pass's high-severity marker-neutralization patch, is still outstanding per the reviewer-policy fallback note above.
- The findings this pass rejected as duplicates (stubbed-inventory fidelity, no `chatProposalItems` reader, docs not updated, the 30-vs-80 item cap, bounded-read truncation, the evidence-budget spend order) remain unchanged and open in DW-135–DW-146 / this story's own `deferred:` list; none was reopened or edited by this pass.
- The Code Map's references to `convex/complianceNotes.ts` as unchanged and to a `convex/lib/projectScopedTables.ts` registration for `chatProposalItems` are stale relative to code already reviewed and merged in prior passes (the shared `selectedCandidateRunId` helper, and `chatProposalItems` carrying `projectId` directly per the AD-19 convention actually used by `settingsDocumentAnalyses`); left as-is since the Code Map is historical planning documentation, not a live contract, and no reader relies on it for correctness.

