Implemented B1: deadline timers now clear when parsing settles, preserving the shared 60-second deadline and existing errors. Added cleanup regressions and sequential-budget proof; no editor files changed.

Verification:
- Baseline reproduced four timer leaks.
- Final parser suite: **19/19 passed**.
- Eager-fixture control failed as intended; restored test passed.
- Whitespace check and source hashes verified.

[Evidence and logs](/Users/johnnynguyen/Documents/Repos/Banhall-branch-consolidation/.audit/branch-consolidation/B1/evidence.md).

Parent review, full verification gate, and commits remain pending as specified. Real-PDF browser behavior was not tested.