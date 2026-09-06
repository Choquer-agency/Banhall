# Q8 real Anthropic SDK verification

Added only `convex/ai/structured.sdk.test.ts`; no production helper change was needed. Read the Q8 spec, all three review results, Convex guidelines, TypeScript guidance and relevant consumers before implementation. `before.json` and `receipt.json` bind HEAD, production/manifest hashes, installed SDK0.91.1, final test hash, commands/exits and log hashes. The final executable test also has a byte-identical `.txt` snapshot here.

## Real boundaries exercised

Both tests construct the actual `instrumentedAnthropic` client, which calls the actual `createAnthropicClient` constructor and wraps the installed SDK's unchanged `messages.create`. They invoke the actual `generateStructured` function and its Zod boundary. Neither the SDK, message method, providers module nor response decoder is mocked.

Only global HTTP fetch is replaced. It is fully intercepted before client construction and returns a synthetic Response; the synthetic API key never reaches a network transport. A default throwing fetch replacement guards against missing setup. The tests use a real convex-test ActionCtx, scheduler and database rather than fake application/context methods.

- Success asserts POST `/v1/messages`, synthetic API key and Anthropic API-version header; exact serialized model/token limit/system/user/tool schema and forced named-tool choice; decoded structured object from a tool_use block after a text block; one HTTP call; actual scheduled aiUsage row with input/output/cache token counters. Dropping the real SDK's tool_use decoding would fail this test rather than leave a canned messages.create result intact.
- HTTP401 asserts the installed SDK's AuthenticationError type, status, requestID and decoded provider error body through the application boundary. Exactly one HTTP call proves the provider error does not trigger the structured-output repair attempt or SDK auth retries. Actual usage storage remains empty.

The application path under test is **nonstreaming**: generateStructured calls messages.create without stream or a caller AbortSignal. A source search found the explicit signal in the separate OpenRouter transport, not this direct Anthropic path (`stream-signal-usage.txt`). No streaming or caller-cancellation feature was invented or claimed. Existing provider-budget tests still cover configured timeout/retry values; this addition does not prove a live timeout, external cancellation or streaming response.

## Commands and outcomes

1. `npm test -- convex/ai/structured.sdk.test.ts`: exit1,1passed/1failed (`focused.log`). Success roundtrip passed initially. The error fixture expected `request_id`; inspected installed SDK `core/error.mjs:10` and `core/error.d.ts:11`, which expose `requestID`. Corrected the test expectation only. This is a retained fixture failure, not a claimed SDK/application defect.
2. `npx vitest run tiptapConfig docSearch tiptapReport instrument providers pipeline.compare structured.sdk`: exit0,7files/91tests (`final-unit.log`), including both new real-SDK cases and the existing89 focused cases.
3. `PUBLIC_CONVEX_URL=https://placeholder.convex.cloud PUBLIC_CONVEX_SITE_URL=https://placeholder.convex.site npm run check`: exit0,0errors/0warnings (`check.log`).

Final test SHA and all source/log hashes are in `receipt.json`. API key, tool data, response and credentials are synthetic. Globals/environment and fake timers are restored in finally-backed teardown; zero timers remain. Real local usage persistence does not imply durable production scheduling was exercised. There was no external provider call, install, browser/build/full-gate run, staging, commit, spec/ledger change or other-checkout edit. Root retains other review findings and final cold-cache gate ownership.
