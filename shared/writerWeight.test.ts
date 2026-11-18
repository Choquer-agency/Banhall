import { describe, expect, it } from "vitest";
import { isWriterWeight, parseWriterWeight, writerWeightText } from "./writerWeight";

describe("writer weights", () => {
  it("accepts numbers from 0 to 1 with at most 3 decimal places", () => {
    for (const weight of [0, 1, 0.7, 0.85, 0.123, 0.001]) expect(isWriterWeight(weight)).toBe(true);
    for (const weight of [0.1234, 0.123456, 0.0005, -0.001, 1.001, Number.NaN]) expect(isWriterWeight(weight)).toBe(false);
  });

  it("reads what a person typed, refusing more than 3 decimal places", () => {
    expect(parseWriterWeight("")).toBeNull();
    expect(parseWriterWeight(" 0,8 ")).toBe(0.8);
    expect(parseWriterWeight(".5")).toBe(0.5);
    expect(parseWriterWeight("0.123")).toBe(0.123);
    expect(parseWriterWeight("1.")).toBe(1);
    expect(parseWriterWeight("0.1234")).toBe("invalid");
    expect(parseWriterWeight("0.123456")).toBe("invalid");
    expect(parseWriterWeight("1.5")).toBe("invalid");
    expect(parseWriterWeight("abc")).toBe("invalid");
  });

  it("shows every accepted weight exactly as saved, so saving again changes nothing", () => {
    for (const weight of [0, 1, 0.7, 0.85, 0.123, 0.001, 0.999]) {
      const shown = writerWeightText(weight);
      expect(parseWriterWeight(shown)).toBe(weight);
    }
  });
});
