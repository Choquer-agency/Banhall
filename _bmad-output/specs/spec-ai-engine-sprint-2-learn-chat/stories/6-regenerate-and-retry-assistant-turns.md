---
title: 'Regenerate and retry assistant turns'
type: 'feature'
created: '2026-09-04'
status: 'done'
baseline_revision: '1fd71dcfc63e9c7a7ba083ae646ff1ad8486c4c5'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/docs/svelte-migration.md'
  - '{project-root}/docs/design-system.md'
warnings: [oversized]
deferred: []
---

<intent-contract>

## Intent

**Problem:** Writers cannot regenerate completed or failed assistant turns without retyping their prompt (CAP-5).

**Approach:** Add a keyboard-accessible Regenerate control to terminal assistant turns. Resolve the originating user prompt and resend its stored text as a new turn on the same thread through the existing sendText path.

## Boundaries & Constraints

**Always:** Reuse AgentChatPanel.sendText and the unchanged chatV2.sendMessage API. Preserve existing transcript, proposals, feedback, and composer behavior. Associate prompts by shared order within the selected thread; never guess from an unrelated earlier prompt. Use Svelte 5 runes and existing design tokens, maximum weight 500. Run component tests before editing components. Keep an append-only decision trail and acceptance evidence in .audit/story-6/.

**Block If:** Same-thread resend needs a backend signature change or an unapproved domain transition.

**Never:** Edit Convex production code or generated files, mutate report prose, delete/replace the original turn, add optimistic sends (CAP-6), or author deferred-work ledger entries. Do not route regeneration into pending research, add current highlight/refinement context to an old prompt, or clear an unrelated composer draft.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Completed turn | Loaded user prompt and completed assistant turn | Regenerate sends original stored prompt text as a new turn on the same thread; old answer remains | Existing send error surface |
| Failed turn | Failed assistant message, or trailing failed durable turn without an assistant message | Regenerate available even without answer text; same prompt resends | Existing send error surface |
| Multi-row turn | Multiple assistant rows share a prompt order | One regenerate action after the final assistant row; correct originating prompt | No unrelated prompt fallback |
| Missing prompt | Paginated assistant without loaded matching user prompt | No actionable regeneration until matching prompt is loaded | No send |
| Nonterminal / stopped | queued, running, streaming, pending, or aborted turn | No regenerate control for this turn | No send |
| Busy | Another send/research/stream is in progress | Regenerate disabled; rapid activation cannot send duplicates | Existing shared guards |
| Composer context | Draft text and current highlight/refinement/research selection coexist with historical turn | Regenerate resends the stored prompt only, preserving current draft/context | Does not start research |
| Send failure | Resend mutation rejects, then succeeds | Inline error visible; retry repeats the same regeneration intent on original thread without composer contamination | Retry recovers using sendText |
| Keyboard | Focused Regenerate button | Enter and Space activate resend; visible focus affordance | No error expected |

</intent-contract>

## Code Map

- `src/lib/components/chat/AgentChatPanel.svelte:466` -- sendText owns busy guards, research branching, sendMessage mutation, error/retry and scroll behavior. Extend this shared path with explicit historical resend intent instead of duplicating mutation handling. Existing retryText/error button at ~908 must preserve resend intent on failure.
- `src/lib/components/chat/AgentChatPanel.svelte:344` -- listTurns and timingByOrder supply durable status; assistant replies share prompt order. feedbackTurnByMessage demonstrates final-row association, but regenerate must also support empty/failed turns. pendingTiming at ~824 handles the trailing prompt without a reply. Main AssistantTurn rendering at ~1328.
- `src/lib/chat/turnParts.ts` -- read-only message-part normalization; normalizeTurnParts extracts text without reasoning/tool data. Add a pure prompt/final-row association helper here if useful and unit-test it. Preserve raw UIMessage parts.
- `src/lib/components/chat/AssistantTurn.svelte` -- renders trace, proposals, answer, copy actions, feedback. Copy requires answer text, so regeneration visibility must be independent of canCopy.
- `src/lib/components/chat/ChatFeedback.component.test.ts` -- real AgentChatPanel browser harness with Convex transport fixtures. Reuse stub APIs from src/lib/test/convex-svelte-stub.svelte.ts; do not mock the panel or sendText.
- `convex/chatV2.ts:340` (read-only) -- stored user prompt contains appended highlight/refinement context. Replay stored text once as content; do not reappend current composer context.
- `vitest.component.config.ts` -- existing browser config, never add sveltekit().

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/chat/turnParts.ts` and `src/lib/chat/turnParts.test.ts` -- implement/test deterministic originating-prompt and final assistant-row association where needed, including missing prompts and multi-row turns.
- [x] `src/lib/components/chat/AgentChatPanel.svelte` -- wire terminal-turn regeneration to sendText with explicit same-thread resend intent, isolated composer state, busy guards and faithful failure retry.
- [x] `src/lib/components/chat/AssistantTurn.svelte` -- render accessible Regenerate control independently of answer/copy visibility; preserve source chips and feedback.
- [x] `src/lib/components/chat/RegenerateTurn.component.test.ts` -- mount real panel, exercise matrix cases through rendered controls, and assert mutation arguments, transcript retention, and keyboard behavior. Capture browser evidence in .audit/story-6/.

**Acceptance Criteria:**
- Given failed or completed historical turns, when the writer uses Regenerate, then the real panel calls the existing sendMessage mutation with original text and same threadId, without deleting the old turn.
- Given keyboard-only navigation, when the writer focuses and activates Regenerate with Enter or Space, then the same resend occurs.
- Given every matrix scenario, when the component/unit suites execute, then each row has a passing behavioral test; no skips or disabled tests count.
- Given existing chat features, when component tests, npm test, and npm run check execute, then they pass without forbidden backend edits.

## Spec Change Log

## Review Triage Log

### 2026-09-05 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 11: (high 0, medium 5, low 6)
- defer: 0
- reject: 0
- addressed_findings:
  - `[medium]` `[patch]` Offscreen retry checked the selected thread's busy state. Require an explicit return to the original conversation, then loaded query and busy guards before resend.
  - `[medium]` `[patch]` Mutation completion preceded subscription publication. Hold a per-thread guard until the returned prompt id is observed.
  - `[medium]` `[patch]` Partial success could expose regeneration before durable timing loaded. Suppress controls during loading, stale, or failed timing queries; retain resolved legacy support.
  - `[medium]` `[patch]` Older durable failures without assistant rows lost their action. Render unanswered durable turns at each corresponding prompt position.
  - `[medium]` `[patch]` Retry could send and scroll an unrelated visible conversation. Make the destination explicit and only scroll the receiving transcript.
  - `[low]` `[patch]` Tool-only fixture was empty. Exercise actual tool parts and preserved trace.
  - `[low]` `[patch]` Multiple distinct originating prompts were not tested. Activate separate historical actions and assert distinct exact content.
  - `[low]` `[patch]` Keyboard proof used programmatic focus. Exercise desktop Tab navigation, Enter/Space, visible focus, and action-row opacity.
  - `[low]` `[patch]` Subscription arrival was not exercised. Publish appended prompt/answer fixtures and assert original/new turns and action association.
  - `[low]` `[patch]` Copy, feedback, sources, and proposals lacked combined preservation proof. Exercise those controls after regeneration and assert no proposal application.
  - `[low]` `[patch]` Historical busy guard lacked independent durable-turn coverage. Exercise queued/running timing with successful assistant snapshots, then completion.

Four independent reviewers ran: blind, edge-case, verification-gap, and intent alignment. The edge-case offscreen retry claim duplicates the blind review's first claim and was counted once. Intent-alignment observations confirmed the explicit frontend/component-test boundary and stored-prompt replay; they did not identify an unresolved intent decision. Literal stored text preserves the original prompt and avoids appending current composer context. Backend persistence/generation remain the existing sendMessage path.

## Verification

**Commands:**
- `npm run test:component` -- browser suites pass; run before component changes as baseline and after implementation.
- `npm test` -- unit/backend suites pass.
- `PUBLIC_CONVEX_URL=https://placeholder.convex.cloud npm run check` -- zero errors.
- `git diff --check` -- no whitespace errors.

### 2026-09-05: Follow-up review pass
- intent_gap: 0
- bad_spec: 0
- patch: 9: (high 0, medium 4, low 5)
- defer: 0
- reject: 1: (high 0, medium 0, low 1)
- addressed_findings:
  - `[medium]` `[patch]` Composer activation could overlap accepted regeneration before publication. Apply the local publication guard to the shared send path and visible composer control; verify Enter cannot submit the preserved draft.
  - `[medium]` `[patch]` Accepted composer/research operations could release regeneration early. Retain their returned identifiers until observable query state establishes the handoff; test mutation resolution separately from publication.
  - `[medium]` `[patch]` Unavailable research data was treated as idle. Require fresh resolved research data before enabling regeneration; exercise loading, stale retained data, errors, active research, and recovery.
  - `[medium]` `[patch]` Pending identifiers could move outside loaded messages. Retain the send's lower order bound, widen the existing turn query while pending, and narrow only after its terminal record is observed; test navigation and off-page running/completed records. The existing 200-turn backend cap remains a residual limit.
  - `[low]` `[patch]` Stale/failed retained timing lacked regression proof. Add explicit query-state fixture support and browser cases that suppress actions, disable historical retry, and verify recovery.
  - `[low]` `[patch]` Successful in-flight navigation lacked coverage. Resolve the mutation after switching conversations and verify selected-thread identity and draft retention before returning.
  - `[low]` `[patch]` Subscription publication was tested only as one complete snapshot. Exercise accepted mutation, prompt-only publication, queued durable state, and completion as separate observable transitions.
  - `[low]` `[patch]` Unanswered nonterminal rendering lacked coverage. Verify one queued/running/aborted status presentation and no regeneration action.
  - `[low]` `[patch]` Historical actions lacked contextual accessible descriptions. Attach the original prompt to each action's accessible description and assert distinct descriptions while retaining the visible Regenerate label.

All four independent layers ran. Duplicate publication/readiness and timing-test findings were counted once. Intent alignment confirmed the explicit stored-text and frontend transport contract. No deferred-work entry was authored, reopened, or rewritten.

### 2026-09-05: Third review pass
- intent_gap: 0
- bad_spec: 0
- patch: 9: (high 0, medium 3, low 6)
- defer: 0
- reject: 4: (high 0, medium 0, low 4)
- addressed_findings:
  - `[medium]` `[patch]` A pending send could be displaced by the 200-turn limit. Search older bounded windows for its exact identifier and retain the guard until terminal publication.
  - `[medium]` `[patch]` Missing timing outside a full result window could misclassify stopped turns as legacy. Suppress eligibility where the capped query cannot establish coverage.
  - `[medium]` `[patch]` Research displaced from the newest 20 summaries could lock sending. Observe the existing session-details API directly and release on completed, failed, canceled, or missing results.
  - `[low]` `[patch]` Composer Retry advertised availability while publication blocked its handler. Include the shared publication guard in its disabled state.
  - `[low]` `[patch]` Failed and aborted publication lacked guard-release proof. Parameterize terminal cases and actually send the preserved composer draft after recovery.
  - `[low]` `[patch]` Stop after regeneration lacked browser proof. Activate Stop before an assistant exists and assert the regenerated order and original thread.
  - `[low]` `[patch]` Delayed rejection after navigation lacked coverage. Assert visible conversation/draft retention and exact original-thread retry.
  - `[low]` `[patch]` Full stored prompts made accessible descriptions unnecessarily long. Bound the description to 160 characters while retaining full replay content.
  - `[low]` `[patch]` Historical evidence described the superseded publication guard. Append a current behavior explanation and additional acceptance mapping.

All four independent layers ran. Duplicate limit and terminal-verification findings were counted once. Intent alignment confirms the explicit stored-text transport boundary and shared busy guards; browser fixtures do not claim live provider generation. Existing deferred-work ledger entries remain unchanged.

## Auto Run Result

Status: done

Historical regeneration and faithful error retry replay the original stored prompt through the unchanged sendText/sendMessage API. This review repairs capped-query recovery, prevents missing timing from exposing stopped turns, and adds terminal/Stop/navigation coverage. Composer drafts and full replay content remain preserved.

Files reviewed:

- `src/lib/components/chat/AgentChatPanel.svelte`: bounded pending-turn lookup, direct displaced-research observation, Retry availability, and concise accessible descriptions.
- `src/lib/components/chat/RegenerateLimits.component.test.ts`: seven new cap/research/description browser regressions.
- `src/lib/components/chat/RegenerateTurn.component.test.ts`: terminal recovery, actual Stop, delayed rejection, and updated description assertions.
- `src/lib/chat/turnParts.ts` and `turnParts.test.ts`: existing exact-order prompt association and terminal eligibility reviewed.
- `src/lib/components/chat/AssistantTurn.svelte`: existing keyboard-accessible action reviewed.
- `RegenerateQueryState.component.test.ts` and `src/lib/test/convex-svelte-stub.svelte.ts`: existing query-state behavior reviewed and exercised.
- `.audit/story-6/`: command logs, append-only decisions/evidence, refreshed browser images, and ledger hash proof.
- This story: third-pass triage and final result.

Review outcome: nine patches (high 0, medium 3, low 6), zero deferred items, four rejected findings. Follow-up review recommended: true; score = 3 × 3 + 6 = 15. No existing deferred-work ledger entry was modified, reopened, or rewritten.

Verification: seven new regressions failed against invocation production and passed after the patch. Final `npm run test:component` passed 58 files / 396 tests; `npm test` passed 149 files / 1,911 tests; `PUBLIC_CONVEX_URL=https://placeholder.convex.cloud npm run check` reported zero errors and warnings. `git diff --check` passed. Final normal and keyboard browser images were inspected.

Residual risks: browser tests exercise the real panel with transport fixtures, without live model/provider generation. Unavailable metadata still keeps controls conservatively guarded. Very old assistant rows outside capped timing coverage have no regeneration action until their timing is available. Native orchestrator acceptance remains separate from local story completion.
