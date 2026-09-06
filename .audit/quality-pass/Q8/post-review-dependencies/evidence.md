# Root Q8 dependency review follow-up

The complete installed development/build tree passes npm ls --all --json with no problems. This supplies broader required-peer verification beyond the earlier targeted listing.

A new isolated temporary directory received exact package.json, package-lock.json and .npmrc bytes. npm ci --omit=dev --ignore-scripts exited0, preserved the lock, and installed production React19.2.8. Targeted production React/Better Auth npm ls exits0. Lifecycle scripts were deliberately skipped: this check proves dependency omission/resolution, not a separate production build/runtime installation.

The additional complete production-only source-tree listing exits1 with11 missing Svelte peer references. All are the same Svelte dependency currently declared under devDependencies, not missing React or an incompatible peer in the supported full build tree. This is unchanged repository packaging: Vercel runs npm install and builds the source with dev tooling; this branch does not introduce an omit-dev source build workflow. Do not describe the complete omit-dev tree as healthy or this test as a deploy/login proof. No dependency was moved to conceal this result. Original command output and numeric exits are in result.json and logs.

The obsolete npmrc comment described a removed auth adapter. No current incompatible required peer is demonstrated by the full installed-tree check. Preserve legacy-peer-deps per the approved scope; removing it requires a separate clean resolution/build verification. No fictional conflict is asserted.
