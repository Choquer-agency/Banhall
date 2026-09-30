/**
 * 2026-09-30 (fourth, review P2-1 and its re-check): an Advancement to
 * science or goal improvements pick whose words state a result of an
 * uncertainty the writer dropped is shown at approval, and approval needs the
 * writer's acknowledgement, as a Claim Exclusion match does
 * (buildSeedApprovalChallenge). It is never refused for its words: the link
 * rule (RESULT_FOR_DROPPED_UNCERTAINTY) still refuses a pick whose
 * `answeredUncertaintySeedIds` records a dropped uncertainty.
 *
 * The figures are a dropped uncertainty's results, read by the one rule the
 * product and the release suite share (droppedUncertaintyFigures in
 * shared/planFigures.ts): the figures of the Seeds that recorded it and that
 * the writer ticked at some point (ticked now, or with a `deselect` event),
 * never of Seeds nobody ticked and never of the uncertainty's own wording
 * (its test conditions), less every figure a picked Seed states that records
 * no dropped uncertainty and is not itself refused, the goal, objective and
 * hypothesis included. The two result steps never vouch for each other.
 *
 * A dropped uncertainty is read as Rule A reads it (2026-09-30 first):
 * ticked, then unticked (a `deselect` event), not picked, not in a picked
 * Seed's revision chain and not a near copy of a picked one.
 *
 * Only the approval challenge of step 10 or 13 calls it. It reads nothing
 * beyond the decisions unless a pick of the step states a figure and an
 * uncertainty was unticked; then it reads `deselect` events through the
 * decisions' read budget, newest first and bounded.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import type { PdSubsectionRoleId } from "../../shared/pdSubsections";
import { droppedUncertaintyFigures, figuresOf } from "../../shared/planFigures";
import {
  advancementLinkProblem,
  isResultRole,
  pickedLinkSelections,
  revisionRoots,
} from "../../shared/advancementLinks";
import { domainError } from "./contracts";
import { chooseDroppedUncertainties, MAX_DESELECT_EVENTS_READ_PER_ROLE } from "./droppedUncertainties";
import { materializeFinalWording } from "./seedRevisions";
import { materializeActiveSelections, type SeedDecisionState } from "./seedDecisionState";

/** One pick of step 10 or 13 whose words state a dropped uncertainty's result. */
export type DroppedResultFigure = {
  seedId: Id<"seeds">;
  /** The figures it states, normalised ("31 days"), in the order found. */
  figures: string[];
  /** The dropped uncertainties those figures are results of. */
  uncertaintySeedIds: Id<"seeds">[];
  /** Their first bullets, in the same order. */
  uncertainties: string[];
};

/**
 * The picks whose words state a figure of a dropped uncertainty's results.
 * Pure. `kept` is the wording of every picked Seed that may vouch for a
 * figure; each dropped uncertainty carries the wording of its outcomes.
 */
export function droppedResultFigures<SeedId extends string>(args: {
  picks: ReadonlyArray<{ seedId: SeedId; wording: readonly string[] }>;
  kept: ReadonlyArray<readonly string[]>;
  dropped: ReadonlyArray<{ seedId: SeedId; outcomes: ReadonlyArray<{ wording: readonly string[] }> }>;
}): Array<{ seedId: SeedId; figures: string[]; uncertaintySeedIds: SeedId[] }> {
  const results = new Map<SeedId, { figures: string[]; uncertaintySeedIds: SeedId[] }>();
  for (const dropped of args.dropped) {
    if (dropped.outcomes.length === 0) continue;
    const figures = new Set(
      droppedUncertaintyFigures({ wording: [], references: dropped.outcomes, planWording: args.kept })
    );
    if (figures.size === 0) continue;
    for (const pick of args.picks) {
      const stated = figuresOf(pick.wording.join(" ")).filter((figure) => figures.has(figure));
      if (stated.length === 0) continue;
      const entry = results.get(pick.seedId) ?? { figures: [], uncertaintySeedIds: [] };
      for (const figure of stated) if (!entry.figures.includes(figure)) entry.figures.push(figure);
      entry.uncertaintySeedIds.push(dropped.seedId);
      results.set(pick.seedId, entry);
    }
  }
  return args.picks.flatMap((pick) => {
    const entry = results.get(pick.seedId);
    return entry ? [{ seedId: pick.seedId, ...entry }] : [];
  });
}

/** The Seeds of one step the writer unticked, through the decisions' budget. */
async function unticked(
  ctx: { db: QueryCtx["db"] },
  state: Pick<SeedDecisionState, "generation" | "budget">,
  roleId: PdSubsectionRoleId
): Promise<Set<string>> {
  const read = await state.budget.list(
    ctx.db
      .query("seedDecisionEvents")
      .withIndex("by_generationId_and_roleId_and_kind_and_at", (q) =>
        q.eq("generationId", state.generation._id).eq("roleId", roleId).eq("kind", "deselect"))
      .order("desc"),
    MAX_DESELECT_EVENTS_READ_PER_ROLE
  );
  // Past the row cap only the oldest unticks go unread, as at sign-off; a
  // budget that runs out is a processing limit, as for Claim Exclusions.
  if (!read.complete && read.stoppedBy !== "rows") {
    domainError("INVALID_INPUT", `Seed approval for ${roleId} exceeds the read budget`, {
      reason: "SEED_PROCESSING_LIMIT",
      roleId,
    });
  }
  return new Set(read.rows.flatMap((event) => (event.seedId ? [event.seedId as string] : [])));
}

const OUTCOME_ROLES: ReadonlySet<PdSubsectionRoleId> = new Set([
  "experimentation",
  "specific_advancements",
  "overall_advancement",
  "goal_improvements",
]);

/**
 * For the approval challenge of step 10 or 13: its picks that state a
 * dropped uncertainty's result, with the figures and the uncertainties'
 * words. Empty for any other step and when nothing was dropped.
 */
export async function loadDroppedResultFigures(
  ctx: { db: QueryCtx["db"] },
  state: SeedDecisionState,
  roleId: PdSubsectionRoleId
): Promise<DroppedResultFigure[]> {
  if (!isResultRole(roleId) || !state.complete) return [];
  const active = materializeActiveSelections(state);
  const seeds = new Map(state.seeds.map((seed) => [seed._id as string, seed]));
  const rowBySeed = new Map(state.selectionRows.map((row) => [row.seedId as string, row]));
  const stepPicks = active.filter((selection) => selection.roleId === roleId);
  if (!stepPicks.some((pick) => figuresOf(pick.bullets.join(" ")).length > 0)) return [];

  const rootOf = revisionRoots(state.seeds.map((seed) => ({ seedId: seed._id, revisionOfSeedId: seed.revisionOfSeedId ?? null })));
  const pickedUncertainties = active.filter((selection) => selection.roleId === "active_uncertainties").map((selection) => selection.seedId);
  const pickedRoots = new Set(pickedUncertainties.map(rootOf));
  const untickedUncertainties = state.selectionRows.filter(
    (row) => row.roleId === "active_uncertainties" && !row.selected && !pickedRoots.has(rootOf(row.seedId))
  );
  if (untickedUncertainties.length === 0) return [];
  const wordingOf = (seed: Doc<"seeds">) => materializeFinalWording(seed, rowBySeed.get(seed._id));
  const deselected = await unticked(ctx, state, "active_uncertainties");
  const choice = chooseDroppedUncertainties({
    unticked: untickedUncertainties.flatMap((row) => {
      const seed = seeds.get(row.seedId);
      return seed && deselected.has(seed._id) ? [{ seedId: seed._id, wording: wordingOf(seed) }] : [];
    }),
    kept: pickedUncertainties.flatMap((seedId) => {
      const seed = seeds.get(seedId);
      return seed ? [{ seedId: seed._id, wording: wordingOf(seed) }] : [];
    }),
    rootOf,
  });
  const dropped = [...choice.checked, ...choice.notChecked];
  if (dropped.length === 0) return [];
  const droppedRoots = new Set(dropped.map((entry) => rootOf(entry.seedId)));
  const recordedRoots = (seed: Doc<"seeds"> | undefined): string[] =>
    !seed
      ? []
      : (isResultRole(seed.roleId)
          ? (seed.answeredUncertaintySeedIds ?? [])
          : seed.uncertaintySeedId && (seed.roleId === "experimentation" || seed.roleId === "specific_advancements")
            ? [seed.uncertaintySeedId]
            : []
        ).map(rootOf);
  const recordsDropped = (seed: Doc<"seeds"> | undefined) => recordedRoots(seed).some((root) => droppedRoots.has(root));

  // A picked advancement that is not linked is refused, so it vouches for nothing.
  const picked = pickedLinkSelections(
    pickedUncertainties,
    active
      .filter((selection) => selection.roleId === "experimentation")
      .map((selection) => ({ seedId: selection.seedId, uncertaintySeedId: selection.uncertaintySeedId ?? null })),
    rootOf
  );
  const refused = (seed: Doc<"seeds"> | undefined) =>
    recordsDropped(seed) || (seed?.roleId === "specific_advancements" && advancementLinkProblem(seed, picked) !== null);
  const kept = active
    .filter((selection) => !isResultRole(selection.roleId) && !refused(seeds.get(selection.seedId)))
    .map((selection) => selection.bullets);

  // Outcomes: Seeds that recorded a dropped uncertainty and were ticked at
  // some point. Every Seed with a selection row is in the decisions.
  const outcomeRows = state.selectionRows.filter((row) => OUTCOME_ROLES.has(row.roleId) && recordsDropped(seeds.get(row.seedId)));
  const untickedByRole = new Map<PdSubsectionRoleId, Set<string>>();
  const outcomes = new Map<string, Array<{ wording: string[] }>>(dropped.map((entry) => [rootOf(entry.seedId), []]));
  for (const row of outcomeRows) {
    if (!row.selected) {
      if (!untickedByRole.has(row.roleId)) untickedByRole.set(row.roleId, await unticked(ctx, state, row.roleId));
      if (!untickedByRole.get(row.roleId)!.has(row.seedId)) continue;
    }
    const seed = seeds.get(row.seedId)!;
    for (const root of new Set(recordedRoots(seed))) outcomes.get(root)?.push({ wording: wordingOf(seed) });
  }

  const found = droppedResultFigures({
    picks: stepPicks
      .filter((pick) => !recordsDropped(seeds.get(pick.seedId)))
      .map((pick) => ({ seedId: pick.seedId as Id<"seeds">, wording: pick.bullets })),
    kept,
    dropped: dropped.map((entry) => ({ seedId: entry.seedId, outcomes: outcomes.get(rootOf(entry.seedId)) ?? [] })),
  });
  const words = new Map(dropped.map((entry) => [entry.seedId as string, entry.wording[0] ?? ""]));
  return found.map((entry) => ({
    ...entry,
    uncertainties: entry.uncertaintySeedIds.map((seedId) => words.get(seedId) ?? ""),
  }));
}
