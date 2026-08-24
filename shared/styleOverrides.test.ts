import { describe, expect, it } from "vitest";
import {
  DEFAULT_HOUSE_RULE_MODES,
  NO_STYLE_OVERRIDES,
  STYLE_OVERRIDE_KEYS,
  STYLE_OVERRIDE_META,
  hasAnyStyleOverride,
  normalizeHouseRuleModes,
  normalizeStyleOverrides,
  resolveEffectiveOverrides,
} from "./styleOverrides";

describe("normalizeStyleOverrides", () => {
  it("returns all-false for absent input (legacy rows)", () => {
    expect(normalizeStyleOverrides()).toEqual(NO_STYLE_OVERRIDES);
    expect(normalizeStyleOverrides(null)).toEqual(NO_STYLE_OVERRIDES);
    expect(normalizeStyleOverrides({})).toEqual(NO_STYLE_OVERRIDES);
  });

  it("fills missing keys and keeps set ones", () => {
    const normalized = normalizeStyleOverrides({ bannedWords: true });
    expect(normalized.bannedWords).toBe(true);
    for (const key of STYLE_OVERRIDE_KEYS) {
      if (key !== "bannedWords") expect(normalized[key]).toBe(false);
    }
  });

  it("treats only literal true as waived", () => {
    const normalized = normalizeStyleOverrides({
      // Simulates a malformed stored value sneaking through.
      paragraphDensity: undefined,
      repetitionCaps: false,
      openingClauses: true,
    });
    expect(normalized.paragraphDensity).toBe(false);
    expect(normalized.repetitionCaps).toBe(false);
    expect(normalized.openingClauses).toBe(true);
  });

  it("returns a fresh object (never mutates the shared default)", () => {
    const normalized = normalizeStyleOverrides({ bannedWords: true });
    expect(normalized).not.toBe(NO_STYLE_OVERRIDES);
    expect(NO_STYLE_OVERRIDES.bannedWords).toBe(false);
  });
});

describe("hasAnyStyleOverride", () => {
  it("is false for the default and true when any key is waived", () => {
    expect(hasAnyStyleOverride(NO_STYLE_OVERRIDES)).toBe(false);
    for (const key of STYLE_OVERRIDE_KEYS) {
      expect(
        hasAnyStyleOverride(normalizeStyleOverrides({ [key]: true }))
      ).toBe(true);
    }
  });
});

describe("STYLE_OVERRIDE_META", () => {
  it("covers every key with a label and description", () => {
    for (const key of STYLE_OVERRIDE_KEYS) {
      expect(STYLE_OVERRIDE_META[key].label.length).toBeGreaterThan(0);
      expect(STYLE_OVERRIDE_META[key].description.length).toBeGreaterThan(0);
    }
  });
});

// ─── PSOS-50: org-level governance modes ────────────────────────────────────

describe("normalizeHouseRuleModes", () => {
  it("defaults to writer_choice for absent, malformed, and unknown values", () => {
    expect(normalizeHouseRuleModes(undefined)).toEqual(DEFAULT_HOUSE_RULE_MODES);
    expect(normalizeHouseRuleModes(null)).toEqual(DEFAULT_HOUSE_RULE_MODES);
    expect(normalizeHouseRuleModes("not json {")).toEqual(DEFAULT_HOUSE_RULE_MODES);
    expect(normalizeHouseRuleModes('{"bannedWords":"banish"}')).toEqual(
      DEFAULT_HOUSE_RULE_MODES
    );
    expect(normalizeHouseRuleModes('"off"')).toEqual(DEFAULT_HOUSE_RULE_MODES);
  });

  it("parses JSON strings and plain objects, keeping known values only", () => {
    const expected = {
      ...DEFAULT_HOUSE_RULE_MODES,
      bannedWords: "off" as const,
      openingClauses: "enforced" as const,
    };
    expect(
      normalizeHouseRuleModes('{"bannedWords":"off","openingClauses":"enforced","junk":"off"}')
    ).toEqual(expected);
    expect(
      normalizeHouseRuleModes({ bannedWords: "off", openingClauses: "enforced" })
    ).toEqual(expected);
  });
});

describe("resolveEffectiveOverrides", () => {
  it("writer_choice defers to the writer's toggle", () => {
    const writer = normalizeStyleOverrides({ bannedWords: true });
    expect(resolveEffectiveOverrides(DEFAULT_HOUSE_RULE_MODES, writer)).toEqual(
      writer
    );
    expect(
      resolveEffectiveOverrides(DEFAULT_HOUSE_RULE_MODES, NO_STYLE_OVERRIDES)
    ).toEqual(NO_STYLE_OVERRIDES);
  });

  it("off waives for everyone regardless of the writer's toggle", () => {
    const modes = { ...DEFAULT_HOUSE_RULE_MODES, paragraphDensity: "off" as const };
    expect(
      resolveEffectiveOverrides(modes, NO_STYLE_OVERRIDES).paragraphDensity
    ).toBe(true);
  });

  it("enforced beats the writer's waiver", () => {
    const modes = { ...DEFAULT_HOUSE_RULE_MODES, bannedWords: "enforced" as const };
    const writer = normalizeStyleOverrides({ bannedWords: true, repetitionCaps: true });
    const effective = resolveEffectiveOverrides(modes, writer);
    expect(effective.bannedWords).toBe(false);
    expect(effective.repetitionCaps).toBe(true);
  });
});
