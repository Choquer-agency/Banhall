Implemented Q5: stateless rows now use unique index keys, preserving duplicate candidates and all displayed data.

Verified:
- Baseline reproduced `each_key_duplicate`.
- All 7 browser regressions pass.
- Svelte/TypeScript: 0 errors, 0 warnings.
- `git diff --check` passes.

[Evidence and screenshots](.audit/quality-pass/Q5/evidence.md) are recorded. Per spec, independent review and the final full gate remain for root finalization. Nothing was staged or committed.