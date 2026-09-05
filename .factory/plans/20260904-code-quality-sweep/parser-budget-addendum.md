# Sequential PDF budget proof addendum

Proposed ticket: `.factory/tickets/proof-1-parser-budget-sequence.md`. Dependency: `perf-1-parser-timers-editor-index`. This addendum does not change the sweep's main research or architecture.

## Source-specific finding

Read-only review at PERF-1 commit `77825a21aea49be6299c84dd805904784a40a351` found a test-fixture timing error, with no production defect:

- `src/lib/parseDocument.test.ts:172-173`: `after(ms, value)` allocates its timeout when called.
- `:176` and `:188-190`: `PageSpec.textContent` is a promise; the fake page's `getTextContent` returns that already-created promise.
- `:225-229`: the cumulative-budget test evaluates `after(20_000, null)` for loading and `after(20_000, pageText)` for page 1 during the same synchronous setup. The timers run concurrently. When loading resolves at total time 20,000 ms, the page-1 text promise has also resolved, so page 2 starts then.
- `:237-245`: the existing test jumps straight to total time 59,999 ms, then 60,000 ms. It observes the fixed absolute deadline but never observes the intermediate phases. Its `t=40s` comment therefore overstates what this fixture does.
- `src/lib/parseDocument.ts:183` fixes the whole-file deadline once; `:191-195` awaits document load, page retrieval and page text in order. `:200-219` preserves timeout markers, non-timeout rejections and loading-task destruction. No change to this production path is needed.
- `src/lib/components/editor/Editor.component.test.ts:52-61` correctly explains that identical inline strike decorations merge into one span while replacement widgets remain separate. Its first test title at `:108` incorrectly claims strikes are rendered per pair. The existing fixture and assertions correctly expect 20 removed spans and 21 added widgets, so only the title needs correction.

PERF-1's existing budget test still catches a timeout restarted for every call: page 2 starting at 20 seconds would time out at 80 seconds under that incorrect implementation. The finding is specifically that the documented sequential 20-second plus 20-second workload is not exercised.

## Concrete fixture correction

Keep the existing test and `installPdf` helper. Make `PageSpec.textContent` an optional callback returning `Promise<{ items: { str: string }[] }>`; invoke it inside the already-existing `getTextContent` method. This starts delayed work at the actual parser call, using the existing external pdfjs boundary. It needs no new wrapper, export, production seam, module or test.

The cumulative case uses `page1TextContent = vi.fn(() => after(20_000, pageText))` and `page2TextContent = vi.fn(never)`. After the first asynchronous 20,000 ms advance, page 1 text has been requested once and page 2 text has not been requested. After the second 20,000 ms advance, page 2 text has been requested once. Advances of 19,999 ms and 1 ms then retain the existing pending/result boundary. Because the production loop awaits page 1 text before retrieving page 2, these callback observations prove the required sequencing.

Adapt the existing later-page rejection spec to a callback returning `Promise.reject(boom)`, retaining original error identity and cleanup assertions. The existing success, never-load and all rejection cases remain. No new tests are required; the parser suite keeps 19 cases and the editor suite keeps four.

## Required negative proof

In the corrected case, temporarily create the page-1 text promise eagerly before `installPdf`, and have `page1TextContent` return that pre-created promise. Keep every new assertion, clock advance, production file and other fixture setting unchanged. The first phase assertion must fail because page 2 has already been called at total time 20,000 ms. Restore the lazy expression and record the same named test passing.

This negative proof has not been run during planning. Its mechanism follows directly from the checked fixture and parser sequence. Factory implementation must record the actual failure and success. Restoring the old production timer leak would test a different defect and is unnecessary for this ticket.

## Planning validation performed

The installed factory `parseFrontmatter` and `stringifyFrontmatter` exports were loaded from `/opt/homebrew/lib/node_modules/@conquerthecrowns/factory/src/v2/lib.mjs`. The ticket was parsed, stringified in memory, parsed again and compared using strict deep equality, including the entire `done_when` array. The single inline-array command survived exactly. Three acceptance criteria and two touched existing test files were confirmed.

The command also passed `zsh -n` and Node module syntax checking. Only its source-guard prefix was executed against the unchanged PERF-1 worktree; it failed as expected before any Vitest invocation because the required phase assertions are absent. No tests, build, server, shared backend or product write was performed.

```json
{"ticket":"proof-1-parser-budget-sequence","status":"proposed","criteria":3,"done_when_commands":1,"done_when_chars":1693,"roundtrip":"PASS","shell_syntax":"PASS","javascript_syntax":"PASS","dependency_source_guard":"EXPECTED FAIL: phase assertion missing","test_execution":"NONE"}
```

The full predicate requires the actual existing named test to contain both phase observations and four explicit clock advances, then requires exactly one passing Vitest JSON result with real assertions. A missing, skipped or failed test cannot satisfy it.

## Registration condition

The ticket remains `proposed`. Root should register it only if PERF-1 QA does not correct this same fixture and record the required negative proof. If QA covers both before registration, resolve this proposed duplicate through the orchestrator rather than adding redundant work. This agent authored only this addendum and the proposed ticket.

