import type { FunctionReturnType } from "convex/server";
import { seedsApi } from "./api";

export type SeedOutlineData = FunctionReturnType<typeof seedsApi.getOutline>;
export type SeedOutlineRow = SeedOutlineData["rows"][number];
export type SeedSubsectionData = FunctionReturnType<typeof seedsApi.getSubsection>;
export type SeedCardData = SeedSubsectionData["items"][number];
export type SeedApprovalChallenge = NonNullable<
  SeedSubsectionData["approvalChallenge"]
>;
export type SeedSummaryPage = FunctionReturnType<typeof seedsApi.getSummary>;
export type SeedSummaryItem = SeedSummaryPage["page"][number];
export type SeedBatchHistoryPage = FunctionReturnType<typeof seedsApi.listBatches>;
export type SeedBatchHistoryRow = SeedBatchHistoryPage["page"][number];
export type SeedApprovalReviewData = FunctionReturnType<typeof seedsApi.getApprovalReview>;
export type SeedSourceAttributionPage = FunctionReturnType<typeof seedsApi.getSourceAttribution>;
export type SeedSourceRecoveryPage = FunctionReturnType<typeof seedsApi.getSourceAttributionByIds>;
export type { SeedSourceAttribution, SeedSourceAttributionStatus } from "./attribution";

/** Unsaved Seed wording, pinned to the stage version it began against. */
export type SeedEditDraft = {
  bulletOne: string;
  bulletTwo: string;
  baseSeedStageVersion: number;
};

/** An unsent revision instruction, pinned to the stage version it began against. */
export type SeedFeedbackDraft = {
  instruction: string;
  baseSeedStageVersion: number;
};

/** One Seed's unsaved box text for one user and generation. The edit and
 * feedback buffers are independent; neither base version ever advances
 * without an explicit writer review. */
export type SeedLocalDraft = {
  ownerGenerationId: string;
  ownerRoleId: string;
  edit: SeedEditDraft | null;
  feedback: SeedFeedbackDraft | null;
};

/** Applied to the authoritative stored draft, so a late async result compares
 * against what the writer has now, not against a copy from before the await. */
export type SeedDraftUpdate = (
  current: SeedLocalDraft | undefined
) => SeedLocalDraft | null;
