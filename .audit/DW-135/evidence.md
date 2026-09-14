# DW-135 evidence — zero-edit Coordinated Revision (AD-28 amendment)

Baseline: `b9a842e1a804a298eb4895d1c5b66ace85e333c2` (branch `fix/pd2-dw135`).
Owner decision: option A, approved 2026-09-14 — a Coordinated Revision may carry
zero edits when every finding is blocked or conflicting; it has nothing to apply.

Reviewer note: per the owner's instruction on 2026-09-14, this change is
reviewed by Fable 5.1 instead of the AGENTS.md default reviewer (`gpt-6-astra`).

## The defect (Greptile P1 on PR #12, `convex/lib/completionReport.ts:192`)

`bulkEditInputSchema` required `edits.min(1)`; `saveProposal` refused zero
pairs ("No passages were supplied."). When every inventory finding was blocked
or conflicting the tool could not validate, so no `chatProposals` /
`chatProposalItems` rows were written and the findings lived only in reply text.

Reproduced at baseline with the new tests (source untouched, tests added):

- `before-vitest-backend.log`: 4 files, **12 failed / 88 passed**. Key lines:
  `Too small: expected array to have >=1 items` (schema), `expected { ok: false }
  to match object { ok: true }` (no rows saved), `'Proposal NOT created: No
  passages wer…' to match /^Nothing to apply/` (tool body).
- `before-component.log`: **2 failed / 1 passed**; `nothing-to-apply-before.png`
  shows the baseline card rendering a zero-edit record as "Replaced in report".

## Points → tests → before/after

| # | Point | Where | Test | Before | After |
|---|---|---|---|---|---|
| 1 | Amendment recorded | `docs/product-domain.md` "2026-09-14 — Zero-edit Coordinated Revision (AD-28 amendment)" | n/a (doc) | absent | present |
| 2 | Schema: zero edits only when ≥1 finding and all blocked/conflicting; resolved must claim an edit; empty stays invalid; coverage intact | `convex/lib/completionReport.ts` `zeroEditIssue`, `nothingToApply`, `bulkEditInputSchema` (`edits` lower bound removed) | `convex/lib/completionReport.test.ts` "bulkEditInputSchema with zero edits (DW-135)" (7 cases) | 5 failed | pass |
| 3a | Persistence: proposal + item rows saved with zero edits, terminal `applied` state | `convex/chatV2.ts` `saveProposal` (`recordOnly`) | `convex/chatProposalItems.test.ts` "a zero-edit Coordinated Revision (DW-135)" | 5 failed | pass |
| 3b | applyProposal refuses, no prose mutation, no snapshot, rows intact; reject/reword refused | `convex/chatV2.ts` `applyProposal` guard | same suite: "has nothing to apply…", "cannot be rejected or reworded…" | failed | pass |
| 3c | Tool body records and replies "Nothing to apply" | `convex/ai/chatAgentV2.ts` `runProposeBulkEdits` | `convex/chatToolBodies.test.ts` "records an all-blocked report with zero edits…" | failed | pass |
| 3d | Record-only proposal excluded from PRIOR EDIT DECISIONS | `convex/chatV2.ts` `getChatContextV2` | `chatProposalItems.test.ts` "is not handed to the model as a prior edit decision" | n/a (added after before-run) | pass |
| 4 | Prompt/tool copy | `convex/ai/prompts.ts` (3 places), `chatAgentV2.ts` tool description | `convex/ai/prompts.test.ts` "tells the model to record an all-blocked report with zero edits…" | failed | pass |
| 5 | UI: findings shown, no apply action | `src/lib/components/chat/NothingToApplyCard.svelte`, `ProposalCard.svelte`, `shared/chatProposals.ts` `isRecordOnlyProposal`, `convex/chatV2.ts` `listProposalItems` | `src/lib/components/chat/NothingToApply.component.test.ts` (3 cases), `BulkProposal.component.test.ts` unchanged | 2 failed | pass |

## Design

- One predicate, `isRecordOnlyProposal` (`shared/chatProposals.ts`): `kind
  replacements` + `requireUniqueTargets` + zero pairs. Used by `saveProposal`,
  `applyProposal`, `getChatContextV2` and the card, so all four agree.
- One rule, `zeroEditIssue` (`convex/lib/completionReport.ts`), applied by the
  zod schema over findings and by `saveProposal` over item rows.
- Terminal state: `applied` on creation, the state `references` proposals
  already use for "no state machine, nothing for a human to apply". No new
  status, transition or permission. `rejectProposal` / `updateProposalWording`
  refuse it as they refuse any non-pending row.
- `applyProposal` refuses a record-only proposal with "This revision has
  nothing to apply…" before any report read, mirroring the highlight guard.
- New public query `chatV2.listProposalItems({proposalId})`, same access rule
  as `listProposals`, bounded by `MAX_COMPLETION_REPORT_FINDINGS` (80);
  subscribed only by the record-only card.
- Card: design tokens only (`border-line`, `bg-white`, `bg-chrome`,
  `text-ink*`, `text-data`), max weight 500 (asserted in the component test),
  no controls at all, loading and error lines.

## Screenshots

- `nothing-to-apply-before.png` — baseline card for a zero-edit `applied` row: "Replaced in report".
- `nothing-to-apply-after.png` — the record card: "Nothing to apply", both findings with id, status pill, anchor, reason and evidence; no buttons.

## Gates (after)

All run with `PUBLIC_CONVEX_URL=https://placeholder.convex.cloud PUBLIC_CONVEX_SITE_URL=https://placeholder.convex.site`, on the final tree (after the `turnParts` summary change), exit 0 each:

| Command | Result | Log |
|---|---|---|
| `npx tsc -p convex/tsconfig.json --noEmit` | no errors | `after-convex-tsc.log` |
| `npx vitest run` | 189 files, 2716 tests passed | `after-vitest-full.log` |
| `npm run check` | 5961 files, 0 errors, 0 warnings | `after-svelte-check.log` |
| `npm run test:component` | 83 files, 645 tests passed | `after-component-full.log` |

Targeted after-runs (same tree minus the later `turnParts` and decisions tests): `after-vitest-backend-targeted.log` (4 files, 100/100), `after-component-targeted.log` (2 files, 5/5).

Additional coverage added after the before-run: `src/lib/chat/turnParts.test.ts` "reports a zero-edit revision as recorded findings, not a suggestion (DW-135)" (the summary line no longer promises "1 suggestion"); `chatProposalItems.test.ts` "is not handed to the model as a prior edit decision".

## Limitations

- The architecture spine (`_bmad-output/planning-artifacts/.../ARCHITECTURE-SPINE.md`, AD-28) is not edited; the amendment is recorded in `docs/product-domain.md` as instructed.
- `chatProposalItems` rows for proposals that carry edits are still not rendered in the card (out of scope; they remain in the reply checklist and the trace).
- The live `scripts/chat-behavior-eval.mjs` fixtures are not extended; the prompt change is covered by the static prompt test only.
