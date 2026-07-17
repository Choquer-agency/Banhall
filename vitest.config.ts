import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Standalone vitest config: takes precedence over vite.config.ts so unit tests
// of plain TS modules do not boot the SvelteKit plugin. Only the $lib alias is
// mirrored here so src/lib modules resolve.
export default defineConfig({
  resolve: {
    alias: {
      $lib: fileURLToPath(new URL("./src/lib", import.meta.url)),
    },
  },
  test: {
    include: ["convex/**/*.test.ts", "src/**/*.test.ts"],
  },
});
