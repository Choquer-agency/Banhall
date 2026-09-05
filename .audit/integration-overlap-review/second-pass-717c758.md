# Integration overlap review, second pass

Reviewed revision: `717c75897cc04256c008a2ed42747df66f6fc6b5`.

Result: no new merge-introduced findings in this bounded static review. This does not assert native story completion or replace the root full gate.

## Preservation evidence

- Verified `7dc7131`, `076b304`, `c138fbe`, `f9389a4`, `ccc42b3`, and `2462c4c` are ancestors using `git merge-base --is-ancestor` (all exit 0).
- Reconstructed three-way merges using each merge's parents and merge-base with `git merge-file -p`. Every existing changed Convex production/test file in `84d23a4`, `8829894`, and `717c758` matched its committed merge byte-for-byte. The config exception was `717c758:tsconfig.json`, deliberately normalized by the parent agent.
- `convex/ai/chatEvidence.ts`, `convex/ai/trustedContext.ts`, and their tests match `2462c4c` byte-for-byte. Analyzer entry still calls the trusted builder and records its budget (`convex/ai/pipeline.ts:227`, `:585`), then analyzes its user message once (`:681`) and passes serialized analysis to candidates (`:725`). Candidate deserialization validates its schema; absent legacy analysis still uses the trusted builder (`:806`).
- Anthropic cache wrapping keeps the original text, adds cache-control only at the request wrapper, and respects existing explicit policies (`convex/ai/instrument.ts:140`). Its generation attribution condition remains at `:207`; usage/provenance code was not removed by the merge.
- `convex/generationAttribution.test.ts` retains all directly quoted test titles from both pipeline-merge parents: 30 and 26 titles, missing lists empty. Diff from the pipeline parent retains QA stale-attempt/current-content tests; diff from the integration parent adapts the fetch gateway and strengthens trusted-context assertions for both entry paths.
- Chat admission follows authorization/report/thread validation and precedes thread/message writes (`convex/chatV2.ts:283`, `:326`). `applyProposal` and every later export are byte-identical to the pre-chat parent, preserving authorization and QA persistence (`:416`, `:518`, `:615`).
- New optional review provenance fields coexist with the unchanged PED table (`convex/schema.ts:1299`, `:1550`, `:1596`, `:1666`). Project copy retains provenance when present; QA publish blocking and PED scheduling remain (`convex/projects.ts:950`, `:1047`).

## Independent config check

Used the locally installed TypeScript `parseConfigFileTextToJson` and `parseJsonConfigFileContent` on `8829894:tsconfig.json` and the reviewed config, resolving both against the same current worktree.

```json
{"sameCompilerOptions":true,"sameExtends":true,"oldFiles":245,"newFiles":245,"missing":[],"extra":[],"includeKeys":1}
```

An initial invocation passed an incorrect Node execFileSync options argument and failed before parsing; the corrected invocation above succeeded. No tests, production edits, native-run controls, ledger edits, or status changes were performed.
