import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { playwright } from "@vitest/browser-playwright";

/**
 * PSOS-04 component tests: real Svelte components in headless Chromium.
 *
 * One-time setup for a new contributor: `npx playwright install chromium`.
 * Without it `npm run test:component` fails with Playwright's own instructions;
 * `npm run test` never touches a browser.
 *
 * Deliberately a separate config rather than a third project in
 * `vitest.config.ts`. In vitest 4 `browser.provider` must be a factory, and a
 * string throws during *config resolution* — before project filtering — so a
 * browser project living in the root config could break `npm run test` itself.
 * Isolating it means a mistake here can only break `test:component`.
 *
 * Never add `sveltekit()`: it pulls in the `$app`/`$env` virtual modules and
 * Kit's SSR graph. The components tested here are presentational and take data
 * and callbacks as props, so they must not need any of it.
 */
export default defineConfig({
  plugins: [tailwindcss(), svelte()],
  resolve: {
    alias: {
      $lib: fileURLToPath(new URL("./src/lib", import.meta.url)),
      // Presentational components may build hrefs with `resolve()` from
      // $app/paths; stub just that module instead of pulling in Kit's graph.
      "$app/paths": fileURLToPath(new URL("./src/lib/test/app-paths-stub.ts", import.meta.url)),
      // Workspace-shell suites mount container components (WorkspaceDashboard,
      // ProjectsTableView) in the real route parent context, so their runtime
      // modules are stubbed faithfully: `$app/state` is a reactive page whose
      // url only moves on goto (never on shallow replaceState — Kit parity),
      // and convex-svelte resolves from a per-test registry. Still no
      // sveltekit() plugin, and presentational suites are unaffected.
      "$app/state": fileURLToPath(new URL("./src/lib/test/app-state-stub.svelte.ts", import.meta.url)),
      "$app/navigation": fileURLToPath(new URL("./src/lib/test/app-navigation-stub.ts", import.meta.url)),
      // The shared WorkspaceGate reads `dev` to decide whether the rollout
      // access query even runs; the stub pins dev=false so gate suites
      // exercise the production decision path.
      "$app/environment": fileURLToPath(new URL("./src/lib/test/app-environment-stub.ts", import.meta.url)),
      // Route-level suites mount the full current dashboard, whose shared
      // chrome (e.g. BuildStamp) reads public env modules.
      "$env/dynamic/public": fileURLToPath(new URL("./src/lib/test/env-dynamic-public-stub.ts", import.meta.url)),
      "$env/static/public": fileURLToPath(new URL("./src/lib/test/env-static-public-stub.ts", import.meta.url)),
      "convex-svelte": fileURLToPath(new URL("./src/lib/test/convex-svelte-stub.svelte.ts", import.meta.url)),
      "@mmailaender/convex-better-auth-svelte/svelte": fileURLToPath(
        new URL("./src/lib/test/convex-auth-stub.ts", import.meta.url)
      ),
    },
    conditions: ["browser"],
  },
  optimizeDeps: {
    include: [
      "bits-ui",
      "vaul-svelte",
      // The /project/[id] route suite mounts the full report pages, whose
      // import graph pulls these in; pre-bundling them stops Vite's optimizer
      // from reloading mid-run (vitest flags that as flaky behavior).
      "@kenjiuno/msgreader",
      "@tiptap/core",
      "@tiptap/extension-character-count",
      "@tiptap/extension-highlight",
      "@tiptap/extension-placeholder",
      "@tiptap/extension-underline",
      "@tiptap/pm/view",
      "@tiptap/starter-kit",
      "convex/browser",
      "file-saver",
      "mammoth",
      "pdfjs-dist",
      "postal-mime",
      "svelte-streamdown",
      "svelte-tiptap",
      "xlsx",
      "zod",
    ],
  },
  test: {
    name: "component",
    include: ["src/**/*.component.test.ts"],
    setupFiles: ["./src/lib/test/component-setup.ts"],
    // Component suites share one real browser document and several explicit
    // test registries. Keep files serial so a heavy route mount cannot starve
    // an unrelated interaction test or leak document state across files.
    fileParallelism: false,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
    },
  },
});
