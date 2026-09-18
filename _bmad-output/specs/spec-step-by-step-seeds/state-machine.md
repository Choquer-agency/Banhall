# State machines — Step-by-step PD generation

Diagrams for CAP-1, CAP-3, CAP-8, CAP-9, CAP-12 and CAP-13. The rules are in SPEC.md and the feature spine (AD-31, AD-34, AD-36, AD-37); these pictures carry shape only.

## Generation lifecycle (seeds workflow)

```mermaid
stateDiagram-v2
  [*] --> reserved: requestGeneration (gatedWorkflow=seeds)
  reserved --> running: startIterativeGeneration (analysis, Brief)
  running --> awaiting_input: initializeSeedStage (13 Subsection rows)
  awaiting_input --> awaiting_input: seed stage (batches, decisions)
  awaiting_input --> running: seeds.signOff (Summary frozen)
  running --> completed: section chain + createGeneratedReportArtifacts
  running --> failed: chain failure
  awaiting_input --> failed: cancelIterativeGeneration (existing cancel semantics: terminal, no report, seed records retained)
  failed --> [*]
  completed --> [*]
  note right of failed: Retry = new generation carrying summaryVersionId, no seed stage
```

## Subsection state

```mermaid
stateDiagram-v2
  [*] --> untouched
  untouched --> generating: open / prefetch (attempt pending)
  generating --> in_progress: completeBatch (shown)
  generating --> untouched: failBatch (no prior batch)
  generating --> failed: allowance of 3 initial attempts exhausted
  failed --> generating: retry (counted request)
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
  W->>S: set pendingAttemptId = a1, reserve 2 requests
  W->>B: insert a1 queued (consumedContextRevision = C1)
  A->>B: claimSeedBatch a1 (queued→running)
  Note over W,S: writer changes a Predecessor: currentContextRevision = C2
  A->>B: completeBatch a1 → shown (Outdated: C1 ≠ C2)
  W->>S: retry → pendingAttemptId = a2
  A->>B: completeBatch a1 (again, after lease) → late (never current)
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
