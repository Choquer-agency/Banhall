Implemented the three Brain audit labels and added the adjacent browser regression suite.

Verified:
- Regression failed on all three old labels, then passed all 7 cases unchanged.
- All 24 backend erasure tests passed.
- Type check passed with documented public environment placeholders.
- Discovery showed ordinary Chromium only; protected file hashes stayed unchanged.
- `git diff --check` passed.

[Evidence and command logs](/Users/johnnynguyen/Documents/Repos/Banhall-branch-consolidation/.audit/branch-consolidation/B11/evidence.md).

No implementation items remain. Per the spec, staging, independent review, staged discovery, full integration verification, and shipping remain parent-owned.