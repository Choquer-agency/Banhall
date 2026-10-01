/**
 * 2026-09-29 (first, owner): an advancement follows the uncertainty its
 * experiments tested.
 *
 * An experiment Seed (Subsection 9) records the uncertainty selection it
 * tested in `uncertaintySeedId`. An advancement Seed (Subsection 11) links
 * one uncertainty selection and one or more experiment selections, and it is
 * linked only when that uncertainty and those experiments are all picked and
 * every experiment it links tested that uncertainty. An experiment that
 * records no uncertainty (written before this rule, or before any
 * uncertainty was picked) may support any picked uncertainty, as before.
 *
 * An uncertainty and its revisions (Feedback revised Seeds, found through
 * `revisionOfSeedId`) are the same uncertainty here: every comparison goes
 * through `rootOf`, which names the first Seed of a revision chain. Without
 * one, ids compare exactly.
 *
 * One pure rule for the Seed contract, approval, readiness, the step's
 * notices and the release suite. Ids are plain strings so the Convex code,
 * the app and the release suite can all use it.
 */

/** A picked experiment and the uncertainty it tested, when it records one. */
export type ExperimentTest = {
  seedId: string;
  uncertaintySeedId: string | null;
};

/** Names the first Seed of an uncertainty's revision chain. */
export type UncertaintyRoot = (seedId: string) => string;

const sameId: UncertaintyRoot = (seedId) => seedId;

/**
 * The root of each Seed's revision chain, from Seeds that know their
 * parent. A Seed whose parent is not given is its own root; a chain longer
 * than the Seeds given, or a cycle, stops where it is.
 */
export function revisionRoots(
  seeds: Iterable<{ seedId: string; revisionOfSeedId?: string | null }>
): UncertaintyRoot {
  const parent = new Map<string, string>();
  for (const seed of seeds) {
    if (seed.revisionOfSeedId) parent.set(seed.seedId, seed.revisionOfSeedId);
  }
  return (seedId) => {
    let current = seedId;
    const seen = new Set<string>([current]);
    for (;;) {
      const next = parent.get(current);
      if (next === undefined || seen.has(next)) return current;
      seen.add(next);
      current = next;
    }
  };
}

/** What is picked now: uncertainties, and each experiment with what it tested. */
export type PickedLinkSelections = {
  uncertaintySeedIds: ReadonlySet<string>;
  experiments: ReadonlyMap<string, string | null>;
  rootOf: UncertaintyRoot;
  /** The roots of the picked uncertainties. */
  uncertaintyRoots: ReadonlySet<string>;
};

/**
 * Why an advancement is not linked, or null when it is.
 * - `missing`: it links no uncertainty or no experiment.
 * - `uncertainty_not_picked`: its uncertainty is not picked.
 * - `experiment_not_picked`: an experiment it links is not picked.
 * - `experiment_tested_other`: an experiment it links tested another uncertainty.
 */
export type AdvancementLinkProblem =
  | "missing"
  | "uncertainty_not_picked"
  | "experiment_not_picked"
  | "experiment_tested_other";

export function pickedLinkSelections(
  uncertaintySeedIds: Iterable<string>,
  experiments: Iterable<ExperimentTest>,
  rootOf: UncertaintyRoot = sameId
): PickedLinkSelections {
  const uncertainties = new Set(uncertaintySeedIds);
  return {
    uncertaintySeedIds: uncertainties,
    experiments: new Map(
      [...experiments].map((experiment) => [experiment.seedId, experiment.uncertaintySeedId])
    ),
    rootOf,
    uncertaintyRoots: new Set([...uncertainties].map(rootOf)),
  };
}

export function advancementLinkProblem(
  advancement: {
    uncertaintySeedId?: string | null;
    experimentSeedIds?: readonly string[] | null;
  },
  picked: PickedLinkSelections
): AdvancementLinkProblem | null {
  const uncertainty = advancement.uncertaintySeedId;
  const experiments = advancement.experimentSeedIds ?? [];
  if (!uncertainty || experiments.length === 0) return "missing";
  const root = picked.rootOf(uncertainty);
  if (!picked.uncertaintyRoots.has(root)) return "uncertainty_not_picked";
  if (experiments.some((seedId) => !picked.experiments.has(seedId))) {
    return "experiment_not_picked";
  }
  if (
    experiments.some((seedId) => {
      const tested = picked.experiments.get(seedId);
      return !!tested && picked.rootOf(tested) !== root;
    })
  ) {
    return "experiment_tested_other";
  }
  return null;
}

export type AllowedAdvancementLink = {
  uncertaintySeedId: string;
  experimentSeedIds: string[];
};

/**
 * For each picked uncertainty, in the order given, the picked experiments an
 * advancement for it may link: those that tested it (or a revision of it)
 * and those that record no uncertainty. An uncertainty no picked experiment
 * tested is left out, so an empty list means no advancement can be linked.
 */
export function allowedAdvancementLinks(
  uncertaintySeedIds: readonly string[],
  experiments: readonly ExperimentTest[],
  rootOf: UncertaintyRoot = sameId
): AllowedAdvancementLink[] {
  const links: AllowedAdvancementLink[] = [];
  for (const uncertaintySeedId of new Set(uncertaintySeedIds)) {
    const root = rootOf(uncertaintySeedId);
    const experimentSeedIds = [
      ...new Set(
        experiments
          .filter(
            (experiment) =>
              experiment.uncertaintySeedId === null ||
              rootOf(experiment.uncertaintySeedId) === root
          )
          .map((experiment) => experiment.seedId)
      ),
    ];
    if (experimentSeedIds.length > 0) links.push({ uncertaintySeedId, experimentSeedIds });
  }
  return links;
}

/**
 * Picked experiments that tested an uncertainty the writer no longer has
 * picked, in any of its revisions. An experiment that records no
 * uncertainty is never one of them.
 */
export function experimentsForDroppedUncertainties(
  uncertaintySeedIds: ReadonlySet<string>,
  experiments: readonly ExperimentTest[],
  rootOf: UncertaintyRoot = sameId
): ExperimentTest[] {
  const roots = new Set([...uncertaintySeedIds].map(rootOf));
  return experiments.filter(
    (experiment) =>
      experiment.uncertaintySeedId !== null && !roots.has(rootOf(experiment.uncertaintySeedId))
  );
}

/**
 * The picked uncertainty that stands for `seedId`: itself when picked, else
 * a picked revision or original of it, else null (it was dropped).
 */
export function pickedUncertaintyFor(
  seedId: string,
  uncertaintySeedIds: readonly string[],
  rootOf: UncertaintyRoot = sameId
): string | null {
  if (uncertaintySeedIds.includes(seedId)) return seedId;
  const root = rootOf(seedId);
  return uncertaintySeedIds.find((candidate) => rootOf(candidate) === root) ?? null;
}

/**
 * 2026-09-30 (fourth): the two steps whose Seeds state a result and record
 * the picked uncertainties they answer, in `answeredUncertaintySeedIds`:
 * Advancement to science / technology (Subsection 10) and Overall company /
 * project goal improvements (Subsection 13).
 */
export const RESULT_ROLE_IDS = ["overall_advancement", "goal_improvements"] as const;
export type ResultRoleId = (typeof RESULT_ROLE_IDS)[number];

export function isResultRole(roleId: string): roleId is ResultRoleId {
  return (RESULT_ROLE_IDS as readonly string[]).includes(roleId);
}

/**
 * 2026-09-30 (fifth): Work plan (Subsection 7) and Hypothesis (Subsection 8)
 * Seeds record the picked uncertainties they plan work for or test, in the
 * same `answeredUncertaintySeedIds`.
 */
export const PLAN_ROLE_IDS = ["workplan", "hypothesis"] as const;
export type PlanRoleId = (typeof PLAN_ROLE_IDS)[number];

export function isPlanRole(roleId: string): roleId is PlanRoleId {
  return (PLAN_ROLE_IDS as readonly string[]).includes(roleId);
}

/**
 * Every step whose Seeds record the picked uncertainties they address, in
 * step order: the plan steps (2026-09-30 fifth) and the result steps
 * (fourth). Only the result steps get the figure acknowledgement.
 */
export const ANSWER_ROLE_IDS = [...PLAN_ROLE_IDS, ...RESULT_ROLE_IDS] as const;
export type AnswerRoleId = (typeof ANSWER_ROLE_IDS)[number];

export function isAnswerRole(roleId: string): roleId is AnswerRoleId {
  return (ANSWER_ROLE_IDS as readonly string[]).includes(roleId);
}

/** A picked result Seed and the uncertainties it records answering. */
export type ResultAnswers = {
  seedId: string;
  answeredUncertaintySeedIds: readonly string[];
};

/**
 * 2026-09-30 (fourth): picked results that answer an uncertainty the writer
 * no longer has picked, in any of its revisions. A result that records no
 * uncertainty (written before this rule, or a goal restatement) is never
 * one of them.
 */
export function resultsForDroppedUncertainties(
  uncertaintySeedIds: ReadonlySet<string>,
  results: readonly ResultAnswers[],
  rootOf: UncertaintyRoot = sameId
): ResultAnswers[] {
  const roots = new Set([...uncertaintySeedIds].map(rootOf));
  return results.filter((result) =>
    result.answeredUncertaintySeedIds.some((seedId) => !roots.has(rootOf(seedId)))
  );
}
