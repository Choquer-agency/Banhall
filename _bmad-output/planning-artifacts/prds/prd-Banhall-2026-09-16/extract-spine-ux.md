# Extract: architecture spine (2026-09-03) and UX design (2026-09-09)

Subagent extraction, 2026-09-16. Sources: `_bmad-output/planning-artifacts/architecture/architecture-Banhall-2026-09-03/ARCHITECTURE-SPINE.md`, `_bmad-output/planning-artifacts/ux-designs/ux-Banhall-2026-09-09/{DESIGN.md,EXPERIENCE.md,mockups/}`, `docs/design-system.md`, `docs/svelte-migration.md`.

## 1. Spine invariants that bind a seed workflow

- AD-1 [ADOPTED] new AI work is a new filter in `convex/ai/` scheduled as an action with a durable run row; dependency direction `shared/` → `convex/lib` → `convex/ai` → `convex/*.ts`; `src/` imports only `shared/`, `convex/_generated/api`, runtime-free `convex/lib`.
- AD-2 [ADOPTED] `generations.status` vocabulary closed (`reserved|running|awaiting_selection|awaiting_input|completed|failed|superseded`), written only by `convex/generations.ts`; never touches `projects.workflowStage`. Per-subsection states must live on new rows.
- AD-3 [ADOPTED] one prose-write path: seven revision writers + two creation writers; final "Generate" must go through a creation writer (`createGeneratedReportArtifacts`), not a new revision writer.
- AD-4 [ADOPTED] agents propose, humans apply; prose-touching AI output lands as `chatProposals` pending. An idea seed is not prose: seeds get their own table (like `generationBriefEntries`).
- AD-5 [ADOPTED] frozen inputs in `generationSources`, `promptVersion` + `learningDigestIds` stamped, one active generation per project (`GENERATION_ACTIVE`); reapers never reap `awaiting_input`.
- AD-7 [ADOPTED] capabilities resolved in Convex; new generation-adjacent writers copy `selectReportCandidate` (`requireReportEditAccess`).
- AD-8 [ADOPTED] Tiptap JSON + exactly three H2 headings `Line 242/244/246` parse contract. 13 subsections cannot become 13 H2s.
- AD-9 [ADOPTED] one routing point (`clientForModel`), Node actions ≤600 s, `SEQUENTIAL_CALLS_PER_GENERATE_CANDIDATE = 5`, every call metered via `convex/ai/instrument.ts` into `aiUsage`.
- AD-11 [TARGET] trusted-context boundary: client text as delimited data blocks in user messages with class + provenance; approved seeds fed to later prompts go through `convex/ai/trustedContext.ts`, never the system prompt.
- AD-16/AD-26 style precedence Locked > enforced Org Mode > Writer Profile > House Rules; `getEffectiveWriterStyle` computes tier.
- AD-19 [TARGET] every new table carries `projectId` directly and is listed in `convex/lib/projectScopedTables.ts` (`convex/projectErasure.test.ts` enforces).
- AD-21 seed text is C1/C2: never in `console.*` or `errorReports`.
- AD-23 [TARGET] Brief pattern: parent + child rows, `inputsHash` by one helper, indexes `by_projectId_and_inputsHash`/`by_generationId`, exactly two named writers, reuse = MAX(version), re-derivation stamps `change: added|removed|unchanged` server-side; citations validated like `createProvenance`. Template for stale-marking.
- AD-24 [TARGET] ordered generation = chain of per-section actions; gated only in `iterative`; stop via one CAS mutation; `[NOT GENERATED]` placeholders; recovery by the existing `failStaleGenerations` reaper, no new reaper.
- AD-25 Compliance Notes rows; AD-27 named call slots (`generation:brief`, `generation:section:<n>`; validator rejects unknown `generation:*` labels: a seed stage needs new enumerated slots); AD-30 inclusion status (cap 12 documents).
- Conventions: camelCase plural tables; indexes `by_<field>[_and_<field>]`; paginated indexed queries; `*Events` append-only; `requireX`/`getXOrNull`; scheduler-only writers `internalMutation`/`internalAction`; epoch-ms; `domainError(code)` from `convex/lib/contracts.ts` closed list; OCC via `expected*`; idempotency via `createRequestId`; run rows `queued → running → completed|failed` plus `awaiting_*` with `by_status_and_startedAt` and a `claim*` internalMutation.
- Module homes: isomorphic vocabulary in `convex/lib/` (precedent `convex/lib/orderedChain.ts`), model stage in `convex/ai/`, public API in new `convex/<feature>.ts` (precedents `convex/briefs.ts`, `complianceNotes.ts`, `comparisons.ts`). Bounded list reads via `createReadBudget`.
- Tests: vitest projects `convex` (convex-test), `shared`, `src`; `*.component.test.ts` under `vitest.component.config.ts`; every new mutation ships an authorization-branch case; extended AD guard lists extend their enforcing tests.

## 2. New tables / migrations

AD-10 widen→backfill→migrate→narrow; new fields `v.optional`; backfills idempotent paginated `internalMutation`s at `/admin/backfill`. Spine Deferred list explicitly defers "per-section multi-select generation and an optional per-writer Brief gate" to v2 / PRD OQ-5: this feature needs a new dated AD. Open Q3 (no capability cell on generation) and Q9 (retention) apply.

## 3. UX system and reusable components

`docs/design-system.md` ("Ledger paper"): bands + hairlines, never boxes-in-boxes; `.card` white/`border-line`/`rounded-xl`; `gray-50` bands; `line-soft` hairlines; `chrome` recessed wells. Selection grammar: `aria-pressed` button groups with `border-primary-selected bg-primary-selected text-white` active (`CandidateSelection.svelte:262-290`); "active tab = primary fill + white text, inactive hover = primary wash". Density 48px comfortable / 36px compact, 44px touch targets. Panels `popIn`/`popOut` (`src/lib/motion/panelMotion.ts`). Split-pane precedent: intake workbench (design-system.md:446-458): persistent left pane, independent `overflow-y-auto` inside `h-dvh`, keyboard resizable separator clamped 24–55% persisted in localStorage; below `lg`, `aria-pressed` switches with one pane visible.

Reusable (`src/lib/components/`): `ui/Checkbox.svelte` (bits-ui), `ui/Disclosure.svelte` + `DisclosureChevron.svelte`, `ui/Button.svelte`, `ui/IconAction.svelte`, `ui/Badge.svelte`, `ui/Spinner.svelte`, `ui/GhostPopover.svelte`, `ui/Tooltip.svelte`, `ui/LazyModule.svelte`, `ui/drawer/*` (Vaul), `ui/PageBar.svelte`, `project/EditableText.svelte`, `brief/BriefRail.svelte` + `BriefRailPanel.svelte` + `BriefEditableText.svelte` + `BriefSourceChip.svelte`, `qa/QARailPanel.svelte`, `editor/QAScorePanel.svelte`, `chat/primitives/*` (`Suggestion`, `Source*`, `PromptInputTextarea`; no standalone Textarea), `generation/GenerationProgress.svelte`, `IterativeStepper.svelte`, `CandidateSelection.svelte`, `ModelSelectPanel.svelte`, `roles/RoleGuideSheet.svelte`. Rail host + resize + `railView` in `project/CurrentProjectPage.svelte:489-560, 1400-1560`.

## 3b. EXPERIENCE.md designed generation surfaces

Mockups: `key-chat-coordinated-revision.html`, `key-editor-compliance-line.html`, `key-report-workspace-brief-rail.html`. Brief rail = third `railView`, Disclosure groups, inline edit, "Regenerate with this Brief" after an edit, "N added · N removed". `GenerationProgress` rows: `queued · drafting · checking · shown`, "Stop after this section", no approve step; `IterativeStepper` untouched as the only gated path. Explicit rejections: gating on Brief approval in single/compare (SM-C4); modals for the Brief; colour-only status; hover-only edit affordances; auto-apply. Primitives: Disclosure, `aria-live="polite"`, one primary action per surface, rail resize `role="slider"`, `<lg` rail becomes sheet. WCAG 2.2 AA, 44px targets, every pill carries its word, `aside aria-label`, focus trap/return. Pre-feature generations render new surfaces as absent (AD-23).

## 4. Hard rules

Tokens: `primary #0DACA5` (active marker, single loud fill), `primary-dark` hover, `primary-selected #087A75` for lagoon text/fills on white, `primary-light` focus ring only, `primary-wash #F1FAF9` hover, `chrome #EAF2F1`, `canvas`, `surface`, `line`/`line-soft`, `gray-50`, `gap-bg/gap-text`, `red-700` destructive only. Type roles `.text-title` 17, `.text-body` 14/400, `.text-label` 11 caps, `.text-data` 12 mono; max weight 500. Radii xl 12 cards, md 8 callouts, full pills. No Tabs primitive: tab-like selection is an `aria-pressed` button group. Textarea via `PromptInputTextarea`. Drawer via `ui/drawer/*`. Svelte 5 runes; `useQuery(..., () => authed ? args : "skip")`, `useStableQuery`, `useMutation`; no `withOptimisticUpdate`; component-local runes.

## 5. Contradictions / complications

1. 13 subsections vs 3: AD-8 three H2s; `convex/lib/orderedChain.ts` `SECTION_NUMBERS`; `lineLimits.ts` per three; AD-24/AD-25 index by `section`. Need subsection vocabulary inside the three plus "subsections are not H2s" rule.
2. The gate: allowed only on the `iterative` axis (`awaiting_input`); needs a dated AD; currently Deferred to v2 / OQ-5.
3. Full-screen summary review vs "no modals, never a gate": needs a route or explicit exception.
4. Split-pane + rail collision: reuse the intake-workbench split, not a third pane.
5. Sticky nav has no precedent: new pattern decision.
6. Budgets: 13 × 3–5 cards vs AD-27 slots and AD-9 five calls per action: new enumerated slots, own actions, `createReadBudget` reads.
7. Conditioning on approvals vs `inputsHash`: stale-marking via AD-23 server-side `change` stamping; decide reuse/versioning explicitly.
8. Feedback is a learning signal (AD-12 no stream without a reader; AD-13 de-identify; writer identity `Id<"users">`).
