# Fresh implementation inspection

Inspected at baseline `86a43d9d500ceab34245744d223d4453eba7b667` under the native-bound unsuffixed follow-up spec. Both frontmatter context files were loaded before implementation inspection. No product or test edits were warranted by this inspection.

Read the frozen original QA contract, its retained history, recovery operator note/report, and the approved CAP-8 amendment in `docs/product-domain.md:1605`. Inspected original implementation `b13d5ce9f93fe00ad0d02e15294954a20961b69d` writer/generation/schema/gate additions, lifecycle/cleanup repairs `5b2bed6a0f129af3c9799f8bc80e0fa3ec1e3a01`, extraction changes `40d34059ae38b891023681ac00989d040f9fc973` and `f1a61c44f80268df68b5ebd29bc848eee23490a2`, finalization-only `a62e1760a9931c9451c34baa2df8af29fa1e9538`, and current heap traversal/scheduler assertions `df97838bd97ee68ea6a923c310b3d4ae139556e1`. Historical successful runs are context only.

## Findings and triage

No verified in-scope implementation defect found. Specific concerns checked:

- Exact identity uses actual content SHA-256 plus report ID and revision (`convex/lib/qaFindings.ts:21`). Stored hash corruption cannot relabel a prior finding. Same-content methodology carry-forward queries the same report/hash and only the two approved substantive flags.
- Persistence at report creation and canonical human edit paths calls the shared helper inside the mutation. Both proposal paths, accepted comments, restore, copy, and iterative creation have registered boundary coverage in the existing suites.
- `saveReportQa` checks attempt identity before content identity and persistence (`convex/generations.ts:1766`); identified stale completions release only the matching attempt and do not store the stale scorecard. Legacy unpinned calls cannot create methodology findings.
- Publish checks project access and capability, then report membership, then shared QA gate, before project writes or scheduler calls (`convex/projects.ts:1037`). Shared test helper asserts unchanged project and scheduled functions on rejection (`convex/qaBlocking.test.ts:61`).
- Extractor uses heap traversal in both block and inline passes and preserves paragraph separation, recognized substantive heading prose, renamed/deleted initial headings, established legacy heading labels, and code-block inline cohesion (`convex/lib/tiptapReport.ts:105`).
- Deletion cleanup is bounded at 128 rows and refuses to remove findings for a live report (`convex/projects.ts:1122`, `convex/qaFindingsCleanup.test.ts`).

Rejected policy expansions: mandatory AI reassessment after any changed byte, methodology classification from freeform issue text, and an improved linguistic because classifier. These would change the frozen contract. The existing sentence-level because detector limitation remains accepted historical scope, with no new deferral.

## Fresh proof

The exact focused gate passed 147 tests across three files. Its runtime tests cover the frozen matrix: current because/methodology failures, advisory-only content, manager/admin feedback and style waiver attempts, correction and no-op restore, late QA, legacy rows, foreign/stale identity, passing retry deduplication, canonical writers, and deep rich text. `focused.log` is unmodified process output; the manifest records its digest. The ordinary full gate is recorded separately when complete. This inspection does not claim native orchestrator acceptance.

Ordinary `bash scripts/loop-verify.sh` completed with exit 0. Both TypeScript checks, full tests, and both uploader harnesses passed; raw `loop-verify.log` and its SHA-256 are retained. All inspected source hashes remained unchanged across verification. `git diff --check` exited 0. No product files were changed by this implementer. Parent workflow owns independent formal review, final preservation proof, staging, commit and terminal result.

## Qualification after independent review

The initial inspection above was not exhaustive. Independent reviewers subsequently reproduced two frozen-contract defects: a late first recognized section 242 heading discarded preceding uncertainty, and branching inline wrappers split recognized marker/because text. The initial no-defect conclusion is superseded by the fresh repair evidence below and in `../evidence.md`. Both have been repaired with registered-boundary tests; the prior record is retained to show what the initial inspection missed.
