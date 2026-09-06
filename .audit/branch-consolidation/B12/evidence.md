# B12 implementation evidence

Implemented in the designated consolidation checkout at HEAD `38fd254c359cf9589063098f06c7f0356d5882cc`. The full approved spec and its sole frontmatter context file, `AGENTS.md`, were read before editing, along with factory instructions and the original parser-expired audit. Original audit, spec, native state and ledger were not modified.

## Change

Only production change: the expired-entry branch of `withDeadline` observes the already-started promise's rejection and immediately returns the existing `ParseTimeout`. The positive-budget race and timer-finally cleanup remain unchanged. No private export, deadline reset, sequencing change, marker change or destruction-policy change.

Maintained tests add four cases through `parseFileToText`: page/text late rejection at exactly 60,000ms and page/text never-settling work at 60,001ms. The fixture records getPage calls with a plain function, preserving the existing B1 sequential assertions without a promise-observing spy.

## Actual commands and results

All commands ran from `/Users/johnnynguyen/Documents/Repos/Banhall-branch-consolidation` using already-installed dependencies.

| Command | Source / output | Exit status |
| --- | --- | --- |
| `npx vitest run src/lib/parseDocument.test.ts` | `masked-fixture.json`, `masked-fixture.log` | 0, preliminary fixture masked the bug |
| `npx vitest run src/lib/parseDocument.test.ts` | `before.json`, `before.log` | 1, two actual unhandled rejections |
| `npx vitest run src/lib/parseDocument.test.ts` | `after.json`, `after.log` | 0, all 23 tests passed, no unhandled errors |
| `git diff --check` | `diff-check.json`, `diff-check.log` | 0 |

Raw output is retained, including the misleading initial run. Promise-returning Vitest spies attach settlement handlers, so the first fixture accidentally observed the rejection. Replacing the expiry callbacks and getPage spy with plain functions exposed the actual defect. The failing run's individual assertions all passed; Vitest reported `late expired page rejection` and `late expired text rejection` as unhandled errors and exited 1. This is an asynchronous runner failure, not a synchronous assertion failure.

## Acceptance mapping

- Both late rejection paths: `observes late rejection after expired %s work returns a partial result`. Assert complete public output, page call sequence, expiry call count, one destruction and zero timers; reject work only after parser return, then yield two real Node event-loop turns so Vitest detects actual unhandled rejections.
- Pending work returns promptly: `returns without waiting for expired %s work that never settles`. Public parser resolves without advancing any timer or settling work, preserving page-one text, page-two marker, one destruction and zero timers. An implementation that awaits the operation hits the test runner timeout.
- Positive-budget failures: existing three parameterized error-propagation cases still verify the original Error object and cleanup for load, page retrieval and text extraction.
- B1 preservation: existing successful multi-page timer cleanup, cumulative 60-second budget, production-sensitive page sequencing, never-loading document empty result and error cleanup assertions all pass.

## Source identities

`before.json` and `after.json` contain command, UTC timestamp, HEAD, exact SHA-256 values and exit status. Corresponding `.snapshot` files retain the actual source and tests. Baseline production bytes match `git show 38fd254c359cf9589063098f06c7f0356d5882cc:src/lib/parseDocument.ts`. Final working bytes match the tested after snapshots and manifest. See `source-verification.log` and `final.diff`. Between the before and after test snapshots, the only test change was a fixture comment explaining why spies cannot be used.

## Remaining limits and handoff

Ready for parent review. No implementation item remains incomplete. Coverage controls only the pdf.js boundary and clock; it does not demonstrate reproduction with a real PDF or browser. The parent still owns three fresh BMAD review layers, the canonical full gate, DW-100 closure and shipping. No dependency installation, full gate, browser run, native-state or ledger write, commit, push, merge or deployment occurred.

## Parent review

Three fresh Astra 6 medium layers completed. See review-triage.md for all11 blind findings. Canonical Vitest commands do not configure ignored unhandled errors; the actual unchanged-source control exits1 on the two asynchronous failures. Root verified final source/test SHA256 against after.json before reviews. Parent full gate remains pending at this point.

## Parent final acceptance

All nine gate steps passed:1,980 unit and463 browser tests, both typechecks, build and both uploader harnesses. See gate/result.json; no unexpected tracked path changed. Native mark_done closed DW-100 after that pass, preserving every prior entry; see deferred-closure.json. Final source/test hashes still match after.json. Raw receipts are durably admitted through archive-manifest.json lossless mappings.
