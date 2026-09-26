/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";

/**
 * A reply can open with a thinking block (Opus 5.5 and Fable 5.1 always
 * think), so reading a response's `content[0]` as its text silently drops
 * the answer. Readers go through firstResponseText or requireTextResponse
 * (convex/ai/openrouterCore.ts). This audit keeps the whole class out of
 * convex/ (models-2 review P3-5).
 */
const sources = import.meta.glob(["../**/*.ts", "!../**/*.test.ts", "!../_generated/**"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("response text readers", () => {
  it("never read a response's first content block as its text", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(50);
    const offenders = Object.entries(sources).flatMap(([path, text]) =>
      text
        .split("\n")
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => /\.content(\?\.)?\[0\]/.test(line))
        .map(({ index }) => `${path}:${index + 1}`)
    );
    expect(offenders).toEqual([]);
  });
});
