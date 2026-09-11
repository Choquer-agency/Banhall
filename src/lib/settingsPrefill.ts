/**
 * Story 3 (CAP-8): the settings page accepts a generation's save offer as a
 * prefill — never an auto-save. A settings document supplied as Writer's
 * Notes or an attachment loads into the preferences draft once per
 * `?fromGeneration`, after the saved profile has seeded the page, and the
 * document's analysed `writer_choice` waivers are pre-ticked under the
 * Analyze flow's rule. The draft becomes dirty and the writer decides whether
 * to save. Pure: no Svelte, no Convex runtime. `settingsPrefillDecision` is
 * the one place the page's prefill is decided.
 */

import { MAX_INSTRUCTIONS_CHARS } from "../../shared/writerProfileLimits";
import {
  STYLE_OVERRIDE_KEYS,
  styleOverridesEqual,
  type HouseRuleModes,
  type StyleOverrideKey,
  type StyleOverrides,
} from "../../shared/styleOverrides";
import { settingsSupplyLabel } from "../../convex/lib/settingsDocument";

export type SettingsOffer = {
  supplyPath: "writer_notes" | "attachment";
  fileName: string;
  text: string;
  truncated: boolean;
  /** The categories recorded when the generation resolved; null = failed or absent. */
  addressedCategories: StyleOverrideKey[] | null;
};

/**
 * `current` with every analysed category the org leaves to the writer
 * (`writer_choice`) turned on — the Analyze flow's rule. Never turns a
 * waiver off, never touches a governed category, and leaves `current`
 * unchanged when the analysis failed or is absent.
 */
export function settingsPrefillOverrides(input: {
  offer: SettingsOffer | null | undefined;
  modes: HouseRuleModes;
  current: StyleOverrides;
}): StyleOverrides {
  const { offer, modes, current } = input;
  const next = { ...current };
  const addressed = new Set(offer?.addressedCategories ?? []);
  for (const key of STYLE_OVERRIDE_KEYS) {
    if (addressed.has(key) && modes[key] === "writer_choice") next[key] = true;
  }
  return next;
}

/** The one-line notice shown under a prefilled draft. */
export function settingsPrefillNotice(offer: SettingsOffer): string {
  const loaded = `Loaded from ${offer.fileName} ${settingsSupplyLabel(offer.supplyPath)}. Review, then save to your Writer Profile.`;
  return offer.truncated
    ? `${loaded} Only the first ${MAX_INSTRUCTIONS_CHARS.toLocaleString("en-US")} characters were loaded.`
    : loaded;
}

/** Shown when `?fromGeneration` names no loadable settings document. */
export const settingsPrefillUnavailableNotice =
  "That generation's settings document could not be loaded.";

/** Shown when the draft already held unsaved edits. */
export const settingsPrefillKeptEditsNotice =
  "Your unsaved edits were kept; the settings document was not loaded.";

export type SettingsPrefillDecision =
  | { kind: "idle" }
  | { kind: "wait" }
  | { kind: "unavailable"; notice: string }
  | { kind: "kept-edits"; notice: string }
  | { kind: "unchanged" }
  | { kind: "apply"; text: string; overrides: StyleOverrides; notice: string };

export type SettingsPrefillInput = {
  /** The `?fromGeneration` value, or null when absent. */
  fromGeneration: string | null | undefined;
  /** The `fromGeneration` value a decision was last taken for. */
  prefilledFor: string | null;
  /** The saved profile has seeded the draft. */
  seeded: boolean;
  modesLoaded: boolean;
  profileError: unknown;
  modesError: unknown;
  query: { data: { offer: SettingsOffer | null } | null | undefined; error: unknown };
  /** The draft already differs from the seed. */
  userEdited: boolean;
  currentText: string;
  currentOverrides: StyleOverrides;
  modes: HouseRuleModes;
};

function isError(value: unknown): boolean {
  return value !== undefined && value !== null && value !== false;
}

/**
 * What the settings page does with `?fromGeneration`. Every result except
 * `idle` and `wait` is taken once per `fromGeneration` value: the page then
 * records `prefilledFor = fromGeneration`, so a later value is decided again.
 */
export function settingsPrefillDecision(input: SettingsPrefillInput): SettingsPrefillDecision {
  const { fromGeneration, prefilledFor, query } = input;
  if (!fromGeneration || prefilledFor === fromGeneration) return { kind: "idle" };
  if (isError(input.profileError) || isError(input.modesError) || isError(query.error)) {
    return { kind: "unavailable", notice: settingsPrefillUnavailableNotice };
  }
  if (!input.seeded || !input.modesLoaded || query.data === undefined) return { kind: "wait" };
  const offer = query.data?.offer ?? null;
  if (!offer) return { kind: "unavailable", notice: settingsPrefillUnavailableNotice };
  if (input.userEdited) return { kind: "kept-edits", notice: settingsPrefillKeptEditsNotice };
  const overrides = settingsPrefillOverrides({
    offer,
    modes: input.modes,
    current: input.currentOverrides,
  });
  if (
    offer.text.trim() === input.currentText.trim() &&
    styleOverridesEqual(overrides, input.currentOverrides)
  ) {
    return { kind: "unchanged" };
  }
  return { kind: "apply", text: offer.text, overrides, notice: settingsPrefillNotice(offer) };
}
