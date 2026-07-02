import adapter from "@sveltejs/adapter-vercel";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  // Keep the Next.js-era URL — muscle memory and any hardcoded localhost:3000
  // references keep working.
  server: { port: 3000 },
  preview: { port: 3000 },
  ssr: {
    // These import SvelteKit virtual modules ($env/*) — Vite must bundle them
    // for SSR instead of leaving them as node externals.
    noExternal: ["@mmailaender/convex-auth-svelte"],
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
    }),
  ],
});
