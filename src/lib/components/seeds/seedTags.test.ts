import { describe, expect, it } from "vitest";
import { seedTagStyle } from "./seedTags";

describe("seedTagStyle", () => {
  it("uses the contract palette and labels", () => {
    expect(seedTagStyle("high_level")).toEqual({ label: "High-level", background: "#EFF6FF", color: "#1447E6" });
    expect(seedTagStyle("technical").label).toBe("Technical");
  });

  it("keeps an unknown tag's own name on the neutral fill", () => {
    expect(seedTagStyle("custom")).toEqual({
      label: "custom",
      background: "var(--color-chrome)",
      color: "var(--color-ink-secondary)",
    });
  });
});
