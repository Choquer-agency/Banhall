# B7 dependency-prune preflight

Read-only inspection at `1d6053388326fe4fde43a86177955157f11ce588`. No install, test, runtime invocation, dependency mutation, canonical edit or ref mutation. Reviewed planning/B7.md and planning/drafts/spec-branch-b7-dependency-prune.md.

## Result

No concrete missing consumer or surviving lock-version blocker found. Current package.json, package-lock.json, bun.lock and tsconfig.json are byte-identical to HEAD and captured baseline cc6b706c3b43f971d944cb703a4174eabf3134d9. Thus the historical cumulative package-lock blob at `ad9952ff1ba107bfbf97955863d4dfcdf774a530` remains structurally compatible with the proposed exact five-root removal at this snapshot. Recheck identities at dispatch; do not transplant if another batch changes the inputs.

Parsed lockfile v3 contains 702 entries including the root before pruning and 556 afterward: 146 removed, zero added. Aside from the root's five removals, only node_modules/debug and node_modules/ms differ; each gains dev:true. Every surviving version, resolved URL, integrity and dependency field is identical. Package.json's only semantic changes are dependencies docx, svelte-exmarkdown, tippy.js and devDependencies eslint, @types/bun removed. Every other root field/value is identical to the historical candidate.

Reverse-reference inspection over dependencies, devDependencies, optionalDependencies and peerDependencies finds docx, svelte-exmarkdown, tippy.js and @types/bun referenced only by the root. eslint additionally has a peer edge from @eslint-community/eslint-utils, itself removed; bun-types is depended on by removed @types/bun. Resolving dependency/optional/peer requests using ancestor node_modules lookup finds no surviving entry that resolves to a removed entry in the old graph. Traversing the retained graph from all retained roots reached 556 entries with 0 unresolved required dependency requests. This is structural metadata evidence, not npm's installed-graph validation or proof that platform-optional packages execute.

## Source, scripts and configuration

Tracked current source and working files under src, convex, shared, scripts and tests, root configuration/package files, .github workflows and .factory/factory.toml were searched. No live import/require/config consumer of the five removal roots, bun-types, Bun global or bun:test was found. Remaining eslint hits are suppression comments, including generated files; they do not execute ESLint. No tracked ESLint configuration was found. The lint script runs svelte-check, not eslint. CI and current scripts invoke npm/node; matches in ubuntu or pre-bundling text are unrelated.

Do not mistake docx file-type literals for package imports. Current exportTemplateDocx imports retained jszip; parseDocument dynamically imports retained mammoth for DOCX reading. Both packages survive unchanged. Keep @tiptap/extension-underline and the existing StarterKit graph, along with B5's real fresh-install roundtrip proof. B1/B2 benchmark additions do not introduce a removed-root consumer.

No executable bun:test import or Bun global was found in the current source/test inventory. The tracked historical Bun logs remain provenance and are not executable consumers. There is no current test/ directory or tracked file under it. Removing only test/**/*.js, test/**/*.ts and test/**/*.svelte from tsconfig is therefore consistent; preserve tests/**, src/**, shared/**, .svelte-kit declarations and all compiler options. Do not transplant the historical full tsconfig. The current tsconfig has no explicit native-transformer include to add or delete: preserve the current config and existing native configuration unchanged.

## Admission limits and required later proof

B5/B6 completion remains a parent admission prerequisite. This scan supports the current Bun cleanup assumption but does not replace their behavior receipts. The candidate lock's structural compatibility is not a fresh npm ci pass. Parent/worker must capture own npm ci, npm ls --all and retained suites plus B5 editor/Underline proof after installation, then current discovery and final gate results. Investigate invalid required peers/dependencies rather than suppressing errors; distinguish optional platform omissions.

Preserve scripts/check-test-discovery.mjs, loop-verify, Vitest configurations, pointer instances and CI byte-for-byte for B7. No dependency upgrades, old discovery guard transplant, config broadening or unrelated cleanup is supported. At this snapshot no additional scope is needed.

## Input SHA256 identities

| Input | SHA256 |
| --- | --- |
| `package.json` | `f30aa3e89510822bf7b4c9a3564b7584a205168846824d809e32f0da34c7c625` |
| `package-lock.json` | `d4213ef7b50aa850ea095dbe6c65b35306ae7589a90073c0e377147421a33dac` |
| `bun.lock` | `aa998e080f04609165959646fe5bc1a170d5b43075af33f5ff95d3a5486ed3e0` |
| `tsconfig.json` | `d39277f0a90d57dd28b0a4bc8afe625b7873f2c671696ca50964f62213b249ec` |
| `ad9952ff1ba107bfbf97955863d4dfcdf774a530:package-lock.json` | `d31482119f86dae5aae70a05ffcb19b1ed9cab43bb460b738f1aa0686906cda3` |
