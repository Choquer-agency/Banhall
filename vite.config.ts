import adapter from "@sveltejs/adapter-vercel";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv, type Plugin } from "vite";
import type { Config } from "@sveltejs/kit";
import { cspDirectives } from "./shared/securityHeaders";

/**
 * Dev only: rewrites `import { XIcon } from "phosphor-svelte"` to one module
 * per icon. Without it the dev server pre-bundles the whole icon set (40 MB)
 * and a cold project open parsed all of it before the page could show
 * (2026-09-28 load measurement). The build tree-shakes the barrel anyway.
 * The package's own plugin parses the file as JavaScript, so it fails on
 * .svelte sources that have not been compiled yet; this runs on the source
 * text before the Svelte compiler instead.
 */
function phosphorDeepImports(): Plugin {
  const barrel = /import\s*\{([^}]*)\}\s*from\s*["']phosphor-svelte["'];?/g;
  return {
    name: "banhall:phosphor-deep-imports",
    apply: "serve",
    enforce: "pre",
    transform(code, id) {
      if (id.includes("/node_modules/") || !/\.(svelte|ts|js)$/.test(id.split("?")[0]) || !code.includes("phosphor-svelte")) return;
      const rewritten = code.replace(barrel, (_match, names: string) =>
        names
          .split(",")
          .map((name) => name.trim())
          .filter(Boolean)
          .map((name) => {
            const [imported, local = imported] = name.split(/\s+as\s+/);
            return `import ${local} from "phosphor-svelte/lib/${imported}";`;
          })
          .join(" ")
      );
      return rewritten === code ? undefined : { code: rewritten, map: null };
    },
  };
}

type CspOption = NonNullable<NonNullable<Config["kit"]>["csp"]>;

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "PUBLIC_");
  const convexUrl = process.env.PUBLIC_CONVEX_URL ?? env.PUBLIC_CONVEX_URL;
  const convexSiteUrl = process.env.PUBLIC_CONVEX_SITE_URL ?? env.PUBLIC_CONVEX_SITE_URL;
  // Security wave 1 (a2 P2-1, a4 #6): nonce-based CSP for pages SvelteKit
  // renders, hashes for any prerendered page. The other headers are set in
  // src/hooks.server.ts. See shared/securityHeaders.ts for what is allowed.
  const csp: CspOption = {
    mode: "auto",
    directives: cspDirectives({
      convexUrl,
      convexSiteUrl,
      dev: command === "serve",
    }) as CspOption["directives"],
  };
  return {
    // Canonical local app URL — use this for development and production previews.
    server: {
      port: 3001,
      // Let the dev server be reached over Tailscale (IP works by default; MagicDNS
      // hostnames need an explicit allowlist).
      allowedHosts: [".ts.net"],
    },
    preview: { port: 3001 },
    // Icons load as the small source modules phosphorDeepImports points at;
    // pre-bundling them made the optimizer find new icons page by page and
    // reload the app each time.
    optimizeDeps: { exclude: ["phosphor-svelte"] },
    ssr: {
      // Bundle packages that Node cannot load directly during SSR: the auth
      // adapter imports SvelteKit virtual modules; Sonner exports .svelte files.
      noExternal: ["@mmailaender/convex-better-auth-svelte", "svelte-sonner"],
    },
    plugins: [
      phosphorDeepImports(),
      tailwindcss(),
      sveltekit({
        compilerOptions: {
          // Force runes mode for the project, except for libraries.
          runes: ({ filename }) =>
            filename.split(/[/\\]/).includes("node_modules") ? undefined : true,
        },
        adapter: adapter(),
        // Detect new deployments: clients poll for a new build and beforeNavigate
        // (root layout) turns the next client-side nav into a full reload, so old
        // tabs never request hashed chunks Vercel has already dropped.
        version: { pollInterval: 60_000 },
        csp,
      }),
    ],
  };
});
