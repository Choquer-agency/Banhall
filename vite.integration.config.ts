import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig, type Plugin } from "vite";
import baseConfig from "./vite.config";

/**
 * Real-router witness config for `scripts/seed-summary-history-witness.mjs`:
 * the production SvelteKit plugin, router and route tree from vite.config.ts,
 * with ONLY the backend transport (`convex-svelte`) and the auth adapter
 * swapped for the component-test stubs. A real Chromium then traverses history
 * entries the hosts create with SvelteKit's own `pushState`.
 *
 * Never used by `npm run dev`, the production build or either vitest config;
 * the canonical component config keeps running without `sveltekit()`. The
 * exact-match aliases leave `convex-svelte/sveltekit/server` and the auth
 * adapter's server entry untouched, so SSR keeps the real hooks.
 */

/** Readiness endpoint that names the invocation this dev server belongs to
 * (Verification, R5-11): the witness passes a fresh `SEED_WITNESS_RUN_TOKEN`
 * to the server it spawns and accepts readiness only from a server answering
 * with that token, never from whatever else happens to hold the port. */
export const SEED_WITNESS_READY_PATH = "/__seed-witness/ready";
const witnessReadiness: Plugin = {
  name: "banhall-seed-witness-readiness",
  configureServer(server) {
    server.middlewares.use(SEED_WITNESS_READY_PATH, (_request, response) => {
      response.setHeader("content-type", "application/json");
      response.setHeader("cache-control", "no-store");
      response.end(JSON.stringify({ token: process.env.SEED_WITNESS_RUN_TOKEN ?? null, pid: process.pid }));
    });
  },
};

// vite.config.ts exports a function (its CSP reads the build's env), so the
// merge runs per invocation.
export default defineConfig((configEnv) => mergeConfig(
  baseConfig(configEnv),
  defineConfig({
    plugins: [witnessReadiness],
    // A cache of its own: this config's dependency graph (stubbed transport,
    // real router) must never warm or poison the app's or the suites' caches.
    cacheDir: "node_modules/.vite-integration",
    server: { port: 3107, strictPort: true, host: "127.0.0.1" },
    resolve: {
      alias: [
        {
          find: /^convex-svelte$/,
          replacement: fileURLToPath(
            new URL("./src/lib/test/convex-svelte-stub.integration.ts", import.meta.url)
          ),
        },
        {
          find: /^@mmailaender\/convex-better-auth-svelte\/svelte$/,
          replacement: fileURLToPath(new URL("./src/lib/test/convex-auth-stub.ts", import.meta.url)),
        },
      ],
    },
    optimizeDeps: {
      // The project route lazy-loads both hosts; pre-bundling their heavy
      // dependencies keeps the optimizer from reloading the page mid-witness.
      // `ai` is reached only by the lazily mounted chat panel of the report
      // state: discovered late on a cold cache, its deferred re-optimization
      // reloaded every open page during a later journey.
      include: [
        "ai",
        "@vercel/oidc",
        "bits-ui",
        "vaul-svelte",
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
  })
));
