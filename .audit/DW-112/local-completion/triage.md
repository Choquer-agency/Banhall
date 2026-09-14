**10 deduplicated findings: 3 patch, 7 reject.** No `intent_gap`, `bad_spec`, or `defer`.

Blind item 6 and verification item 1 describe the same current-baseline coverage gap and required regression test, so they are merged. Edge returned no findings. The four intent readings are descriptive, not four additional defects.

| Disposition | High | Medium | Low | Total |
|---|---:|---:|---:|---:|
| intent_gap | 0 | 0 | 0 | 0 |
| bad_spec | 0 | 0 | 0 | 0 |
| patch | 0 | 1 | 2 | 3 |
| defer | 0 | 0 | 0 | 0 |
| reject | 0 | 0 | 7 | 7 |
| **Total** | **0** | **1** | **9** | **10** |

Severity reflects the established consequence. Rejected claims have no established defect consequence; the missing regression is medium because current production behavior is correct.

1. **Patch, low: misleading publication narration.** Origin: **blind 1**; related observation: **intent 3**.  
   An adopting publisher still returns `kind: "derived"` at [brief.ts:600][attempt], and [briefRender.ts:51][narration] announces a new Brief. The adopted authoritative row can instead be another publisher’s output or a writer-edited version. Accept the narrow copy problem. Preserve `kind: "derived"` because this attempt actually performed derivation; the intent does not require publication-outcome reclassification. The existing [outcome tests][outcomes] cover ordinary derivation and early reuse, without resolving this new narration case.

2. **Patch, low: publication-helper documentation contradicts the changed behavior.** Origin: **blind 2**.  
   [brief.ts:364][publisher] says persistence checks the project fence first and returns `null` after an intervening publication. The changed [mutation][adoption] first adopts the latest same-key row, stamps the generation, and returns its ID. The [same-key adoption test][adoption-test] demonstrates that success despite a stale baseline. This became inaccurate because of this change and needs only a comment correction.

3. **Reject, low: numeric maximum versus newest stored row requires historical-data policy.** Origin: **blind 3**; related observation: **intent 4**.  
   The [shared lookup][lookup] preserves the baseline’s indexed descending lookup exactly. The frozen intent expressly calls for reusing that lookup and selecting the latest stored same-key version. The unchanged [writer-edit fence][edit-fence] checks the latest row before appending version N+1. A historical later-v1/earlier-v2 sequence could make the legacy `MAX(version)` description inaccurate, but no affected stored history was established. That conditional migration demand does not establish a change-caused defect or a confident incidental issue to defer.

4. **Reject, low: writer-edit interleaving makes the shared-ID guarantee ambiguous.** Origin: **blind 4**.  
   The contract’s transaction boundary, latest-version rule, and prohibition on changing writer-edit semantics support a coherent reading: each publisher adopts the authority visible in its mutation. A writer edit between publications can legitimately leave the earlier generation pinned to v1 and the later publisher adopting v2. [Writer-edit tests][edit-tests] explicitly preserve the earlier generation reference and expose `editedSinceGeneration`. Requiring retroactive convergence after independent writer edits would change those semantics. No intent amendment is required.

5. **Reject, low: require concurrent execution of the entire derivation/stage pipeline.** Origin: **blind 5**; related observation: **intent 3**.  
   The [publication regression][race-test] records two real reuse misses and routes synchronized publishers through the registered mutation using [the real query/mutation adapter][adapter]. Existing [pipeline tests][derivation-test] cover source loading, model execution, persistence, and citation payloads. The model call precedes publication, while the [publication retry loop][publisher] only rereads and republishes candidates. A larger concurrent workflow test is optional; its absence does not establish a separate missing contract behavior.

6. **Patch, medium: adoption with an already-current same-key baseline is unverified.** Origins: **blind 6 + verification 1**.  
   This is a reachable scheduling case, not merely a hypothetical mutant: both generations miss reuse, then one publishes before the other reads its baseline. [The caller][publisher] reads that baseline after derivation. The existing race barrier forces both baseline reads to finish before either publication; the other new test deliberately supplies a stale baseline. Sequential reuse tests take the earlier query-and-stamp path. Thus neither proves adoption when `baselineBriefId === authoritativeBriefId`. The [implementation][adoption] handles it correctly today, but this central idempotency case deserves a behavioral regression.

7. **Reject, low: require two projects sharing an input hash.** Origin: **blind 7**.  
   Both key components are explicitly constrained in the [shared indexed lookup][lookup], whose mechanics are unchanged from baseline. The new mutation calls that helper with `args.projectId` and `args.inputsHash`. No incorrect project binding, changed scoping predicate, or lost isolation assertion was established. Another isolation test could be useful, but the absence alone does not demonstrate a required repair here.

8. **Reject, low: instrument citation reads to prove candidate processing was skipped.** Origin: **blind 8**.  
   The [mutation][adoption] returns before citation reads and baseline-reference processing. The [adoption fixture][adoption-test] supplies invalid candidate/reference data and checks complete parent/child snapshots. Those snapshots do not measure reads, but source inspection establishes the shortcut. Instrumentation or an artificial transaction budget would test internal ordering without an identified behavioral failure or required resource bound.

9. **Reject, low: the race test does not prove winning-payload consistency.** Origin: **blind 9**.  
   This conclusion does not rely on transaction atomicity alone. The winning insertion path uses that invocation’s arguments; the losing branch patches only its generation and returns. The [adoption test][adoption-test] compares complete Brief and entry rows before and after adoption, protecting existing payloads against replacement. The [ordinary derivation test][derivation-test] checks owner, storyline, entry content, and citation bytes. No uncovered payload-selection defect was established.

10. **Reject, low: require different-key retries followed by final-attempt same-key adoption.** Origin: **blind 10**.  
    The unchanged [retry loop][publisher] accepts any non-null result on every permitted attempt, including the last. Existing [retry tests][retry-tests] cover lost fences, successful retry, and exhaustion; the adoption tests establish the mutation’s same-key success result. There is no attempt-dependent adoption branch. The proposed combined scenario adds coverage but does not establish another required repair.

The bounded patch work is:

- **Finding 1:** Change only the derived progress narration to a truthful neutral line, such as **“Generation Brief ready for drafting.”** Preserve outcome kinds and publication return types.
- **Finding 2:** Update `publishDerivedBrief`’s documentation to describe same-key adoption first, and restrict `null`/retry behavior to baseline conflicts when no same-key row exists.
- **Finding 6:** Add one deterministic regression using the existing real publication adapter. Record both reuse misses, complete the first publication, then allow the second baseline read. Assert that the second persistence call receives the first Brief’s ID as its baseline, returns that ID, stamps the second generation, and preserves complete Brief/entry snapshots. Replay publication on that second generation and assert the same invariants.

The four intent readings do not demand an intent-contract repair. Publication-boundary semantics fit the implementation. Concurrent caller scheduling satisfies the stated `convex-test` boundary, although it does not demonstrate production conflict retries. Whole-generation wording requires authoritative generation references, without prescribing a `"reused"` label; its narration consequence is handled by finding 1. Latest-version wording preserves the established indexed lookup and writer-edit semantics.

**Patched count now: 0. Assuming all proposed patches are applied: 3 findings addressed, comprising 0 high, 1 medium, 2 low. Score: `3 × 1 + 2 = 5`. `followup_review_recommended: true`.**

Limitations to preserve:

- Source comparison returned exit 0 against `09e35062ed132d65403d19f9b9af61675ffcaee6`; independently calculated source and native-capture hashes matched retained evidence. The reusable native gate passed all nine steps, including 2,676 tests. No tests were run during this review, and those receipts do not validate future patches.
- Installed [convex-test serializes top-level transactions][serialization]. Evidence establishes concurrent caller scheduling through real handlers, not overlapping empty-key transactions or production conflict retries.
- Concurrent full-stage/model execution and historical production data were not inspected. The [retained verification][verification-record] does not establish this checkout’s `npm ci` installation provenance.
- No files were changed and ledger entries were not read. The protected ledger remains orchestrator-owned at the supplied SHA-256. Native provenance records **`final_acceptance: false`**. Spec EOF/result lifecycle finalization remains with the parent; this report does not claim final native acceptance.

[attempt]: /Users/johnnynguyen/Documents/Repos/Banhall/.bmad-loop/runs/20260912-061909-feb3/worktrees/dw-brief-derivation-concurrency/convex/ai/brief.ts:591
[narration]: /Users/johnnynguyen/Documents/Repos/Banhall/.bmad-loop/runs/20260912-061909-feb3/worktrees/dw-brief-derivation-concurrency/convex/lib/briefRender.ts:48
[outcomes]: /Users/johnnynguyen/Documents/Repos/Banhall/.bmad-loop/runs/20260912-061909-feb3/worktrees/dw-brief-derivation-concurrency/convex/ai/briefPipelineWiring.test.ts:426
[publisher]: /Users/johnnynguyen/Documents/Repos/Banhall/.bmad-loop/runs/20260912-061909-feb3/worktrees/dw-brief-derivation-concurrency/convex/ai/brief.ts:364
[adoption]: /Users/johnnynguyen/Documents/Repos/Banhall/.bmad-loop/runs/20260912-061909-feb3/worktrees/dw-brief-derivation-concurrency/convex/generations.ts:1951
[adoption-test]: /Users/johnnynguyen/Documents/Repos/Banhall/.bmad-loop/runs/20260912-061909-feb3/worktrees/dw-brief-derivation-concurrency/convex/ai/brief.test.ts:1040
[lookup]: /Users/johnnynguyen/Documents/Repos/Banhall/.bmad-loop/runs/20260912-061909-feb3/worktrees/dw-brief-derivation-concurrency/convex/generations.ts:1663
[edit-fence]: /Users/johnnynguyen/Documents/Repos/Banhall/.bmad-loop/runs/20260912-061909-feb3/worktrees/dw-brief-derivation-concurrency/convex/briefs.ts:186
[edit-tests]: /Users/johnnynguyen/Documents/Repos/Banhall/.bmad-loop/runs/20260912-061909-feb3/worktrees/dw-brief-derivation-concurrency/convex/briefs.test.ts:287
[race-test]: /Users/johnnynguyen/Documents/Repos/Banhall/.bmad-loop/runs/20260912-061909-feb3/worktrees/dw-brief-derivation-concurrency/convex/ai/brief.test.ts:959
[adapter]: /Users/johnnynguyen/Documents/Repos/Banhall/.bmad-loop/runs/20260912-061909-feb3/worktrees/dw-brief-derivation-concurrency/convex/ai/brief.test.ts:926
[derivation-test]: /Users/johnnynguyen/Documents/Repos/Banhall/.bmad-loop/runs/20260912-061909-feb3/worktrees/dw-brief-derivation-concurrency/convex/ai/brief.test.ts:214
[retry-tests]: /Users/johnnynguyen/Documents/Repos/Banhall/.bmad-loop/runs/20260912-061909-feb3/worktrees/dw-brief-derivation-concurrency/convex/ai/brief.test.ts:1964
[serialization]: /Users/johnnynguyen/Documents/Repos/Banhall/.bmad-loop/runs/20260912-061909-feb3/worktrees/dw-brief-derivation-concurrency/node_modules/convex-test/dist/index.js:1388
[verification-record]: /Users/johnnynguyen/Documents/Repos/Banhall/.bmad-loop/runs/20260912-061909-feb3/worktrees/dw-brief-derivation-concurrency/.audit/DW-112/local-completion-20260914T112245Z.md:20