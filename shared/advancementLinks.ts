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
 * One pure rule for the Seed contract, approval, readiness, the step's
 * notices and the release suite. Ids are plain strings so the Convex code,
 * the app and the release suite can all use it.
 */

/** A picked experiment and the uncertainty it tested, when it records one. */
export type ExperimentTest = {
  seedId: string;
  uncertaintySeedId: string | null;
};

/** What is picked now: uncertainties, and each experiment with what it tested. */
export type PickedLinkSelections = {
  uncertaintySeedIds: ReadonlySet<string>;
  experiments: ReadonlyMap<string, string | null>;
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
  experiments: Iterable<ExperimentTest>
): PickedLinkSelections {
  return {
    uncertaintySeedIds: new Set(uncertaintySeedIds),
    experiments: new Map(
      [...experiments].map((experiment) => [experiment.seedId, experiment.uncertaintySeedId])
    ),
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
  if (!picked.uncertaintySeedIds.has(uncertainty)) return "uncertainty_not_picked";
  if (experiments.some((seedId) => !picked.experiments.has(seedId))) {
    return "experiment_not_picked";
  }
  if (
    experiments.some((seedId) => {
      const tested = picked.experiments.get(seedId);
      return !!tested && tested !== uncertainty;
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
 * advancement for it may link: those that tested it and those that record no
 * uncertainty. An uncertainty no picked experiment tested is left out, so an
 * empty list means no advancement can be linked.
 */
export function allowedAdvancementLinks(
  uncertaintySeedIds: readonly string[],
  experiments: readonly ExperimentTest[]
): AllowedAdvancementLink[] {
  const links: AllowedAdvancementLink[] = [];
  for (const uncertaintySeedId of new Set(uncertaintySeedIds)) {
    const experimentSeedIds = [
      ...new Set(
        experiments
          .filter(
            (experiment) =>
              experiment.uncertaintySeedId === null ||
              experiment.uncertaintySeedId === uncertaintySeedId
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
 * picked. An experiment that records no uncertainty is never one of them.
 */
export function experimentsForDroppedUncertainties(
  uncertaintySeedIds: ReadonlySet<string>,
  experiments: readonly ExperimentTest[]
): ExperimentTest[] {
  return experiments.filter(
    (experiment) =>
      experiment.uncertaintySeedId !== null &&
      !uncertaintySeedIds.has(experiment.uncertaintySeedId)
  );
}
