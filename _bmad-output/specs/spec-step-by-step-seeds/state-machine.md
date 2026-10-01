# State machines — Step-by-step PD generation

Diagrams for CAP-1, CAP-3, CAP-8, CAP-9, CAP-12 and CAP-13. The rules are in SPEC.md and the feature spine (AD-31, AD-34, AD-36, AD-37); these pictures carry shape only.

## Generation lifecycle (seeds workflow)

```mermaid
stateDiagram-v2
  [*] --> reserved: requestGeneration (gatedWorkflow=seeds)
  reserved --> running: startIterativeGeneration (writer style, Brief)
  running --> awaiting_input: initializeSeedStage (13 Subsection rows)
  awaiting_input --> awaiting_input: seed stage (batches, decisions)
  awaiting_input --> running: generations.signOffSeedStage (Summary frozen)
  running --> completed: section chain + createGeneratedReportArtifacts
  running --> failed: chain failure
  awaiting_input --> failed: cancelIterativeGeneration (existing cancel semantics: terminal, no report, seed records retained)
  failed --> [*]
  completed --> [*]
  note right of failed: Retry = new generation carrying summaryVersionId, no seed stage
```

Amended 2026-09-25 (owner approved, decision 32): the Brief and the frozen writer style open the seed stage; the analysis and Brain retrieval run in the background and sign-off waits for them. They are tracked on `generations.draftingInputs`; the generation's own status moves are unchanged.

## Drafting inputs (amended 2026-09-25, decision 32)

```mermaid
stateDiagram-v2
  [*] --> none: seed stage opened before the reorder (reads as ready)
  none --> preparing: startDraftingInputs or initializeSeedStage (attempt 1, background action scheduled)
  none --> ready: startDraftingInputs or initializeSeedStage (both inputs already frozen)
  preparing --> ready: completeDraftingInputs (analysis + brain_blocks frozen)
  preparing --> failed: failDraftingInputs / expireDraftingInputs (15-minute lease)
  failed --> preparing: retryDraftingInputs (writer, attempt + 1)
  note right of ready: signOffSeedStage refuses preparing and failed
```

## Subsection state

```mermaid
stateDiagram-v2
  [*] --> untouched
  untouched --> generating: open / prefetch (attempt pending)
  generating --> in_progress: seedRuns.completeAttempt (shown)
  generating --> untouched: seedRuns.failAttempt (no prior batch, fewer than 3 consecutive failures)
  generating --> in_progress: seedRuns.failAttempt (prior batch restored)
  generating --> failed: seedRuns.failAttempt (3 consecutive failures, no shown Batch)
  failed --> generating: retry (metered request, available without limit)
  in_progress --> generating: regenerate / feedback (attempt pending)
  in_progress --> approved: approve (records approved revisions)
  approved --> in_progress: own selection change
  approved --> approved: Stale derived when a Predecessor changes
  in_progress --> skipped: skip (Optional only)
  approved --> skipped: skip (Optional only)
  untouched --> skipped: skip (Optional only)
  skipped --> in_progress: unskip (had a batch)
  skipped --> untouched: unskip (never had a batch)
```

Stale is not a stored state: `approved && (approvedContextRevision != currentContextRevision || approvedSelectionRevision != selectionRevision)`. Outdated is read-side: `shownBatch.consumedContextRevision != currentContextRevision`.

## Attempt ownership

```mermaid
sequenceDiagram
  participant W as writer mutation
  participant S as seedSubsections
  participant B as seedBatches
  participant A as generateBatch action
  W->>B: insert b1 queued (attemptId = a1, consumedContextRevision = C1)
  W->>S: set pendingBatchId = b1, reserve up to 2 requests for metering
  A->>B: seedRuns.claimAttempt(b1) (queued→running)
  Note over W,S: writer changes a Predecessor: currentContextRevision = C2
  A->>B: seedRuns.completeAttempt(b1) → shown (Outdated: C1 ≠ C2)
  W->>S: retry → pendingBatchId = b2 (attemptId = a2)
  A->>B: seedRuns.completeAttempt(b1) after lease → records deliveredLateAt; terminal status unchanged, never current
```

## Approval and staleness across Subsections

```mermaid
flowchart LR
  S5[S5 approved] -- untick uncertainty --> S5b[S5 in progress]
  S5b -. currentContextRevision changes .-> S8[S8 approved → Stale]
  S5b -. .-> S9[S9 approved → Stale]
  S5b -. .-> S11[S11 in progress → shown batch Outdated]
  S8 -- regenerate + approve --> S8ok[S8 approved, episode resolved]
  S9 -- confirm and approve --> S9ok[S9 approved, episode resolved (confirmed)]
  S11 -- approve refused: outdated / unlinked --> S11r[regenerate → approve]
```
