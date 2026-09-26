import { describe, expect, it } from "vitest";
import { seedTagStyle } from "./seedTags";

describe("seedTagStyle", () => {
  it("uses the contract palette and labels", () => {
    expect(seedTagStyle("high_level")).toEqual({
      label: "High-level",
      background: "var(--color-seed-tag-high-level)",
      color: "var(--color-seed-tag-high-level-ink)",
    });
    expect(seedTagStyle("technical")).toEqual({
      label: "Technical",
      background: "var(--color-seed-tag-technical)",
      color: "var(--color-primary-selected)",
    });
  });

  it("keeps an unknown tag's own name on the neutral fill", () => {
    expect(seedTagStyle("custom")).toEqual({
      label: "custom",
      background: "var(--color-chrome)",
      color: "var(--color-ink-secondary)",
    });
  });
});
