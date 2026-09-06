# DW104/DW105 dependency audit

Audited fresh main `ed79a296039109fe1a2bf5dd867f9e5af22f2967` with Node24.19.0/npm11.17.0 at 2026-09-06T04:00Z. Read-only scope: no installs, package edits, production source edits, or ledger edits. `receipt.json` binds command, runtime, and manifest hashes. Root owns installation and implementation.

## DW104: satisfy the actual peer contract

Published latest `@convex-dev/better-auth` remains0.12.5. Its required peer is `react: ^18.3.1 || ^19.0.0`, without optional metadata. Current application imports server/client-plugin/config entrypoints, and uses the dedicated Svelte integration. `usage.txt` records those imports. `react-imports.txt` shows package React imports confined to React, Next.js, and React Start adapters.

Recommend explicit **production dependency `react: 19.2.8`**, current registry stable, matching the peer range and having no runtime dependencies. This is compatibility packaging only; do not add React DOM, React types, frontend imports, or any React adapter. Production placement preserves the contract for `npm ci --omit=dev`. `react-latest.json` is fresh registry evidence; `react-advisories.json` captures registry bulk advisory endpoint HTTP200 with empty advisory result for this version. An empty advisory response is current registry evidence, not a guarantee of security.

A documented exception would retain the defect. Root peerDependenciesMeta cannot rewrite a dependency's peer metadata; patching installed manifests would mask it. Avoid either custom checker/exception machinery or package-manager migration. Keep `legacy-peer-deps=true` unchanged as scoped, but correct its obsolete auth-package comment if desired. Verify the explicit React dependency with fresh `npm ci` and `npm ls react @convex-dev/better-auth`; inspect built client imports/chunks or module manifest to establish that no React code enters the client bundle. Existing auth and component suites establish integration behavior.

## DW105: narrowly selected repairs

Fresh `npm audit --json` exited1, still **11 affected package entries: 1 low,7 moderate,3 high**. `audit.json` holds current advisory URLs/ranges. This agrees with the retained B7 count and versions; no exploit was attempted. `parents.json` identifies exact incoming dependency ranges.

| Package | Baseline | Recommended target | Scope/compatibility |
|---|---|---|---|
| @anthropic-ai/sdk |0.82.0|0.91.1|First unaffected security release. Explicit manifest update needed because0.x caret excludes this minor. Avoid npm's latest0.124.0 jump.|
| @sveltejs/kit |2.70.1|2.70.3|Latest stable; removes Accept-header ReDoS; still depends on vulnerable cookie.|
| cookie |0.6.0|0.7.2|Use only Kit-scoped override, because Kit latest still declares ^0.6.0.|
| all direct @tiptap/* and transitive suite |3.28.0|3.30.4|Align full suite; core requires pm exactly3.30.4. All direct package releases verified in tiptap-aligned.json.|
| @xmldom/xmldom |0.8.13|0.8.15|Within mammoth ^0.8.6.|
| brace-expansion |5.0.7|5.0.9|Within minimatch ^5.0.5;5.0.8 is insufficient because second advisory.|
| dompurify |3.4.12|3.4.13|Within mermaid ^3.3.3.|
| mermaid |11.16.0|11.16.1|Within svelte-streamdown ^11.15.0.|
| nanoid |3.3.16|3.3.18|Within postcss ^3.3.16; avoid jumping to5.x.|
| postcss |8.5.20|8.5.23|Within Vite ^8.5.17; refresh nanoid separately, old vulnerable version remains permitted.|
| tar |7.5.20|7.5.21|Within node-pre-gyp ^7.4.0.|

These exact target versions exist in the live registry; corresponding JSON metadata is saved here. There is no published Kit2.70.4 (attempt returned404); latest2.70.3 still declares cookie ^0.6.0, so upgrading Kit alone cannot eliminate both findings. A narrow override `"@sveltejs/kit": { "cookie": "0.7.2" }` is justified. Cookie0.7.0 release notes describe narrowed RFC6265 validation, parsing performance, and package metadata changes, preserving parse/serialize APIs. Official source: https://github.com/jshttp/cookie/releases/tag/v0.7.0. Verify normal session cookie roundtrip and rejection of invalid names/paths/domains, since stricter validation is intentional behavior change.

Use targeted lockfile resolution for the compatible transitives rather than creating redundant direct dependencies. If resolver behavior requires temporary no-save explicit targets to select these versions, inspect the resulting diff and regenerate/install reproducibly before accepting. No blind force fix or broad graph refresh. Explicit aligned Tiptap manifest floors prevent an apparent core fix from leaving duplicate vulnerable peers. Core is also imported directly by application code and tests, so declaring it directly at the aligned target is correct dependency ownership.

## Actual usage and limits

- SDK: `convex/ai/providers.ts` imports Anthropic; `brain/ingest.ts:29` invokes `messages.create`; instrumentation wraps messages.create. No local-filesystem memory tool import/use found in searched production source. Advisory-specific execution path was not established. Preserve message types, caching and instrumentation via existing AI unit/type checks after the modest0.x upgrade.
- Tiptap: actual editor and read-only editor, shared configuration and document search import core/pm/extensions. A vulnerable rendering utility in this graph warrants prompt repair; untrusted stored content and AI-produced content exist, but this audit did not prove a working exploit. Run full editor/component tests after aligned upgrade.
- Mermaid: `MessageContent.svelte:43` renders assistant markdown through Streamdown. The transitive diagram renderer handles content that can originate from models; graph exposure is real even without a first-party mermaid import. DOMPurify's particular IN_PLACE/hook condition is not shown in first-party code. Verify streamed markdown rendering and diagram behavior.
- xmldom: mammoth is used to extract raw text from DOCX in browser `parseDocument.ts:179` and server `ingestionSync.ts:155`. Installed mammoth XML adapter uses DOMParser; no XMLSerializer/serializeToString match in mammoth lib. The advisory-specific serialization path is not established, but patch is in-range and inexpensive. Existing real uploader harnesses cover document extraction.
- PostCSS/nanoid and brace-expansion: build/tooling transitive paths from Vite and glob/minimatch. No application-supplied source-map parser or custom nanoid generator found by dependency-use search. Do not infer unauthenticated production exploitability from severity alone.
- tar: node-pre-gyp transitive packaging path, not a first-party archive member-selection API. Upgrade inside existing parent range.
- SvelteKit: framework request negotiation is potentially exposed to unauthenticated headers in deployed server routes. Cookie override changes framework serialization validation, so auth integration matters.

Implementation acceptance: fresh owned install, targeted installed-version/peer inspection, fresh audit (expected zero affected entries once cookie override resolves), complete loop-verify and browser component suite, and client bundle inspection for no React import/module. The report recommends fixes; it does not claim they were applied or tested.
