# Reproducing Q8 runtime evidence

root-restore-map.json maps every archived executable fixture/config to its exact original path and SHA256. Copy stored bytes to each restore_path, verify the listed hash, and run the documented commands from this checkout with Node24 and installed Chromium. Afterward remove only those restored copies; keep archived text.

Original checks:
- PUBLIC_CONVEX_URL=https://placeholder.convex.cloud PUBLIC_CONVEX_SITE_URL=https://placeholder.convex.site node .audit/quality-pass/Q8/runtime/cookie-check.mjs
- npx vitest run --config .audit/quality-pass/Q8/runtime/component.config.ts
- PUBLIC_CONVEX_URL=https://placeholder.convex.cloud PUBLIC_CONVEX_SITE_URL=https://placeholder.convex.site npx vite build --config .audit/quality-pass/Q8/runtime/vite-observe.config.ts
- node .audit/quality-pass/Q8/runtime/verify-client.mjs
- node .audit/quality-pass/Q8/runtime/verify-resolution.mjs

The historical original browser wrapper shares the canonical cache configuration. Run it in a disposable isolated checkout when preserving an existing canonical cache matters. The later hostile-boundary wrapper explicitly uses its own cache; its exact commands and current-build requirements are in post-review-runtime/report.md. Reproducing the production module smoke requires a fresh production build, matching manifest/generated route mapping and public bootstrap environment; it is not a login test.

These scripts use fixed output names. Use a fresh isolated checkout/output copy when retaining this committed evidence; do not overwrite historical results during an unrelated verification run. The tar.gz retains the109observed client chunks independently of later builds. Stored command logs and hashes describe their recorded invocation, not whichever generated output directory currently exists.
