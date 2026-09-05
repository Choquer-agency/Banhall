---
title: 'Optimistic user bubble on send'
type: 'feature'
created: '2026-09-05'
status: 'done'
baseline_revision: '438edf107a85d443480a3027fe8d19e0f9195106'
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

**Problem:** Chat sends do not appear until the server subscription publishes the user message. Writers lack immediate transcript confirmation and an error attached to a failed send (CAP-6).

**Approach:** Render a local user bubble immediately, keyed by a client request id. Associate it with the mutation's returned message id, replace it with the persisted user message once observable, and retain a failed bubble with an accessible inline Retry that repeats the captured send.

## Boundaries & Constraints

**Always:** Preserve existing send guards, regeneration, Stop, proposals, feedback, sources, uploads and research. Capture the original content, highlight, refinement and conversation intent before awaiting. Reconcile by exact returned message id and thread, never by text. Keep failed and pending rows scoped to their originating conversation, including a not-yet-created conversation. Retry preserves the logical request key and original arguments; repeated activation cannot duplicate the in-flight request. New composer edits and navigation during a pending send must survive completion. Use existing Svelte 5 primitives, design tokens and weights no greater than 500. Record decisions and command/browser evidence in `.audit/story-7/`.

**Block If:** Correct local reconciliation requires changing the existing backend API or a new product authority/transition.

**Never:** Edit Convex production or generated files, the native deferred-work ledger, or unrelated capabilities. Never treat a synthetic message order as a durable turn for queries, Stop, feedback or regeneration. Do not create an optimistic chat bubble for the separate research-start operation. Do not claim backend idempotency or persistence of local failures across reloads.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Immediate send | Existing thread or empty/new conversation; mutation unresolved | One request-keyed local user bubble appears before resolution; draft is consumed without losing later edits | None |
| Handoff | Mutation and server publication arrive in either order | Once exact returned id is present in that thread's persisted page, local row disappears and one durable user bubble remains; mutation resolution alone retains local bubble | No text-based matching |
| Repeated content | Historical user message has identical text, or multiple sends repeat text | Each logical send remains distinct; unrelated existing row cannot acknowledge pending request | None |
| Failure and retry | Mutation rejects, then retry succeeds | Failed bubble retains content and inline error; keyboard Retry resends exact captured arguments using same logical key, shows sending state, then reconciles | Duplicate retry activation guarded |
| Captured context | Highlight-only send or text plus highlight/refinement; composer context changes after send | Local bubble shows user-visible text/excerpt; retry retains original arguments and does not read replacement context | New draft/context preserved |
| Navigation | Switch conversation or start another new chat while send unresolved or failed | No bubble leaks into another conversation; completion does not steal selection or clear its draft; returning shows pending/failure until reconciliation | Retry targets origin only |
| Historical resend | Regenerate while current draft/context exists | New local bubble uses historical stored prompt; old transcript and current composer remain intact; failure retry retains historical semantics | Existing regeneration guards retained |
| Durable behavior | Pending local row alongside existing turns, pagination and active reply | Synthetic data cannot drive timing queries, false Stop, feedback or regeneration; publication guard persists independently of local row removal | Existing busy states respected |
| Research | Composer has pending research selection | Existing startResearch flow runs with no optimistic chat message | Existing research error surface |

</intent-contract>

## Code Map

- `src/lib/components/chat/AgentChatPanel.svelte:563`: shared sendText currently captures neither composer scope nor arguments for retry. Existing SendIntent and pendingSendByThread retain regeneration and terminal-publication guards. Reuse the transport path and strengthen local request lifecycle without parallel send mechanics.
- `src/lib/components/chat/AgentChatPanel.svelte:1390`: durable transcript renders Message/MessageContent, splits highlight and hides refinement metadata. Reuse that presentation for local rows and ensure empty-state selection includes local rows.
- `src/lib/chat/uiMessages.svelte.ts:147`: persisted/streaming merge by order/step. Preserve durable results semantics. A separate local projection/reconciliation helper here or a focused companion module can expose pending rows without contaminating durable order consumers; only persisted rows acknowledge sends.
- `src/lib/requestId.ts`: existing browser-safe createRequestId. Reuse it.
- `convex/chatV2.ts:340` (read-only): appends highlight/refinement to stored content; returns exact threadId/messageId. Signature has no client request id. Associate local key to result locally.
- `src/lib/components/chat/RegenerateTurn.component.test.ts`, `RegenerateQueryState.component.test.ts`, `RegenerateLimits.component.test.ts`: real panel browser fixtures and delayed mutation/query transitions. Preserve their behavior; update assertions only for intentionally added user bubbles, never weaken durable safeguards.
- `src/lib/test/convex-svelte-stub.svelte.ts`: existing reactive transport fixture helpers. Keep real panel and createUIMessages running in tests.
- Story 6 completed regeneration with bounded pending-turn lookup, direct displaced-research observation and conservative metadata guards. Its audit is historical; avoid retaining incidental rewrites of its screenshots.

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/components/chat/AgentChatPanel.svelte`: implement immediate, scoped request lifecycle and inline retry with captured send arguments, preserving shared guards and composer state.
- [x] `src/lib/chat/uiMessages.svelte.ts` (and a focused companion helper if needed): expose exact persisted-id reconciliation separately from durable stream results.
- [x] `src/lib/components/chat/OptimisticSend.component.test.ts`: exercise every matrix row through the real rendered panel and controlled transport, including actual keyboard retry and browser screenshots. Add focused helper tests only where useful.
- [x] `.audit/story-7/decisions.tsv` and `evidence.md`: append decisions, baseline/final revision, matrix-to-test mapping, exact commands/output tails, inspected screenshots, and unchanged-ledger proof.

**Acceptance Criteria:**
- Given a writer sends in the real panel, when the mutation is delayed, then the user bubble is already visible; when its exact persisted message is published and the mutation result is known, then only the durable bubble remains.
- Given a failed send, when the writer activates its inline Retry by keyboard, then the original request is retried without retyping or incorporating a newer draft/context.
- Given the matrix and existing chat features, when component tests, nonbrowser tests and Svelte check run, then every matrix behavior is covered by passing tests and existing safeguards remain intact.

## Spec Change Log

## Review Triage Log

### 2026-09-05: Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 8: (high 0, medium 5, low 3)
- defer: 0
- reject: 4: (high 0, medium 1, low 3)
- addressed_findings:
  - `[medium]` `[patch]` Block sibling sends in an unresolved unsaved conversation until retry or dismissal, preventing split destinations after thread creation.
  - `[medium]` `[patch]` Reveal the originating optimistic row after rendering, before transport resolves, including scrolled transcripts.
  - `[medium]` `[patch]` Keep failed requests before later durable turns through presentation-only anchors.
  - `[medium]` `[patch]` Restore scoped dismissal for local and displaced historical failures.
  - `[low]` `[patch]` Bound and normalize unsaved conversation previews and prevent menu overflow.
  - `[low]` `[patch]` Distinguish identical unsaved conversation previews with stable visible numbers.
  - `[medium]` `[patch]` Preserve keyboard focus through retry and repeated failure; move to composer on success only when focus still belongs to that retry.
  - `[low]` `[patch]` Restore incidental historical images and redirect regeneration test screenshots to transient output.

All four independent review layers completed. Duplicate draft-promotion claims were counted once. No domain or backend authority change was required. Exact reconciliation waits for both persisted page and mutation identity; temporary publication-first duplication is documented as a limitation. No deferred-work ledger entries were authored or modified. Full triage is retained in `.audit/story-7/review-triage.md`.

### 2026-09-05: Follow-up review pass
- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 3, low 1)
- defer: 0
- reject: 10: (high 0, medium 1, low 9)
- addressed_findings:
  - `[medium]` `[patch]` Preserve the same focused composer across the first optimistic insertion so Enter does not interrupt continued typing.
  - `[medium]` `[patch]` Return focus from the active Dismiss control to the composer before removing a failed row.
  - `[medium]` `[patch]` Wrap unbroken local prompt/error text within a narrow transcript.
  - `[low]` `[patch]` Associate Retry and Dismiss with their originating prompt using accessible descriptions.

Four independent review layers completed. Three new rendered-panel regressions failed before these patches and passed afterward. Full dispositions are in `.audit/story-7/followup-triage.md`. No deferred-work ledger content or status was changed.

### 2026-09-05: Second follow-up review pass
- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 2, low 2)
- defer: 0
- reject: 13: (high 0, medium 1, low 12)
- addressed_findings:
  - `[medium]` `[patch]` Preserve long-prompt containment when the local bubble becomes a durable user message.
  - `[medium]` `[patch]` Wrap displaced historical failure text and actions within narrow panels.
  - `[low]` `[patch]` Supply the existing fallback for empty or whitespace transport error messages.
  - `[low]` `[patch]` Visually dim aria-disabled Retry while preserving its mounted keyboard focus.

All four independent review layers completed. Four new rendered-panel cases failed before the patch and all 32 optimistic-send cases passed afterward. Full dispositions are in `.audit/story-7/second-triage.md`. No deferred-work ledger content or status was changed.

## Verification

- `npm run test:component`: canonical Chromium suite passes. Run before component edits and after implementation; capture `.audit/story-7/optimistic-before.png` and `optimistic-after.png` from the real panel, inspect them. Restore only incidental test-generated changes to historical audit images, never ledger content.
- `npm test`: complete nonbrowser suite passes.
- `PUBLIC_CONVEX_URL=https://placeholder.convex.cloud npm run check`: zero errors and warnings.
- `git diff --check`: clean.
- `shasum -a 256 -c .audit/story-7/ledger-baseline.sha256`: unchanged native ledger.

## Auto Run Result

Status: done

Immediate optimistic bubbles, exact persisted-ID handoff and captured inline Retry remain implemented. This pass preserves long-text containment through durable handoff, wraps displaced historical errors and actions, normalizes blank failures, and visibly dims unavailable Retry controls without dropping focus.

Files changed in this pass:
- `src/lib/components/chat/AgentChatPanel.svelte`: four focused presentation/error patches.
- `src/lib/components/chat/OptimisticSend.component.test.ts`: four new rendered-panel regression cases; 32 cases total.
- `.audit/story-7/`: review dispositions, actual before/after evidence, screenshots, command logs and source hashes.
- This story: review triage and completion record.

Review: four patches (high 0, medium 2, low 2), zero deferred, thirteen rejected. Follow-up review recommended: true; score = 3 × 2 + 2 = 8. No intent gap or spec repair loop was needed.

Verification: canonical Chromium suite passed 59 files / 428 tests; nonbrowser suite passed 149 files / 1,911 tests; Svelte check reported zero errors and warnings. Four new cases failed before the patches, then all 32 optimistic-send cases passed. Before/after screenshots were inspected. Diff whitespace check passes. Ledger SHA-256 matches its recorded baseline; no ledger content or status was modified. Exact implementation revision and command evidence are retained in `.audit/story-7/evidence.md`.

Residual limits: transport fixtures do not establish live backend/provider behavior. Publication-first identity delay can briefly duplicate a prompt. Local failures do not survive reload; local keys do not provide backend idempotency. Native run acceptance remains the orchestrator's responsibility.
