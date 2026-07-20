import adapter from "@sveltejs/adapter-vercel";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  // Canonical local app URL — use this for development and production previews.
  server: { port: 3001 },
  preview: { port: 3001 },
  ssr: {
    // Bundle packages that Node cannot load directly during SSR: the auth
    // adapter imports SvelteKit virtual modules; Sonner exports .svelte files.
    noExternal: ["@mmailaender/convex-better-auth-svelte", "svelte-sonner"],
  },
  plugins: [
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
    }),
  ],
});
