# Rubric review: ARCHITECTURE-SPINE.md (Banhall, 2026-09-03)

Reviewer role: rubric walker. Spine read in full (673 lines). Repo checked at HEAD `5a5f61c`. All 11 mermaid blocks parsed and rendered with mermaid 11 via Playwright. Stack versions read from `node_modules`. File:line claims spot-checked against code (see the verification log at the end).

Verdict: the spine is strong on the AI engine and knowledge governance, and its citations are mostly accurate, but two of its ADOPTED invariants are not true in the code (AD-1 contradicts AD-8 on what `src/` may import; AD-3's writer list misses two `reports.content` writers), and the data-lifecycle dimension (cascade delete, retention, blob storage) is silent rather than deferred.

## Checklist scorecard

| # | Criterion | Result |
| --- | --- | --- |
| 1 | Fixes the real divergence points, misses none | Partial. Missing: project-scoped cascade/retention, run-row status vocabulary, blob storage, tenancy statement |
| 2 | Every Rule enforceable and prevents its divergence | Partial. AD-1 enforcement claim is false; AD-2, AD-3, AD-14 writer lists are inaccurate so the "closed list" rule cannot be applied |
| 3 | Nothing under Deferred lets units diverge now | Fail on two rows: duplicated stage-authority evaluator, and retention policy |
| 4 | Named tech verified-current | Pass. 20 of 20 versions match `node_modules` |
| 5 | Ratifies brownfield, file:line claims hold | Pass with minor drift (4 off-by-range or path errors, listed under Low) |
| 6 | Every owned dimension decided, deferred, or open | Partial. Silent: data retention, deletion cascade, blob storage, tenancy; assumption-laden: deployment |
| 7 | Diagrams valid and structural | Pass on syntax (11/11). One decorative diagram (route tree) |
| 8 | Terse, no rationale, no template comments, no em dashes | Pass. Zero em dashes. Minor rationale fragments |

## Findings

### Critical

#### C1. AD-1 and AD-8 contradict each other on what `src/` may import

- Where: AD-1 Rule ("`src/` imports `shared` and `convex/_generated/api`, never `convex/*.ts` directly"), the Dependency direction diagram (`SRC --> SH`, `SRC --> GEN` only), and AD-8 Rule ("`convex/lib/lineLimits.ts` is the one source of CRA word/line limits for both runtimes").
- What is wrong: the code does what AD-8 says and what AD-1 forbids. `src/lib/reportSections.ts:6`, `src/lib/exportValidation.ts:10`, and `src/lib/exportTemplateDocx.ts:13` import `../../convex/lib/lineLimits`. Two teams can each obey an AD and diverge: one puts a shared constant in `shared/` (AD-1), the other imports it from `convex/lib` (AD-8). The spine claims AD-1 is ADOPTED; it is not.
- Fix: pick one. Recommended wording for AD-1 Rule: "`src/` imports `shared/`, `convex/_generated/api`, and pure modules under `convex/lib/` that have no Convex runtime import (today: `lineLimits`). It never imports `convex/*.ts` function modules or `convex/ai/`." Add `SRC --> LIB` to the diagram with the label "pure only". Alternative: move `lineLimits.ts` to `shared/` and keep AD-1 as written; then AD-8 must cite `shared/lineLimits.ts`.

#### C2. AD-3's closed list of `reports.content` writers is incomplete, so the "one prose-write path" invariant is not ratified

- Where: AD-3 Rule ("The seven writers ... Adding an eighth requires amending this list").
- What is wrong: two more code paths write `reports.content` and satisfy none of (a) to (d):
  - `convex/generations.ts:943` (`createReportFromCandidate`, called from `completeCandidateRun` and `selectReportCandidate`) inserts a new `reports` row with `revisionNumber: 0`. This is the generation creation path; it is not in the list.
  - `convex/projects.ts:835` inside `copyProjectInputRows` (`:748`), reached from the public mutation `prepareProjectContentCopy` (`:886`). It copies prose into a new report on the target project after `requireInternalProjectAccess` only (`:743-744`); no `requireReportEditAccess`, no snapshot, no `report.editProse` check. Any internal actor can seed prose into any project.
  - `convex/seed.ts:104` (dev seed; acceptable to exclude explicitly).
- Why it matters: a feature team adding "duplicate report into new claim period" will look at AD-3, see a list of seven patch-style writers, and either fail to find the creation path or copy `prepareProjectContentCopy` as precedent. The rule as written is not enforceable because it does not match reality.
- Fix: split the rule into two write shapes and close both lists.
  - "Revision writers (patch an existing report): the seven listed; each does (a) to (d)."
  - "Creation writers (insert a report at `revisionNumber 0`): `generations.createReportFromCandidate` (`generations.ts:920-969`) and `projects.copyProjectInputRows` (`projects.ts:748`). Each writes a `reportSnapshots` row with `reason: "generated"` or `"copied"` in the same transaction and requires `report.editProse` on the target project. Adding a writer of either kind requires amending this list."
  - Record `prepareProjectContentCopy` lacking `requireReportEditAccess` as divergence #36 under AD-3/AD-7.

### High

#### H1. Data lifecycle is silent: cascade delete covers 8 of 49 project-scoped tables, and nothing except snapshots has a retention rule

- Where: no AD; the Operational envelope says "no ... backup, or retention policy"; Deferred row "Observability vendor, alerting, backup and retention policy".
- What is wrong: `deleteProject` (`convex/projects.ts:1025-1099`) deletes `transcripts`, `reports`, `comments`, `generations`, `commenters`, `pdReviews`, `pdReviewEvents`, then the project. `convex/schema.ts` has 49 tables with `projectId: v.id("projects")`. Orphaned on delete: `projectDocuments` (and their `_storage` blobs), `generationSources` (frozen client text, up to 20 x 500k + 50 x 200k chars per generation), `reportSnapshots`, `chatProposals`, `agentChatThreads`, `workItems`, `projectEvents`, `financialUploads`, `writerReviews`, `generationCandidateRuns`, and more. `generationSources`, `errorReports`, `aiUsage`, `reportCandidates` have no prune path at all. This is a divergence point today: a team adding a project-scoped table has no rule telling it to register for cascade or set a retention window. It is also a client-data erasure gap, which AD-6 handles for the Brain but nothing handles for projects.
- Fix: add AD-19 [TARGET] "Project-scoped rows follow the project". Proposed rule: "Every table with `projectId` is listed in `convex/lib/projectCascade.ts` with one of `delete | detach | keep`. `deleteProject` iterates that list; a schema test asserts every `projectId` table is listed. Storage ids referenced by a deleted row are deleted in the same sweep. Retention: `generationSources` for terminal generations older than N days, `errorReports` older than 90 days, `aiUsage` never (billing record). N is an open question." Move the "retention policy" phrase out of the Deferred row into this AD and leave only "observability vendor and alerting" deferred. Add divergence #37 (cascade covers 8/49) with evidence `convex/projects.ts:1054-1098`.

#### H2. AD-2 and AD-14 state "exactly N" writer lists that the code contradicts

- Where: AD-2 Rule ("Two sanctioned callers: `projectWorkflow.setWorkflowStage` and `workItems.create` with `confirmedStageChange`"); AD-14 Rule ("`ownerId` writers are exactly three").
- What is wrong:
  - `patchProjectWorkflowStage` has three callers: `projectWorkflow.ts:396`, `workItems.ts:302`, and `ownerBackfill.ts:223`. Additionally `workflowStage` is set directly at insert in `projects.ts:654,678`, `ingestionPort.ts:167,177`, `reviewFromProject.ts:101,126`, `seed.ts:80`.
  - `ownerId` is set at insert in `ingestionPort.ts:176`, `reviewFromProject.ts:125`, `seed.ts:79` in addition to the three listed.
  - An AD whose rule is "the list is closed" cannot be applied by a reviewer when the list is wrong; it also teaches the next author that inserts are outside the rule without saying so.
- Fix: in both ADs, distinguish insert from patch. AD-2: "Stage transitions on an existing project go through `patchProjectWorkflowStage`; callers: `projectWorkflow.setWorkflowStage`, `workItems.create` (`confirmedStageChange`), `ownerBackfill` (legacy rows). Inserts set `workflowStage: "intake"` and `workflowVersion: 0` only (`projects.createProject`, `ingestionPort`, `reviewFromProject`)." AD-14: "`ownerId` is patched only by the three listed; every insert sets `ownerId` to the acting user (`createProject`, `ingestionPort.ts:176`, `reviewFromProject.ts:125`)."

#### H3. Two Deferred rows are live divergence points

- Where: Deferred rows "Replacing `workItems.create` inline authority evaluator with `evaluateTransitionAuthority`" and "Observability vendor, alerting, backup and retention policy".
- What is wrong:
  - Stage authority is evaluated in two places (`convex/projectWorkflow.ts:64-99` and `convex/workItems.ts:247-263`). The spine's own divergence #4 says `workItems.create` "skips note/requirement policy". A team amending the matrix (Q1 will force this) changes one and not the other. "Duplicated policy is in sync today" is not true per #4.
  - Retention: covered in H1.
- Fix: remove the evaluator row from Deferred and add to AD-2 Rule: "Until the inline evaluator is removed, any change to `shared/workflowTransitions.ts` or `evaluateTransitionAuthority` must update `workItems.ts:247-263` in the same PR; `convex/workItems.test.ts` asserts parity for the `drafting -> internal_review` edge." Keep the refactor deferred, not the parity.

#### H4. Deployment is recorded as assumptions rather than decided or asked

- Where: Deployment topology diagram and Operational envelope: four `[ASSUMPTION]` tags (Vercel git integration on `main`, prod deployed from a laptop, prod Convex name, `repository_dispatch` wiring).
- What is wrong: an initiative spine owns deployment and environments. Q5 asks for the prod deployment name and deploy owner but not for the deploy mechanism or environment count. Two teams could diverge now: one adds a `convex deploy` step to CI, another keeps deploying from a laptop, and there is no staging to catch schema widen errors before prod.
- Fix: replace the assumptions with a decision plus one open question. Proposed AD-20 [TARGET] "Environments and deploy path": "Three Convex deployments: dev (per developer), staging, prod. Frontend deploys via Vercel git integration; backend deploys via `npx convex deploy` in a GitHub Actions job on merge to `main` using a prod deploy key; schema changes deploy to staging first with `convex deploy --preview` or an equivalent gate. `npm run check`, `npm test`, `convex codegen` diff check, and `vite build` run in CI." Fold Q5 into "name the prod deployment and who holds the deploy key". If the owner rejects staging, record that as the decision, not an assumption.

### Medium

#### M1. Run-row status vocabulary is not fixed

- Where: Consistency Conventions "Sanctioned write shape" (covers CAS and terminal-never-overwritten, not names).
- What is wrong: `generationCandidateRuns` uses `queued | running | succeeded | failed` (`schema.ts:1309-1311`); `chatTurns` and `researchRuns` use `queued | running | completed | failed` (`:835-838`, `:1562-1564`); `generationSectionRuns` uses `pending | queued | running | awaiting_review` (`:1338-1341`); `generations` uses `completed`. AD-1 tells every new AI filter to add "a durable run row" without saying what its status set is. The next two run tables will differ.
- Fix: add a convention row "Run rows: `queued -> running -> completed | failed`, plus `awaiting_*` for human-gated waits; `succeeded` is legacy on `generationCandidateRuns` and is not copied. Every run table has `by_status_and_startedAt` for the reaper and a `claim*` internalMutation."

#### M2. Tenancy is silent

- Where: AD-7 mentions "firm-wide for internal actors (decision D1)" but nowhere states the tenancy model.
- What is wrong: no `orgId` / `firmId` on any table; one deployment equals one firm. A team building a "second consulting firm" or a "client portal" would not learn from the spine that this is a single-tenant system with share tokens as the only external surface.
- Fix: add to AD-7 Rule: "Single tenant: one Convex deployment serves one firm; there is no org column and none is added without a new AD. External parties reach data only through `shareToken` (`client_review` scope) or `INGEST_API_KEY` (staging queue)."

#### M3. Blob storage is silent

- Where: no AD or convention mentions Convex `_storage`.
- What is wrong: `projectDocuments`, `financialUploads`, `ingestionItems`, and `documentUploadAttempts` reference storage ids; nothing says who deletes blobs, whether text is extracted client-side (`src/lib/parseDocument.ts`) or server-side, or the size cap (15 MB appears only for the HTTP endpoint).
- Fix: add a convention row "Files: bytes live in Convex `_storage`; text is extracted at upload and stored on the row (`content`); the row owns the blob and deletes it when the row is deleted; caps: 15 MB per file, extension allowlist in `lib/ingestionClassify.ts`."

#### M4. AD-1 enforcement claim is false

- Where: AD-1 Rule "Enforced by `svelte-check` path resolution plus review; no lint rule."
- What is wrong: `svelte-check` resolves any relative path; it does not enforce direction (C1 proves it: three `src -> convex/lib` imports pass `check`). The rule is "documented only".
- Fix: either say "documented only" or add an enforcing test: a vitest case in the `shared` project that greps `shared/**` for imports outside `shared/`, `src/**` for imports of `convex/` other than `_generated` and `lib/`, and `convex/lib/**` for imports of `convex/ai` or `convex/*.ts`. Cite it as the enforcing test.

#### M5. Testing strategy names runners but not obligations

- Where: Consistency Conventions "Tests" row; Q8; divergence #23.
- What is wrong: the spine names the vitest projects but gives no rule for what a unit must add. Several ADs cite "Enforcing tests" without saying that extending the guarded list requires extending the test. `tests/*.test.ts` (14 dead bun files) and 49 component tests outside CI show the current drift.
- Fix: add to the Tests row: "Every AD that names an enforcing test is extended in the same PR that extends its guarded list (AD-3 writers, AD-4 proposal writers, AD-7 capabilities, AD-9 call sites). New Convex mutations ship with a `convex-test` case for the authorization branch." Resolve Q8 direction: recommend "port the 14 bun files to vitest or delete; add `test:component` to CI on `src/lib/components/**` changes."

#### M6. Cost control has metering but no ceiling

- Where: AD-9 (metering); Deferred "Chat spend budget per project and user"; divergence #17.
- What is wrong: generation input is capped per source (500k x 20, 200k x 50) but not in total (`MAX_TOTAL_TRANSCRIPT_CHARS` unreferenced, #10). Chat sends every document at 20k each with no message cap. A unit adding a new agent has no ceiling to obey.
- Fix: promote to AD-9 Rule as [TARGET]: "Every action that calls a model declares a per-call input budget in tokens and a per-project daily spend ceiling read from `appSettings`; `instrument.ts` refuses the call when the ceiling is exceeded and records `BUDGET_EXCEEDED` in `aiUsage`." Keep the numbers as an open question if the owner has not set them.

#### M7. Operations: reaper and cron failure have no alert path

- Where: Operational envelope "Observability: `errorReports` table and `aiUsage` spend; no external error tracking, alerting".
- What is wrong: the system's correctness depends on crons (`failStaleGenerations`, `failStaleChatTurns`, nightly digests). If a cron throws for a week nobody is told. Deferring the vendor is fine; deferring "does anyone find out" is not.
- Fix: add open question Q9: "Who is notified when a cron or reaper fails, and through what channel (Convex dashboard alert, email, Slack)?" and add to the Observability convention: "Every cron writes a `cronRuns` row with outcome; `/admin/usage` shows the last run per cron."

#### M8. Route tree diagram is decorative

- Where: Structural Seed, "Route tree" mermaid.
- What is wrong: it is a grouped list of paths with no edges other than layout to group. A table with columns Path, Gate, Role would carry the same information in fewer lines and be greppable.
- Fix: replace with a table; keep the `WorkspaceGate` and `NameGate` facts as the Gate column.

### Low

#### L1. Citation drift

- AD-5: "`reserveGeneration` (`convex/generations.ts:398-497`)". The function starts at `:347` and ends at `:500`; `:398` is the `GENERATION_ACTIVE` throw. Fix: `:347-500`.
- AD-6: "`embedSource` no-ops otherwise, `brain.ts:296-318`". Lines 300-318 are `getBrainSourceForIngest` (an `internalQuery` returning null for non-approved rows); `embedSource` is the caller. Fix: "`getBrainSourceForIngest` returns null for non-approved rows (`brain.ts:300-318`), so `embedSource` no-ops".
- Consistency Conventions "Config": "`convex.config.ts:20-38`". The file is `convex/convex.config.ts`; env block is `:21-37`. Fix path.
- Divergence #22: "77 files use `font-bold` / `font-semibold`". Count today is 78. Minor.
- Stack "Node: unspecified". True for `engines` and `.nvmrc`, but CI pins `node-version: 22` (`.github/workflows/ci.yml:26`). Fix: "Node 22 in CI; no `engines` or `.nvmrc`".

#### L2. Rationale fragments

- AD-1 "(plan explicitly rejects both)", AD-2 "that is intentional until the narrow-phase decision", AD-9 "(Voyage rate limit)". Each is a why. Fix: delete or move to a source citation.

#### L3. `brain.ts` `assertAdmin` message strings

- Divergence #7 records the plain `Error`. The AD-7 Rule should also say "Brain admin gates use `requireCapability(ctx, "brain.curate")`" so the fix has a target capability; today there is no Brain capability in `shared/capabilities.ts` (20 capabilities, none Brain-specific). Fix: add Q10 "Add a `brain.curate` capability or keep role check?" or decide it in AD-7.

#### L4. AD-4 diagram label

- Sequence diagram step "`C-->>W: listMessages/syncStreams deltas`" precedes the tool call; harmless but reads as if the client receives deltas before the model runs. Reorder after `streamText`.

## Dimension coverage table

| Dimension | Status in spine | Finding |
| --- | --- | --- |
| Deployment and environments | Assumptions plus Q5 | H4 |
| Infra / provider strategy | Decided (Stack, AD-9) | none |
| Operations / observability | Convention row, vendor deferred | M7 |
| Data retention | Silent (except snapshot cap) | H1 |
| Deletion cascade / erasure | Silent for projects, decided for Brain | H1 |
| Blob storage | Silent | M3 |
| Migrations | AD-10 | none |
| Testing strategy | Convention row, Q8 | M5 |
| Error handling | Convention row, divergence #7 | L3 |
| Auth | AD-7, AD-18 | none |
| Multi-tenancy / visibility | Implicit via D1 | M2 |
| Cost control | Metering only | M6 |
| Run-row conventions | Partial | M1 |

## Verification log

Stack versions (all match): svelte 5.56.6, @sveltejs/kit 2.70.1, adapter-vercel 6.3.4, vite 8.1.5, typescript 5.9.3, tailwindcss 4.3.3, bits-ui 2.18.1, svelte-tiptap 3.0.1, convex 1.42.3, convex-svelte 0.14.0, @convex-dev/agent 0.6.4, @convex-dev/rag 0.7.5, @convex-dev/workflow 0.4.4, @convex-dev/workpool 0.4.8, @convex-dev/better-auth 0.12.5, better-auth 1.6.23, ai 6.0.230, @ai-sdk/anthropic 3.0.98, @anthropic-ai/sdk 0.82.0, vitest 4.1.10.

File:line claims checked and holding: `convex/lib/dashboardProjection.ts:149-166` (`patchProjectWorkflowStage`), `convex/lib/roleCapabilities.ts:43` (`requireCapability`) and `:82-105` (`requireReportEditAccess`), `convex/chatV2.ts:844` (`saveProposal` internalMutation), `convex/generations.ts:890` and `:1325` (claim mutations re-check `activeGenerationId`), `convex/ai/providers.ts:33-56` (maxRetries 1, 240 s) and `:97-107` (`clientForModel`), `convex/ai/promptProgram.ts:399-402`, `convex/auth.ts:22`, `convex/lib/contracts.ts:31`, `vite.config.ts:24-25`, `convex/projects.ts:677,682,1028`, `convex/learning.ts:173-183,287-334`, `convex/brain.ts:53-58,216-235`, `convex/ai/brainRetrieval.ts:149`, `convex/ai/chatAgentV2.ts:410`, `convex/ai/analyzerAgent.ts:172-174`, `convex/documents.ts:247`, `convex/ai/research/core.ts:47`, `shared/generationModels.ts:1`, `convex/lib/snapshots.ts:7` (HARD_CAP 50), `convex/generations.ts` 2,997 lines, 69 tables, 20 capabilities, 15 files in `tests/`, 49 component tests, `docs/product-domain.md:1509` stale cascade citation.

Claims found inaccurate: listed under C1, C2, H2, L1.

Mermaid: 11 blocks, all parse and render (flowchart x7, stateDiagram x2, sequence x1, er x1). Em dashes: none.
