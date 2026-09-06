Implemented Q7:

- Added two-attempt uploads with fresh URLs, 30-second URL timeouts, aborting 120-second POST/body deadlines, and response validation.
- Added the missing-original warning after review text saves, preserving review sequencing and text fallback.
- Added transport and real-wizard regressions.

Verified baseline failures, then **45 unit tests and 19 browser tests passed**. Svelte checks reported zero errors/warnings; diff checks passed.

[Evidence and screenshots](.audit/quality-pass/Q7/evidence.md).

Independent review and the final full gate remain with the owning session per spec. Whole-project submission is not bounded; lost acknowledgements may leave orphaned bytes. No commits or ledger changes.