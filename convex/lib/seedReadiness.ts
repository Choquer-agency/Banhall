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
    | "UNLINKED_ADVANCEMENT";
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
};

export type ReadSeedReadinessArgs = ReadSeedReadinessOptions & {
  generationId: Id<"generations">;
};

function roleStale(subsection: SeedSubsectionRevisionState): boolean {
  return isSeedSubsectionStale(subsection);
}

function advancementReferencesAreLinked(input: SeedReadinessInput): boolean {
  const skipped = new Set(
    input.subsections
      .filter((subsection) => subsection.state === "skipped")
      .map((subsection) => subsection.roleId)
  );
  const seeds = new Map(input.seeds.map((seed) => [seed._id, seed]));
  const activeUncertainties = new Set<Id<"seeds">>();
  const activeExperiments = new Set<Id<"seeds">>();
  const advancements = [];

  for (const selection of input.selectionRows) {
    if (!selection.selected || skipped.has(selection.roleId)) continue;
    const seed = seeds.get(selection.seedId);
    const sameDecision =
      seed !== undefined &&
      seed.generationId === selection.generationId &&
      seed.projectId === selection.projectId &&
      seed.roleId === selection.roleId;
    if (selection.roleId === "active_uncertainties" && sameDecision) {
      activeUncertainties.add(selection.seedId);
    } else if (selection.roleId === "experimentation" && sameDecision) {
      activeExperiments.add(selection.seedId);
    } else if (selection.roleId === "specific_advancements") {
      advancements.push(sameDecision ? seed : undefined);
    }
  }

  return advancements.every(
    (seed) =>
      seed !== undefined &&
      seed.uncertaintySeedId !== undefined &&
      activeUncertainties.has(seed.uncertaintySeedId) &&
      seed.experimentSeedIds !== undefined &&
      seed.experimentSeedIds.length > 0 &&
      seed.experimentSeedIds.every((seedId) => activeExperiments.has(seedId))
  );
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

  if (!advancementReferencesAreLinked(input)) {
    blockers.push({
      code: "UNLINKED_ADVANCEMENT",
      roleId: "specific_advancements",
      message:
        "Specific advancements must reference active uncertainty and experimentation selections",
    });
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
): Promise<LoadedSeedReadiness> {
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
  };
}
