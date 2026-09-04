# DW-92 native review and verification evidence

Entry/source baseline: `137d77f87db77d8296f5e759ebfa7e2a55709c25`. The regression tests were added before modifying product source. Historical repair baseline `0dd0d6bd98c28e54107ae10fe06a90fd83c6dab2` and original implementation baseline `f122b086d745acc40b4decca26b9aaafc7257f6a` remain unchanged. Both are verified ancestors (`provenance.json`). Local final source commit is recorded during finalization below.

The bundle expressly authorizes current standard gates in this isolated session. The old scheduling hold and failed native run remain recorded in the original story and `.audit/CAP-8/`; those artifacts are not treated as current success. Existing CAP-8 evidence is tracked. All fresh DW-92 evidence listed here is explicitly staged with `git add -f`.

## Acceptance mapping

| Frozen criterion / matrix case | Executed runtime proof |
|---|---|
| Deterministic rows on canonical creation and writes | `convex/qaBlocking.test.ts`: human save, single-candidate completion, canonical content writers, project copy; exact-reference assertions |
| Current blockers reject readiness and publish without writes | `qaBlocking`: explicit methodology flags, human-save failure, manager/admin feedback, new DW-92 regressions; `expectBlocked` compares project state before/after rejection |
| Stale/advisory/foreign findings do not block; authorization preserved | `qaBlocking`: advisory-only successful publish, human correction, late QA, legacy/unpinned data, foreign identity/hash, authorization ordering |
| Retry deduplication and no waiver | `qaBlocking`: same-revision retry, passing score, no-op save, identical-content restore, skeleton overrides |
| Provider result reaches persisted blockers and both boundaries | `convex/generationAttribution.test.ts:935`: registered post-QA action with controlled provider response, exercised by full gate |
| Required test/type gates and no frontend edits | Final standard gate and exact spec command below; entry-relative `git diff --name-only -- src/ convex/_generated/` empty |

## Commands and actual outcomes

- Initial `bash scripts/loop-verify.sh`: exit 0, 148 files / 1,726 tests; both type checks; PowerShell 50, Bash 18. Raw log: `loop-verify.log`.
- Initial supplemental filter command: `npx vitest run convex/ai/qaChecks.test.ts convex/projects.test.ts convex/qaBlocking.test.ts convex/lib/tiptapReport.test.ts convex/ai/postQa.test.ts`, exit 0, 152 tests in four files (`focused.log`). `convex/ai/postQa.test.ts` does not exist and matched no file; no claim of executing that nonexistent suite is made. Provider-action coverage lives in `generationAttribution.test.ts`, executed by the full gate.
- Initial exact spec command: `npx vitest run convex/ai/qaChecks.test.ts convex/projects.test.ts convex/qaBlocking.test.ts`, exit 0, 141 tests (`spec-focused.log`).
- Red: `npx vitest run convex/qaBlocking.test.ts -t 'DW-92 native follow-up'`, exit 1, four failures and 38 skipped (`before.log`). Every failure is missing `QA_BLOCKING` at the registered readiness query on entry product source.
- Green: `npx vitest run convex/qaBlocking.test.ts convex/lib/tiptapReport.test.ts convex/ai/qaChecks.test.ts`, exit 0, 81 tests (`after.log`). All four new cases also exercise atomic publish rejection and persistence after canonical save.
- Final `bash scripts/loop-verify.sh`: exit 0 (`final-loop-verify.log`). Runs Convex TypeScript, Svelte check, npm test, and both uploader harnesses under `set -e`.
- Final exact spec command: `npx vitest run convex/ai/qaChecks.test.ts convex/projects.test.ts convex/qaBlocking.test.ts`, exit 0, 145 tests (`final-spec-focused.log`).
- `git diff --check`: exit 0 after product repairs. Final artifact checks are recorded below.

Final standard gate output excerpts:

```text
svelte-check found 0 errors and 0 warnings
 Test Files  148 passed (148)
      Tests  1730 passed (1730)
50 passed, 0 failed
18 passed, 0 failed
```

The PowerShell harness reports one platform-specific dotfile sub-case skip, explicitly visible in the raw log. This is harness output on this host, not proof of a Windows host run. No browser component test was required because this follow-up modifies no frontend/component files.

## Review and preservation

`review.md` records all four Astra-medium layer results and deduplicated triage. Three high patches, no new deferrals, seven rejected findings. Follow-up review remains recommended. Historical detector semantics and exact-content policy are retained. The original frozen contract, original deferred item, and prior review text are preserved; final checks validate these against the entry commit. No deferred-work ledger is edited.

Final artifact check: `uv run --with pyyaml python .audit/DW-92/verify_preservation.py` exited 0 (`preservation.json`), confirming unchanged contract, parsed YAML deferral and baseline, retained prior result/reviews, and no frontend/generated/ledger edits. Initial attempts to load YAML from Node and system Python found no installed YAML package; the isolated uv environment supplied PyYAML for the successful check. `git diff --check` passed.

Log finalization removed extra terminal blank lines only, after staged whitespace validation flagged them; diagnostic lines and test output are unchanged.
