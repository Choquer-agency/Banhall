# Implementation inspection

This is the implementation worker inspection, not the required independent four-layer review and not native acceptance. Parent workflow owns those later steps, ordinary full verification, final evidence commit, and flat Auto Run Result.

Inspected follow-up source at `9da55bece5948da12129720dd2330a3032c985bf`. Read both frontmatter context files, original nested spec including its frozen matrix and existing deferral, recovery routing reports, and approved absolute amendment at `docs/product-domain.md:1605`. Historical revision identities are retained in `implementation-provenance.json`. The baseline `f122b086d745acc40b4decca26b9aaafc7257f6a` precedes the CAP-8 implementation commit; it must not be described as the commit that added the feature.

Inspected original QA additions in `b13d5ce9f93fe00ad0d02e15294954a20961b69d`, retry/cleanup/extraction repairs in `5b2bed6a0f129af3c9799f8bc80e0fa3ec1e3a01`, extraction repairs in `40d34059ae38b891023681ac00989d040f9fc973`, all three extraction repairs and four regression cases in `f1a61c44f80268df68b5ebd29bc848eee23490a2`, and audit-only finalization in `a62e1760a9931c9451c34baa2df8af29fa1e9538`. Prior green logs were used only as history, never as fresh proof.

## Findings and triage

No verified new in-scope defect found; no product or test change made.

- `convex/lib/qaFindings.ts`: actual-byte SHA-256 reference, legacy revision zero, per-section deduplication, validated explicit-false methodology, same-report/same-hash carry-forward and exact-reference gate all follow frozen policy. A passing retry does not delete prior findings. Missing compliance adds none.
- `convex/lib/tiptapReport.ts` and `convex/ai/qaChecks.ts`: recognized uncertainty is preserved in supported paragraph/heading/code-block containers; conservative legacy headings distinguish cross-references; first recognized section controls preamble handling; blank lines remain paragraph boundaries. Sentence-level marker/because detection remains the explicitly accepted limitation.
- Canonical write calls inspected after content writes in `convex/reports.ts:72`, `convex/comments.ts:197`, `convex/chatV2.ts:518`, `convex/chatV2.ts:615`, `convex/snapshots.ts:314`, `convex/projects.ts:934`, and generated creation at `convex/generations.ts:1041`. These share transactional persistence. Candidate initial QA is validated before methodology persistence; iterative assembly shares canonical creation.
- `convex/generations.ts:1641` captures current canonical sections and identity; `saveReportQa` verifies attempt identity and all report-reference fields before attribution. Identified stale completion can release its own retry lock, never a newer one. `convex/ai/postQa.ts` forwards captured identity through success and failure. `requestReportQa` generates monotonic attempt identities.
- `convex/projects.ts:1048`: capability and ownership checks precede QA rejection; project publish/status patches and scheduling follow it. `convex/lib/auth.ts:140` adds QA to existing readiness prerequisites. `convex/lib/contracts.ts` exposes typed QA_BLOCKING and `convex/schema.ts:526` adds findings indexes without generated edits.
- `convex/ai/prompts.ts:557`: skeleton waivers waive position and house style, with substantive methodology remaining mandatory. `shared/qaScorecard.ts` supplies the runtime compliance schema.
- `convex/projects.ts:1128` cleanup checks report absence and processes bounded batches, with authorization on parent deletion.

Rejected scope expansion: a mandatory new AI assessment after any byte change, semantic-equivalence carry-forward across changed hashes or different reports, and a linguistic detector all exceed the frozen exact-content contract. This inspection introduces no deferrals or policy changes.

## Fresh runtime evidence

Both commands below completed with exit zero against the unchanged follow-up product source. Provider responses in the attribution suite are mocked at the external transport; registered actions, queries, mutations, storage, and scheduling execute through convex-test. These are local runtime proofs, not a live provider or deployment claim.

1. `npx vitest run convex/ai/qaChecks.test.ts convex/projects.test.ts convex/qaBlocking.test.ts`: 3 files, 145 tests passed. Raw output: `implementation-focused.log`.
2. `npx vitest run convex/lib/tiptapReport.test.ts convex/qaFindingsCleanup.test.ts convex/generationAttribution.test.ts`: 3 files, 52 tests passed. Raw output: `implementation-lifecycle.log`.

| Frozen matrix scenario | Fresh proof |
| --- | --- |
| Because failure | qaBlocking human content save; exact persisted reference; readiness and atomic publish assertion |
| CRA methodology | qaBlocking parameterized explicit false flags; generationAttribution post-QA provider methodology boundary |
| Advisory only | qaBlocking house-style/false-verbiage authorized publish despite unrelated filing prerequisites |
| Waiver attempt | qaBlocking manager/admin feedback and frozen all-style-waiver cases |
| Human correction | qaBlocking changed-content correction, no-op save and byte-identical restore cases |
| Late QA | qaBlocking captured-reference stale completion; generationAttribution stale attempt, replacement retry and duplicate completion cases |
| Legacy/no rows | qaBlocking missing hash/revision/QA deterministic gate |
| Other report | qaBlocking foreign report/stale hash and projects authorization suite |
| QA retry | qaBlocking deduplication and passing-score non-waiver |
| Canonical writers | qaBlocking proposal apply, stepped apply, comment accept, restore, project copy, single candidate; generationAttribution iterative assembly |
| Historical extraction repairs | qaBlocking DW-92 four regression cases and tiptapReport extraction suite |
| Cleanup and empty input | qaFindingsCleanup bounded continuation/live-report/auth fences; generationAttribution empty QA input recovery |

`git diff --check` passed. `implementation-preservation.log` records an exit-zero baseline comparison of original spec, ledger, frontend and generated files. No UI work was performed. No before/after defect reproduction is claimed because this worker found no new defect and changed no product code.

## Remaining parent work

Run `bash scripts/loop-verify.sh` without timeout overrides, complete required independent reviews, record final acceptance mapping and command tails, repeat preservation checks, explicitly stage ignored audit artifacts, commit, and finalize only the flat follow-up spec. Native final acceptance remains a subsequent orchestrator operation.
