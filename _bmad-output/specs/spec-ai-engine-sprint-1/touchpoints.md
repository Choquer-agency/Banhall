# Touchpoints

Verified file:line anchors per capability, from `docs/ai-engine-audit-2026-08-25.md` at commit `66f131b`. Implementers start here; lines may drift.

| CAP | Primary edit | Reference to mirror | Tests |
|---|---|---|---|
| CAP-1 | `convex/lib/auth.ts:44-52` (`requireInternalProjectAccess`) | `convex/lib/auth.ts:33-41` (`getInternalProjectAccessOrNull` rejects anonymous/role-less) | new `convex/reportAuthz.test.ts` |
| CAP-2 | `convex/chatV2.ts:426-434` (`markProposalApplied`); `src/lib/components/chat/ProposalCard.svelte` | `convex/chatV2.ts:297-424` (`applyProposal`: authz recheck, `pre_chat_edit` snapshot at `:391-407`, revision bump) | `tests/chatProposals.test.ts` |
| CAP-3 | `convex/projects.ts:931` (`publishForReview`, currently `requireProjectCreatorOrAdmin`) | `shared/capabilities.ts`; `requireCapability` | `convex/projects.test.ts` |
| CAP-4 | `convex/comments.ts:140-185` (`acceptEdit`, patch at `:164-166`); `convex/reviews.ts:62-68` (nomination scheduled before insert) | `convex/snapshots.ts:152-259` (snapshot writers) | new tests for `acceptEdit`, `submitWriterReview` |
| CAP-5 | `convex/brain.ts:383-404` (`submitBrainFeedback`) | `requireInternalProjectAccess` after CAP-1 | `convex/brainFeedback.test.ts` |
| CAP-6 | `convex/ai/providers.ts:587-588` (Anthropic `maxRetries: 2`, `timeout: 8 min`) | `convex/ai/pipeline.ts:515` (`generateCandidate`, single action) | none required |
| CAP-7 | `convex/generations.ts:526-530` (`retryFailedCandidates`); `:1516` (`requestReportQa`); `convex/schema.ts:596` status union | `convex/generationRecovery.test.ts` | extend `generationRecovery.test.ts` |
| CAP-8 | `convex/ai/chatAgentV2.ts:391` (`streamText` call, add `contextOptions`); `convex/chatV2.ts:84-121` (`listMessages` throws at `:92`, `listProposals` at `:115-119`) | `listTurns` window in `chatV2.ts` | `convex/chatTurns.test.ts` |
| CAP-9 | `convex/ai/pipeline.ts:445` and `convex/ai/iterative.ts:138` (digest fetch); `convex/ai/instrument.ts:24-44`; `convex/ai/openrouter.ts:152`; `convex/aiUsage.ts`; `convex/schema.ts:466-482` (`aiUsage`), `:596-696` (`generations`) | `candidateScores` and `qaItemFeedback` already keyed by `generationId` | `tests/aiUsage.test.ts` |
| CAP-10 | `convex/brain.ts:329-357` (`unlearnSource`); `convex/ai/brain/ingest.ts:80` (`embedSource` throws on null source); `convex/schema.ts:1543` (`brainAuditLog` action union) | `convex/ai/brain/rag.ts:88-103` (late-completion fence) | `convex/brainFeedback.test.ts` or new |
| CAP-11 | `convex/generations.ts:2158` (`projects.take(500)`); `convex/schema.ts` projects indexes | existing `by_*` index naming | none required |
