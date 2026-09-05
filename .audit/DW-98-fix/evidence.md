# DW-98 repair evidence

Baseline: `e8abbc14523eff3e1aa490712e7efafe9cd86b24`, branch `codex/bmad-dw98-fix`.

The production diff changes only the creation-intent predicate at the composer argument boundary, from `startingNewChat` to `!selectedThreadId`. Named thread and regenerate branches retain their destinations. Retry still transports `request.args` unchanged.

## Baseline failure and repair

`npm run test:component -- src/lib/components/chat/OptimisticSend.component.test.ts -t 'retries initial implicit A'` failed before production changes (regression-before.log, exit 1). The only failure was missing `newThread: true` in A's first and retried request. The same regression passed after the repair (regression-after.log, exit 0). Source hashes are in before-source.sha256 and after-source.sha256.

This mounts the actual AgentChatPanel and message rendering in Chromium with reactive query/transport stubs. It asserts captured API requests directly. It does not execute backend fallback or use a simulated backend destination resolver. Read-only source convex/chatV2.ts:304-335 establishes that an unbound request uses latest report thread, while explicit newThread bypasses that fallback. The fixture returns A/B identities explicitly to test panel adoption and exact-ID reconciliation.

Screenshots implicit-A-before.png and implicit-A-after.png show the retained failed A, separate B, and newer composer draft. They are real browser captures of equivalent pre-retry state; payload logs, not visible styling differences, demonstrate the repair.

## Acceptance mapping

| Matrix row | Rendered coverage |
| --- | --- |
| Initial implicit A failure; separate B then Retry A | `retries initial implicit A with creation intent after separate B succeeds`: first A fails, B succeeds/publishes, A is selected, retry equals original captured args and explicitly sets newThread, result selects thread-A |
| Named destination | `keyboard retry captures ...`, `captures refinement ...`, `keeps an existing conversation send scoped ...`: exact named thread routing and navigation isolation |
| Explicit New conversation | `retains failed unsaved conversations across another New conversation and retries with newThread` |
| Captured content | New regression preserves A content/highlight, excludes replacement highlight/draft, does not clear replacement context; existing refinement case preserves proposal ID |
| Reconciliation | New regression retains A key through returned identity, rejects wrong message ID, removes only exact A ID; existing mutation/publication-order and offscreen-thread cases cover remaining identity guards |
| Existing guards | Four focused files cover optimistic-send, regenerate, query-state and limits; full component and unit suites cover broader safeguards |

## Commands

All logs and numeric exits live beside this document. Public placeholder for check: PUBLIC_CONVEX_URL=https://placeholder.convex.cloud.

- npm ci: npm-ci.log / npm-ci.exit (parent executed, exit 0).
- npx svelte-kit sync: sync.log / sync.exit (0).
- Focused four component files from spec: focused.log / focused.exit (0), 82 tests.
- npm run test:component: component-full.log / component-full.exit (0), 429 tests in 59 files.
- npm test: unit.log / unit.exit (0), 1911 tests in 149 files.
- npx tsc --noEmit -p convex/tsconfig.json: convex-tsc.log / convex-tsc.exit (0).
- PUBLIC_CONVEX_URL=https://placeholder.convex.cloud npm run check: check.log / check.exit (0), zero errors/warnings.
- git diff --check: diff-check.log / diff-check.exit (0).

## Limits

No live backend/provider proof, backend idempotency, reload persistence, or exactly-once guarantee after ambiguous transport failure. Publication-first ambiguity remains unchanged. No backend, generated file, DW-97 guard, domain policy, native state, or ledger changes. Independent review and finalization completed before private commit; root retains combined integration and ledger ownership. No push or PR performed.

Historical tracked story-7 artifacts restored byte-for-byte from HEAD after canonical screenshot recaptures. `historical-restored.sha256` records each hash; changed captures retained in canonical-recaptures/.

## Parent review and finalization

Four fresh review contexts returned no findings; review.json retains the layer outcomes. Parent independently read the source/test diff, baseline failure and all numeric gate exits, validated after-source.sha256 and every historical-restored.sha256 entry, and inspected implicit-A-after.png. The screenshot contains a fixture-only missing date in B’s menu; it establishes retained context, not presentation changes or backend routing. The payload assertion and unchanged backend source establish creation intent.

Source remained byte-identical to the reviewed diff, serialized losslessly in review-diff.json, through finalization. All standalone spec tasks and matrix rows are complete. Original native story, policy, state and ledger are untouched. Installed BMAD renderer was used read-only from main; writable workflow artifacts remain solely in this repair checkout. Existing authorization covered this narrow fix and private commit. VS Code CLI is unavailable; spec.md retains clickable Suggested Review Order.

Terminal blank lines in logs are normalized for whitespace validation without changing substantive output or numeric exit receipts. Final commit identifier is in the root-readable DW-98-fix-result report.
