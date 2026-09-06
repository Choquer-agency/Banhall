# Independent semantic review of recovery reconciliation

Target reviewed: `cc6b706c3b43f971d944cb703a4174eabf3134d9`. Archive tip: `842cdf5160cd405de19b8643ad9295bcd4049e95`. Inputs: recovery-audit/report.md and recovery-ledger.json. Read-only Git source/spec/test inspection; no tests, source edits, ledger changes, children or merges. Parent separately validates Git blob/parent/reachability receipts.

## Finding R1: useful archive UI behavior is not superseded (medium)

The blanket conclusion that archive32 contains no missing useful product change is too broad. Commit `186dc570967a0eaa388c72595376d41ba8a9b5d8` changes `src/routes/admin/brain/+page.svelte` in precisely these hunks:

```diff
-    revoke: "Revoked (unlearned)",
+    revoke: "Revoked (unlearn requested)",
     reweight: "Reweighted",
     revert: "Reverted",
+    unlearn_confirmed: "Erasure confirmed",
```

Current main still has the old revoke label at that file:21, no confirmation/failure labels at17-25, and renders `ACTION_LABEL[a.action] ?? a.action` at183. Thus an administrator sees completed-sounding erasure at the request event even when erasure later fails. Stronger backend reconciliation does not replace this presentation behavior.

Concrete current runtime path in source: `convex/brain.ts:376-389` inserts the revoke audit row before scheduling deletion. `:415-439` performs erasure later, records a failed attempt then throws on failure; only success invokes confirmation. `:391-398` confirms no-entry revocations immediately by construction. `:469-488` records exactly scoped confirmation; `:497-532` records failure evidence and may schedule another deletion attempt. Current `convex/brainUnlearn.test.ts:170-219` covers live/no-entry/already-absent/failed erasure and `:261-400` covers cap/idempotency/remediation races. This is reachable behavior, not a hypothetical styling issue.

The replacement story explicitly excluded frontend changes and deferred missing `unlearn_confirmed`/`unlearn_failed` labels: `_bmad-output/specs/spec-ai-engine-sprint-1b/stories/12-confirmed-unlearn-with-failure-evidence-and-retry-free-embeds.md:12-24`. That explains the omission; it does not prove the archive UI hunks were incorporated or rejected as undesirable. Root has accepted narrow B11 before ancestry reconciliation. Recovery-ledger owner was notified to classify this commit as backend-superseded with pending frontend reconciliation.

Safe scope: preserve current backend and port the request-vs-confirmation distinction. Add a label for the current `unlearn_failed` event such as **Erasure attempt failed**, which does not falsely claim retries are exhausted or source exposure has resumed. The confirmed label is appropriate for confirmed/absent events; the revoke label describes the request event, not the current aggregate erasure status. Do not infer confirmation from `status=revoked`, an absent UI error, or a returned mutation. An actual component audit-table regression should show request, confirmed and failed rows, including a failure followed by confirmation. The archive did not add a failure label because that action did not exist in its implementation.

System actors currently display as admin at187; replacement spec already defers this, and archive186dc570 did not fix it. It is not an additional lost archive hunk. Keep separate from the minimal missing-behavior disposition unless parent explicitly scopes it.

## Semantic mappings checked beyond retrospective prose

| Archived change | Concrete current replacement and preserved behavior | Result |
| --- | --- | --- |
|4cdfacae internal access|`convex/lib/auth.ts:34-62` rejects anonymous/roleless actors before project lookup; nullable/throwing helpers agree. Current reportAuthz/projectAccess tests cover identity, stored-anonymous and role parity.|No missing behavior identified.|
|870c4fea publish authority|`convex/projects.ts:1030-1064` uses current ownerId and project.setStage, not createdBy; report binding and absolute blocking QA precede writes, then PED schedules.|Current contract is stronger; do not restore older publish policy.|
|ef44e751 reversible client edit/nomination|`convex/comments.ts:143-196` checks actual target then writes pre_client_edit snapshot and revision in same transaction. Current comments tests restore exact text and reject missing/ambiguous selections. Reviews tests prove persisted review-id nomination and failed authorization no writes.|Current implementation retains intent with stronger exact-revision semantics.|
|467dbad2 Brain feedback access|`convex/brain.ts:591+` enforces active internal access and project/report binding before insert, with bounded body/rule input. brainFeedback tests cover rejected bindings/actors.|No missing useful change found.|
|66923652 proposal mark/fenced client helper|`convex/chatV2.ts:563-630` atomically snapshots pre-edit content, applies final JSON, checks revision and bumps once. Current/PreviewProjectPage hold autosave during stepping and finish through mutation (Current:267-276,326-375); current chatProposals tests:176-350 prove parity, fence, replay, invalid JSON and rejected state. Old helper flushed edited prose before server snapshot; restoring it would weaken the current approved transactional shape.|Obsolete helper is not a missing feature. Persistent save-error/flush blocking differs intentionally from settling old mark-only chain.|
|30a3057f provider budget|Current providers exports retain one retry and four-minute timeout. providers.test.ts:24-86 proves one slot plus reserve and explicitly records unresolved sequential-chain deviation.|No lost archive guarantee; do not claim entire chain now fits merely because per-call budget does.|
|a22fe5f3 superseded generations/QA|Current recovery projection recognizes superseded; generationRecovery tests:157,189,698 exclude old generations and reject missing-report QA; later tests fence late ghost runs.|No missing behavior found.|
|9bb8425e bounded chat|Current chatTurns tests:153,258,1019,1108-1372 cover30 non-tool context, exact options,200 authorized metadata window, order-zero/inclusive windows/duplicate anchors. Missing/inaccessible thread behavior remains separately tested.|Current bounded implementation replaces archive source, not just story labels.|
|8813063e attribution|Current generationAttribution tests:338-638 freeze hash/digest handoff and retries;:734-1465 cover actual payload/QA/iterative paths;:1579-1813 distinguish failed-call costs, tracked zero, legacy null and in-flight partial sums.|No archive edge case identified as lost.|
|186dc570 unlearn backend|Current brainUnlearn tests:170-296 confirm actual absence, failed evidence/cap and no-op;:315-463 fence stale confirmation/reapproval;:476-606 cover no-op embeds, compensation/orphans and serve-time governance. Old warn-on-nonapproved and no-confirm-never-embedded behaviors are superseded by explicit silent/no-entry confirmation contract.|Backend mapping justified; frontend R1 remains.|
|fca23fd5 indexed reaper|Current generationReaper tests:136-182 prove bounded multi-page orphan work, one-page completion and scheduled reaping rather than inline scanning.|No missing implementation found.|

## Learning/PED/QA preserved checkpoints

- Unreviewed learning5 checkpoint44b70247: actual old/current test-name and source comparison shows racing first votes, orphan/foreign prompt rejection, context binding, source chips, loading/keyboard retry and loaded-window ratings retained. Current feedback tests add immutable deidentified snapshot, text-only exact-turn choice, bounds and Unicode; real component tests add duplicate-click/viewer/conversation guards and tool-only terminal suppression. Current exact-turn bounded feedback read repair must win over old eager history lookup. No useful checkpoint behavior found missing.
- PED malformed follow-up: current reportEditDistance.test.ts:379-505 exercises malformed extraction rejection while preserving valid empty current/baseline/both-empty/empty-paragraph distances. This is the actual distinction at risk, not simply a matching filename. Parent’s final blob identity checks bind the preserved follow-up source.
- Wrapped QA follow-up: current qaBlocking.test.ts:290-565 covers renamed/removed/nested headings, whitespace separators, substantive heading text, late headings, deep block/inline containers, split markers/because, leading H1/generated-title cases and wrapped sibling/horizontal-rule boundaries at both gates. These cumulative cases include intermediate follow-up intent; do not import earlier extraction variants.
- Research phone-redaction and snapshot-ownership fixes are final-source equality mappings in the ledger; current tests and helper references retain complete phone consumption and project-bound research provenance. Parent independently verifies exact blobs and receipts. No separate semantically lost change identified.
- Learning4/8 policy preservation points are pending-plan snapshots; approved final diversity/provenance and oldest-first measured rerank companion govern the accepted source. An ancestry merge must retain current canonical policy/ledger state, not replay a provisional accepted/blocked/done marker.

## Disposition and limits

One actionable mapping/source omission found (R1). The remaining inspected replacements are supported by current executable source and named tests, not only retrospectives. No further learning/PED/QA semantic loss identified in this bounded read-only review. This is not a new full runtime certification or an assertion that every pre-existing deferred issue is solved.

An ancestry-only merge preserving main is **not yet justified for the entire archive tip** until R1 is repaired or explicitly dispositioned with evidence. After narrow B11 is reviewed/proven and recovery mapping corrected, the inspected old backend/checkpoint/spec content can remain superseded; replaying it would reintroduce weaker contracts. Other branch families and dirty worktree changes remain outside this review.
