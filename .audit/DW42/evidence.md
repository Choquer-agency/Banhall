# DW42 documentation repair evidence

Baseline: `b99f1eeef78348df5c14f68031f7f0276527ff3f`.
Branch: `codex/bmad-privacy-contract`.
Scope: documentation of the existing approved story 2 contract only.

## Baseline failure and corrected artifact

A Python comparison using `git show b99f1eeef78348df5c14f68031f7f0276527ff3f:docs/product-domain.md`
confirmed that the baseline has neither `privacyReviewed` nor the new privacy
amendment. The updated domain document has `privacyReviewed: true`,
`digestId: null`, and an explicit reservation of story 4's mixed-stream policy.
The same check confirmed no em dash in the added amendment. These are static
document checks, not tests of runtime behavior.

Output:

```text
PASS: baseline lacks privacy contract; amended document contains publication/null boundaries and preserves unresolved story 4 policy.
PASS: amendment introduces no em dash.
```

## Acceptance evidence

| Acceptance | Direct source inspection |
| --- | --- |
| Approved contract only | Canonical story 2 read fully in the learn-chat worktree; its Intent, Always/Never boundaries and matrix define the amendment. `convex/lib/deidentify.ts:20-102` confirms actual helper fields, placeholders and best-effort limits. |
| Exact boundaries and compatibility | `convex/brain.ts:229-250` scrubs nomination prose/title and retains pending approval; `convex/generations.ts:1965-1996,2117` preserves raw report prose/editRatio and scrubs event writes; `convex/learning.ts:74-98` scrubs proposal reads only, using the current or absent project; `convex/learning.ts:102-114` returns stored section-event text. Historic rows and other streams remain deferred in canonical story 2. |
| Publication, null disable, unchanged authority | `convex/learning.ts:305-365` requires settings.configure, checks expectedSelectionId, gates all non-null ids before same-id return, rejects personal digests, and appends selection events without persisting the privacy flag. `src/routes/admin/reviews/+page.svelte:39,84-87,214-217,233-254,323-344` confirms per-kind state, reset and ungated disable. |
| Generic rules | `convex/ai/learning.ts:96,114,185` appends the shared privacy instruction to both prompts. |
| Documentation-only scope | `git diff --check` passed; `git diff --name-only` showed `docs/product-domain.md` before adding the new repair spec/audit artifacts. No runtime, canonical story, ledger, or native run file edited. |

## Existing coverage inspected, not executed

The named test locations were inspected to verify that the domain document's
verification pointers exist: `convex/lib/deidentify.test.ts:5-155`,
`convex/brainFeedback.test.ts:556`,
`convex/generationLifecycle.test.ts:1471,1503,1530`,
`convex/learning.test.ts:277,302,380,405`, and
`src/routes/admin/reviews/reviewsPublishGate.component.test.ts:91,120,134`.
No claim is made that these tests passed in this repair session.

## Pending review and limitations

Root owns BMAD step 04 independent review and all broader runtime gates.
The local candidate is prepared for review, not marked done. No heavy checks,
dependency installation, push, canonical ledger/status changes, or native
run changes were performed. The separate Brain reference documentation gap
and story 4 mixed-stream decision are outside this bounded domain-document
repair. Best-effort privacy limitations remain unchanged.
