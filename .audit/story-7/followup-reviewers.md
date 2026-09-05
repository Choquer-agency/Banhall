# Follow-up reviewer outputs

These outputs were returned by four context-free subagents in this invocation. All used the parent capability without overrides. Raw diff input: `followup-review.diff.gz`. The fourth reviewer launched after a slot became available; triage began after that launch. The records below preserve returned findings; they are review opinions, not independently verified claims.

## blind

- `AgentChatPanel.svelte:1007` makes the first optimistic insertion switch between branches that each render a separate composer. Sending with Enter from an empty conversation therefore destroys the focused textarea immediately. Keep the composer mounted across this transition and test uninterrupted typing while transport remains pending.
- `AgentChatPanel.svelte:303` removes a failed row without transferring focus from its Dismiss button. Keyboard dismissal can leave focus on the document body, especially when dismissing the last row also recreates the composer. Restore focus deliberately and add a keyboard dismissal regression.
- `AgentChatPanel.svelte:687–733` retries an older failure using its original `afterOrder`. After successful conversation B, retrying failed A still displays A before B until durable publication suddenly relocates A after B. Define retry placement and test that complete sequence.
- `AgentChatPanel.svelte:484` returns to a displaced historical failure by changing selection only. It neither reveals the specific failed row nor focuses Retry. With substantial later history, the return action can leave the actionable failure outside the viewport.
- `AgentChatPanel.svelte:728` scrolls to the bottom on mutation completion even if the writer deliberately scrolled upward after the immediate optimistic reveal. Track subsequent user scrolling so a delayed response does not interrupt reading.
- `AgentChatPanel.svelte:1118` renders arbitrary error messages without word breaking or a width constraint. Long unbroken server error text can overflow the new inline bubble. Exercise narrow chat rails and long error strings, not only long conversation-menu previews.
- `AgentChatPanel.svelte:1123` gives every Retry button the identical accessible name, and each Dismiss action has the same ambiguity. Multiple failed requests are supported, so associate each action with its originating prompt using an accessible description.
- `AgentChatPanel.svelte:1439` adds unsaved conversation entries without an active-selection indicator. Selecting an unsaved conversation provides no menu feedback identifying the current conversation. Add selected styling and an accessible current-state indication.
- Existing-thread composer failures that arrive after navigation have no notification outside their hidden transcript. The implementation explicitly surfaces displaced historical failures but provides no corresponding failed-state cue on existing conversation menu entries. Add a scoped indicator that makes these failures discoverable.
- `OptimisticSend.component.test.ts` tests keyboard Retry using Enter only. Add Space activation, including a repeated activation while pending, to cover the second standard button activation path.
- `OptimisticSend.component.test.ts:427–432` bounds the menu preview but never checks the transcript containing the same 2,000-character unbroken prompt or highlight. Add a narrow-layout assertion for transcript overflow and continued accessibility of Retry and Dismiss.
- `.audit/story-7/baseline-optimistic.txt` records a one-test baseline run against a test file now replaced by 25 cases, but the baseline test source or reconstructable patch is not retained. Preserve that fixture or its exact patch so the claimed before-state capture can be reproduced.

## edge

[]

## verification

No verification gaps found.

## intent

I read the complete intent contract and diff. The diff implements the strongest identity-based reading of the contract. Two broader user-experience readings have narrower implementation or verification surfaces.

1. **Exact-identity handoff versus continuously singular presentation.**
   The most explicit reading requires a local bubble immediately and removal only after both the mutation’s returned identity and its exact persisted user row are observable in the originating thread. The diff implements this through `visibleLocalSends`, `hasPersistedMessage`, and reconciliation. A broader reading of “replace it” and “one durable user bubble remains” suggests uninterrupted presentation of one bubble per logical send. The publication-first test explicitly expects a temporary duplicate: historical matching text, the new durable prompt, and its local counterpart produce three visible matches before mutation resolution (`OptimisticSend.component.test.ts:78`). Thus identity correctness and eventual singular presentation are exercised; continuous singular presentation is not implemented. The contract’s exact-ID and unchanged-API constraints support the implemented reading.

2. **Conversation-scoped requests versus conversation-scoped composer storage.**
   The explicit reading protects pending/failed requests and prevents asynchronous completion from changing the newly selected conversation or clearing replacement input. The diff implements that using draft/thread scopes, captured arguments, and `isOriginVisible`. A broader reading of “its draft” and “new draft/context preserved” could imply independently retained composer drafts for each conversation. The diff retains one composer value rather than per-conversation draft storage. The unsaved-conversation retry test actually asserts that “Independent new chat draft” remains in the composer after returning to and retrying the earlier unsaved conversation. Tests establish protection from completion-time clearing, not independent draft ownership across navigation.

3. **Immediate DOM insertion versus immediate visibility.**
   “Writers lack immediate transcript confirmation” supports both inserting a row before mutation completion and bringing it into the visible transcript viewport. The diff implements both: local insertion precedes awaiting, and `revealRequest` waits for rendering before scrolling the originating conversation. The bounded, scrolled transcript test checks the actual bubble rectangle while transport remains unresolved. There is no surface mismatch here.

4. **Accessible captured retry and durable-feature preservation.**
   The diff implements request-key continuity, captured content/highlight/refinement/conversation arguments, guarded repeated activation, historical resend semantics, and separate research behavior. Tests exercise the actual panel, keyboard focus/Enter, rendered errors, recorded mutation arguments, durable timing-query arguments, and Stop. Local presentation rows remain separate from durable `messages`.

5. **Runtime behavior versus verification boundary.**
   The intent expectations concern writers using the application and real subscription arrival/navigation behavior. Changes live in `AgentChatPanel` and the persisted-page helper. New tests render those real components over controlled Convex/auth fixtures; pagination is exercised by replacing fixture rows, and publication order by resolving controlled promises and publishing fixture data. They establish panel behavior for those supplied states, rather than the third-party subscription lifecycle or deployed backend integration. Existing-feature preservation is additionally supported by recorded full-suite passes. This is a verification boundary, not evidence of a demonstrated production failure.

The diff contains no Convex production/generated or native ledger modification, and explicitly disclaims backend idempotency and reload persistence. No files were edited during this review.
