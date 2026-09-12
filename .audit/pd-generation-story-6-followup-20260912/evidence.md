# Story 6 follow-up evidence

Verified implementation commit: `8d0bb99e6dd3539d01e7a872195daaaa6d933704`.
Original source used for regression reproduction: `a953bff56b1457989a0a8998a5543c56ef0a2136`.
Workflow baseline: `cd3f30cf6f1d72d5f0b05e189ba6efb07055b7fa`.

## Commands and outcomes

- `npm ci`: exit 0, lock and manifest unchanged (`initial-npm-ci.log`, `source-checks.json`).
- `npx vitest run convex/comparisons.test.ts`: exit 0, 34 tests (`backend-green.log`).
- `npx tsc --noEmit -p convex/tsconfig.json`: exit 0; repeated within the canonical gate.
- `npm run test:component -- src/routes/admin/comparisons/comparisonsRecord.component.test.ts`: exit 0, 20 tests (`ui-green.log`).
- `VERIFY_COMPONENT=1 bash scripts/loop-verify.sh`: exit 0, all ten steps. Final actual output excerpts in `final-gate-excerpt.log`: 5,926 Svelte files / zero errors and warnings; 187 unit files / 2,638 tests; discovery guard; production build; 93 PowerShell harness checks; 47 bash harness checks; 82 browser files / 633 tests.
- The initial canonical gate after `npm ci` passed using a fresh optimizer cache (`initial-gate.log`). No dependency or optimizer changes followed; the final gate passed after all source repairs. Temporary browser audit configuration used its own cache directory.
- `git diff --check`: exit 0 after the incoming obsolete result removal was replaced with the current run result.

## Regression reproduction

The original files were supplied through a Vite pre-load hook using separate temporary configs and caches. No tracked file was restored or temporarily replaced. `regression-source-proof.json` verifies exact original bytes against version control. The temporary configs and captures remain under ignored `.vitest-attachments/story-6-ui-review/` and `.vitest-attachments/story-6-backend-review/`.

- UI: `npx vitest run --config .vitest-attachments/story-6-ui-review/red.config.ts src/routes/admin/comparisons/comparisonsRecord.component.test.ts -t 'warns on replacement|withholds each metric verdict'`: two expected assertion failures against original source (`ui-red.log`); both pass in the repaired 20-test suite.
- Backend: `npx vitest run --config .vitest-attachments/story-6-backend-review/red.config.ts convex/comparisons.test.ts -t 'exactly 500|large project and financial|large distinct judge'`: three expected assertion failures against original source (`backend-red.log`); all pass in the repaired 34-test suite.
- The red commands select cases by name. Other cases reported as filtered/skipped in those diagnostic commands are not source-level skips. The unfiltered canonical gate passed its no-skips and test-discovery guards.

## Acceptance mapping

The following named tests are in `convex/comparisons.test.ts` unless noted. All ran in the final gate.

| Acceptance or matrix condition | Executed proof |
| --- | --- |
| Server-resolved revision pin and verbatim judgement | writes one row whose pin comes from the report and whose judgement fields are the caller's verbatim; pins the generation when the report has one; stores every human-entered string exactly as it was entered |
| Blinded reformat matches; wrong draft still records | a blinded reformat of the pinned revision matches; a wrong draft is recorded, not refused, with draftTextMatches false |
| One live row and immutable correction | refuses a second live record and names the void-and-re-enter path; a correction leaves both rows unmodified and moves liveness to the new row |
| Cross-project or already-voided target rejected | refuses to void a row of another project or an already-voided row |
| Stale revision writes nothing | fails STALE_REVISION when the report moved on, and writes nothing; browser: freezes the report pin so an edit mid-judgement is refused |
| Admin-only reads and writes | refuses writers, managers, roleless and anonymous callers, reading and writing nothing; preserves established NOT_AUTHENTICATED versus NOT_AUTHORIZED distinction |
| Blank, oversized, negative, fractional, unsafe counts rejected | refuses blank, oversized, negative and fractional inputs; browser: rejects unsafe count integers and accepts the safe boundary |
| No eligible rows gives zero and false | reports zero eligible projects and computedMet false with no live rows |
| Development excluded, only human counts drive SM-1/SM-2 | meets SM-1 on five eligible projects and excludes the development project; counts SM-2 from Corrections-to-acceptable on the same eligible set; never reads tool output and never patches or deletes a record |
| Manual conditions and financial context remain visible | metric query tests above; canonical browser route tests and source inspection of the manualConditions rendering |
| Shared admin shell and form-control contract | src/routes/admin/adminWorkspaceRoutes.test.ts and src/lib/components/ui/formControlContract.test.ts in the canonical gate |
| Frozen correction consent, cross-project requests, reset state | browser: freezes the correction target captured at consent; both project A success/error on project B cases; resets every judgement field; restarts a judgement and re-freezes the pin |
| Older projects and visible match evidence | browser: reaches an older page, records a correction there, and pages back; match/mismatch evidence message cases |
| Read budgets and complete-corpus boundary | large project and financial documents truncate details before their reads exhaust the budget; large distinct judge documents stop label reads and preserve history; a corpus of exactly 500 rows is complete; 501 requires withholding |
| Incomplete metric consumer | browser: withholds each metric verdict despite successful partial counts and scopes an empty list to its window |

## Preservation and review limits

`tracked-preservation.json` checks every pre-existing tracked file against the pre-verification snapshot. Only the six reviewed source/story paths changed. Historical evidence, dependency files, shared components, and the native deferred-work ledger retain their bytes. `ledger-preservation.json` retains the exact SHA-256 equality; the ledger is never staged by this invocation.

`review.md` records ten patches (six medium, four low), two rejects, and no deferred entries. Follow-up review score is 22, so another review is recommended. `patch-audit.md` records the separate Astra audit, its bound calculations, and its limitations. Native acceptance remains the orchestrator's responsibility; this evidence does not synthesize native results or resolve ledger entries.

The local tests observe the real form and actual convex-test database returns, with the UI network boundary stubbed. They do not establish a hosted end-to-end transaction result. Manual eligibility and harness conditions remain human checks. Large ancillary documents can shorten detail lists or suppress judge labels, which the UI discloses.
