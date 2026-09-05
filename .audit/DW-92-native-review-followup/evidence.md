# Current native follow-up review evidence

This invocation entered at `2e5e4b3c3932ba8ce151fffff33d713d49116bd6` with the supplied flat spec at done but no terminal marker, and an orchestrator-owned ledger close already uncommitted. `entry.json`, `entry-spec.md`, and `native-provenance.json` capture that state and the native close preceding this review session. Earlier `.audit/DW-92-native-fresh/` completion observations remain historical; they do not describe this invocation's terminal state or establish native acceptance.

## Review and changes

All four mandated independent layers returned. `review.md` evaluates each unique finding. The product repair preserves the accepted generated-title interpretation when blank paragraphs precede the title, while retaining actual H1 section labels. It also preserves list/table block boundaries under inherited inline context. There is no policy expansion or worker-authored ledger content.

`edge-repair-commands.json` records commands, exit codes, raw-log hashes and mutation descriptions. On the entry extractor, the new registered suite failed six cases: title readiness/save/publish and three block containers. Seven boundary cases already passed. Removing explicit block separation then failed five nested-block cases. Removing inherited inline context failed the existing missing-because split-marker case and split-because case. Both mutations were restored. The corrected extractor passed all 74 extraction and QA boundary tests.

## Acceptance mapping

| Acceptance | Current proof |
| --- | --- |
| Independent original implementation/repair review, no unresolved product choice | Four-layer `review.md`, retained baseline-to-current `review.diff`, original nested frozen matrix and prior historical QA inspection |
| Current exact-reference persistence and non-waivable atomic gates | Ordinary and focused commands run complete QA suites; existing per-row test mapping in `.audit/DW-92-native-fresh/evidence.md` remains applicable to current source |
| Blank prefix must not expose generated title to QA | `blank prefix before generated title does not block %s` exercises readiness, canonical save with no blocking rows, and successful publish |
| Actual H1 section labels remain meaningful | `leading H1 section boundary retains its uncertainty body (blank prefix: %s)` checks both blank-prefix variants through exact rows and both gates |
| Nested blocks cannot supply unrelated explanation | `nested %s blocks inside inline wrapper cannot borrow because` (five types) and `nested %s container cannot supply an unrelated because` (three types), each checks exact rows and atomic rejection |
| Marker cohesion and separate block boundaries are both protected | Retained inline-context and block-separator mutation failures beside restored green test output |
| Ordinary verification, protected paths, committed evidence and normal flat result | Final command manifest plus `check_final.py` output below; exact commits from Git recorded after finalization |

The initial pre-repair gate passed 1,753 full tests and 154 focused tests, both type checks and uploader harnesses. Its manifest is `.audit/DW-92-native-fresh/verification-20260905T004304Z-c7b79573/commands.json`. It is superseded by the final repaired-source gate recorded below. No test timeout overrides were used. Tool versions and safe environment hashes are retained in `environment.json`.

`check_final.py` checks exact command identities and exit codes, before/after runtime hashes, current runtime bytes, ordinary/focused and current regression log digests, protected paths, one completed result marker, frozen intent, and current invocation ledger equality in both worktree and index. It intentionally validates this worktree; historical audit integrity and cross-clone environment equivalence are not claimed.

Final repaired-source verification: ordinary gate exited 0 with 1,765 tests across 148 files, zero Svelte errors/warnings, successful Convex TypeScript, PowerShell 50/50 and Bash 18/18. Focused gate exited 0 with 166 tests. Both commands retained identical before/after revision and runtime hashes. `final-manifest.json` points to the exact retained manifest.

Final precommit artifact check passed (`final-check.json`): current commands/logs and runtime bytes verified, protected paths unchanged, unique done marker present, frozen contract preserved, and working/index ledger SHA-256 exactly equals the native invocation snapshot. Raw logs and snapshots retain their original whitespace through local audit attributes.

Committed reviewed product/evidence revision: 60606e5d50f098b0115e8ead746297653628c302 (read directly from Git). The postcommit checker passed against actual committed artifacts and git status --porcelain was empty. committed-check.json retains that observation; its later evidence-only commit does not change verified runtime source.
