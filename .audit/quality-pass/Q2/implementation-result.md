Implemented the three-file repair: redirected all 13 screenshot sites to `.vitest-attachments`, preserving all 14 filenames, options and assertions, and updated the AGENTS output guidance.

Verification passed:
- Direct nine-step gate: 2,038 unit tests and 489 component tests passed.
- All 6,366 tracked paths, Git status and index remained unchanged by verification.
- All 14 PNGs were freshly produced, nonempty and ignored.
- `git diff --check` passed.

[Verification evidence](/Users/johnnynguyen/Documents/Repos/Banhall-quality-pass/.audit/quality-pass/Q2/direct-verification/evidence.md)

Nothing remains incomplete in the implementation. Existing baseline warnings remain. Changes are uncommitted; final review and shipping remain with the parent.