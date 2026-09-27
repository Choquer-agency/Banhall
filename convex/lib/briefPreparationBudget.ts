/**
 * Brief preparation limits and spend (2026-09-26, decision 65, lead
 * defaults). A preparation is speculative spend: it runs before anyone asks
 * for a run, so it is bounded per user and per project, reserved before the
 * call and settled from its usage rows.
 */
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import {
  estimateCostWithPricing,
  pricingFor,
  pricingFromPerMillion,
  type ModelPricing,
} from "../../shared/modelPricing";
import { alwaysThinkingMaxTokens } from "../../shared/generationModels";
import { catalogRow } from "./modelRoles";
import { BRIEF_REQUEST, BRIEF_SYSTEM_PROMPT } from "./briefRequest";

type Ctx = QueryCtx | MutationCtx;

/** Spend one project's preparations may hold per firm day, in USD. */
export const PREPARATION_PROJECT_DAILY_USD = 0.5;
/** Spend one user's preparations may hold per firm day, in USD. */
export const PREPARATION_USER_DAILY_USD = 5;
/** Paid preparation starts one user may trigger per firm day. */
export const PREPARATION_USER_DAILY_STARTS = 20;
/**
 * Tokens a request may carry beyond its text: the tool schema, the message
 * framing and the model's tokenizer being denser than the estimate.
 */
const REQUEST_OVERHEAD_TOKENS = 2_000;
/** Characters per token for the reservation; lower than the budget's 4 on purpose. */
const RESERVATION_CHARS_PER_TOKEN = 3;
/** Rows one limit read may look at; the daily start cap keeps real counts far below. */
const LIMIT_READ_ROWS = 200;

/** The planning model's prices, or null when neither the table nor the catalog has them. */
export async function preparationPricing(ctx: Ctx, model: string): Promise<ModelPricing | null> {
  const table = pricingFor(model);
  if (table) return table;
  const row = await catalogRow(ctx, model);
  if (row?.inputUsdPerMTok === undefined || row.outputUsdPerMTok === undefined) return null;
  return pricingFromPerMillion({
    input: row.inputUsdPerMTok,
    output: row.outputUsdPerMTok,
    cacheRead: row.cacheReadUsdPerMTok,
    cacheWrite: row.cacheWriteUsdPerMTok,
    cacheWrite1h: row.cacheWrite1hUsdPerMTok,
  });
}

/**
 * A conservative price for one Brief request: every input token written
 * to the cache (the prefix is cached, 1.25x) and the whole answer budget,
 * with a model that always thinks given its thinking room. A repair, when
 * it happens, is counted when its usage row lands.
 */
export function reservePreparationUsd(
  pricing: ModelPricing,
  model: string,
  userMessageChars: number
): number {
  const inputTokens =
    Math.ceil((BRIEF_SYSTEM_PROMPT.length + userMessageChars) / RESERVATION_CHARS_PER_TOKEN) +
    REQUEST_OVERHEAD_TOKENS;
  return estimateCostWithPricing(pricing, {
    inputTokens: 0,
    cacheCreationInputTokens: inputTokens,
    outputTokens: alwaysThinkingMaxTokens(model, BRIEF_REQUEST.maxTokens),
  });
}

/**
 * What one preparation holds against the limits: nothing before it was
 * dispatched; its settled usage once it completed and a usage row has
 * landed, whether it is still ready or was made obsolete since (the tenth
 * amendment: its cost is known, so a later edit in the start dialog is not
 * refused on a cost that was never spent); otherwise the larger of its
 * reservation and its usage so far (a failed, cut or cancelled call may
 * have cost money nobody reported).
 */
export function preparationCharge(
  preparation: Pick<
    Doc<"briefPreparations">,
    "status" | "dispatchedAt" | "reservedUsd" | "usageCostUsd" | "usageCalls" | "completedAt"
  >
): number {
  if (preparation.dispatchedAt === undefined) return 0;
  const used = preparation.usageCostUsd ?? 0;
  const completed =
    preparation.status === "ready" || (preparation.status === "obsolete" && preparation.completedAt !== undefined);
  if (completed && (preparation.usageCalls ?? 0) > 0) return used;
  return Math.max(preparation.reservedUsd ?? 0, used);
}

/** Adds one usage row's cost to its preparation, in the usage row's own transaction. */
export async function settlePreparationUsage(
  ctx: MutationCtx,
  preparationId: Id<"briefPreparations">,
  costUsd: number
): Promise<void> {
  const preparation = await ctx.db.get(preparationId);
  if (!preparation) return;
  await ctx.db.patch(preparationId, {
    usageCostUsd: (preparation.usageCostUsd ?? 0) + (Number.isFinite(costUsd) && costUsd > 0 ? costUsd : 0),
    usageCalls: (preparation.usageCalls ?? 0) + 1,
  });
}

export type PreparationDay = {
  userStarts: number;
  userUsd: number;
  /** The project's, or a private intake draft's (stage 2), spend. */
  projectUsd: number;
};

/**
 * One user's and one project's (or intake draft's) preparation spend and
 * starts on a firm day. A draft is held to the project cap: it is the
 * project the writer is still setting up.
 */
export async function preparationDay(
  ctx: Ctx,
  args: {
    userId: Id<"users">;
    scope: { projectId: Id<"projects"> } | { intakeDraftId: Id<"intakeDrafts"> };
    firmDay: number;
    excluding?: Id<"briefPreparations">;
  }
): Promise<PreparationDay> {
  const userRows = await ctx.db
    .query("briefPreparations")
    .withIndex("by_triggeredBy_and_firmDay", (q) => q.eq("triggeredBy", args.userId).eq("firmDay", args.firmDay))
    .take(LIMIT_READ_ROWS);
  const scope = args.scope;
  const projectRows =
    "projectId" in scope
      ? await ctx.db
          .query("briefPreparations")
          .withIndex("by_projectId_and_firmDay", (q) => q.eq("projectId", scope.projectId).eq("firmDay", args.firmDay))
          .take(LIMIT_READ_ROWS)
      : await ctx.db
          .query("briefPreparations")
          .withIndex("by_intakeDraftId_and_firmDay", (q) =>
            q.eq("intakeDraftId", scope.intakeDraftId).eq("firmDay", args.firmDay)
          )
          .take(LIMIT_READ_ROWS);
  const counted = (row: Doc<"briefPreparations">) => row._id !== args.excluding && row.dispatchedAt !== undefined;
  return {
    userStarts: userRows.filter(counted).length,
    userUsd: userRows.filter(counted).reduce((total, row) => total + preparationCharge(row), 0),
    projectUsd: projectRows.filter(counted).reduce((total, row) => total + preparationCharge(row), 0),
  };
}

/** The reason a start is refused by the limits, or null when it fits. */
export function preparationLimitRefusal(day: PreparationDay, reserveUsd: number): string | null {
  if (day.userStarts >= PREPARATION_USER_DAILY_STARTS) return "daily_starts";
  if (day.userUsd + reserveUsd > PREPARATION_USER_DAILY_USD) return "user_budget";
  if (day.projectUsd + reserveUsd > PREPARATION_PROJECT_DAILY_USD) return "project_budget";
  return null;
}
