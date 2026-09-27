/**
 * Typed function references for convex/intakeDrafts.ts (2026-09-26,
 * decision 65, stage 2). The module is new, and
 * `convex/_generated/api.d.ts` only lists a module after
 * `npx convex codegen`, which needs a deployment. Until it is regenerated,
 * callers (the New project page included) use these references, derived
 * from the registered exports exactly as convex/lib/modelCatalogRefs.ts
 * does, so every call is still type-checked against the real function.
 * Once codegen has run they are interchangeable with `api.intakeDrafts.*`
 * and `internal.intakeDrafts.*`.
 */
import {
  makeFunctionReference,
  type FunctionReference,
  type RegisteredAction,
  type RegisteredMutation,
  type RegisteredQuery,
} from "convex/server";
import type * as intake from "../intakeDrafts";

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

export const intakeDraftRefs = {
  createIntakeDraft: ref<typeof intake.createIntakeDraft>("intakeDrafts:createIntakeDraft"),
  saveIntakeSource: ref<typeof intake.saveIntakeSource>("intakeDrafts:saveIntakeSource"),
  removeIntakeSource: ref<typeof intake.removeIntakeSource>("intakeDrafts:removeIntakeSource"),
  attachIntakeOriginal: ref<typeof intake.attachIntakeOriginal>("intakeDrafts:attachIntakeOriginal"),
  updateIntakeContext: ref<typeof intake.updateIntakeContext>("intakeDrafts:updateIntakeContext"),
  setIntakeSelection: ref<typeof intake.setIntakeSelection>("intakeDrafts:setIntakeSelection"),
  discardIntakeDraft: ref<typeof intake.discardIntakeDraft>("intakeDrafts:discardIntakeDraft"),
  getIntakeDraft: ref<typeof intake.getIntakeDraft>("intakeDrafts:getIntakeDraft"),
  promoteIntakeDraft: ref<typeof intake.promoteIntakeDraft>("intakeDrafts:promoteIntakeDraft"),
  buildIntakeSourceStructure: ref<typeof intake.buildIntakeSourceStructure>("intakeDrafts:buildIntakeSourceStructure"),
  intakeSpeakerRoleInput: ref<typeof intake.intakeSpeakerRoleInput>("intakeDrafts:intakeSpeakerRoleInput"),
  recordIntakeSpeakerRoles: ref<typeof intake.recordIntakeSpeakerRoles>("intakeDrafts:recordIntakeSpeakerRoles"),
  continueIntakePromotion: ref<typeof intake.continueIntakePromotion>("intakeDrafts:continueIntakePromotion"),
  purgeIntakeDraft: ref<typeof intake.purgeIntakeDraft>("intakeDrafts:purgeIntakeDraft"),
  sweepIntakeDrafts: ref<typeof intake.sweepIntakeDrafts>("intakeDrafts:sweepIntakeDrafts"),
};
