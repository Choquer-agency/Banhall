import { describe, expect, it } from "vitest";
import source from "./+page.svelte?raw";

// B3 and the round 2 copy rule: plain hyphen only, no em or en dashes.
describe("House rules page copy", () => {
  it("uses no typographic dashes", () => {
    expect(source.match(/[‐-―−]/g) ?? []).toEqual([]);
    expect(source).toContain("CRA-required: same for everyone");
  });
});
