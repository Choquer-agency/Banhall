import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

const sourceAuditTests = ["src/lib/components/ui/formControlContract.test.ts"];

// Standalone vitest config: takes precedence over vite.config.ts so unit tests
// of plain TS modules do not boot the SvelteKit plugin. Only the $lib alias is
// mirrored here so src/lib modules resolve.
export default defineConfig({
  // OXC's automatic tsconfig discovery fails for shared modules in this test
  // setup. Keep unit-test transpilation explicit; the verification gate
  // still runs the unchanged Convex and Svelte typecheck configurations.
  oxc: {
    tsconfig: { compilerOptions: { target: "ESNext", strict: true } },
  },
  resolve: {
    alias: {
      $lib: fileURLToPath(new URL("./src/lib", import.meta.url)),
    },
  },
  test: {
    // Bound resource use when native verification runs in concurrent worktrees.
    maxWorkers: 2,
    projects: [
      {
        extends: true,
        test: {
          name: "convex",
          include: ["convex/**/*.test.ts", "tests/aiUsage.test.ts"],
          environment: "edge-runtime",
          // convex-test glob-imports the whole backend per test file, so the
          // first case in a file pays a module-graph cost that varies with
          // machine load. The 5s default made the two slowest cases fail
          // intermittently even though nothing about them is slow.
          testTimeout: 30_000,
        },
      },
      {
        extends: true,
        test: {
          name: "shared",
          // Cross-runtime modules; without this project their tests are
          // silently skipped (no project matched shared/**).
          include: ["shared/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        extends: true,
        test: {
          name: "src",
          include: ["src/**/*.test.ts"],
          // Component tests match the include glob above but need a real
          // browser; they run from vitest.component.config.ts instead. The
          // defaults are spread back in because `exclude` replaces them.
          exclude: [...configDefaults.exclude, "src/**/*.component.test.ts", ...sourceAuditTests],
          environment: "node",
        },
      },
      {
        extends: true,
        test: {
          name: "source-audit",
          include: sourceAuditTests,
          environment: "node",
          // This audit parses every Svelte source file. Full-suite contention
          // can exceed 5s; keep the larger budget local to the source audit.
          testTimeout: 30_000,
        },
      },
    ],
  },
});
