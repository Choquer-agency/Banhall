# DW-96 original generation failure preservation

Baseline commit: `3b8a451e3738a8da1bd95ba5e7029dba6f970a4d`. Checkout: `/Users/johnnynguyen/Documents/Repos/Banhall-bmad-dw96-fix`, branch `codex/bmad-dw96-fix`. No commit, push, merge, browser run, generated API edit, or ledger edit performed by this implementation.

## Change

`convex/ai/learning.ts` protects the existing awaited failed-attempt mutation with a nested catch and rethrows the exact original generation exception. No changes to attempts, admission, provider behavior, retries, candidates, or publication policy.

`convex/learningFailure.test.ts` contains eight regression cases: each combination of QA calibration / draft style, provider Error / adapter parse SyntaxError, and persistence success / rejection. Every case asserts original identity, one awaited failure write with the correct kind and admission, five admitted signals from two writers and projects, no save mutation, unchanged digest/selection/report-candidate rows, and either one matching persisted attempt or none when persistence fails.

## Test seams and limits

The tests seed real convex-test tables and invoke each real registered action `_handler` inside a convex-test action context. All queries, meaningful-signal filtering, diversity/minimum admission, instrumentation, structured-generation flow, and successful attempt storage remain real. The provider client factory supplies a known Error or SyntaxError rejection, matching the adapter boundary at which a JSON decoding failure escapes. The failure-write wrapper defers completion with a gate, then either delegates to the real mutation or rejects with a distinct secondary Error. The complete mutation call list proves no other save/publication mutation occurs.

The new parse case intentionally does not retest the SDK JSON parser; existing `convex/learning.test.ts` malformed-JSON action cases cover the real parser. The `_handler` property is runtime-checked because the installed Convex public TypeScript registration type omits it. No production helper is exported. A delayed-write assertion verifies completion is awaited. Browser proof is parent-owned for this server-only patch.

## Red before / green after

- `npx vitest run convex/learningFailure.test.ts` against untouched production: exit 1, four identity failures and four passes. Each failed case receives the secondary persistence Error instead of the original Error/SyntaxError. See `before-regression.log` and `before-regression.exit`. Subsequent test-only edits added runtime TypeScript guards and formatting, without changing expectations or fault injection.
- `npx vitest run convex/learningFailure.test.ts convex/learning.test.ts`: exit 0, 44 tests in 2 files pass. See `after-focused.log` and `.exit`.
- `npm test`: exit 0, 1878 tests in 149 files pass. See `after-full.log` and `.exit`.
- `npx tsc -p convex/tsconfig.json --noEmit`: exit 0. See `after-convex-types.log` and `.exit`.
- `PUBLIC_CONVEX_URL=https://placeholder.convex.cloud PUBLIC_CONVEX_SITE_URL=https://placeholder.convex.site npm run check`: exit 0, zero errors and warnings. See `after-svelte-check.log` and `.exit`.
- `git diff --check`: exit 0. See `whitespace.log` and `.exit`.

## Protected source integrity

`before-tracked-sha256.txt` captured 3971 tracked regular-file hashes before the production edit. Post-check comparison in `integrity.log` shows only `convex/ai/learning.ts` changed. Generated APIs, schema, learning storage/admission code, native state/policy, and tracked deferred-work ledgers therefore retain their captured bytes. Initial hash capture skipped 13 tracked skill directory symlinks (shasum reported directories); this does not affect source/ledger coverage. `git status` provides complementary tracked-path inspection. The spec was already untracked when this implementation began. Audit artifacts are ignored by the checkout, so parent must retain them explicitly if desired.

The checkout owns its local node_modules directory. Commands used no real credentials or provider network calls. The optional referenced type-system-discipline skill was absent from the configured local skill roots; the available TypeScript discipline instructions were followed.

Parent owns fresh review, finalization and any private commit. No implementation work remains incomplete.

## Parent finalization

Fresh four-layer BMAD review completed without findings; see review.md and reviewed-source.json. All implementation tasks and matrix cases verified; standalone spec finalized done with Suggested Review Order. No native ledger status was changed. Private reviewed commit is parent-authorized; source receipts refer to the baseline plus the exact reviewed source hashes.
