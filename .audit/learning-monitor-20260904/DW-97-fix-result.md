# DW-97 repair result, 2026-09-05

Private reviewed commit: **`5df0d2c4ae9677a891cd8ca19f2669da40fc4311`** on `codex/bmad-dw97-fix`, checkout `/Users/johnnynguyen/Documents/Repos/Banhall-bmad-dw97-fix`. Baseline `74f8789d582c7b3ea4b66f2d70624811d269186f`. Worktree clean; commit whitespace and committed evidence manifest verified after commit. No push, merge, PR or ledger closure.

## Change

`src/lib/components/chat/AgentChatPanel.svelte:415-420` retains the locally submitted research identity when first listed as active. Only a known listed terminal state clears it; the existing fresh direct-details terminal/missing path remains intact after displacement. Production diff is one seven-line hunk (five additions, two removals). Backend behavior, permissions, original story/spec/policy and native worker state remain untouched.

`RegenerateLimits.component.test.ts` adds ten actual-panel scenarios: four visibility-then-displacement terminal/missing outcomes, three ordinary listed terminal outcomes, and three unavailable direct-metadata recovery states. Tests check disabled regeneration and no sends before authoritative recovery, then exact stored prompt and preserved draft afterward. This closes the confirmed DW-97 finding within the authorized local-session scope.

## Proof

- Confirmed before-fix browser failure: `red-confirmed.log` and `.exit`, one failed test on baseline production because Regenerate incorrectly enabled after displacement.
- Focused regeneration browser suite: **59 tests / 3 files**, exit 0.
- Complete canonical `npm run test:component`: **406 tests / 58 files**, exit 0.
- Complete `npm test`: **1911 tests / 149 files**, exit 0.
- `npx tsc --noEmit -p convex/tsconfig.json`: exit 0.
- Svelte `npm run check` with public placeholder: **0 errors / 0 warnings**, exit 0.
- Four **fresh** BMAD review contexts (blind, edge, verification gap, acceptance): no actionable findings. Two waves accommodated concurrency limits. Standalone BMAD build spec finalized done; original story was not edited.

Committed evidence lives in `.audit/DW-97-fix`, including command logs/exits, matrix mapping, review results, serialized exact source diff, screenshots and SHA-256 manifest. The initial red run also contained three overbroad fixture assertions; an intermediate green attempt exposed missing fixture collections. These are honestly retained and distinguished from the confirmed product regression. Trailing blank log lines were normalized for whitespace checks without changing substantive output. Existing story-6 screenshots were restored; copies are in this repair audit. Parent inspected the normal screenshot as unchanged presentation proof, not as the asynchronous regression proof.

## Integration limits

Native story 7 concurrently changes `AgentChatPanel.svelte` elsewhere. Apply this private commit only at root's safe integration boundary, preserve its pending research effect semantics when reconciling overlapping changes, and rerun combined gates. The complete local browser result proves this exact isolated baseline plus repair, not later story 7 or final combined source. No live model/provider or deployed backend execution was performed. Root retains DW-97 ledger and final acceptance ownership.

The VS Code CLI was unavailable; the finalized standalone spec with Suggested Review Order remains `.audit/DW-97-fix/spec.md`.
