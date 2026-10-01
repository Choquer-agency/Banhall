import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, it } from "vitest";

/**
 * Review 2026-09-26 (P1-1): one table's placeholder validator lacked the
 * `at` field and refused every project with a loose label. Every stored or
 * returned placeholder map must use the shared validator, never an inline
 * copy that can fall behind.
 */
it("defines no placeholder entry validator outside convex/lib/placeholderValidators.ts", () => {
  const root = new URL("..", import.meta.url).pathname;
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === "_generated" || name === "node_modules") continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (path.endsWith(".ts") && !path.endsWith(".test.ts")) files.push(path);
    }
  };
  walk(root);
  const inline = files.filter(
    (path) =>
      !path.endsWith("placeholderValidators.ts") &&
      /token:\s*v\.string\(\),\s*value:\s*v\.string\(\)/.test(readFileSync(path, "utf8"))
  );
  expect(inline.map((path) => relative(root, path))).toEqual([]);
});

it("defines no stored speaker-names validator outside convex/lib/placeholderValidators.ts", () => {
  // Decision 65, stage 2: a project transcript and a private intake draft's
  // transcript keep the same names for their placeholder maps.
  const root = new URL("..", import.meta.url).pathname;
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === "_generated" || name === "node_modules") continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (path.endsWith(".ts") && !path.endsWith(".test.ts")) files.push(path);
    }
  };
  walk(root);
  const inline = files.filter(
    (path) =>
      !path.endsWith("placeholderValidators.ts") &&
      /otherNames:\s*v\.array\(v\.string\(\)\)/.test(readFileSync(path, "utf8"))
  );
  expect(inline.map((path) => relative(root, path))).toEqual([]);
});
