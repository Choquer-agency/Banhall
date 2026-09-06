Implemented the spec across the 11 allowed files.

- Removed retired helpers and duplicate Underline registration.
- Migrated and strengthened handoff, stage-count, and prefill tests.
- Added real facet-classification and editable/read-only Underline regression coverage.

Verified: 40 helper/backend tests, 47 component tests, 40 preserved B13 tests, and both Underline cases pass. Typechecks and `git diff --check` pass. Baseline duplicate failures and post-fix results are recorded.

[Evidence and receipts](/Users/johnnynguyen/Documents/Repos/Banhall-branch-consolidation/.audit/branch-consolidation/B5-r1/evidence.md)

Nothing remains incomplete within worker scope. Independent review and the final combined gate remain parent-owned. Read-only Underline proof is headless, not mounted-browser coverage. No commits or shipping performed.