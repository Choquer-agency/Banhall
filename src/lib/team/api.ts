import {
  makeFunctionReference,
  type FunctionArgs,
  type FunctionReference,
  type FunctionReturnType,
  type RegisteredMutation,
  type RegisteredQuery,
} from "convex/server";
import type { listMembers, markActive } from "../../../convex/team";

// `convex/team.ts` is new in round 2. Until the lead regenerates
// `convex/_generated/api.d.ts` after merging, `api.team` has no types, so the
// page builds typed references from the module's own exports (the same
// pattern as `$lib/components/seeds/api.ts`). Swap for `api.team.*` once the
// generated API lists the module.

type QueryReferenceFromExport<Export> =
  Export extends RegisteredQuery<infer Visibility, infer Args, infer ReturnValue>
    ? FunctionReference<"query", Visibility, Args, Awaited<ReturnValue>>
    : never;

type MutationReferenceFromExport<Export> =
  Export extends RegisteredMutation<infer Visibility, infer Args, infer ReturnValue>
    ? FunctionReference<"mutation", Visibility, Args, Awaited<ReturnValue>>
    : never;

function queryReference<Export>(name: string) {
  type Reference = QueryReferenceFromExport<Export>;
  return makeFunctionReference<"query", FunctionArgs<Reference>, FunctionReturnType<Reference>>(
    name,
  );
}

function mutationReference<Export>(name: string) {
  type Reference = MutationReferenceFromExport<Export>;
  return makeFunctionReference<
    "mutation",
    FunctionArgs<Reference>,
    FunctionReturnType<Reference>
  >(name);
}

export const teamApi = {
  listMembers: queryReference<typeof listMembers>("team:listMembers"),
  markActive: mutationReference<typeof markActive>("team:markActive"),
};
