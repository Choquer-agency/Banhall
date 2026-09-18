# Addendum: Step-by-step PD generation: Idea Seeds before prose

This addendum to the [product requirements document (PRD)](prd.md) contains depth for downstream architecture, user experience (UX) and story work, or material that earned a place but does not fit the PRD. It is not part of the requirements contract. Functional requirement (FR), non-functional requirement (NFR), success metric (SM) and open question (OQ) references point to that PRD unless dated otherwise.

## A. Options considered for the gate

| Option | Shape | Why not / why |
|---|---|---|
| A. Keep section-level approval, make the existing edit box and guidance box discoverable | Same stepper (it already has a textarea edit and a regeneration guidance box) | Cheapest; but the unit of review stays a 50-line section, which is the complaint. Rejected. |
| B. Paragraph-level prose approval | Draft each of 13 roles as prose, approve each | Writer still reviews prose; 13 approvals of paragraphs is slower than today, not faster. Rejected. |
| C. Seeds per Subsection, Summary Sign-off, then prose (chosen) | This PRD | Matches the handoff and Michael's stated intent; keeps Prose Generation one unattended run. |
| D. Seeds per Subsection *and* per-section prose approval after | C plus today's stepper | Two gates; defensible for cautious writers. Deferred to OQ-2 rather than rejected. |
| E. Brief approval as the gate (09-09 OQ-5 literal) | Approve Storyline/Confidence Map, then draft | The Brief is a derived summary of facts, not positioning choices per role; too coarse. Closed by this PRD. |

## B. Mechanism sketch (for the architect; not binding)

### Pipeline position

The seed stage is a new filter inside the existing gated generation: `reserveGeneration` → analysis + Brief (unchanged) → *seed stage* (generation stays in the human-gated status) → Sign-off → per-Section drafting chain (reuse the ordered chain, gated off) → existing report creation → post-generation quality assurance (QA).

### Records

All records have `projectId` and `generationId` and are project-scoped.

- `seedBatches` — one per Batch: subsection role id, version, status (`queued|running|shown|superseded|failed`), request fingerprint, model, slot, prompt version, created/completed.
- `seeds` — one per Seed: batch id, bullets[] (1–2), tags[] (1–2, closed set), provenance[] (source id, byte offsets, exact excerpt), `unsupported`, `supersededBySeedId`, `revisionOfSeedId`, `feedbackText`.
- `seedSelections` — one per (generation, seed): edited bullets or null, selected flag, version.
- `seedSubsections` — one per (generation, role): kind, state (`untouched|generating|in_progress|approved|skipped`), `stale` + reason, approvedBy/At, version.
- `summaryVersions` — frozen snapshot of all Seed Selections in FR-2 order, `signedOffBy/At`, used by the drafting chain; `generations.summaryVersionId` links the report to its plan.
- `seedDecisionEvents` — append-only.

Precedents: Brief tables (parent + child rows, two named writers, server-side `change` stamping) and `generationSectionRuns` (claim/complete/fail, attempt fences). Do not add `generations.status` values. Reads bounded with `createReadBudget`; one query returns the Outline (13 rows), one returns the active Subsection's Shown Set (shown Batch ≤ 5, plus Revised Seeds and carried Seed Selections, paginated when it exceeds the read budget).

### Calls

One structured-output call per Batch with a tool schema `{seeds: [{bullets, tags, provenance}]}`. Validation drops out-of-contract Seeds server-side; a Batch of fewer than three after validation fails the attempt. The structured-output two-request repair is the only automatic retry, shared by shape, Tag and form checks; see FR-5/FR-6. Feedback: one attempt with the target Seed, its wording hash and the instruction, returns 1–3 Revised Seeds (see **Feedback** below). Named slots `generation:seeds:<role>` and `generation:seed-feedback`, added to the slot validator. Each Batch action is one scheduled action (well inside the 5-call and 600 s budgets). Prefetch is a second scheduled action after Approve, never concurrent with a writer-triggered Batch for the same role (fingerprint dedupe).

### Context

Batch prompt = static policy system prompt (byte-stable per writer style hash) + user message with delimited data blocks: Subsection objective (from the shared role table), Brief entries, transcript excerpts selected for the role (reuse analyzer output and the trusted-context selector), current Seed Selections in FR-2 order (final wording, class "writer decision"), Feedback on this role, Writer Profile projection. Seeds are class C1/C2 content.

### Drafting from the Summary

The existing section agents accept a "content plan" block: for each of the Section's roles, its Seed Selections as bullets (with support status and, for role 11, references), Multiple roles as ordered lists, and each skipped role as an explicit do-not-cover instruction. The Self-check gets two extra rules: every Seed Selection is covered or reported, and every Skip is honoured or reported, in the Compliance Note (FR-25). `[NOT GENERATED]` placeholder behaviour and line limits unchanged.

### Decision Set and Context Revision

For Subsection k the Decision Set is the active Seed Selections (final wording), Skips and active Feedback instructions of Subsections with order < k, plus the frozen Brief version and settings. The mutation computes `contextRevision(k) = sha256(canonical JSON of the Decision Set + k's own active Feedback)`. Every `seedBatches` row stores an immutable `consumedContextRevision` and an `attemptId`; `seedSubsections.currentContextRevision` is recomputed for every Successor in the same transaction as any decision change. Outdated = `shownBatch.consumedContextRevision !== currentContextRevision`. Approve records `approvedContextRevision = currentContextRevision` and `approvedSelectionRevision = selectionRevision`, with `confirmed: true` when the shown Batch or any selected Seed's Batch consumed a different revision. Stale (derived) = `state = approved && (approvedContextRevision !== currentContextRevision || approvedSelectionRevision !== selectionRevision)`; a `seedStaleEpisodes` row opens on the first true transition and is disposed `resolved` (approve) or `bypassed` (skip, cancel).

### Attempt ownership

`seedSubsections.pendingBatchId` names the Batch whose attempt is allowed to become current. `seedRuns.completeAttempt` for any other Batch records a late delivery that never becomes current. The lease is 10 minutes; `seedRuns.failAttempt`, called by the reaper for an expired Batch, marks the attempt failed and clears `pendingBatchId`. `consecutiveFailures` increments on failure and resets on success. Three consecutive failures with no shown Batch produce the visible `failed` state, but the writer can retry without limit.

### Worked event trace (for the metrics)

Larry opens S1 (batchShown by system, batchViewed by Larry), selects two Seeds (2 select), edits one (edit, ratio 0.3), approves (approve, snapshot 2 ids). Opens S9, feedback on Seed X (feedbackRequested), result (batchShown kind feedback), selects one revision (select), approves (approve). Unticks an uncertainty in S5 (deselect → staleOpen for S8, S9, S10, S11). Re-approves S5 (approve), regenerates S8 (regenerate, batchShown), approves S8 (approve → staleClose resolved/regenerated), approves S9 with confirmation (approve confirmed → staleClose resolved/confirmed). Expected: SM-3 numerator for S1 = 1 (one unedited Seed Selection remains), SM-5 = 1 request resolved with ≥1 selected, SM-6 = 4 episodes opened, 2 resolved at that point (S10, S11 still open), active time = sum of gaps < 10 min.

### Versions

The system bumps a per-generation `seedStageVersion` on every writer-initiated seed mutation. Writer mutations send `expectedSeedStageVersion` (Batch completions are fenced by `pendingBatchId` instead, FR-19). The bump is a plain helper in `convex/generations.ts` that accepts the caller's `MutationCtx`, so the seed write, version bump and event stay in the same transaction. A mismatch returns the existing `STALE_REVISION`; the live query refreshes and the client keeps unsaved box text. Navigation (open Subsection) is client-local per user.

### Legacy

`generations.gatedWorkflow: "sections" | "seeds"` is written at reservation; surfaces and mutation guards branch on it. A seeds generation renders an initializing state until its 13 rows exist.

### Feedback

One call returns 1–3 Revised Seeds with `revisionOfSeedId`; they are inserted unselected.

### Usage metering

Up to two model requests are reserved at dispatch and reconciled at completion for every seed-stage attempt. Initial attempts, structured-output repairs, Feedback, prefetch, failures and every writer-requested retry are metered. The running count and cost are informational only: there is no allowance, hard cap or `extendBudget` mutation, and Retry remains available without limit (NFR-3, FR-27; owner decision 2026-09-17).

## C. Cost model (to be measured; assumptions)

| Item | Calls | Notes |
|---|---|---|
| Analysis + Brief | as today | once |
| First pass: 13 Batches | 13 | ~2–3k input tokens each (Brief + role excerpts + Seed Selections), ~400 output |
| Feedback, typical | 2–5 | 1–3 Revised Seeds each |
| Regenerate, typical | 1–3 | |
| Prose: 3 Sections × (draft + Self-check + ≤1 repair) | 6–9 | as today's gated mode |
| Ghost draft | 0 | retired for seed generations by the owner decision of 2026-09-17 |

Typical seed-stage total is estimated at 16–21 calls, with a median expected below the informational notice at 40. There is no hard cap. Latency: one Batch is one small structured call, so p50 ≤ 12 s is plausible on Sonnet-class models; measure on the production model before fixing NFR-1.

## D. UX notes for the design step

- Reuse the intake-workbench split contract (persistent left pane, independent scroll, keyboard-resizable divider, `<lg` one-pane switch) rather than adding a third pane next to the existing right rail. Decide where the Brief rail goes while the seed workspace is open (likely: rail collapsed by default, available).
- Card = white card, checkbox (bits-ui), bullets in `.text-body`, Tags as word pills, provenance chip like `BriefSourceChip`, Edit and Give feedback as visible (not hover-only) actions, one primary action per surface (Approve).
- Sticky Section/Subsection navigation in Summary Review is a new pattern; pinned rows exist (rail/composer) but no sticky in-page nav. Design it once and note it in the design system.
- Announcements via `aria-live="polite"`.

## E. Rejected alternatives

- Generating all 13 Batches up front at start: simpler mental model, but 13 calls before the writer sees anything and no conditioning on choices. Rejected for lazy + one-ahead prefetch.
- Storing Seeds as `chatProposals`: Seeds are not prose edits and would pollute the proposal state machine. Rejected; own tables.
- Making Subsections H2 headings in the report: breaks the three-heading parse contract and Canada Revenue Agency (CRA) form-field identity. Rejected.
