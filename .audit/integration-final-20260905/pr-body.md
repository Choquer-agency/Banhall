Complete the Sprint 2 AI boundary, learning and chat work, including recovery of the failed BMAD stories and their independent review follow-ups. All 19 original capabilities are accounted for: 18 accepted native capability records and one capability already shipped before the sprint.

The changes strengthen generation snapshots, provenance, context boundaries and review gates; add completed-answer feedback, Brain source references, regenerate/retry and optimistic chat delivery; and provide an admin learning-health view with bounded, attributed measurements. Digest generation follows the approved per-stream diversity policy and produces an unpublished candidate for admin review. Rerank fallback metrics count attempted outcomes prospectively and disclose unavailable history.

The BMAD path uses Astra 6 medium, isolated worktrees, native acceptance and retained review evidence. Final review also fixed read-budget exhaustion when recording feedback, preserved causal generation errors and active research guards, repaired initial-conversation retry identity, distinguished confirmed sends, and added an order-sensitive capped-metric regression. Six lingering in-scope review recommendations (DW-94 through DW-99) were explicitly closed through the native atomic ledger API after verification. Existing unrelated deferred product decisions remain in the ledger.

Validation on product revision 569158a2b31ad0a7bf8ff1ba1e63a8634cc6f54c:

- 1970 nonbrowser tests across 154 files and 463 Chromium component tests across 60 files.
- Convex TypeScript and Svelte check passed with zero errors/warnings.
- 50 PowerShell and 18 Bash uploader checks and production build passed.
- Four fresh combined BMAD review layers completed; all accepted findings were repaired and independently verified. 3274 tracked non-audit source hashes were unchanged during final gates.

Evidence: [.audit/integration-final-20260905/summary.md](.audit/integration-final-20260905/summary.md) and its gate receipts. Browser images use controlled transport fixtures and do not establish live provider behavior. No deployment was performed.

Confirmed-send regression, before:

![Confirmed send labelled Sending](https://github.com/Choquer-agency/Banhall/blob/codex/bmad-completion/.audit/published-status-fix/published-before.png?raw=true)

After:

![Confirmed send labelled Sent with newer draft preserved](https://github.com/Choquer-agency/Banhall/blob/codex/bmad-completion/.audit/published-status-fix/published-after.png?raw=true)
