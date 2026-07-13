import { describe, expect, test } from "bun:test";
import { canUseIndustry, industrySlug } from "../shared/industries";

describe("industry creation authorization", () => {
  test("writers can select base and existing custom industries", () => {
    expect(canUseIndustry("writer", industrySlug("Software"), false)).toBe(true);
    expect(canUseIndustry("writer", industrySlug("Clean technology"), true)).toBe(true);
  });

  test("writers cannot introduce a new industry", () => {
    expect(canUseIndustry("writer", industrySlug("Aerospace"), false)).toBe(false);
  });

  test("admins can introduce a normalized industry", () => {
    expect(
      canUseIndustry("admin", industrySlug("Aerospace & Defence"), false)
    ).toBe(true);
    expect(industrySlug("  Aerospace & Defence  ")).toBe("aerospace-defence");
  });
});
