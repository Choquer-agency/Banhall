Verdict: REVISE BEFORE BUILD. The spine does not yet make independently implemented units interoperable.

Reviewer: `gpt-6-astra`, reasoning effort `medium`; adversarial lens; 2026-09-16. Counts: critical 0, high 13, medium 4, low 0.

The four requested documents were read. References below use feature AD numbers, parent AD numbers, and PRD FR numbers as stable locations. Existing enforcing tests were inspected as source, not executed. This is an architecture review, not a claim that an unimplemented feature passed or failed its test suite. No application code or architecture decisions were changed.

Input refresh: the PRD changed concurrently during review from 70,963 bytes (`a12a1d6e269bc24a603b2a6e12b88a72a72a3436501d708cd7db28b2eb24fa51`), through an editorial revision, to 71,591 bytes with status `final`. The final snapshot was reread from `/private/tmp/banhall-adversary-prd-reviewed.md`. The original sixteen findings remain; its changed NFR-3 authority rule adds F17. The fingerprint below identifies that reviewed snapshot, not any later edits to the live input. The other three input fingerprints were unchanged.

Input SHA-256 fingerprints:

| Input | SHA-256 |
| --- | --- |
| Feature `ARCHITECTURE-SPINE.md` | `dd3d1904bf8c45aa84841800b71c6e489493addc3b93687f9997ba1213e56ec8` |
| Parent `architecture-Banhall-2026-09-03/ARCHITECTURE-SPINE.md` | `7ca17e816679db98f3a02388df442423d9c9a598781b22dc060124c2d999cd14` |
| `prd-Banhall-2026-09-16/prd.md` | `987fe4f97f75ab153f618c3b50dd672c20ec81c337cf2aed2a4dc65bd882e439` |
| `prd-Banhall-2026-09-16/extract-codebase.md` | `3cb7720ce1b4c0235318a49023a9837d29a165819d4dca0702690b6de62439f2` |

“Pair hole” below means independently chosen representations or boundary behavior that the ADs do not settle. “Contradiction” means two explicit instructions cannot both be followed; those are not counted as examples of obeying every AD. In particular, F07, F09, F12, F13, F14 and F16 give six pairs whose competing choices are left open by the literal ADs. F01 and F08 additionally expose missing cross-unit contracts whose incorrect composition violates the intended end-to-end invariant.

## Findings

### F01. high: A dispatch revision does not freeze the data the action consumes

**Units:** `convex/seeds.ts` batch dispatch versus `convex/ai/seeds.ts` input assembly. **Location:** AD-33, AD-34, AD-36, AD-38; PRD FR-5, FR-8, FR-40. **Kind:** pair hole at the scheduling boundary.

**Witness and incompatibility:** Dispatch stores revision R0, its Brief id, and an attempt id, exactly as AD-34 says. Before the scheduled action reads its input, another writer changes a predecessor to R1. The action follows AD-38 by loading active predecessor selections and active feedback, then generates from R1. Completion follows AD-34 by retaining the immutable R0 and showing the result Outdated. A separate implementation that snapshots decisions at dispatch generates from R0. Both follow the specified local read/write steps, but only the latter makes the record's claimed consumed revision true. There is no persisted decision payload, historical wording pointer, or revision-addressed input query in the ten-table contract. Keeping original AI bullets does not reconstruct a previous human edit or withdrawn instruction.

**AD change:** Tighten AD-34/36: dispatch atomically persists an immutable input snapshot, or immutable child references with the exact final wording and active feedback, and hashes that snapshot. The action must read only that snapshot. Name the snapshot owner, its budget, and the exact fields included. Never relabel a live read with the dispatch hash. If a claim-time snapshot is preferred, explicitly change when the consumed revision and dedupe key freeze.

**Enforcing test adequacy:** The proposed immutable-revision assertion in `convex/seeds.test.ts` would accept the lying R0 record unless it captures the provider request. Add a dispatch/R1-edit/claim interleaving and assert the request bytes, stored revision, and Outdated flag together. The file does not exist yet.

### F02. high: The forced output schema cannot carry the advancement links that approval requires

**Units:** seed action tool decoder versus `seeds.approve`/`signOff`. **Location:** AD-35, AD-36, AD-38, AD-43; PRD FR-8. **Kind:** contradiction.

**Witness and incompatibility:** AD-38's explicit schema returns only bullets, tags, and provenance. The prompt asks role 11 to name uncertainty and experiment ids, but neither `uncertaintySeedId` nor `experimentSeedIds` is in the schema. An exact schema implementation strips or rejects those fields. The approval implementation correctly refuses every selected advancement without them. Putting ids in bullet text does not satisfy the structured reference contract, and human edits explicitly cannot repair references. A second implementer adding fields has silently amended the declared tool contract.

**AD change:** Make the output schema a shared, role-aware contract. For role 11, include typed uncertainty and experiment references, validate membership in role 5 and role 9 active selections of the same generation, and validate at least one experiment when required. Specify behavior before experiments exist. Use it for normal and feedback outputs, persistence, approval, and sign-off. Preserve the PRD's merge rule for two selected advancements referencing one uncertainty.

**Enforcing test adequacy:** “Unlinked advancement refused” proves the dead end, not the producer/consumer compatibility. Existing `selfCheck.test.ts` has no seed contract. Add real tool-response validation through completion, selection, approval, and sign-off; include wrong-role, foreign-generation and inactive ids, plus feedback repair of missing links.

### F03. high: Open and prefetch cannot share the fingerprint AD-34 defines

**Units:** `approve` prefetch dispatcher versus writer-open dispatcher. **Location:** AD-34, AD-42. **Kind:** contradiction.

**Witness and incompatibility:** Prefetch stores `hash(G, role, "prefetch", R)`. Opening the same role computes `hash(G, role, "open", R)`. AD-42 demands a match by the shared fingerprint, but including `kind` makes the keys different. The one-pending guard then rejects the writer's open instead of reusing the work. Separately, the schema's kind union excludes `retry`, although AD-34 inserts and counts that kind. Repeated explicit regeneration at the same context also produces identical fingerprints, so a generic uniqueness implementation can accidentally prevent the second deliberate regeneration.

**AD change:** Specify one pure dispatch-identity helper with distinct concepts: durable unique attempt id, normalized initial-load dedupe key shared by open/prefetch, and writer command id for retriable explicit requests. Dedupe only the stated in-flight states; an explicit later regeneration receives a fresh command/attempt even at the same revision. Either include retry in the kind union or model it as a new attempt of a named kind consistently.

**Enforcing test adequacy:** The proposed `prefetch once; open reuses in-flight` case would detect this only if it runs the two public entry points and their actual fingerprint helper. Add simultaneous open/prefetch, two sequential regenerations at unchanged R, and a transport-redelivered command. There is no current seed test file.

### F04. high: The closed writer list and runtime homes make the named implementation impossible

**Units:** `convex/ai/seeds.ts` action/terminal writers versus `convex/seeds.ts` and `convex/generations.ts` mutations. **Location:** AD-31, AD-33, AD-34, AD-36, AD-37; Structural Seed; parent AD-2; extract §8.6. **Kind:** contradictions in ownership and runtime.

**Witness and incompatibility:** The structural seed places Node action `generateBatch` and `claim/complete/fail` internal mutations in `convex/ai/seeds.ts`. The existing AI modules use Node, while the local Convex guidelines explicitly prohibit mutations in a `"use node"` file. The closed list also omits `initializeSeedStage` from allowed `seedSubsections` inserters and omits completion/reaper writers of subsection state and system events. `edit` explicitly patches `seeds.support` although its listed writable tables exclude `seeds`. `signOff` in `convex/seeds.ts` writes `generations.status`, while inherited AD-2 allows that status to be written only by `convex/generations.ts`. These cannot be resolved by following the list literally.

**AD change:** Publish a mutation-by-table ownership matrix, including initialize, claim, terminal settlement, cancel, reaper, support restoration and sign-off. Put Node actions in `convex/ai/seeds.ts` and transactional internal mutations in a default-runtime module with corrected API paths. Keep the public sign-off transaction and generation-state helper in one transaction; explicitly amend AD-2's ownership if a shared transaction helper is authorized. Define `pendingBatchId: Id<"seedBatches">` separately from the fresh attempt token; AD-34 currently sets `pendingAttemptId` but compares it with `batchId`.

**Enforcing test adequacy:** A writer-list test must parse actual registrations and database writes, not assert a manually maintained list. Typecheck/codegen catches runtime/id incompatibilities but cannot prove one transactional owner. The named seed and erasure tests are absent. A behavioral test should prove every listed transition is reachable, authorized, and leaves matching generation/subsection/batch state.

### F05. high: Two repair requests can mean four transport attempts and more than 600 seconds

**Units:** seed structured-output action versus provider retry/timeout configuration; also the inherited ordered section action versus its budget test. **Location:** AD-34/38 and parent AD-9/24/27; `convex/ai/providers.ts:33-102`, `structured.ts:10-15,76-132`, `providers.test.ts:27-127`. **Kind:** budget composition gap with a misleading enforcement claim.

**Witness and incompatibility:** A seed action makes two structured-output calls, as required. Each direct Anthropic call inherits one SDK retry and a 240-second per-attempt timeout. A first transport retry eventually returns malformed output; the repair call retries too. The envelope is `2 × 2 × 240 + 60 = 1020 s`, before any provider Retry-After beyond the reserve. A reservation of two is also not a bound of two outbound requests under NFR-3's literal every-request wording. Separately, the ordered chain's five slots already represent up to `5 × 2 × 240 + 60 = 2460 s`. Five named slots do not establish a 600-second bound. Allowlist acceptance establishes neither of these properties.

**AD change:** Define “request” at the transport boundary and make transport retries spend the same attempt reservation, or explicitly change the product counting definition. Give each action an absolute deadline and a shared remaining request budget propagated through repair and provider retry, with bounded backoff. State how the five-slot ordered chain fits its deadline or split it further. Preserve the existing single/compare behavior unless an approved change explicitly covers it.

**Enforcing test adequacy:** `providers.test.ts` proves one slot fits and explicitly asserts the whole five-slot chain exceeds the action limit. Its ordered test again multiplies only one slot. `selfCheck.test.ts:427-440` counts five calls for a valid self-check response; it does not exercise structured repair plus transport retry. `instrument.test.ts:158-217` mocks SDK `messages.create`, proving two logical calls, not HTTP attempts. Add transport-stubbed timeout/retry/invalid-output composition with a simulated clock and assertions on total HTTP attempts, reservation settlement, and deadline abort. Merely adding two slot names cannot detect this divergence.

### F06. high: The reaper cannot recover every pending attempt and has no budget settlement contract

**Units:** `claimSeedBatch`/`failBatch` versus the seed extension of `failStaleGenerations`. **Location:** AD-33/34; PRD FR-27, NFR-3. **Kind:** recovery gap and incomplete shared accounting.

**Witness and incompatibility:** Dispatch sets pending and reserves two calls, but its scheduled action dies before claim. The row remains queued, with optional `startedAt` absent. The prescribed reaper scans only running rows by startedAt, so it never clears that pending attempt; the parent generation is intentionally never reaped. For a running timeout, the reaper is told to fail/clear/restore but is not told how to settle requests, count an initial attempt, or preserve prior state. A later completion must write `late`, while inherited conventions say terminal status is never overwritten. Refund-on-reap and retain-until-completion are both plausible local accounting choices; the former can admit extra calls while the latter can strand capacity permanently. The spec also increments the initial allowance on failures but does not give a complete dispatch-based attempt accounting rule or ordinary-retry transition after three failures.

**AD change:** Add `queuedAt`/`leaseExpiresAt`, queued and running recovery ranges, explicit prior-state storage, and one idempotent settlement mutation called by fail, complete and reaper. Define reservation disposition when actual usage is unknown; preserve conservative consumption until independently reconciled. Model late result receipt separately from immutable terminal outcome. Track allowance by durable attempt identity, including reaped attempts; after exhaustion permit ordinary budgeted retries exactly as FR-27 requires.

**Enforcing test adequacy:** A single over-lease running fixture misses queued loss, dead-action usage, and late reconciliation. `generationReaper.test.ts:182-213` currently tests project-pointer sweep scheduling; `generationRecovery.test.ts:334-383` tests compare candidate terminalization, not seed accounting. Add queued-before-claim loss, timeout after one request, late arrival after a replacement attempt, repeated reaper pages, and the fourth ordinary retry. Assert counts, reservations, current pointer and one terminal outcome together.

### F07. high: Approval can record confirmation the writer never gave

**Units:** `SeedSubsectionPane`/Summary Review versus `seeds.approve` and batch completion. **Location:** AD-34, AD-36, AD-37, AD-41. **Kind:** literal pair hole.

**Witness and incompatibility:** The UI renders ordinary Approve from version V and the query's then-current carried-item list. A pending batch completion changes the shown batch or its Outdated status. Internal completions are outside the client version fence, and no rule says they increment `seedStageVersion`. The writer's version V still passes. `approve` follows the stated rule by automatically storing `approvedWithConfirmation = true` because the current shown batch is now outdated. The UI also followed its rule by rendering the query it received. The audit now claims an explicit confirmation that the writer did not see. Even without a race, the declared mutation has no required acknowledgment argument for either carried items or Claim Exclusions.

**AD change:** Return a server-owned approval challenge containing selected-item hashes, relevant batch/revision identities, changed roles and exclusion ids. `approve` requires that challenge plus explicit acknowledgments when needed and refuses if the challenge changed. Define which internal changes invalidate the challenge independently of the writer command version. Do not infer human confirmation from the existence of a condition.

**Enforcing test adequacy:** “Carried selections force confirmation” can pass by inspecting the stored boolean alone. It must assert refusal without acknowledgment and refusal of a challenge rendered before an internal completion. Pair a component test with a real mutation interleaving; no current named test exercises this boundary.

### F08. high: A retry generation and its reused Summary disagree about who owns the items and sources

**Units:** `generations.retryFromSummary` versus `getSummary`/ordered section input loading. **Location:** AD-33/37 and the ER diagram; parent AD-5/23. **Kind:** pair hole in immutable ownership.

**Witness and incompatibility:** Retry G2 copies `summaryVersionId = S`, whose summary row belongs to G1. The declared child shape for `summaryItems` has generationId but no `summaryVersionId` foreign key; its index is only by_generationId. A reader scoped to active G2 sees no items, while a reader joining S then G1 obtains the plan. Both follow named ownership/index hints. “Frozen sources reused” is similarly ambiguous between sharing G1 source rows and copying their bytes to G2 ids. Existing source citations, summary seed ids, and Brief entries still point at G1. Copying and sharing need different validation and erasure behavior. The ER diagram implies a Summary-to-items relation the schema never defines.

**AD change:** Add an explicit immutable `summaryVersionId` foreign key and ordered index to `summaryItems`. Define the Summary's origin generation separately from drafting generations that consume it. Choose source sharing or id-remapped copies and specify citation identity, project checks, retained original rows, and retry lineage accordingly. Require every chain read to resolve through S, never to infer plan ownership from the current generation. Include the frozen effective writer settings and analysis artifacts in the retry payload contract.

**Enforcing test adequacy:** “Retry reuses summary” can pass by checking only the copied id. `generationLifecycle.test.ts` currently exercises legacy approval and assembly. Add G1 failure, G2 retry, and G3 retry-of-retry; assert identical plan bytes, source references, settings and provider content blocks, with no analysis/Brief/seed work repeated.

### F09. high: A five-seed query is not a Shown Set contract

**Units:** `seeds.getSubsection`/`getOutline` versus `SeedWorkspace`/`SeedCard`. **Location:** Consistency Conventions “Queries”, AD-33/41/43; PRD glossary, FR-10/12/13/39, NFR-6. **Kind:** literal pair hole.

**Witness and incompatibility:** One server returns `{batchSeeds, selections, provenance}` with at most five batch seeds, as the query convention says; another returns a flattened, server-ordered Shown Set with old selected cards and feedback revisions. Both are compatible with the AD's unnamed return shape, but a client built for either breaks against the other. A five-seed batch plus three unselected feedback revisions already needs eight visible seeds. After regeneration, an earlier original can be unselected yet must remain available for the promised re-tick restoration. The schema has no explicit Shown Set membership relation, no feedback/history pagination contract, and no complete/partial signal in the specified query signature. `createReadBudget` bounds work; it does not decide what omitted rows mean.

**AD change:** Define server DTOs and a single `buildShownSet` policy: current batch, relevant original/revision groups, carried selections, immutable ordering, outdated reasons, approval challenge and stage version. Define separate paginated history/revision reads with cursors and truthful completeness. State how deselecting a carried original affects its continued availability. The client renders these DTOs and never reconstructs approval/readiness from a capped list. Bind component schemas to generated/shared types.

**Enforcing test adequacy:** Checkbox/disabled-Approve component fixtures can pass with five hand-authored cards while real queries omit revisions. Test five originals plus several feedback batches, carried and deselected originals, restoration, role navigation during stable-query retention, and row/byte-budget truncation. Readiness must not become true from partial reads. The named seed component tests do not exist yet.

### F10. high: Initialization and post-sign-off recovery have no complete lifecycle boundary

**Units:** `startIterativeGeneration`/`initializeSeedStage` versus `getIterativeState`, project hosts and the reaper. **Location:** AD-31/37/40/41; parent AD-5/24; `generations.ts:3340-3408`. **Kind:** missing transition contract with conflicting inherited paths.

**Witness and incompatibility:** AD-31 says the mutation inserts thirteen rows and sets awaiting_input; if that transaction fails, neither effect commits, yet it also requires the generation to remain awaiting_input with a persistent failed initialization state. No row/field, failure writer, retry API or idempotency key is defined for that state. A query cannot distinguish not-started, running initialization, and failed initialization from absent rows alone. After sign-off, the same `iterative` row now runs an ungated chain. The current reaper's iterative branch sends stale section runs back to awaiting_input with “regenerate to retry”, while AD-40 refuses legacy regeneration for seeds and AD-37 requires a failed terminal generation and a new Summary retry. Merely calling the resolver does not specify which post-sign-off recovery branch it selects. AD-41 additionally refers to `seedStage` being true even though AD-40 declares a three-string enum and workflow-based routing.

**AD change:** Specify persistent initialization state, transaction boundaries and a named idempotent retry writer. Freeze settings/Brief once, enter the waiting stage durably, then initialize or record failure without rerunning analysis. Define a server phase projection distinguishing initializing, seed work, drafting, failed drafting and completed Summary access. In recovery, `(gatedWorkflow=seeds, summaryVersionId present)` uses ordered-chain terminal failure; legacy sections retain their existing recovery. Remove boolean `seedStage` routing and state exactly when the workspace yields to generation progress/editor.

**Enforcing test adequacy:** `promptProgram.test.ts:539-573` currently requires legacy iterative section review and a ghost; `ReportLoading.component.test.ts:73-89` only checks which query activates for compare/iterative. Neither checks seed initialization or the drafting handoff. Add failed transaction, duplicate startup, fresh reservation before rows, retry, day-old human wait followed by sign-off, stale ordered section after sign-off, and both hosts transitioning to the report. Preserve a separate legacy fixture.

### F11. high: Event producers, dedupe and learning-health disagree on the event contract

**Units:** `seedDecisionEvents` writers/schema versus `markBatchViewed` and `learningHealth`. **Location:** AD-33/39; PRD FR-33/34, SM-5/6. **Kind:** schema contradiction and incomplete metric contract.

**Witness and incompatibility:** AD-33 requires `userId: Id<users>` on every event; AD-39 requires `actor: {userId} | {system:true}`. System completions cannot satisfy the first without inventing a user. The only declared indexes are by_generationId and by_at, but AD-39 requires view dedupe by `(batch,user)` using an index. Neither index serves that equality lookup. The reader's three feedback outcomes (“selected at next approve / unresolved / withdrawn”) also collapse PRD distinctions: not selected, response not available at that approval, and independent withdrawal after a frozen score. Two readers can disagree about a late feedback response, or revise a previously selected outcome to withdrawn. Global period reads can split a request, response and approval across windows unless cohort and joining rules are fixed.

**AD change:** Declare one discriminated event schema, with generation-wide events not forced to invent a subsection role, and named system event writers. Add a typed actor identity usable in an index such as `(batchId, actorUserId, kind)` for view dedupe, with transactional uniqueness. Specify feedback outcome at the first eligible approval after response availability, immutable score and separate withdrawal state; define event ordering for equal timestamps, cohort window, cross-window joins, cancelled/development exclusions and partial-result disclosure. Bind the worked trace to a versioned shared expected result rather than an informal reference alone.

**Enforcing test adequacy:** Existing `learningHealth.test.ts:291-320` proves shared budgets and truthful truncation for reports/scores/reviews, not seed metrics. Text-free-event assertions miss actor shape, duplicates and outcome drift. Add the late-response/next-approval/withdrawal trace, concurrent first views by the same user and different users, and a period boundary between response and approval.

### F12. medium: The hash contract omits canonical bytes and cannot explain what changed

**Units:** `seedContract` revision builder versus `getOutline`/approval explanation reader. **Location:** AD-33/36. **Kind:** literal pair hole.

**Witness and incompatibility:** AD-36 centralizes hashing but does not define the representation supplied to it: ordering of selections and feedback, whether absence differs from empty, whether inactive feedback is omitted or represented, and how final wording is paired with sorted seed ids. Two valid `canonicalJson` inputs representing the same domain decisions can have different array order and hashes despite both being stable under object-key order. More fundamentally, a batch stores only an aggregate context hash. A reader can list every intervening mutation's role, or only roles whose current contribution differs from the batch's contribution; both satisfy “changed roleIds” but disagree after an upstream edit is restored. The stored hashes alone do not identify the difference.

**AD change:** Define a versioned canonical decision DTO, sort keys for all collections, exact bullet/string treatment and seed-to-wording pairing. Store per-role contribution hashes or revision-addressed snapshots at dispatch and approval. One helper computes current diffs against those snapshots and returns the precise reason DTO to every query. State whether a restored contribution counts as changed for display and confirmation.

**Enforcing test adequacy:** “Revisions stable under key order” detects only object-key permutations. Add permutations of selection/feedback database insertion order, absent/empty fields, edit-then-restore, and exact changed-role explanations for two different consumed snapshots. Existing seedContract tests are absent.

### F13. medium: Multiple-item order has two equally legal owners

**Units:** Summary query/sign-off serializer versus section content-plan builder. **Location:** AD-32/33/36/37. **Kind:** literal pair hole.

**Witness and incompatibility:** Both units use FR-2 role order, exactly as required. Within experimentation, one preserves selection time; the other sorts batch/order or seed ids. The schema only gives `seeds.order` local to a batch, `summaryItems.order` without a defined scope, and no selection position. The selection hash explicitly sorts ids, so it does not detect these ordering differences. With two carried seeds from different batches, both can have `order=1`. The writer can approve experiments in one order while the content-plan list uses another without violating a stated total-order rule.

**AD change:** Specify one total item order across original, revised and carried selections, including tie-breakers and whether selection order is meaningful. Persist that order in the immutable summary and make every reader use it. If order is a writer decision, include it in selectionRevision and require reapproval after changes; otherwise declare it a deterministic presentation order and use the same helper throughout.

**Enforcing test adequacy:** The shared vocabulary bijection/order test covers thirteen roles, not seeds within a role. Add cross-batch equal-order items and feedback replacements, then assert query, approval snapshot, summaryItems and provider plan have identical order.

### F14. medium: Content-addressed revisions can open a second stale episode before the first is disposed

**Units:** predecessor mutation stale detector versus stale-episode reader/approval disposer. **Location:** AD-33/36/39; PRD FR-17/18. **Kind:** literal pair hole.

**Witness and incompatibility:** Approve successor at R0. Upstream edit makes R1, so false-to-true opens episode E1. Restore upstream wording to R0: the derived stale predicate becomes false, but E1 remains undisposed because only approve/skip/cancel dispose it. Edit again to R2: AD-36's false-to-true rule opens E2, while the schema has no unique open-episode key or current episode pointer. The event writer has followed the specified transition rule; the metric reader can either count both or assume one open episode. Both are compatible with the literal ADs, but PRD FR-17 explicitly requires one open episode until disposal. Own-selection edits returning an approved row to in_progress create the same distinction between visible Stale and an undisposed episode.

**AD change:** Define episode state independently of the instantaneous predicate. On false-to-true, create only if no undisposed episode exists; store `activeStaleEpisodeId` or enforce an equivalent transactional uniqueness rule. Explicitly define how reasons accumulate, how restored revisions affect visible status, and which episode approval/skip/cancel disposes. Keep the PRD's allowed dispositions intact.

**Enforcing test adequacy:** Straight edit/reapprove fixtures miss this. Add R0→R1→R0→R2 and own-selection-edit sequences; assert one open event, one episode and one eventual disposition, with correct duration and fresh-attempt facts.

### F15. medium: The shared validator still permits an output the product contract rejects

**Units:** `validateBatch` versus seed generator and card presentation. **Location:** AD-35; PRD FR-5/6/9. **Kind:** omitted requirement.

**Witness and incompatibility:** The action returns four valid one-bullet seeds carrying two distinct tags. The pure validator accepts them under every listed AD-35 condition, and the UI renders them. FR-6 requires at least one one-bullet and one two-bullet seed when a batch has four or more. The architecture's shared helper centralizes an incomplete rule, so sharing it merely makes the omission consistent. The six tag values and whitespace word counting are also left implicit rather than encoded in the AD's contract definition.

**AD change:** Add the four-or-more form-diversity rule and the exact six serialized tag values to AD-35, explicitly exempting feedback batches under AD-43. State word counting and sentence fixtures as the shared validation specification. Ensure failure spends the same two-request repair envelope, not a new retry loop.

**Enforcing test adequacy:** The listed invalid-seed, two-seed and bad-excerpt fixtures do not test form diversity. Add valid four-item mixed form, invalid four-item uniform form, valid three-item uniform form and valid one-item feedback response cases. No current seed validator test implements these checks.

### F16. high: Text-only Compliance Notes cannot reliably identify the plan item they cover

**Units:** section Self-check/persistence versus Summary coverage reader and QA rail. **Location:** AD-37 and parent AD-25; PRD FR-16/25. **Kind:** literal pair hole.

**Witness and incompatibility:** Two selected seeds have identical final bullets, or two selected advancements share an uncertainty and are merged into one drafted advancement as FR-8 permits. The chain writes one `instruction="cover: …"` row per item as required, while the rail matches notes back by instruction text or paragraphIndex because neither `seedId` nor `summaryItemId` is stored. Another reader matches by row order. Both obey the text-only schema and can disagree about which item is missing. Paragraph indices are explicitly paragraph locations, not stable item identities; several items can share one paragraph. Calling these rows deterministic does not specify a deterministic coverage predicate, and existing Self-check output is paragraph-oriented.

**AD change:** Add stable `summaryVersionId` and `summaryItemId` (or a discriminated plan-reference field including skipped role ids) to coverage notes. Define one result per plan reference, with paragraph indexes as evidence and merge metadata for shared-uncertainty advancements. Specify whether coverage is a model verdict or a deterministic textual condition; if model-judged, label it accordingly. Keep it in the existing Self-check call to avoid an undeclared extra call. The reader must join by identity, not text or order.

**Enforcing test adequacy:** `selfCheck.test.ts` currently checks exclusions, glossary, limits, repair and paragraph scoping. Adding “coverage rows exist” would not detect misassociation. Add duplicate bullets, two items in one paragraph, one item across paragraphs, same-uncertainty merges and identical text with different support status. Assert every summary reference has exactly one final outcome and that the QA rail displays the matching outcome. The semantic evaluation suite must also judge whether the content was actually covered.

### F17. high: Budget extension grants Managers authority the final PRD explicitly denies

**Units:** `seeds.extendBudget` authorization versus the workspace's budget-extension affordance and domain capability policy. **Location:** AD-34; refreshed PRD NFR-3; parent AD-7/Q10. **Kind:** explicit contradiction discovered during input refresh.

**Witness and incompatibility:** AD-34 allows the project Owner, a Manager or an Admin to add 20 requests, using `project.setStage` as its interim cell. The final PRD now permits only the project Owner or an Admin and explicitly excludes Managers until a spend capability cell exists. A mutation implemented from AD-34 authorizes the Manager while a UI and policy implementation following the PRD refuses that same operation. Prose-edit or stage-transition permission does not confer the missing spend authority.

**AD change:** Amend AD-34 to match the final NFR-3 and parent Q10: require project access plus the existing Owner-or-Admin authority, never `project.setStage` as a substitute spend cell. Keep Managers eligible for ordinary seed work under the prose-edit rule, but refuse their budget extension unless they independently qualify as project Owner. A later Manager spend permission requires its explicit capability/domain amendment.

**Enforcing test adequacy:** The proposed 40/60/+20 reservation cases do not specify authorization outcomes. Add a non-owner Manager refusal, Owner-Consultant success, Admin success, non-owner Consultant refusal, and a Manager who is also project Owner success; assert refused calls leave the extension and event stream unchanged. The general “every new mutation ships an authorization-branch case” is too weak unless these branches are enumerated.

## Enforcement audit for every feature AD

An existing test filename is not evidence for a newly stated guarantee. No new seed tests were found, and the existing named files contain no `seedStage`, `summaryVersion`, `seedDecision`, `gatedWorkflow` or `prefetch` feature fixtures. The following audit distinguishes present assertions from the future assertions needed. A documentation draft may legitimately name future tests; it must not count those names as current enforcement.

| AD | Named enforcement and what exists now | Does it detect the named divergence? Required change |
| --- | --- | --- |
| 31 | `promptProgram.test.ts` executes single/compare chains and legacy iterative section review/ghost. `generationRecovery.test.ts` covers existing recovery. | No seed topology or initialization fixture. Test actual scheduler jobs, no section or ghost before sign-off, failed initialization and waiting generation with live/dead batches. F01/F10. |
| 32 | An unnamed future shared bijection/order test. | Not currently demonstrated. A list compared with a duplicate expected list does not prove prompts and QA consume it. Assert role coverage through real builders/QA and three-heading assembly; separately test item order, F13. |
| 33 | `convex/seeds.test.ts` and `projectErasure.test.ts` do not exist. | No writer-list, seed privacy or registry enforcement. Cover the actual ownership matrix and runtime boundaries, F04. The registry must include all existing projectId tables, not only the ten first entries; otherwise its stated all-table test fails immediately. Preserve existing erasure policies. |
| 34 | `instrument.test.ts` really rejects unknown generation labels and checks slot counts; reaper tests exercise existing project/candidate recovery. Seed tests absent. | Partial inherited enforcement only. The label scanner expands every dynamic suffix to 242/244/246 (`instrument.test.ts:441-444`), so adding role slots requires scanner changes and all 13-role fixtures. Allowlist tests do not prove deadlines, transport count, dedupe or settlement. F03/F05/F06. |
| 35 | Both named seed validator/action test files are absent. | Proposed simple fixtures miss form diversity and transport repair composition. Test complete producer schema, shared validation and provenance ownership against the generation's frozen sources. F02/F15. |
| 36 | Both named seed test files are absent. | Proposed key-order/readiness assertions leave scheduling snapshots, confirmation, item order and episode reversion open. Add interleavings and full mutation/read-model checks in F01/F07/F12/F13/F14. Also explicitly test own-feedback recomputation; the listed transaction algorithm mentions changed selection and successor contexts, while AD-43 requires the changed role's context too. |
| 37 | `generationLifecycle.test.ts:759-814` checks legacy section approval and its edit event. `selfCheck.test.ts` checks present paragraph/Brief rules. `scripts/seed-plan-eval.mjs` is not present. | No Summary handoff or retry contract is enforced. Test immutable origin ownership, real content-plan requests, exactly one report creation, post-QA, conflict precedence, merge coverage and repeated retries. Semantic judgments remain a release gate; unit checks are not a substitute. F08/F10/F16. |
| 38 | `promptScaffolds.test.ts:265-277` proves including existing condense/transcript configuration changes the hash. `contextBoundary.test.ts:517-575` applies real containment/leak assertions to its enrolled builders. | Useful harnesses, but no seed/feedback enrollment. Add the real seed action prompt assembly for every input class, forced output fields, changed-scaffold hash, successor exclusion and input snapshot. A new fixture without a seed slot does not enroll a new call site. F01/F02. |
| 39 | `learningHealth.test.ts` tests current metrics, authorization and shared read limits with partial disclosure. Seed tests absent. | No event actor union, exposure dedupe, first eligible approval or seed cohort math. Add typed write/read trace tests and period boundaries, F11, plus episode reversion, F14. |
| 40 | `gatedWorkflow.test.ts` absent. Existing lifecycle and ReportLoading tests exercise old mode branches. | No old-absent/new-reserved/initialization/post-sign-off matrix. Query subscription activation is not proof the correct workspace renders or forbidden mutations refuse. Test both hosts, all phases and the reaper's correct resolver branch. F10. |
| 41 | `src/lib/components/seeds/*.component.test.ts` and the named shared selector test do not exist. | Proposed checkbox/disabled/pill/mobile tests are necessary but insufficient for query compatibility, confirmation race, stale local text, summary history/back behavior and stage-to-editor routing. Add real DTO fixtures and user journeys from F07/F09/F10. |
| 42 | Named `convex/seeds.test.ts` absent. | A real cross-entry-point test would expose F03; a shared mocked fingerprint would hide it. Also test two users approving different roles, next untouched role far from the current one, and queued versus running prefetch so “one ahead” and global in-flight limits are unambiguous. |
| 43 | Named seed action/mutation test files absent. | Add feedback schema round trip, unselected original/revision membership, same-role and successor revision changes, late target edit, skip/unskip/withdrawal semantics and unknown response at approval. F02/F09/F11. |

## Inherited enforcing obligations touched by this feature

| Inherited ADs | Review result and required cross-feature assertion |
| --- | --- |
| 1, 2 | Layer/runtime ownership is a policy, not established by a seed test today. AD-2's exclusive generation status writer conflicts with the new named sign-off owner, F04. A dependency test must allow pure helpers while rejecting action/function imports in the client. |
| 3, 4 | Existing `reportAuthz.test.ts`/`chatProposals.test.ts` protect existing writers; feature conventions explicitly require seed cases but none exist. Prove select/edit/feedback/approve cannot create prose/proposals, and sign-off reaches the established creation writer exactly once. |
| 5, 23 | Existing lifecycle/recovery and Brief tests do not bind dispatch snapshots or reused Summary ownership. Freeze input identity and test retries/late results across generation ids, F01/F06/F08. |
| 7, 14 | Every public seed writer needs real Consultant-own, assigned-work-item, unrelated-Consultant, Manager, Admin and unauthenticated branches. Budget extension must follow the final PRD's Owner-or-Admin restriction and parent Q10, not its current `project.setStage` mapping; F17 names the exact role matrix. No createdBy authority path may be added. |
| 8, 32 | Three H2 assembly and existing parsers remain useful guards. Exercise report creation from an actual signed-off seed plan, including skips and multiple items; a vocabulary-only test cannot prove headings stay unchanged. |
| 9, 24, 27 | Present provider tests explicitly document the full-action timing gap. Named-slot validation, per-slot count, number of sequential logical calls, transport retries and wall-clock deadline are separate properties. F05 gives the missing composition test. Keep legacy single/compare and section-workflow fixtures while adding the seeds handoff. |
| 11, 30 | Existing boundary harness can detect unfenced content only for enrolled builders. Seed/feedback and signed Summary plan blocks require enrollment through production assembly; verify bounded reads do not silently turn complete-plan decisions into partial ones. |
| 16, 25, 26 | Existing style/self-check tests protect inherited precedence and paragraph checks. Seed content overrides need mode-scoped fixtures so Claim Exclusions remain conflicts for seeds while existing modes retain their rules. Freeze effective style at start, including retry, and add stable item coverage, F08/F16. |
| 19, 21 | Registry/erasure test is explicitly new work. A registration assertion is not a deletion test: create all ten kinds, provenance and cross-generation Summary references, erase in pages, and prove no seed text remains. Test actual sanitized error paths and events, not only happy-path rows. |

The Deferred table also contradicts AD-37 by saying ghost retirement removes the `reportEditDistance` baseline until it has a reader. AD-37 and PRD §10 row 9 correctly retain the generated-snapshot baseline, and the existing reader is `learningHealth`. Remove that stale deferral and include a seed-workflow generated-snapshot/PED fixture with the handoff tests. This is supporting evidence for the lifecycle enforcement gap, not an additional counted finding.

The build gate should remain closed until the AD amendments settle these shared boundaries and the named producer/consumer tests are specified concretely. Test implementation and release evaluation are pending; this review makes no claim of passing execution.
