/**
 * Typed function references for the model catalog modules
 * (convex/modelCatalog.ts, convex/ai/modelEvaluation.ts).
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
export const planEvaluationsRef = ref<typeof catalog.planEvaluations>(
  "modelCatalog:planEvaluations"
);
export const refreshCatalogRef = ref<typeof catalog.refreshCatalog>("modelCatalog:refreshCatalog");

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
export const recordCallFailureRef = ref<typeof catalog.recordCallFailure>(
  "modelCatalog:recordCallFailure"
);

// Public: the admin page.
export const adminStateRef = ref<typeof catalog.adminState>("modelCatalog:adminState");
export const setAutoSwitchRef = ref<typeof catalog.setAutoSwitch>("modelCatalog:setAutoSwitch");
export const setRoleCostCapRef = ref<typeof catalog.setRoleCostCap>("modelCatalog:setRoleCostCap");
export const setEvalBudgetRef = ref<typeof catalog.setEvalBudget>("modelCatalog:setEvalBudget");
export const rollbackRoleRef = ref<typeof catalog.rollbackRole>("modelCatalog:rollbackRole");
export const setRoleModelRef = ref<typeof catalog.setRoleModel>("modelCatalog:setRoleModel");
export const requestCatalogRefreshRef = ref<typeof catalog.requestCatalogRefresh>(
  "modelCatalog:requestCatalogRefresh"
);
