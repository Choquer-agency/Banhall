import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  PD_SUBSECTIONS,
  type PdSubsectionRoleId,
} from "../../shared/pdSubsections";
import { domainError } from "./contracts";
import { createReadBudget } from "./readBudget";
import {
  buildCompleteDecisionSnapshot,
  materializeFinalWording,
  type MaterializedSeedFeedback,
  type MaterializedSeedSelection,
  type MaterializedSeedTarget,
  type SeedContextSnapshot,
} from "./seedRevisions";

export const SEED_DECISION_READ_BYTES = 8 * 1024 * 1024;

export type SeedDecisionReadBudget = ReturnType<typeof createReadBudget>;
export type SeedDecisionReadBudgetSnapshot = ReturnType<
  SeedDecisionReadBudget["snapshot"]
>;

type SeedReadCtx = Pick<QueryCtx | MutationCtx, "db">;

export type SeedDecisionState = {
  generation: Doc<"generations">;
  subsections: Doc<"seedSubsections">[];
  seeds: Doc<"seeds">[];
  selectionRows: Doc<"seedSelections">[];
  feedbackRows: Doc<"seedFeedbackRequests">[];
  batches: Doc<"seedBatches">[];
  complete: boolean;
  budget: SeedDecisionReadBudget;
  readBudget: SeedDecisionReadBudgetSnapshot;
};

export type LoadSeedDecisionStateArgs = {
  generationId: Id<"generations">;
  /** The caller owns authorization and can share this budget with later joins. */
  budget?: SeedDecisionReadBudget;
  /** Test-only/specialized override; production callers use the shared 8 MiB default. */
  maxBytes?: number;
  requireComplete?: boolean;
  /** Names the affected role in a processing-limit error. */
  roleId?: PdSubsectionRoleId;
};

function processingLimit(args: LoadSeedDecisionStateArgs): never {
  const scope = args.roleId ? ` for ${args.roleId}` : "";
  domainError(
    "INVALID_INPUT",
    `Seed decisions${scope} exceed the safe transaction read budget`,
    {
      reason: "SEED_PROCESSING_LIMIT",
      ...(args.roleId ? { roleId: args.roleId } : {}),
    }
  );
}

/**
 * Load decision-owned state through one transaction-local byte budget.
 *
 * Authorization deliberately stays with the public caller. This loader is
 * read-only and imports neither the registered seed API nor generations.
 * Historical Seeds and Batches remain paginated reader concerns: only rows
 * referenced by selections, feedback, or the thirteen live subsection rows
 * are point-read here.
 */
export async function loadSeedDecisionState(
  ctx: SeedReadCtx,
  args: LoadSeedDecisionStateArgs
): Promise<SeedDecisionState> {
  const budget =
    args.budget ??
    createReadBudget({ maxBytes: args.maxBytes ?? SEED_DECISION_READ_BYTES });
  const generationRead = await budget.one(() => ctx.db.get(args.generationId));
  if (generationRead.kind === "not-loaded") processingLimit(args);
  const generation = generationRead.value;
  if (!generation) {
    domainError("NOT_FOUND", "Seed generation not found");
  }

  let complete = true;
  const subsectionRead = await budget.list(
    ctx.db
      .query("seedSubsections")
      .withIndex("by_generationId", (q) =>
        q.eq("generationId", args.generationId)
      ),
    PD_SUBSECTIONS.length + 1
  );
  complete &&= subsectionRead.complete;
  const subsections = subsectionRead.rows;
  if (subsections.length > PD_SUBSECTIONS.length) {
    domainError("INVALID_STATE", "Seed stage has duplicate subsection rows");
  }
  if (new Set(subsections.map((row) => row.roleId)).size !== subsections.length) {
    domainError("INVALID_STATE", "Seed stage has duplicate subsection rows");
  }

  const selectionRows: Doc<"seedSelections">[] = [];
  const feedbackRows: Doc<"seedFeedbackRequests">[] = [];
  for (const { roleId } of PD_SUBSECTIONS) {
    const selections = await budget.list(
      ctx.db
        .query("seedSelections")
        .withIndex("by_generationId_and_roleId", (q) =>
          q.eq("generationId", args.generationId).eq("roleId", roleId)
        ),
      Number.MAX_SAFE_INTEGER
    );
    selectionRows.push(...selections.rows);
    complete &&= selections.complete;

    const feedback = await budget.list(
      ctx.db
        .query("seedFeedbackRequests")
        .withIndex("by_generationId_and_roleId", (q) =>
          q.eq("generationId", args.generationId).eq("roleId", roleId)
        ),
      Number.MAX_SAFE_INTEGER
    );
    feedbackRows.push(...feedback.rows);
    complete &&= feedback.complete;
  }

  const seedIds = new Set<Id<"seeds">>();
  for (const selection of selectionRows) seedIds.add(selection.seedId);
  for (const feedback of feedbackRows) seedIds.add(feedback.targetSeedId);

  const seedById = new Map<Id<"seeds">, Doc<"seeds">>();
  for (const seedId of seedIds) {
    const loaded = await budget.one(() => ctx.db.get(seedId));
    if (loaded.kind === "not-loaded") {
      complete = false;
      break;
    }
    if (loaded.value) seedById.set(loaded.value._id, loaded.value);
  }

  ancestorWalk: for (const seed of [...seedById.values()]) {
    const seen = new Set<Id<"seeds">>([seed._id]);
    let current = seed;
    while (current.revisionOfSeedId) {
      const parentId = current.revisionOfSeedId;
      if (seen.has(parentId)) {
        domainError("INVALID_STATE", "Seed revision ancestry contains a cycle");
      }
      seen.add(parentId);
      let parent = seedById.get(parentId);
      if (!parent) {
        const loaded = await budget.one(() => ctx.db.get(parentId));
        if (loaded.kind === "not-loaded") {
          complete = false;
          break ancestorWalk;
        }
        parent = loaded.value ?? undefined;
      }
      if (
        !parent ||
        parent.projectId !== seed.projectId ||
        parent.generationId !== seed.generationId ||
        parent.roleId !== seed.roleId
      ) {
        domainError(
          "INVALID_STATE",
          "Seed revision ancestry leaves its project, generation, or role"
        );
      }
      seedById.set(parent._id, parent);
      current = parent;
    }
  }
  const seeds = [...seedById.values()];

  const batchIds = new Set<Id<"seedBatches">>();
  for (const subsection of subsections) {
    if (subsection.shownBatchId) batchIds.add(subsection.shownBatchId);
    if (subsection.pendingBatchId) batchIds.add(subsection.pendingBatchId);
  }
  for (const feedback of feedbackRows) {
    if (feedback.batchId) batchIds.add(feedback.batchId);
  }
  for (const seed of seeds) batchIds.add(seed.batchId);

  const batches: Doc<"seedBatches">[] = [];
  for (const batchId of batchIds) {
    const loaded = await budget.one(() => ctx.db.get(batchId));
    if (loaded.kind === "not-loaded") {
      complete = false;
      break;
    }
    if (loaded.value) batches.push(loaded.value);
  }

  if (args.requireComplete && !complete) processingLimit(args);
  return {
    generation,
    subsections,
    seeds,
    selectionRows,
    feedbackRows,
    batches,
    complete,
    budget,
    readBudget: budget.snapshot(),
  };
}

export function materializeActiveSelections(
  state: Pick<SeedDecisionState, "subsections" | "seeds" | "selectionRows">,
  targetRoleId?: PdSubsectionRoleId
): MaterializedSeedSelection[] {
  const skipped = new Set(
    state.subsections
      .filter((subsection) => subsection.state === "skipped")
      .map((subsection) => subsection.roleId)
  );
  const seeds = new Map(state.seeds.map((seed) => [seed._id, seed]));
  const materialized: MaterializedSeedSelection[] = [];
  for (const selection of state.selectionRows) {
    if (!selection.selected || skipped.has(selection.roleId)) continue;
    if (targetRoleId && selection.roleId !== targetRoleId) continue;
    const seed = seeds.get(selection.seedId);
    if (
      !seed ||
      seed.generationId !== selection.generationId ||
      seed.projectId !== selection.projectId ||
      seed.roleId !== selection.roleId
    ) {
      domainError(
        "INVALID_STATE",
        "A selected Seed no longer belongs to this seed stage"
      );
    }
    materialized.push({
      roleId: selection.roleId,
      seedId: selection.seedId,
      bullets: materializeFinalWording(seed, selection),
      active: true,
    });
  }
  return materialized;
}

export function materializeCompleteDecisionSnapshot(
  state: SeedDecisionState,
  args: {
    targetRoleId: PdSubsectionRoleId;
    target?: MaterializedSeedTarget;
  }
): SeedContextSnapshot {
  if (!state.complete) {
    domainError("INVALID_INPUT", "Seed decisions are incomplete", {
      reason: "SEED_PROCESSING_LIMIT",
      roleId: args.targetRoleId,
    });
  }
  const feedbackRequests: MaterializedSeedFeedback[] = state.feedbackRows.map(
    (feedback) => ({
      roleId: feedback.roleId,
      feedbackRequestId: feedback._id,
      targetSeedId: feedback.targetSeedId,
      instruction: feedback.instruction,
      status: feedback.status,
    })
  );
  return buildCompleteDecisionSnapshot({
    targetRoleId: args.targetRoleId,
    selections: materializeActiveSelections(state),
    skippedRoleIds: state.subsections
      .filter((subsection) => subsection.state === "skipped")
      .map((subsection) => subsection.roleId),
    feedbackRequests,
    ...(args.target ? { target: args.target } : {}),
  });
}
