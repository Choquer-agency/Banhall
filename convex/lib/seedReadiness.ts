import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  PD_SUBSECTIONS,
  type PdSubsectionRoleId,
} from "../../shared/pdSubsections";
import {
  isSeedSubsectionStale,
  type SeedSubsectionRevisionState,
} from "./seedRevisions";
import {
  ANSWER_ROLE_IDS,
  advancementLinkProblem,
  experimentsForDroppedUncertainties,
  isAnswerRole,
  isPlanRole,
  pickedLinkSelections,
  resultsForDroppedUncertainties,
  revisionRoots,
  type ExperimentTest,
  type AnswerRoleId,
  type ResultAnswers,
} from "../../shared/advancementLinks";
import {
  loadSeedDecisionState,
  type SeedDecisionReadBudget,
  type SeedDecisionReadBudgetSnapshot,
  type SeedDecisionState,
} from "./seedDecisionState";

type SeedReadCtx = Pick<QueryCtx | MutationCtx, "db">;

export type SeedReadinessBlocker = {
  code:
    | "INCOMPLETE_INPUT"
    | "REQUIRED_ROLE_UNDECIDED"
    | "OPTIONAL_ROLE_UNDECIDED"
    | "ROLE_STALE"
    | "UNLINKED_ADVANCEMENT"
    | "EXPERIMENT_FOR_DROPPED_UNCERTAINTY"
    | "RESULT_FOR_DROPPED_UNCERTAINTY"
    | "PLAN_FOR_DROPPED_UNCERTAINTY";
  roleId?: PdSubsectionRoleId;
  message: string;
};

export type SeedReadiness = {
  ready: boolean;
  complete: boolean;
  blockingRoleIds: PdSubsectionRoleId[];
  blockers: SeedReadinessBlocker[];
};

export type LoadedSeedReadiness = SeedReadiness & {
  readBudget: SeedDecisionReadBudgetSnapshot;
};

export type SeedReadinessInput = Pick<
  SeedDecisionState,
  "complete" | "subsections" | "seeds" | "selectionRows"
>;

export type ReadSeedReadinessOptions = {
  budget?: SeedDecisionReadBudget;
  maxBytes?: number;
  /** Internal mutation callers may reuse the exact transaction-local rows. */
  includeState?: boolean;
};

export type ReadSeedReadinessArgs = ReadSeedReadinessOptions & {
  generationId: Id<"generations">;
};

function roleStale(subsection: SeedSubsectionRevisionState): boolean {
  return isSeedSubsectionStale(subsection);
}

/**
 * The link rules readiness checks (FR-8; 2026-09-29 first): every selected
 * advancement links a picked uncertainty and picked experiments that tested
 * it, and no selected experiment tested an uncertainty the writer dropped.
 * 2026-09-30 (fourth): no selected Advancement to science or goal
 * improvements Seed answers an uncertainty the writer dropped. A pick whose
 * words state its result is not a blocker: approval asks the writer to
 * acknowledge it. 2026-09-30 (fifth): nor does a selected Hypothesis or Work
 * plan Seed test or plan work for one.
 */
function linkReview(input: SeedReadinessInput): {
  advancementsLinked: boolean;
  droppedUncertaintyExperiments: number;
  droppedUncertaintyResultRoles: AnswerRoleId[];
} {
  const skipped = new Set(
    input.subsections
      .filter((subsection) => subsection.state === "skipped")
      .map((subsection) => subsection.roleId)
  );
  const seeds = new Map(input.seeds.map((seed) => [seed._id, seed]));
  const uncertaintySeedIds: string[] = [];
  const experiments: ExperimentTest[] = [];
  const advancements = [];
  const results: Array<ResultAnswers & { roleId: AnswerRoleId }> = [];

  for (const selection of input.selectionRows) {
    if (!selection.selected || skipped.has(selection.roleId)) continue;
    const seed = seeds.get(selection.seedId);
    const sameDecision =
      seed !== undefined &&
      seed.generationId === selection.generationId &&
      seed.projectId === selection.projectId &&
      seed.roleId === selection.roleId;
    if (selection.roleId === "active_uncertainties" && sameDecision) {
      uncertaintySeedIds.push(selection.seedId);
    } else if (selection.roleId === "experimentation" && sameDecision) {
      experiments.push({
        seedId: selection.seedId,
        uncertaintySeedId: seed.uncertaintySeedId ?? null,
      });
    } else if (selection.roleId === "specific_advancements") {
      advancements.push(sameDecision ? seed : undefined);
    } else if (isAnswerRole(selection.roleId) && sameDecision) {
      results.push({
        roleId: selection.roleId,
        seedId: selection.seedId,
        answeredUncertaintySeedIds: seed.answeredUncertaintySeedIds ?? [],
      });
    }
  }

  // An uncertainty and its Feedback revisions are one uncertainty (review
  // P2-2); the loaded decisions carry every selected Seed's ancestors.
  const rootOf = revisionRoots(
    input.seeds.map((seed) => ({ seedId: seed._id, revisionOfSeedId: seed.revisionOfSeedId ?? null }))
  );
  const picked = pickedLinkSelections(uncertaintySeedIds, experiments, rootOf);
  return {
    advancementsLinked: advancements.every(
      (seed) => seed !== undefined && advancementLinkProblem(seed, picked) === null
    ),
    droppedUncertaintyExperiments: experimentsForDroppedUncertainties(
      picked.uncertaintySeedIds,
      experiments,
      rootOf
    ).length,
    droppedUncertaintyResultRoles: ANSWER_ROLE_IDS.filter(
      (roleId) =>
        resultsForDroppedUncertainties(
          picked.uncertaintySeedIds,
          results.filter((result) => result.roleId === roleId),
          rootOf
        ).length > 0
    ),
  };
}

/** The one pure seed-stage readiness rule shared by query and mutation callers. */
export function computeSeedReadiness(input: SeedReadinessInput): SeedReadiness {
  const blockers: SeedReadinessBlocker[] = [];
  if (!input.complete) {
    blockers.push({
      code: "INCOMPLETE_INPUT",
      message: "Seed readiness could not read the complete decision set",
    });
    return {
      ready: false,
      complete: false,
      blockingRoleIds: [],
      blockers,
    };
  }

  const subsectionByRole = new Map(
    input.subsections.map((subsection) => [subsection.roleId, subsection])
  );
  for (const role of PD_SUBSECTIONS) {
    const subsection = subsectionByRole.get(role.roleId);
    if (!subsection || subsection.kind !== role.kind) {
      blockers.push({
        code: "INCOMPLETE_INPUT",
        roleId: role.roleId,
        message: `${role.title} is missing from the seed stage`,
      });
      continue;
    }
    if (role.kind === "optional" && subsection.state === "skipped") continue;
    if (subsection.state !== "approved") {
      blockers.push({
        code:
          role.kind === "optional"
            ? "OPTIONAL_ROLE_UNDECIDED"
            : "REQUIRED_ROLE_UNDECIDED",
        roleId: role.roleId,
        message: `${role.title} must be approved${
          role.kind === "optional" ? " or skipped" : ""
        }`,
      });
      continue;
    }
    if (roleStale(subsection)) {
      blockers.push({
        code: "ROLE_STALE",
        roleId: role.roleId,
        message: `${role.title} must be reconciled with the current decisions`,
      });
    }
  }

  const links = linkReview(input);
  if (links.droppedUncertaintyExperiments > 0) {
    blockers.push({
      code: "EXPERIMENT_FOR_DROPPED_UNCERTAINTY",
      roleId: "experimentation",
      message:
        "Experimentation / Iterations has picked experiments that tested an uncertainty you no longer have picked",
    });
  }
  if (!links.advancementsLinked) {
    blockers.push({
      code: "UNLINKED_ADVANCEMENT",
      roleId: "specific_advancements",
      message:
        "Specific advancements must link a picked uncertainty and picked experiments that tested it",
    });
  }
  for (const roleId of links.droppedUncertaintyResultRoles) {
    const title = PD_SUBSECTIONS.find((role) => role.roleId === roleId)?.title ?? roleId;
    blockers.push(
      isPlanRole(roleId)
        ? {
            // 2026-09-30 (fifth).
            code: "PLAN_FOR_DROPPED_UNCERTAINTY",
            roleId,
            message:
              roleId === "hypothesis"
                ? `${title} has a picked hypothesis that tests an uncertainty you no longer have picked`
                : `${title} has a picked work plan that plans work for an uncertainty you no longer have picked`,
          }
        : {
            code: "RESULT_FOR_DROPPED_UNCERTAINTY",
            roleId,
            message: `${title} has a picked idea that answers an uncertainty you no longer have picked`,
          }
    );
  }

  const blockingRoles = new Set(
    blockers.flatMap((blocker) => (blocker.roleId ? [blocker.roleId] : []))
  );
  return {
    ready: blockers.length === 0,
    complete: input.complete,
    blockingRoleIds: PD_SUBSECTIONS.map(({ roleId }) => roleId).filter((roleId) =>
      blockingRoles.has(roleId)
    ),
    blockers,
  };
}

/** Transaction-local runtime loader. The caller performs authorization first. */
export async function readSeedReadiness(
  ctx: SeedReadCtx,
  generationOrArgs: Id<"generations"> | ReadSeedReadinessArgs,
  positionalOptions: ReadSeedReadinessOptions = {}
): Promise<LoadedSeedReadiness & { state?: SeedDecisionState }> {
  const generationId =
    typeof generationOrArgs === "string"
      ? generationOrArgs
      : generationOrArgs.generationId;
  const options =
    typeof generationOrArgs === "string" ? positionalOptions : generationOrArgs;
  const state = await loadSeedDecisionState(ctx, {
    generationId,
    ...(options.budget ? { budget: options.budget } : {}),
    ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }),
  });
  return {
    ...computeSeedReadiness(state),
    readBudget: state.budget.snapshot(),
    ...(options.includeState ? { state } : {}),
  };
}
