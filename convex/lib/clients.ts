import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  DASHBOARD_UNNAMED_COMPANY_KEY,
  dashboardCompanyKey,
} from "../../shared/dashboardProjection";

type Ctx = QueryCtx | MutationCtx;

/**
 * The active saved client for a company key, or null (2026-10-14 amendment).
 * At most one active row exists per key; `.first()` keeps a read from
 * throwing if a bad write ever produced two.
 */
export async function activeClientForKey(
  ctx: Ctx,
  nameKey: string
): Promise<Doc<"clients"> | null> {
  if (nameKey === DASHBOARD_UNNAMED_COMPANY_KEY) return null;
  return await ctx.db
    .query("clients")
    .withIndex("by_status_and_nameKey", (q) =>
      q.eq("status", "active").eq("nameKey", nameKey)
    )
    .first();
}

/**
 * Dual write (2026-10-14 amendment): every path that writes
 * `projects.clientName` sets `clientId` to the active client with the same
 * key, or clears it (`undefined`) when there is none.
 */
export async function activeClientIdForName(
  ctx: Ctx,
  clientName: string
): Promise<Id<"clients"> | undefined> {
  return (await activeClientForKey(ctx, dashboardCompanyKey(clientName)))?._id;
}

/** The dashboardCompanies projection row for a company key, or null. */
export async function dashboardCompanyForKey(
  ctx: Ctx,
  companyKey: string
): Promise<Doc<"dashboardCompanies"> | null> {
  return await ctx.db
    .query("dashboardCompanies")
    .withIndex("by_companyKey", (q) => q.eq("companyKey", companyKey))
    .unique();
}
