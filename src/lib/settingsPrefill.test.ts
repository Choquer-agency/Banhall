import { describe, expect, it } from "vitest";
import {
  settingsPrefillDecision,
  settingsPrefillKeptEditsNotice,
  settingsPrefillNotice,
  settingsPrefillOverrides,
  settingsPrefillUnavailableNotice,
  type SettingsOffer,
  type SettingsPrefillInput,
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

function input(overrides: Partial<SettingsPrefillInput> = {}): SettingsPrefillInput {
  return {
    fromGeneration: "generation-1",
    prefilledFor: null,
    seeded: true,
    modesLoaded: true,
    profileError: undefined,
    modesError: undefined,
    query: { data: { offer }, error: undefined },
    userEdited: false,
    currentText: "Old profile.",
    currentOverrides: NO_STYLE_OVERRIDES,
    modes: DEFAULT_HOUSE_RULE_MODES,
    ...overrides,
  };
}

describe("settingsPrefillDecision", () => {
  it("idle with no fromGeneration, or once it was decided", () => {
    expect(settingsPrefillDecision(input({ fromGeneration: null }))).toEqual({ kind: "idle" });
    expect(settingsPrefillDecision(input({ fromGeneration: "" }))).toEqual({ kind: "idle" });
    expect(settingsPrefillDecision(input({ prefilledFor: "generation-1" }))).toEqual({ kind: "idle" });
  });

  it("decides again for a new fromGeneration after an earlier one was decided", () => {
    expect(
      settingsPrefillDecision(input({ fromGeneration: "generation-2", prefilledFor: "generation-1" }))
    ).toMatchObject({ kind: "apply", text: offer.text });
  });

  it("unavailable on a profile, modes or query error, even while other reads are pending", () => {
    for (const failing of [
      { profileError: new Error("profile") },
      { modesError: new Error("modes") },
      { query: { data: undefined, error: new Error("not found") } },
    ]) {
      expect(settingsPrefillDecision(input({ seeded: false, modesLoaded: false, ...failing }))).toEqual({
        kind: "unavailable",
        notice: settingsPrefillUnavailableNotice,
      });
    }
  });

  it("waits for the seed, the modes and the query", () => {
    expect(settingsPrefillDecision(input({ seeded: false }))).toEqual({ kind: "wait" });
    expect(settingsPrefillDecision(input({ modesLoaded: false }))).toEqual({ kind: "wait" });
    expect(settingsPrefillDecision(input({ query: { data: undefined, error: undefined } }))).toEqual({
      kind: "wait",
    });
  });

  it("unavailable when the query gives null or no offer", () => {
    for (const data of [null, { offer: null }]) {
      expect(settingsPrefillDecision(input({ query: { data, error: undefined } }))).toEqual({
        kind: "unavailable",
        notice: settingsPrefillUnavailableNotice,
      });
    }
  });

  it("keeps unsaved edits and says so", () => {
    expect(settingsPrefillDecision(input({ userEdited: true }))).toEqual({
      kind: "kept-edits",
      notice: "Your unsaved edits were kept; the settings document was not loaded.",
    });
    expect(settingsPrefillKeptEditsNotice).toBe(
      "Your unsaved edits were kept; the settings document was not loaded."
    );
  });

  it("unchanged, with no notice, when the text and the resulting overrides equal the draft", () => {
    const ticked = { ...NO_STYLE_OVERRIDES, bannedWords: true, paragraphDensity: true, reportSkeleton: true };
    expect(
      settingsPrefillDecision(input({ currentText: `  ${offer.text}\n`, currentOverrides: ticked }))
    ).toEqual({ kind: "unchanged" });
    // Same text, but the waivers still need ticking: apply.
    expect(settingsPrefillDecision(input({ currentText: offer.text }))).toMatchObject({
      kind: "apply",
      overrides: ticked,
    });
  });

  it("applies the text, the pre-ticked writer_choice waivers and the notice", () => {
    const modes = { ...DEFAULT_HOUSE_RULE_MODES, reportSkeleton: "enforced" as const };
    expect(settingsPrefillDecision(input({ modes }))).toEqual({
      kind: "apply",
      text: offer.text,
      overrides: { ...NO_STYLE_OVERRIDES, bannedWords: true, paragraphDensity: true },
      notice:
        "Loaded from PD Writing Customized Settings.docx in Writer's Notes. Review, then save to your Writer Profile.",
    });
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

  it("leaves the toggles as they are when the categories are null or there is no offer", () => {
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
      settingsPrefillNotice({ ...offer, supplyPath: "attachment", fileName: "Writing settings.pdf" })
    ).toBe(
      "Loaded from Writing settings.pdf in an attachment. Review, then save to your Writer Profile."
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
