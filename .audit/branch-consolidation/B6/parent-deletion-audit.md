# B6 independent deletion/count audit

Read-only comparison against `309570c60c9ad96d02ad234bdc028c34ddf80390`, limited to old access/roster assertions, replacement mapping and expected suite deltas. No tests, source edits, staging or review dispatch. Current evidence claims six-suite61→68→66 passes; those logs are existing evidence, not rerun here.

## LOW exact-assertion gap

Old tests/projectReviewAccess.test.ts parameterized internal-role case explicitly asserts nullableAccess.user.role and requiredAccess.user.role equal the fixture role for owner writer, non-owner writer, manager and admin. Current convex/reportAuthz.test.ts:265–285 verifies project/user IDs and full required==nullable equality for owner/manager/admin, but not either returned role against its known expected value. Persisting a correct fixture role does not itself assert returned-role fidelity: both helpers could return the same wrong role and these assertions would pass. The new unrelated-writer projectAccess case explicitly asserts writer role and full equality, so that row is covered.

Recommended narrow correction: preserve the existing three-actor parity test and additionally compare required.user.role with the expected role label (and nullable through existing full equality), or add those checks within an already allowed replacement test. No backend change is needed. Until corrected, evidence's claim that all old assertions are covered except creator-helper retirement is too strong. This is a test-mapping gap, not an observed access defect.

## Remaining deleted assertions

- Owner/manager/admin project and user IDs plus nullable/throwing parity: covered by current reportAuthz parity. Role fidelity exception above.
- Non-owner writer IDs/role and internal preference over valid client token: new projectAccess unrelated-writer case asserts owner/creator different from actor, correct IDs/role, helper equality and full internal result with valid/wrong/no token after publish. Stronger than old row.
- Creator-only success/three rejections: explicitly retired. Current source search finds requireProjectCreator only in its definition; no product caller remains. Helper and policy unchanged. The old title incorrectly called creator an owner; do not carry that conflation into domain claims.
- Anonymous nullable null and typed NOT_AUTHENTICATED/message: newly explicit checks in projectAccess wrong-token case preserve exact error data, beyond reportAuthz's code-only matrix.
- Missing project nullable null and typed NOT_FOUND/message: newly explicit checks in projectAccess missing-project case preserve exact data.
- Anonymous no token/wrong token/no published report/missing project: covered by current projectAccess wrong-token, no-report and missing-project cases, including no-identity actor.
- Matching pinned token: current projectAccess client_review test asserts project ID/sharedReportId and no user. Internal-token precedence is separately covered above.
- Roster direct membership true/false/null, anonymous exclusion, duplicate identities and lookups: new actual users test asserts existing anonymous row, deleted row null, direct membership, full row lookup equality, exact listTeamRoster rows and authenticated public IDs/roles. It preserves each old fake assertion and extends missing/deleted behavior.
- Both remaining pure roster label cases and fallback assertions are unchanged in the deletion diff; only the two fake cases and their unused imports are removed.

## Expected full-suite deltas

| Change | Unit cases | Unit files |
|---|---:|---:|
|tests/chatProposals.test.ts: five new named cases|+5|0|
|convex/projectAccess.test.ts: one new unrelated-writer parity case|+1|0|
|convex/users.test.ts: one persisted roster case|+1|0|
|tests/teamRoster.test.ts: two fake cases removed|−2|0|
|tests/projectReviewAccess.test.ts: four parameter rows plus six named cases removed|−10|−1|
|Net|−5|−1|

Given parent-provided B5 baseline2011 unit cases/154 files, expected combined B6 is **2006 unit cases/153 files**. Browser source/config unchanged, so expected browser total remains **478**. These are arithmetic/source-derived expectations, not a fresh full-suite pass. Strengthening assertions in an existing case does not change these totals; adding a new case would require updating the arithmetic.

The six-suite focused baseline61→replacement68 is +7. Removing two roster cases produces66 (+5 relative to that focused baseline). The deleted10-case projectReviewAccess file was not in that focused command, so +5 cannot be applied to the full suite. Existing evidence is factually accurate about six suites; it needs this qualification for parent full-gate planning.

## Source binding

Inspected five-file diff only changes tests: 213 insertions/234 deletions at audit time. Reviewers/parent may subsequently strengthen the role assertion; the hashes below identify this audit snapshot.
- `convex/projectAccess.test.ts` current SHA-256 `c618c62586c8015f6fd8855644daa695e1fea86f9db5c6f86141c3bf821f640e`
- `convex/users.test.ts` current SHA-256 `80e17db0ba7eda11f2fc437df73ca3ab70556989089b87b2cd8712e7e48f6c31`
- `tests/chatProposals.test.ts` current SHA-256 `7c3f24320e882a0f409818c9508960d0d5f1d5fd512cc91380c4a9835eb8b7bb`
- `tests/teamRoster.test.ts` current SHA-256 `3f56306a392790bf31c3ef926b15c68911c4009721e1e37610734a36495a19c9`
- Baseline `tests/projectReviewAccess.test.ts` SHA-256 `067a6a0678e95a8c79439bdfc9400ecdb93ab019331d7c421d58b68f76d26e58`
- Baseline `tests/teamRoster.test.ts` SHA-256 `4c9b41a4ec3640d7b211eb03c48a886f334a947fc976590df70e97dd21232033`

## Narrow correction closure
The LOW role-fidelity finding above is historical and is now resolved in the inspected current source. `convex/projectAccess.test.ts:97–112` strengthens the existing case without adding a test: the owner writer and two separately persisted unrelated manager/admin actors each assert exact returned user ID and expected role, nullable/throwing equality, and internal access equality for absent, valid and wrong tokens. Together with the existing unrelated-writer case, this restores all four old role-fidelity rows. No change to reportAuthz is needed.
The two requested adjacent corrections are also sufficient: `convex/users.test.ts:14–49` now uses two distinct persisted IDs with the same name AND writer role, full helper-row equality, and exact two-member helper/public rosters. `tests/chatProposals.test.ts:187–227` asserts exactly one matching thread/turn and proposal, project/report association, report/latest/snapshot/project/work-item/wording-event equality after proposal creation, and full state plus queued-state equality after invalid targeting and repeated saves. These assertions preserve the intended distinction between queued proposal creation and report/workflow mutation.
No new case was added by these corrections. Source-derived expected totals remain **2006 unit tests / 153 files and 478 browser tests**. This narrow closure did not rerun tests; parent owns the focused and full-gate runtime receipts.
Current source SHA-256 binding:
- `convex/projectAccess.test.ts`: `856a735ec98250edb13c0d313829d69b9f3d88242dd51124999af63d2f6a6478`
- `convex/users.test.ts`: `18e996d4246faa203f23446d51f8b7bf0cada5e5c9d3c9b3c1653af524926c33`
- `tests/chatProposals.test.ts`: `f9961087a45ba8dae655512739bb3a5669e98966282ba0b70181e5a9016281f2`
- `tests/teamRoster.test.ts`: `3f56306a392790bf31c3ef926b15c68911c4009721e1e37610734a36495a19c9`
- `convex/reportAuthz.test.ts`: `2fb2e31685acb835d97c8ad755f2e04f7d0e42bee46422df17cb680370c851cb`
