Implemented reference-safe storage cleanup at all three deletion sites, with four indexed lookups protecting referenced blobs.

Verified:
- Baseline reproduced referenced-byte loss.
- Unchanged regression tests pass after repair: **58 tests passed**.
- Convex TypeScript check and `git diff --check` passed.

Full logs, hashes and acceptance mapping: [evidence.md](/Users/johnnynguyen/Documents/Repos/Banhall-quality-pass/.audit/quality-pass/Q1/evidence.md).

Pending per spec: independent root review and canonical verification. No deployment, staging or commits performed.