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

/** Merges followed to find the company a merged one ended up in. */
export const MERGE_CHAIN_HOPS = 10;

/** Merge tombstones one key's old link reads to find the latest merge. */
export const MERGED_KEY_READ_LIMIT = 20;

/**
 * The most recently merged tombstone that had this company key, or null (the
 * company page's old links, 2026-10-28). The index orders one key's rows by
 * when the row was made, not when it was merged (a company renamed onto the
 * key and merged later was made earlier), so the newest MERGED_KEY_READ_LIMIT
 * rows are read and the latest merge among them wins. A key merged away more
 * often than that may miss an older row's later merge.
 */
export async function mergedClientForKey(
  ctx: Ctx,
  nameKey: string
): Promise<Doc<"clients"> | null> {
  if (nameKey === DASHBOARD_UNNAMED_COMPANY_KEY) return null;
  const rows = await ctx.db
    .query("clients")
    .withIndex("by_status_and_nameKey", (q) => q.eq("status", "merged").eq("nameKey", nameKey))
    .order("desc")
    .take(MERGED_KEY_READ_LIMIT);
  let latest: Doc<"clients"> | null = null;
  for (const row of rows) {
    if (!latest || (row.mergedAt ?? row.updatedAt) > (latest.mergedAt ?? latest.updatedAt)) latest = row;
  }
  return latest;
}

/**
 * The active company a client ended up in, following merges of merges up to
 * MERGE_CHAIN_HOPS, or null when the chain is broken or too long.
 */
export async function activeClientAfterMerges(
  ctx: Ctx,
  client: Doc<"clients">
): Promise<Doc<"clients"> | null> {
  let current: Doc<"clients"> | null = client;
  for (let hop = 0; current && current.status !== "active" && hop < MERGE_CHAIN_HOPS; hop++) {
    current = current.mergedIntoClientId ? await ctx.db.get(current.mergedIntoClientId) : null;
  }
  return current?.status === "active" ? current : null;
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

/** Live projects whose people a company's names include, newest first, and the rows read to find them. */
const IDENTITY_PROJECTS = 50;
const IDENTITY_PROJECT_READ = 1_000;

/**
 * Every name tied to a company that its files may carry (2026-10-26, Phase
 * C): its other names (`companyOtherNames`), the names its projects carry
 * for it, and the people on its 50 newest live projects (interviewer,
 * writer, interviewees). Company file labels and drafts that send company
 * files hide them all. Throws when it cannot read them all (more than
 * 1,000 projects hold fewer than 50 live ones, or too many merges), so no
 * caller sends a name it could not hide.
 *
 * A draft passes its own project as `ownProjectId`: that project's names
 * are already in its own map, and leaving it out makes a promoted New
 * project's first run read the same names as its head start did before the
 * project existed (review 2, 2026-10-26).
 */
export async function companyIdentityNames(
  ctx: Ctx,
  client: Doc<"clients">,
  ownProjectId?: Id<"projects">
): Promise<{ organizations: string[]; people: string[] }> {
  const organizations = new Set<string>(await companyOtherNames(ctx, client));
  const people: string[] = [];
  let live = 0;
  let read = 0;
  for await (const project of ctx.db.query("projects").withIndex("by_clientId", (q) => q.eq("clientId", client._id)).order("desc")) {
    read += 1;
    if (read > IDENTITY_PROJECT_READ) {
      throw new Error(
        `Read ${IDENTITY_PROJECT_READ} projects without finding ${IDENTITY_PROJECTS} live ones; nothing goes out with a name it could not hide`
      );
    }
    if (project.deletionStartedAt !== undefined || project._id === ownProjectId) continue;
    live += 1;
    for (const name of [project.interviewer, project.writer, ...(project.interviewees ?? [])]) {
      if (name?.trim()) people.push(name.trim());
    }
    if (project.clientName !== client.name) organizations.add(project.clientName);
    if (live >= IDENTITY_PROJECTS) break;
  }
  // The company's own name too: a project may write it with other case or
  // accents (review, 2026-10-26); a map that already hides it adds nothing.
  organizations.add(client.name);
  return { organizations: [...organizations], people };
}
