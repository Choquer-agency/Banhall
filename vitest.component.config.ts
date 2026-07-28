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
    alias: { $lib: fileURLToPath(new URL("./src/lib", import.meta.url)) },
    conditions: ["browser"],
  },
  test: {
    name: "component",
    include: ["src/**/*.component.test.ts"],
    setupFiles: ["./src/lib/test/component-setup.ts"],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
    },
  },
});
