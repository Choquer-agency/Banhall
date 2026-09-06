# Attribution correction

Correction recorded 2026-09-06 UTC.

The audit report's reviewer line says `Codex GPT-6`. That attribution came from the inherited assistant persona and is not reliable evidence of the model configured for this delegated audit.

The root dispatch explicitly configured this audit subagent as `gpt-5.6-sol` with reasoning effort `medium` and `fork_turns: none`. No runtime environment value available inside this audit session identifies the model actually served. The supported attribution is therefore:

> Reviewed in a separately dispatched audit session configured for gpt-5.6-sol, medium reasoning, with no inherited conversation turns.

This correction changes attribution only. It does not redo or alter the review findings. The original report and receipt remain preserved with SHA-256 values in `attribution-receipt.json`.

The earlier Q4 flag is now resolved for future machine consumers by `.audit/quality-pass/review-supersessions.json`. That new receipt preserves the historical Q4 result, marks the three-lens review completed and triaged, points to the later evidence, and keeps the final combined gate pending after Q8.
