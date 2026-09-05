---
title: 'DW-97 preserve active research observation after publication'
type: bugfix
created: '2026-09-05'
status: done
baseline_commit: '74f8789d582c7b3ea4b66f2d70624811d269186f'
review_loop_iteration: 0
context:
  - docs/svelte-migration.md
---

<frozen-after-approval reason="Authorized DW-97 repair intent">

## Intent

**Problem:** The story 6 panel discards the locally submitted research ID when it first appears in the report list, even while active. If newer research subsequently displaces it beyond the newest 20, regeneration can enable before the original research ends.

**Approach:** Retain that identity through active publication and observe its terminal or missing status through the existing list/details APIs. Add a real-panel regression for visibility followed by displacement. This repairs the existing Busy acceptance contract without changing backend semantics.

## Boundaries & Constraints

**Always:** Work only in the isolated Banhall-bmad-dw97-fix checkout. Preserve fresh-data requirements, conservative error/stale/loading handling, pending-publication behavior, stored-prompt fidelity and drafts. Capture the regression failing before production change, then passing. Use worker-owned npm dependencies and public placeholders. Keep changes minimal for subsequent integration with native story 7.

**Ask First:** A new product behavior or backend contract would require intent clarification. None is anticipated for this narrow repair.

**Never:** Edit native workers, target, policies, original story/spec, generated files, backend production, ledger or native state. Do not push, merge, create a PR or launch another loop. Do not expand historical tracking policy. Do not add credentials or private config. Product changes are limited to the pending locally submitted research guard. Commit only after parent review/finalization.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
| --- | --- | --- | --- |
| Active visible | Submitted A appears active in normal list | Regenerate remains disabled, identity retained | Wait for fresh authoritative status |
| Later displacement | Previously visible A is absent among 20 newer terminal summaries | Direct details observes A; active A keeps Regenerate disabled | No inference from absence |
| Direct terminal | Displaced A becomes completed, failed, canceled or explicitly missing | Guard releases and Regenerate recovers | Only fresh resolved data releases |
| Normal terminal | Listed A becomes completed, failed or canceled | Guard releases without requiring displacement | Existing normal list path |
| Metadata unavailable | Displaced A details loading, stale or errored with retained terminal data | Guard remains until fresh authoritative recovery | Fail conservatively |

</frozen-after-approval>

## Code Map

- `src/lib/components/chat/AgentChatPanel.svelte:368-420`: pendingResearchQ activates when the locally submitted ID is absent from a capped list. The effect currently clears identity on any list presence. Change only the status condition/handoff needed to retain active observation.
- `src/lib/components/chat/AgentChatPanel.svelte:952-958`: regenerationBusy combines publication, fresh metadata and visible active sessions. Preserve these guards.
- `src/lib/components/chat/RegenerateLimits.component.test.ts`: real panel Chromium suite; existing case covers initial displacement but misses first visibility. Reuse transport fixtures and add authoritative transition coverage.
- `src/lib/components/chat/RegenerateTurn.component.test.ts`: normal publication, draft/retry/Stop/navigation suites remain regression gates.
- `src/lib/test/convex-svelte-stub.svelte.ts`: supports per-argument data, query errors/staleness, mutation call inspection. No new transport implementation should be needed.
- `convex/research.ts:107-118,167-201`: read-only evidence of per-writer admission, report-wide newest20 and direct details endpoint.

## Tasks & Acceptance

**Execution:**
- [x] `RegenerateLimits.component.test.ts` -- add actual visibility-to-displacement and normal terminal/unavailable metadata coverage, retain red proof.
- [x] `AgentChatPanel.svelte` -- retain active research identity until authoritative terminal/missing observation.
- [x] `.audit/DW-97-fix` -- retain commands, exits, focused/full gates and review evidence.

**Acceptance Criteria:**
- Given previously visible active A, when 20 terminal sessions displace it, then Regenerate remains disabled and no chat send occurs until A is authoritatively terminal or missing.
- Given A still listed, when it becomes terminal, then existing controls recover without a direct-query dependency.
- Given unavailable direct metadata, when retained data is terminal, then controls remain guarded until fresh resolution.
- Given the repair, when existing regeneration suites run, then prompt, draft, Stop and retry behavior continue passing.

## Spec Change Log

## Verification

Commands: worker-owned `npm ci`; `npx svelte-kit sync`; focused `npm run test:component -- src/lib/components/chat/RegenerateLimits.component.test.ts src/lib/components/chat/RegenerateTurn.component.test.ts src/lib/components/chat/RegenerateQueryState.component.test.ts`; full `npm run test:component`; `npm test`; `npx tsc --noEmit -p convex/tsconfig.json`; `PUBLIC_CONVEX_URL=https://placeholder.convex.cloud npm run check`; source `git diff --check`. Keep red/green command logs and exit codes. No live provider claim. Pure state change needs no visual redesign; inspect a screenshot if useful to show blocked/recovered behavior.

## Review Triage

Four fresh review contexts completed: blind, edge, verification gap, acceptance. No actionable findings, no failed layers, no deferred items. Two waves were needed for concurrency limits. No original story or ledger status was changed.

## Suggested Review Order

- Retain active identity until authoritative terminal status.
  [AgentChatPanel.svelte:415](../../src/lib/components/chat/AgentChatPanel.svelte#L415)

- Verify first visibility, displacement, guarded state, and eventual recovery.
  [RegenerateLimits.component.test.ts:97](../../src/lib/components/chat/RegenerateLimits.component.test.ts#L97)
