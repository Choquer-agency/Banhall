import {
  makeFunctionReference,
  type FunctionArgs,
  type FunctionReference,
  type FunctionReturnType,
  type RegisteredMutation,
  type RegisteredQuery,
} from "convex/server";
import type {
  approve,
  edit,
  getApprovalReview,
  getOutline,
  getSubsection,
  getSourceAttribution,
  getSourceAttributionByIds,
  getSummary,
  listBatches,
  markBatchViewed,
  giveFeedback,
  open,
  regenerate,
  restoreBatch,
  restoreWording,
  retry,
  select,
  skip,
  unskip,
  withdrawFeedback,
} from "../../../../convex/seeds";

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
  return makeFunctionReference<
    "query",
    FunctionArgs<Reference>,
    FunctionReturnType<Reference>
  >(name);
}

function mutationReference<Export>(name: string) {
  type Reference = MutationReferenceFromExport<Export>;
  return makeFunctionReference<
    "mutation",
    FunctionArgs<Reference>,
    FunctionReturnType<Reference>
  >(name);
}

export const seedsApi = {
  getOutline: queryReference<typeof getOutline>("seeds:getOutline"),
  getSubsection: queryReference<typeof getSubsection>("seeds:getSubsection"),
  getApprovalReview: queryReference<typeof getApprovalReview>("seeds:getApprovalReview"),
  getSummary: queryReference<typeof getSummary>("seeds:getSummary"),
  getSourceAttribution: queryReference<typeof getSourceAttribution>("seeds:getSourceAttribution"),
  getSourceAttributionByIds: queryReference<typeof getSourceAttributionByIds>("seeds:getSourceAttributionByIds"),
  listBatches: queryReference<typeof listBatches>("seeds:listBatches"),
  open: mutationReference<typeof open>("seeds:open"),
  select: mutationReference<typeof select>("seeds:select"),
  edit: mutationReference<typeof edit>("seeds:edit"),
  restoreWording: mutationReference<typeof restoreWording>("seeds:restoreWording"),
  giveFeedback: mutationReference<typeof giveFeedback>("seeds:giveFeedback"),
  withdrawFeedback: mutationReference<typeof withdrawFeedback>("seeds:withdrawFeedback"),
  regenerate: mutationReference<typeof regenerate>("seeds:regenerate"),
  restoreBatch: mutationReference<typeof restoreBatch>("seeds:restoreBatch"),
  markBatchViewed: mutationReference<typeof markBatchViewed>("seeds:markBatchViewed"),
  retry: mutationReference<typeof retry>("seeds:retry"),
  skip: mutationReference<typeof skip>("seeds:skip"),
  unskip: mutationReference<typeof unskip>("seeds:unskip"),
  approve: mutationReference<typeof approve>("seeds:approve"),
};
