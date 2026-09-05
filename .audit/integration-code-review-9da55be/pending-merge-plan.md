# Pending helper integration audit

Read-only audit dated 2026-09-04. No worktree creation, merge simulation, ref changes, lifecycle/ledger edits, tests, or native-worker changes performed. Only this report was written. Project AGENTS, factory rules, BMAD code-review guidance, and Convex/TypeScript guidance were consulted. This is a bounded integration/evidence audit, not another broad code review.

## Pinned inputs and overlap

- Audited native integration head: `1cd1eb50f343007b3060c72d6ccbfaf5e0b72f35`.
- Analyzer helper: `bbaa9d20a9607d6463ee5298e1a5c9d8aebf19df`.
- Review-menu helper: `97e32b72891c6d50d45191ac272607936fba1628`.
- Both helpers share merge base `9da55bece5948da12129720dd2330a3032c985bf` with that native head. Both helper checkouts returned empty `git status --porcelain`.

Computed complete `git diff --name-only <merge-base> <head>` sets, including audit/spec files. Neither helper intersects the native delta, and the helpers do not intersect each other. No textual conflict is expected at the pinned native head. This is a path-level prediction, not a performed merge; repeat the intersection against the actual terminal native head before integration.

| Helper | Actual source/test delta | Integration implication |
| --- | --- | --- |
| Analyzer | `convex/ai/promptProgram.ts`, `convex/ai/pipeline.compare.test.ts`, `tests/aiUsage.test.ts` | Descriptor changes from candidate-only to mode-dependent analyzer routing. Runtime pipeline/iterative routing is unchanged. Canonical prompt-program hash changes intentionally. |
| Review menu | New `src/lib/components/project/ProjectWorkflowMenu.component.test.ts`; `src/lib/test/convex-svelte-stub.svelte.ts` | Production menu is unchanged. Shared stub adds per-function mutation errors, clears them on result configuration/reset, and throws after recording calls. Full component suite is the relevant shared-consumer gate. |

The native source delta since the shared base touches `convex/lib/deidentify.ts`, `convex/lib/tiptapReport.ts`, and associated privacy, attribution, lifecycle, learning, and QA tests. It does not touch helper files, the component config, or package/lock files.

## Review evidence binds to committed code

Read each helper's committed evidence, triage, source fingerprint manifest, and final gate records. Independently computed SHA-256 from `git show <helper>:<path>` for all manifest entries; all six match:

| Commit | File | Verified SHA-256 |
| --- | --- | --- |
| bbaa9d2 | convex/ai/promptProgram.ts | 7420ee6c608c9e435f11a8de001dbb4575af9f65b7ad2823e32e22cfa7b6e7db |
| bbaa9d2 | convex/ai/pipeline.compare.test.ts | b9a0868760978792d36806f6e540b5c4cd41ab0ab67f5274b0573086e082dca6 |
| bbaa9d2 | tests/aiUsage.test.ts | fd687dfb2d7d4cdee736b365220cf91cdc0c395b70630868a3f1363fbfa2a256 |
| 97e32b7 | src/lib/components/project/ProjectWorkflowMenu.component.test.ts | 84d25df9d3c986058a979f0a618ea2a746197f8dd58a1aadde4f2e9f701059f1 |
| 97e32b7 | src/lib/test/convex-svelte-stub.svelte.ts | d561f8d6c732d02b6af8f76ddc0ed8d389e07bf353811ac626d49c129d001025 |
| 97e32b7 | src/lib/components/project/ProjectWorkflowMenu.svelte | 18029f2b340d601e7ab73bbdd95d89b0e493d9508dea9147a7f10158d16bc166 |

Analyzer `.audit/analyzer-provenance-repair/review-triage.md` records three low patches, seven rejections, no deferrals. Final evidence reports 71 focused tests, 1733 full-suite tests, clean Svelte/Convex checks; `review-gate-exits.tsv` records zero for all five listed final gates. Initial review.diff predates the documented low patches; the final fingerprint manifest and post-review gates bind the patched bytes. No unresolved review-state mismatch was found.

Menu `.audit/dw43-review-menu-verification/review-triage.md` records five low patches and no deferred defects. Final component log confirms 53 files/315 tests; final evidence reports 1730 unit tests, 59 backend tests, and clean check. The historical REVIEW-PENDING handoff is explicitly superseded by reviewed closeout. Final mutant failure and restored four-test pass are retained. This proves real production menu/dialog behavior with mocked Convex transport, plus separately tested backend contracts; it is not a deployed end-to-end result.

## Remaining native interactions

These predictions use the ledger locations and actual pinned code, not uncommitted worker state:

- **DW-88 research phone:** expected `convex/ai/research/core.ts` and research tests. No helper path overlap. Preserve research redaction placeholders/brief behavior and privacy regression coverage; the existing native deidentify changes are in a separate scrubber. Analyzer routing metadata does not consume this redactor.
- **DW-48 + DW-66 malformed PED:** expected `convex/lib/editDistance.ts`, its tests and persisted PED tests, potentially the extractor in `convex/lib/reportEdits.ts`. No helper overlap. Material boundary: malformed JSON must not become a legitimate empty-report reading, while valid empty documents and established formula behavior remain valid. Pinned QA changes use `extractReportSections` in `tiptapReport.ts`, which explicitly supports legacy plaintext; avoid accidentally imposing PED validation policy on that separate QA path. Full backend tests cover shared report/generation hooks after integration.
- **DW-23 snapshot ownership:** expected `convex/lib/snapshots.ts` and snapshot/research proposal tests. No helper overlap. Pinned `writePreEditSnapshot` currently loads the supplied research session and copies evidence count without ownership checks. The fix affects research provenance accompanying proposal application; preserve the valid same-project/same-report path, snapshot-before-edit transaction, and unrelated lineage fields. Analyzer prompt-program metadata and review-menu mutation arguments are separate contracts.

## Recommended order and final gates

1. Let the native sweep reach its own terminal acceptance and release ownership. Record that exact head and native receipt/status. Do not infer completion from this report or helper gates.
2. Compare that head's delta to both helper deltas again. Then integrate analyzer `bbaa9d20a9607d6463ee5298e1a5c9d8aebf19df`, followed by menu `97e32b72891c6d50d45191ac272607936fba1628`. This order has no technical dependency; it makes backend metadata and browser verification changes individually attributable. Preserve committed evidence and native ledger ownership.
3. On the final combined tree, run the ordinary `bash scripts/loop-verify.sh`. The actual script includes Convex tsc, Svelte check, `npm test`, PowerShell uploader tests, and shell uploader tests. It installs local dependencies only when empty and defaults `PUBLIC_CONVEX_URL` to a placeholder. If already installed, confirm dependency ownership/lockfile consistency. Record command exits and exact tested tree/commit.
4. Run full `npm run test:component`, since the menu helper changes a shared stub. Use the existing separate `vitest.component.config.ts`: Chromium, `fileParallelism: false`, public-env aliases and existing optimizeDeps. Do not add `sveltekit()` or timeout overrides. Browser install is only needed if Chromium is absent. Unit tests alone do not cover these suites.
5. Run `PUBLIC_CONVEX_URL=https://placeholder.convex.cloud PUBLIC_CONVEX_SITE_URL=https://placeholder.convex.site npm run build` on the combined tree. Both variables are required for this gate: the coordinating task already observed the production build fail without `PUBLIC_CONVEX_SITE_URL` and pass with both variables. At pinned commit `1cd1eb50f343007b3060c72d6ccbfaf5e0b72f35`, `src/routes/+layout.svelte:11` and `src/lib/components/project/ProjectWorkflowMenu.svelte:2` statically import `PUBLIC_CONVEX_URL`; `src/hooks.server.ts:2`, `src/routes/+layout.server.ts:1`, and `src/routes/api/auth/[...all]/+server.ts:1` import the SvelteKit auth adapter. Read-only inspection confirms its installed `node_modules/@mmailaender/convex-better-auth-svelte/dist/sveltekit/index.js:3` statically imports **both** variables from `$env/static/public`. Component env stubs do not satisfy production build imports. This build is additional integration proof beyond current CI/loop gates; no build was run during this audit.
6. Inspect source/spec whitespace and final Git status. Preserve verbatim audit logs/prompts: helper evidence explicitly documents raw-log blank-line/diff-context whitespace, so a blanket all-artifact whitespace failure is not automatically a source failure.
7. **Codegen trigger:** neither helper adds Convex registrations, schema definitions, or generated files. Pure-helper fixes likewise do not by themselves require regeneration. Preserve supported existing PED generation provenance (`3e575b7c68a80ef560b746be78e1b016e1dda750`, `.audit/CAP-2-story-3/codegen.log`). If the actual native terminal delta adds/changes API registrations or schema requiring generated output, use supported Convex codegen and verify resulting output before final types/gates; never hand-edit generated files or regenerate merely to create a fresh receipt.

Merge to main only after the combined tree passes these applicable gates and native acceptance is complete. Earlier per-helper passes do not establish that the final combined tree passed. No material blocker was found in the pinned helper deltas or their evidence.
