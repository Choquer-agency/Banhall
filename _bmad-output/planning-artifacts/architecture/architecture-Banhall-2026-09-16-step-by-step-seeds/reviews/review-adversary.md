Verdict: **REVISE BEFORE BUILD, narrowly scoped.** The revision fixes most pass-1 problems and establishes a coherent topology. Remaining material gaps concern deterministic revision inputs, cross-section reference resolution and erasure during live work. Several additional producer/consumer choices are implementation contracts, not reasons to redesign the architecture.

Reviewer: `gpt-6-astra`, reasoning effort `medium`; adversary lens, pass 2, 2026-09-16. Architecture review only; no application tests executed. Counts: **critical 0, high 2, medium 4, low 0**.

## Pass-1 status

| Finding | Status | One-line assessment |
| --- | --- | --- |
| F01 | partially | AD-34/38 now prohibit live decision reads and require snapshots, but AD-33 does not specify a lossless snapshot codec for the canonical DTO and feedback target wording. |
| F02 | resolved | AD-35 supplies one role-aware tool schema carrying the advancement references used by approval. |
| F03 | resolved | AD-34 normalizes initial dispatch identity, adds command identity and includes retry in the operation vocabulary. |
| F04 | resolved | AD-33 separates Node actions from transactional mutations and publishes the writer matrix and generation lifecycle owner. |
| F05 | partially | Seed requests now have zero SDK retries and a bounded two-request envelope; the inherited five-slot ordered-action budget defect identified in pass 1 remains outside this repair. |
| F06 | resolved | Queued and running leases, prior-state restoration, dispatch-based allowance and conservative idempotent reaper settlement now have explicit rules. |
| F07 | resolved | AD-36 requires a recomputed server challenge and explicit acknowledgment lists; internal writes bump the stage version. |
| F08 | partially | Summary ownership and copied-source lineage are explicit, but the recovery source-map contract and cross-section reference resolution remain underspecified. |
| F09 | resolved | AD-44 defines Shown Set membership, generated DTO typing, bounded reads, history pagination and complete Summary reads. |
| F10 | resolved | AD-31/40 define initialization retry, phase projection and the separate post-sign-off recovery branch. |
| F11 | partially | Actor schema, view dedupe and feedback eligibility are improved, but reporting-period ownership and cross-window joins remain undefined. |
| F12 | partially | AD-36 specifies canonical serialization and per-role comparisons, but its feedback sort key is not a total order. |
| F13 | partially | One ordering helper now serves every consumer, but equal batch creation times and multiple revision groups still need an explicit total-order tie-break. |
| F14 | resolved | `activeStaleEpisodeId` prevents another open episode across revision restoration and subsequent changes. |
| F15 | resolved | AD-35 defines the tag values, word/sentence checks, mixed-form rule and feedback exemption. |
| F16 | resolved | AD-37 adds stable plan references, model attribution and merge metadata to coverage notes. |
| F17 | resolved | AD-34 restricts extension to project Owner or Admin and explicitly excludes the stage capability substitute. |

## Review scope and novelty

Requested inputs read:

- `_bmad-output/planning-artifacts/architecture/architecture-Banhall-2026-09-16-step-by-step-seeds/ARCHITECTURE-SPINE.md`
- `_bmad-output/planning-artifacts/architecture/architecture-Banhall-2026-09-03/ARCHITECTURE-SPINE.md`
- `_bmad-output/planning-artifacts/prds/prd-Banhall-2026-09-16/prd.md`
- `_bmad-output/specs/spec-step-by-step-seeds/SPEC.md`
- `_bmad-output/planning-artifacts/prds/prd-Banhall-2026-09-16/extract-codebase.md`
- `_bmad-output/planning-artifacts/architecture/architecture-Banhall-2026-09-16-step-by-step-seeds/reviews/review-adversary-pass1.md`

Locations below use the revised feature spine unless identified as parent, PRD or SPEC. The five new lower-level witnesses are P2-01 through P2-05. P2-01, P2-04 and P2-05 attack representations introduced by the revision, below the boundaries discussed in F12, F08 and F01 respectively; they do not assert that those original architectural fixes are absent. P2-02 and P2-03 concern new compositions. P2-06 is explicitly a retained F11 issue, **not** counted toward the request for four new pairs. The minor F13 tie-break residual is reported in the status table only, not counted again.

For each new pair, the alternatives implement the stated local rules but choose differently where the spine leaves a representation or composition rule open. These are not examples of ignoring an explicit frozen-input, challenge-equality or conservative-settlement requirement.

## Findings

### P2-01. Medium: Canonical feedback ordering still depends on retrieval order

**Units:** Mutation-side `seedRevisions` input assembly versus query-side revision reconstruction.

**Location:** AD-36, line 154; AD-33 feedback-request shape, line 117.

**Trigger condition:** Two active feedback requests belong to the same role and target the same seed.

**Two compliant local implementations:** The mutation assembles both requests in creation order; the query assembles them in reverse creation order. Each sorts exactly by the prescribed tuple `(role order, kind order, seedId)` and serializes sorted object keys. The requests tie on every prescribed key, so a stable sort preserves the different input orders. If feedback items omit the optional `seedId`, all feedback within a role ties.

**Incompatibility:** Identical active decisions produce different context hashes, so a query can report an unchanged batch as Outdated or reconstruct a different approval challenge. Unlike F12's missing canonical representation, this witness arises inside the newly specified representation: its comparator cannot distinguish valid repeated-target feedback items.

**AD change / guard snippet:** Give feedback DTO items a stable identity, preferably `feedbackRequestId`, and include it in the total sort key. Define duplicate-instruction semantics. Require mutation, dispatch and query assemblers to call the same DTO builder. Add a fixture with two requests on one target, opposite retrieval orders and equal instruction text.

**Potential consequence:** Spurious staleness and rejected approvals without a domain change.

### P2-02. High: The section-local plan does not define the meaning of cross-section seed references

**Units:** `signOffSeedStage` Summary serializer versus `generateOrderedSection` content-plan builder.

**Location:** AD-37, line 160; AD-33 `summaryItems`, line 119; parent AD-24; SPEC CAP-13.

**Trigger condition:** Build Order begins with Section 246, whose selected advancements reference writer-edited uncertainty and experiment selections in Sections 242 and 244.

**Two compliant local implementations:** Sign-off persists the required IDs and final wording in section-local Summary items. One section payload builder sends exactly the receiving section's Summary items, including those IDs, as AD-37 specifies. Another resolves the IDs against the complete immutable Summary and additionally supplies the referenced uncertainty and experiment wording. Both preserve Build Order, include all required Section 246 items and skips, and use only frozen data. The spine does not select between these payloads.

**Incompatibility:** The first model request contains opaque cross-section IDs with no corresponding writer wording. Prior drafted sections cannot supply the missing context when 246 runs first. The other builder supplies the writer's actual causal links. Both satisfy the stated payload checklist while giving the drafter materially different information about the same signed-off plan.

**AD change / guard snippet:** Define a section-plan DTO with a reference dictionary containing the immutable Summary items reached by every `uncertaintySeedId` and `experimentSeedIds` reference. State that these are supporting context, not additional roles to draft. Resolve through `summaryVersionId`, never live selections. Include this closure in the sign-off token-budget check.

**Potential consequence:** A formally linked advancement is drafted against analyzer or Brief wording rather than the writer's signed-off uncertainty and experiments.

**Verification:** With Build Order 246 first, edit linked uncertainty/experiment wording before sign-off, then assert those exact frozen values appear in the 246 provider request and in a recovery request.

### P2-03. High: Paginated erasure has no fence against workers recreating already-purged rows

**Units:** Registry-driven `deleteProject`/purge pages versus an already-claimed `seedRuns.completeAttempt`.

**Location:** AD-45, line 208; AD-34, line 142; parent AD-19.

**Trigger condition:** A seed action claims before project deletion, then completes between purge pages.

**Two compliant local implementations:** The registry enumerates seed tables before generations and deletes their current rows in pages. Completion checks the mandated `pendingBatchId` and generation `awaiting_input` state; both still match until the generation page runs, so it inserts new seeds, provenance and events. A second registry implementation deletes or terminalizes the generation first and prevents that completion. Both list every project-scoped table, paginate deletion and retain the existing cleanup hooks. Neither AD-45 nor the parent declares the lifecycle ordering/fence shared with late writers.

**Incompatibility:** The first traversal can pass the seed tables, then receive new client-derived rows behind its cursor. Completing the remaining registry traversal does not erase those rows. Table-registration coverage is insufficient to prove erasure under live work.

**AD change / guard snippet:** Establish a durable deletion barrier before scheduling pages. Specify which project/generation predicate every asynchronous writer must check, and whether deletion first terminalizes generation/run rows or requires a tombstone. Keep cleanup identifiers available until blob/component cleanup succeeds. Purge completion must establish that no writer can repopulate the project.

**Potential consequence:** Client-derived seed content survives an apparently completed project deletion.

**Verification:** Claim an attempt, start deletion, purge its target tables, deliver completion, finish deletion and assert no retained seed content or newly orphaned cleanup work.

### P2-04. Medium: `sourceIdMap` names a mechanism without specifying its interchange contract

**Units:** `retryFromSummary` source copier versus provenance resolution in recovery drafting and Summary disclosures.

**Location:** AD-37, line 160; AD-33 generation additions, line 120; parent AD-5/23; SPEC CAP-13.

**Trigger condition:** A retry consumes Summary seed citations or frozen Brief entries whose source IDs belong to the origin generation.

**Two compliant local implementations:** The copier stores `{originSourceId: recoverySourceId}` for each copied row. Another implementation stores `{recoverySourceId: originSourceId}` and uses reverse lookup in its own citation resolver. Both copy the origin's frozen bytes, store a `sourceIdMap`, preserve hashes and resolve citations without rereading current inputs. A consumer built for the opposite orientation cannot use the other's map. Retry-of-retry also needs an explicit statement that the map is origin-to-current, rather than previous-attempt-to-current.

**Incompatibility:** Source-copy and provenance units cannot be independently implemented against the stated field alone. Hash equality is not a safe replacement for identity when two frozen rows contain identical content. This is a new mapping-format pair below F08's now-settled copying/ownership decision.

**AD change / guard snippet:** Publish `sourceIdMap` as a typed collection of `{originSourceId, recoverySourceId}`, require a complete bijection over copied origin rows, and name one resolver used for seed and Brief citations. Reject a missing mapping rather than silently selecting a same-hash source. Always normalize through `summaryVersions.originGenerationId`.

**Potential consequence:** Missing or misassociated provenance on otherwise successful recovery runs.

**Grade:** This is an implementation contract, not a missing architectural strategy. Copying versus sharing and immutable Summary ownership have been settled.

### P2-05. Medium: Snapshot persistence and snapshot-only prompt assembly lack a shared codec

**Units:** `seedRuns.dispatch` snapshot writer versus `ai/seeds.generateBatch` snapshot reader.

**Location:** AD-33 `seedBatchContext`, line 114; AD-34, line 142; AD-36, line 154; AD-38, line 166.

**Trigger condition:** A selected seed has two bullets, or a feedback attempt must retain target wording in addition to its instruction.

**Two compliant local implementations:** A dispatcher writes one context row per decision, encoding the bullet array and feedback target into the declared `text` field as JSON. Another writes multiple ordered rows, one per bullet or target component, and reconstructs the same canonical DTO before hashing. Both preserve the exact canonical decision payload, contribution hashes, immutable target wording and snapshot-only reads. The declared row schema selects neither representation and has no `bullets`, `targetWording` or feedback-request identity field.

**Incompatibility:** A JSON-decoding action and a row-grouping action cannot consume each other's valid persisted snapshots. Ad hoc joins to current `seedSelections` or feedback rows would violate the now-correct no-live-read rule. Unlike F01's missing snapshot, this witness assumes an immutable snapshot exists and attacks its newly introduced wire representation.

**AD change / guard snippet:** Declare a versioned discriminated context-row DTO, or a single pure `encodeBatchContext`/`decodeBatchContext` contract owned with `seedRevisions`. Include exact bullet boundaries, feedback request identity, target seed identity and frozen target wording. Assert encode/decode round trips and provider-request bytes after later edits and withdrawal.

**Potential consequence:** Lost bullet boundaries, malformed feedback prompts or an implementation forced to violate snapshot isolation to recover missing data.

**Grade:** A lower-level serialization contract. F01's architectural solution is sound; this does not justify replacing it.

### P2-06. Medium: The metric reader still has no reporting-period ownership rule

**Units:** Append-only `seedDecisionEvents` producer versus `learningHealth` period query.

**Location:** AD-39, line 172; PRD FR-34 and SM-5/SM-6; SPEC CAP-15. Retained portion of F11, not a new-pair count.

**Trigger condition:** Feedback is requested before the reporting period, completes during it and is approved after it; a stale episode similarly crosses the period boundary.

**Two compliant local implementations:** Reader A selects generations initialized in the requested period and loads their complete event histories. Reader B selects events occurring in the period and resolves related requests, approvals and episode rows across windows. Both are bounded, use the seeds-workflow cohort, exclude cancelled/development generations and freeze scoring at the first eligible approval. A worked trace entirely within one period cannot distinguish them.

**Incompatibility:** The same request or resolved episode appears in different periods, and active-time gaps crossing the boundary are included differently. Counts cannot be compared meaningfully without naming the ownership rule and the result's as-of cutoff.

**AD change / guard snippet:** Choose the attribution timestamp for each count and duration, define `[from, to)` in the existing firm-time convention, require cross-window joins needed for an attributed entity, and expose a truthful incomplete/truncated result when the read budget prevents those joins. Specify whether historical reports are recomputed as of now or frozen at the period end.

**Potential consequence:** Administrators receive inconsistent feedback success, stale-duration and effort figures from otherwise compliant readers.

**Enforcement limitation:** The referenced `spec-step-by-step-seeds/build-sequence.md` worked trace is narrative: it uses `batchShown`/`staleOpen`/`staleClose` rather than the revised event-kind union and supplies no timestamps or numeric exposure totals. Its SM-3 numerator, one selected resolved feedback outcome and four-open/two-resolved episode example are useful fixtures, but do not establish period-boundary or active-duration expected values. Convert it into actual producer-schema events with timestamps and expected query results; do not claim that naming the trace proves compatibility.

**Grade:** Measurement contract, not pipeline architecture. The feedback actor and immutable-score fixes remain valid.

## Boundaries that do not warrant new architectural findings

- **Approval challenge producer versus consumer:** AD-36 binds the consumer to the exact recomputed query challenge and acknowledgment lists, while AD-33 requires stage-version bumps for internal writes. Independent implementations that ignore those requirements are noncompliant, not alternative architectures. Challenge object typing, exclusion-matcher fixtures and empty carried-list presentation are implementation work.
- **Reaper versus settlement:** AD-34 explicitly settles unknown usage at reserved capacity and uses `settledAt` for idempotence. Permanently conservative accounting after a late result is permitted by this rule. A refund-on-reap implementation would contradict it. Define ordinary settlement arithmetic in implementation tests, but do not reopen F06 merely because late refunds are not promised.
- **Sign-off versus chain ownership:** The new `candidateRunId`, explicit `summaryVersionId`, named ordered-chain entry points and no-second-gate rule settle the previous topology ambiguity. P2-02 concerns reference closure, not a missing chain.
- **Registry contents:** AD-45 correctly makes the whole-schema registry a prerequisite and preserves existing storage/Brain cleanup. P2-03 concerns concurrent lifecycle behavior, not another request to enumerate tables.

## Grade

Five new lower-level pairs and one retained metric issue are reported, with no minimum-issue quota applied. P2-04 and P2-05 should become shared types/helpers and paired tests rather than additional architectural machinery. Resolve P2-01 through P2-03 and pin P2-06's reporting semantics before accepting the spine as independently buildable. Existing owner-approval gates C1, C2 and C4 remain explicit governance prerequisites, not newly discovered findings. Tests named by the revised spine are planned enforcement, not evidence of executed verification.

## Reviewed input fingerprints

SHA-256, rechecked unchanged when the report was saved:

| Input | SHA-256 |
| --- | --- |
| `_bmad-output/planning-artifacts/architecture/architecture-Banhall-2026-09-16-step-by-step-seeds/ARCHITECTURE-SPINE.md` | `c4a14ef816e34d5ed5ed10594089a0f61aa39f3c2f05278948766d4dd7ef1ef9` |
| `_bmad-output/planning-artifacts/architecture/architecture-Banhall-2026-09-03/ARCHITECTURE-SPINE.md` | `7ca17e816679db98f3a02388df442423d9c9a598781b22dc060124c2d999cd14` |
| `_bmad-output/planning-artifacts/prds/prd-Banhall-2026-09-16/prd.md` | `987fe4f97f75ab153f618c3b50dd672c20ec81c337cf2aed2a4dc65bd882e439` |
| `_bmad-output/specs/spec-step-by-step-seeds/SPEC.md` | `93f406d6f72c5c68904e15c9df1b8ac2c5befd701351cc1316101d6df1104664` |
| `_bmad-output/planning-artifacts/prds/prd-Banhall-2026-09-16/extract-codebase.md` | `3cb7720ce1b4c0235318a49023a9837d29a165819d4dca0702690b6de62439f2` |
| `_bmad-output/planning-artifacts/architecture/architecture-Banhall-2026-09-16-step-by-step-seeds/reviews/review-adversary-pass1.md` | `2d3671e7fa9ed9e4dd42d490e199c78b9248587b1f06cff65d656fc8704a63f4` |
