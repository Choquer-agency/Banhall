/**
 * 2026-09-30 (fourth, review P2-1): a picked Advancement to science or goal
 * improvements idea that states a dropped uncertainty's result is refused,
 * whatever its link says.
 *
 * The link rule (RESULT_FOR_DROPPED_UNCERTAINTY) trusts the model's link, so
 * a regenerated idea could state the dropped result ("31 days at 8 C") under
 * a kept uncertainty's id, or in goal improvements with an empty list, and
 * reach Line 246 as a COVER item again (release suite run 11's failure). This
 * guard reads wording instead: a pick is refused when it holds a distinctive
 * figure of a dropped uncertainty, that is a figure with its unit found in
 * that uncertainty's wording or in the Seeds that recorded it (experiments
 * and specific advancements that name it, results that answer it) and in no
 * currently picked Seed of any step but these two. The two result steps are
 * left out of that last test so they cannot vouch for each other.
 *
 * A dropped uncertainty is read as Rule A reads it (2026-09-30 first): a
 * Technological uncertainties Seed the writer ticked, then unticked (a
 * `deselect` event), that is not picked, is not in a picked Seed's revision
 * chain and is not a near copy of a picked one. The figures come from
 * shared/planFigures.ts, the reading drafting and the release suite use.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import type { PdSubsectionRoleId } from "../../shared/pdSubsections";
import { distinctiveFigures, figuresOf } from "../../shared/planFigures";
import { isResultRole, type ResultRoleId } from "../../shared/advancementLinks";
import { pickedLinks } from "./seedApproval";
import {
  chooseDroppedUncertainties,
  deselectedSeedIds,
  MAX_RELATED_RESULT_SEEDS_SCANNED_PER_ROLE,
  MAX_RELATED_SEEDS_SCANNED_PER_ROLE,
} from "./droppedUncertainties";
import { materializeFinalWording } from "./seedRevisions";
import type { SeedDecisionState } from "./seedDecisionState";

/** One picked result that states a dropped uncertainty's result. */
export type ResultFigureConflict = {
  seedId: Id<"seeds">;
  roleId: ResultRoleId;
  droppedSeedId: Id<"seeds">;
  /** The distinctive figures the pick holds, normalised ("31 days"). */
  figures: string[];
};

/**
 * The picks that hold a distinctive figure of a dropped uncertainty. Pure.
 * `otherPicked` is the wording of every picked Seed of the other steps;
 * each dropped uncertainty carries its own wording and the wording of the
 * Seeds that recorded it.
 */
export function resultFigureConflicts<SeedId extends string>(args: {
  results: ReadonlyArray<{ seedId: SeedId; roleId: ResultRoleId; wording: readonly string[] }>;
  otherPicked: readonly string[];
  dropped: ReadonlyArray<{ seedId: SeedId; wording: readonly string[]; related: readonly string[] }>;
}): Array<{ seedId: SeedId; roleId: ResultRoleId; droppedSeedId: SeedId; figures: string[] }> {
  const conflicts: Array<{ seedId: SeedId; roleId: ResultRoleId; droppedSeedId: SeedId; figures: string[] }> = [];
  for (const dropped of args.dropped) {
    const own = new Set(distinctiveFigures([dropped.wording.join(" "), ...dropped.related], args.otherPicked));
    if (own.size === 0) continue;
    for (const result of args.results) {
      const figures = figuresOf(result.wording.join(" ")).filter((figure) => own.has(figure));
      if (figures.length > 0) {
        conflicts.push({ seedId: result.seedId, roleId: result.roleId, droppedSeedId: dropped.seedId, figures });
      }
    }
  }
  return conflicts;
}

const RELATED_ROLES: ReadonlyArray<[PdSubsectionRoleId, number]> = [
  ["experimentation", MAX_RELATED_SEEDS_SCANNED_PER_ROLE],
  ["specific_advancements", MAX_RELATED_SEEDS_SCANNED_PER_ROLE],
  ["overall_advancement", MAX_RELATED_RESULT_SEEDS_SCANNED_PER_ROLE],
  ["goal_improvements", MAX_RELATED_RESULT_SEEDS_SCANNED_PER_ROLE],
];

/**
 * The guard at Approve, Keep, readiness and the step's notice. Reads nothing
 * more than the decisions unless a picked result holds a figure no picked
 * Seed of another step uses and an uncertainty was unticked; then it reads
 * the `deselect` events of Technological uncertainties and, newest first,
 * up to 512 experiments and 512 specific advancements and 128 Seeds of each
 * result step to find the Seeds that recorded a dropped uncertainty. Empty
 * when the decisions were not read in full.
 */
export async function loadResultFigureConflicts(
  ctx: { db: QueryCtx["db"] },
  state: Pick<SeedDecisionState, "complete" | "generation" | "subsections" | "seeds" | "selectionRows">
): Promise<ResultFigureConflict[]> {
  if (!state.complete) return [];
  const links = pickedLinks(state);
  const results = links.active
    .filter((selection) => isResultRole(selection.roleId))
    .map((selection) => ({
      seedId: selection.seedId as Id<"seeds">,
      roleId: selection.roleId as ResultRoleId,
      wording: selection.bullets,
    }));
  const resultFigures = results.flatMap((result) => figuresOf(result.wording.join(" ")));
  if (resultFigures.length === 0) return [];
  const otherPicked = links.active
    .filter((selection) => !isResultRole(selection.roleId))
    .map((selection) => selection.bullets.join(" "));
  const common = new Set(otherPicked.flatMap(figuresOf));
  if (resultFigures.every((figure) => common.has(figure))) return [];

  const seeds = new Map(state.seeds.map((seed) => [seed._id as string, seed]));
  const selectionBySeed = new Map(state.selectionRows.map((row) => [row.seedId as string, row]));
  const pickedRoots = new Set(links.uncertaintySeedIds.map((seedId) => links.rootOf(seedId)));
  const unticked = state.selectionRows
    .filter((row) => row.roleId === "active_uncertainties" && !row.selected && !pickedRoots.has(links.rootOf(row.seedId)))
    .flatMap((row) => {
      const seed = seeds.get(row.seedId);
      return seed && seed.roleId === "active_uncertainties" ? [seed] : [];
    });
  if (unticked.length === 0) return [];
  const deselected = await deselectedSeedIds(ctx, {
    generationId: state.generation._id,
    roleId: "active_uncertainties",
  });
  const wordingOf = (seed: Doc<"seeds">) => materializeFinalWording(seed, selectionBySeed.get(seed._id));
  const choice = chooseDroppedUncertainties({
    unticked: unticked
      .filter((seed) => deselected.has(seed._id))
      .map((seed) => ({ seedId: seed._id, wording: wordingOf(seed) })),
    kept: links.uncertaintySeedIds.flatMap((seedId) => {
      const seed = seeds.get(seedId);
      return seed ? [{ seedId: seed._id, wording: wordingOf(seed) }] : [];
    }),
    rootOf: links.rootOf,
  });
  const dropped = [...choice.checked, ...choice.notChecked];
  if (dropped.length === 0) return [];

  const related = new Map(dropped.map((entry) => [links.rootOf(entry.seedId), [] as string[]]));
  for (const [roleId, scanned] of RELATED_ROLES) {
    const rows = await ctx.db
      .query("seeds")
      .withIndex("by_generationId_and_roleId", (q) =>
        q.eq("generationId", state.generation._id).eq("roleId", roleId))
      .order("desc")
      .take(scanned);
    for (const seed of rows) {
      if (seed.projectId !== state.generation.projectId) continue;
      const recorded = isResultRole(seed.roleId)
        ? (seed.answeredUncertaintySeedIds ?? [])
        : seed.uncertaintySeedId
          ? [seed.uncertaintySeedId]
          : [];
      for (const root of new Set(recorded.map((seedId) => links.rootOf(seedId)))) {
        related.get(root)?.push(wordingOf(seed).join(" "));
      }
    }
  }
  return resultFigureConflicts({
    results,
    otherPicked,
    dropped: dropped.map((entry) => ({
      seedId: entry.seedId,
      wording: entry.wording,
      related: related.get(links.rootOf(entry.seedId)) ?? [],
    })),
  });
}
