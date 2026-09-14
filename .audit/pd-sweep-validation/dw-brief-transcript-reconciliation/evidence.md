# dw-brief-transcript-reconciliation (DW-114): before/after evidence

- Fix commit: `087c76b18a8ad462498653651a3fcb971e31baf4`. Baseline (first parent): `750842f5897deacd04ba15519a6aa640a8660fce`. Final head: `e22a4b49c54252cc53010d36ea001bd13fc1b179` (ancestor; `brief.sdk.test.ts` and `brief.ts` are identical at the fix and the head).
- Production change: `convex/ai/brief.ts` only. It adds reconciliation rules to `BRIEF_SYSTEM_PROMPT`, rewords the "unreliable" definition and adds `[SOURCE_KIND=<kind>]` tags to the evidence delimiters in `buildBriefUserMessage`. The prompt and serialization change nothing in persistence logic.
- Test: `convex/ai/brief.sdk.test.ts` (new file in the fix commit).
- Env, worktree and wrapper are the same as the other bundles: placeholder `PUBLIC_CONVEX_*`, `npm ci`, node v22.22.3, vitest v4.1.10.
  Command: `npx vitest run --config vitest.config.ts --reporter=verbose --reporter=json --outputFile.json=<label>.json convex/ai/brief.sdk.test.ts`

## Runs

| Log | Tree | Exit | Result |
|---|---|---|---|
| `before.raw.log` | baseline 750842f plus the `brief.sdk.test.ts` overlay (status `A`) | 1 | 2 failed / 2 |
| `before-persistence-probe.raw.log` | baseline 750842f plus probe `persistence-probe.test.ts` (copy saved here) | 0 | 1 passed, 1 skipped |
| `after-fix.raw.log` | 087c76b, clean | 0 | 2 passed / 2 |
| `after-head.raw.log` | e22a4b4, clean | 0 | 2 passed / 2 |

## Discriminating tests: 2 (both behavior-level on the serialized request, not compile-level)

1. `serializes stable Brief source-kind tags and excludes a writer Storyline`. The baseline fails because the message contains `--- BEGIN [CUSTOM INTERVIEW] ---` with no `[SOURCE_KIND=transcript]` tag.
2. `serializes reconciliation instructions through the real Brief SDK and persists a representative reconciled response`. The baseline fails at `brief.sdk.test.ts:315`: the HTTP request body's `system` lacks "When three or more blocks carry [SOURCE_KIND=transcript], reconcile those Transcripts…".

## Real SDK boundary (AGENTS.md requirement): yes

- The file has no `vi.mock`. It imports the real `clientForModel` from `./providers`, which constructs `new Anthropic(...)` (`providers.ts:10,103`).
- `globalThis.fetch` is stubbed with `vi.stubGlobal`. The default stub throws "Unexpected HTTP transport". The test stub captures the `Request` and returns a raw `Response.json(...)` Messages API payload. The test asserts URL `https://api.anthropic.com/v1/messages`, POST, the `x-api-key` header, the parsed body (model, `max_tokens` 8192, system, tools, `tool_choice`, messages), and exactly one transport call. The SDK decoding, structured parsing, citation filter and Convex persistence (convex-test) all run for real.

## Strength caveat: the persistence half does not discriminate

- The provider response is canned. The probe (`before-persistence-probe.raw.log`) disables only the 22 `requestBody.system` string assertions and the one `SOURCE_KIND` delimiter assertion, and skips test 1. The rest of test 2 then **passes at the baseline**: one Brief, 4 storyline claims, 3 established and 3 unresolved Confidence Map rows with exact source ids, hashes and offsets, the fabricated quote dropped with `droppedEntryCount: 1`, and one aiUsage row.
- So ACs 1 to 3 (persistence, citation binding and fabricated-quote drop) are proven only as regression guards. They held before the fix too. The only code-under-change that the test discriminates is the prompt and delimiter text reaching the HTTP body.
- `expect(requestBody).toEqual({ system: BRIEF_SYSTEM_PROMPT, messages: [{ content: buildBriefUserMessage(fixture.sources) }] ... })` compares against the module's own exports. It is tautological with respect to prompt content. The literal `toContain` assertions after it are what discriminate.
- Nothing tests whether a live model actually reconciles transcripts. The spec's Design Notes acknowledge this.

## AC to test map

| AC | Test | Discriminating? |
|---|---|---|
| AC1: three transcripts through the real SDK boundary produce exactly one Brief storing the Storyline, agreements and every competing claim | Test 2 (HTTP-body assertions plus the persistence assertions) | The prompt part is. The persistence part is not (see probe). |
| AC2: each unresolved claim cites its exact originating source bytes | Test 2 (`expectedContradictions` loop plus the per-entry source-slice loop) | No (passes at the baseline) |
| AC3: a fabricated quote is dropped and counted while valid entries remain | Test 2 (`droppedEntryCount: 1`, fabricated text absent) | No (passes at the baseline) |
| AC4: the focused test plus `loop-verify.sh` pass, with raw streams retrievable under `.audit/DW-114/` | No test (process AC). `.audit/DW-114/` is **not present** in this worktree or in the fix commit: it is ignored and lived in the bmad-loop run worktree. The full gate was not run here. | n/a |
| AC5: schemas, provider-call count, source limits, context budgets and generated files are unchanged | Partly covered: test 2 asserts one transport call and `max_tokens` 8192. The rest is diff-inspection only; the fix commit touches only `brief.ts`, the test, the spec and the ledger. | n/a |
