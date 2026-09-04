# DW42 documentation repair evidence

Baseline: `b99f1eeef78348df5c14f68031f7f0276527ff3f`.
Branch: `codex/bmad-privacy-contract`.
Scope: documentation of the existing approved story 2 contract only.

## Authorization and source provenance

The documentation repair was authorized on 2026-09-04 in root Codex task
`01a06dc8-a784-7e33-8e47-d10a6f994549`. Root supplied this excerpt from the
user's request: "fix all failed stories and epics ... Once all done, verify,
test, double check work then when passed to commit and push to merge to main".
This authorizes completing the repair; it is not a new product-policy approval.
The existing approved story 2 contract remains the source of product intent.

Portable sources: [story 2](../../_bmad-output/specs/spec-ai-engine-sprint-2-learn-chat/stories/2-de-identification-before-firm-wide-knowledge.md)
and [CAP-1 SPEC](../../_bmad-output/specs/spec-ai-engine-sprint-2-learn-chat/SPEC.md#capabilities).
All implementation and test line references below refer to the inspected
revision `b99f1eeef78348df5c14f68031f7f0276527ff3f`, not an arbitrary future checkout.
The story read from the learn-chat worktree and the tracked story at that
revision both have Git blob `070de74cb34c7d9fab7276964d1bf9eeabd7fbcb`, verified
with `git hash-object` and `git rev-parse REV:path`. The verifier rechecks the
portable tracked copy against this blob. DW42 denotes the originating
learn/chat run's local obligation label, not a canonical ticket identifier.

## Reproducible static verification

Run from the repository root:

```sh
python3 .audit/DW42/verify.py
```

The committed verifier compares baseline and amended documents, checks the
non-null/null publication boundary, read/write limitations, relative links,
canonical story identity and unchanged frozen intent. It checks the complete
baseline-to-working-candidate diff, including staged changes, and separately
accounts for untracked files. Its exact final candidate allowlist is:

- `docs/product-domain.md`
- `docs/the-brain.md`
- `_bmad-output/implementation-artifacts/spec-dw42-privacy-contract.md`
- `.audit/DW42/evidence.md`
- `.audit/DW42/decisions.tsv`
- `.audit/DW42/verify.py`
- `.audit/DW42/review.md`

The three untracked `dw42-review-prompts/{blind-hunter,edge-case-hunter,verification-gap}.md`
files under implementation-artifacts are review dispatch inputs, excluded
from the candidate and explicitly allowlisted. Ignored BMAD runtime files
are outside this Git scope check. Source and test references are inspection
evidence; no runtime suite was executed by this documentation repair.

## Acceptance evidence

| Acceptance | Direct source inspection |
| --- | --- |
| Approved contract only | Canonical story 2 read fully in the learn-chat worktree; its Intent, Always/Never boundaries and matrix define the amendment. `convex/lib/deidentify.ts:20-102` confirms actual helper fields, placeholders and best-effort limits. |
| Exact boundaries and compatibility | `convex/brain.ts:229-250` scrubs nomination prose/title and retains pending approval; `convex/generations.ts:1965-1996,2117` preserves raw report prose/editRatio and scrubs event writes; `convex/learning.ts:74-98` scrubs proposal reads only, using the current or absent project; `convex/learning.ts:102-114` returns stored section-event text. Historic rows and other streams remain deferred in canonical story 2. |
| Publication, null disable, unchanged authority | `convex/learning.ts:305-365` requires settings.configure, checks expectedSelectionId, gates all non-null ids before same-id return, rejects personal digests, and appends selection events without persisting the privacy flag. `src/routes/admin/reviews/+page.svelte:39,84-87,214-217,233-254,323-344` confirms per-kind state, reset and ungated disable. |
| Generic rules | `convex/ai/learning.ts:96,114,185` appends the shared privacy instruction to both prompts. |
| Documentation-only scope | The committed verifier checks the full baseline-to-final-working-candidate file set, staged changes and untracked review prompts against the explicit allowlist above. No runtime, canonical story, ledger, or native run file edited. |

## Existing coverage inspected, not executed

The named test locations were inspected to verify that the domain document's
verification pointers exist: `convex/lib/deidentify.test.ts:5-155`,
`convex/brainFeedback.test.ts:556`,
`convex/generationLifecycle.test.ts:1471,1503,1530`,
`convex/learning.test.ts:277,302,380,405`, and
`src/routes/admin/reviews/reviewsPublishGate.component.test.ts:91,120,134`.
No claim is made that these tests passed in this repair session.

## Review and limitations

Root reported all three independent BMAD reviews complete and supplied ten
patch findings. Dispositions are recorded in [review triage](review.md).
All were addressed within documentation intent; static checks were rerun.
Root owns broader runtime product gates, push and merge. No heavy checks,
dependency installation, canonical ledger/status changes, or native run
changes were performed. Best-effort privacy limitations remain unchanged.

## Brain reference follow-up

Root identified that DW42 also explicitly names `docs/the-brain.md`. Read the
entire reference and added a bounded CAP-1 section under ingestion instructions.
It documents the actual `nominateFromReport` content/title scrub, pending status,
forward-only scope and excluded import paths, then distinguishes digest
publication from Brain approval and links to the domain amendment.
Source evidence is unchanged: `convex/brain.ts:229-250` and
`convex/learning.ts:305-365`, plus the canonical story's deferred import gaps.
The frozen repair intent was preserved byte-for-byte; only the non-frozen
execution map, changelog and verification were extended.

Static follow-up checks compare both documents to the original baseline,
validate the relative link and heading, and ensure the complete tracked diff
contains only the two docs, repair spec and audit evidence. These checks do
not claim runtime test execution. Independent review results and patch dispositions are recorded above.

## Final static check output

```text
PASS: baseline omission, final documentation boundaries, links, story identity and frozen intent.
PASS: complete baseline-to-working-candidate tracked/staged changes plus new files match seven-file repair allowlist.
PASS: whitespace and added-prose checks. Static verification only; no runtime tests executed.
```

The verifier also lists the three untracked review-prompt inputs explicitly.
BMAD step 05 completed this documentation repair; root's broader product
verification and integration are separate.
