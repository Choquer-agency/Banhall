# Empty-upload read optimization addendum

This addendum supplies one independently reviewable proposed ticket, `perf-2-empty-upload-reads`, while the external planner owns `research.md` and `architecture.md`. It does not modify those documents or mark anything ready. Only the root orchestrator may accept the additional ticket after its independent review under the existing auto-confirm policy.

## Why the earlier deferral is superseded

The current planning research defers PERF-3 because it states that no repeatable read-count metric exists without extracting the handler (`research.md:52`, inventory row 17 at `:83`). Direct inspection and execution disproved that premise. Installed Convex `1.42.3` exposes public `ctx.meta.getTransactionMetrics()` (`node_modules/convex/src/server/meta.ts:134`, `registration.ts:158`). Installed `convex-test` `0.0.54` accepts inline mutation callbacks (`node_modules/convex-test/dist/index.d.ts:24`) and accumulates metrics from a registered child mutation into its caller (`dist/transactionMetrics.js:62`, `dist/index.js:1005`).

An inline test callback can invoke the actual registered `api.documents.uploadDocument` through `ctx.runMutation` and retrieve those public metrics immediately afterward. This retains the registered validators, actual auth helpers and real in-memory Convex database/storage behavior. No production extraction, `_handler` dependency, mocked query or proxy context is necessary. The optimization can be shipped separately from the larger supporting-file pagination/hash/schema work.

## Source trace and safety fact

`convex/documents.ts:66-72` performs access and optional report validation. Lines 83-86 then collect every project document. Only afterward, lines 88-92 decide that empty/whitespace content is ineligible for dedupe. The comments at lines 76-82 explicitly explain why empty files must remain separate rows. The safe change is to retain the existing predicate and execute the read only on its true branch; all later status, insert, storage and receipt logic remains on its current path.

The client entry points are unchanged: project creation uses `api.documents.uploadDocument` (`src/routes/project/new/+page.svelte:60`, `:646`), and the project file panel uses the same mutation (`src/lib/components/editor/FilesPanel.svelte:138`). Downstream status and receipt readers receive the same inserted record shapes. Authorization semantics, schema, project ownership/workflow and report prose are outside the change.

Existing tests already pin separate unreadable files, per-attempt resolution, nonempty dedupe, whitespace behavior, rollback and replacements (`convex/documents.test.ts:238`, `:274`, `:309`, `:326`, `:345`, `:400`, `:435`; `convex/uploadAttempts.test.ts:131`, `:157`). The new metric case belongs in this existing suite. A small additional unauthenticated blank-upload assertion proves the guarded read never becomes an early authorization bypass.

## Executed baseline proof

Exact executable: `upload-read-baseline.mjs` in this plan directory. Captured output: `upload-read-baseline.log`. The root orchestrator independently reran it and confirmed the same measurements.

| Existing 100,000-character documents | Database queries | Documents read | Bytes read | Result |
| ---: | ---: | ---: | ---: | --- |
| 0 | 3 | 2 | 375 | reference_only |
| 3 | 3 | 5 | 301,074 | reference_only |

Baseline source commit is `11bfe3ebcb79fd8be78e2e057b45ea69db0f88be`; `convex/documents.ts` SHA-256 is `3ab18a85774fc3bcdd44d68d680831ade83cbc15b1b08ea06c3c214167c8eab9`. These are local in-memory measurements from the actual registered mutation, not production traffic. The runner writes no files, disables `fetch`, and needs no server or deployment. Shell redirection captured its output outside the runner.

After the proposed guard, the same no-optional-arguments fixture should perform exactly two queries and read two documents (the user and project) regardless of supporting-file count. The ticket requires two baseline and two fixed runs, and an actual baseline failure followed by a pass of the named metric regression. The fixed implementation has not been written or measured by this addendum.

## Ticket shape and completion gate

- One package: Convex. Two implementation files: `convex/documents.ts` and existing `convex/documents.test.ts`. Four acceptance criteria. No dependencies or risky-domain changes. This is within configured limits of two packages, six criteria and twelve files (`.factory/factory.toml:42-45`).
- The named test covers empty and whitespace content across fresh 0/3-document fixtures, using only public mutation/metrics APIs and requiring constant query/read counts and byte-read independence.
- `done_when` runs the exact named test with assertions required, reads Vitest's JSON report, and requires exactly one passing result. Missing or skipped tests cannot masquerade as a successful name-filtered run. With the test absent at baseline the report guard fails; with the new test and old production handler the expected-two-queries assertion fails.
- Full existing document and upload-attempt suites remain required. Factory project gates still apply. The ticket is proposed, awaiting the root's independent review; no product source/tests have been edited.

The factory-plan skill forbids executing tests during ticket authoring. Therefore the new `done_when` has been checked against the installed CLI/reporter source but not run during this planning step. The baseline runner and metric seam were executed earlier as explicitly authorized independent audit work; the root can execute the new completion predicate during review. Vitest's installed CLI exposes `--expect.requireAssertions` and its JSON reporter supplies `success`, `numPassedTests`, `assertionResults[].title` and `status` as used by the predicate.

## Alternatives rejected

- Extracting the production handler or introducing a proxy/test seam adds indirection to prove a branch whose cost is already observable through public APIs. Principles 1 and 5 favor the inline guard and existing suite.
- Changing collection limits or adding hashes/indexes would alter nonempty dedupe correctness or require schema/backfill work. The ticket leaves that larger PERF-4 follow-up deferred.
- Keeping PERF-3 deferred until the larger redesign delays a measured, narrow improvement for a verification blocker that no longer exists. Principle 16 favors executing the actual registered mutation and making its read cost a regression criterion.

