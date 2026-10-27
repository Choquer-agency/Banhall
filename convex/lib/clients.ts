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

/** Sets `clientId` on up to `limit` live projects of a key (no updatedAt bump). */
export async function linkKeyProjects(
  ctx: MutationCtx,
  key: string,
  clientId: Id<"clients">,
  limit: number
) {
  const projects = await ctx.db
    .query("projects")
    .withIndex("by_dashboardCompanyKey", (q) => q.eq("dashboardCompanyKey", key))
    .take(limit);
  for (const project of projects) {
    if (project.deletionStartedAt !== undefined || project.clientId === clientId) continue;
    await ctx.db.patch(project._id, { clientId });
  }
}

/** Companies merged into one, at any depth, read to find its other names. */
export const NAME_HISTORY_MERGED_LIMIT = 100;

/** A company whose merge tombstones are too many to read for its names. */
export class NameHistoryTooLongError extends Error {
  constructor() {
    super(`More than ${NAME_HISTORY_MERGED_LIMIT} companies were merged into this one`);
  }
}

/**
 * Every name a company had besides its current one (2026-10-26, Phase C):
 * its kept history (`formerNames`), and, for a row whose history is not
 * known to be complete (merges made before histories were kept), the names
 * on its merge tombstones at any depth. Throws NameHistoryTooLongError when
 * those are too many to read, so no caller goes on with names missing.
 */
export async function companyOtherNames(ctx: Ctx, client: Doc<"clients">): Promise<string[]> {
  const names = new Set(client.formerNames ?? []);
  if (client.nameHistoryComplete !== true) {
    const queue: Id<"clients">[] = [client._id];
    let seen = 0;
    while (queue.length > 0) {
      const into = queue.shift()!;
      const merged = await ctx.db
        .query("clients")
        .withIndex("by_mergedIntoClientId", (q) => q.eq("mergedIntoClientId", into))
        .take(NAME_HISTORY_MERGED_LIMIT + 1 - seen);
      for (const old of merged) {
        seen += 1;
        names.add(old.name);
        for (const name of old.formerNames ?? []) names.add(name);
        if (old.nameHistoryComplete !== true) queue.push(old._id);
      }
      if (seen > NAME_HISTORY_MERGED_LIMIT) throw new NameHistoryTooLongError();
    }
  }
  names.delete(client.name);
  return [...names];
}
