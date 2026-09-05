# Canonical browser gate reproduction result

The unmodified canonical full `npm run test:component` passed at exact accepted learning target `3b8a451e3738a8da1bd95ba5e7029dba6f970a4d`: **323 tests in 53 files, exit 0**, in 61.45 seconds. The earlier Rolldown `Tsconfig not found` / `node:module` startup error did not reproduce. No source/config change or private commit was needed.

Owned checkout: `/Users/johnnynguyen/Documents/Repos/Banhall-bmad-browser-gate-repair`. Branch: `codex/bmad-browser-gate-repair`. Created from the exact target after checking path/ref absence. Native workers, pinned target, policy, ledger and other source checkouts were untouched. No push, merge, native loop or credentials were used.

Reproduction sequence, all executed here with public placeholders:

```sh
PUBLIC_CONVEX_URL=https://placeholder.convex.cloud PUBLIC_CONVEX_SITE_URL=https://placeholder.convex.site npm ci
PUBLIC_CONVEX_URL=https://placeholder.convex.cloud PUBLIC_CONVEX_SITE_URL=https://placeholder.convex.site npx svelte-kit sync
PUBLIC_CONVEX_URL=https://placeholder.convex.cloud PUBLIC_CONVEX_SITE_URL=https://placeholder.convex.site npm run test:component
```

All three commands exited 0. The canonical config remained byte-for-byte tracked source; no audit wrapper was executed. No fresh browser installation was necessary. Node `v24.19.0`, npm `11.17.0`; installed versions: vite 8.1.5, vitest 4.1.10, rolldown 1.1.5, playwright 1.62.0, @sveltejs/kit 2.70.1, @sveltejs/vite-plugin-svelte 7.2.0.

Evidence is retained under `/Users/johnnynguyen/Documents/Repos/Banhall-bmad-browser-gate-repair/.audit/browser-gate-repair`:

- `npm-ci.json` / `.log`: clean lockfile install receipt.
- `svelte-sync.json` / `.log`: explicit successful generated-config setup.
- `canonical-components.json` / `.log`: exact revision, command, public environment, exit code and complete browser output.
- `source-and-environment.json`: runtime/package versions, generated tsconfig presence, empty tracked working-tree status and `git diff --exit-code` success.

The no-Svelte-config warning appeared here too, followed by the successful full suite. Existing `derived_inert` warnings remain in the output. The prior native-worker failure's environmental or command difference remains **unproven**; this successful fresh setup does not identify a root cause or retroactively turn the wrapped receipt into canonical proof.

This is fresh full canonical browser proof for 3b8a451 only. It does not cover later story5 or combined-source changes and does not close DW-96. The final integrated source still needs its combined gate. `bmad-build` was not invoked because the stipulated failure condition did not reproduce and there was no repair to make.
