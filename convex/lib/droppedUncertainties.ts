/**
 * 2026-09-30 (first): what the writer dropped stays out of all three Lines.
 *
 * A dropped uncertainty is a Technological uncertainties Seed of the run that
 * the writer ticked, then unticked, and that the signed-off plan does not
 * hold. The untick is read from its `deselect` decision event (review P2-1):
 * a selection row with `selected: false` alone is no evidence, since editing
 * or restoring an unticked card writes one too. It is frozen on the
 * Summary at sign-off, with the wording of the run's experiments and
 * advancements that recorded it, so drafting and the Self-check can
 * recognise its content. Since 2026-09-30 (fourth), the Advancement to
 * science and goal improvements Seeds that recorded answering it go with
 * the advancements. An uncertainty the writer never ticked is not a
 * decision and is never listed.
 *
 * Two guards keep a replacement from reading as a drop: a dropped Seed in the
 * same revision chain as a kept one (a Feedback revision) is the kept one,
 * and a dropped Seed whose wording is a near copy of a kept one (see
 * NEAR_COPY_SHARE) was replaced by it.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import type { PdSubsectionRoleId } from "../../shared/pdSubsections";
import { contentWords, sharedContentWords } from "./seedQuoteSupport";
import {
  MAX_DROPPED_UNCERTAINTIES_FROZEN,
  MAX_DROPPED_UNCERTAINTY_CHECKS,
  MAX_DROPPED_UNCERTAINTY_RELATED_PER_KIND,
  materializeFinalWording,
} from "./seedRevisions";

/**
 * A dropped uncertainty is a near copy of a kept one, and so replaced by it,
 * when at least this share of the dropped one's content words appear in the
 * kept one (stop words aside, light plural and prefix matching, as the idea
 * card quote check reads them). It reads one way only (review P3-3): the
 * dropped wording contained in the kept one. A kept uncertainty that merges
 * or broadens two originals still replaces each. At 0.7 a reworded or lightly
 * edited uncertainty counts as replaced, while two uncertainties that only
 * share a topic ("seed", "degrees") do not: the run 10 seed-fraction
 * uncertainty shares under a fifth of its words with the kept acclimation one.
 */
export const NEAR_COPY_SHARE = 0.7;

/** How many of the run's experiments, and of its advancements, are read to find what recorded a dropped uncertainty. */
export const MAX_RELATED_SEEDS_SCANNED_PER_ROLE = 512;

/**
 * 2026-09-30 (fourth): how many of the run's Advancement to science Seeds,
 * and of its goal improvements Seeds, are read for the same purpose; (fifth)
 * also of its Hypothesis and Work plan Seeds. These steps pick one idea or a
 * few, so a run writes far fewer of them.
 */
export const MAX_RELATED_RESULT_SEEDS_SCANNED_PER_ROLE = 128;

/** How many `deselect` events of one step are read at sign-off. */
export const MAX_DESELECT_EVENTS_READ_PER_ROLE = 1024;

/**
 * The Seeds of one step the writer unticked at least once: each `deselect`
 * decision event names its Seed. Only the `select` mutation unticks a Seed,
 * and it always writes that event, so a Seed with one was ticked, then
 * unticked (review P2-1). Read through the event index, newest first,
 * bounded.
 */
export async function deselectedSeedIds(
  ctx: { db: QueryCtx["db"] },
  args: { generationId: Id<"generations">; roleId: PdSubsectionRoleId; limit?: number }
): Promise<Set<Id<"seeds">>> {
  const events = await ctx.db
    .query("seedDecisionEvents")
    .withIndex("by_generationId_and_roleId_and_kind_and_at", (q) =>
      q.eq("generationId", args.generationId).eq("roleId", args.roleId).eq("kind", "deselect"))
    // Review P3-B: newest first, so the latest decisions are read if the
    // bound is ever reached.
    .order("desc")
    .take(args.limit ?? MAX_DESELECT_EVENTS_READ_PER_ROLE);
  return new Set(events.flatMap((event) => (event.seedId ? [event.seedId] : [])));
}

/** Whether a dropped uncertainty's wording is a near copy of, or contained in, a kept one's. */
export function isNearCopy(dropped: readonly string[], kept: readonly string[]): boolean {
  const droppedText = dropped.join(" ");
  const keptText = kept.join(" ");
  const droppedWords = contentWords(droppedText).length;
  if (droppedWords === 0 || contentWords(keptText).length === 0) return false;
  return sharedContentWords(keptText, droppedText) / droppedWords >= NEAR_COPY_SHARE;
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
 * some point first (ticked now, or with a `deselect` event), then the rest,
 * each in the order the run wrote them. The wording is the writer's, when
 * they edited it.
 *
 * 2026-09-30 (fourth): the Advancement to science and goal improvements
 * Seeds whose `answeredUncertaintySeedIds` hold it are advancements here,
 * within the same cap: ticked first, then by step (specific advancements,
 * the most direct statements, before Advancement to science, then goal
 * improvements, review P3-3), then in the order the run wrote them. Each
 * step's newest Seeds are read (review P3-4 and its re-check), as the
 * `deselect` events are.
 *
 * 2026-09-30 (fifth): the Hypothesis and Work plan Seeds that recorded it
 * go with the experiments, within the same cap: experiments, the most direct
 * statements of the work, first, then hypotheses, then work plans. A Seed
 * with `answeredUncertaintySeedIds` (these steps and the result steps) counts
 * only when every uncertainty it records is dropped, none kept (review P2).
 * Every kind is matched by revision root (Greptile P1): a Seed that recorded
 * an earlier revision of the dropped uncertainty is its too.
 */
export async function relatedSeedsOfDropped(
  ctx: { db: QueryCtx["db"] },
  args: {
    generationId: Id<"generations">;
    projectId: Id<"projects">;
    droppedSeedIds: readonly Id<"seeds">[];
    selectionRows: readonly Doc<"seedSelections">[];
    /**
     * 2026-09-30 (fifth, review P2): the revision roots of every uncertainty
     * the writer dropped (checked or not), and how to read a Seed's root. A
     * Seed whose `answeredUncertaintySeedIds` records anything else (a kept
     * uncertainty) is not the dropped one's: a general work plan, or a result
     * for both, would put kept work in the dropped uncertainty's reference.
     * Absent: every recorded id counts, as before.
     */
    droppedRoots?: ReadonlySet<string>;
    rootOf?: (seedId: string) => string;
  }
): Promise<Map<Id<"seeds">, RelatedSeeds>> {
  const related = new Map<Id<"seeds">, RelatedSeeds>(
    args.droppedSeedIds.map((seedId) => [seedId, { experiments: [], advancements: [] }])
  );
  if (related.size === 0) return related;
  const selectionBySeed = new Map(args.selectionRows.map((row) => [row.seedId, row] as const));
  const rootOf = args.rootOf ?? ((seedId: string) => seedId);
  // Greptile P1: looked up by revision root, so a Seed that recorded an
  // earlier revision of the dropped uncertainty is found; with no rootOf,
  // every id is its own root, as before.
  const byRoot = new Map<string, RelatedSeeds>();
  for (const [seedId, entry] of related) if (!byRoot.has(rootOf(seedId))) byRoot.set(rootOf(seedId), entry);
  const recorded = (seed: Doc<"seeds">): readonly Id<"seeds">[] => {
    if (seed.roleId === "experimentation" || seed.roleId === "specific_advancements") {
      return seed.uncertaintySeedId ? [seed.uncertaintySeedId] : [];
    }
    const answered = seed.answeredUncertaintySeedIds ?? [];
    // Review P2: related only when every uncertainty it records is dropped.
    const dropped = args.droppedRoots;
    return !dropped || answered.every((seedId) => dropped.has(rootOf(seedId))) ? answered : [];
  };
  for (const [kind, roles] of [
    [
      "experiments",
      [
        ["experimentation", MAX_RELATED_SEEDS_SCANNED_PER_ROLE],
        ["hypothesis", MAX_RELATED_RESULT_SEEDS_SCANNED_PER_ROLE],
        ["workplan", MAX_RELATED_RESULT_SEEDS_SCANNED_PER_ROLE],
      ],
    ],
    [
      "advancements",
      [
        ["specific_advancements", MAX_RELATED_SEEDS_SCANNED_PER_ROLE],
        ["overall_advancement", MAX_RELATED_RESULT_SEEDS_SCANNED_PER_ROLE],
        ["goal_improvements", MAX_RELATED_RESULT_SEEDS_SCANNED_PER_ROLE],
      ],
    ],
  ] as const) {
    const candidates: Array<{ seed: Doc<"seeds">; ticked: boolean; step: number }> = [];
    for (const [step, [roleId, scanned]] of roles.entries()) {
      // Steps that pick one idea or a few read fewer Seeds and events.
      const result = roleId !== "experimentation" && roleId !== "specific_advancements";
      const query = ctx.db
        .query("seeds")
        .withIndex("by_generationId_and_roleId", (q) =>
          q.eq("generationId", args.generationId).eq("roleId", roleId));
      // Review P3-4 and its re-check: every step's newest Seeds, like its
      // deselect events.
      const seeds = await query.order("desc").take(scanned);
      const deselected = await deselectedSeedIds(ctx, {
        generationId: args.generationId,
        roleId,
        limit: result ? scanned : undefined,
      });
      for (const seed of seeds) {
        if (seed.projectId !== args.projectId || recorded(seed).length === 0) continue;
        candidates.push({
          seed,
          ticked: selectionBySeed.get(seed._id)?.selected === true || deselected.has(seed._id),
          step,
        });
      }
    }
    // Ticked first, then by step (review P3-3), then in the order the run
    // wrote them. With one step this is the earlier order: its index is in
    // creation order.
    const ordered = candidates.sort(
      (left, right) =>
        Number(right.ticked) - Number(left.ticked) ||
        left.step - right.step ||
        left.seed._creationTime - right.seed._creationTime
    );
    for (const { seed } of ordered) {
      for (const root of new Set(recorded(seed).map((seedId) => rootOf(seedId)))) {
        const entry = byRoot.get(root);
        if (!entry || entry[kind].length >= MAX_DROPPED_UNCERTAINTY_RELATED_PER_KIND) continue;
        entry[kind].push({
          seedId: seed._id,
          wording: materializeFinalWording(seed, selectionBySeed.get(seed._id)),
        });
      }
    }
  }
  return related;
}
