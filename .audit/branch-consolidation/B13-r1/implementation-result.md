Implemented Unicode-safe search ranges, original-coordinate non-overlap, and hard-break whitespace handling. Shared extraction now keeps Editor highlights aligned with matches.

Verified: 36 helper tests, 13 mounted tests, type check with documented placeholders, and `git diff --check`. Benchmark positions and one-traversal-per-batch behavior remain unchanged.

[Evidence and before/after results](/Users/johnnynguyen/Documents/Repos/Banhall-branch-consolidation/.audit/branch-consolidation/B13-r1/evidence.md)

Changes remain unstaged. Per the spec, independent review and the final integration gate remain parent-owned.