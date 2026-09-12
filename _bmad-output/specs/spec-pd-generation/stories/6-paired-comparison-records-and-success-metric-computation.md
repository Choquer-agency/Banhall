---
title: 'Paired Comparison records and success-metric computation'
type: 'feature'
created: '2026-09-11'
status: 'done'
baseline_revision: 'cd3f30cf6f1d72d5f0b05e189ba6efb07055b7fa'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/convex/_generated/ai/guidelines.md'
  - '{project-root}/_bmad-output/specs/spec-pd-generation/measurement-protocol.md'
  - '{project-root}/_bmad-output/specs/spec-pd-generation/glossary.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-Banhall-2026-09-03/ARCHITECTURE-SPINE.md'
  - '{project-root}/docs/design-system.md'
warnings:
  - oversized
deferred: []
---

<intent-contract>

## Intent

**Problem:** CAP-16 and the whole Success signal rest on Paired Comparison records that have nowhere to live: there is no `comparisons` table, no write path, and no SM-1/SM-2 computation, so once judging opens after 2026-09-15 the outcomes would be counted by hand — or, worse, read back out of the very tool under test.

**Approach:** Ship AD-29 exactly: a `comparisons` table pinned to a report revision, an admin-gated `convex/comparisons.ts` whose only correction path is re-entry (a new row carrying `voidsComparisonId`), server-computed `draftTextMatches` over the pasted Banhall draft, SM-1/SM-2 queries that exclude development and voided rows, and a small `/admin/comparisons` page where both drafts are pasted in.

## Boundaries & Constraints

**Always:**
- Every judgement field is human-entered. The server resolves only the pin (`projectId`, `reportId`, `revisionNumber`, `contentHash`, `generationId`), `recordedAt`, and `draftTextMatches`.
- Deviation and Corrections-to-acceptable counts are the judge's manual counts. No code path may read them from `chatProposalItems`, `complianceNotes`, `generations.qa`, `writerReviews`, or any model output.
- Writes require `requireRole(ctx, ["admin"])` — AD-29's interim answer to Q18. Reads of `comparisons` are admin-only too.
- A recorded row is never patched or deleted. A correction is a new row whose `voidsComparisonId` names the row it replaces; the named row must be live and belong to the same project.
- At most one live (non-voided) comparison per project (CAP-16: one Paired Comparison *per project*). A record with no `voidsComparisonId` is refused when the project already has a live row.
- `record` pins the exact revision the judge read: it takes `reportId` and `expectedRevisionNumber` and fails `STALE_REVISION` when the report has moved on, like `reports.updateReportContent`.
- `draftTextMatches` is recorded, never a gate: a `false` is stored and surfaced, and the record still lands.
- `comparisons` carries `projectId` directly (AD-19) and only AD-29's two indexes (`by_projectId`, `by_recordedAt`). Every read is bounded (`.take(...)`, never `.collect()`, never `.filter`).
- Every `modelCaveat` is stored per record (Q15 is unresolved; the caveat is the record's answer to it).
- UI: `AdminWorkspacePage` shell, bits-ui/shadcn primitives (`Input`, `SelectInput`, `Checkbox`, `Button`), `field-control` on the two `<textarea>` fields, max font weight 500, design tokens only.

**Block If:**
- Anyone requires SM-1/SM-2 to count a project's "≥ 1 small (100–200-hour)" condition automatically: no project row carries claim hours, and `financialSummaries` exists only where a financial upload ran. Report it, do not compute it.
- Q18 is re-opened (project Owner may also write `comparisons`) — that changes the authorization cell, which is an AD-29 amendment.
- A change would add, drop, or rename a field in AD-29's `comparisons` field list.

**Never:**
- Edit, patch, or delete a recorded comparison; void a row without a replacement row (AD-29 gives no such path).
- Automate or generate the ChatGPT baseline draft — it is pasted in (SPEC Non-goals, ARCHITECTURE-SPINE "Not building").
- Derive `usedInDevelopment` from project data; it is the judge's flag on the record.
- Return the pinned revision's canonical plain text from any query the recorder can read — that would let a mismatch be papered over by pasting it back.
- Touch `applyProposal`, generation or chat paths, `convex/lib/roleCapabilities.ts`, or anything under `src/lib/components` (recovery adds executing tests for this new route without changing shared components).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First record | Admin; project with a report at revision 3; no live comparison | One `comparisons` row: pin resolved from the report, both draft texts stored, `draftTextMatches` computed, `recordedAt` stamped | No error expected |
| Blinded reformat | Pasted Banhall text differs from the revision only in whitespace and section headings | `draftTextMatches: true` | No error expected |
| Wrong draft pasted | Pasted Banhall text is a different draft | Row is written with `draftTextMatches: false` | No error expected (recorded, not refused) |
| Second live record | Live comparison already exists for the project, `voidsComparisonId` absent | Nothing written | `INVALID_STATE` naming the existing comparison and the void-and-re-enter path |
| Correction | `voidsComparisonId` names the project's live row | New row written; the named row is no longer live and drops out of SM-1/SM-2 | No error expected |
| Void a stranger | `voidsComparisonId` names a row of another project, or an already-voided row | Nothing written | `INVALID_INPUT` |
| Report moved | `expectedRevisionNumber` ≠ the report's `revisionNumber ?? 0` | Nothing written | `STALE_REVISION` |
| Non-admin write | Writer, manager, roleless, or anonymous caller | Nothing written, nothing read | `NOT_AUTHORIZED` |
| Empty/oversized drafts | Either draft text blank after trim, or over 120 000 characters | Nothing written | `INVALID_INPUT` |
| Negative counts | Any of the four counts negative or non-integer | Nothing written | `INVALID_INPUT` |
| Development project | `usedInDevelopment: true` | Row stored and listed; excluded from both SM computations and counted in `excluded.development` | No error expected |
| Metrics with no rows | No live non-development comparisons | `sm1`/`sm2` report zero eligible projects and `computedMet: false` | No error expected |

</intent-contract>

## Code Map

Line numbers drift; grep the symbol. Baseline `b2475c0`.

- `convex/schema.ts` -- add `comparisons` after `writerReviews` (`:1686-1703`, the revision-pinning precedent: `revisionNumber` + `contentHash` + `projectId` + `reportId`). Fields exactly per AD-29: `{projectId: v.id("projects"), reportId: v.id("reports"), revisionNumber: v.number(), contentHash: v.string(), generationId: v.optional(v.id("generations")), banhallModel: v.string(), baselineProduct: v.string(), baselineModel: v.string(), modelCaveat: v.string(), judgeUserId: v.id("users"), preference: v.union(v.literal("banhall"), v.literal("baseline"), v.literal("tie")), deviationsBanhall: v.number(), deviationsBaseline: v.number(), countingMethod: v.string(), correctionsBanhall: v.number(), correctionsBaseline: v.number(), usedInDevelopment: v.boolean(), recordedAt: v.number(), voidsComparisonId: v.optional(v.id("comparisons")), banhallDraftText: v.string(), baselineDraftText: v.string(), draftTextMatches: v.boolean()}`, indexed `.index("by_projectId", ["projectId"]).index("by_recordedAt", ["recordedAt"])`. `generationId` is optional because a hand-written report has none. AD-29's field list is exhaustive, so the recording admin is not a stored field: the protocol's recorder and judge are different people, but AD-29 stores only `judgeUserId`, and adding a field is a Block If.
- `convex/lib/comparisonText.ts` (new, pure; imports `./tiptapReport` only) -- `comparisonPlainText(raw: string): string`: `extractReportSections(raw)` (`convex/lib/tiptapReport.ts:133`, which already accepts both Tiptap JSON and legacy plaintext and strips `Line 242/244/246` headings into sections), join the three bodies with `\n`, then normalize — CRLF→LF, trim each line, collapse internal whitespace runs to one space, drop empty lines, join with `\n`. One function, used for both sides of the comparison so the rule cannot drift.
- `convex/comparisons.ts` (new) --
  - `record` (public mutation, `requireRole(ctx, ["admin"])`): validate inputs; load the report and fail `NOT_FOUND`; fence on `expectedRevisionNumber` vs `report.revisionNumber ?? 0` with `STALE_REVISION`; resolve the live-row rule and `voidsComparisonId`; verify `judgeUserId` resolves to a user with a role; compute `draftTextMatches` as `(await sha256(comparisonPlainText(report.content))) === (await sha256(comparisonPlainText(args.banhallDraftText)))`; insert. `sha256` and `domainError` come from `convex/lib/contracts.ts` (`:250`, `:37`); `requireRole` from `convex/lib/auth.ts:92`.
  - `listRecordTargets` (public query, admin): up to 200 projects (`ctx.db.query("projects").order("desc").take(200)`) as `{projectId, label: "<clientName> — <title>", hasLiveComparison}`, resolving liveness from the project's own bounded `by_projectId` read.
  - `getRecordContext({projectId})` (public query, admin): the project's latest report (`by_projectId` desc `.first()`, the `reports.getLatestReport:38-41` pattern), returning `{reportId, revisionNumber, contentHash, generationId, suggestedBanhallModel, liveComparisonId}` — and never the revision's plain text.
  - `listForProject({projectId})` (public query, admin): that project's rows newest first with a derived `voided` flag and the judge's display label.
  - `successMetrics` (public query, admin): read `by_recordedAt` desc `.take(500)`, drop voided rows (a row is voided when some other row's `voidsComparisonId` names it) and `usedInDevelopment` rows, then compute SM-1 and SM-2 through the pure helpers below; attach each eligible project's `financialSummaries` row (`by_projectId`, `.first()`) as `{totalHours, sredHours} | null`.
- `convex/lib/successMetrics.ts` (new, pure; no Convex imports) -- `summarizeSuccessMetrics(rows)` over `{projectId, preference, deviationsBanhall, deviationsBaseline, correctionsBanhall}` returns `{sm1: {eligibleProjects, preferredProjects, satisfyingProjects, computedMet, manualConditions}, sm2: {eligibleProjects, satisfyingProjects, computedMet, manualConditions}}`. SM-1 satisfied by a project when `preference === "banhall" && deviationsBanhall * 2 <= deviationsBaseline`; `computedMet` when `eligibleProjects >= 4 && satisfyingProjects >= 3`. SM-2 satisfied when `correctionsBanhall <= 1`; same thresholds. `manualConditions` are the protocol clauses no query can check: SM-1 `"at least one 100–200-hour project among the four"`, SM-2 `"the 16-item harness fixture reports 16/16 on every run"`.
- `shared/generationModels.ts:29-131` -- `CANDIDATE_MODELS`, `MODEL`, `modelById` for `suggestedBanhallModel`'s label; the picker items for the Banhall-model field reuse `SINGLE_MODEL_ITEMS` shape.
- `convex/schema.ts` `modelSelections` (`by_projectId_and_generationId`, fields `model`/`label`) and `generations.singleModelId`/`candidateMode` -- how `suggestedBanhallModel` is resolved: the generation's selection row first, else `singleModelId ?? MODEL`, labelled through `modelById(id)?.label ?? id`; `null` when the report has no generation.
- `convex/lib/teamRoster.ts:22` `userDisplayLabel` -- the judge's display label in `listForProject`; `convex/users.ts:26` `listTeam` is the page's judge picker.
- `src/routes/admin/comparisons/+page.svelte` (new) -- `AdminWorkspacePage` (`src/lib/components/admin/AdminWorkspacePage.svelte`) with `title="Paired Comparisons"`; the record form, the project's existing records, and the SM-1/SM-2 readout. Follows `src/routes/admin/reviews/+page.svelte:1-60` for `useAuth()` + `useQuery(..., () => auth.isAuthenticated ? {} : "skip")` + `useMutation`. Both draft fields are `<textarea class="field-control ...">` (the `formControlContract` audit requires `field-control` and forbids any exterior border/ring); every other control is `Input`/`SelectInput`/`Checkbox`/`Button` from `src/lib/components/ui`.
- `src/routes/admin/adminWorkspaceRoutes.test.ts:4` -- add `"comparisons"` to the `routes` tuple so the new page is held to the shared-shell contract.
- `src/lib/dashboard/adminRoutes.ts:7-15` -- add `{ href: "/admin/comparisons", label: "Paired Comparisons" }` so the command palette can reach it. Read-only evidence: `src/lib/components/workspace/WorkspaceRail.svelte:118-128` has its own list pinned by a browser-only test (`WorkspaceRail.component.test.ts:32-42`) — leave it alone.
- `convex/comparisons.test.ts` (new, `convex-test`) -- `convex/appSettings.test.ts:11-16` is the admin-identity fixture (`t.withIdentity({subject})`); `convex/reviews.test.ts:83-107` is the `errorCode()` helper and the report/project seed.
- Read-only evidence, do not change: `convex/reports.ts:22-42` (`getLatestReport`), `convex/reports.ts:45-60` (the `STALE_REVISION` fence), `convex/reviews.ts:65-95` (the revision-pin write), `convex/lib/auth.ts:92-103` (`requireRole`), `measurement-protocol.md` (the metric definitions this story encodes).

## Tasks & Acceptance

**Execution (every item is in scope for this run):**
- `convex/schema.ts` -- add the `comparisons` table with AD-29's fields and its two indexes -- the record is the measurement's only durable home.
- `convex/lib/comparisonText.ts` + `convex/lib/comparisonText.test.ts` -- the canonical plain-text normalization and its tests -- `draftTextMatches` is only meaningful if both sides are normalized by one rule.
- `convex/lib/successMetrics.ts` + `convex/lib/successMetrics.test.ts` -- SM-1/SM-2 arithmetic as a pure function -- the metric must be testable without a database or a judge.
- `convex/comparisons.ts` -- `record`, `listRecordTargets`, `getRecordContext`, `listForProject`, `successMetrics` -- the admin-gated write path and the three reads the page needs.
- `convex/comparisons.test.ts` -- `convex-test` coverage of every I/O Matrix row above (record shape and pin resolution, both `draftTextMatches` outcomes, the second-live-record refusal, void-and-re-enter, cross-project and double-void refusals, the stale-revision fence, non-admin refusal on every function, input validation, development and voided exclusion from SM-1/SM-2, empty-corpus metrics).
- `src/routes/admin/comparisons/+page.svelte` -- the record form (project picker, judge picker, preference, four counts, counting method, baseline product/model, model caveat, development flag, two pasted drafts), the project's record list with the void-and-re-enter affordance, and the SM-1/SM-2 readout including `manualConditions` and the per-project `financialSummaries` figures.
- `src/routes/admin/adminWorkspaceRoutes.test.ts` -- add `"comparisons"` to the route tuple -- the new page is held to the same shell contract as every other admin route.
- `src/lib/dashboard/adminRoutes.ts` -- add the palette destination -- an admin page nobody can navigate to is not shipped.

**Acceptance Criteria:**
- Given an admin, a project whose latest report is at revision 3 with no live comparison, when `record` is called with `expectedRevisionNumber: 3`, then exactly one row is written whose `projectId`, `reportId`, `revisionNumber`, `contentHash` and `generationId` are read from the report — not from the caller — and whose every judgement field holds the caller's value verbatim.
- Given that row, when `successMetrics` runs, then its counts come only from `deviationsBanhall`/`deviationsBaseline`/`correctionsBanhall` on `comparisons` rows, and `grep` finds no read of `chatProposalItems`, `complianceNotes` or `writerReviews` in `convex/comparisons.ts`.
- Given five live non-development projects of which three have `preference: "banhall"` with `deviationsBanhall * 2 <= deviationsBaseline`, when `successMetrics` runs, then `sm1.computedMet` is true, `sm1.manualConditions` still names the 100–200-hour clause, and a sixth `usedInDevelopment` project appears only in `excluded.development`.
- Given a project with one live comparison, when a correction is recorded with `voidsComparisonId` naming it, then both rows persist unmodified, `listForProject` marks the old row voided, and only the new row reaches SM-1/SM-2.
- Given any non-admin caller — writer, manager, roleless or unauthenticated — when any `comparisons` function is called, then it fails `NOT_AUTHORIZED` and no row is written or returned.
- Given the report is edited between loading the form and submitting, when `record` runs with the stale `expectedRevisionNumber`, then it fails `STALE_REVISION` and nothing is written.
- Given `npm test` and `npm run check`, when the new page lands, then `adminWorkspaceRoutes.test.ts` passes for `comparisons` and the `formControlContract` source audit reports no violation for either textarea.

## Spec Change Log

### 2026-09-12 — R12 amends the Design Notes normalization example

The recovery finding R12 required one documented rule for both sides of the draft
comparison, proven not to flag unchanged prose when only the wrapping differs. A
Tiptap revision emits one line per paragraph while a blinded plain-text strip is
hard-wrapped at some column, so any rule that preserved line breaks reports
identical prose as a mismatch. `comparisonPlainText` therefore collapses every
whitespace run — newlines included — to a single space.

That is a deliberate deviation from the Design Notes golden example as written,
which preserved the paragraph `\n`. The example has been amended above to the
value the mandated rule produces. The note's actual claim — the result is the
same whether the strip kept or dropped the section heading — is unchanged, and
the rule still distinguishes a real word change. No intent-contract text changed:
the I/O Matrix's "Blinded reformat → draftTextMatches: true" row is what R12
strengthens.

## Original attempt review triage (2026-09-11)

### 2026-09-11 — Review pass not performed (reviewer unavailable)
- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 0
- reject: 0
- addressed_findings:
  - none

No review layer ran. `_bmad/custom/reviewer-policy.md` fixes the reviewer at Codex
`gpt-6-astra` (effort `medium`), falling back to `gpt-5.6-sol` (effort `high`) only on an
actual access/availability/rate-limit failure. Both were probed through the installed
Codex CLI (`codex-cli 0.153.3`) and both returned the same account-wide refusal:
`You've hit your usage limit. ... try again at Sep 14th, 2026 7:46 PM.` The policy's
terminal clause applies verbatim — "If both requested models are unavailable, retain the
unfinished review as pending and report the limitation. Do not mark an unperformed review
as passed." — so the four layers (Blind Hunter, Edge Case Hunter, Verification Gap,
Intent Alignment) are pending, not passed, and this story is not `done`.

The reviewable diff is built and preserved at
`.../scratchpad/story6.diff` (2378 lines: the four tracked-file diffs plus the seven new
files). Re-running review needs only that diff and an available reviewer.

## Review Triage Log

### 2026-09-12 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 11: (high 0, medium 7, low 4)
- defer: 0
- reject: 7
- addressed_findings:
  - `[medium]` `[patch]` P1 `convex/comparisons.ts` — the read budget could not bound the read: `rowBytes` measured UTF-16 code units while Convex stores UTF-8 (a max-length 3-byte-character draft is ~360 KB, not 120 KB), the five provenance fields were covered by a flat 512-byte allowance, and the budget was consulted only *after* `.take(25)` had already fetched the batch. Added `utf8Bytes`, charged all seven strings at their encoded size, derived `MAX_ROW_BYTES` as the worst-case row, and now reserve budget *before* each read (page size `floor(remaining / MAX_ROW_BYTES)`), in both the corpus walk and `listRecordTargets`. Covered by a test seeding maximum-length CJK drafts and maximum-length provenance fields.
  - `[medium]` `[patch]` P5 `src/routes/admin/comparisons/+page.svelte` — stale-revision dead end: the error told the admin to re-select the project, but the reset effect fires only when `projectId` *changes*, so re-selecting the current project was a no-op and the pin could not be refreshed without a page reload. Added an explicit "Start a new judgement on the current revision" action that re-freezes the pin and states that entered data is discarded.
  - `[medium]` `[patch]` P6 `src/routes/admin/comparisons/+page.svelte` — the `suggestedBanhallModel` effect stayed reactive after the pin froze, so a blank field could take model provenance from a different generation than the pinned report. The suggestion is now captured with the pin.
  - `[medium]` `[patch]` P7 `src/routes/admin/comparisons/comparisonsRecord.component.test.ts` — the stale-revision test asserted only that some alert was non-empty, which the pre-existing "report moved" warning already satisfied; it now asserts the server's exact message.
  - `[medium]` `[patch]` P8 `src/routes/admin/comparisons/+page.svelte:consentToCorrection` — the checkbox consent path was unexercised (the existing test used "Void and re-enter", whose handler assigns the target independently). Added executing coverage for capture on check, withdrawal on uncheck, and a concurrent correction submitting the captured id.
  - `[medium]` `[patch]` P9 `src/routes/admin/comparisons/+page.svelte` — picker paging was proven only through a direct backend call, so a no-op `showOlderProjects` would have left the suite green; R7's proof now exists at the control (page forward, select and correct a later-page project, page back, selection and label survive).
  - `[medium]` `[patch]` P10 `convex/comparisons.test.ts` — the multi-batch *success* path was unproven: every complete-corpus test used fewer than 25 rows and the 26-row test expected an incomplete result, so returning `complete: false` after the first batch satisfied the suite. Added a corpus spanning two batches with a correction pair straddling the boundary, asserting `corpusComplete: true`.
  - `[low]` `[patch]` P2 `convex/comparisons.ts:listForProject` — `hasMore` was `rows.length === 12`, claiming older records at exactly 12; now a lookahead row.
  - `[low]` `[patch]` P3 `convex/comparisons.ts:successMetrics` — `METRIC_DETAIL_CAP` truncated the eligible and development detail arrays silently while `corpusComplete` could still be true; totals and explicit truncation flags are now returned and surfaced.
  - `[low]` `[patch]` P4 `src/routes/admin/comparisons/+page.svelte:reportMovedOn` — the warning compared revision numbers only, so a *different* report at the same revision raised no warning; it now compares report identity too.
  - `[low]` `[patch]` P11 `convex/comparisons.ts:scanComparisonsNewestFirst` — a single millisecond holding a full batch stranded the `recordedAt` cursor and permanently withheld metrics; the cursor is now the full index key `{recordedAt, _creationTime}` with the tie drained before falling through to older stamps.

Rejected (7): the 12-row `listForProject` window without a continuation (a project holds one live row plus a handful of corrections, and the UI says so); draft text typed *during* an in-flight submit being cleared by the response (R3's requirement is cross-project isolation, and the window is sub-second); `successMetrics` withholding rather than continuing once the caps are exceeded (R8 explicitly sanctions withholding); anonymous callers returning `NOT_AUTHENTICATED` rather than the matrix's `NOT_AUTHORIZED` (settled by review disposition R20 — the tests were made exact per caller this pass); `.paginate` in the picker against the intent's `.take(...)` phrasing (R6/R7 explicitly authorise supported bounded pagination); the Banhall-model field being pre-filled from a known model (predates this change, is an editable default, and P6 removes the unsafe part); and the observation that schema/field-list compliance is not established by this diff (the table landed in the recovery base and is unchanged).

Reviewer: Codex `gpt-6-astra`, reasoning effort `medium`, per `_bmad/custom/reviewer-policy.md`, run through `CODEX_HOME=/Users/johnnynguyen/.codex2`. All four layers ran; no fallback to `gpt-5.6-sol` was needed. Reviewer subprocesses ran with `BMAD_LOOP_TASK_ID` unset so they emitted no native parent-task hook events, and the working tree was hash-verified unchanged across the review.

### 2026-09-12: Fresh follow-up review

- intent_gap: 0
- bad_spec: 0
- patch: 10: (high 0, medium 6, low 4)
- defer: 0
- reject: 2
- addressed_findings:
  - `[medium]` `[patch]` F1: Corrected the replacement-report warning and tested submission against the unchanged original pin. No new latest-report authorization or revision policy.
  - `[medium]` `[patch]` F2: Bounded project pagination and ancillary project, financial-summary, and judge reads before fetching. Corrected UTF-8 surrogate accounting and the read-budget documentation.
  - `[low]` `[patch]` F3: Added a budget-reserved lookahead so exactly 500 corpus rows can be complete; 501 still withholds conclusions.
  - `[medium]` `[patch]` F4: Incomplete metric cards now report unavailable instead of claiming the countable clauses are not met.
  - `[low]` `[patch]` F5: Empty partial results now describe the scanned window instead of asserting that no comparison has ever been recorded.
  - `[low]` `[patch]` F6: Clarified that whitespace normalization applies to extracted prose and that plaintext heading recognition requires one-line labels. The blinding protocol removes headings; parser behavior is unchanged.
  - `[medium]` `[patch]` F7: Pending success and error tests now enter distinct project B drafts before project A settles and assert their exact preservation.
  - `[medium]` `[patch]` F8: Added executing frontend validation at unsafe and maximum-safe integer boundaries.
  - `[low]` `[patch]` F9: Reset tests now populate and inspect every count, the development flag, and captured correction consent, for both project changes and explicit restarts.
  - `[medium]` `[patch]` F12: Added observation of actual convex-test database returns for large ancillary documents, including paged picker progress and bounded judge-label reads.

All four rendered review layers used `gpt-6-astra`, reasoning effort `medium`, per reviewer policy. The intent auditor confirmed the documented recovery reading; established dispositions for authentication, bounded pagination, editable model suggestions, and incomplete-corpus withholding remain unchanged. Full disposition evidence is in `.audit/pd-generation-story-6-followup-20260912/review.md`. No deferred-work ledger entries were authored or changed. Patched severity score: `3 * 6 + 4 = 22`; follow-up review remains recommended.

### 2026-09-12: Second fresh follow-up review

- intent_gap: 0
- bad_spec: 0
- patch: 7: (high 0, medium 1, low 6)
- defer: 0
- reject: 5
- addressed_findings:
  - `[medium]` `[patch]` B1: Preserve count text until decimal-digit validation, preventing fractional entries from rounding into accepted integers; reproduced in the real browser form before repair.
  - `[low]` `[patch]` B2: State the supported maximum in count feedback and verify it at the UI.
  - `[low]` `[patch]` B3: Prove through the backend that an unchanged original report pin remains valid after a replacement becomes latest.
  - `[low]` `[patch]` B6: Exercise a delayed project context and prove the previous project's pin cannot be submitted while loading.
  - `[low]` `[patch]` B10: Preserve prior regression configurations and add a portable original-source reproduction runner with isolated caches.
  - `[low]` `[patch]` B11: Align native and application validation on original count text, including surrounding whitespace.
  - `[low]` `[patch]` V1: Exercise the history truncation disclosure and its removal when the query becomes complete.

All four rendered review layers used gpt-6-astra at medium effort. A scoped patch audit found B11, which was repaired before final verification. Full dispositions and evidence are in `.audit/pd-generation-story-6-followup2-20260912/`. No existing deferred-work ledger entry was changed. Patched severity score: `3 * 1 + 6 = 9`; follow-up review remains recommended.

## Design Notes

**Why one live record per project.** CAP-16 says "record a Paired Comparison **per project**", and AD-29 gives exactly one correction path: void by re-entry. Together they fix the data model at one live row per project, which is what makes SM-1/SM-2 computable without inventing an aggregation rule (whose record wins when two judges disagree? newest? the owner's?). Enforcing it at write time turns that question into a refusal the admin resolves deliberately — record Michael's judgement as a correction of Larry's, or leave Larry's standing — instead of a silent tie-break inside a metric query. The protocol's "Michael as second judge where available" stays a human cross-check; it is not a second metric input.

**`draftTextMatches` is evidence, not a gate.** The blinding step hands the judge a reformatted plain-text strip of a revision, so byte equality is hopeless and whitespace-and-heading-insensitive equality is the honest test. A `false` means the judge rated something other than this revision — exactly the failure the pin exists to catch — so it is stored and shown, never used to refuse the record. The canonical text is deliberately *not* returned by `getRecordContext`: a recorder who could read it could paste it in and manufacture a `true`.

**Golden example of the normalization:**

```
Line 242 — Technological Uncertainty
  The team could not predict   the fatigue limit.

The alloy failed early.
```
normalizes to `"The team could not predict the fatigue limit. The alloy failed early."` — identical whether the strip kept the section heading or dropped it, and identical however the prose is wrapped. (Amended by R12; see the Spec Change Log.)

**What SM-1/SM-2 refuse to compute.** `measurement-protocol.md` makes SM-1 conditional on "≥ 1 small (100–200-hour)" project and SM-2 on the 16-item harness reporting 16/16. Neither is in `comparisons`, no project row carries claim hours, and `financialSummaries` exists only where someone uploaded timesheets. So `computedMet` covers only the countable clauses and `manualConditions` names the rest, with each eligible project's `totalHours`/`sredHours` shown beside it where a summary exists. A `computedMet: true` that silently swallowed an unverified clause would be the one failure mode this metric cannot afford.

**No new index for voiding.** Liveness is derived in memory from the bounded row set already read (`by_projectId` for a project, `by_recordedAt` for the metric), so AD-29's two indexes stand unchanged and no row is ever patched to mark itself voided.

**AD-19 registration is a no-op today.** `convex/lib/projectScopedTables.ts` does not exist yet (AD-19 is TARGET, not enforced); carrying `projectId` directly on `comparisons` is the whole of this story's obligation, exactly as stories 1, 3 and 5 left their tables.

## Verification

**Commands:**
- `npx vitest run convex/comparisons.test.ts convex/lib/comparisonText.test.ts convex/lib/successMetrics.test.ts src/routes/admin/adminWorkspaceRoutes.test.ts src/lib/components/ui/formControlContract.test.ts` -- expected: all pass
- `npx tsc --noEmit -p convex/tsconfig.json` -- expected: 0 errors
- `bash scripts/loop-verify.sh` -- expected: exit 0, every numbered step green, no skipped or vacuous tests
- `npm run check` -- expected: 0 errors, 0 warnings for the new route

**Manual checks:**
- `grep -rn 'insert("comparisons"' convex --include='*.ts'` shows exactly one insert, inside `record`.
- `grep -rnE 'db\.patch\(|db\.delete\(' convex/comparisons.ts` returns nothing.
- `grep -rnE 'chatProposalItems|complianceNotes|writerReviews|qaItemFeedback' convex/comparisons.ts convex/lib/successMetrics.ts` returns nothing.
- `grep -rnE 'font-(semibold|bold)|#[0-9a-fA-F]{3,6}' src/routes/admin/comparisons` returns nothing.
- `git diff b2475c0 -- src/lib/components` is empty.

## Recovery review and remaining implementation, 2026-09-12

The first implementation was preserved after an operational reviewer-capacity interruption. This recovery base is not an accepted story. Continue implementation by addressing every unchecked review repair below, then run the native review and verification stages. Do not recreate already-present behavior merely because it is committed in the recovery base.

All four standalone bmad-code-review layers have now reviewed the original implementation with gpt-6-astra at medium effort. Native acceptance and its follow-up review still remain. The original attempt baseline was b2475c032d9e0af7956a19abbe1a8a5095a9a2df. The original staged/unstaged patches, untracked sources, native transcript, rendered workflow, and complete review evidence are preserved at /Users/johnnynguyen/Documents/Repos/Banhall/.audit/resume-story6-20260912T105856Z/. The original full implementation diff is review.diff in that directory. Native re-arm must stamp the new baseline; the obsolete baseline_revision is intentionally absent.

The canonical Convex generator has now run successfully. It produced the comparisons binding and the missing pure-helper imports, with no hand edits and no deployed application change. The old generated-binding deferral is resolved; canonical-codegen-result.json records provenance. Review the generator-produced delta as well as the preserved implementation when validating this recovery.

Keep AD-29's exact fields, its two indexes, immutable correction records, Admin authorization, and manual metric provenance. Bounded pagination may replace fixed-size scans where necessary to satisfy the reviewed contract safely. New route execution tests are in scope; leave shared src/lib/components source unchanged. Do not edit the native deferred-work ledger or synthesize native result/status/hook artifacts.

### Review Findings

- [x] [Review][Patch] R1 Freeze the report pin for the judgement [src/routes/admin/comparisons/+page.svelte:194]
  Capture report ID and revision when the form begins. Live query updates must not advance an existing judgement. Prove a report edit after form load yields STALE_REVISION with no write.
- [x] [Review][Patch] R2 Freeze the correction target when consent is given [src/routes/admin/comparisons/+page.svelte:211]
  Capture the comparison ID the administrator agrees to replace. If another administrator corrects it meanwhile, submit the captured ID and let the backend refuse the stale target.
- [x] [Review][Patch] R3 Keep pending requests tied to their original form [src/routes/admin/comparisons/+page.svelte:217]
  A response for project A must not clear drafts or display success/error on project B. Guard by form/request identity or prevent project changes while submitting. Test success and failure paths.
- [x] [Review][Patch] R4 Require an explicit preference selection [src/routes/admin/comparisons/+page.svelte:84]
  The initial and reset value defaults to Banhall. Every judgement field is human-entered, so start preference unselected and require a deliberate choice.
- [x] [Review][Patch] R5 Reset the baseline product with the other judgement fields [src/routes/admin/comparisons/+page.svelte:110]
  Selecting a new project resets model and counts but keeps baselineProduct. Reset it consistently and verify project changes cannot carry unintended provenance.
- [x] [Review][Patch] R6 Keep comparison reads within transaction limits [convex/comparisons.ts:59]
  Rows hold both permitted 120,000-character drafts. Reading 200 per project or 500 globally can exceed 16 MiB; the project picker multiplies these reads. Bound bytes and work per request, use supported bounded pagination where needed, and avoid history scans merely to find the current row. Preserve AD-29 fields, immutable rows and its two indexes. Prove with large valid drafts. https://docs.convex.dev/production/state/limits#transactions
- [x] [Review][Patch] R7 Make older projects reachable [convex/comparisons.ts:263]
  The latest-200 picker has no continuation or search. Add bounded access to older projects and prove a target beyond the initial page can be selected and corrected.
- [x] [Review][Patch] R8 Do not report complete success metrics from a truncated history [convex/comparisons.ts:372]
  Taking 500 rows before excluding corrections lets recent history evict unrelated live projects. Compute from a complete eligible corpus through bounded pages, or explicitly withhold a conclusive metric until completeness is established. Never silently turn a partial window into a full result.
- [x] [Review][Patch] R10 Do not invent historical model provenance [convex/comparisons.ts:132]
  When neither the pinned generation selection nor its actual model ID is known, return no suggestion. The current registry default is not evidence of the historical generation model.
- [x] [Review][Patch] R12 Ignore line-wrap differences in draft comparison [convex/lib/comparisonText.ts:21]
  The match is described as whitespace-insensitive, but preserving soft wraps can flag unchanged prose as different. Use one documented rule for both sides and prove wrapping/section formatting does not change prose equality, while actual word changes do.
- [x] [Review][Patch] R14 Reject unsafe integer counts [convex/comparisons.ts:76]
  Number.isInteger accepts imprecise values above MAX_SAFE_INTEGER. Validate safe nonnegative integers at both boundaries and test rejection instead of storing rounded judgement counts.
- [x] [Review][Patch] R15 Do not label two empty normalized drafts as a match [convex/comparisons.ts:230]
  Nonblank serialized input can normalize to no prose. Preserve record acceptance as required, but only report a positive match when normalized prose is nonempty and equal.
- [x] [Review][Patch] R16 Execute the real form submission and correction path in tests [src/routes/admin/comparisons/+page.svelte:187]
  Direct mutation and source-shell tests cannot catch the proven form pin/consent/request defects. Add executing route/component coverage, retain real Svelte behavior, and exercise stored payloads, correction, and stale responses. No need to modify shared components.
- [x] [Review][Patch] R17 Verify match and mismatch messages at their UI consumer [src/routes/admin/comparisons/+page.svelte:495]
  Render records with each flag and assert the corresponding visible evidence message. A backend-only assertion does not protect the display branch.
- [x] [Review][Patch] R18 Preserve human-entered judgement strings verbatim [convex/comparisons.ts:82]
  Validate trimmed nonemptiness and original-size limits while preserving the caller string for storage. Add exact equality assertions for whitespace-bearing draft and provenance fields; match normalization remains separate.
- [x] [Review][Patch] R19 Produce generated API bindings with Convex codegen [convex/_generated/api.d.ts:69]
  RESOLVED before recovery: canonical npx --no-install convex codegen --typecheck disable succeeded using existing selected deployment credentials; no finishPush/deployment. It produced 18 required type lines, including missing earlier story helpers. Only api.d.ts changed; post-generation type/browser checks are in progress.

### Review dispositions that do not change the product contract

R9: a stored-draft inspection screen is not an acceptance requirement. R11: adding recordedBy would change AD-29's fixed field list. R13: do not invent automatic eligibility from free-text product/model names; retain manual protocol and caveat evidence. R20: the mandated auth helper returns NOT_AUTHENTICATED for absent identity and NOT_AUTHORIZED for authenticated non-admins. Preserve that established authorization behavior and make exact tests/documentation agree. These are review dispositions, not native deferred-work entries.

## Auto Run Result

Status: done.

The recovered Paired Comparison feature retains admin-only immutable records, exact report pins, human-entered measurement evidence, bounded reads, and explicitly qualified SM-1/SM-2 results. This pass repaired count-entry rounding and added missing verification at the report, loading, and history-disclosure boundaries.

Files reviewed since the workflow baseline:
- `convex/comparisons.ts`: immutable recording, provenance, bounded queries, and qualified metrics from the recovery implementation.
- `convex/lib/comparisonText.ts` and its tests: extracted-prose normalization and nonempty match evidence.
- `convex/comparisons.test.ts`: backend boundary coverage, including this pass's retained-original-pin case.
- `src/routes/admin/comparisons/+page.svelte`: frozen judgement state and disclosures; this pass adds exact decimal count validation and maximum feedback.
- `src/routes/admin/comparisons/comparisonsRecord.component.test.ts`: executing route coverage, now 23 tests.
- This story and `.audit/pd-generation-story-6-followup2-20260912/`: review dispositions, portable regression reproduction, verification logs, and preservation evidence.

Review result: 7 patches (0 high, 1 medium, 6 low), 0 deferred, 5 rejected, no intent gap or bad-spec loopback. Follow-up score is 9; `followup_review_recommended: true`.

Verification: `npm ci` exited 0 with manifest and lock unchanged. The original-source count regression failed as expected, as did the two prior UI and three prior backend regression cases reconstructed by the portable runner. `VERIFY_COMPONENT=1 bash scripts/loop-verify.sh` exited 0 on the final source with a fresh canonical optimizer cache: all ten steps passed, 2,639 unit tests and 636 browser tests, zero Svelte errors or warnings, production build and both uploader harnesses passed. Source inspection confirms one comparison insert, no patch/delete path, no tool-derived metric reads, and unchanged shared component source. Ledger hashes remain identical.

Limits: boundary tests use the real Svelte form and convex-test database with transport stubbed; they do not claim a hosted browser-to-Convex result. Manual metric conditions and honest incomplete-corpus withholding remain as designed. Native ledger status and final run acceptance belong to the orchestrator.
