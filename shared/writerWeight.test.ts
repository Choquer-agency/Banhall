import { describe, expect, it } from "vitest";
import {
  brainCheckWriterRank,
  DEFAULT_WRITER_WEIGHT,
  defaultWeightForStaffRole,
  isWriterWeight,
  parseWriterWeight,
  writerWeight,
  writerWeightText,
} from "./writerWeight";

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

  it("resolves effective weight from custom override first, then staff role default, then global default", () => {
    expect(defaultWeightForStaffRole("technical_manager")).toBe(0.8);
    expect(defaultWeightForStaffRole("technical_writer")).toBe(0.5);
    expect(defaultWeightForStaffRole("junior_technical_writer")).toBe(0.2);
    expect(defaultWeightForStaffRole("financial")).toBe(DEFAULT_WRITER_WEIGHT);
    expect(defaultWeightForStaffRole(undefined)).toBe(DEFAULT_WRITER_WEIGHT);

    // Custom override always takes priority over staff role default.
    expect(writerWeight(0.01, "junior_technical_writer")).toBe(0.01);
    expect(writerWeight(1, "technical_writer")).toBe(1);
    expect(writerWeight(0, "technical_manager")).toBe(0);

    // Without a custom override, staff role default applies.
    expect(writerWeight(null, "technical_manager")).toBe(0.8);
    expect(writerWeight(undefined, "technical_writer")).toBe(0.5);
    expect(writerWeight(undefined, "junior_technical_writer")).toBe(0.2);
    expect(writerWeight(undefined, "financial")).toBe(0.7);
    expect(writerWeight(undefined, undefined)).toBe(0.7);

    // Brain check rank reflects the effective weight.
    expect(brainCheckWriterRank(undefined, "technical_manager")).toBe(-800);
    expect(brainCheckWriterRank(undefined, "junior_technical_writer")).toBe(-200);
    expect(brainCheckWriterRank(0.01, "junior_technical_writer")).toBe(-10);
  });
});
