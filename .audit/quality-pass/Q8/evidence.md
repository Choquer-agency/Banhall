# Q8 dependency health evidence

Baseline: `e2cfb873b32586d1a620a75e1de61cc49d323eb3` in the assigned Banhall-quality-pass checkout. The user-provided spec is the implementation contract; its bytes and investigation copies are bound in `input-hashes.json`. No application source, domain policy, native ledger, or other checkout was edited. No commit, push, or deployment was performed.

## Changes

`package.json` pins React 19.2.8 as a production compatibility peer, Anthropic SDK 0.91.1, Kit 2.70.3, and all existing direct Tiptap packages plus newly owned core to 3.30.4. Only the persistent Kit-scoped cookie 0.7.2 override remains. `.npmrc` retains `legacy-peer-deps=true` with an updated explanatory comment.

Npm generated the entire lockfile resolution. `changed-packages.tsv` and `changed-package-reasons.json` enumerate all 45 changed package paths and their incoming ranges. Thirty Tiptap packages align to 3.30.4. Seven approved transitive targets were selected with temporary overrides, then retained after those overrides were removed. Balanced-match 4.0.4 moved unchanged from glob's nested location to the root with brace-expansion; brace-expansion and nanoid likewise moved to root locations. No unrelated package version was refreshed.

`vitest.component.config.ts` additionally prebundles the real `@vercel/oidc` browser export. The initial full browser run and focused retry exposed an unconverted CommonJS named-export failure in chat. Its lock record, gateway and AI SDK records are byte-equivalent JSON to baseline; no version change or mock was used to address it.

## Acceptance evidence

- Before security failure: `npm audit --json`, exit 1, `audit-before.json`: 11 entries (1 low, 7 moderate, 3 high).
- After repair: `npm audit --json`, exit 0, `audit-after.json`: zero entries in every severity and empty vulnerabilities object.
- Reproducibility: two successful `npm ci` runs (`install-first.log`, `install-repeat.log`). `lock-repeat-check.log` reports `package-lock.json: OK`. `install-receipt.json` binds runtime versions, checkout, manifest and lock hashes.
- Peer and editor graph: `npm ls react @convex-dev/better-auth @tiptap/core @tiptap/pm`, exit 0, `peers.log`. `node .audit/quality-pass/Q8/runtime/verify-resolution.mjs` passes in `resolution-check.log`, checking approved versions, production React, absence of React DOM, all Tiptap entries, unchanged unrelated ranges and no temporary overrides.
- Affected unit suites: `npx vitest run tiptapConfig docSearch tiptapReport instrument providers pipeline.compare`, exit 0: 6 files, 89 tests (`focused-unit.log`).
- Real cookie/runtime matrix: `PUBLIC_CONVEX_URL=https://placeholder.convex.cloud PUBLIC_CONVEX_SITE_URL=https://placeholder.convex.site node .audit/quality-pass/Q8/runtime/cookie-check.mjs`, exit 0 (`cookie-runtime.log`). Resolves cookie from installed Kit; session-shaped roundtrip preserves value and attributes; independently invalid name/path/domain each throw TypeError. Actual Kit Cookies and actual Svelte adapter getToken cover missing, ordinary, secure and secure-priority JWT extraction.
- Actual markdown behavior: `npx vitest run --config .audit/quality-pass/Q8/runtime/component.config.ts`, exit 0 (`markdown-runtime.log`). Production MessageContent renders normal/streamed bold text and Mermaid source fallback without diagram SVG. Separate opt-in Streamdown/Mermaid fixture renders two graph nodes with Alpha/Beta labels using the real dependencies. Initial fixture failure was a missing await on render, fixed only in the audit fixture (`markdown-runtime-attempt1.log`). No production Mermaid feature was enabled.

Audit fixture/test/config sources are retained as `.txt` archives under `runtime/`; restoring their original suffixes permits rerunning the exact audit commands. The standard component config was reused by the audit wrapper; the production Vite config is unchanged. The component runner received only the CommonJS prebundle compatibility fix described above.

## Client build evidence

`PUBLIC_CONVEX_URL=https://placeholder.convex.cloud PUBLIC_CONVEX_SITE_URL=https://placeholder.convex.site npx vite build --config .audit/quality-pass/Q8/runtime/vite-observe.config.ts` succeeded (`client-build-final.log`). The observer reused the production configuration and ran only in the client environment, in the post-ordered generateBundle hook. `client-modules.json` records all 4,439 module entries with rendered lengths, including 1,186 rendered entries, in 109 chunks. No React runtime or React adapter module matched the graph assertions, including zero-length entries. The observer does not emit or change application code.

`node .audit/quality-pass/Q8/runtime/verify-client.mjs` passed (`client-hash-check.log`, `client-verification.json`): all 109 recorded code hashes matched actual emitted files. The exact observed chunk files are retained in `observed-client-chunks.tar.gz`; `client-archive-check.json` confirms each archive member matches its recorded hash. This preserves the observed build independently of the subsequent canonical standard build. The temporary observer configuration was removed and retained as `.txt`.

The first observer ran before Vite's final chunk rewrite; strict hash verification correctly failed for the app entry. `client-modules-attempt1.json` preserves that initial observation. Moving the read-only observer to the final hook order resolved the discrepancy without changing application code or weakening the hash assertion.

## Browser verification

The first `VERIFY_COMPONENT=1 bash scripts/loop-verify.sh` passed steps 1 through 8, then failed the browser step (`canonical-gate.log`): 10 suites could not import the CommonJS OIDC browser export, plus 3 tests failed after optimizer reloads. A focused retry (`component-focused-retry.log`) passed 28 tests, including the editor, pointer contexts and document selection, while reproducing the chat import failure. After the three-line prebundle fix, `npm run test:component` passed all 66 files and 522 tests (`component-final.log`). The retained logs include expected negative-fixture console errors and Svelte derived_inert warnings; these were not suppressed.

## Final canonical gate and preservation

`bash scripts/loop-verify.sh` exited 0 after the focused/runtime checks and compatibility fix (`canonical-final.log`). All eight stages passed: preflight, Convex typecheck, Svelte check (zero errors/warnings), 155 unit files / 2,075 tests, discovery guard, production build, PowerShell uploader harness (50 passed), and Bash uploader harness (18 passed). Browser validation is the separately successful full 66-file / 522-test run above.

`final-receipt.json` binds manifest and lock hashes and confirms all tracked files match their expected pre-verification bytes, including historical evidence, with only the intentional test-config fix accounted for in the second snapshot. Investigation inputs and the untracked user spec retain their original bytes. `git diff --check` passes. No temporary executable fixture/test/config remains. Build output includes large-chunk and plugin-timing warnings; the build succeeds.

Final command tail:

```text
ok    AC5 an injected failing case exits non-zero
ok    shape banhall-uploader.sh uses no bash 4 constructs
ok    shape every function is defined above the lib-only guard

18 passed, 0 failed
ok 2s
```

## Limits

The cookie checks exercise real local serialization and the hook's actual adapter overload. They do not authenticate against a remote server or establish a full network login. Existing component auth stubs do not change that limitation. No exploit path or application SVG diagram feature is claimed. An audit with zero reported advisories describes the registry result at execution time, not a future security guarantee. Independent orchestrator review and final run acceptance are not claimed by this implementation evidence.
