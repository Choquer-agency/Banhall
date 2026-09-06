# Q3 post-review verification strengthening

Baseline remains `5f1998c9e486130e62569849a917ee1b79442791`. Read the sole Q3 spec, generated Convex guidelines and three review result files. This pass changed only `convex/projects.test.ts`; existing production `convex/projects.ts` was read but not edited. No commits, staging, installation, ledger edits, other-checkout edits, or full gate run.

## Preserved evidence

Before editing, saved exact test bytes as `pre-review-projects.test.ts.txt`, SHA-256 `06c4b525ad256244cb954b3abce9212748af27e27be4fb6ef481f3741ca7a638`. `pre-review-projects.test.ts.sha256` records the identity. `post-review-sha256.txt` records preserved test, historical baseline/pass logs, current focused logs and final test source hashes. Historical baseline logs were neither overwritten nor rerun; they establish the original four failures followed by the initial fix's pass. The preserved tests allow those earlier outputs to be tied to their actual test source.

These remain local ignored artifacts, not a durable remote archive. Root should include the exact evidence/checksum files in the intended reviewed artifact publication at finalization; this pass does not claim remote durability or stage them.

## Findings and dispositions suggested to root

- **Addressed: realistic running row.** Mixed fixture now has completed, failed, legacy-running (historical terminal fields), and realistic-running (no result/error/completedAt). Real retry explicitly selects the realistic source and proves terminal fields were absent before copying.
- **Addressed: copy time.** A Date.now spy freezes actual copy mutation time to `1800000000000`; every copied createdAt and every converted completedAt/event at must equal that value, not merely each other. Original fixture timestamps are 100/200. Spy is restored in finally.
- **Addressed: stable identities and remapping.** Fixture retains source review IDs; copied records match unique original reviewer metadata rather than result-array positions. Source/destination projects match exact IDs and explicitly have different creators. Two distinct source PDs have different filenames/bodies; each copied review must point to the corresponding destination document, never the source ID. The real retry checks its selected copied document's exact source-matched content.
- **Addressed: retry comes from duplication.** Before the actual retry mutation, the selected copy must be failed with duplication-specific error. Its source is explicitly running without terminal fields. Retry uses destination document and schedules precisely the resulting review ID.
- **Addressed: meaningful running guard.** After an actual successful retry creates the destination's latest running review, retrying the same copied failed row must reject with the existing running-review message and leave the entire snapshot unchanged. This proves normal running guard is retained after the repaired path. It does not claim coverage for a running row that predates copying: current retry checks latest review only, and expanding that policy or manufacturing a new source-only authorization model is outside this bounded pass.
- **Addressed: transcript preservation.** Both source and destination start with two nonempty ordered transcript rows. Whole transcript table is included in snapshot and must remain byte-equivalent after content-copy mutation. Separate existing createProject transcript-copy tests remain unchanged.
- **Qualified: authorization/atomicity.** Test name and comment now say denial before writes. Roleless callers lack both projects under firm-wide internal access, so reversing direction does not discriminate a missing individual source/destination check. Snapshots prove no effects for this actual denial, not transaction rollback after partial writes. No artificial partial-write injection or production error path was introduced merely to substantiate that broader claim.
- **Evidence availability qualified.** Exact local checksums and preserved pre-review bytes now exist. Durable publication remains a root finalization responsibility.

Edge review returned no findings; verification-gap review returned no gaps. No production defect was established by this pass and no production behavior changed.

## Commands and observed results

1. `npm test -- convex/projects.test.ts convex/reaperIntegration.test.ts convex/pdReviewProjection.test.ts` exited 0. `post-review-tests.log`: 3 files passed, 89 tests passed. Existing six parameterized Q3 cases were strengthened rather than inflated with duplicate tests.
2. `npx tsc --noEmit -p convex/tsconfig.json` exited 0. `post-review-convex-types.log` is empty, no diagnostics.
3. `git diff --check` exited 0, both captured and standalone recheck. `post-review-diff-check.log` is empty.
4. Final git status contains only pre-existing Q3 production edit, strengthened Q3 test edit and original untracked Q3 spec. No additional source paths changed.

The earlier root/implementer full gate output is historical pre-review evidence. This pass proves focused tests/typechecks after verification-only changes; root owns final independent disposition and full gate.
