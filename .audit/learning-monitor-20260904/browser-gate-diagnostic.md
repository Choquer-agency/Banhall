# Browser gate diagnostic

Read-only source/evidence inspection of accepted story 4 commit `36313c0ac79fbd408fe121958f0af759ab7e964c`. No checkout edits, installs, test runs, or worker instructions were performed. This report is the sole written artifact. The accepted commit is an ancestor of pinned target `3b8a451e3738a8da1bd95ba5e7029dba6f970a4d` (git merge-base --is-ancestor succeeded).

## Observed failure

At the accepted commit, `.audit/CAP-4-story-4/rereview-commands.json` records exit 1 for `npx vitest run --config vitest.component.config.ts --no-file-parallelism src/routes/admin/reviews/reviewsPublishGate.component.test.ts`. Its `rereview-canonical-browser.log:3` identifies a startup error during dependency optimization. Lines 8–14 show `[RESOLVE_ERROR] Could not resolve 'node:module' in \0rolldown/runtime.js`, an injected `createRequire` import, and `Tsconfig not found`. No tests executed in that log. The earlier parent and follow-up receipts document the same failure.

Both canonical and wrapped logs warn that no Svelte config was found. Because the wrapped run also has that warning and passes, the warning alone does not explain the failure. Tracked `tsconfig.json:2` extends generated `./.svelte-kit/tsconfig.json`; this is a plausible setup-sensitive input, but the retained evidence does not prove that this generated file was missing, that it caused this virtual-module resolution failure, or which wrapper option is necessary. Do not label a specific root cause or fix as verified.

## Wrapper scope and evidence limits

`.audit/CAP-4-story-4/component-diagnostic.config.ts:1` imports the canonical config. Lines 2–10 set optimizer `rolldownOptions: { tsconfig: false, external: [/^node:/] }` at the top level and for `__vitest__`, client, and SSR environments. It retains the base plugins, aliases, included optimizer dependencies, setup files, test inclusion, real headless Chromium Playwright provider, and serial-file setting. The canonical config has no environments block, so the wrapper does not discard an existing block at this revision.

It does not skip assertions or replace the browser, but it changes dependency bundling behavior: optimizer tsconfig processing is disabled and Node builtin imports are externalized. Calling it strictly startup-only or semantically equivalent would exceed the proof. Its `rereview-browser.log:8` records one file and 11 passing tests, with the matching command and exit 0 in `rereview-commands.json`. It is focused component evidence, not the full canonical gate. The real page is rendered with Convex/SvelteKit test aliases and fixtures, not a deployed end-to-end backend.

The tested file covers two privacy-confirmation cases and disabling without confirmation (test source lines 85–155), distinct QA/style provenance and disclosures (250–292), six attempt outcomes (294–351), and panel isolation/private failure suppression (353–373). The wrapper adds no coverage. These are source inspection and retained receipts, not freshly executed proof.

## Comparison with prior combined gate

In the completion checkout, `.audit/integration-combined-e13e625/components.json` records exact tested head `e13e6253d0440ec4b28ea9ca5605fe7dbdc77d05`, command `npm run test:component`, exit 0, and both public URL placeholders. `components.log` ends with 315 tests across 53 files passed. `verification-summary.md` states the final evidence commit leaves executable source identical to that tested revision. Thus the receipt should be cited as e13e625 source proof rather than a newly executed e581d51 gate.

`git diff e581d51 36313c0 -- vitest.component.config.ts package.json package-lock.json tsconfig.json svelte.config.js svelte.config.ts` produced no differences. This narrows the cause away from a tracked change to those inputs. It does not establish identical installed dependencies, generated files, optimizer cache, runtime versions, or newly imported component dependency graphs across worktrees.

Immediate import inspection of `git diff 36313c0^ 36313c0` shows the reviews page removes the runtime `BuildStamp` import and adds only a type import of `FunctionReturnType` from `convex/server`; the shared Convex stub adds no imports. The test adds an `AdmissionSnapshot` type import and the argument-specific fixture helper from the existing stub module. These inspected changes reveal no new runtime Node builtin import that explains the optimizer error. This is bounded inspection, not a complete transitive dependency audit. The canonical gate remains unresolved for the accepted story: unchanged config does not prove a pre-existing universal failure or exclude an application regression.

## Minimal follow-up before final combined acceptance

1. Once native ownership ends and the final accepted source is integrated, run the unmodified canonical full `npm run test:component` in the completion checkout as part of its exact-source combined gate. Use normal documented setup/public environment and record revision, command, output and exit code. The earlier 315-test receipt predates story 4 and cannot cover later source.
2. If the canonical gate passes, no repository config patch is justified by this diagnostic. Preserve the earlier failed receipt and the distinction between focused wrapped proof and final canonical proof.
3. If the same startup failure occurs, retain it and inspect generated tsconfig availability, installed tool versions/lock alignment, and dependency-optimizer state in an owned isolated checkout. Reproduce the failure before testing the two wrapper settings independently; only retain a minimal fix supported by a before/after canonical full-suite run. Do not silently substitute the one-file wrapper command for that gate.

This diagnostic neither closes DW-96 nor substitutes for its independent follow-up review after the capability completes. No remediation or fresh browser success is claimed.
