# Audited branch consolidation

The accepted source integrates every useful outstanding committed branch unit identified by the branch audits. Existing stronger behavior and approved domain policies are preserved. This is a record of committed branch content; uncommitted external work remains explicitly excluded below.

Baseline: `cc6b706c3b43f971d944cb703a4174eabf3134d9`. Accepted product source: `2bf526d15b7c6b776b3ed5f404b95d584eb4e235`, with69 changed source/test/config/document/ledger paths including deletions. [Source identities](finalization/accepted-source.json) bind this state to the final local gate.

## Accepted batches

| Batch | Result | Accepted commit | Final evidence |
| --- | --- | --- | --- |
| B1 | PDF timer cleanup and sequential deadline proof | `38fd254c359cf9589063098f06c7f0356d5882cc` | [Evidence](B1/evidence.md) |
| B12 | Observe PDF rejections after expired deadlines | `b2d5db5b63c0a70bce20d86df56e11ffbe89fad9` | [Evidence](B12/evidence.md) |
| B2 | Batch editor searches and guard real callers | `1d6053388326fe4fde43a86177955157f11ce588` | [Evidence](B2-r1/evidence.md) |
| B13 | Unicode and hard-break search/highlight boundaries | `0d481e2b76390e0eff3208d91f1f47d83b173474` | [Evidence](B13-r2/evidence.md) |
| B3 | Avoid unrelated body reads on blank uploads | `d11195e5fdf6fb40baf27cacff86eaad6bf69ef6` | [Evidence](B3/evidence.md) |
| B4 | Remove17 verified unused UI/helper files | `d22e1fa0880512212865d7d60aeb8cfe600dbaa2` | [Evidence](B4/evidence.md) |
| B5 | Remove dead helpers and guard Underline registration | `309570c60c9ad96d02ad234bdc028c34ddf80390` | [Evidence](B5-r1/evidence.md) |
| B6 | Recover real endpoint authorization coverage | `71e809f9f58e07b1b436fff95b2dbe6e9d05b27d` | [Evidence](B6/evidence.md) |
| B7 | Prune unused dependency roots and obsolete Bun setup | `d28cfc0bc0a34e78683152553143179fac2682c7` | [Evidence](B7/evidence.md) |
| B8 | Restore44px mobile creation target and navigation assertions | `9d83ffd3091c1e801285149622c879abe0087556` | [Evidence](B8/evidence.md) |
| B9 | Reconcile setup documentation and local browser smoke | `8511662cb8fd9748d02f413c633bf21b5cdec9ee` | [Evidence](B9/evidence.md) |
| B10 | Remove dead workspace branches with preserved routing/policy | `7c6a0099901a580d4c231df747d358faff064eaf` | [Evidence](B10/evidence.md) |
| B11 | Distinguish requested, failed-attempt and confirmed erasure | `2bf526d15b7c6b776b3ed5f404b95d584eb4e235` | [Evidence](B11/evidence.md) |

Every batch uses BMAD specification, fresh Astra6 medium implementation, three independent review layers and explicit parent triage. Four rederivations remain preserved as earlier attempts. The [runtime audit](worker-runtime-audit/conclusion-through-B11.md) verifies68 distinct completed CLI sessions:17 implementation attempts and51 reviewers. This does not reclassify old native fan-out failures as successes or certify every optional connector.

## Verification and coverage

- The final [Node24 gate](B11/gate/result.json) passes all nine steps:2020 unit tests,489 Chromium cases, both typechecks, discovery guard, production build and both uploader harnesses. Generated historical captures were retained separately and restored; no unexpected tracked changes.
- [Content admission](finalization/content-admission.json) binds13 accepted commits and26 historical source dispositions to committed specs, evidence, reviews, triage and gate receipts. All20 proposed historical parents have satisfied content prerequisites. Receipt identities supplement parent semantic review; they are not a substitute for it.
- The recovery audit checks63 historical commits and589 path/blob identities. The factory audit checks124 historical commits and519 path records. Historical classifications remain unchanged; the final mapping records completion separately.
- The original factory replay correctly fails on its old planning/B4.md hash after an approved planning correction. The [qualified replay](recovery-audit/factory-history-qualified-result.json) verifies the recovered original bytes against the original expected hash and pins the current replacement separately. [Recovery provenance](recovery-audit/B4-historical-recovery-provenance.json) explains the reconstruction. This is not an unchanged-path strict pass.
- The [accepted batch archive check](finalization/accepted-batch-archives.json) verifies19 manifests and1211 records from immutable Git objects, including gzip round trips. Final package admission requires another immutable-commit check.
- B9 intentionally uses documentation/configuration proof, followed by the combined B10/B11 gates. B3 and the first B4 parent run used Node22; B4's authoritative Node24 rerun and subsequent combined gates cover their source. B1 and B5 retained explicit screenshot guard exceptions with restored original bytes. No historical nonzero result was changed to zero.

Browser tests mount real Svelte components with explicit auth/query/navigation stubs; they do not establish live Convex authorization, production router transitions or deployment behavior. Separate endpoint tests, typechecks/build and GitHub checks provide their own evidence. B10's partial-router fixture correction is backed by the same observed extra call on baseline and candidate.

## Preserved external work and open findings

All39 registered worktrees are retained. The [fresh worktree checkpoint](worktree-audit/checkpoint-20260906T030859Z/findings.md) finds six external dirty worktrees with21 unchanged paths. Cownose contains14 of those paths (13 modified and one untracked); ownership clarification remains unanswered. No external files were imported, stashed, reset or deleted. The other seven paths are existing ledgers, probes, prompts and a specification. Their committed tips can be represented in ancestry without claiming these uncommitted bytes were merged.

Three inherited findings remain in the native deferred-work ledger:

- **DW-103:** shared storage cleanup can delete bytes referenced by another document when an existing storage ID is reused; no production incident is asserted. [B3 evidence](B3/evidence.md).
- **DW-104:** existing required React peer is missing under the repository's legacy-peer-deps installation policy. Fresh npm ci and application gates pass; npm ls remains nonzero. [B7 peer evidence](B7/peer-audit-summary.md).
- **DW-105:**11 dependency package entries have reported advisories (three high, seven moderate, one low), all inherited unchanged by pruning. No exploitability assessment or security-clean claim. [Audit data](B7/peer-audit.json).

DW-100, DW-101 and DW-102 were fixed and closed through the native API. Other historical ledger entries and approved human-apply, ownership, QA, privacy, attribution/diversity and unpublished-candidate policies remain intact.

## Shipping contract and audit trail

Historical ancestry recording follows content acceptance and must preserve the entire accepted tree. It supplies no missing code. Final merge uses a normal GitHub merge commit, preserving all captured tips and integration lineage; no squash, rebase, force-push or branch/worktree removal.

At this report's admission checkpoint, PR creation/CI/merge are still pending. GitHub main is unprotected; the parent explicitly requires both Verification gate and Component suite (browser) to pass on the actual PR revision before merging, then verifies main again. [Remote checkpoint](finalization/remote-preflight.json) records the current evidence without claiming protection is configured.

The canonical [decision trail](decisions.tsv) is append-only. The independent [Sol trail review](final-trail-audit/preliminary-review.md) identified missing ownership disclosure and weak evidence references; supplemental rows preserve the original history and add the direct receipts. Final review and shipping receipts are recorded at their actual checkpoints. Original evidence paths that were compressed resolve via each archive-manifest.json; gzip preserves exact bytes. Local continuation state is snapshotted at admission and remains distinct from an immutable completion claim.
