---
title: 'Provider retry budget fits the Convex action limit'
type: 'bugfix'
created: '2026-08-25'
status: 'done'
baseline_revision: 'b46bfe969b1aa1d56fe23404a12e52a70778e103'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/convex/_generated/ai/guidelines.md'
warnings: []
deferred:
  - summary: >-
      The per-call retry budget does not bound the whole generateCandidate action, which issues several sequential Anthropic stages (analyzer, sections, revision, QA/chronology); two hung stages in one action still exceed 600 s and bypass failGeneration.
    evidence: |-
      convex/ai/pipeline.ts:515 runs roughly four sequential provider stages per action; each stage now costs up to 480 s on a hang, so the action-level worst case is still above the Convex limit. Pre-existing and out of the config-only intent of story 6.
    location: >-
      convex/ai/pipeline.ts:515
    severity: medium
  - summary: >-
      normalizeProviderError has no branch for the SDK's APIConnectionTimeoutError ("Request timed out."), so a timed-out call is reported to users as "The AI provider rejected the request: Request timed out.".
    evidence: |-
      convex/ai/providers.ts normalizeProviderError matches only "network"/"fetch" for the network code; "timed out" falls through to "unknown". Now that timeouts surface inside the action budget this path is reachable; classification is a behavior change outside the config-only intent.
    location: >-
      convex/ai/providers.ts:90
    severity: medium
---

<intent-contract>

## Intent

**Problem:** `createAnthropicClient` (`convex/ai/providers.ts:26-27`) pins `maxRetries: 2` and an 8-minute per-attempt timeout, so one hung provider call can take 3 × 8 min = 24 min of wall clock while the Convex action that owns it (`generateCandidate`, `convex/ai/pipeline.ts:515`) is killed at 10 min. The action dies before the SDK ever surfaces a timeout error, so `failGeneration` never runs for that path (audit CAP-6, P1).

**Approach:** Config-only change. Set `ANTHROPIC_MAX_RETRIES = 1` and `ANTHROPIC_TIMEOUT_MS = 4 * 60 * 1000` so worst-case timeout × attempts is 2 × 240 s = 480 s, plus SDK backoff (≤ 8 s), under the 600 s action limit. Tighten the existing unit test so the product of the two constants is asserted against the action budget rather than the timeout alone.

## Boundaries & Constraints

**Always:**
- Both values stay exported constants on `convex/ai/providers.ts` and are the only place the Anthropic client is configured; `createAnthropicClient` keeps passing them through unchanged.
- The invariant is `ANTHROPIC_TIMEOUT_MS * (ANTHROPIC_MAX_RETRIES + 1) < 600_000` (attempts = retries + 1). Encode it in the test as a computed expression, not a literal 480000.
- Update the comment above the constants to state the attempts × timeout reasoning, replacing the "10-minute SDK default" note.
- Keep the `"use node"` directive and file header untouched.

**Block If:**
- Any call site is found that constructs an `Anthropic` client outside `createAnthropicClient` with its own `timeout`/`maxRetries` for the generation path (none exists at planning time; `convex/ai/brain/retrieve.ts:179` is a Voyage `rerank` option, not an Anthropic client, and is out of scope).

**Never:**
- Do not touch the OpenRouter transport policy (`convex/ai/openrouterCore.ts:104-106`, `OPENROUTER_MAX_RETRIES = 2` with per-attempt fetch timeouts); it is a separate budget and not part of CAP-6.
- Do not add per-call `timeout` overrides at `messages.create` call sites, do not change `instrumentedAnthropic`, and do not add streaming.
- Do not change any public `api.*` function or the pipeline's model-fallback (`retryModelIds`) logic.

</intent-contract>

## Code Map

- `convex/ai/providers.ts:23-37` -- the only edit site. Lines 23-25 are the rationale comment, `:26` `ANTHROPIC_MAX_RETRIES = 2`, `:27` `ANTHROPIC_TIMEOUT_MS = 8 * 60 * 1000`, `:29-37` `createAnthropicClient` passes both to `new Anthropic({...})`. Only the two literals and the comment change.
- `convex/ai/providers.test.ts:17-30` -- existing `createAnthropicClient` test stubs `ANTHROPIC_API_KEY` via `vi.stubEnv`, reads `client.maxRetries` / `client.timeout`, and asserts `ANTHROPIC_TIMEOUT_MS < 10 min`. Extend this test (or add a sibling `it`) with the attempts × timeout assertion; the vitest + `vi.stubEnv` pattern is already in place, no new harness.
- `convex/ai/pipeline.ts:515` -- `generateCandidate` internalAction; one model pass per action, which is why the whole retry budget must fit one 10-minute action. Read-only.
- `convex/ai/instrument.ts` -- `instrumentedAnthropic` wraps the client from `createAnthropicClient`; consumes the client, does not configure it. Read-only.
- `convex/ai/openrouterCore.ts:100-125` -- OpenRouter retry policy; evidence that it is independent of this change. Read-only.
- `docs/ai-engine-audit-2026-08-25.md:87,118` -- audit finding 7 and its recommended fix (`maxRetries: 1`, 4-min timeout). Read-only.

## Tasks & Acceptance

**Execution:**
- `convex/ai/providers.ts` -- change `ANTHROPIC_MAX_RETRIES` to `1` and `ANTHROPIC_TIMEOUT_MS` to `4 * 60 * 1000`; rewrite the comment above them to explain that (retries + 1) × timeout plus SDK backoff must stay under the 600 s Convex action limit -- the actual fix.
- `convex/ai/providers.test.ts` -- in the `createAnthropicClient` describe, assert `ANTHROPIC_TIMEOUT_MS * (ANTHROPIC_MAX_RETRIES + 1)` is less than `10 * 60 * 1000`; keep the existing `client.maxRetries` / `client.timeout` pass-through assertions -- pins the invariant so a future bump of either constant fails CI.

**Acceptance Criteria:**
- Given the Anthropic SDK client returned by `createAnthropicClient("generation")`, when `maxRetries` and `timeout` are read, then they equal `1` and `240000` respectively.
- Given the exported constants, when the worst case `(ANTHROPIC_MAX_RETRIES + 1) * ANTHROPIC_TIMEOUT_MS` is computed, then it is strictly less than `600000` ms.
- Given the full suite, when `npm test` runs, then `convex/ai/providers.test.ts` passes and no other test changes outcome (no other module reads these constants).

## Spec Change Log

## Review Triage Log

### 2026-08-25 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 0, low 4)
- defer: 2: (high 0, medium 2, low 0)
- reject: 12: (high 0, medium 2, low 10)
- addressed_findings:
  - `[low]` `[patch]` Comment claimed backoff is <= 8 s unconditionally; the SDK honours a 429/529 Retry-After header verbatim. Comment now states the 8 s figure applies to the hung-call (timeout) path, which carries no headers, and calls out Retry-After as a caveat.
  - `[low]` `[patch]` Comment implied the whole action is safe; it now scopes the 480 s claim to a single messages.create call and notes the per-action stage-count caveat.
  - `[low]` `[patch]` The Convex action limit literal appeared three times in the test file; hoisted a single CONVEX_ACTION_LIMIT_MS at file scope.
  - `[low]` `[patch]` The timeout-alone assertion was strictly implied by the new attempts x timeout test; removed it and split the tests into "client constructed with the constants" and "constants satisfy the budget invariant", with a comment explaining why the literal 1 / 240_000 pins are kept (they are the acceptance criteria).

## Verification

**Commands:**
- `npm test -- convex/ai/providers.test.ts` -- expected: all tests in the file pass, including the new attempts × timeout assertion.
- `npm run check` -- expected: svelte-check / tsc report no new errors.
- `git diff --stat` -- expected: exactly `convex/ai/providers.ts` and `convex/ai/providers.test.ts` changed.

## Auto Run Result

**Summary:** `ANTHROPIC_MAX_RETRIES` is now 1 and `ANTHROPIC_TIMEOUT_MS` is 4 minutes, so a hung Anthropic call costs at most 2 x 240 s = 480 s plus default SDK backoff, inside the 600 s Convex action limit. The comment above the constants explains the attempts x timeout reasoning and its caveats; the unit test pins the computed invariant.

**Files changed:**
- `convex/ai/providers.ts` -- retry/timeout constants retuned; rationale comment rewritten (per-call scope, Retry-After caveat).
- `convex/ai/providers.test.ts` -- hoisted `CONVEX_ACTION_LIMIT_MS`; one test for client construction with the pinned values, one for the `(maxRetries + 1) * timeout < limit` invariant.

**Review findings:** 4 patches applied (all low), 2 deferred (medium: per-action budget across sequential stages; timeout error classification in `normalizeProviderError`), 12 rejected (OpenRouter budget test, headroom assertion, doc line refs, behavioral SDK retry test, streaming stall, and similar items either excluded by the intent or not caused by this change).

**Follow-up review recommendation:** false. Patched: high 0, medium 0, low 4; score = 3 x 0 + 1 x 4 = 4 (< 5).

**Verification:**
- `npm test -- convex/ai/providers.test.ts` -- 3 tests passed.
- `PUBLIC_CONVEX_URL=<placeholder> npm run check` -- 0 errors, 0 warnings.
- `git diff --stat b46bfe9` -- `convex/ai/providers.ts`, `convex/ai/providers.test.ts`, and this spec only.

**Residual risks:**
- The 4-minute per-attempt timeout is tighter than the SDK's own sizing heuristic for `max_tokens: 8192` non-streaming calls (~230 s); a legitimately slow section draft can now time out, be retried once, and fail. The value is fixed by the intent (audit CAP-6); watch generation failure rates after deploy.
- Reducing retries from 2 to 1 means transient 429/529 overload exhausts sooner; the pipeline's model fallback is unchanged.
- A large `Retry-After` header on a rate-limited response is honoured verbatim by the SDK and is not covered by the invariant test.

