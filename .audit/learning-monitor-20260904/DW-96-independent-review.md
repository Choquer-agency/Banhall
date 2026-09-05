# DW-96 independent follow-up review

Completed a deliberate independent follow-up of accepted story 4. **One low-severity operational error-handling finding remains; no high/medium finding or acceptance/privacy/diversity defect was identified.** No product, policy, story, ledger, native state or target changes were made. No commit, push or merge.

## Actionable finding

**[Low] Preserve the original generation error when recording its failed attempt also fails.** At `convex/ai/learning.ts:105-113`, the catch awaits `recordDigestAttempt` before `throw error`. If that mutation rejects after a provider/parsing exception, its rejection exits the catch and replaces the original exception. This contradicts the explicit original-error rethrow promise in the code and story review amendment. Guard the secondary write so the original generation error still escapes (for example, a finally around the attempt write). A narrow dual-failure test should assert original-error identity when this is repaired. This is a conditional control-flow finding established from the actual source, not a reproduced database outage; candidate and publication invariants remain intact. No patch applied under this review-only authorization.

This issue affects operational diagnostics during a secondary failure, so it is low severity. It does not establish an ordinary user-flow failure or require another broad review cycle. Root may carry this specific action into an owned repair boundary or explicitly dispose of it; this report does not silently close it.

## Scope and evidence

Baseline `8d00a441c61279fa8fdbcb0015db1d9e95880eec`; accepted story `36313c0ac79fbd408fe121958f0af759ab7e964c`; owned review checkout `3b8a451e3738a8da1bd95ba5e7029dba6f970a4d` on `codex/bmad-browser-gate-repair`. The nine product/domain/test files are byte-identical between accepted story and review HEAD, and working files match HEAD. Exact hashes and protected-file comparisons are in `source-integrity.json`. All eight forbidden source paths match the story baseline; generated APIs have no story diff.

Reviewed the complete 2,478-line product/domain/test diff (`review.diff`), complete story 4 spec and its prior three triage passes, approved digest-diversity policy, CAP-4 domain amendment, Convex guidelines, source/callsite context and applicable frontend conventions. Four independent BMAD layers completed: blind hunter, edge-case hunter, verification-gap reviewer and acceptance auditor. `layer-results.md` retains results; `triage.json` retains ten normalized claims, with one low patch and nine dismissed. Related suggestions were judged separately; prior dismissals were checked against current code rather than accepted automatically.

Fresh actual-action backend verification: `npx vitest run convex/learning.test.ts` passed **36 tests, exit 0**, at exact review HEAD. See `focused-backend.json` and `.log`. This includes all five stream diversity cases, no pooling, missing attribution/reason overlap, shared minimum, omitted freshness, exact distinct payload/provenance, source preservation, failed/unsupported outcomes, immutable candidate/selection, legacy absence and unauthorized-history denial.

Reused fresh canonical full browser evidence from the same checkout and source: `.audit/browser-gate-repair/canonical-components.json` / `.log`, **323 tests in 53 files, exit 0**, using the unmodified canonical `npm run test:component` after npm ci and Svelte sync. The actual reviews-page component cases cover distinct QA/style histories, exact disclosed IDs/counts, six operational outcomes, legacy absence and privacy confirmation controls. No redundant browser run was performed. No audit wrapper substituted for this gate.

## Triage limits

The second shared layer claim, candidate-save failures leaving prior attempts, was not promoted to a defect: no concrete failure was demonstrated in the bounded valid candidate path independently of database availability, and candidate/attempt success writes are already one transaction. A universal durable explanation during database failure is not established by this feature. This differs from the actionable error-precedence issue, which has a precise local control flow and minimal fix.

Other dismissed claims were optional window/write-path/keyboard/concurrency test suggestions, future internal metadata validation, property-order canonicalization irrelevant to the current single-key test arguments, and source-navigation convenience outside the approved contract. No new evidence overturned the prior policy decisions. Best-effort de-identification, missing/deleted project metadata, bounded source windows and timestamp freshness retain documented limitations. Browser fixtures are not a deployed authenticated end-to-end session. Concurrent outages and production throughput were not exercised.

The BMAD resolver and `_bmad/bmm/config.yaml` are absent in this retired-entrypoint checkout. Read the installed customization directly: no prepend/append hooks, no completion action, four default layers, no discoverable team/user override or project-context file. Used explicit source/spec/English scope from the assigned task. User authorization to perform the whole review superseded interactive checkpoints; the explicit read-only task superseded skill instructions to edit story/sprint/ledger. Child slots required two overlapping waves rather than four simultaneous launches. These are disclosed workflow adaptations, not omitted review layers.

## DW-96 disposition

The requested deliberate independent review after the native damping cap has now been performed and is evidenced. Its purpose is satisfied as a review activity; this does not claim all findings fixed. Native DW-96 ledger status remains unchanged and orchestrator-owned. Root should retain the low finding's explicit disposition when deciding the ledger closure. Later story5 or combined integration source still needs its own final combined gate; this review covers accepted story4 only.

Durable evidence directory: `/Users/johnnynguyen/Documents/Repos/Banhall-bmad-browser-gate-repair/.audit/DW-96-independent-review`.
