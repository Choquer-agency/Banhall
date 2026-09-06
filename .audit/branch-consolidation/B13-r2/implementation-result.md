Implemented and left unstaged.

- Fixed Unicode-expanded search ranges, skipped non-overlapping matches, and hard-break boundaries.
- Aligned matched-text extraction across search results, AI highlights, and QA paragraph navigation.
- Added regression coverage for both schemas, nested blocks, and explicit replacement preserving marked neighbors.

Verified: 40 helper tests, 18 focused Editor tests, all 481 component tests, Svelte checking, benchmark, and `git diff --check`. Benchmark positions and one-traversal batching remain unchanged.

[Before/after evidence](/Users/johnnynguyen/Documents/Repos/Banhall-branch-consolidation/.audit/branch-consolidation/B13-r2/evidence.md) includes failures, passing results, and source hashes.

Per the spec, independent review, the final integration gate, and shipping remain parent-owned and incomplete. The existing duplicate `underline` extension warning remains.