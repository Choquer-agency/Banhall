import { describe, expect, it } from "vitest";
import {
  DEFAULT_HOUSE_RULE_MODES,
  NO_STYLE_OVERRIDES,
  STYLE_OVERRIDE_KEYS,
  STYLE_OVERRIDE_META,
  hasAnyStyleOverride,
  houseRuleModeNote,
  normalizeHouseRuleModes,
  normalizeStyleOverrides,
  resolveEffectiveOverrides,
  type HouseRuleModes,
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

  it("gives every area the writer's name, a summary, the house rule, an example and what the switch changes (2026-10-19)", () => {
    for (const key of STYLE_OVERRIDE_KEYS) {
      const meta = STYLE_OVERRIDE_META[key];
      for (const field of ["writerLabel", "summary", "houseRule", "example", "whenOn"] as const) {
        expect(meta[field].trim().length, `${key}.${field}`).toBeGreaterThan(0);
      }
    }
    expect(STYLE_OVERRIDE_META.bannedWords.writerLabel).toBe("Word list");
    // The operations lead's question: a list of words to avoid, with set replacements.
    expect(STYLE_OVERRIDE_META.bannedWords.houseRule).toContain("must not use");
    expect(STYLE_OVERRIDE_META.sentenceConstruction.houseRule).toContain("40 words");
  });

  it("uses the plain hyphen only, with no em, en or other dashes", () => {
    for (const key of STYLE_OVERRIDE_KEYS) {
      for (const [field, value] of Object.entries(STYLE_OVERRIDE_META[key])) {
        expect(value, `${key}.${field}`).not.toMatch(/[\u2010-\u2015\u2212]/);
      }
    }
  });

  it("keeps the admin labels the prompts quote", () => {
    // convex/ai/prompts.ts and the style analysis prompt use these labels.
    expect(STYLE_OVERRIDE_KEYS.map((key) => STYLE_OVERRIDE_META[key].label)).toEqual([
      "Banned words and phrases",
      "Paragraph density",
      "Sentence construction",
      "Phrase repetition caps",
      "Mandated opening clauses",
      "Report skeleton and paragraph roles",
    ]);
  });
});

describe("houseRuleModeNote", () => {
  it("explains a locked area and says nothing when the writer decides", () => {
    expect(houseRuleModeNote("writer_choice")).toBeNull();
    expect(houseRuleModeNote("enforced")).toBe(
      "Your organization always applies this house rule, so its switch is locked."
    );
    expect(houseRuleModeNote("off")).toBe(
      "Your organization turned this house rule off for everyone, so your instructions already apply here."
    );
  });
});

// ─── PSOS-50: org-level governance modes ────────────────────────────────────

describe("DEFAULT_HOUSE_RULE_MODES (2026-09-15 owner decision)", () => {
  it("is writer_choice for every category except openingClauses, which is off", () => {
    for (const key of STYLE_OVERRIDE_KEYS) {
      expect(DEFAULT_HOUSE_RULE_MODES[key], key).toBe(
        key === "openingClauses" ? "off" : "writer_choice"
      );
    }
  });

  it("waives the mandated opening clauses for everyone when no row is stored", () => {
    const effective = resolveEffectiveOverrides(
      normalizeHouseRuleModes(undefined),
      NO_STYLE_OVERRIDES
    );
    expect(effective).toEqual({ ...NO_STYLE_OVERRIDES, openingClauses: true });
    // A stored row that omits the key gets the same default.
    expect(
      resolveEffectiveOverrides(
        normalizeHouseRuleModes('{"bannedWords":"off"}'),
        NO_STYLE_OVERRIDES
      ).openingClauses
    ).toBe(true);
  });

  it("an explicit enforced row still enforces openers; writer_choice hands it back to the writer", () => {
    const enforced = normalizeHouseRuleModes('{"openingClauses":"enforced"}');
    expect(enforced.openingClauses).toBe("enforced");
    expect(
      resolveEffectiveOverrides(enforced, normalizeStyleOverrides({ openingClauses: true }))
        .openingClauses
    ).toBe(false);
    const writerChoice = normalizeHouseRuleModes({ openingClauses: "writer_choice" });
    expect(resolveEffectiveOverrides(writerChoice, NO_STYLE_OVERRIDES).openingClauses).toBe(
      false
    );
    expect(
      resolveEffectiveOverrides(writerChoice, normalizeStyleOverrides({ openingClauses: true }))
        .openingClauses
    ).toBe(true);
  });
});

describe("normalizeHouseRuleModes", () => {
  it("falls back to the defaults for absent, malformed, and unknown values", () => {
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
    const allWriterChoice = Object.fromEntries(
      STYLE_OVERRIDE_KEYS.map((key) => [key, "writer_choice" as const])
    ) as HouseRuleModes;
    const writer = normalizeStyleOverrides({ bannedWords: true });
    expect(resolveEffectiveOverrides(allWriterChoice, writer)).toEqual(writer);
    expect(resolveEffectiveOverrides(allWriterChoice, NO_STYLE_OVERRIDES)).toEqual(
      NO_STYLE_OVERRIDES
    );
    // The shipped default differs only by the org-wide opener waiver.
    expect(resolveEffectiveOverrides(DEFAULT_HOUSE_RULE_MODES, writer)).toEqual({
      ...writer,
      openingClauses: true,
    });
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
