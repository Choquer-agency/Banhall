# DW-98 repair result, 2026-09-05

Private reviewed commit: **`4e0bdf5d45d7f5d555227783c69d01e29bfbec43`**, branch `codex/bmad-dw98-fix`, checkout `/Users/johnnynguyen/Documents/Repos/Banhall-bmad-dw98-fix`. Exact baseline `e8abbc14523eff3e1aa490712e7efafe9cd86b24`. Clean worktree; post-commit whitespace and committed artifact manifest verified. No merge, push, PR, or ledger closure.

## Repair

One production conditional changes at `src/lib/components/chat/AgentChatPanel.svelte:662`: capture `newThread:true` whenever there is no selected thread, instead of only when the writer explicitly selected New conversation. The first implicit unsaved request therefore retains creation intent before asynchronous state changes. Retry still sends the same captured args. Named thread and regeneration branches retain their exact destinations. No backend/API/permissions, native story/spec/state/ledger or DW-97 guard change.

The real-panel regression starts with implicit empty A and an original highlight, fails A before a backend commit, creates and publishes separate B, returns to retained A, retries its same logical key, verifies explicit creation args plus original highlight, preserves newer draft/replacement context, then tests returned A identity and exact-ID handoff. Existing named, explicit-new, refinement, navigation and guard regressions remain passing.

## Runtime evidence and review

- Confirmed baseline: `regression-before.log` exit **1**, solely missing `newThread:true` in initial/retried A API payloads after the actual panel sequence. Same regression after source repair: exit **0**.
- Focused four browser suites: **82 tests**, exit 0.
- Full canonical `npm run test:component`: **429 tests / 59 files**, exit 0.
- `npm test`: **1911 tests / 149 files**, exit 0.
- Convex `tsc --noEmit`: exit 0.
- Svelte check with public placeholder: **0 errors / 0 warnings**, exit 0.
- Source/staged/committed whitespace: pass.
- Four **fresh** BMAD review contexts (blind, edge, verification gap, acceptance), two concurrency waves: no actionable findings. Standalone repair spec finalized done with Suggested Review Order.

All proof is committed under `.audit/DW-98-fix`, including exact before/after source hashes, command logs/exits, matrix mapping, reviewer results, serialized reviewed source diff, screenshots and SHA-256 manifest. Parent directly inspected the retained-A screenshot and verified current source hashes plus all historical artifact restoration hashes. Original story7 artifacts remain exact baseline bytes after test recaptures; changed captures are preserved only in this repair audit. Terminal blank log lines were normalized for whitespace validation; substantive output is unchanged.

## Limits and integration

The rendered test records actual panel API arguments through existing transport stubs. It does **not** execute backend fallback; unchanged `convex/chatV2.ts:304-335` establishes explicit newThread bypasses latest-thread resolution, and fixture-returned A/B IDs test panel adoption. Screenshots show retained context, not a visual change or live routing proof. No live provider, backend idempotency, reload persistence or exactly-once claim after ambiguous transport failure. Existing publication-first identity delay remains.

Root should integrate this private commit together with separately verified DW-97 `5df0d2c4ae9677a891cd8ca19f2669da40fc4311` and other approved work only after the native queue boundary, reconcile any overlapping panel edits, and rerun combined gates. Local results prove this exact isolated baseline plus DW-98, not the combined DW-97/DW-98/story8 source. Root retains ledger and final acceptance ownership.

VS Code CLI was unavailable; finalized `.audit/DW-98-fix/spec.md` contains clickable Suggested Review Order.
