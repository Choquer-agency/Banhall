Implemented the spec: blank uploads now skip the dedupe collection while preserving content, status, receipts, and storage behavior.

Verified:
- Baseline regression failed as expected.
- All four fixed cases use 2 queries, 2 reads, and 371 bytes.
- All 41 focused tests, Convex typechecking, and whitespace checks pass.
- Protected files remain unchanged.

[Evidence and commands](/Users/johnnynguyen/Documents/Repos/Banhall-branch-consolidation/.audit/branch-consolidation/B3/evidence.md)

Parent-owned independent review and the full component gate remain pending. Nonblank dedupe’s existing unbounded reads remain outside scope. Nothing was staged or committed.