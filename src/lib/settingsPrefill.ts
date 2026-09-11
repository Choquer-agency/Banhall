/**
 * Story 3 (CAP-8): the settings page accepts a generation's save offer as a
 * prefill — never an auto-save. A settings document supplied as Writer's
 * Notes or an attachment loads into the preferences draft once, after the
 * saved profile has seeded the page, and the document's analysed
 * `writer_choice` waivers are pre-ticked under the Analyze flow's rule. The
 * draft becomes dirty and the writer decides whether to save. Pure: no
 * Svelte, no Convex runtime.
 */

import { MAX_INSTRUCTIONS_CHARS } from "../../shared/writerProfileLimits";
import {
  STYLE_OVERRIDE_KEYS,
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
  /** The classifier's categories at the current version; null = failed or absent. */
  addressedCategories: StyleOverrideKey[] | null;
};

/**
 * The text to prefill, or null when the profile seed is not ready, the page
 * already prefilled, there is no offer, or the offer equals the draft.
 */
export function settingsPrefillText(input: {
  seeded: boolean;
  alreadyPrefilled: boolean;
  offer: SettingsOffer | null | undefined;
  current: string;
}): string | null {
  const { seeded, alreadyPrefilled, offer, current } = input;
  if (!seeded || alreadyPrefilled || !offer) return null;
  if (offer.text.trim() === current.trim()) return null;
  return offer.text;
}

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
