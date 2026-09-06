# B7 independent required-peer review

## Conclusion

Pruning does **not introduce the observed missing-React required-peer error**. It preserves a pre-existing unsatisfied required peer. The complete npm graph is therefore not healthy: baseline and post-prune `npm ls --all` both exit 1 with the same sole npm error pair: `ELSPROBLEMS` and `missing: react@^18.3.1 || ^19.0.0, required by @convex-dev/better-auth@0.12.5`. The captured `npm-ci.exit` is 0 under the existing `.npmrc` `legacy-peer-deps=true`; installation success does not satisfy that peer contract.

This read-only check compared captured logs, lock records, installed package exports/JavaScript and application imports. It ran no tests, installs or package loading, and changed no package, application, npm configuration or index bytes.

## Required versus optional

Installed `node_modules/@convex-dev/better-auth/package.json` declares React in peerDependencies and has no peerDependenciesMeta optional exemption. Its complete lock record is byte-equivalent as JSON before/after, as are the records for `better-auth` and `@mmailaender/convex-better-auth-svelte`. Neither lock contains node_modules/react and React is absent from the current install. Thus no formerly available React installation was removed by B7.

Other packages do have optional React peers (for example better-auth 1.6.23). The existing `npm-ls-optional-classification.json` React-range row says “optional peer dependency”; it cannot classify the required @convex-dev/better-auth edge. Final evidence must explicitly distinguish the two rather than treating every React omission as optional. The two npm logs' error lines are equal, not their full logs or graph inventories.

## Active entrypoints and actual JavaScript

Application runtime imports are `convex/auth.ts:5–6` (package root and /plugins), `convex/convex.config.ts:7` (/convex.config), `convex/auth.config.ts:1` (/auth-config), and `src/lib/authClient.ts:14–15` (better-auth/svelte and /client/plugins). The generated component API reference is a type-only declaration. No src/convex application import selects this package's /react, /nextjs, /nextjs/client or /react-start export.

The package root resolves to dist/client/index.js, which imports its adapter/create-client/create-api plus Convex and semver. Those local JavaScript files continue into Convex server/value/helper APIs and Better Auth adapters/db/cookies/API/plugin exports. Its /plugins barrel exports convex and cross-domain server plugins; /client/plugins exports their client plugins; the Convex client plugin imports only VERSION. The config file imports defineComponent from convex/server; auth-config has no React import. Inspection of the package's actual dist JavaScript finds React imports in dist/react/index.js (react/jsx-runtime, react and convex/react), dist/nextjs/client.js, dist/nextjs/index.js and dist/react-start/index.js. The active root/server/plugin barrels do not export those adapter modules. This is export/JavaScript evidence, not an inference from adapter names.

The Svelte wrapper's actual dist/svelte/index.js exports client.svelte.js, whose imports are Svelte, convex-svelte, public env, SvelteKit navigation, is-network-error and its local token fetcher. Its dist/sveltekit/index.js uses better-auth/cookies, @convex-dev/better-auth/plugins, public env, convex/browser and convex-svelte/sveltekit. Application layout/login and auth server routes select these /svelte or /sveltekit exports, not React adapters.

## Limits and disposition

The inspected active entrypoints show no new React resolution dependency caused by pruning, and the unchanged peer/lock plus matching baseline/post errors substantiate treating this as a baseline dependency-contract deficit. Importing the unused React/Next adapters would require their absent runtime dependencies; this report does not certify those APIs. Static inspection is not live authentication, arbitrary transitive dynamic-import, deployment or full application runtime proof. Parent's scoped tests/build gates remain separate evidence. Do not add React, relax npm further, or claim all dependency edges are satisfied as part of this pruning batch.

## Source and receipt SHA-256
- `.npmrc`: `86c323a319d4445dee30557554f74fa41589b39d0af97801bf9b058f1ac1f4fa`
- `package-lock.json`: `d31482119f86dae5aae70a05ffcb19b1ed9cab43bb460b738f1aa0686906cda3`
- `node_modules/@convex-dev/better-auth/package.json`: `438c4a18c931835c24f4352d09b402d11d50ff324d0f8a203fe9a8f30f542855`
- `node_modules/@mmailaender/convex-better-auth-svelte/dist/svelte/client.svelte.js`: `a61bedc888dc975fbbeefe90d8f967b570a09f4a2e6a45932b7aba1ac1e35e7f`
- `node_modules/@mmailaender/convex-better-auth-svelte/dist/sveltekit/index.js`: `46caccf53c0e9b54afe3470f6d3569cc2be637fa1675e82de9729e6be6de834c`
- `.audit/branch-consolidation/B7/before-package-lock.json`: `d4213ef7b50aa850ea095dbe6c65b35306ae7589a90073c0e377147421a33dac`
- `.audit/branch-consolidation/B7/baseline-npm-ls.log`: `5458995ad78369d933d313f4898d74b3d78458b6305b1a6c00337fc4c170d2d3`
- `.audit/branch-consolidation/B7/baseline-npm-ls.exit`: `4355a46b19d348dc2f57c046f8ef63d4538ebb936000f3c9ee954a27460dd865`
- `.audit/branch-consolidation/B7/npm-ls.log`: `df59aa02c1937d62e1830e305d7ff5fa5e63d31aae4fdd39f63d8034f4a665ea`
- `.audit/branch-consolidation/B7/npm-ls.exit`: `4355a46b19d348dc2f57c046f8ef63d4538ebb936000f3c9ee954a27460dd865`
- `.audit/branch-consolidation/B7/npm-ci.exit`: `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa`

## Final evidence clarification closure

The final `evidence.md:34–40` now explicitly identifies React as the sole pre-existing required missing edge, preserves npm ls exit 1, and separately describes 145 optional-missing occurrences. This resolves the earlier evidence-classification concern; no duplicate open finding is retained. Final evidence SHA-256: `b15b331e6d8d77a3bf3435fa811c28526383ecce19ca91315336d81365a23eff`. The historical observation above describes the earlier evidence snapshot.
