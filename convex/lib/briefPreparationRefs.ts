/**
 * Typed function references for convex/briefPreparations.ts (2026-09-26,
 * decision 65). The module is new, and `convex/_generated/api.d.ts` only
 * lists a module after `npx convex codegen`, which needs a deployment.
 * Until it is regenerated, callers use these references, derived from the
 * registered exports exactly as convex/lib/modelCatalogRefs.ts does, so
 * every call is still type-checked against the real function. Once codegen
 * has run they are interchangeable with `internal.briefPreparations.*`.
 */
import {
  makeFunctionReference,
  type FunctionReference,
  type RegisteredAction,
  type RegisteredMutation,
  type RegisteredQuery,
} from "convex/server";
import type * as preparations from "../briefPreparations";

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

export const startBriefPreparationRef = ref<typeof preparations.startBriefPreparation>(
  "briefPreparations:startBriefPreparation"
);
export const getPreparationRunRef = ref<typeof preparations.getPreparationRun>(
  "briefPreparations:getPreparationRun"
);
export const getPreparationCitationSpeakersRef = ref<typeof preparations.getPreparationCitationSpeakers>(
  "briefPreparations:getPreparationCitationSpeakers"
);
export const appendPreparationFactsRef = ref<typeof preparations.appendPreparationFacts>(
  "briefPreparations:appendPreparationFacts"
);
export const completePreparationRef = ref<typeof preparations.completePreparation>(
  "briefPreparations:completePreparation"
);
export const failPreparationRef = ref<typeof preparations.failPreparation>(
  "briefPreparations:failPreparation"
);
export const expirePreparationLeaseRef = ref<typeof preparations.expirePreparationLease>(
  "briefPreparations:expirePreparationLease"
);
export const purgeStalePreparationsRef = ref<typeof preparations.purgeStalePreparations>(
  "briefPreparations:purgeStalePreparations"
);
