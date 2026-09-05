# DW-93 current-code assessment

Assessed revision: `bdf5d0e34cdd23dd17f74baf5be5f6d2ca32096d`.
Frozen original baseline: `740008e1369faaf6eab001f95efeb10a9e52d1e5`.
Assessment date: 2026-09-05 UTC (2026-09-04 America/Vancouver).

The existing CAP-2 implementation satisfies the frozen story. No verified in-scope implementation defect was found and no production or test file was edited. This is an implementer assessment; the independent workflow review is recorded separately before terminal development completion.

## Formula and extraction

`convex/lib/editDistance.ts:8` retains lowercased Unicode-aware word bags, repeated-word multiplicity and punctuation stripping. `:57` computes `ped = 1 - 2 * overlap / totalWords`, with similarity 1 when both bags are empty. Paragraph counts use normalized lines, consuming each current paragraph once; they remain separate response fields. The frozen prose's reference to a paragraph ratio is resolved by its explicit unchanged-formula requirement and preserved historical review decision (original frozen story `3-persist-post-edit-distance-at-milestones.md:384`): the existing formula never folds paragraphs into PED.

The read-only `.audit/DW-93/verify-preservation.py` compares the helper declarations and calculation statements directly with the original baseline. It also compares the full `postEditDistance` query prefix through argument validation, authorization and first generated-baseline selection. All match. `convex/reports.ts:421` delegates only the calculation and adds `draftLabel`/`baselineAt`; the integration test at `convex/reportEditDistance.test.ts:269` checks persisted equality and exactly eight returned keys. The ghost-baseline test at `:244` checks both read and write surfaces select the first real baseline.

The cumulative historical `740008..HEAD` diff also contains previously integrated QA work in `reports.ts` and `projects.ts`. These are inherited changes at the fresh DW-93 baseline, not PED extraction changes. Their presence does not authorize reverting QA or expanding this follow-up. The new DW-93 diff contains no production changes.

## All three trigger paths

`convex/generations.ts:1005` is the common report materialization helper. It returns an existing report before inserting anything (`:1019`), otherwise inserts the report at revision 0 and its matching generated baseline before calling the recorder (`:1070`). Single-candidate completion (`:1222`), iterative approval (`:2168`), and explicit candidate selection (`:2896`) all call this helper. Later ghost comparison snapshots are not recording hooks and cannot replace the first baseline.

`convex/snapshots.ts:259` records after a successful milestone insertion, using the report and revision already validated by the mutation. Existing snapshot retention remains unchanged. `convex/projects.ts:1056` schedules only `reportId` to the internal recorder after publication; `convex/reportEditDistance.ts:117` reads the report at drain time and returns null if deleted. Publication permissions and QA checks remain those of the current project workflow.

Explicit selection, milestone and scheduled publish have actual convex-test mutation coverage. The single and iterative candidate paths have current-code call-chain evidence, consistent with the original deferred test-coverage decision at frozen story `3-persist-post-edit-distance-at-milestones.md:134` and `:135`. A new candidate report cannot have no baseline after successful materialization because report and baseline insertion occur atomically before the hook; existing-report early return performs no recording. The no-baseline runtime scenario is exercised through milestone and scheduled publish. The existing test name saying “every trigger” is broader than those two calls, so this assessment does not claim an impossible missing-baseline candidate fixture was exercised.

## Failure isolation, attribution and dedupe

`convex/lib/editDistance.ts:106` wraps baseline lookup, text extraction, computation, newest-row read, owner lookup and insertion in one catch that logs context and returns null. Missing baseline returns null without writing. The pure failure test at `convex/lib/editDistance.test.ts:104` injects a failing baseline read and observes null and one log; it does not simulate every possible Convex infrastructure failure.

The recorder writes report/project/generation IDs, current revision (legacy default 0), computed timestamp, trigger and `project.ownerId`. It does not substitute `createdBy`. The ownerless publish fixture checks omission and the writer-series ownerless fixture checks exclusion. Dedupe compares only the report's newest reading and exactly `(trigger, revisionNumber, ped)`, as mandated. Repeat publish is suppressed; edited republish and same-revision cross-trigger recordings survive. No stronger per-trigger or content-hash dedupe is introduced.

## Bounded reads and access

`convex/schema.ts:1299` contains the specified optional generation/writer fields, three trigger literals, and report/project/writer-time indexes. `seriesForReport` uses internal access through the existing helper, returns null for denied/missing reports, keeps 200 newest inserted rows and orders by computedAt with creation-time tie-break. The tests exercise anonymous, anonymous-admin, roleless, unmapped, eligible internal, missing-report, cross-project row isolation, ordering, tie-break and cap direction. The cross-project test proves row filtering, not a new project-ownership permission: the preserved internal helper allows eligible staff across existing projects.

`seriesForWriter` authenticates first, rejects anonymous and roleless users, and permits admin/manager or the specified writer themselves. Optional sinceDays must be an integer 1..3650. It reads the compound writer/time index, applies the optional lower bound and retains 500 newest readings before returning oldest-first. Existing tests cover allowed and rejected actors, invalid inputs including NaN and a fraction, authentication precedence, time window, optional ownership, generationId projection and cap direction. Writer attribution is historical at record time, matching the original contract.

## Codegen provenance and preserved decisions

The current `convex/_generated/api.d.ts` bytes equal supported-generation commit `3e575b7c68a80ef560b746be78e1b016e1dda750` (blob `29fa5d7a095df201cf5c3886808e86356d7d1f56`). The retained command log and evidence were committed at `5de0e9a389022afc4ee21f740fe6fdd0755fa9b8`. Both revisions are ancestors of this run baseline. The public/internal module registration is present at generated lines 112 and 238 and is typechecked by the ordinary full gate.

No fresh codegen was run and no generated file was edited. The historical log includes “Uploading functions to Convex”; its preserved evidence explains the supported codegen path. Local installed `node_modules/convex/src/cli/lib/components.ts:81` confirms `runCodegen` invokes `startComponentsPushAndCodegen` without the separate `finishPush` path at `:635`. This assessment establishes artifact lineage and fresh type correctness, not a new remote deployment or native finalization receipt.

All original deferred decisions and review history remain byte-identical. Existing limitations include drain-time publication readings, malformed JSON extraction behavior, no retention/backfill or formula version, historical ownership attribution, bounded arrays without truncation metadata, and structural-only coverage of two candidate paths. They are existing frozen choices or deferrals, not newly repaired or closed by DW-93. Native acceptance remains the orchestrator's responsibility.
