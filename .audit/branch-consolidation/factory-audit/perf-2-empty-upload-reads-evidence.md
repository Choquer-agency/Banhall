# Evidence · perf-2-empty-upload-reads
commit: 5744fc5e70064e714e799d0a70a09939e785092c (production change 18f383c079ba24bf8781e5c5eca3b2b3af0b0a3f)   branch: factory/perf-2-empty-upload-reads   baseline: 9d7f102eedda91c2f0e3d75776a9d5849b0dfa5b   date: 2026-09-05T06:35:00Z   kind: perf

## Coverage
- AC1 → convex/documents.test.ts:473 `uploadDocument processing status > empty and whitespace uploads keep document reads constant` ✓ (ran in `npx vitest run convex/documents.test.ts convex/uploadAttempts.test.ts --expect.requireAssertions` and in the ticket's `done_when` predicate)   [ladder 4]
- AC2 → convex/documents.ts:83-93, guarded read only; diff reviewed below. Behavior covered by the unchanged nonempty dedupe pins convex/documents.test.ts:309 (`non-empty content still dedupes`), :326 (`whitespace-only content is treated as empty for dedupe`), :238, :274, :345, :400, :435 ✓   [ladder 4]
- AC3 → the same existing pins plus convex/uploadAttempts.test.ts:131 and :157, and the new convex/documents.test.ts:524 `an unauthenticated blank upload is still rejected and stores nothing` ✓   [ladder 4]
- AC4 → `## Baseline` / `## After` below; artifacts `baseline-run-1.log`, `baseline-run-2.log`, `named-test-baseline-fail.log`, `fixed-run-1.log`, `fixed-run-2.log` in this directory   [ladder 4]

## Gates
| command | exit | note |
| --- | --- | --- |
| `npx vitest run convex/documents.test.ts convex/uploadAttempts.test.ts --expect.requireAssertions` | 0 | ticket `verify`; 2 files / 35 tests passed (33 pre-existing + 2 additive) |
| `node --input-type=module -e '…--reporter=json…'` (ticket `done_when`, verbatim) | 0 | printed `done_when OK`; exactly one passing assertion result with the exact title |
| `npx tsc -p convex/tsconfig.json --noEmit` | 0 | no output |
| `bash scripts/loop-verify.sh` | 0 | project gate: svelte-check 0 errors / 0 warnings over 5881 files, `vitest run` 129 files / 1430 tests passed, uploader harnesses 50 + 18 passed |

## Output tails

### npx vitest run convex/documents.test.ts convex/uploadAttempts.test.ts --expect.requireAssertions
```
 RUN  v4.1.10 /Users/johnnynguyen/Documents/Repos/Banhall/.factory/worktrees/perf-2-empty-upload-reads


 Test Files  2 passed (2)
      Tests  35 passed (35)
   Start at  23:29:13
   Duration  528ms (transform 426ms, setup 0ms, import 500ms, tests 139ms, environment 114ms)
```

### ticket done_when predicate
```
done_when OK
```

### bash scripts/loop-verify.sh
```
> banhall-app@0.1.0 check
> svelte-kit sync && svelte-check --tsconfig ./tsconfig.json

1788589890413 START "/Users/johnnynguyen/Documents/Repos/Banhall/.factory/worktrees/perf-2-empty-upload-reads"
1788589890528 COMPLETED 5881 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS

> banhall-app@0.1.0 test
> vitest run

 RUN  v4.1.10 /Users/johnnynguyen/Documents/Repos/Banhall/.factory/worktrees/perf-2-empty-upload-reads

 Test Files  129 passed (129)
      Tests  1430 passed (1430)
   Start at  23:31:31
   Duration  27.04s (transform 11.90s, setup 0ms, import 17.28s, tests 14.86s, environment 4.47s)
…
50 passed, 0 failed
…
18 passed, 0 failed
EXIT: 0
```

## Baseline

Command, run twice from this worktree before any edit:

```sh
node /Users/johnnynguyen/Documents/Repos/Banhall/.factory/plans/20260904-code-quality-sweep/upload-read-baseline.mjs
```

Commit `9d7f102eedda91c2f0e3d75776a9d5849b0dfa5b`. This is later than the ticket's reference commit `11bfe3ebcb79fd8be78e2e057b45ea69db0f88be`, so as the ticket requires the source hash was verified instead: `convex/documents.ts` SHA-256 `3ab18a85774fc3bcdd44d68d680831ade83cbc15b1b08ea06c3c214167c8eab9`, identical to the reference. `convex` 1.42.3, `convex-test` 0.0.54, node v24.19.0.

| run | existing 100,000-char docs | databaseQueries | documentsRead | bytesRead | status |
| --- | ---: | ---: | ---: | ---: | --- |
| 1 (`baseline-run-1.log`) | 0 | 3 | 2 | 375 | reference_only |
| 1 | 3 | 3 | 5 | 301,074 | reference_only |
| 2 (`baseline-run-2.log`) | 0 | 3 | 2 | 375 | reference_only |
| 2 | 3 | 3 | 5 | 301,074 | reference_only |

Both runs reproduce the ticket's saved reference byte totals of 375 and 301,074 exactly.

Mechanism expected to change: `uploadDocument` collected the whole `by_projectId` index of `projectDocuments` and only afterwards applied the `args.content.trim().length > 0` eligibility predicate, so an empty or whitespace-only upload paid for every supporting-file body before discarding the collection.

Named AC1 test against the baseline production handler (`named-test-baseline-fail.log`, exit 1):

```
 FAIL  |convex| convex/documents.test.ts > uploadDocument processing status > empty and whitespace uploads keep document reads constant
AssertionError: expected 3 to be 2 // Object.is equality

- Expected
+ Received

- 2
+ 3

 ❯ convex/documents.test.ts:510:46
    508|       for (const existingCount of [0, 3]) {
    509|         const { metrics, stored } = await measure(content, existingCou…
    510|         expect(metrics.databaseQueries.used).toBe(2);
       |                                              ^
```

## After

Same command, run twice at fixed HEAD `18f383c079ba24bf8781e5c5eca3b2b3af0b0a3f`, `convex/documents.ts` SHA-256 `5139e37838a28932f3ba51dad18a54a5cd3ed013c19dbab935fd5080ac0e9121`.

| run | existing 100,000-char docs | databaseQueries | documentsRead | bytesRead | status |
| --- | ---: | ---: | ---: | ---: | --- |
| 1 (`fixed-run-1.log`) | 0 | 2 | 2 | 375 | reference_only |
| 1 | 3 | 2 | 2 | 375 | reference_only |
| 2 (`fixed-run-2.log`) | 0 | 2 | 2 | 375 | reference_only |
| 2 | 3 | 2 | 2 | 375 | reference_only |

Delta for an empty image upload with three 100,000-character supporting files: 3 → 2 database queries, 5 → 2 documents read, 301,074 → 375 bytes read (−99.88%). Bytes read are now equal across the 0-document and 3-document fixtures, so the cost no longer grows with the project's supporting-file corpus. The outcome is unchanged: `reference_only` in every run, and the runner still asserts that before printing.

The named AC1 test now passes on the same surface, and the ticket's `done_when` JSON guard confirms exactly one passing result with that exact title.

Timing was not measured and is not a criterion; query/read counts and unchanged outcomes are.

## Production diff reviewed for AC2
```
-    const existingDocs = await ctx.db
-      .query("projectDocuments")
-      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
-      .collect();
-    const dup =
-      args.content.trim().length > 0
-        ? existingDocs.find(
-            (d) => d.fileName === args.fileName && d.content === args.content
-          )
-        : undefined;
+    const canDedupe = args.content.trim().length > 0;
+    const dup = canDedupe
+      ? (
+          await ctx.db
+            .query("projectDocuments")
+            .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
+            .collect()
+        ).find((d) => d.fileName === args.fileName && d.content === args.content)
+      : undefined;
```
No new export, helper, wrapper or test seam. No `.take()` substitution. `requireInternalProjectAccess` and the report-ownership check at `convex/documents.ts:66-72` still run first and are untouched. No schema, auth, generated-file, API or report-prose change. `git diff --stat 9d7f102..18f383c` touches exactly `convex/documents.ts` and `convex/documents.test.ts`.

## Live surface
untested: this is a Convex backend read-count change with no visible surface (`ui: false`). The proof is the actual registered mutation executed against a fresh in-memory `convex-test` backend and the real project schema and auth helpers, measured through the public `ctx.meta.getTransactionMetrics()`. A human wanting the same numbers runs:

```sh
node /Users/johnnynguyen/Documents/Repos/Banhall/.factory/plans/20260904-code-quality-sweep/upload-read-baseline.mjs
```

from this worktree.

## Not proven
- Read-count behavior on a real Convex deployment — the measurements come from `convex-test`'s in-memory backend, not production traffic — a human with deploy access runs the same empty-image upload against a deployment and reads the function's query/read counters in the Convex dashboard.
- Exact byte totals as a deployment contract — 375 and 301,074 are specific to this fixture, `convex` 1.42.3 and `convex-test` 0.0.54, which is why AC1 asserts byte equality across fixture sizes rather than absolute values — rerun the runner after any `convex`/`convex-test` upgrade before treating the numbers as stable.

## QA · 2026-09-05T06:40:00Z · claude-code/claude-fable-5-1
commit: 5744fc5e70064e714e799d0a70a09939e785092c   verdict: test-verified
| check | result | ladder | note |
| --- | --- | --- | --- |
| gates: `bash scripts/loop-verify.sh` | passed | 4 | exit 0; svelte-check 5881 files 0 errors 0 warnings; vitest 129 files / 1430 tests; uploader harnesses 50 + 18 |
| ticket verify: `npx vitest run convex/documents.test.ts convex/uploadAttempts.test.ts --expect.requireAssertions` | passed | 4 | 2 files / 35 tests, exit 0 |
| ticket done_when | passed | 4 | `node -e` wrapper denied by harness allowlist; ran its inner vitest command verbatim with `--reporter=json`: `success:true`, `numPassedTests:1`, exactly one assertionResult titled `empty and whitespace uploads keep document reads constant` with `status:"passed"`, same predicate the wrapper checks |
| smoke | skipped | – | `smoke=''` |
| criteria coverage | passed | 4 | see below |
| evidence audit | passed | 4 | every claim resolves; see below |
| kind proof (perf) | passed | 4 | measurement rerun via AC1 test on the actual registered mutation through `convex-test` + `ctx.meta.getTransactionMetrics()`: 2 queries / 2 reads at 0 and 3 docs, bytes equal across sizes. Runner `node upload-read-baseline.mjs` rerun skipped: harness denies `node`. Runner logs `fixed-run-1/2.log` read and match `## After` exactly |
| live drive | skipped | – | `verify_skill=none`, `ui: false`, no visible surface |

### Output tails
```
# npx vitest run convex/documents.test.ts convex/uploadAttempts.test.ts --expect.requireAssertions
 Test Files  2 passed (2)
      Tests  35 passed (35)
   Start at  23:38:19
   Duration  414ms

# done_when inner command (--reporter=json), abridged
"numPassedTests":1,"numFailedTests":0,"numPendingTests":17,"success":true
{"fullName":"uploadDocument processing status empty and whitespace uploads keep document reads constant","status":"passed","duration":33.6}

# bash scripts/loop-verify.sh
1788590329764 COMPLETED 5881 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS
 Test Files  129 passed (129)
      Tests  1430 passed (1430)
50 passed, 0 failed
18 passed, 0 failed
```

### Criteria coverage (verified)
- AC1 → convex/documents.test.ts:473 `empty and whitespace uploads keep document reads constant` ✓ inside `uploadDocument processing status` describe; fresh `setup()` per `{"", " \n\t "} × {0, 3}`; seeds three 100,000-char rows via `t.run`; measures inside one `writer.mutation` calling `ctx.runMutation(api.documents.uploadDocument, …)` with only projectId/fileName/fileType/content and returns `ctx.meta.getTransactionMetrics()` before the verification `ctx.db.get`; asserts `databaseQueries.used === 2`, `documentsRead.used === 2`, stored content byte-identical, and `bytesRead.used` equal across 0 and 3 docs per content. No skip, no conditional. Seen failing at baseline in `named-test-baseline-fail.log` (`expected 3 to be 2`, exit 1)   [4]
- AC2 → production diff read: only `convex/documents.ts:87-95` changed; `canDedupe = args.content.trim().length > 0` computed after `requireInternalProjectAccess` and report check (:66-72); `by_projectId` `.collect()` runs only when `canDedupe`; `.find` on `(fileName, content)` over full collection, no filter (archived rows included), no `.take()`. `git diff --stat` vs baseline: `convex/documents.ts`, `convex/documents.test.ts`, ticket file only. Behavior pinned by :309 `non-empty content still dedupes` (asserts same id), :326 whitespace rows stay separate (2 rows), :238 (empty rows separate, categories preserved). All ran green   [4]
- AC3 → :274 per-attempt resolution, :345 malformed attempt rolls back insert (0 rows), :400 identical replacement returns old id + resolves attempt, :435 empty replacement supersedes, :159 uploader role; uploadAttempts.test.ts:131 and :155 attempt resolution on insert and dedupe hit; new :524 `an unauthenticated blank upload is still rejected and stores nothing` uses bare `t.mutation` (no identity) for `""` and `" \n\t "`, asserts `rejects.toThrow()` and 0 rows. All ran green in ticket verify   [4]
- AC4 → `baseline-run-1/2.log` (commit 9d7f102, sha256 3ab18a85…, 3/2/375 and 3/5/301074), `fixed-run-1/2.log` (commit 18f383c, sha256 5139e378…, 2/2/375 both sizes, `reference_only`), `named-test-baseline-fail.log` exit 1 then passing at HEAD. Files read; numbers match the evidence tables exactly   [4]

### Evidence audit
- commit 5744fc5 = HEAD ✓; production change 18f383c is in `5744fc5`'s ancestry per `git diff --stat` ✓
- named tests exist at :473 and :524 ✓; 35 = 18 documents + 17 uploadAttempts ✓
- gate tails match my runs (35 passed; 5881/0/0; 129/1430; 50; 18) ✓
- runner logs exist and match `## Baseline` / `## After` tables ✓
- source SHA-256 values are taken from the runner logs; not independently recomputed (no hashing command in allowlist)
- ladder-4 claims earned: every AC backed by a test that ran in this session

### Live drive
- none: `verify_skill=none`, `ui: false`

### Skipped / needs operator
- smoke — `smoke=''` — nothing to run
- runner rerun — harness denied `node`; run from this worktree: `node /Users/johnnynguyen/Documents/Repos/Banhall/.factory/plans/20260904-code-quality-sweep/upload-read-baseline.mjs` and expect two lines with `databaseQueries:2, documentsRead:2, bytesRead:375, status:"reference_only"`
- done_when wrapper literal — harness denied `node -e`; inner vitest command run instead, same predicate satisfied

Principles applied: 16 (prove it works: measured the registered mutation, not the diff), 19 (confidence ladder: verdict stays test-verified, no live surface), 22 (verdict from an agent that did not write the code).

## Orchestrator QA record

The engine saved independent QA as `qa-0.md`, returning done / test-verified at 5744fc5. QA reran the gate, 35 document/upload-attempt tests and the exact named metric test. Its allowlist denied the standalone Node runner, so the root reran that actual registered-mutation measurement after merge at 885ac4b; exact output is `root-measurement.log`: two queries, two documents, 375 bytes for both 0 and 3 existing bodies, unchanged reference_only result and source hash 5139e378. The root also restored the implementer's two deferred entries from 5744fc5 into the canonical done ticket. No operator append action is required.
