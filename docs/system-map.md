# Banhall system map

How the pieces fit, what is solid, and what is not yet. Written 2026-09-03 against HEAD `005f115`. The binding decisions live in `_bmad-output/planning-artifacts/architecture/architecture-Banhall-2026-09-03/ARCHITECTURE-SPINE.md` (AD-1 to AD-22); this page is the readable projection. When they disagree, the spine wins.

Sibling docs: `product-domain.md` (the domain contract), `ai-architecture-plan.md` (AI target), `ai-engine-audit-2026-08-25.md` (findings), `the-brain.md`, `svelte-migration.md`, `design-system.md`.

## 1. One paragraph

A writer creates a project, attaches interview transcripts and supporting files, and asks for a draft. Convex freezes the inputs, runs a fixed pipeline (analyzer, three CRA section agents, scrub, compress, QA) on Claude, and writes a Tiptap JSON report. The writer edits in the browser, chats with an agent that can only *propose* edits (a human applies them), snapshots and exports to the Schedule 60 `.docx`. Every generation and chat call is metered. In the background, admin-approved exemplars (the Brain) and admin-published learning digests are injected into prompts so the system drifts toward how the firm's writers actually write. Workflow stage, ownership, and handoffs sit on the same project row but never cross-write with generation state.

## 2. The pipeline

```text
  transcripts + files          Convex                     AI engine (convex/ai/)                  writer surfaces
  ─────────────────    ──────────────────────    ────────────────────────────────────    ──────────────────────────
  /project/new   ──►   transcripts               reserveGeneration: freeze inputs        /project/[id]  Editor.svelte
  uploads        ──►   projectDocuments   ──►    analyzer ─► 242/244/246 agents   ──►    reports.content (Tiptap JSON)
  /ingestion/upload    generationSources         scrub ─► compress ─► QA                 snapshots, comments, export
  (bearer key)         (frozen copies)                    │                               AgentChatPanel ─► chatProposals
                                                          │                                   └─ human applyProposal
                                             ┌────────────┴──────────────┐
                                             │  Brain (RAG exemplars)    │  ◄── admin approves nominations
                                             │  learning digests         │  ◄── admin selects a digest
                                             │  writer style / house     │
                                             └───────────────────────────┘
```

Read the arrows as: nothing AI-generated reaches `reports.content` without a human action, and nothing enters the Brain or a live digest without an admin action.

## 3. Layers and dependency direction

| Layer | Directory | Contents |
| --- | --- | --- |
| Workflow core | `convex/*.ts` | `projects`, `projectWorkflow`, `workItems`, `reports`, `snapshots`, `comments`, `dashboard`, `myWork`, `users`, `invites`, `auth`, `http`, `crons`, `schema` (69 tables) |
| AI engine | `convex/ai/` | `pipeline`, `iterative`, `postQa`, `analyzerAgent`, `section24xAgent`, `qaAgent`, `chatAgentV2`, `research/`, `prompts`, `promptProgram`, `providers`, `openrouter`, `instrument`, `structured` |
| Knowledge sidecar | `convex/ai/brain/`, `convex/brain.ts`, `convex/learning.ts`, `convex/ai/learning.ts`, `convex/ai/brainRetrieval.ts` | RAG ingest / retrieve / erase, `brainSources` governance, digest distillation and selection ledger |
| Shared pure helpers | `convex/lib/` | `auth`, `roleCapabilities`, `contracts`, `dashboardProjection`, `snapshots`, `tiptapReport`, `lineLimits`, `transcripts`, `styleOverrides`, `providerConfig` |
| Isomorphic contracts | `shared/` | `capabilities`, `workflowStages`, `workflowTransitions`, `styleOverrides`, `generationModels`, `chatProposals`, `workItems`, `roles`, `bannedWords`, `humanProse` |
| Client | `src/routes`, `src/lib` | SvelteKit (SSR shell, hydrates into convex-svelte subscriptions), Svelte 5 runes, bits-ui primitives, Tiptap editor |

```mermaid
flowchart BT
  SH[shared/]
  LIB[convex/lib/]
  AI[convex/ai/ + brain sidecar]
  FN[convex/*.ts functions]
  GEN[convex/_generated/api]
  SRC[src/routes + src/lib]
  LIB --> SH
  AI --> LIB
  AI --> SH
  FN --> AI
  FN --> LIB
  FN --> SH
  GEN -.generated from.-> FN
  SRC --> SH
  SRC --> GEN
  SRC -.pure modules only.-> LIB
```

`src/` may import `shared/`, the generated `api`, and pure modules under `convex/lib/` (`lineLimits`, `transcripts`). It never imports Convex function modules or `convex/ai/`. This is documented only; nothing lints it yet (AD-1).

## 4. Deployment

```mermaid
flowchart LR
  B[Browser SPA] -->|HTML shell + chunks| V["Vercel (adapter-vercel)<br/>hooks.server: cookie to JWT"]
  B -->|/api/auth/* proxy| V
  V -->|proxy| CH["Convex HTTP router<br/>better-auth routes / /ingestion/upload"]
  B -->|WebSocket queries/mutations, JWT| CX["Convex deployment<br/>dev: energized-salamander-237<br/>prod: name not in repo (Q5)"]
  CX --> AN[Anthropic]
  CX --> OR[OpenRouter]
  CX --> VY[Voyage embeddings + rerank]
  CX --> MS["MS Graph OneDrive [optional]"]
  CR[scripts/onedrive-crawler.mjs + client-uploader] -->|bearer INGEST_API_KEY| CH
  GH["GitHub Actions<br/>ci.yml / publish-changelog.yml"] -->|convex run via deploy key| CX
  VD["Vercel deploy hook (Q5: repository_dispatch wired?)"] --> GH
  CX -.crons.-> CX
```

As found: frontend on Vercel via git integration; backend on Convex cloud with components `rag`, `agent`, `workpool`, `workflow`, `betterAuth`; there is no production deployment yet, `energized-salamander-237` serves developers and writers alike; CI runs `npm run check` and `npm test` only. Crons: stale generation / PD review / post-QA / chat-turn reapers every 10 min, oversight and my-work sweeps every 5 min, nightly digests 08:00 and 08:15 UTC. Target (AD-22): split into staging and prod at launch with `convex deploy` on merge to `main`; codegen diff and `vite build` in CI now.

## 5. Core entities

```mermaid
erDiagram
  users ||--o{ projects : "createdBy (immutable)"
  users ||--o{ projects : "ownerId (authority)"
  users ||--o{ invites : "createdBy / acceptedUserId"
  projects ||--o{ transcripts : ""
  projects ||--o{ projectDocuments : ""
  projects ||--o{ reports : ""
  projects ||--o{ generations : ""
  projects |o--o| generations : "activeGenerationId"
  projects ||--o{ workItems : ""
  projects |o--o| workItems : "currentHandoffId"
  projects ||--o{ projectEvents : "stage_changed / ownership_transferred"
  projects |o--o| reports : "sharedReportId + shareToken"
  projects ||--o{ pdReviews : ""
  projects ||--o{ projectIdentityEvidence : ""
  projects ||--o{ financialUploads : ""
  projects }o--o| dashboardCompanies : "dashboardCompanyKey (projection)"
  workItems ||--o{ workItemEvents : ""
  workItems ||--o| workItemOversight : "manager pipeline projection"
  reports ||--o{ reportSnapshots : ""
  reports ||--o{ comments : ""
  reports ||--o{ chatProposals : ""
  reports ||--o{ writerReviews : ""
  reports ||--o{ reviewDecisions : "internal-review completion, pinned to revision"
  reports ||--o{ agentChatThreads : ""
  generations ||--o{ reportCandidates : ""
  generations ||--o{ generationSources : "frozen input bytes"
  generations ||--o{ generationCandidateRuns : ""
  reports |o--o| generations : "generationId (provenance)"
  brainSources ||--o{ brainAuditLog : ""
  learningDigests ||--o{ learningDigestSelections : "append-only ledger"
```

`projects` carries three state axes that never cross-write (AD-2): `workflowStage` (human), `generations.status` via `activeGenerationId` (technical), and legacy `status` (compatibility only). Planned but absent: `reportBranches`, `productionOutcomes`, `clients`, `claimPeriods`, `notifications`.

## 6. Workflow stages

```mermaid
stateDiagram-v2
  [*] --> intake : createProject (ownerId = caller)
  note right of intake : Open matrix (2026-08-17 amendment). Every stage may reach every other stage. Edges below show only non-default policy.
  intake --> interview_complete
  interview_complete --> drafting
  drafting --> internal_review : also via workItems.create(confirmedStageChange)
  internal_review --> edits : + handoff_assignee authority, requires review_decision (return)
  internal_review --> ready_for_delivery : + handoff_assignee, requires review_decision (approve) then promoted_branch (fails closed)
  edits --> client_review
  client_review --> revisions
  revisions --> ready_for_delivery : requires promoted_branch (fails closed)
  ready_for_delivery --> delivered : requires delivery_outcome (fails closed)
  drafting --> on_hold : note required
  drafting --> abandoned : note required, no open workItems
  delivered --> on_hold : manager/admin only, note required
  abandoned --> drafting : manager/admin only, note required
  delivered --> revisions : note required
```

Every stage write goes through `patchProjectWorkflowStage`, which moves the dashboard `stageCounts` bucket in the same transaction and appends a `projectEvents` row. `ready_for_delivery` and `delivered` fail closed because `reportBranches` and `productionOutcomes` do not exist: **no project can reach a terminal stage today (Q1)**. The two internal-review completion edges also fail closed without a recorded reviewer decision (2026-09-04 amendment): `setWorkflowStage` requires a `reviewDecision` agreeing with the destination and writes one `reviewDecisions` row — reviewer, report, `revisionNumber`, `contentHash` — in the same transaction, typed `REVIEW_DECISION_REQUIRED` when absent and `INVALID_STATE` when the project has no report to pin. Checked before `promoted_branch` so it is observable on the approve edge.

## 7. Routes

```mermaid
flowchart TD
  L["+layout.svelte<br/>setupConvex / auth / ErrorBoundary / Toaster"]
  L --> AUTH
  L --> WS
  L --> PROJ
  L --> REV
  L --> ADMIN
  L --> MISC
  subgraph AUTH[auth]
    login["/login"]
    signup["/signup/[token] invite accept"]
    apiauth["/api/auth/[...all] proxy to Convex"]
  end
  subgraph WS[workspace via WorkspaceGate]
    home["/ landing"]
    dash["/dashboard (rollback surface)"]
    projects["/projects board"]
    mywork["/my-work lanes"]
    requests["/requests"]
    alerts["/alerts"]
  end
  subgraph PROJ[project]
    pnew["/project/new intake"]
    pq["/project/questionnaire"]
    pid["/project/[id] report editor<br/>Current or Preview via gate"]
    pfin["/project/[id]/financial"]
  end
  subgraph REV[review, anonymous]
    rev["/review/[shareToken] NameGate then ReadOnlyEditor + comments"]
  end
  subgraph ADMIN[admin, role=admin client-checked, server-enforced]
    users["/admin/users invites"]
    models["/admin/models"]
    brain["/admin/brain"]
    ingest["/admin/ingestion"]
    reviews["/admin/reviews digests"]
    usage["/admin/usage"]
    tags["/admin/tags"]
    rules["/admin/house-rules"]
    backfill["/admin/backfill"]
  end
  subgraph MISC[misc]
    settings["/settings to /settings/account or /settings/writing"]
    changelog["/changelog"]
    guide["/styleguide"]
  end
```

Client-side redirects are UX only; every query and mutation re-checks authorization in Convex (AD-7).

## 8. The report page

```mermaid
flowchart LR
  subgraph Q[useQuery subscriptions]
    q1[projects.getProject]
    q2[reports.getLatestReport]
    q3[generations.getLatestGeneration]
    q4[comments.listComments]
    q5[pdReviews.getLatestPdReview]
    q6[snapshots.getGhostSnapshot]
    q7[generations.getIterativeState]
  end
  Q --> P["CurrentProjectPage / PreviewProjectPage<br/>(container, runes state)"]
  P -->|content string| E["Editor.svelte<br/>svelte-tiptap getJSON()"]
  E -->|debounced JSON| m1[reports.updateReportContent]
  P --> m2[generations.requestGeneration / cancelIterative / requestReportQa]
  P --> m3[snapshots.createManualSnapshot]
  P --> m4[chatV2.markProposalApplied]
  P --> m5["reports.authorizeExport then completeExport or failExport"]
  P --> GEN["IterativeStepper<br/>approveSectionDraft / regenerateSectionDraft"]
  P --> CHAT["AgentChatPanel<br/>chatProposals then applyProposal (human applies)"]
  m5 -.lazy import.-> X["exportTemplateDocx (browser only)<br/>JSZip patch schedule60.docx"]
  m1 --> CVX[(Convex)]
  m2 --> CVX
  m3 --> CVX
  m4 --> CVX
  m5 --> CVX
  GEN --> CVX
  CHAT --> CVX
  CVX -.reactive push.-> Q
```

`reports.content` is a Tiptap JSON string whose three `Line 242 / 244 / 246` H2 headings are the parse contract between backend assembly and the client (`src/lib/reportSections.ts`). Export re-authorizes on `(reportId, revisionNumber, contentHash)`. Seven mutations may patch prose and two may create a report row (AD-3); no other code touches it.

## 9. Generation

```mermaid
flowchart TD
  RQ[requestGeneration / retryGeneration] -->|reserveGeneration: reserved| G
  G{candidateMode}
  G -->|compare / single| GR[pipeline.generateReport]
  G -->|iterative| SI[iterative.startIterativeGeneration]
  GR -->|beginTrackedGeneration then beginGeneration: running| BR[retrieveBrainBlocks + getActiveDigest + fetchWriterStyle]
  BR -->|createCandidateRun: queued| GC[pipeline.generateCandidate]
  GC -->|claimCandidateRun: running| RP[runPipelineForModel]
  RP --> CC[completeCandidateRun: succeeded / failed]
  CC -->|compare fan-in| AS[awaiting_selection]
  CC -->|single| CP[completed + report]
  CC -->|all failed| F[failed]
  AS -->|selectReportCandidate| CP
  AS -->|retryFailedCandidates| SUP[superseded, new reserved recovery gen]
  SI -->|beginTrackedGeneration| SA[saveIterativeArtifacts + ghost run]
  SA -->|createSectionRuns| GS[iterative.generateSection]
  GS -->|claimSectionRun: running| CS[completeSectionRun, awaiting_input]
  CS -->|approveSectionDraft| GS
  CS -->|approveSectionDraft last| CP2[completed, postQa.runReportQa]
  GS -->|failSectionRun| AI[awaiting_input]
  AI -->|regenerateSectionDraft| GS
  CR[cron failStaleGenerations] -->|reserved/running over 30m| F
  CR -->|iterative section stale| AI
  X[cancelIterativeGeneration] --> F
  GR -->|catch then failGeneration| F
```

`reserveGeneration` copies every transcript and document into `generationSources` so provenance is byte-stable; `beginGeneration` stamps `promptVersion` and `learningDigestIds`. One active generation per project. Every model call goes through `clientForModel` and `instrument.ts` and lands in `aiUsage` (AD-5, AD-9).

## 10. Chat: agents propose, humans apply

```mermaid
sequenceDiagram
  participant W as Writer (AgentChatPanel)
  participant M as chatV2.sendMessage
  participant C as components.agent
  participant A as chatAgentV2.streamChatReply
  participant T as proposeEdit tool
  participant S as chatV2.saveProposal
  participant P as chatV2.applyProposal
  W->>M: sendMessage(reportId, content)
  M->>C: createThread/saveMessage(user)
  M->>M: insert chatTurns{queued}
  M-->>A: scheduler.runAfter(0)
  A->>M: markTurnStarted (queued to running)
  A->>M: getChatContextV2 + writerProfiles
  A->>M: isTurnActive?
  A->>C: streamText(system=policy+writer style, messages=[evidence user msg], tools, recentMessages 30)
  C-->>W: listMessages/syncStreams deltas
  C->>T: tool call proposeEdit(targetText,newText)
  T->>S: runMutation(saveProposal)
  S->>S: turn active? target in report? unique?
  S-->>T: {ok, proposalId}
  A->>M: finishTurn(completed, stepCount)
  W->>W: ProposalCard renders pending
  W->>P: applyProposal(proposalId)
  P->>P: requireReportEditAccess, re-scrub, applyReplacements
  P->>P: reportSnapshots(pre_chat_edit), report.revision+1, state=applied
  P-->>W: {applied:true,count}
```

```mermaid
stateDiagram-v2
  [*] --> pending: saveProposal (edit/replacements) / research.saveReviewResult
  [*] --> applied: saveProposal kind=references
  pending --> pending: updateProposalWording (writer)
  pending --> applied: applyProposal (writer, editProse)
  pending --> applied: markProposalApplied (writer, editProse, revision fence)
  pending --> stale: applyProposal, target not found
  pending --> rejected: rejectProposal (writer)
  stale --> rejected: rejectProposal
  applied --> [*]
  rejected --> [*]
  stale --> [*]
```

This is the invariant that makes the tool safer than ChatGPT: the model has no write path to prose (AD-4). Known gap: research inserts proposals directly rather than through `saveProposal` (divergence #48).

## 11. The Brain and the learning loop

```mermaid
flowchart LR
  R[writerReviews score>=85] -->|live| N[nominateFromReport, pending]
  F[brainFeedbackQueue approved] -->|live| N
  U[ingestion approveItem] -->|live, skips pending| A
  N -->|admin approveSource| A[approved]
  A -->|embedPool embedSource| E[rag entry + ragEntryId]
  E -->|searchBrainExemplars| Q[generation / chat searchBrain / research]
  Q -->|live| P[generations.brainProvenance]
  P -.->|stub: no reader| X[usefulness analytics]
  Q -.->|stub: no source chips / citations| C[cite in UI]
  W[writer submitBrainFeedback] -->|live| F
  A -->|admin revokeSource| V[revoked]
  V -->|unlearnSource then eraseBrainEntry| K[unlearn_confirmed / unlearn_failed]
  E -->|retrieval join drops non-approved| Q
  V -.->|stub: digests already distilled never unlearned| D[learningDigests]
```

```mermaid
flowchart LR
  subgraph signals
    QF[reviews.saveQaItemFeedback to qaItemFeedback]
    SC[generations.scoreCandidate to candidateScores]
    SE[approveSectionDraft to sectionEditEvents + ghostText]
    PW[chatV2 to proposalWordingEditEvents]
    WR[reviews score>=85 to brain.nominateFromReport]
    BF[brainFeedbackQueue approved]
  end
  QF -->|LIVE: runAfter 10m| QD[ai.learning.generateQaCalibrationDigest]
  SC -->|LIVE: runAfter| SD[ai.learning.generateDraftStyleDigest]
  BF -->|LIVE: brain.ts:696| SD
  SE -->|LIVE: getSectionEditsForDigest| SD
  PW -->|LIVE| SD
  CRON[crons nightly] -->|LIVE| QD
  CRON -->|LIVE| SD
  QD -->|LIVE: saveDigest candidate| LD[(learningDigests)]
  SD -->|LIVE| LD
  LD -->|LIVE: admin selectDigest ledger| ACT[learning.getActiveDigest]
  ACT -->|LIVE| PIPE[pipeline / iterative / postQa prompts]
  PIPE -->|LIVE: unionLearningDigestIds| PROV[(generations.learningDigestIds + promptVersion)]
  WR -->|LIVE: pending queue, admin approves| BRAIN[(Brain RAG)]
  BRAIN -->|LIVE: retrieveBrainBlocks| PIPE
  PIPE -->|LIVE write| BP[(generations.brainProvenance)]
  BP -->|LIVE: source use and associated judgments| LH
  PED[reportEditDistance persisted milestone samples] --> LH[learningHealth.getHealth admin query]
  RETRIEVE[searchBrainExemplars terminal result] -->|LIVE: best-effort recordRerankOutcome| RO[(rerankOutcomes)]
  RO -->|LIVE: bounded observedAt window| LH
  LH --> AL["/admin/learning: 30/90-day measured PED, source judgments, rerank outcomes"]
  PROV -.->|DEAD-END: no consumer joins provenance to outcomes| NW3((no reader))
  CRA[cra_letter / craOutcome] -.->|STUB: schema only, no retrieval or weighting| NW4((no reader))
```

Read the solid arrows: the loop from writer signal to digest to prompt is live and governed. Read the dotted ones: nothing today can tell you whether the learning helps. Persisted post-edit distance, source provenance with associated judgments, and prospective rerank outcomes now feed `/admin/learning`. These bounded observational signals do not establish whether learning causes better reports; prompt/digest outcome attribution remains unmeasured, and CRA outcome signals remain schema only.

## 12. Verdict: is it a step up over pasting into ChatGPT?

| Claim | Today | Governed by |
| --- | --- | --- |
| Inputs are frozen and every draft traces to exact bytes, prompt version, and digests | Yes | AD-5 |
| The model cannot write prose; a human applies every proposal | Yes | AD-3, AD-4 |
| Workflow, ownership, handoffs are first-class and event-sourced | Yes | AD-2, AD-14, AD-15 |
| Knowledge is admin-governed; revocation is confirmed erasure | Yes | AD-6 |
| Every model call is metered and attributed | Yes | AD-9 |
| Style rules are tiered so CRA limits cannot be waived | Yes | AD-16 |
| Learning is measurable (does the Brain or a digest reduce editing?) | Partial: observed editing, source judgments and rerank reliability; no causal attribution | AD-12 |
| Client text cannot steer the model (trust boundary) | Partial: transcript fenced (CAP-2), trust from uploader role (CAP-3), chat evidence in a delimited user message (CAP-4); remaining CAP items open | AD-11, AD-11a |
| Client identities are stripped before firm-wide knowledge | No | AD-13 |
| Deleting a project erases its data | No: 8 of 49 tables, no blobs | AD-19 |
| Egress to AI providers is registered and class-gated | No register; OpenRouter has no `data_collection: deny` | AD-20, AD-21 |
| Destructive and money-spending writes need more than "any role" | No: ~50 paths authorize on the read gate | AD-7 |
| Spend alerts fire when a project runs hot | Metered, no alert yet (decision: alert only, never cap) | AD-9 |
| Staging, CI deploy, in-app alerts, backups | None; no prod deployment exists yet | AD-22 |

Summary: the workflow, provenance, and human-gating foundations are real and tested, and they are exactly what a paste-into-ChatGPT workflow lacks. The learning loop is wired but blind, the trust boundary is half-built, and data lifecycle and authorization ceilings are missing. Those four are Sprint 2 and the new AD-19 to AD-22.

## 13. Top risks

| # | Divergence | Why it matters |
| --- | --- | --- |
| 1 | `ready_for_delivery` and `delivered` fail closed | No project can be finished (Q1, product blocker) |
| 9 | Transcript fencing, uploader-role trust and the chat evidence boundary landed (CAP-2, CAP-3, CAP-4); the rest of AD-11 is open | Prompt injection channel narrowed; remaining CAP items are the follow-up |
| 11 | Verbatim client text and titles enter digests and the Brain | Client A's sentences and name can surface in client B's draft |
| 12 | `brainProvenance` and post-edit distance are write-only | Cannot prove learning works or roll back a bad digest on evidence |
| 39 | ~50 writes (delete document and blob, delete comment, research egress, chat spend, identity fields) need only "any role" | Any invited writer can act destructively on any client's project with no trail |
| 43 | `deleteProject` cascades 8 of 49 tables and no storage blobs | Frozen transcripts, files, snapshots, chat threads survive a delete |
| 44 | No egress register; OpenRouter without `data_collection: deny`; Graph `Files.Read.All`; research egress without consent | Confidentiality posture is not stated anywhere |
| 47 | Only 3 of 7 prose writers fence on `expectedRevisionNumber`; "current report" has two definitions | Interleaved section approvals and proposal applies can clobber each other; a proposal can land on a stale report |

Full register (51 rows, 8 fixed) is in the spine.

## 14. Open questions

| Id | Question | Class |
| --- | --- | --- |
| Q1 | Closed 2026-09-04: build `reportBranches` + `productionOutcomes`; terminal stages fail closed until then | Product |
| Q2 | `deleteProject` authority: `createdBy` or a `project.delete` capability? | Authorization |
| Q3 | Generation has no capability cell; any Consultant can generate anywhere. Intended? | Authorization |
| Q4 | Canonical orchestrator: factory or bmad-loop? | Process |
| Q5 | Closed 2026-09-04: no prod yet, one deployment serves everyone; split at launch. Open: is the changelog `repository_dispatch` wired? | Operations |
| Q6 | Ingestion `approveItem` skips the pending queue. Intentional? | Knowledge governance |
| Q7 | Closed by AD-11a | AI engine |
| Q8 | Port or delete the 14 dead bun tests; add component tests to CI? | Tests |
| Q9 | Retention windows (proposed 90 / 90 / 180 / 180 days) | Data lifecycle |
| Q10 | Closed 2026-09-04: Owner or Admin for delete / egress / spend / identity writes | Authorization |
| Q11 | Share-token rotation and expiry (proposed 30 / 90 days) | Authorization |
| Q12 | Closed 2026-09-04: no cap, alert only. Open: the threshold number | AI engine |
| Q13 | Closed 2026-09-04: in-app `/alerts` only | Operations |
| Q14 | Closed 2026-09-04: neither before launch | Authorization |

## 15. Stack

svelte 5.56.6, @sveltejs/kit 2.70.1, vite 8.1.5, tailwindcss 4.3.3, bits-ui 2.18, svelte-tiptap 3.0, convex 1.42.3, convex-svelte 0.14, @convex-dev/agent 0.6.4, @convex-dev/rag 0.7.5, @convex-dev/better-auth 0.12, ai 6.0.230 (v6 line by decision until AD-11 CAP-4 lands), @ai-sdk/anthropic 3.0, vitest 4.1, Node 22 in CI. Default model `claude-sonnet-5` direct; `openai/*` and `google/*` via OpenRouter; Voyage `voyage-3-large` + `rerank-2.5`.

## 16. Where to go next

1. Owner decisions taken 2026-09-04 (Q1, Q5, Q10, Q12, Q13, Q14). Still owner-level: Q2, Q3, Q6, Q11, and the Q12 threshold number.
2. AD-11a shipped (transcript fenced, writer's notes demoted, chat grounding moved to a user message, injection fixtures); continue with the remaining AD-11 CAP items.
3. Run the two Sprint 2 specs (`spec-ai-engine-sprint-2-boundary`, `spec-ai-engine-sprint-2-learn-chat`) through sprint planning; they build AD-11, AD-12, AD-13.
4. New stories not in either spec: AD-19 erasure cascade, `reportBranches` + `productionOutcomes` (Q1), Owner-or-Admin interim gate (Q10), in-app alerts (Q12, Q13), CI codegen diff and build (AD-22).
5. NFR evidence audit (`bmad-testarch-nfr`) once AD-11a and AD-19 land.
