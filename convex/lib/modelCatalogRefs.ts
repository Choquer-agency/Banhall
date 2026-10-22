/**
 * Typed function references for the model catalog modules
 * (convex/modelCatalog.ts, convex/ai/modelEvaluation.ts,
 * convex/ai/modelReadiness.ts).
 *
 * These two modules are new, and `convex/_generated/api.d.ts` only lists a
 * module after `npx convex codegen`, which needs a deployment. Until it is
 * regenerated, callers use these references, derived from the registered
 * exports exactly as convex/ai/seeds.ts does for seedRuns, so every call is
 * still type-checked against the real function. Once codegen has run they
 * are interchangeable with `internal.modelCatalog.*` / `api.modelCatalog.*`.
 */
import {
  makeFunctionReference,
  type FunctionReference,
  type RegisteredAction,
  type RegisteredMutation,
  type RegisteredQuery,
} from "convex/server";
import type * as catalog from "../modelCatalog";
import type * as evaluation from "../ai/modelEvaluation";
import type * as readiness from "../ai/modelReadiness";

type RefOf<Export> =
  Export extends RegisteredQuery<infer Visibility, infer Args, infer Return>
    ? FunctionReference<"query", Visibility, Args, Awaited<Return>>
    : Export extends RegisteredMutation<infer Visibility, infer Args, infer Return>
      ? FunctionReference<"mutation", Visibility, Args, Awaited<Return>>
      : Export extends RegisteredAction<infer Visibility, infer Args, infer Return>
        ? FunctionReference<"action", Visibility, Args, Awaited<Return>>
        : never;

function ref<Export>(name: string): RefOf<Export> {
  return makeFunctionReference(name) as unknown as RefOf<Export>;
}

// Internal: the daily job.
export const seedCatalogRef = ref<typeof catalog.seedCatalog>("modelCatalog:seedCatalog");
export const applyCatalogRefreshRef = ref<typeof catalog.applyCatalogRefresh>(
  "modelCatalog:applyCatalogRefresh"
);
export const endpointCheckTargetsRef = ref<typeof catalog.endpointCheckTargets>(
  "modelCatalog:endpointCheckTargets"
);
export const recordEndpointSupportRef = ref<typeof catalog.recordEndpointSupport>(
  "modelCatalog:recordEndpointSupport"
);
export const checkProductionErrorsRef = ref<typeof catalog.checkProductionErrors>(
  "modelCatalog:checkProductionErrors"
);
export const pruneCallOutcomesRef = ref<typeof catalog.pruneCallOutcomes>(
  "modelCatalog:pruneCallOutcomes"
);
export const refreshCatalogRef = ref<typeof catalog.refreshCatalog>("modelCatalog:refreshCatalog");

// Internal: track upgrades (2026-10-22).
export const upgradeTracksRef = ref<typeof readiness.upgradeTracks>("ai/modelReadiness:upgradeTracks");
export const planTrackUpgradesRef = ref<typeof catalog.planTrackUpgrades>(
  "modelCatalog:planTrackUpgrades"
);
export const applyTrackUpgradeRef = ref<typeof catalog.applyTrackUpgrade>(
  "modelCatalog:applyTrackUpgrade"
);
export const noteTrackCheckRef = ref<typeof catalog.noteTrackCheck>("modelCatalog:noteTrackCheck");
export const generationModelRedirectsRef = ref<typeof catalog.generationModelRedirects>(
  "modelCatalog:generationModelRedirects"
);
export const recordGenerationModelRedirectsRef = ref<typeof catalog.recordGenerationModelRedirects>(
  "modelCatalog:recordGenerationModelRedirects"
);

// Internal: one-off migrations, run by hand (2026-10-22).
export const pointRolesAtTracksRef = ref<typeof catalog.pointRolesAtTracks>(
  "modelCatalog:pointRolesAtTracks"
);
export const resolveModelCatalogAlertsRef = ref<typeof catalog.resolveModelCatalogAlerts>(
  "modelCatalog:resolveModelCatalogAlerts"
);

// Internal: evaluations.
export const claimEvaluationRef = ref<typeof catalog.claimEvaluation>(
  "modelCatalog:claimEvaluation"
);
export const completeEvaluationRef = ref<typeof catalog.completeEvaluation>(
  "modelCatalog:completeEvaluation"
);
export const failEvaluationRef = ref<typeof catalog.failEvaluation>("modelCatalog:failEvaluation");
export const runEvaluationRef = ref<typeof evaluation.runEvaluation>(
  "ai/modelEvaluation:runEvaluation"
);

// Internal: runtime resolution for actions.
export const roleModelEntryRef = ref<typeof catalog.roleModelEntry>("modelCatalog:roleModelEntry");
export const generationModelsRef = ref<typeof catalog.generationModels>(
  "modelCatalog:generationModels"
);
export const modelEntryForCallRef = ref<typeof catalog.modelEntryForCall>(
  "modelCatalog:modelEntryForCall"
);
export const recordCallOutcomeRef = ref<typeof catalog.recordCallOutcome>(
  "modelCatalog:recordCallOutcome"
);

// Public: the admin page.
export const adminStateRef = ref<typeof catalog.adminState>("modelCatalog:adminState");
export const setAutoSwitchRef = ref<typeof catalog.setAutoSwitch>("modelCatalog:setAutoSwitch");
export const setRoleCostCapRef = ref<typeof catalog.setRoleCostCap>("modelCatalog:setRoleCostCap");
export const setEvalBudgetRef = ref<typeof catalog.setEvalBudget>("modelCatalog:setEvalBudget");
export const moveTrackBackRef = ref<typeof catalog.moveTrackBack>("modelCatalog:moveTrackBack");
export const setRoleTrackRef = ref<typeof catalog.setRoleTrack>("modelCatalog:setRoleTrack");
export const setRoleModelRef = ref<typeof catalog.setRoleModel>("modelCatalog:setRoleModel");
export const requestCatalogRefreshRef = ref<typeof catalog.requestCatalogRefresh>(
  "modelCatalog:requestCatalogRefresh"
);
