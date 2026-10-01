import { describe, expect, it } from "vitest";
import { qaBand, qaBandColors } from "./qaBands";

describe("qaBand", () => {
  it("uses the contract thresholds", () => {
    expect(qaBand(100)).toBe("green");
    expect(qaBand(80)).toBe("green");
    expect(qaBand(79)).toBe("orange");
    expect(qaBand(60)).toBe("orange");
    expect(qaBand(59)).toBe("red");
    expect(qaBand(0)).toBe("red");
  });

  it("returns the band's chip and bar colours", () => {
    expect(qaBandColors(78)).toEqual({ bar: "#F59E0B", chipBg: "#FFEDD5", chipText: "#C2410C" });
  });
});
