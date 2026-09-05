# Story 7 implementation evidence

Baseline revision: `438edf107a85d443480a3027fe8d19e0f9195106` (also `baseline.txt`).
Implementation verification revision: the working tree based on that same revision, before native review/finalization. `implementation.sha256` pins the four implementation/test files verified here. A final commit revision must be appended by native finalization; no implementation commit is claimed by this handoff.

The specification and both frontmatter context files were loaded. The implementation is limited to the panel, the persisted-message acknowledgement helper, the new component suite, and one intentional assertion update in the existing regeneration suite. No Convex production/generated files or native ledger bytes were changed.

## Acceptance and matrix coverage

All test names below are in `src/lib/components/chat/OptimisticSend.component.test.ts` unless another file is named. These tests mount the real `AgentChatPanel` and run real `createUIMessages`; only the external Convex transport/auth responses use the existing reactive fixture.

| Matrix / criterion | Test evidence |
| --- | --- |
| Immediate send, new and existing thread | `immediately renders a new/existing conversation send without inventing a durable turn`: unresolved mutation, visible local row, composer consumption, preserved newer draft, exact persisted handoff |
| Handoff in either order, repeated historical content | `reconciles exact ids with mutation-first/publication-first and repeated historical content`: identical historical text never acknowledges; publication before response retains local until returned identity is known |
| Failure and keyboard Retry | `keyboard retry captures highlight-only/text-and-highlight and ignores replacement composer context`: Tab navigation, focus-visible, Enter, rapid repeated activations, exact original args, unchanged logical key, eventual durable handoff |
| Captured refinement | `captures refinement before edits and retries the original proposal id`: captured refineProposalId, hidden metadata, later draft survives |
| Existing-thread navigation and failure | `keeps an existing conversation send scoped after navigation and resolve/reject`: no local row or error leak, completion cannot steal selection/draft, same id on another thread cannot acknowledge |
| Not-yet-created conversation navigation | `retains failed unsaved conversations across another New conversation and retries with newThread`; `does not steal a newer unsaved conversation when the first send creates its thread`: unique draft scopes and reachable retry origin |
| Repeated logical sends | `keeps separate keys for repeated failed sends and retries only the selected bubble`: distinct request keys for identical content, exact one-row reconciliation |
| Historical resend | `historical resend shows its stored excerpt without consuming current draft or research`, plus all existing RegenerateTurn/RegenerateQueryState/RegenerateLimits tests |
| Durable behavior and pagination | `keeps pagination and active-reply controls driven by durable rows beside a local request`: only durable order range enters timing, non-user id cannot acknowledge, actual Stop addresses durable order 11 |
| Publication guard independent of local row | Immediate-send tests plus unchanged regeneration publication/terminal-state tests; local disappearance never clears pendingSendByThread |
| Research | `starts research without a local bubble and retains its research error surface` |
| Existing proposals, feedback, sources, uploads and research safeguards | Complete Chromium suite, including existing regeneration preservation, ChatFeedback, FeedbackSubscription and upload suites |

## Visual inspection

- `optimistic-before.png`: captured from the baseline real panel with an unresolved send. The empty-state starters still occupy the transcript, the draft remains in the composer, and no user bubble appears.
- `optimistic-after.png`: same delayed-send scenario after implementation. The right-aligned user bubble and Sending status are visible immediately and the composer is empty.
- `retry-highlight-only.png` and `retry-text-and-highlight.png`: failed bubble retains the original excerpt and optional text. Inline error and keyboard-focused Retry are visible, while the composer contains a replacement draft/context. Focus outline is visible and the tested font weight is at most 500.
- All four images were opened and visually inspected using the local image viewer. These are real rendered-panel screenshots, not generated mockups.

## Commands and results

Baseline canonical component and nonbrowser runs were completed by the parent before panel edits. Baseline delayed-send capture and all final runs were executed in this implementation session.

Command: `npm run test:component`

Full output: `baseline-component.txt`

```text
Command: npm run test:component
Exit code: 0
 Test Files  58 passed (58)
      Tests  396 passed (396)
   Start at  00:52:23
   Duration  80.26s (transform 0ms, setup 1.54s, import 23.51s, tests 26.20s, environment 0ms)
```

Command: `npm test`

Full output: `baseline-unit.log`

```text

 RUN  v4.1.10 /Users/johnnynguyen/Documents/Repos/Banhall-bmad-learn-chat/.bmad-loop/runs/20260904-133944-0158/worktrees/7


 Test Files  149 passed (149)
      Tests  1911 passed (1911)
   Start at  00:55:38
   Duration  30.91s (transform 9.37s, setup 0ms, import 17.45s, tests 18.64s, environment 5.48s)

```

Command: `npm run test:component -- src/lib/components/chat/OptimisticSend.component.test.ts`

Full output: `baseline-optimistic.txt`

```text
 RUN  v4.1.10 /Users/johnnynguyen/Documents/Repos/Banhall-bmad-learn-chat/.bmad-loop/runs/20260904-133944-0158/worktrees/7

12:56:17 AM [vite-plugin-svelte] no Svelte config found at /Users/johnnynguyen/Documents/Repos/Banhall-bmad-learn-chat/.bmad-loop/runs/20260904-133944-0158/worktrees/7 - using default configuration.

 Test Files  1 passed (1)
      Tests  1 passed (1)
   Start at  00:56:17
   Duration  4.89s (transform 0ms, setup 996ms, import 2.10s, tests 391ms, environment 0ms)

```

Command: `npm run test:component -- src/lib/components/chat/OptimisticSend.component.test.ts src/lib/components/chat/RegenerateTurn.component.test.ts`

Full output: `component-initial.txt`

```text

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/2]⎯


 Test Files  1 failed | 1 passed (2)
      Tests  2 failed | 46 passed (48)
   Start at  01:00:36
   Duration  47.13s (transform 0ms, setup 661ms, import 1.43s, tests 43.50s, environment 0ms)

```

Command: `npm run test:component`

Full output: `component-final.txt`

```text
1:03:20 AM [vite] (client) [console.warn] https://svelte.dev/e/derived_inert
1:03:23 AM [vite] (client) [console.warn] https://svelte.dev/e/derived_inert
1:03:24 AM [vite] (client) [console.warn] https://svelte.dev/e/derived_inert

 Test Files  59 passed (59)
      Tests  411 passed (411)
   Start at  01:02:19
   Duration  66.24s (transform 0ms, setup 1.49s, import 23.44s, tests 35.93s, environment 0ms)

```

Command: `npm test`

Full output: `unit-final.txt`

```text

 RUN  v4.1.10 /Users/johnnynguyen/Documents/Repos/Banhall-bmad-learn-chat/.bmad-loop/runs/20260904-133944-0158/worktrees/7


 Test Files  149 passed (149)
      Tests  1911 passed (1911)
   Start at  01:02:31
   Duration  35.79s (transform 10.95s, setup 0ms, import 19.93s, tests 19.49s, environment 5.90s)

```

Command: `PUBLIC_CONVEX_URL=https://placeholder.convex.cloud npm run check`

Full output: `check-final.txt`

```text

> banhall-app@0.1.0 check
> svelte-kit sync && svelte-check --tsconfig ./tsconfig.json

Loading svelte-check in workspace: /Users/johnnynguyen/Documents/Repos/Banhall-bmad-learn-chat/.bmad-loop/runs/20260904-133944-0158/worktrees/7
Getting Svelte diagnostics...

svelte-check found 0 errors and 0 warnings
```

Command: `git diff --check`

Full output: `diff-check.txt`

```text
(empty output; exit 0)
```

Command: `shasum -a 256 -c .audit/story-7/ledger-baseline.sha256`

Full output: `ledger-final.txt`

```text
_bmad-output/implementation-artifacts/deferred-work.md: OK
```

The initial targeted run passed all 14 new tests and failed two existing historical assertions because the intended optimistic resend adds a second user bubble. The assertion now expects two. No durable guard expectation was removed. A fifteenth new test added pagination and durable Stop coverage; the final canonical suite passed all 411 tests across 59 files. The suite emits existing Svelte runtime warnings in unrelated fixtures; the required Svelte static check reports zero errors and warnings.

## Native ledger and historical artifacts

`ledger-baseline.sha256` records SHA-256 `2243500bc083062ffd8376da8c633d263617456cd52c857f6ba134353bbc8d85` for `_bmad-output/implementation-artifacts/deferred-work.md`. The final verification returned `OK` (`ledger-final.txt`). No ledger write, revert or staging command was run.

The canonical component run refreshed `.audit/story-6/regenerate-after.png`. It was restored solely from its tracked HEAD blob with `git show HEAD:.audit/story-6/regenerate-after.png > .audit/story-6/regenerate-after.png`; subsequent `git status --short` showed no historical audit modification.

## Deliberate limits

Local request keys only guard repeated UI activation. They are not sent to the backend and do not provide backend idempotency after an ambiguous transport failure. Pending/failure rows are component-local and do not survive reload. Existing shared send and research guards are preserved. No new backend authority or workflow transition was needed.


## Review patch verification (2026-09-05)

All eight accepted findings in `review-triage.md` were patched together. The intent contract was not changed. The implementation remains an uncommitted working tree based on `438edf107a85d443480a3027fe8d19e0f9195106`; `implementation.sha256` now identifies the reviewed final implementation, while `implementation-initial.sha256` preserves the pre-review file hashes. Native finalization still owns recording the final commit revision.

| Accepted finding | Patch and real-panel regression |
| --- | --- |
| 1. Sibling sends in an unresolved draft scope | `AgentChatPanel.svelte:274` shares a draft-scope guard with handler/composer/starters. `blocks sibling sends in an unsaved conversation until retry succeeds or its failure is dismissed` asserts Enter cannot enqueue a second request, retry preserves original arguments, and dismissal permits a replacement. Existing-thread repeated failures remain supported. |
| 2. Offscreen insertion | `AgentChatPanel.svelte:304` waits for the inserted row to render and scrolls only if its originating scope is still selected. `immediately reveals a local send in a long bounded transcript while transport remains unresolved` uses 80 durable rows, a 550px bounded container, an actual upward scroll and unresolved transport; it checks the bubble's rectangle against the viewport. |
| 3. Failed row ordering | The presentation-only projection at `AgentChatPanel.svelte:278` interleaves local rows using captured durable anchors. `keeps failed A before a later durable B prompt and answer without synthetic timing` checks actual DOM order and the unchanged durable query window. |
| 4. Dismiss / abandon | `AgentChatPanel.svelte:300` removes only the selected failed request. `dismisses only the chosen failed request while preserving another failure and composer draft` and `dismisses a displaced historical failure without navigation or another mutation` verify local/displaced behavior and no transport side effect. |
| 5. Long previews | `AgentChatPanel.svelte:295` collapses whitespace and caps preview length; the menu span truncates inside its bounded container. `bounds long multiline prompt/highlight labels and distinguishes identical unsaved conversations` checks the rendered menu has no horizontal overflow and accessible labels stay bounded. |
| 6. Identical unsaved conversation labels | The same tests create two failed unsaved conversations with identical long content, then select each by its stable visible conversation ordinal and verify the correct request key is shown. |
| 7. Keyboard continuity | `AgentChatPanel.svelte:1110` keeps Retry mounted while its request is transmitting. `retains keyboard focus across Retry and repeated failure, then hands it to composer on success` uses Tab and Enter and asserts actual activeElement at each transition. `does not steal focus on retry completion after move-focus/navigate` covers deliberate movement/navigation. |
| 8. Historical screenshots | `RegenerateTurn.component.test.ts:43` and `:50` now write captures to ignored `__screenshots__` paths. Both historical images were restored from tracked HEAD blobs and compared byte-for-byte after the canonical run; results are in `historical-images-final.txt`. |

The final optimistic component suite contains 25 cases (15 original and 10 new review regressions). Together with 34 existing regeneration cases, the targeted run passes 59 tests. The complete canonical suite now passes 421 tests across 59 files.

Additional visual inspection: `optimistic-scrolled-after.png` shows the new local bubble visible below the last historical turn while the composer remains within the bounded panel. Updated `retry-text-and-highlight.png` shows the original excerpt, error, focused Retry and restored Dismiss action, with the replacement draft/context still present. Both were opened and inspected after the patches.

### Review commands and actual output tails

Command: `npm run test:component -- src/lib/components/chat/OptimisticSend.component.test.ts src/lib/components/chat/RegenerateTurn.component.test.ts`

Full output: `review-component-initial.txt`

```text
 RUN  v4.1.10 /Users/johnnynguyen/Documents/Repos/Banhall-bmad-learn-chat/.bmad-loop/runs/20260904-133944-0158/worktrees/7

1:14:03 AM [vite-plugin-svelte] no Svelte config found at /Users/johnnynguyen/Documents/Repos/Banhall-bmad-learn-chat/.bmad-loop/runs/20260904-133944-0158/worktrees/7 - using default configuration.

 Test Files  2 passed (2)
      Tests  59 passed (59)
   Start at  01:14:03
   Duration  30.76s (transform 0ms, setup 550ms, import 1.06s, tests 27.75s, environment 0ms)

```

Command: `npm run test:component`

Full output: `review-component-final.txt`

```text
1:15:53 AM [vite] (client) [console.warn] https://svelte.dev/e/derived_inert
1:15:57 AM [vite] (client) [console.warn] https://svelte.dev/e/derived_inert
1:15:57 AM [vite] (client) [console.warn] https://svelte.dev/e/derived_inert

 Test Files  59 passed (59)
      Tests  421 passed (421)
   Start at  01:14:51
   Duration  67.24s (transform 0ms, setup 1.22s, import 18.34s, tests 43.05s, environment 0ms)

```

Command: `npm test`

Full output: `review-unit-final.txt`

```text

 RUN  v4.1.10 /Users/johnnynguyen/Documents/Repos/Banhall-bmad-learn-chat/.bmad-loop/runs/20260904-133944-0158/worktrees/7


 Test Files  149 passed (149)
      Tests  1911 passed (1911)
   Start at  01:14:51
   Duration  35.92s (transform 12.40s, setup 0ms, import 20.76s, tests 20.20s, environment 5.53s)

```

Command: `PUBLIC_CONVEX_URL=https://placeholder.convex.cloud npm run check`

Full output: `review-check-final.txt`

```text

> banhall-app@0.1.0 check
> svelte-kit sync && svelte-check --tsconfig ./tsconfig.json

Loading svelte-check in workspace: /Users/johnnynguyen/Documents/Repos/Banhall-bmad-learn-chat/.bmad-loop/runs/20260904-133944-0158/worktrees/7
Getting Svelte diagnostics...

svelte-check found 0 errors and 0 warnings
```

Command: `git diff --check`

Full output: `review-diff-check.txt`

```text
(empty output; exit 0)
```

Command: `shasum -a 256 -c .audit/story-7/ledger-baseline.sha256`

Full output: `review-ledger-final.txt`

```text
_bmad-output/implementation-artifacts/deferred-work.md: OK
```

### Exact historical artifact restoration

Executed only for these two known incidental images:

```sh
git show HEAD:.audit/story-6/regenerate-keyboard-after.png > .audit/story-6/regenerate-keyboard-after.png
git show HEAD:.audit/story-6/regenerate-after.png > .audit/story-6/regenerate-after.png
```

After the canonical suite, Python read each image's working-tree bytes and compared them with `subprocess.check_output(['git', 'show', f'HEAD:{path}'])`, asserting equality before recording SHA-256. Actual output:

```text
.audit/story-6/regenerate-keyboard-after.png: matches HEAD; SHA-256 d8515ce64db08511883c210476184baf32fdf44363e62fc09b1276fe6daa2678
.audit/story-6/regenerate-after.png: matches HEAD; SHA-256 459e690ee91a1afc889911e98f4a51b6fa93eda10d77b151d3caa4b722b7ce22
```

The final `git status --short` contains no historical audit changes. The native deferred-work ledger was never edited, reverted or staged; its original hash still verifies `OK`.

### Residual presentation limitation

If the persisted prompt is published before the mutation response provides its identity, both the local row and durable prompt can temporarily appear. The publication-first test explicitly records this intermediate state and proves the local row disappears once the exact returned message ID is known. Removing that temporary duplication earlier would require text guessing or a backend/API change, both prohibited by the contract. This is not an exactly-once presentation or backend-idempotency promise. Local failure state still does not survive reload.

## Parent independent final verification

Parent inspected the actual implementation diff, all 25 optimistic component cases, and the baseline, immediate-send, keyboard Retry and scrolled-transcript screenshots. All nine matrix rows have executed passing coverage.

Command: `npm run test:component`; exit 0. Output: `final-component-parent.txt`.

```text
1:19:06 AM [vite] (client) [console.warn] https://svelte.dev/e/derived_inert
1:19:06 AM [vite] (client) [console.warn] https://svelte.dev/e/derived_inert

 Test Files  59 passed (59)
      Tests  421 passed (421)
   Start at  01:17:55
   Duration  71.86s (transform 0ms, setup 1.12s, import 24.25s, tests 42.19s, environment 0ms)

```

Command: `npm test`; exit 0. Output: `final-unit-parent.txt`.

```text
 RUN  v4.1.10 /Users/johnnynguyen/Documents/Repos/Banhall-bmad-learn-chat/.bmad-loop/runs/20260904-133944-0158/worktrees/7


 Test Files  149 passed (149)
      Tests  1911 passed (1911)
   Start at  01:17:55
   Duration  40.59s (transform 13.91s, setup 0ms, import 24.02s, tests 21.41s, environment 6.07s)

```

Command: `PUBLIC_CONVEX_URL=https://placeholder.convex.cloud npm run check`; exit 0. Output: `final-check-parent.txt`.

```text

> banhall-app@0.1.0 check
> svelte-kit sync && svelte-check --tsconfig ./tsconfig.json

Loading svelte-check in workspace: /Users/johnnynguyen/Documents/Repos/Banhall-bmad-learn-chat/.bmad-loop/runs/20260904-133944-0158/worktrees/7
Getting Svelte diagnostics...

svelte-check found 0 errors and 0 warnings
```

Parent also ran `git diff --check` (exit 0, empty output) and `shasum -a 256 -c .audit/story-7/ledger-baseline.sha256` (exit 0, native ledger OK). No ledger staging is required.

## Final version-control anchor

Verified product-code commit: `38c2d14312d0f8b3701bbdaf21bfd23606450c51`. This exact commit contains the four implementation/test files exercised by final parent commands above. Story/evidence finalization follows in a separate documentation commit; no push was performed.

Final audit packaging removes surplus terminal blank lines from command transcripts; diagnostic text is unchanged. The original review input is archived losslessly as `review.diff.gz` (decompress to inspect).

## Follow-up review and verification, 2026-09-05

Invocation HEAD: `3dccc3c4be72d3ff073a0f85030a8e31a9cfe887`. Existing done status routed to a fresh four-layer review. The invocation already removed the prior Auto Run Result; this run wrote the new result. Product code initially matched that HEAD. No project-context.md or workspace agent-transcripts file was found. Trail checks use actual command logs, diff and this session's observed tool results; no unavailable transcript audit is claimed.

All four required review layers completed before triage. Details: `followup-triage.md`. Patches: 3 medium and 1 low; score 10, follow-up recommended. No existing deferred-work ledger entry was changed or staged.

Initial canonical checks passed (421 browser tests, 1,911 unit tests, zero Svelte errors/warnings); logs are `followup-component.txt`, `followup-unit.txt`, `followup-check.txt`.

Three added cases reproduced keyboard focus loss on first Enter send, focus loss after last failure dismissal, and long-text overflow (6245px versus 320px). Run `npm run test:component -- src/lib/components/chat/OptimisticSend.component.test.ts` before product patches: exit 1, 3 failed / 25 passed, `followup-regressions-before.txt.gz`. The retained final three tests reproduce those failures using invocation HEAD's AgentChatPanel implementation. After patches, the same command exited 0 with all 28 cases passing (`followup-regressions-after.txt`). The long-text case also verifies the accessible prompt description. Runtime browser screenshots `followup-overflow-before.png` and `followup-overflow-after.png` were inspected: clipping before, contained wrapped text and visible actions after. The normal immediate-send and scrolled screenshots were refreshed and inspected during this pass.

Final required commands, all exit 0:

Command: `npm run test:component`. Full output: `followup-final-component.txt`.

```text
1:28:48 AM [vite] (client) [console.warn] https://svelte.dev/e/derived_inert
1:28:48 AM [vite] (client) [console.warn] https://svelte.dev/e/derived_inert

 Test Files  59 passed (59)
      Tests  424 passed (424)
   Start at  01:27:16
   Duration  93.39s (transform 0ms, setup 2.03s, import 42.58s, tests 42.46s, environment 0ms)
```

Command: `npm test`. Full output: `followup-final-unit.txt`.

```text
 RUN  v4.1.10 /Users/johnnynguyen/Documents/Repos/Banhall-bmad-learn-chat/.bmad-loop/runs/20260904-133944-0158/worktrees/7


 Test Files  149 passed (149)
      Tests  1911 passed (1911)
   Start at  01:27:15
   Duration  63.33s (transform 19.99s, setup 0ms, import 35.75s, tests 34.77s, environment 7.82s)
```

Command: `PUBLIC_CONVEX_URL=https://placeholder.convex.cloud npm run check`. Full output: `followup-final-check.txt`.

```text
> banhall-app@0.1.0 check
> svelte-kit sync && svelte-check --tsconfig ./tsconfig.json

Loading svelte-check in workspace: /Users/johnnynguyen/Documents/Repos/Banhall-bmad-learn-chat/.bmad-loop/runs/20260904-133944-0158/worktrees/7
Getting Svelte diagnostics...

svelte-check found 0 errors and 0 warnings
```

`followup-source.sha256` pins the four verified product/test files. `shasum -a 256 -c .audit/story-7/ledger-baseline.sha256` returned OK (`followup-ledger.txt`). Browser transport remains controlled; no live backend/provider, exactly-once publication-first presentation, reload persistence or backend idempotency is claimed.

### Trail audit corrections

A separate trail audit was requested using model override `gpt-5.6-sol`. It found weak review-completion and ledger-state evidence pointers; no code-validation flags. `followup-reviewers.md` now retains all four returned outputs, `followup-review.diff.gz` archives their diff input, and `followup-ledger.txt` retains both checksum success and empty working/staged ledger differences. Append-only decision rows supersede the earlier weaker pointers. Exact before-regression output is compressed losslessly as `followup-regressions-before.txt.gz`; decompress to inspect. No workspace transcript was available, so transcript-to-row reconstruction remains a stated limit.

### Follow-up verified revision

Verified product and test revision: `d3601a0ab090b51d6475fa76db5f79bd9e1fb8b4`. This commit contains all four files pinned by `followup-source.sha256`. The final canonical commands above exercised those exact bytes. `git diff --check` and staged `git diff --cached --check` passed. The cross-model trail re-audit reported no remaining flags in supplied artifacts after the evidence corrections; the unavailable workspace transcript remains a validation limit. Final documentation anchoring follows in a separate commit. No push was performed.

## Second follow-up review: 2026-09-05

Invocation revision: `30072510e6f82c74c0ab18b56b17608926a5f79a`.
Verified implementation commit: `6db7560ac132cb7f10ef71dbb1fd6b3f851bcd79`. Final source bytes are recorded in `second-source.sha256`. The following documentation commit records evidence only.

The four review layers completed in this turn; findings and individual dispositions are in `second-triage.md`. Four patches, no deferred entries, thirteen rejected findings. Score 8 recommends another review. Exact review input is in `second-review.diff.gz`.

Acceptance evidence:
- Immediate bubble and exact-id handoff: complete 32-case `OptimisticSend.component.test.ts` passes, including delayed mutation, both publication orders and repeated content.
- Keyboard retry and captured arguments: same suite exercises keyboard activation, repeated activation, focus retention, original highlight/refinement, navigation and historical semantics.
- Matrix and preserved features: canonical full Chromium suite passes 59 files / 428 tests; nonbrowser suite passes 149 files / 1,911 tests; check reports zero errors and warnings.
- New regressions: targeted command below failed four cases against invocation product code before fixes. Durable handoff overflow was 6245px versus a 320px log; displaced alert overflow was 4490px versus a 302px container; empty and whitespace errors lacked fallback text. Compressed actual failure log: `second-regressions-before.txt.gz`. The same four cases now pass within the 32-case suite (`second-regressions-after.txt`).
- Parent inspected actual `second-overflow-before.png` and `second-overflow-after.png`. Before: unbroken error clips horizontally and Return/Dismiss are outside view. After: error wraps and both controls are visible within the narrow panel. These are real rendered-panel Chromium captures with controlled transport, not live provider evidence.
- Incidental recaptures of five historical story-7 screenshots were restored to their invocation HEAD bytes. New before/after captures are retained separately. No ledger restore or write occurred.

Commands and actual output tails:

```text
npm run test:component -- src/lib/components/chat/OptimisticSend.component.test.ts -t 'exact durable handoff|displaced historical error|blank transport errors'
Exit 1: 4 failed, 28 skipped (before product patch)

npm run test:component -- src/lib/components/chat/OptimisticSend.component.test.ts
Exit 0: 1 file passed, 32 tests passed

npm run test:component
Test Files  59 passed (59)
      Tests  428 passed (428)
   Start at  01:38:13
   Duration  68.43s (transform 0ms, setup 1.53s, import 14.11s, tests 47.78s, environment 0ms)
npm test
Test Files  149 passed (149)
      Tests  1911 passed (1911)
   Start at  01:37:52
   Duration  31.13s (transform 8.21s, setup 0ms, import 15.70s, tests 18.55s, environment 4.80s)
PUBLIC_CONVEX_URL=https://placeholder.convex.cloud npm run check
svelte-check found 0 errors and 0 warnings

git diff --check
Exit 0, no output

shasum -a 256 -c .audit/story-7/ledger-baseline.sha256
_bmad-output/implementation-artifacts/deferred-work.md: OK
```

Full command logs: `second-baseline-*.txt`, `second-final-*.txt`, and `second-regressions-*.txt` (before is gzip compressed). All successful commands exited 0. The component suite emits existing Svelte derived_inert warnings; no test failed. Ledger SHA-256 remains `2243500bc083062ffd8376da8c633d263617456cd52c857f6ba134353bbc8d85`.

Residual limits: controlled transport does not establish deployed backend/provider behavior. Publication before mutation identity can briefly duplicate the prompt. Local failures do not survive reload and request keys do not provide backend idempotency. Native orchestrator acceptance remains separate from local completion.
