import { SEED_LINK_RULES } from "./ai/promptDefinitions";

/**
 * The advancement link sentence every Seed request sent before the
 * 2026-09-28 (fourth) amendment. Pinned request bodies were captured with it.
 */
export const PINNED_ADVANCEMENT_LINK_RULES =
  " For specific advancements, when the frozen predecessor decisions include experimentation selections, every Seed must name one frozen active uncertainty in uncertaintySeedId and at least one frozen experiment in experimentSeedIds. Copy these ids exactly from the frozen decisions: uncertaintySeedId is the seedId of a selection whose roleId is active_uncertainties, and each experimentSeedIds entry is the seedId of a selection whose roleId is experimentation. When there are no frozen experiment selections, omit both link fields.";

/**
 * A request body as JSON text with the current link rules (the advancement
 * rules of the 2026-09-28 fourth amendment and the experiment rules of the
 * 2026-09-29 first) put back to the pinned sentence: the only bytes those
 * amendments changed in a request that has no FROZEN EXPERIMENT LINKS or
 * FROZEN ADVANCEMENT LINKS block.
 */
export function withPinnedAdvancementLinkRules(body: string): string {
  return body
    .split(JSON.stringify(SEED_LINK_RULES).slice(1, -1))
    .join(JSON.stringify(PINNED_ADVANCEMENT_LINK_RULES).slice(1, -1));
}
