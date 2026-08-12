import { describe, expect, it } from "vitest";
import {
  RAIL_DEFAULT_WIDTH,
  RAIL_MAX_WIDTH,
  RAIL_MIN_WIDTH,
  clampRailWidth,
  defaultRailPreferences,
  parseRailPreferences,
  railWidthForKey,
  serializeRailPreferences,
} from "./railPreferences";

describe("clampRailWidth", () => {
  it("clamps into [min, max] and rounds fractional widths", () => {
    expect(clampRailWidth(100)).toBe(RAIL_MIN_WIDTH);
    expect(clampRailWidth(1000)).toBe(RAIL_MAX_WIDTH);
    expect(clampRailWidth(300.6)).toBe(301);
    expect(clampRailWidth(RAIL_MIN_WIDTH)).toBe(RAIL_MIN_WIDTH);
    expect(clampRailWidth(RAIL_MAX_WIDTH)).toBe(RAIL_MAX_WIDTH);
  });

  it("falls to the default on non-finite input", () => {
    expect(clampRailWidth(Number.NaN)).toBe(RAIL_DEFAULT_WIDTH);
    expect(clampRailWidth(Number.POSITIVE_INFINITY)).toBe(RAIL_DEFAULT_WIDTH);
  });
});

describe("parseRailPreferences (fail-closed)", () => {
  it("returns defaults for null, garbage, and foreign shapes", () => {
    expect(parseRailPreferences(null)).toEqual(defaultRailPreferences());
    expect(parseRailPreferences("")).toEqual(defaultRailPreferences());
    expect(parseRailPreferences("not json")).toEqual(defaultRailPreferences());
    expect(parseRailPreferences('"board"')).toEqual(defaultRailPreferences());
    expect(parseRailPreferences("[1,2]")).toEqual({
      width: RAIL_DEFAULT_WIDTH,
      hidden: false,
    });
  });

  it("clamps persisted widths and coerces hidden strictly to boolean true", () => {
    expect(parseRailPreferences('{"width": 9999, "hidden": true}')).toEqual({
      width: RAIL_MAX_WIDTH,
      hidden: true,
    });
    expect(parseRailPreferences('{"width": 1, "hidden": "yes"}')).toEqual({
      width: RAIL_MIN_WIDTH,
      hidden: false,
    });
    expect(parseRailPreferences('{"width": "wide"}')).toEqual(defaultRailPreferences());
  });

  it("round-trips through serialize", () => {
    const serialized = serializeRailPreferences({ width: 312, hidden: true });
    expect(parseRailPreferences(serialized)).toEqual({ width: 312, hidden: true });
  });

  it("serializes out-of-range widths already clamped", () => {
    expect(JSON.parse(serializeRailPreferences({ width: 10_000, hidden: false }))).toEqual({
      width: RAIL_MAX_WIDTH,
      hidden: false,
    });
  });
});

describe("railWidthForKey (keyboard separator)", () => {
  it("steps ±8 on arrows and ±32 with Shift, clamped", () => {
    expect(railWidthForKey("ArrowRight", 255, false)).toBe(263);
    expect(railWidthForKey("ArrowLeft", 255, false)).toBe(247);
    expect(railWidthForKey("ArrowRight", 255, true)).toBe(287);
    expect(railWidthForKey("ArrowLeft", 255, true)).toBe(223);
    expect(railWidthForKey("ArrowLeft", RAIL_MIN_WIDTH, true)).toBe(RAIL_MIN_WIDTH);
    expect(railWidthForKey("ArrowRight", RAIL_MAX_WIDTH, false)).toBe(RAIL_MAX_WIDTH);
  });

  it("maps Home/End to min/max and ignores non-resize keys", () => {
    expect(railWidthForKey("Home", 300, false)).toBe(RAIL_MIN_WIDTH);
    expect(railWidthForKey("End", 300, false)).toBe(RAIL_MAX_WIDTH);
    expect(railWidthForKey("Enter", 300, false)).toBeNull();
    expect(railWidthForKey("Escape", 300, false)).toBeNull();
  });
});
