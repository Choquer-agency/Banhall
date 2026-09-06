Implemented the spec across its ten allowed paths.

- Removed retired helpers and duplicate Underline registration.
- Migrated tests to current APIs; added TTL boundary and persisted-row facet coverage.
- Passed before/after focused tests, all 47 component tests, Convex typecheck, and `git diff --check`.
- Both editor modes now have one underline registration, zero duplicate warnings, and preserved JSON. Editable toggles pass.

[Evidence and source receipts](/Users/johnnynguyen/Documents/Repos/Banhall-branch-consolidation/.audit/branch-consolidation/B5/evidence.md)

Per spec, independent review, the combined gate, and shipping remain with the parent workflow. Read-only underline proof is headless, not mounted browser coverage.