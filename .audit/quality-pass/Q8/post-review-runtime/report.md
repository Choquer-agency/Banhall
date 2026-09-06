# Q8 post-review runtime evidence

Audit-only checks for blind6/7/8/11. No production, package/config, canonical test, index or other-checkout changes. All fixtures and outputs are contained here; browser wrapper uses its own explicit vite-cache directory. Existing Q8 evidence is preserved.

## Actual hostile rendering boundaries

hostile-final.log exits0, one actual Chromium component test. Mounted actual MessageContent with malicious script/img event markup, javascript link and Mermaid source: bold renders, dangerous DOM absent, production Mermaid stays its existing code fallback rather than enabling SVG. Separate opt-in Streamdown/Mermaid receives an HTML/event/javascript-click diagram: actual SVG renders with no dangerous script/event/link nodes and the execution sentinel remains zero. Actual DOMPurify separately strips malicious SVG/img handlers and javascript links. Browser context route aborts nonlocal external requests; no live account/backend interaction occurs. These finite hostile cases are compatibility/sanitization boundary checks, not a general exploitability/security proof. hostile-boundary.png records actual output.

## xmldom consuming workflow

Dependency path: application parseFileToText DOCX branch delegates to mammoth.extractRawText; Mammoth's lib/xml/reader.js uses lib/xml/xmldom.js, which requires @xmldom/xmldom. document-and-bundle.mjs builds a minimal actual DOCX ZIP in memory and invokes the installed Mammoth extractRawText. It recovers exact entity-decoded text; malformed document XML rejects through the actual parser wrapper. This uses Mammoth's Node buffer entry into the same document/XML consumer, not a mounted upload UI or every malformed XML pattern. Exact installed versions/error text are in document-and-bundle.json.

## Actual production browser module import

Final script exits0 and imports the current emitted project-route chunk identified by the production .vite manifest and generated nodes/19 route mapping; that route includes Current/PreviewProjectPage and AgentChatPanel. Retained production-manifest.json and generated-project-node.txt bind selection. It serves only current local build assets and a minimal fixture, blocks every external network request, asserts nonempty module exports and zero pageerrors/blocked network attempts. Chunk SHA and exports are recorded. No CJS named-export error occurs in this module evaluation.

Two genuine preliminary limitations are retained: the older client-modules manifest referenced assets removed by a later build (document-and-bundle.log exit1), and a raw import without Kit bootstrap globals failed reading env (document-and-bundle-current.log exit1). Final fixture supplies only the emitted Kit-global name and public placeholder env, explicitly recorded, with no fabricated login/session. This proves deployed-format module evaluation, not SSR delivery, authentication, component mounting, SDK requests or interactive chat. A blank fixture screenshot is not visual chat proof. Source changed later would require rebinding to a fresh production build; this audit did not build.

## Reproduction without reconstruction

restore-map.json gives exact archive-to-executable paths and SHA256 values for all three renamed fixtures. Copy each stored .txt byte-for-byte to its restore path, verify SHA, then run from repository root:

`node node_modules/vitest/vitest.mjs run --config .audit/quality-pass/Q8/post-review-runtime/component.config.ts`

Do not append --config to npm run test:component: that script already supplies one config; hostile.log preserves the resulting initial CLI exit1. After running, remove only the three restored executable copies; retained .txt evidence remains. The dedicated audit cache must not be substituted with canonical cache.

`node .audit/quality-pass/Q8/post-review-runtime/document-and-bundle.mjs`

This requires the current production build output/manifest and matching generated route, with owned installed dependencies and Chromium. It creates no build itself. Capture fresh stdout/exit under new names rather than overwrite these review receipts; likewise use a copied audit output directory if preserving this exact snapshot. hashes.json binds this run's script, fixture, logs and retained artifacts. Root's final cold canonical gate and fresh full-build acceptance remain separate.
