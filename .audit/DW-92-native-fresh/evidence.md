# DW-92 fresh native finalization evidence

Invocation and tested-source baseline: `86a43d9d500ceab34245744d223d4453eba7b667` (captured directly from Git). `revisions.json` records full canonical historical revisions, including original pre-implementation baseline `f122b086d745acc40b4decca26b9aaafc7257f6a`, implementation, and subsequent repairs.

`routing.json` records the read-only discovery that this rearmed task already binds the unsuffixed flat follow-up spec. The initially authored uncommitted suffix-2 draft was removed before implementation edits to respect the user's prohibition on binding another spec. The original nested contract, native state and ledger were not edited. Prior checked tasks and reviews in the bound flat spec are historical context, not evidence for this pass.

## Acceptance and frozen matrix mapping

The following named tests run through registered Convex query/mutation boundaries in `convex/qaBlocking.test.ts`. The focused command runs the entire file without filtering or skips; ordinary verification also includes all generation and cleanup suites.

| Contract row | Executed test identity |
| --- | --- |
| Because failure / persisted identity | `human content save persists because findings and rejects publish atomically` |
| CRA methodology | `explicit %s failure persists and blocks both boundaries` (both approved flags) |
| Advisory only | `house-style findings and false verbiage do not block client review` |
| Waiver attempt | `%s cannot waive findings by reclassifying QA feedback` (manager/admin); `frozen style waivers remove advisory rows but never the because blocker` |
| Human correction | `human correction preserves history without carrying old failure to new content`; `no-op save carries exact-content methodology to the new revision`; `restoring byte-identical historical content carries its methodology failure` |
| Late QA | `QA input uses current content and late completion cannot relabel the old revision` |
| Legacy/no rows | `legacy rows without QA, revision or hash still get the deterministic gate` |
| Other report/hash | `foreign report identity and stale content hash cannot affect current readiness` |
| Retry | `same-revision QA retries are deduplicated and a passing score is not a waiver` |
| Authorization/atomic publish | `publish authorization still precedes QA validation`; shared `expectBlocked` checks project and scheduled-function state |
| Alternate writers | `%s persists findings on the exact resulting revision` (proposal apply, stepped apply, comment accept, restore); `project copy persists deterministic findings for the destination report` |
| Extraction repairs | `deep %s retain uncertainty on save and at both gates`; `unpunctuated legacy cross-references preserve uncertainty at both gates and on save`; `late uncertainty heading cannot hide earlier renamed section in %s`; `rich-text whitespace-only blank lines cannot borrow an unrelated explanation` |

Full-suite `convex/generationAttribution.test.ts` adds provider-to-storage methodology proof, stale-attempt recovery and all three current canonical sections. `convex/qaFindingsCleanup.test.ts` exercises bounded cleanup and unauthorized/live-report refusal. Independent implementation inspection and formal review reports establish historical review scope. Final preservation and marker checks establish worker-result integrity; they do not claim orchestrator acceptance.

## Verification

Implementation pass: `rearm-2/verification-manifest.json`, `focused.log`, `loop-verify.log`, and `implementation-inspection.md` retain actual outputs and source/log hashes. Focused 147 tests; ordinary 1,746 tests in 148 files; Svelte check zero errors/warnings; Convex TypeScript passed; PowerShell 50/50 and Bash 18/18. No product source changes or newly reproduced product defect.

Parent verification and formal review are recorded below after completion. Historical gates do not substitute for these fresh checks.

Parent verification: `python3 .audit/DW-92-native-fresh/verify.py` exited 0. Both ordinary and focused commands passed; raw logs and start/end timestamps, canonical source revision and SHA-256 digests are in `commands.json`. Ordinary gate passed 1,746 tests in 148 files, both type checks, PowerShell 50/50 and Bash 18/18; focused passed 147 tests. No test timeout overrides.

## Fresh review repairs and reproduction

The initial implementation and parent gates above preceded independent review repairs. Their no-product-defect observation is historical and is superseded here. Review reproduced late-first-242 preamble loss and branching-wrapper inline separation; the repaired extractor preserves substantive preamble, excludes the identifiable leading generated H1 title, inherits inline cohesion, and retains explicit block boundaries and heap traversal.

Commands and raw proof under `rearm-2/`:

- `npx vitest run convex/qaBlocking.test.ts -t 'fresh review extraction boundaries'` against baseline extractor: `extraction-red-complete.log`, four failures and one pass. Two late-heading formats, a split marker and a split valid because reproduce the defects before the fix.
- `npx vitest run convex/qaBlocking.test.ts convex/lib/tiptapReport.test.ts`: `extraction-green.log` is an INTERMEDIATE FAILED repair, caught by the existing generated-title exclusion test. It is not successful verification. `extraction-green-complete.log` is the subsequent 60-test pass; an additional registered positive title/preamble regression was then added for the final ordinary gate.
- `npx vitest run convex/qaBlocking.test.ts -t 'QA input uses current content'`: `current-sections-mutation-red.log` records one expected failure after temporarily substituting frozen section244/246 returns. The original `convex/generations.ts` bytes were restored immediately. Final focused execution proves the restored path passes.

New registered identities: `late first uncertainty heading preserves preceding %s failure` (legacy/rich text), `branching inline wrapper preserves marker and because (%s)` (missing because/split marker/split because), and `generated title remains excluded when valid substantive preamble precedes late 242`. Alternate-writer and destination-copy tests now execute shared readiness/publish rejection after asserting exact persisted reference.

Additional exact full-suite identities:

- `convex/generationAttribution.test.ts`: `post-QA provider methodology failures persist and block current readiness and publishing`; `settles stale QA without attribution and permits a fenced retry`; `settles empty QA input and recovers after content is restored`; `iterative QA captures all current sections instead of frozen approved runs`.
- `convex/qaFindingsCleanup.test.ts`: `%s deletion cleans history across continuation batches` (creator/admin); `each transaction deletes only one bounded batch and schedules its continuation`; `unauthorized project deletion retains findings and schedules no cleanup`; `cleanup refuses to remove findings from a live report`.

The updated verifier retains each run in a unique directory, hashes tracked and untracked (including ignored) runtime/configuration inputs, records before/after revision and source hashes around each gate, and rejects changes during a gate. Root-level configuration includes Vite, Vitest, Svelte, TypeScript, package and environment files; only hashes of local configuration are retained. `latest-verification.json` identifies the latest complete successful manifest without overwriting earlier `commands.json` or raw logs. The final checker compares current runtime bytes to these verified hashes while retaining baseline checks for protected paths and frozen intent.

Final repaired-source verifier: `python3 .audit/DW-92-native-fresh/verify.py` exited 0; manifest `verification-20260905T003323Z-0c1f97d6/commands.json`. Both ordinary and focused gates exited 0, with identical before/after revision and input hashes for each gate. Ordinary: 148 files / 1,752 tests, Svelte zero errors/warnings, Convex TypeScript passed, PowerShell 50/50 and Bash 18/18. Focused: 153 tests across three files. No timeout overrides. `git diff --check` passed. The full-suite command ran the complete files containing the provider, stale-attempt, iterative-current-section and cleanup identities mapped above, with no skipped tests. Scratch source copies were removed; original raw logs and commands.json remain unchanged.

Subsequent review caught an H1 section-boundary regression in the first repaired source: treating the actual first `Line 242` H1 as a generated title discarded its body. `npx vitest run convex/qaBlocking.test.ts -t 'leading H1 section boundary'` failed one registered readiness test (`rearm-2/h1-boundary-red.log`) before the correction. The title exclusion now applies only when the H1 precedes the first recognized section. `leading H1 section boundary retains its uncertainty body` covers readiness, canonical save, exact persisted reference, and atomic publish rejection. The prior 1752/153 gate remains retained as an intermediate successful run, superseded by the final rerun below.

Final H1-corrected gate: verifier exited 0 with manifest `verification-20260905T003455Z-38cbce95/commands.json`. Ordinary gate passed 1,753 tests across 148 files; focused passed 154 tests across three files. Both type checks and uploader harnesses (50/50 and 18/18) passed. Before/after source hashes and revision were identical for each gate. This manifest is the latest verified source for finalization. The temporary current-section mutation was fully restored: `git diff --exit-code HEAD -- convex/generations.ts` exited 0. `git diff --check` passed.

## Final parent verification and artifact check

Final parent verifier exited 0 with `verification-20260905T003623Z-c59f46b4/commands.json`: ordinary 1,753 tests/148 files, focused 154, both type checks and uploader 50/50+18/18. Every command retained matching before/after source hashes. `marker-before.log` records the expected pre-final failure because the terminal result was absent; the workflow then authored the single genuine Auto Run Result. Final validation is retained separately. The worker does not claim native acceptance.

Staged review initially flagged blank lines emitted by test runners and space-prefixed context lines in retained raw diffs. Audit-local `.gitattributes` exempts only raw `.log`/`.diff` artifacts from whitespace checking so their bytes and recorded hashes remain intact; source/spec checks remain enabled. Final marker, source/protected-file preservation, and ledger index/working-tree equality passed. No ledger change is staged.

Reviewed source and complete fresh evidence committed as `98c7bc7ac56c5475df9f5620e640626fc84fa9c6`. Post-commit validation passed, every reviewed artifact appeared in the baseline-to-commit change set, and `git status --porcelain=v1` was empty. `committed-verification.json` retains these actual observations. The subsequent evidence-only commit records this canonical identifier; product bytes stay identical to the verified source.
