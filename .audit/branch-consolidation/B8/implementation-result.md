Implemented the spec across four files.

- Mobile New project target is now **44×44px**; desktop remains **32px high**.
- Added Button anchor-height and rail order/icon assertions.
- Reproduced the baseline failure, then passed **41 Chromium tests** and `git diff --check`.
- Shared Button, styles, and browser configuration remain unchanged.

[Evidence and logs](/Users/johnnynguyen/Documents/Repos/Banhall-branch-consolidation/.audit/branch-consolidation/B8/evidence.md)

Per spec, independent review, full verification gate, and integration remain parent-owned. Changes are uncommitted.