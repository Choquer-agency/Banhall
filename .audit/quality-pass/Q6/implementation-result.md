Implemented avatar-only Settings navigation for writer, manager, and admin roles. Rail behavior and sign-out code remain unchanged.

Verified:

- Six Settings cases failed before the fix.
- All 30 focused browser tests now pass.
- Svelte/TypeScript: zero errors or warnings with documented placeholder env values.
- `git diff --check` passes.

Screenshots and detailed results: [evidence.md](/Users/johnnynguyen/Documents/Repos/Banhall-quality-pass/.audit/quality-pass/Q6/evidence.md).

Pending per spec: root-owned independent review and final full gate. Navigation was tested at the component boundary, not in a deployed authenticated session. Nothing staged or committed.