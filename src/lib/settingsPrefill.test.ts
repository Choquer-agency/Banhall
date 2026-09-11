import { describe, expect, it } from "vitest";
import {
  settingsPrefillNotice,
  settingsPrefillOverrides,
  settingsPrefillText,
  settingsPrefillUnavailableNotice,
  type SettingsOffer,
} from "./settingsPrefill";
import {
  DEFAULT_HOUSE_RULE_MODES,
  NO_STYLE_OVERRIDES,
} from "../../shared/styleOverrides";

const offer: SettingsOffer = {
  supplyPath: "writer_notes",
  fileName: "PD Writing Customized Settings.docx",
  text: "PD Writing Customized Settings\nLine 246: no more than 80 lines.",
  truncated: false,
  addressedCategories: ["bannedWords", "paragraphDensity", "reportSkeleton"],
};

describe("settingsPrefillText", () => {
  it("waits for the saved-profile seed", () => {
    expect(
      settingsPrefillText({ seeded: false, alreadyPrefilled: false, offer, current: "" })
    ).toBeNull();
    expect(
      settingsPrefillText({ seeded: true, alreadyPrefilled: false, offer, current: "Old profile." })
    ).toBe(offer.text);
  });

  it("prefills once", () => {
    expect(
      settingsPrefillText({ seeded: true, alreadyPrefilled: true, offer, current: "Old profile." })
    ).toBeNull();
  });

  it("gives null with no offer or when the offer equals the draft", () => {
    expect(
      settingsPrefillText({ seeded: true, alreadyPrefilled: false, offer: null, current: "" })
    ).toBeNull();
    expect(
      settingsPrefillText({ seeded: true, alreadyPrefilled: false, offer: undefined, current: "" })
    ).toBeNull();
    expect(
      settingsPrefillText({ seeded: true, alreadyPrefilled: false, offer, current: `  ${offer.text}\n` })
    ).toBeNull();
  });
});

describe("settingsPrefillOverrides", () => {
  it("turns on only the analysed writer_choice categories", () => {
    const modes = { ...DEFAULT_HOUSE_RULE_MODES, paragraphDensity: "enforced" as const, reportSkeleton: "off" as const };
    expect(settingsPrefillOverrides({ offer, modes, current: NO_STYLE_OVERRIDES })).toEqual({
      ...NO_STYLE_OVERRIDES,
      bannedWords: true,
    });
  });

  it("never turns a waiver off and never touches a governed category", () => {
    const modes = { ...DEFAULT_HOUSE_RULE_MODES, openingClauses: "enforced" as const };
    const current = { ...NO_STYLE_OVERRIDES, repetitionCaps: true, openingClauses: true };
    expect(settingsPrefillOverrides({ offer, modes, current })).toEqual({
      ...current,
      bannedWords: true,
      paragraphDensity: true,
      reportSkeleton: true,
    });
  });

  it("leaves the toggles unchanged when the analysis failed or is absent", () => {
    const current = { ...NO_STYLE_OVERRIDES, repetitionCaps: true };
    expect(
      settingsPrefillOverrides({
        offer: { ...offer, addressedCategories: null },
        modes: DEFAULT_HOUSE_RULE_MODES,
        current,
      })
    ).toEqual(current);
    expect(
      settingsPrefillOverrides({ offer: null, modes: DEFAULT_HOUSE_RULE_MODES, current })
    ).toEqual(current);
  });
});

describe("notices", () => {
  it("names the Writer's Notes file", () => {
    expect(settingsPrefillNotice(offer)).toBe(
      "Loaded from PD Writing Customized Settings.docx in Writer's Notes. Review, then save to your Writer Profile."
    );
  });

  it("names an attachment", () => {
    expect(
      settingsPrefillNotice({ ...offer, supplyPath: "attachment", fileName: "Style settings.pdf" })
    ).toBe(
      "Loaded from Style settings.pdf in an attachment. Review, then save to your Writer Profile."
    );
  });

  it("adds the truncation line", () => {
    expect(settingsPrefillNotice({ ...offer, truncated: true })).toBe(
      "Loaded from PD Writing Customized Settings.docx in Writer's Notes. Review, then save to your Writer Profile. Only the first 75,000 characters were loaded."
    );
  });

  it("has an unavailable notice", () => {
    expect(settingsPrefillUnavailableNotice).toBe(
      "That generation's settings document could not be loaded."
    );
  });
});
