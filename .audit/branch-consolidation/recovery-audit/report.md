# Preserved and archived branch audit

Comparison target: `cc6b706c3b43f971d944cb703a4174eabf3134d9`. Read-only review; no test execution, source modification, merge, checkout, or branch deletion.

29 scoped local refs were inspected. Eleven preserved tips are already ancestors. The remaining 18 refs contain 63 distinct commits: nine exact patch-equivalent commits (eight from seven BMAD fix branches, plus the rearmed QA spec) 53 superseded historical checkpoints/implementations, and one integration-required commit (archive unlearn frontend labels, B11). Every commit has changed-path blob IDs and an explicit classification in `recovery-ledger.json`.

## Product conclusions

- Final PED malformed-content files and tests, research phone-redaction files and tests, snapshot-ownership files and tests, and final wrapped QA extraction files and tests are byte-identical to main. Their retained final review receipts are also represented by blobs in main history.
- The unreviewed learning5 checkpoint was assessed and rebuilt. Current `.audit/CAP-7-story-5/evidence.md:123` records reuse and subsequent stronger metadata-envelope, immutable deidentified learning snapshot, viewer and answer gating. The canonical story explicitly forbids importing its old blocked spec or generated declarations as the accepted baseline.
- Learning4 and learning8 are incomplete planning preservation points. Approved policy companions and later accepted implementations replace them; the rerank-fallback decision companion is byte-identical to main.
- The provisional DW92 ledger change is superseded by verified native closure. Retain the current ledger rather than applying the old done-state hunk.
- Archive Sprint1 is an alternate implementation with one useful frontend omission requiring B11: `186dc570` changes the immediate revoke label to `Revoked (unlearn requested)` and adds `Erasure confirmed`. Main still overstates the request event as `Revoked (unlearned)`. Current failure events also need `Erasure attempt failed`, which permits later retry/confirmation. The replacement story12 explicitly excluded frontend, so its backend acceptance does not supersede these UI hunks. The current retrospective explicitly records replacement by main (`RETROSPECTIVE.md:12`). Main commits e3391ea/4ea1bb9 provide the access/capability, client-edit snapshot, Brain-feedback, proposal mark, provider settings, superseded-generation and indexed-reaper replacements. Completed sprint1b stories9–12 supply bounded chat, attribution, and stronger confirmed unlearn. Per-capability current code/test paths are in the ledger.

## Recommendation

One missing useful product change was identified by independent semantic review and accepted by root as B11. Complete and independently prove the request/confirmation/failed-attempt audit labels before resolving the archive tip by ancestry. Remaining mappings retain current historical product/spec/ledger snapshots without replay. Preserve current source, tests, canonical policy and native acceptance state. The ledger is a content/history reconciliation; it does not itself mark these branches merged and does not replace final integration verification. Other branch families, including local sprint2-boundary and factory branches, are outside this audit.

## Branch results

| Branch | Ahead | Behind | Classification |
| --- | ---: | ---: | --- |
| `archive/bmad-loop-sprint1b` | 32 | 296 | integration_required (B11 pending) |
| `codex/bmad-dw96-fix` | 1 | 22 | patch_equivalent |
| `codex/bmad-dw97-fix` | 1 | 17 | patch_equivalent |
| `codex/bmad-dw98-fix` | 1 | 15 | patch_equivalent |
| `codex/bmad-dw99-fix` | 1 | 12 | patch_equivalent |
| `codex/bmad-feedback-read-fix` | 1 | 8 | patch_equivalent |
| `codex/bmad-published-status-fix` | 1 | 8 | patch_equivalent |
| `codex/bmad-verification-fix` | 2 | 157 | patch_equivalent |
| `codex/preserve-chatspend-20260904` | 0 | 150 | included_by_ancestry |
| `codex/preserve-chatspend-retry2-20260904` | 0 | 145 | included_by_ancestry |
| `codex/preserve-learnchat-20260904` | 0 | 171 | included_by_ancestry |
| `codex/preserve-learnchat-baseline-20260904` | 0 | 164 | included_by_ancestry |
| `codex/preserve-learning4-approved-resolution-20260904` | 1 | 162 | superseded |
| `codex/preserve-learning5-codegen-recovery-20260904` | 1 | 23 | superseded |
| `codex/preserve-learning8-approved-resolution-20260905` | 1 | 18 | superseded |
| `codex/preserve-ped-malformed-review-20260904` | 3 | 37 | superseded |
| `codex/preserve-ped-native-final-review-20260904` | 3 | 39 | superseded |
| `codex/preserve-pipeline-20260904` | 0 | 154 | included_by_ancestry |
| `codex/preserve-pipeline-retry2-20260904` | 0 | 152 | included_by_ancestry |
| `codex/preserve-qa-deferred-20260904` | 0 | 151 | included_by_ancestry |
| `codex/preserve-qa-followup-20260904` | 0 | 150 | included_by_ancestry |
| `codex/preserve-qa-ledger-escalation-20260904` | 0 | 47 | included_by_ancestry |
| `codex/preserve-qa-native-final-review-20260904` | 6 | 40 | superseded |
| `codex/preserve-qa-native-ledger-20260904` | 1 | 47 | superseded |
| `codex/preserve-qa-rearmed-spec-20260904` | 2 | 47 | superseded |
| `codex/preserve-qa-sweep-spec-crash-20260904` | 0 | 59 | included_by_ancestry |
| `codex/preserve-research-phone-review-20260904` | 3 | 38 | superseded |
| `codex/preserve-schema-20260904` | 0 | 154 | included_by_ancestry |
| `codex/preserve-snapshot-ownership-review-20260904` | 3 | 36 | superseded |

## Correction and durable receipt

Independent review at `../recovery-independent-review.md` identified the lost UI hunks. The ledger now classifies `186dc570967a0eaa388c72595376d41ba8a9b5d8` and the archive tip as `integration_required`; no source change or B11 completion is claimed. The ignored historical learning restart receipt was copied byte-for-byte to `learning-resume-20260904-summary.md`; `learning-resume-receipt-provenance.json` records its original absolute path, size and SHA-256. It proves restart only, while separate accepted policy/story evidence supports final supersession.
