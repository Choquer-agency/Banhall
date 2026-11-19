import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The Convex backend refuses a schema whose index name is longer than 64
 * characters, and convex-test does not check it, so a too-long name passes
 * every test and then fails the first deploy (found 2026-11-11 when the local
 * lab could not start). This reads the schema source and checks every name.
 */
const MAX_INDEX_NAME = 64;
const schemaPath = fileURLToPath(new URL("../convex/schema.ts", import.meta.url));

describe("Convex index names", () => {
  const source = readFileSync(schemaPath, "utf8");
  const names = [...source.matchAll(/\.(?:index|searchIndex|vectorIndex)\(\s*"([^"]+)"/g)].map(
    (match) => match[1]
  );

  it("finds the schema's index names", () => {
    expect(names.length).toBeGreaterThan(100);
  });

  it("keeps every index name within the backend's limit", () => {
    const tooLong = names.filter((name) => name.length > MAX_INDEX_NAME);
    expect(tooLong).toEqual([]);
  });

  it("uses only letters, digits and underscores, starting with a letter", () => {
    const invalid = names.filter((name) => !/^[A-Za-z][A-Za-z0-9_]*$/.test(name));
    expect(invalid).toEqual([]);
  });
});
