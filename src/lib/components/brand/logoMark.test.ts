import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LOGO_MARK_COLORS, logoMarkRingColor, logoMarkSvg } from "./logoMark";

describe("logo mark", () => {
  it("uses the colours sampled from the logo PNGs", () => {
    expect(LOGO_MARK_COLORS).toEqual({ fir: "#0A3A38", white: "#FFFFFF", teal: "#008186" });
    expect(logoMarkRingColor("dark")).toBe("#0A3A38");
    expect(logoMarkRingColor("white")).toBe("#FFFFFF");
  });

  it("is the favicon, byte for byte", () => {
    const favicon = readFileSync(fileURLToPath(new URL("../../assets/favicon.svg", import.meta.url)), "utf8");
    expect(favicon).toBe(logoMarkSvg());
    expect(favicon).not.toContain("svelte");
  });
});
