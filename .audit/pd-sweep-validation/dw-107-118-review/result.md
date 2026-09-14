Reviewed `e22a4b4` strictly read-only. No tests or package installs were run.

- **High — `convex/generations.ts:1642`: byte-heavy Briefs can still stall generation.** `readBriefEntryRowsOrOmit` reads up to 501 complete documents without a byte budget. A Brief below the row cap can exhaust the transaction’s 16 MiB read allowance, particularly when `loadBriefCheck` shares the transaction with prior-section reads. The exception occurs before whole-Brief omission; `orderedGeneration.ts:174` and `:374` await these operations outside their error handlers, leaving work unfinished until recovery. **Fix:** use a byte-bounded read with sufficient transaction headroom, omit the entire Brief when incomplete, and test byte overflow through both consumers. This is a documented, pre-existing deferred defect, unchanged by later commits.

- **Medium — `convex/generations.ts:1962`: publication fences the Brief baseline but not the generation lifecycle.** If a writer cancels an iterative generation while its Brief model call is running, the returning action can still publish the project’s newest Brief and stamp the failed generation at `:2091`. Subsequent derivations or reuse can consume that abandoned attempt’s Brief. **Fix:** atomically check generation ownership, permitted lifecycle state, and `project.activeGenerationId` before publication or reuse stamping; terminate stale publication without treating it as a retryable baseline conflict. Add a cancellation-during-derivation regression. This is also documented and pre-existing.

No later commit reintroduced the CAP-4 row-count lockout or weakened live-evidence filtering. `f5f27ae` intentionally adds same-input adoption before the fence under DW-112; changed-input publication remains fenced.

The scoped readers contain no silent row-count prefix: sources probe 201 and refuse overflow; consumers probe 501 and omit overflow; baseline queries page with row and byte bounds. `briefs.ts:50` still returns a writer-facing prefix, explicitly excluded here and assigned to DW-128.

## Acceptance criteria coverage

“Verified” below means implementation and test coverage verified by inspection, not execution.

| AC | Status | Evidence at `e22a4b4` |
|---|---|---|
| 1. Recover from 821-row newest Brief; truthful diff and immutable history | **Verified** | `convex/ai/brief.test.ts:2992` uses actual `generateReport`, checks retained rows beyond index 500, dropped index-500 evidence, returning historical keys, excluded questions, and deep-equal prior versions. |
| 2. Derive again from recovered version and render | **Verified** | Same test at `:3082` verifies the next live-only diff and actual rendering. |
| 3. Regression fails on attempt-1 bytes and passes after repair | **Unverified** | Current regression targets the correct failure, but the referenced `.audit/dw-brief-read-and-diff-integrity/` directory is absent. |
| 4. Writer-edit race, exhausted retries, interrupted read and recovery | **Verified** | `brief.test.ts:2098`, `:2158`, `:2204`: real writer mutation, exactly three actual fence misses, injected page failure followed by uninjected successful publication. |
| 5. Discard byte-limited pages and enumerate every live row | **Verified** | `brief.test.ts:2585` exercises actual page queries, accepted/discarded counts, and complete row coverage. |
| 6. Compact retained-reference transport and truthful publication | **Verified current coverage; historical red unverified** | `brief.test.ts:2688` measures the actual mutation argument using `convexToJson` and checks fresh retained text and full removed payloads. Historical pre-P1 failure logs are unavailable. |
| 7. Canonical verification gate passes on final bytes | **Unverified** | Not run under the read-only restriction; historical claims do not establish a pass at this HEAD. |

The tests are substantive: `briefPublishCtx` at `brief.test.ts:950` invokes real test queries and mutations. Prompt tests at `promptProgram.test.ts:988`, `:1038`, `:1064`, and `:1086` execute generation actions and inspect captured prompts. Question exclusion and consumer parity are covered at `brief.test.ts:1378`. Production Convex limit enforcement remains unproven.

ACCEPT_WITH_FIXES