# Q8 cold browser diagnostic

Read-only inspection while the worker's canonical run is active. No cache, source or test changes and no test execution.

## Established evidence

canonical-gate.log:437–441 reports newly optimized @convex-dev/better-auth/client/plugins, better-auth/svelte, convex/server, phosphor-svelte and svelte-sonner, followed by explicit unexpected test reload warnings and zero-test suites. Lines482–486 repeat for @internationalized/date;493–497 repeat for convex/values and jszip. All eight are absent from the existing explicit optimizeDeps.include list. The config already uses targeted pre-inclusion to prevent precisely this class of route-import reload. These concrete messages substantiate incomplete cold prebundling, not a valid completed browser gate.

The two pointer-context failures occur immediately after the first reload alongside zero-test chat suites. At this observation point their final error summaries are not yet present. It is premature to infer lost fine/coarse emulation, timeout needs or a product defect. Preserve the completed failed log and adjudicate its actual failure summaries after worker handoff.

## Cache and fixture relationship

The retained runtime/component.config.ts.txt spreads canonical base and changes only test inclusion/browser instances. It has no independent cacheDir and retains the project name. Vite's installed config resolver defaults to package-root node_modules/.vite; optimizer paths use config.cacheDir/deps with environment suffix. Installed browser integration inherits project.vite.config.cacheDir. Thus the audit fixture and canonical suite can reuse the same cache location; no filename-derived isolation is established by the retained config. Different fixture entry coverage can populate only a subset of the graph.

This is evidence of shared cache configuration, not proof that a concurrent writer corrupted it. The retained markdown-attempt1 failure was a separate fixture API error (screen.rerender missing), not a canonical pointer failure. Clean dependency install or changed lock/plugin graph can invalidate prior optimization and expose missing preincludes. No unchanged-old-graph cold comparison was performed here, so a dependency upgrade alone is not proven causal. A warm rerun may conceal the cold discovery gap and is not sufficient repair proof.

## Bounded next step after sole-writer handoff

Preserve final failed logs/cache metadata as evidence first. Isolate future audit-only browser fixture optimization with its own ignored cacheDir, keeping its config outside canonical execution. Then run the unchanged canonical config against a deliberately cold owned cache to separate fixture reuse from canonical cold-start coverage; do not delete shared caches or another checkout's dependencies. If the observed reload issue remains, extend the existing include list only with the eight concrete dependencies above, using actual import availability and the completed log as justification. No wrapper, broad externalization, file skip, pointer change, fixed sleep or retry increase is justified.

Prove the resulting canonical component suite from a cold owned cache with complete expected test/file counts, zero optimizer mid-test reload warnings and no unhandled errors. Retain source hashes and clean byte-preservation proof. A later full unified gate remains parent-owned; this diagnostic does not claim any pending run passed. If a pointer failure remains without reload, inspect its exact actual media/DOM result independently before changing scope.
