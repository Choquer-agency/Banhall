Implemented B12.

- Expired PDF work now has its rejection observed without delaying the existing timeout result.
- Added four public-parser regressions covering late rejection and never-settling work for page retrieval and text extraction.
- Reproduced two unhandled rejections before the fix. Afterward, all 23 parser tests passed; `git diff --check` passed.

Logs, source hashes and snapshots: [evidence.md](/Users/johnnynguyen/Documents/Repos/Banhall-branch-consolidation/.audit/branch-consolidation/B12/evidence.md).

Nothing remains incomplete within implementation scope. Parent review, full gate, ledger closure and shipping remain pending as specified. Real-PDF/browser behavior was not exercised.