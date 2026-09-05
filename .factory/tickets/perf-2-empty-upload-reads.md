---
key: perf-2-empty-upload-reads
status: todo
kind: perf
deps: []
touches: [convex]
risky: []
verify: [npx vitest run convex/documents.test.ts convex/uploadAttempts.test.ts --expect.requireAssertions]
done_when: ["node --input-type=module -e 'import { execFileSync } from \"node:child_process\"; const name = \"empty and whitespace uploads keep document reads constant\"; const report = JSON.parse(execFileSync(process.execPath, [\"node_modules/vitest/vitest.mjs\", \"run\", \"convex/documents.test.ts\", \"--testNamePattern\", \"^uploadDocument processing status \" + name + \"$\", \"--reporter=json\", \"--expect.requireAssertions\"], { encoding: \"utf8\" })); const matches = report.testResults.flatMap(file => file.assertionResults).filter(result => result.title === name); if (!report.success || report.numPassedTests !== 1 || matches.length !== 1 || matches[0].status !== \"passed\") throw new Error(\"Expected exactly one passing upload read-invariance test; missing, skipped, or failed is not done\");'"]
title: Empty and whitespace-only uploads avoid reading existing document bodies
plan: 20260904-code-quality-sweep
ui: false
updated: "2026-09-05T06:00:13.816Z"
---
## Intent

Writers uploading an image, an unreadable file or whitespace-only extracted text should not pay to reread every supporting-file body already on the project. `uploadDocument` currently collects all project documents before deciding that empty content cannot be deduplicated (`convex/documents.ts:83-92`). The actual registered mutation costs 3 database queries and reads 301,074 bytes with three existing 100,000-character documents, even for an empty image upload. This ticket moves the existing dedupe-eligibility decision ahead of that query and adds a regression using the installed public transaction metrics. The maintainer keeps one production handler and its existing test suite. Principle 1, laziness protocol: make the smallest branch change. Principle 16, prove it works: measure the actual registered mutation through `convex-test`, without a production wrapper or mocked database.

## Acceptance

- AC1: Add exactly one test named `empty and whitespace uploads keep document reads constant` inside the existing `uploadDocument processing status` describe block in `convex/documents.test.ts`. Using fresh fixtures for each combination of content `""` or `" \n\t "` and 0 or 3 existing project documents of 100,000 characters each, invoke the actual registered `api.documents.uploadDocument` through `writer.mutation(async ctx => { const documentId = await ctx.runMutation(api.documents.uploadDocument, args); return { documentId, metrics: await ctx.meta.getTransactionMetrics() }; })`. Omit optional report, storage and attempt arguments from this measurement. Every combination has `databaseQueries.used === 2` and `documentsRead.used === 2`; adding the three bodies does not increase `bytesRead.used` for otherwise identical fixtures. Capture metrics before any verification reads. The test contains real assertions and is neither skipped nor conditional on implementation details.
- AC2: In `convex/documents.ts`, compute the existing `args.content.trim().length > 0` eligibility once after the current access/report validation and execute the current project-index query only when eligible. Nonempty uploads retain the same `(fileName, content)` comparison against the full existing collection, including legacy and archived rows. Empty and whitespace content continue through the current insertion/status/attempt path with original content unchanged. No schema, auth, generated file, API, report prose or other production module changes are made, and no production test seam is introduced.
- AC3: Preserve current behavior for nonempty dedupe, status derivation and uploader-role attribution, separate blank rows, per-upload attempt resolution, malformed-attempt transaction rollback, original-byte storage handling and access checks. Existing `convex/documents.test.ts` and `convex/uploadAttempts.test.ts` pass unchanged apart from additive cases. Add a regression in the existing documents suite that an unauthenticated empty/whitespace upload is rejected and creates no document; the optimization never bypasses authorization or returns before receipt/status handling.
- AC4: Record two baseline runs and two fixed-HEAD runs of the existing `upload-read-baseline.mjs` runner, with source hashes and exact commit ids, in `.audit/perf-2-empty-upload-reads/evidence.md`. Each baseline run reproduces 3 queries / 2 document reads with no existing documents and 3 queries / 5 document reads with three existing documents; the saved reference byte totals are 375 and 301,074. Each fixed run yields 2 queries / 2 document reads for both fixture sizes, with equal bytes read across the two sizes and the same `reference_only` result. Record the named AC1 test failing against baseline production code because it sees 3 queries, then passing at HEAD. Timing is not a target; query/read counts and unchanged outcomes are the criteria.

## Verification

- AC1: the executable `done_when` runs only the exact named test with the installed Vitest JSON reporter and `--expect.requireAssertions`, then requires exactly one passing assertion-result entry. A missing, skipped or failed named test cannot pass even if Vitest treats an unmatched name filter as a successful empty run. At the untouched baseline the test is absent, so the JSON-result guard fails. After adding only the test, the baseline production query count is 3 and its expected-2 assertion fails.
- AC2 and AC3: `npx vitest run convex/documents.test.ts convex/uploadAttempts.test.ts --expect.requireAssertions`, plus the project verification gate. Review the production diff to confirm it is confined to guarding the existing dedupe read; no new export/helper/wrapper, no `.take()` substitution and no authorization/schema changes. The only implementation files are `convex/documents.ts` and `convex/documents.test.ts`.
- AC4: run the following command twice from the engine-created ticket worktree before the production change, and twice from that same worktree at fixed HEAD. The runner resolves source and installed packages from the current directory, so the absolute script location does not select the checkout being measured:

```sh
node /Users/johnnynguyen/Documents/Repos/Banhall/.factory/plans/20260904-code-quality-sweep/upload-read-baseline.mjs
```

The existing runner performs no file writes, rejects `fetch`, and invokes the actual registered mutation against a fresh in-memory `convex-test` backend and the real project schema/auth helpers. No deployment, credentials, remote function call or local server is required. Reference source commit: `11bfe3ebcb79fd8be78e2e057b45ea69db0f88be`; reference `convex/documents.ts` SHA-256: `3ab18a85774fc3bcdd44d68d680831ade83cbc15b1b08ea06c3c214167c8eab9`. If the engine baseline includes later unrelated commits, record that actual commit and verify the source hash before comparing. Do not modify the runner, add another worktree, or use a fixed implementation while collecting the baseline.

## Implementation notes

- Read `convex/_generated/ai/guidelines.md` before editing Convex code. Keep `requireInternalProjectAccess` and report ownership validation at `documents.ts:66-72` before the optimization. `projects.createdBy` retains its current meaning, human workflow/generation state remains separate, and agents must continue proposing report edits through `chatProposals` plus human `applyProposal`.
- Keep the production change inline in `uploadDocument`. The current handler already contains both the eligibility decision and dedupe mechanics; move the conditional read rather than extracting the handler. Do not add `async` wrappers, a context Proxy, `_handler` calls, private syscalls or production metrics logging.
- Reuse the current `setup()` fixture in `documents.test.ts:12`. Seed supporting rows through `t.run`; obtain the existing fixture project's creator only for required fixture fields. Put measured work in a subsequent fresh `writer.mutation` transaction. Seed/setup/verification queries must not be included in upload metrics. Each content/count combination gets a fresh fixture so earlier uploads cannot alter the corpus.
- Query/read counters are stable structural assertions for this small fixture. Exact byte totals are evidence for the recorded fixture and package versions, not a universal deployment contract. Compare otherwise identical fixture read bytes across 0 and 3 supporting rows; do not assert that every caller with optional report/attempt arguments performs only two reads.
- Existing behavior pins: distinct unreadable files at `documents.test.ts:238`, per-attempt resolution at `:274`, nonempty dedupe at `:309`, whitespace-only separate rows at `:326`, malformed-attempt rollback at `:345`, identical replacements at `:400`, unreadable replacements at `:435`; upload-attempt integration cases at `uploadAttempts.test.ts:131` and `:157`. Keep these tests and their assertions.
- `.audit/perf-2-empty-upload-reads/decisions.tsv` and `evidence.md` follow factory evidence rules. Any newly discovered out-of-scope issue belongs in the ticket's `deferred` frontmatter. Never push, open a PR, deploy, mutate a shared database or edit `convex/_generated`.

## Edge cases

- Empty string and whitespace-only text both skip dedupe, but stored content/status derivation must not be rewritten or normalized by this optimization.
- Two empty uploads with the same filename still produce distinct records and resolve only their own attempts.
- A nonempty duplicate still takes the existing path, including status backfill and orphan-storage handling.
- Rejected access, invalid report ownership and invalid attempt keys retain the same transaction behavior.
- Archived supporting documents still participate in the unchanged nonempty dedupe lookup.

