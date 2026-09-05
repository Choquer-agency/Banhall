# Independent review: proof-1-parser-budget-sequence

Verdict: **approve**, subject to the ticket's existing duplicate-work registration condition. No blocking factual, scope, safety, or verification issue found. No tests or product code were changed or executed during this review.

- The source finding is correct. Existing `after()` schedules immediately (`src/lib/parseDocument.test.ts:172`), and the load and first-page text promises are both created during fixture setup (`:225-229`). Their two 20-second timers overlap. The existing 59,999/60,000 boundary proves an absolute deadline, but its comment does not establish a sequential 20+20-second workload.
- The proposed callback conversion is confined to the existing pdfjs fixture. The production parser awaits load, page retrieval and page text sequentially (`src/lib/parseDocument.ts:191-195`). A lazy page-1 callback therefore starts its 20-second delay after load completes. Observing page 1 called/page 2 uncalled after the first asynchronous 20-second advance, then page 2 called after the second, proves the intended phases. The retained 19,999/1 advances and outcome/destroy/timer assertions preserve the deadline and cleanup contract.
- The negative proof discriminates the original fixture defect: eagerly create page-1's promise before the load promise, retain every phase assertion, and the parser can start page 2 at total time 20 seconds. The required page-2-not-called assertion should then fail. The ticket correctly requires actual red/green evidence rather than treating this source reasoning as execution proof.
- `vi.fn(never)` returns a `Promise<never>`, which fits the required callback's promise result type without a cast. Converting only the later-page rejection to `() => Promise.reject(boom)` preserves rejection identity and avoids creating that rejection before its parser phase. The editor title correction agrees with the existing 20-strike/21-widget fixture and changes no behavior.
- Independently loaded the installed factory `parseFrontmatter` and `stringifyFrontmatter` exports, parsed the proposed ticket, stringified it in memory, parsed it again, and used strict deep equality for all frontmatter and `done_when`. The single **1693-character inline-array command survives exactly**. It also passes `zsh -n -c` and Node's module syntax check. Only its source-guard prefix was executed; it failed as expected on the missing `page1TextContent` phase assertion before any Vitest invocation.
- The completion predicate's exact-name filter, assertion-required flag, and exactly-one-passed JSON result retain the already-reviewed fail-closed mechanics. The additional source guard requires the specified phase assertions and explicit clock advances; it cannot pass the untouched fixture. Full suite runs and actual negative-proof output remain implementation obligations.

Independent check result:

```json
{"ticket":"proof-1-parser-budget-sequence","roundtrip":"PASS","commandLength":1693,"shellSyntax":"PASS","nodeModuleSyntax":"PASS","sourceGuard":"EXPECTED_FAIL_MISSING_PAGE1_PHASE_ASSERTION","testExecutions":0}
```
