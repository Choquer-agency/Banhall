/**
 * 2026-09-30 (first): what the writer dropped stays out of all three Lines.
 *
 * A dropped uncertainty is a Technological uncertainties Seed of the run that
 * the writer ticked, then unticked (its selection row is `selected: false` at
 * sign-off), and that the signed-off plan does not hold. It is frozen on the
 * Summary at sign-off, with the wording of the run's experiments and
 * advancements that recorded it, so drafting and the Self-check can
 * recognise its content. An uncertainty the writer never ticked is not a
 * decision and is never listed.
 *
 * Two guards keep a replacement from reading as a drop: a dropped Seed in the
 * same revision chain as a kept one (a Feedback revision) is the kept one,
 * and a dropped Seed whose wording is a near copy of a kept one (see
 * NEAR_COPY_SHARE) was replaced by it.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { contentWords, sharedContentWords } from "./seedQuoteSupport";
import {
  MAX_DROPPED_UNCERTAINTIES_FROZEN,
  MAX_DROPPED_UNCERTAINTY_CHECKS,
  MAX_DROPPED_UNCERTAINTY_RELATED_PER_KIND,
  materializeFinalWording,
} from "./seedRevisions";

/**
 * A dropped uncertainty is a near copy of a kept one when at least this share
 * of each one's content words appear in the other (stop words aside, light
 * plural and prefix matching, as the idea card quote check reads them). At
 * 0.7 a reworded or lightly edited uncertainty counts as replaced, while two
 * uncertainties that only share a topic ("seed", "degrees") do not: the run 10
 * seed-fraction uncertainty shares under a fifth of its words with the kept
 * acclimation one.
 */
export const NEAR_COPY_SHARE = 0.7;

/** How many of the run's experiments, and of its advancements, are read to find what recorded a dropped uncertainty. */
export const MAX_RELATED_SEEDS_SCANNED_PER_ROLE = 512;

/** Whether a dropped uncertainty's wording is a near copy of a kept one's. */
export function isNearCopy(dropped: readonly string[], kept: readonly string[]): boolean {
  const droppedText = dropped.join(" ");
  const keptText = kept.join(" ");
  const droppedWords = contentWords(droppedText).length;
  const keptWords = contentWords(keptText).length;
  if (droppedWords === 0 || keptWords === 0) return false;
  return (
    sharedContentWords(keptText, droppedText) / droppedWords >= NEAR_COPY_SHARE &&
    sharedContentWords(droppedText, keptText) / keptWords >= NEAR_COPY_SHARE
  );
}

export type DroppedUncertaintyChoice<SeedId extends string = string> = {
  /** At most MAX_DROPPED_UNCERTAINTY_CHECKS, in Shown Set order: each is left out and checked in every Line. */
  checked: Array<{ seedId: SeedId; wording: string[] }>;
  /** The rest, up to MAX_DROPPED_UNCERTAINTIES_FROZEN in all: named in the Compliance Note as not checked. */
  notChecked: Array<{ seedId: SeedId; wording: string[] }>;
};

/**
 * Which unticked uncertainties are dropped. `unticked` is in Shown Set order;
 * `rootOf` names a Seed's revision root (itself when it has none). A Seed the
 * plan holds, one in a kept Seed's revision chain, a near copy of a kept one,
 * or a second Seed of a revision chain already listed is not listed.
 */
export function chooseDroppedUncertainties<SeedId extends string>(args: {
  unticked: ReadonlyArray<{ seedId: SeedId; wording: readonly string[] }>;
  kept: ReadonlyArray<{ seedId: SeedId; wording: readonly string[] }>;
  rootOf: (seedId: string) => string;
}): DroppedUncertaintyChoice<SeedId> {
  const keptIds = new Set<string>(args.kept.map((item) => item.seedId));
  const keptRoots = new Set(args.kept.map((item) => args.rootOf(item.seedId)));
  const listedRoots = new Set<string>();
  const listed: Array<{ seedId: SeedId; wording: string[] }> = [];
  for (const candidate of args.unticked) {
    if (keptIds.has(candidate.seedId)) continue;
    const root = args.rootOf(candidate.seedId);
    if (keptRoots.has(root) || listedRoots.has(root)) continue;
    if (args.kept.some((item) => isNearCopy(candidate.wording, item.wording))) continue;
    listedRoots.add(root);
    listed.push({ seedId: candidate.seedId, wording: [...candidate.wording] });
    if (listed.length >= MAX_DROPPED_UNCERTAINTIES_FROZEN) break;
  }
  return {
    checked: listed.slice(0, MAX_DROPPED_UNCERTAINTY_CHECKS),
    notChecked: listed.slice(MAX_DROPPED_UNCERTAINTY_CHECKS),
  };
}

/** The experiments and advancements that recorded one dropped uncertainty, as frozen. */
export type RelatedSeeds = {
  experiments: Array<{ seedId: Id<"seeds">; wording: string[] }>;
  advancements: Array<{ seedId: Id<"seeds">; wording: string[] }>;
};

/**
 * The run's experiments and advancements that recorded each dropped
 * uncertainty (`uncertaintySeedId` equal to it), at most
 * MAX_DROPPED_UNCERTAINTY_RELATED_PER_KIND of each: Seeds the writer ticked at
 * some point first, then the rest, each in the order the run wrote them. The
 * wording is the writer's, when they edited it.
 */
export async function relatedSeedsOfDropped(
  ctx: { db: QueryCtx["db"] },
  args: {
    generationId: Id<"generations">;
    projectId: Id<"projects">;
    droppedSeedIds: readonly Id<"seeds">[];
    selectionRows: readonly Doc<"seedSelections">[];
  }
): Promise<Map<Id<"seeds">, RelatedSeeds>> {
  const related = new Map<Id<"seeds">, RelatedSeeds>(
    args.droppedSeedIds.map((seedId) => [seedId, { experiments: [], advancements: [] }])
  );
  if (related.size === 0) return related;
  const selectionBySeed = new Map(args.selectionRows.map((row) => [row.seedId, row] as const));
  for (const [roleId, kind] of [
    ["experimentation", "experiments"],
    ["specific_advancements", "advancements"],
  ] as const) {
    const seeds = await ctx.db
      .query("seeds")
      .withIndex("by_generationId_and_roleId", (q) =>
        q.eq("generationId", args.generationId).eq("roleId", roleId))
      .take(MAX_RELATED_SEEDS_SCANNED_PER_ROLE);
    const ordered = seeds
      .filter((seed) => seed.projectId === args.projectId && seed.uncertaintySeedId !== undefined)
      .map((seed, index) => ({ seed, index, ticked: selectionBySeed.has(seed._id) }))
      .sort((left, right) => Number(right.ticked) - Number(left.ticked) || left.index - right.index);
    for (const { seed } of ordered) {
      const entry = related.get(seed.uncertaintySeedId!);
      if (!entry || entry[kind].length >= MAX_DROPPED_UNCERTAINTY_RELATED_PER_KIND) continue;
      entry[kind].push({
        seedId: seed._id,
        wording: materializeFinalWording(seed, selectionBySeed.get(seed._id)),
      });
    }
  }
  return related;
}
