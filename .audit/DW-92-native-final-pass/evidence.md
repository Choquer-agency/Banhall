# DW-92 current native follow-up evidence

Entry and tested-source Git revision: `54a898d44878bf911eec5fb70777982eae43efde`; runtime hashes capture the uncommitted repair on that revision. Workflow baseline remains `86a43d9d500ceab34245744d223d4453eba7b667`. The entry spec had its prior terminal result removed before this worker began; entry-spec.md retains those exact bytes. Historical results remain historical. No ledger or sprint entry was authored, reverted, reopened, or rewritten.

## Acceptance mapping

| Acceptance | Current proof |
| --- | --- |
| Independent review of QA implementation and subsequent repairs | Four-layer review.md, retained full baseline-to-current review.diff, original frozen contract, direct parent findings/storage/publish inspection and repair-review.md |
| Exact-reference persistence and absolute atomic gates | Complete ordinary and focused runs execute existing matrix identities listed in .audit/DW-92-native-fresh/evidence.md; no filters or skips. They cover methodology flags, advisory/style waivers, same-content carry-forward, stale provider completion, current sections, alternate writers, authorization and cleanup. |
| Wrapper ancestry and explicit separators cannot borrow unrelated because | `final review wrapper ancestry boundaries` five negative registered cases: block entry, block exit, wrapped siblings, horizontal rule and wrapped horizontal rule; exact persisted rows and both gates before/after save |
| Valid explanation and marker token cohesion remain | `actual token splits preserve detection in one nested block (because: %s)` paired false/true controls; successful publish for valid content |
| Ordinary full tests, both type checks, uploader harnesses | verification-650807b4/commands.json and its raw ordinary.log: 1,772 tests in 148 files, Svelte zero errors/warnings, Convex tsc success, PowerShell 50/50 and Bash 18/18 |
| Original focused gate | Same manifest, focused.log: 173 tests in three files |
| Protected files, ledger/sprint bytes/index, exact source, unique terminal result | check_final.py and final-check.json; protected product paths compared to workflow baseline, bookkeeping bytes/index compared to invocation entry |

## Reproduction and verification

repair/ancestry-red.json records five failures and two passing controls on the exact entry extractor before repair. repair/ancestry-green.json records all 81 QA blocking/extraction tests passing after repair. Both manifests retain exact commands, times, source and log hashes; red/green source snapshots are committed. Current checker validates snapshot hashes and matches red extractor to entry Git bytes and green sources to current files.

Initial ordinary/focused verification passed before the newly found defects were repaired; it is retained under .audit/DW-92-native-fresh/verification-20260905T005133Z-175a21fc and is explicitly superseded by this directory's final manifest. The historical latest-verification pointer updated by that existing runner refers to this intermediate pass; current final verification is always final-manifest.json here.

Final verifier exited 0. Both required command vectors passed without timeout overrides, with identical before/after source/revision, executable, version, installed lock and safe control-environment identities. Logs are hash-bound and execution intervals are ordered after this invocation. These observations identify this local execution; they do not claim a hermetic dependency installation or remote deployment verification.

pre-final-check.log records the actual rejection of a missing terminal result. The final checker subsequently verifies the concrete completed spec. Native final acceptance remains a separate orchestrator operation. Accepted sentence-level detector, structural generated-title and exact-content methodology limitations are unchanged.

Audit-local whitespace attributes preserve raw logs/diffs and the exact entry-spec snapshot, including its original trailing blank line. Source and final spec whitespace remain checked.

Reviewed repair and evidence committed as `0c0b076391770a2ff67b4b8c89b6f98b9073722f`, read directly from Git. Postcommit artifact validation passed, all 34 committed file bytes matched the worktree, and git status --porcelain was empty. committed-check.json retains this observation; the subsequent evidence-only commit does not change runtime source.
