# Independent Fable 5.1 review of c81e34b + d8d045d (DW-135)

Verdict: ACCEPT_WITH_FIXES

Coverage note (reviewer): validation at both layers verified; applyProposal /
reject / reword refuse before report reads; every reader of `applied` checked
(applyProposal, markProposalApplied, rejectProposal, updateProposalWording,
getChatContextV2 / chatEvidence decisions, turnParts.correlateProposals,
ProposedEditCard, ChatProposalArtifact, AgentChatPanel scroll effect,
LogsPanel, chat.ts legacy, learning.ts digest, research.ts); before logs show
genuine failures; screenshots match; prompt copy accurate.

## Findings to apply

1. Medium — `src/lib/chat/turnParts.ts:123-127, :184-189`: proposeBulkEdits
   trace label/detail ignore `record.edits`. When `edits` is an empty array,
   show "Recorded N findings, nothing to apply" (detail) and a matching done
   label. Test in `turnParts.test.ts`.
2. Medium — `docs/product-domain.md:1440-1466`: split the amendment into
   "Owner decision (approved 2026-09-14): zero-edit proposal allowed when every
   finding is blocked or conflicting; nothing to apply" and "Implementation
   decisions (recorded, not separately approved)": reuse of terminal `applied`
   (cite AD-4 highlight precedent), new internal-access query
   `listProposalItems`, no actions including Refine. Add the doc's amendment
   checklist bullets (:1990-1998): affected tickets (DW-135, Greptile PR #12),
   migration/compatibility (none; existing rows unaffected because the
   predicate needs `requireUniqueTargets` and zero pairs), authorization/test
   impact (`listProposalItems` gated by `requireInternalProjectAccess` like
   `listProposals`). Add "except a zero-edit revision, see 2026-09-14" to the
   sentence at :2005.
3. Low — `convex/chatV2.ts:333-341, 386-391`: refuse a record-only proposal as
   `refineProposalId` (same "Suggestion not found" path). Test.
4. Low — `convex/chatV2.ts:635-646` markProposalApplied: move references /
   record-only / requireUniqueTargets refusals ahead of the already-applied
   short-circuit so a record-only id is refused, not reported applied. Test.
5. Low — `convex/chatV2.ts:770` rejectProposal (and updateProposalWording):
   explicit record-only branch with copy "This record has nothing to reject."
   / "…nothing to reword."; assert messages in
   `convex/chatProposalItems.test.ts:211-229`.
6. Low — `shared/chatProposals.ts:26-34` vs saveProposal: in the recordOnly
   branch refuse when `(args.replacements ?? []).length !== 0` so stored shape
   matches the amendment's `replacements: []`. Test.
7. Low — `convex/chatV2.ts:1593-1605` decisions window: filter record-only
   rows before applying the 12-row window if that's cheap and bounded (e.g.
   take a slightly larger bounded window then filter, then slice 12);
   otherwise document as pre-existing in evidence limitations.
8. Low — listProposalItems test: add a signed-in user on another project →
   NOT_AUTHORIZED.
9. Low — `NothingToApplyCard.svelte`: use `aria-labelledby` on the heading
   instead of duplicate `aria-label`; render "No findings were recorded." when
   the loaded item list is empty. Component test for the empty case.
10. Low — `scripts/chat-behavior-eval.mjs:199` honestProposalStatus: accept
    `^Nothing to apply` when `edits.length === 0` (no fixture needed; add a
    unit-level check only if the script has tests, otherwise note in
    evidence).

Process: before logs for new/changed tests on d8d045d source, after logs;
rerun convex tsc, `npx vitest run`, `npm run check`, `npm run test:component`;
save under `.audit/DW-135/review-fix/`. One commit, same trailers.
