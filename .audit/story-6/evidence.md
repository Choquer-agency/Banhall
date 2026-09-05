# Story 6 acceptance evidence

Baseline commit: `1fd71dcfc63e9c7a7ba083ae646ff1ad8486c4c5`. Evidence below verifies the implementation working tree based on that commit; native parent finalization owns the resulting commit.

The real `AgentChatPanel` is mounted in Chromium. Only Convex/auth transport boundaries use the repository fixtures. The tests do not replace the panel or its sendText function.

| Acceptance / matrix row | Behavioral evidence |
| --- | --- |
| Completed same-thread resend, original transcript retained | `RegenerateTurn.component.test.ts`: keyboard completed-prompt cases assert exact stored content/thread/report arguments and retained original prompt/answer |
| Failed message, empty failure, trailing durable failure | parameterized `supports ... without requiring a copyable answer` cases |
| Multi-row action and correct prompt | `places one action after a multi-row answer`; `turnParts.test.ts` exact-order/final-row association and immutable input checks |
| Missing paginated prompt | `waits for the exact paginated prompt instead of using an unrelated earlier prompt` verifies absent control/no send, then loaded matching prompt enables send |
| Nonterminal / stopped | parameterized queued/running/aborted/streaming/pending browser cases plus pure terminal eligibility tests |
| Busy and duplicate activation | rapid synchronous activation test; active queued/researching/reviewing/streaming cases; pending composer and research mutation cases |
| Composer context | draft/current highlight/research preserved across failure/retry; active proposal refinement and its draft preserved |
| Send failure retry | exact original arguments asserted on both calls; conversation-switch retry case requires explicit return to the original thread, disables retry through loading/running timing, and preserves the second-thread draft |
| Keyboard | focused native Regenerate activated by Enter and Space; weight <=500 and focus-visible ring verified |
| Existing features | full browser suite plus final chat regression suites retain feedback/source/proposal behavior |

Commands and actual output tails:

- Before component edits: `npm run test:component`, `component-baseline.log`: 55 files, 347 tests passed.
- `npm test`, `unit.log`: 149 files, 1,911 tests passed.
- `PUBLIC_CONVEX_URL=https://placeholder.convex.cloud npm run check`, `check-final.log`: zero errors and zero warnings after final layout/test changes.
- `npm run test:component`, `component-full.log`: 56 files, 368 tests passed. This run preceded the final shared Copy/Regenerate row layout and the final two pending-mutation tests.
- After those final changes: `npm run test:component -- src/lib/components/chat/RegenerateTurn.component.test.ts src/lib/components/chat/ChatFeedback.component.test.ts`, `component-chat-final.log`: 2 files, 46 tests passed (23 regeneration and 23 feedback tests).
- `git diff --check`: exit 0, no output.
- `git diff --name-only -- convex`: no output. No Convex production or generated edits.

Browser evidence: `regenerate-after.png`, captured by the real completed-turn keyboard test and inspected directly. Regenerate shares the Copy action row; original transcript and feedback remain visible.

Expected error-console entries come from intentional rejected-send fixtures. Browser suites retain existing `derived_inert` warnings.

No implementation scope left incomplete. Final native story status, review, commit, and any parent final gate reruns are owned by the parent workflow. No deferred-work ledger was edited.

Parent verification of final implementation: `npm run test:component` passed 56 files / 370 tests; `npm test` passed 149 files / 1,911 tests; `PUBLIC_CONVEX_URL=https://placeholder.convex.cloud npm run check` found 0 errors / 0 warnings. Logs: component-parent-final.log, unit-parent-final.log, check-parent-final.log. Parent inspected regenerate-after.png and actual source/test diff. Every matrix row maps to a passing executed case listed above.


## Review patch acceptance (latest working tree)

Parent-requested patches stay within the unchanged intent contract:

1. Empty durable turns render after their exact prompt in the message loop. The trailing duplicate rendering was removed. Browser cases `retains an earlier failed/completed turn without an assistant at its prompt position` use distinct first and second prompts, assert action DOM order, retain the original empty turn after later answers arrive, and assert each historical action's precise content.
2. `pendingRegenerationByThread` holds the successful response's message ID until that exact user prompt or durable turn appears. The rapid-activation test now verifies the response/publication gap, rejected extra activation, actual appended prompt/answer publication, retained old/new transcript, and regeneration of the new turn.
3. Offscreen historical retry exposes `Return to original conversation` instead of Retry. Returning navigates without sending or clearing the unrelated draft. Retry stays disabled through the target timing's loading and running states; after completion it sends the original intent to the observed original thread. A successful in-flight regeneration also checks the selected thread before scrolling.
4. Regeneration requires loaded messages and fresh, resolved durable timing. Partial-success snapshots with loading/running timing expose no action; resolved empty timing retains legacy terminal-message support.
5. Real tool-only parts are covered. Desktop tests use actual Tab navigation, Enter/Space, computed action-row opacity, `:focus-visible`, and computed focus ring. The combined preservation case verifies answer-only clipboard content, proposal wording/refinement availability, saved feedback, and Brain source chips after regeneration without applying proposals. `regenerate-keyboard-after.png` was directly inspected and shows the visible ring/action row.
6. Parameterized durable queued/running-only cases keep the completed historical control disabled even though the other assistant snapshot says success, then enable it after durable completion.

Final review verification:

- `npm test`: 149 files / 1,911 tests passed (`review-unit-final.log`).
- `PUBLIC_CONVEX_URL=https://placeholder.convex.cloud npm run check`: zero errors / zero warnings (`review-check-final.log`).
- Full browser run before the final selector correction: 55 files passed / 1 failed, 375 tests passed / 1 failed (`review-full-before-selector-fix.log`). The only failure was the newly added preservation test selecting the combined string `Worked · 1 suggestion`, while TurnTrace renders separate text elements. The selector was corrected to the visible `Worked` element.
- After that test-only correction: `npm run test:component -- src/lib/components/chat/RegenerateTurn.component.test.ts`: all 29 tests passed (`review-focused-pass.log`).
- `git diff --check`: exit 0; no output. `git diff --name-only -- convex`: no output.

The parent requested ownership of the canonical final full-gate rerun. A just-started redundant full browser rerun was terminated on that direction; it is not counted as acceptance evidence. No implementation work remains in this patch batch. Parent owns final full gates, triage/status, and commit.

Final parent post-review verification: final-components.log records 56 files / 376 browser tests passed; final-unit.log records 149 files / 1,911 tests passed; final-check.log records zero errors and warnings. All 29 regeneration cases ran, including each original matrix row and the review regression cases. No skipped cases count as evidence. `git diff --check` passed.

Reviewed implementation commit: `3b6f64f76d059568e4fe228f2cc278cc027bd897`. The following evidence-only commit records this canonical identifier and removes terminal blank lines from retained command logs for whitespace validation. Test output content is otherwise unchanged.


## Follow-up review, 2026-09-05

Invocation implementation revision: `18f975cbec3837e17033cb20548d095c6c1e7c82`.
Four reviewers examined the full change from `1fd71dcfc63e9c7a7ba083ae646ff1ad8486c4c5`: blind, edge-case, verification-gap, and intent alignment. The explicit contract remains stored-text replay through the existing frontend mutation. Browser transport fixtures establish UI behavior and exact requests; they do not establish a live model response.

Pre-patch gates passed: 376 component tests, 1,911 unit tests, and zero check errors/warnings. Logs: `followup-component-baseline.log`, `followup-unit-baseline.log`, `followup-check-baseline.log`.

Reproductions:

- `npm run test:component -- src/lib/components/chat/RegenerateTurn.component.test.ts`: three publication-gap cases failed before production changes (`followup-publication-red.log`).
- `npm run test:component -- src/lib/components/chat/RegenerateQueryState.component.test.ts`: three research-readiness cases failed before the readiness guard (`followup-query-red.log`). That run also exposed a test-only queued-label mismatch, corrected to the actual `Starting…` label.

Additional acceptance mapping:

| Behavior | Executed browser case |
| --- | --- |
| Composer/research mutation resolves before subscription publication | Parameterized pending-operation cases in `RegenerateTurn.component.test.ts` |
| Regeneration followed by preserved composer draft activation | `blocks composer activation after regeneration until its durable turn is published` |
| Pending send outside message pagination; successful navigation | `reconciles a pending send outside the loaded messages after in-flight navigation` |
| Staggered prompt and durable queued/completed publication | Composer publication case and composer activation case |
| Retained stale/failed timing disables retry and hides action, then recovers | Parameterized timing cases in `RegenerateQueryState.component.test.ts` |
| Loading/stale/failed research query and active research | Parameterized research cases in `RegenerateQueryState.component.test.ts` |
| Queued/running/aborted durable turn without assistant row | Parameterized unanswered cases in `RegenerateQueryState.component.test.ts` |
| Contextual accessible descriptions | Computed accessible-description assertions in both regeneration suites |

Deferred-work ledger bytes match the invocation HEAD. Read-only hash evidence: `followup-ledger-preservation.json`. No ledger entries were edited or staged.

Initial final gate: 386 component tests passed and 1,911 unit tests passed. Type checking found one unsupported `aria-description` prop on ActionButton (`followup-check-before-a11y-fix.log`). Corrected to standard `aria-describedby` with a unique hidden description, and upgraded assertions to computed accessible descriptions. Browser and type gates were rerun after that correction. Unit/backend source did not change after the passing unit gate.

Residual risk: the existing backend turn query returns at most 200 records. If more than that displaces an unobserved pending identifier, the local guard fails closed until remount. This patch reconciles ordinary message pagination without changing backend APIs or inferring unobserved terminal status. No live model/provider run was performed.

The accessible-description rerun passed 384/386 cases; two assertions expected literal newlines, whereas the browser normalizes descriptive whitespace. Expected text was normalized without changing production behavior, then the browser suite was rerun. The type check passed with zero errors/warnings after aria-describedby.

Final gates: `npm run test:component` passed 57 files / 386 tests (`followup-components-final.log`); `npm test` passed 149 files / 1,911 tests (`followup-unit-final.log`); `PUBLIC_CONVEX_URL=https://placeholder.convex.cloud npm run check` found zero errors and warnings (`followup-check-final.log`). `git diff --check` passed. Directly inspected the refreshed normal and keyboard screenshots. No Convex production/generated changes or ledger changes were present.

Reviewed follow-up implementation commit: `8912804a99d9746c6fe3ed3c26f78a0e6760d4d9`. This evidence-only follow-up records the canonical identifier and removes trailing whitespace from retained logs; command result content is unchanged.


## Third review, 2026-09-05

Invocation revision: `8db7e0326828a2aaefe52a6687875d0a6535fde3`. The invocation already omitted the prior Auto Run Result section; the current pass regenerates that section as required by build-auto.

Baseline gates: 57 files / 386 browser tests; 149 files / 1,911 unit tests; zero check errors and warnings. Exact logs: `third-review-components.log`, `third-review-unit.log`, `third-review-check.log`. Four independent review layers ran against the complete baseline-to-working-tree diff.

The earlier acceptance entry naming `pendingRegenerationByThread` describes a superseded implementation. Current behavior uses `pendingSendByThread`, retaining the exact returned prompt identifier until its durable turn is completed, failed, or aborted. Prompt publication alone does not release this guard.

Additional acceptance mapping:

| Behavior | Browser evidence |
| --- | --- |
| Failed/stopped regeneration releases composer and historical controls | Parameterized `releases the shared send guard when regeneration becomes %s`; preserved draft is actually sent after terminal publication |
| Stop before assistant exists | Aborted branch clicks Stop and asserts original thread plus regenerated order |
| Rejection arriving after navigation | `preserves the visible conversation and draft when an offscreen regeneration rejects`; actual return/retry preserves exact historical request |
| Pending send beyond two capped pages | `RegenerateLimits.component.test.ts` walks 200-record query windows, remains guarded while matching turn runs, releases on terminal publication |
| Capped timing cannot establish legacy eligibility | Newest-200 test with older loaded assistant and missing/aborted timing |
| Research absent from newest 20 summaries | Direct session observation through completed, failed, canceled, and missing outcomes |
| Concise accessible description and full replay | Long prompt test asserts bounded description and unchanged full mutation content |

Focused terminal/query suites passed 42 cases after updating two existing description expectations for intentional truncation. `third-review-terminal-tests.log` retains the passing output. No historical baseline screenshot was captured during this follow-up review; existing normal and keyboard browser images document the final action presentation. The refreshed normal image was directly inspected.

Ledger preservation is checked by byte hash against the invocation revision in `third-review-ledger-preservation.json`; no ledger status or entry is edited or staged. No live model/provider generation is claimed.

The seven new limit/description cases failed against invocation production revision `8db7e0326828a2aaefe52a6687875d0a6535fde3`, then all seven passed after restoring the reviewed patch. Exact reproduction/pass logs: `third-review-limits-red.log` and `third-review-limits-green.log`. Composer availability and preserved draft are asserted alongside regeneration recovery.

Final parent gates passed: `npm run test:component`, 58 files / 396 tests (`third-review-components-final.log`); `npm test`, 149 files / 1,911 tests (`third-review-unit-final.log`); `PUBLIC_CONVEX_URL=https://placeholder.convex.cloud npm run check`, zero errors/warnings (`third-review-check-final.log`). All three processes exited 0. Normal and keyboard screenshots were inspected directly. No Convex production/generated files changed. `git diff --check` passed.

Reviewed third-pass implementation commit: `587a7561d8bbc3d37bb2bfc30dc3216313ff5007`. This evidence-only follow-up records the canonical revision after all final gates passed.
