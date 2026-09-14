The diff implements **publication-level idempotency**. Its new concurrency regression enters at `publishDerivedBrief`, below the full derivation stage.

The defensible readings are:

1. **Persistence invariant, the most explicit reading.** The [bundle intent](/Users/johnnynguyen/Documents/Repos/Banhall/.bmad-loop/runs/20260912-061909-feb3/bundles/brief-derivation-concurrency/intent.md:8) names the persistence transaction as the fix location: recheck `(projectId, inputsHash)`, preserve one authoritative Brief, and stamp both generations to it.

2. **Derivation-stage regression, a broader reading.** “Concurrent-first-derivation regression” can mean exercising two actual derivation attempts through source loading, hash computation, initial reuse misses, candidate generation, and publication. This includes the persistence invariant but places the regression’s entry point higher.

3. **Local completion procedure.** The initiating instruction also specifies the build workflow, role-specific models, review context, existing-implementation reuse, orchestrator ownership, and no push or deployment. Those expectations concern execution history, which a source diff cannot establish.

**The diff directly implements reading 1.** In [persistDerivedBrief](/Users/johnnynguyen/Documents/Repos/Banhall/.bmad-loop/runs/20260912-061909-feb3/worktrees/dw-brief-derivation-concurrency/convex/generations.ts:1951), the shared indexed lookup precedes the project fence and candidate processing. An existing keyed Brief causes a generation stamp and immediate return. This rule covers any existing same-key Brief, including edited versions and sequential repeat publications, beyond the narrowly described first-publication race.

The surface differences are:

| Intent expectation | Surface the diff and tests exercise |
|---|---|
| Two generations concurrently derive identical inputs | The [new regression](/Users/johnnynguyen/Documents/Repos/Banhall/.bmad-loop/runs/20260912-061909-feb3/worktrees/dw-brief-derivation-concurrency/convex/ai/brief.test.ts:958) manually supplies the same hash and candidate entries. It separately establishes two reuse misses, then synchronizes two publication-helper calls before the real registered mutation. It does not invoke `deriveOrReuseBrief` or the generation pipeline. |
| Transactional protection during concurrent publication | The test exercises application mutation code through `convex-test`. Its barrier coordinates callers before mutation execution. The installed [test transaction manager](/Users/johnnynguyen/Documents/Repos/Banhall/.bmad-loop/runs/20260912-061909-feb3/worktrees/dw-brief-derivation-concurrency/node_modules/convex-test/dist/index.js:1371) serializes top-level transactions, so this exercises adoption after another publication commits; it does not directly exercise production conflict detection and transaction retries. |
| An authoritative Brief removes ambiguity for reuse and writer edits | The assertions cover one stored version-1 Brief, one entry, matching returned IDs, and both generation stamps. The second test directly seeds an edited version and verifies adoption despite stale baseline and invalid candidate data. It does not exercise the writer-edit workflow following the race. |
| Existing changed-input behavior remains intact | The adjusted fixtures assign a different `inputsHash` on every publication while retaining their frozen source fixture. They exercise diffing and fencing under different supplied keys; they do not demonstrate actual evidence changes producing those keys through the hashing path. |
| Authorized workflow completion and ownership preservation | The supplied diff contains no ledger modification. It cannot establish which models or workflow ran, whether implementation was inspected first, or whether pushing/deployment occurred. The spec lists expected verification results, rather than execution results. |

The added spec explicitly selects the mutation boundary for its regression contract. That documents the narrower interpretation chosen by the change; it does not resolve the original phrase’s possible stage-level meaning. These observations describe source and assertion coverage, without claiming test execution results.