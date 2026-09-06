Implemented the five-file refactor: both Editor callers now batch searches while preserving matching, decorations, casing, and explicit saves.

Verified:
- 12 helper, 6 Chromium, and 33 authority tests passed.
- Benchmark walks fell from 600 to 30; position hashes stayed identical.
- All four deliberate regressions failed their targeted assertions.
- Typecheck passed with public placeholder environment values; diff check passed.

[Evidence and receipts](/Users/johnnynguyen/Documents/Repos/Banhall-branch-consolidation/.audit/branch-consolidation/B2-r1/evidence.md).

Per spec, staging, post-staging discovery, and the full integration gate remain parent-owned and pending. Existing Underline warnings remain unchanged.