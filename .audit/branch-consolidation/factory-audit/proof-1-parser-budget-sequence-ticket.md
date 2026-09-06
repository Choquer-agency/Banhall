---
key: proof-1-parser-budget-sequence
status: done
kind: bug
deps: [perf-1-parser-timers-editor-index]
touches: [src/lib/parseDocument.test.ts, src/lib/components/editor/Editor.component.test.ts]
risky: []
verify: [npx vitest run src/lib/parseDocument.test.ts --expect.requireAssertions, npx vitest run --config vitest.component.config.ts src/lib/components/editor/Editor.component.test.ts --expect.requireAssertions]
done_when: ["node --input-type=module -e 'import { readFileSync } from \"node:fs\"; import { execFileSync } from \"node:child_process\"; const file = \"src/lib/parseDocument.test.ts\"; const name = \"keeps one cumulative 60s budget across the load and every page\"; const source = readFileSync(file, \"utf8\"); const start = source.indexOf(\"it(\" + JSON.stringify(name)); if (start < 0) throw new Error(\"Missing cumulative-budget test\"); const end = source.indexOf(\"\\n  it(\", start + 1); const body = source.slice(start, end < 0 ? undefined : end); const required = [\"expect(page1TextContent).toHaveBeenCalledTimes(1);\", \"expect(page2TextContent).not.toHaveBeenCalled();\", \"expect(page2TextContent).toHaveBeenCalledTimes(1);\", \"await vi.advanceTimersByTimeAsync(19_999);\", \"expect(settled).toBe(false);\", \"await vi.advanceTimersByTimeAsync(1);\"]; for (const assertion of required) if (!body.includes(assertion)) throw new Error(\"Missing required phase/boundary assertion: \" + assertion); if (body.split(\"await vi.advanceTimersByTimeAsync(20_000);\").length - 1 !== 2) throw new Error(\"Expected two explicit sequential 20-second advances\"); const report = JSON.parse(execFileSync(process.execPath, [\"node_modules/vitest/vitest.mjs\", \"run\", file, \"--testNamePattern\", \"^PDF parse deadline \" + name + \"$\", \"--reporter=json\", \"--expect.requireAssertions\"], { encoding: \"utf8\" })); const matches = report.testResults.flatMap(result => result.assertionResults).filter(result => result.title === name); if (!report.success || report.numPassedTests !== 1 || matches.length !== 1 || matches[0].status !== \"passed\") throw new Error(\"Expected exactly one passing cumulative-budget test; missing, skipped or failed is not done\");'"]
title: Prove PDF load and page text consume sequential parts of the shared deadline
plan: 20260904-code-quality-sweep
ui: false
updated: "2026-09-05T07:36:58.492Z"
run: 20260905-072238-8-tickets
branch: factory/proof-1-parser-budget-sequence
merged: 7a32eee
verdict: test-verified
evidence: .audit/proof-1-parser-budget-sequence/evidence.md
---
## Intent

Give the maintainer an accurate proof of the shared PDF deadline already implemented by PERF-1. The existing cumulative-budget case creates the document-load and page-text timers together at fixture setup, so both resolve at 20 seconds even though its comment and PERF-1 AC2(a) require page 1 text to take another 20 seconds. This ticket corrects that existing case, explicitly proves both phases, and corrects the existing editor preview test's description of merged strike decorations. No production behavior changes. Principle 1, laziness protocol: amend two existing tests, without adding another test or helper. Principle 16, prove it works: require the eager-timer regression to fail the new phase assertion.

## Acceptance

- AC1: Amend the existing `PDF parse deadline > keeps one cumulative 60s budget across the load and every page` test in `src/lib/parseDocument.test.ts`. The document-load promise resolves after 20,000 ms; page 1's text delay is created only when its `getTextContent` is invoked and resolves after another 20,000 ms; page 2's text never resolves. Use local spies named `page1TextContent` and `page2TextContent` as the two page specs' lazy text callbacks. After the first explicit `await vi.advanceTimersByTimeAsync(20_000);`, assert `expect(page1TextContent).toHaveBeenCalledTimes(1);` and `expect(page2TextContent).not.toHaveBeenCalled();`. After the second explicit 20,000 ms advance, assert `expect(page2TextContent).toHaveBeenCalledTimes(1);`. These are actual callback observations on the real parser path through the existing pdfjs mock.
- AC2: In that same case, advance another 19,999 ms and retain `expect(settled).toBe(false);`; advance the final 1 ms and preserve the exact page-1 text plus `pdfPageStopMarker(2)`, one destroy call and zero pending timers. Keep the existing successful parse, never-loading PDF and all three original-error rejection cases and assertions. Only the two listed existing test files may change; no new tests, production source changes, wrappers, exports, modules, configs or dependencies. The existing editor preview test title becomes `renders merged strikes per occurrence and insertion widgets per replacement pair`, with its fixture and assertions unchanged: the duplicate pair still merges strike spans and retains separate insertion widgets.
- AC3: Record a negative and positive run of the exact cumulative-budget test in `.audit/proof-1-parser-budget-sequence/evidence.md`, with the dependency baseline and fixed HEAD commit ids. With all new phase assertions retained, temporarily restore eager construction of the page-1 text promise before `installPdf`, while the callback merely returns that already-created promise. The test must fail `expect(page2TextContent).not.toHaveBeenCalled();` at total time 20,000 ms because page 2 has already started. Restore lazy construction and record that the same test passes. The full parser and four-case editor component suites pass, with no test-count increase.

## Verification

- AC1 and AC2: `done_when` is a single inline-array command. It requires the actual named test to contain both phase observations and the four exact fake-clock advances, then runs only that named case with Vitest's JSON reporter and `--expect.requireAssertions`. Exactly one passing result is required, so an absent/skipped case cannot pass. The source guard fails on the current PERF-1 fixture because it contains none of the new phase observations. Run the full parser suite afterward with the ticket's first verify command.
- AC2: the second verify command runs the real Chromium Editor suite. Its four cases, fixture data, 20 removed spans and 21 added widgets remain unchanged. The only editor-file diff is the inaccurate title's correction.
- AC3: use the same test filter in the failing eager and passing lazy runs:

```sh
npx vitest run src/lib/parseDocument.test.ts --testNamePattern '^PDF parse deadline keeps one cumulative 60s budget across the load and every page$' --expect.requireAssertions
```

First establish the red proof with the new phase assertions and eager page-1 promise. Then restore the intended lazy callback and run green. Record output proving the failure came from the 20-second page-2 call assertion, not a missing test, compile error or timeout. Keep every assertion during the negative run; do not alter production code. This proof concerns the corrected fixture, so restoring the old production timer leak is unrelated and unnecessary.

## Implementation notes

Source checked against PERF-1 worktree commit `77825a2`: `parseDocument.test.ts:172-173` creates the timer when `after` is called; `:176` models `PageSpec.textContent` as an already-created promise; `:188-190` returns it without invoking a factory; `:225-246` creates both 20-second promises at setup. The real parser dynamically imports pdfjs, then awaits load, page retrieval and page text in sequence at `parseDocument.ts:179-195`; all operations use the fixed deadline at `:183`. The error fixtures using `textContent` are in the same describe block at `:269-274`.

Use these exact existing mechanics:

1. Change only `PageSpec.textContent` to an optional callback returning `Promise<{ items: { str: string }[] }>`. Retain `text` and `getPage` as they are. In the existing fake page, use `spec.textContent?.() ?? Promise.resolve(...)` from `getTextContent`. Do not add a new test helper or a production seam.
2. In the cumulative case, define `const page1TextContent = vi.fn(() => after(20_000, { items: [{ str: "Page" }, { str: "one" }] }));` and `const page2TextContent = vi.fn(never);`, then pass `{ textContent: page1TextContent }` and `{ textContent: page2TextContent }` to the existing `installPdf(after(20_000, null), ...)`. These factories are local to this test. The promise returned by `never` fits the typed callback without a cast.
3. Adapt the existing later-page rejection spec to `textContent: () => Promise.reject(boom)`, preserving its error-identity assertion. This changes fixture delivery, not the tested rejection behavior. Remove obsolete `as Promise<never>` casts only where this callback conversion makes them unnecessary.
4. Insert the two 20,000 ms phase advances and assertions specified in AC1, then use 19,999 ms and 1 ms for the existing terminal boundary. The parser awaits page 1 text before retrieving page 2, so observing `page2TextContent` proves the second page's processing has begun. Update the existing timing comment to describe the observed phases.
5. For the negative proof only, create `const eagerPage1Content = after(20_000, { items: [{ str: "Page" }, { str: "one" }] });` before `installPdf` and change the local spy to `vi.fn(() => eagerPage1Content)`. Leave the load at 20 seconds and every assertion intact. Both promises then settle at 20 seconds, so the parser reaches page 2 before the first phase assertion. Remove this temporary eager variable when restoring green.
6. Rename only the first editor component test's title at `Editor.component.test.ts:108`. Its explanatory comment at `:52-61` already describes ProseMirror's merging correctly.

Factory owns the worktree and gate; do not create another worktree. Evidence and the append-only decisions trail follow `.factory/AGENTS.factory.md`. Never push, open a PR, deploy, access a shared backend, change report prose or edit generated Convex files. If PERF-1 QA already fixes this exact fixture and records the required negative proof before this proposed ticket is registered, the root orchestrator should resolve the duplicate instead of running this ticket.

## Edge cases

- The baseline deadline boundary test already passes despite eager timers; the new intermediate phase assertion is the necessary discriminator.
- Fake timers must drain async parser continuations through `advanceTimersByTimeAsync`; synchronous clock advances do not prove callback ordering.
- The rejection callback must reject with the exact existing `boom` object, and destroy/timer assertions must stay intact.
- Duplicate preview pairs still render merged strikes and separate widgets. Only the test title changes.


## QA output for this run

The configured QA tool allowlist permits the verification commands but denies Edit/Write to audit files. The factory engine itself persists the QA structured summary and checks as `.audit/<ticket>/qa-<loop>.md` (engine.mjs, QA stage). Return the complete truthful QA report through those structured fields; the engine-written file is the canonical QA output for this run. The orchestrator links it from root evidence after merge. Do not spend retries attempting manual evidence writes or require a human merely to append this report. This changes no runtime verification requirement or tool permission. Actual failures, missing evidence and unverified behavior must still be reported accurately.
