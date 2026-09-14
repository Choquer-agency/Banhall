# DW-112 local completion evidence

Reviewed source commit: `0b34a249bac1a7c7e618308ee0416c4826214ccd`.

Original implementation commit: `09e35062ed132d65403d19f9b9af61675ffcaee6`. Original audit commit and entry HEAD: `8c36acc6826992db1ccf86a6a58893404a7ddf29`. Spec baseline: `d73df4bb9277886ca97e7b8e59caea618baf051d`.

The original mutation fix was reused. This follow-up adds a regression for current same-key baseline adoption and same-generation replay, corrects publication-helper documentation, and uses truthful neutral progress narration. It changes no publication mutation logic, outcome kinds, schema, dependencies, or generated files. The frozen product intent matches the original implementation commit exactly.

## Acceptance binding

| Requirement | Behavioral evidence | Executed verification |
| --- | --- | --- |
| Two initial reuse misses converge to one version-1 Brief and both generation references | Existing synchronized concurrent-first-publication regression in `convex/ai/brief.test.ts` through the real query/mutation adapter | Focused 39/39 and canonical 2,677/2,677 |
| Existing same-key authority is adopted before a stale fence or candidate processing, with no extra rows | Latest-same-key adoption regression checks complete Brief and entry snapshots | Focused 39/39 and canonical 2,677/2,677 |
| A different-key stale project baseline returns null and preserves the retry contract | Existing different-key stale-fence and retry regressions | Focused 39/39 and canonical 2,677/2,677 |
| Current same-key baseline and replay stay idempotent | New real-adapter regression records both misses, publishes first before the second baseline read, checks the persistence baseline, returned IDs, both stamps, full row snapshots, and replay | Focused 39/39 and canonical 2,677/2,677 |

The original failing control remains unchanged in `../failing-control.log`: baseline production failed exactly the two original DW-112 regressions. The original green evidence remains unchanged. This run initially reused the supervisor's fresh native dev gate after confirming source binding, then executed the required gate again after accepted review patches changed the verified bytes.

## Commands and actual output

- `npm test -- convex/ai/brief.test.ts`: exit 0; complete output `patch-focused-20260914T1130Z.log`, actual exit and after-source hashes in its `.meta` companion.
- `npx tsc --noEmit -p convex/tsconfig.json`: exit 0; complete output `patch-convex-tsc-20260914T1130Z.log` and `.meta`.
- `bash scripts/loop-verify.sh`: exit 0, all nine steps; complete output `patch-loop-verify-20260914T1130Z.log` and `.meta`.
- `git diff --check`: exit 0 after spec finalization; `git diff --cached --check`: exit 0 after the capture-only attributes described below.

Verbatim selected output lines from the focused and canonical captures:

```text
Test Files  1 passed (1)
Tests  39 passed (39)
svelte-check found 0 errors and 0 warnings
Test Files  187 passed (187)
Tests  2677 passed (2677)
93 passed, 0 failed
47 passed, 0 failed
```

The PowerShell harness retains its existing platform-conditional dotfile sub-case skip. No installation or test rerun was started before the supervisor's reuse directive was applied. The later focused, typecheck, and canonical runs were required because accepted patches changed test and narration bytes; no dependency change occurred.

## Independent review

Four required fresh layers, the review lead, and the bounded follow-up each ran with `gpt-6-astra`, reasoning `xhigh`, the existing `/Users/johnnynguyen/.codex` context, `BMAD_LOOP_TASK_ID` unset, and actual exit 0. CLI headers and receipt JSON files record the selected model, effort, context, exit, and session. Final output text was checked verbatim against each raw CLI transcript.

`triage.md` evaluates 10 deduplicated findings: 3 patches (one medium, two low), 7 rejected, none deferred, and no intent/spec repair. The score is five, so the spec records `followup_review_recommended: true`; the recommended follow-up was performed and returned no findings in `followup.md`. `triage-binding.json` is the earlier delegation-phase receipt, before those patches were applied.

`patch-review-source-binding.json` matches the exact source blobs in the reviewed source commit above and the hashes before and after all patch verification commands. Implementation/tests used Sol high; bounded source/provenance inventory used Luna max. No review fallback was needed.

## Native ownership and preservation

The ledger working bytes, staged blob, and committed blob match the supervisor's retained native close snapshot. SHA-256: `349fb5701b4cfe83cb7463a611b1c443f37f9549437d25f474ba09fb348d2ec8`; Git blob: `ef5016f67f905f55521c5132519bdd3f6a4f7e7d`.

`native-ledger-provenance.json`, `native-events.jsonl`, `native-capture.json`, and `staged-ledger-integrity.json` retain the evidence. Only the exact pre-existing engine-written ledger bytes were staged and committed. No entry or status was authored, reopened, or reverted. The recorded native `final_acceptance` is false; local completion does not establish final native run acceptance. No sprint-status file was written or reverted. Nothing was pushed or deployed.

All historical audit files preserve their prior bytes; the existing decisions log retains its original byte prefix with new rows appended. Prompts, final outputs, CLI headers, hashes, native receipts, patch command captures, and source diff snapshots are committed. Full raw reviewer transcripts and the expanded historical diff remain local ignored artifacts, with their hashes in `artifact-hashes.json`.

Staged whitespace checks initially flagged verbatim diff-context blank lines, command-output EOF, and Markdown hard breaks. `staging-whitespace-before.log` preserves exit 2. The narrow `.audit/DW-112/.gitattributes` rules preserve those capture bytes and exempt only those captures from whitespace diagnostics. Source, spec, and ledger whitespace attributes remain unspecified; their checks remain enabled. The succeeding check is recorded in `staging-whitespace-after.log` and the staged-integrity receipt.

## Limit

`convex-test` serializes top-level transactions. The regressions prove caller scheduling through the real mutation handlers; they do not simulate production optimistic-conflict retries. The spec is finalized to done for local/dev hand-back, and native acceptance remains with the orchestrator.
