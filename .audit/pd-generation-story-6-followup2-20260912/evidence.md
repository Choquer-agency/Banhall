# Story 6 second follow-up evidence

Verified implementation commit: `700be59cc6002313bd321ed86c55a2a68d1f43e9`.
Workflow baseline: `cd3f30cf6f1d72d5f0b05e189ba6efb07055b7fa`.
Invocation revision: `3cb793348d4e17a8ca506c77d5186b48615c35d7` (`review-base.txt`).

## Executed verification

- `npm ci`: exit 0; dependency manifest and lock unchanged (`npm-ci.log`, `tracked-preservation.json`).
- `VERIFY_COMPONENT=1 bash scripts/loop-verify.sh`: final exit 0, all ten steps (`final-gate.log`). Convex typecheck passed; Svelte check reported zero errors and warnings; 187 unit files / 2,639 tests; discovery guard passed; production build passed; PowerShell and bash uploader harnesses passed; 82 browser files / 636 tests. The canonical `node_modules/.vite` cache was moved to the external scratch evidence directory before this run, so this is a fresh optimizer result.
- `npm run test:component -- src/routes/admin/comparisons/comparisonsRecord.component.test.ts`: 23 passed (`ui-green.log`); the final gate also covers the subsequent whitespace-alignment repair.
- `git diff --check`: exit 0 before the implementation commit.
- Source inspection (`source-checks.json`): exactly one comparison insert, no comparison patch/delete, no tool-derived metric reads, no unbounded comparison reads, no ad-hoc UI hex values or bold. The hex check uses a word boundary to avoid treating Svelte's `#each` directive as a colour.

## Regression reproduction

The initial canonical gate ran the new count regression against unchanged production source. Its sole failing test demonstrates accepted fractional text after rounding (`initial-gate.log`); all other 634 browser tests passed. The final gate passes that regression and the additional delayed-context case.

Portable commands, run from the repository root:

```sh
python3 .audit/pd-generation-story-6-followup2-20260912/reproduce.py count
python3 .audit/pd-generation-story-6-followup2-20260912/reproduce.py ui
python3 .audit/pd-generation-story-6-followup2-20260912/reproduce.py backend
```

All three commands were run and exited 1 with their expected assertion failures: one count regression (`repro-red.log`), two prior UI regressions (`prior-ui-red.log`), and three prior backend regressions (`prior-backend-red.log`). They retrieve exact original source through `git show`, inject it using a Vite pre-load hook, and use separate ignored caches. They never restore or replace tracked source. Filtered-out cases in these diagnostic commands are not source-level skips; the unfiltered gate passes its no-skips guard. Exact prior configs are preserved as `previous-ui-red.config.txt` and `previous-backend-red.config.txt`; the Python runner reconstructs them portably.

## Acceptance mapping

The complete existing mapping remains in `.audit/pd-generation-story-6-followup-20260912/evidence.md`; its tests all ran again in the final gate. Additional cases in this pass:

| Requirement / review finding | Executed boundary |
| --- | --- |
| Human counts must be exact safe integers | Real form: rejects fractional count text before floating-point rounding; unsafe integer rejection and exact maximum-safe-integer payload; whitespace-bearing text rejection and explicit maximum feedback |
| Pin identifies the original report, not whichever report is latest | Backend: accepts the unchanged original report pin after a newer report replaces it; asserts current context is the replacement and stored pin remains original |
| Project A data cannot become project B's judgement | Real form: waits for the selected project's context without retaining the prior pin; no submission while loading, then exact B payload |
| Truncated project history is disclosed | Real form: discloses omitted project history and clears the disclosure when complete |
| Prior recovery behavior remains intact | Full unfiltered unit and component suites, including immutable corrections, manual metrics, bounded reads, exact auth errors, original-pin handling, and stale-response guards |

## Preservation and review

`tracked-preservation.json` compares every tracked invocation file by SHA-256. Only the reviewed story and three source/test files changed in this pass. Dependency files, shared components, generated files, historical evidence, and the deferred-work ledger retain their bytes. `ledger-preservation.json` records identical hashes; the ledger was excluded from staging.

Four Astra medium review layers completed, followed by a scoped patch audit. `review.md` records 7 patches (1 medium, 6 low), 5 rejects, and no deferred items. Follow-up score is 9; the workflow recommends another follow-up review. Tests use the real form and convex-test database with transport stubbed, not a hosted end-to-end deployment. Manual metric conditions and incomplete-corpus withholding remain intentional. Native acceptance and ledger state remain the orchestrator's responsibility.
