import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { requireInternalActor, requireRole } from "./lib/auth";
import { domainError } from "./lib/contracts";
import { requireCapability } from "./lib/roleCapabilities";
import { syncProjectDashboardFields } from "./lib/dashboardProjection";
import { activeClientForKey, dashboardCompanyForKey } from "./lib/clients";
import { validatedIndustry } from "./projects";
import {
  DASHBOARD_NO_FISCAL_YEAR_RANK,
  DASHBOARD_UNNAMED_COMPANY_KEY,
  dashboardCompanyKey,
  dashboardFiscalYearRank,
} from "../shared/dashboardProjection";
import { clientNamesLookAlike, isValidClientYearEnd } from "../shared/clientNames";

// ─── Saved clients (2026-10-14 amendment) ───────────────────────────────────
// "Saved clients, client merge, and the Projects page redesign" in
// docs/product-domain.md. Starts the D7 client migration: widen (the
// `clients` table and `projects.clientId`), backfill (backfillClients) and
// dual write (every `projects.clientName` writer links `clientId` through
// lib/clients.activeClientIdForName). `projects.clientName` stays the field
// every reader groups by and `dashboardCompanies` stays a projection.
//
// Authorization: reads follow D1 (every internal user); "Create a client" is
// the `project.create` capability (Consultant, Manager, Admin; not
// Financial); "Merge clients" is Manager and Admin only.

type Ctx = QueryCtx | MutationCtx;

/** Most rows each source contributes to the client directory. */
const CLIENT_DIRECTORY_BOUND = 1_000;
/** Most similar names findSimilarClients returns. */
const SIMILAR_CLIENT_LIMIT = 5;
/** Longest accepted client name. */
const CLIENT_NAME_MAX_LENGTH = 200;
/** A merge that would move more projects than this is refused. */
const MERGE_PROJECT_LIMIT = 200;
/**
 * Most project index rows one merge reads per key while looking for live
 * projects. Rows of projects being deleted are skipped but still read; a key
 * that is not exhausted within this many rows makes the merge refuse (the
 * same user-safe 200 message) rather than guess.
 */
const MERGE_KEY_SCAN_LIMIT = 2_000;
/** Most clients one merge may fold into the kept client. */
const MERGE_KEY_LIMIT = 20;
/** Most distinct fiscal years checked against the kept client for collisions. */
const MERGE_COLLISION_RANK_LIMIT = 20;
/** Kept-client projects read per fiscal year for the collision check. */
const MERGE_COLLISION_RANK_READ = 100;

const clientListEntryValidator = v.object({
  key: v.string(),
  clientId: v.union(v.id("clients"), v.null()),
  name: v.string(),
  projectCount: v.number(),
  fiscalYearEndMonth: v.optional(v.number()),
  fiscalYearEndDay: v.optional(v.number()),
  industry: v.optional(v.string()),
});

const clientSummaryValidator = v.object({
  key: v.string(),
  name: v.string(),
  projectCount: v.number(),
});

type ClientListEntry = {
  key: string;
  clientId: Id<"clients"> | null;
  name: string;
  projectCount: number;
  fiscalYearEndMonth?: number;
  fiscalYearEndDay?: number;
  industry?: string;
};

function clientEntry(
  client: Doc<"clients">,
  company: Doc<"dashboardCompanies"> | null
): ClientListEntry {
  return {
    key: client.nameKey,
    clientId: client._id,
    name: client.name,
    projectCount: company?.projectCount ?? 0,
    ...(client.fiscalYearEndMonth !== undefined
      ? { fiscalYearEndMonth: client.fiscalYearEndMonth }
      : {}),
    ...(client.fiscalYearEndDay !== undefined
      ? { fiscalYearEndDay: client.fiscalYearEndDay }
      : {}),
    ...(client.industry !== undefined ? { industry: client.industry } : {}),
  };
}

function companyEntry(company: Doc<"dashboardCompanies">): ClientListEntry {
  return {
    key: company.companyKey,
    clientId: null,
    name: company.clientName,
    projectCount: company.projectCount,
  };
}

/**
 * The client picker's directory: active saved clients plus the
 * `dashboardCompanies` names that have no client row yet (so no existing name
 * disappears before the backfill), one entry per key, sorted by key, without
 * the unnamed key. Each source is read up to CLIENT_DIRECTORY_BOUND rows; when
 * either source is cut, the list stops at the smaller last key so no entry is
 * shown with a missing client or count.
 */
async function loadClientDirectory(ctx: Ctx) {
  const clientRows = await ctx.db
    .query("clients")
    .withIndex("by_status_and_nameKey", (q) => q.eq("status", "active"))
    .take(CLIENT_DIRECTORY_BOUND + 1);
  // The unnamed bucket sorts last ("\uffff") and is never listed, so the read
  // stops before it; otherwise exactly CLIENT_DIRECTORY_BOUND named companies
  // plus the unnamed row would report a false `truncated`.
  const companyRows = await ctx.db
    .query("dashboardCompanies")
    .withIndex("by_companyKey", (q) => q.lt("companyKey", DASHBOARD_UNNAMED_COMPANY_KEY))
    .take(CLIENT_DIRECTORY_BOUND + 1);
  const clientsTruncated = clientRows.length > CLIENT_DIRECTORY_BOUND;
  const companiesTruncated = companyRows.length > CLIENT_DIRECTORY_BOUND;
  const clients = clientRows.slice(0, CLIENT_DIRECTORY_BOUND);
  const companies = companyRows.slice(0, CLIENT_DIRECTORY_BOUND);

  let cutoff: string | null = null;
  const lower = (key: string) => {
    if (cutoff === null || key < cutoff) cutoff = key;
  };
  if (clientsTruncated && clients.length > 0) lower(clients[clients.length - 1].nameKey);
  if (companiesTruncated && companies.length > 0) {
    lower(companies[companies.length - 1].companyKey);
  }

  const companyByKey = new Map(companies.map((company) => [company.companyKey, company]));
  const entries = new Map<string, ClientListEntry>();
  for (const client of clients) {
    if (entries.has(client.nameKey)) continue;
    entries.set(client.nameKey, clientEntry(client, companyByKey.get(client.nameKey) ?? null));
  }
  for (const company of companies) {
    if (!entries.has(company.companyKey)) {
      entries.set(company.companyKey, companyEntry(company));
    }
  }
  const sorted = [...entries.values()]
    .filter((entry) => entry.key !== DASHBOARD_UNNAMED_COMPANY_KEY)
    .filter((entry) => cutoff === null || entry.key <= cutoff)
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { clients: sorted, truncated: clientsTruncated || companiesTruncated };
}

/** One key's directory entry by indexed lookups (never cut by the bound). */
async function clientEntryForKey(ctx: Ctx, key: string): Promise<ClientListEntry | null> {
  if (key === DASHBOARD_UNNAMED_COMPANY_KEY) return null;
  const client = await activeClientForKey(ctx, key);
  const company = await dashboardCompanyForKey(ctx, key);
  if (client) return clientEntry(client, company);
  if (company) return companyEntry(company);
  return null;
}

function clientExistsError(existingName: string, existingKey: string): never {
  domainError("CLIENT_EXISTS", `${existingName} already exists.`, {
    existingName,
    existingKey,
  });
}

function requireClientName(raw: string): string {
  const name = raw.trim();
  if (!name || dashboardCompanyKey(name) === DASHBOARD_UNNAMED_COMPANY_KEY) {
    domainError("INVALID_INPUT", "Enter a client name.");
  }
  if (name.length > CLIENT_NAME_MAX_LENGTH) {
    domainError(
      "INVALID_INPUT",
      `A client name can be at most ${CLIENT_NAME_MAX_LENGTH} characters.`
    );
  }
  return name;
}

export const listClients = query({
  args: {},
  returns: v.object({
    clients: v.array(clientListEntryValidator),
    truncated: v.boolean(),
  }),
  handler: async (ctx) => {
    // D1: firm-wide read visibility for internal users.
    await requireInternalActor(ctx);
    return await loadClientDirectory(ctx);
  },
});

export const findSimilarClients = query({
  args: { name: v.string() },
  returns: v.object({
    exact: v.union(clientSummaryValidator, v.null()),
    similar: v.array(clientSummaryValidator),
  }),
  handler: async (ctx, args) => {
    // D1: firm-wide read visibility for internal users.
    await requireInternalActor(ctx);
    const name = args.name.trim();
    if (!name || name.length > CLIENT_NAME_MAX_LENGTH) return { exact: null, similar: [] };
    const key = dashboardCompanyKey(name);
    const exactEntry = await clientEntryForKey(ctx, key);
    const directory = await loadClientDirectory(ctx);
    const similar = directory.clients
      .filter((entry) => entry.key !== key && clientNamesLookAlike(entry.name, name))
      .slice(0, SIMILAR_CLIENT_LIMIT)
      .map((entry) => ({ key: entry.key, name: entry.name, projectCount: entry.projectCount }));
    return {
      exact: exactEntry
        ? { key: exactEntry.key, name: exactEntry.name, projectCount: exactEntry.projectCount }
        : null,
      similar,
    };
  },
});

export const createClient = mutation({
  args: {
    name: v.string(),
    fiscalYearEndMonth: v.optional(v.number()),
    fiscalYearEndDay: v.optional(v.number()),
    industry: v.optional(v.string()),
  },
  returns: v.object({
    clientId: v.id("clients"),
    key: v.string(),
    name: v.string(),
  }),
  handler: async (ctx, args) => {
    // "Create a client": anyone who may create a project (not Financial).
    const { user } = await requireCapability(ctx, "project.create");
    const name = requireClientName(args.name);
    if (!isValidClientYearEnd(args.fiscalYearEndMonth, args.fiscalYearEndDay)) {
      domainError(
        "INVALID_INPUT",
        "Enter a usual year end with both a month and a day that exists in that month."
      );
    }
    const industry = await validatedIndustry(ctx, args.industry);
    const key = dashboardCompanyKey(name);
    const existing = await activeClientForKey(ctx, key);
    if (existing) clientExistsError(existing.name, existing.nameKey);
    const company = await dashboardCompanyForKey(ctx, key);
    if (company) clientExistsError(company.clientName, company.companyKey);

    const now = Date.now();
    const clientId = await ctx.db.insert("clients", {
      name,
      nameKey: key,
      ...(args.fiscalYearEndMonth !== undefined
        ? {
            fiscalYearEndMonth: args.fiscalYearEndMonth,
            fiscalYearEndDay: args.fiscalYearEndDay,
          }
        : {}),
      ...(industry ? { industry } : {}),
      status: "active",
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    });
    // A key with no company row has no counted projects; link any uncounted
    // stragglers so the dual-write invariant holds from the start.
    await linkKeyProjects(ctx, key, clientId, MERGE_PROJECT_LIMIT);
    return { clientId, key, name };
  },
});

/** Sets `clientId` on up to `limit` live projects of a key (no updatedAt bump). */
async function linkKeyProjects(
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

// ─── Merge ──────────────────────────────────────────────────────────────────

type MergeSide = {
  key: string;
  client: Doc<"clients"> | null;
  company: Doc<"dashboardCompanies"> | null;
};

function sideName(side: MergeSide) {
  return side.client?.name ?? side.company?.clientName ?? side.key;
}

type MergePlan = {
  keep: MergeSide;
  merged: MergeSide[];
  keptName: string;
  keptKey: string;
  nameConflict: string | null;
  /** Whether the kept client's own projects move (its name or key changes). */
  keepMoves: boolean;
  /** Live projects that move (client name, clientId, dashboard counts). */
  moving: Doc<"projects">[];
  /**
   * Live projects that stay on their key and only gain the kept client's
   * clientId: the kept key's own unlinked projects (no rename), or leftover
   * projects already on a new name's key (rename). Counted toward the cap.
   */
  linking: Doc<"projects">[];
  /** moving + linking would exceed MERGE_PROJECT_LIMIT, or a key was too big to read. */
  tooMany: boolean;
  /** Counted projects of every involved client (dashboardCompanies). */
  projectCount: number;
};

const mergeArgs = {
  keepKey: v.string(),
  mergeKeys: v.array(v.string()),
  name: v.optional(v.string()),
};

type MergeArgs = { keepKey: string; mergeKeys: string[]; name?: string };

async function loadMergeSide(ctx: Ctx, key: string): Promise<MergeSide> {
  const client = await activeClientForKey(ctx, key);
  const company = await dashboardCompanyForKey(ctx, key);
  if (!client && !company) {
    domainError(
      "INVALID_INPUT",
      "One of the selected clients no longer exists. Refresh and try again."
    );
  }
  return { key, client, company };
}

/**
 * Reads the live (not deleting) projects of one key that satisfy `wanted`,
 * stopping once more than `budget` are found. `complete` is false when the
 * key was not exhausted: either the budget was exceeded or
 * MERGE_KEY_SCAN_LIMIT index rows were read first.
 */
async function liveProjectsOfKey(
  ctx: Ctx,
  key: string,
  budget: number,
  wanted: (project: Doc<"projects">) => boolean = () => true
): Promise<{ rows: Doc<"projects">[]; complete: boolean }> {
  const rows: Doc<"projects">[] = [];
  let scanned = 0;
  for await (const project of ctx.db
    .query("projects")
    .withIndex("by_dashboardCompanyKey", (q) => q.eq("dashboardCompanyKey", key))) {
    scanned += 1;
    if (project.deletionStartedAt === undefined && wanted(project)) {
      rows.push(project);
      if (rows.length > budget) return { rows, complete: false };
    }
    if (scanned >= MERGE_KEY_SCAN_LIMIT) return { rows, complete: false };
  }
  return { rows, complete: true };
}

/**
 * Validates a merge and reads what it would move. `strictName` (the
 * mutation) refuses a blank name; the preview treats a blank name as "keep
 * the current name" while the person is still typing.
 */
async function planClientMerge(
  ctx: Ctx,
  args: MergeArgs,
  options: { strictName: boolean }
): Promise<MergePlan> {
  if (args.mergeKeys.length === 0) {
    domainError("INVALID_INPUT", "Select at least one client to merge.");
  }
  if (args.mergeKeys.length > MERGE_KEY_LIMIT) {
    domainError("INVALID_INPUT", `Merge at most ${MERGE_KEY_LIMIT} clients at a time.`);
  }
  if (new Set(args.mergeKeys).size !== args.mergeKeys.length) {
    domainError("INVALID_INPUT", "Each client can be merged only once.");
  }
  if (args.mergeKeys.includes(args.keepKey)) {
    domainError("INVALID_INPUT", "The client you keep cannot also be merged into itself.");
  }
  if (
    args.keepKey === DASHBOARD_UNNAMED_COMPANY_KEY ||
    args.mergeKeys.includes(DASHBOARD_UNNAMED_COMPANY_KEY)
  ) {
    domainError("INVALID_INPUT", "Projects without a client name cannot be merged.");
  }

  let name: string | undefined;
  if (args.name !== undefined) {
    if (options.strictName || args.name.trim()) name = requireClientName(args.name);
  }

  const keep = await loadMergeSide(ctx, args.keepKey);
  const merged: MergeSide[] = [];
  for (const key of args.mergeKeys) merged.push(await loadMergeSide(ctx, key));

  const keptName = name ?? sideName(keep);
  const keptKey = name ? dashboardCompanyKey(name) : keep.key;
  const involved = new Set([keep.key, ...args.mergeKeys]);
  let nameConflict: string | null = null;
  if (name && !involved.has(keptKey)) {
    const otherClient = await activeClientForKey(ctx, keptKey);
    const otherCompany = otherClient ? null : await dashboardCompanyForKey(ctx, keptKey);
    nameConflict = otherClient?.name ?? otherCompany?.clientName ?? null;
  }

  const keepMoves = keptKey !== keep.key || keptName !== sideName(keep);
  const moveKeys = keepMoves ? [keep.key, ...args.mergeKeys] : args.mergeKeys;
  // Every key is read until it is exhausted or the cap is passed, so
  // `tooMany` is exact. A project being deleted is skipped, like the bulk
  // edit skips it, and does not count.
  const moving: Doc<"projects">[] = [];
  const linking: Doc<"projects">[] = [];
  let tooMany = false;
  const budget = () => MERGE_PROJECT_LIMIT - moving.length - linking.length;
  for (const key of moveKeys) {
    const read = await liveProjectsOfKey(ctx, key, budget());
    moving.push(...read.rows);
    if (!read.complete) {
      tooMany = true;
      break;
    }
  }
  if (!tooMany) {
    // Projects that stay on their key but must point at the kept client.
    // Without a rename that is the kept key's own projects not yet linked
    // (all of them before the backfill has created its client row); with a
    // rename to a key outside the merge, any uncounted leftovers already on
    // that key.
    const linkKey = keepMoves ? (involved.has(keptKey) ? null : keptKey) : keep.key;
    if (linkKey !== null) {
      const keptClientId = keepMoves ? null : (keep.client?._id ?? null);
      const read = await liveProjectsOfKey(
        ctx,
        linkKey,
        budget(),
        (project) => keptClientId === null || project.clientId !== keptClientId
      );
      linking.push(...read.rows);
      if (!read.complete) tooMany = true;
    }
  }

  const projectCount = [keep, ...merged].reduce(
    (total, side) => total + (side.company?.projectCount ?? 0),
    0
  );
  return {
    keep,
    merged,
    keptName,
    keptKey,
    nameConflict,
    keepMoves,
    moving,
    linking,
    tooMany,
    projectCount,
  };
}

function projectRank(project: Doc<"projects">) {
  return project.dashboardFiscalYearRank ?? dashboardFiscalYearRank(project.fiscalYearEnd);
}

function projectKey(project: Doc<"projects">) {
  return project.dashboardCompanyKey ?? dashboardCompanyKey(project.clientName);
}

/**
 * Project numbers the merge makes appear twice: the same fiscal year and the
 * same number (trimmed, lowercase) on projects that came from at least two
 * different clients. Numbers that were already duplicated inside one client
 * are not the merge's doing and are not listed. Numbers are never changed.
 */
async function mergeNumberCollisions(ctx: Ctx, plan: MergePlan) {
  const pool = [...plan.moving];
  if (!plan.keepMoves) {
    const ranks = new Set<number>();
    for (const project of plan.moving) {
      if (project.projectNumber?.trim()) ranks.add(projectRank(project));
    }
    for (const rank of [...ranks].slice(0, MERGE_COLLISION_RANK_LIMIT)) {
      const rows = await ctx.db
        .query("projects")
        .withIndex("by_dashboardCompanyKey_and_dashboardFiscalYearRank", (q) =>
          q.eq("dashboardCompanyKey", plan.keep.key).eq("dashboardFiscalYearRank", rank)
        )
        .take(MERGE_COLLISION_RANK_READ);
      for (const row of rows) if (row.deletionStartedAt === undefined) pool.push(row);
    }
  }
  const groups = new Map<
    string,
    { rank: number; projectNumber: string; titles: string[]; keys: Set<string> }
  >();
  for (const project of pool) {
    const projectNumber = project.projectNumber?.trim().toLowerCase();
    if (!projectNumber) continue;
    const rank = projectRank(project);
    const groupKey = `${rank}\u0000${projectNumber}`;
    const group =
      groups.get(groupKey) ?? { rank, projectNumber, titles: [], keys: new Set<string>() };
    group.titles.push(project.title);
    group.keys.add(projectKey(project));
    groups.set(groupKey, group);
  }
  return [...groups.values()]
    .filter((group) => group.titles.length >= 2 && group.keys.size >= 2)
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        a.projectNumber.localeCompare(b.projectNumber, "en-CA", { numeric: true })
    )
    .map((group) => ({
      fiscalYear: group.rank === DASHBOARD_NO_FISCAL_YEAR_RANK ? null : -group.rank,
      projectNumber: group.projectNumber,
      titles: group.titles.sort((a, b) => a.localeCompare(b, "en-CA")),
    }));
}

export const previewClientMerge = query({
  args: mergeArgs,
  returns: v.object({
    projectCount: v.number(),
    movedCount: v.number(),
    tooMany: v.boolean(),
    keptName: v.string(),
    keptKey: v.string(),
    nameConflict: v.union(v.string(), v.null()),
    numberCollisions: v.array(
      v.object({
        fiscalYear: v.union(v.number(), v.null()),
        projectNumber: v.string(),
        titles: v.array(v.string()),
      })
    ),
  }),
  handler: async (ctx, args) => {
    // "Merge clients": Manager and Admin only.
    await requireRole(ctx, ["manager", "admin"]);
    const plan = await planClientMerge(ctx, args, { strictName: false });
    return {
      projectCount: plan.projectCount,
      // Projects whose client name changes; capped reads stop just past 200.
      movedCount: plan.moving.length,
      tooMany: plan.tooMany,
      keptName: plan.keptName,
      keptKey: plan.keptKey,
      nameConflict: plan.nameConflict,
      numberCollisions: await mergeNumberCollisions(ctx, plan),
    };
  },
});

export const mergeClients = mutation({
  args: mergeArgs,
  returns: v.object({
    moved: v.number(),
    keptKey: v.string(),
    keptName: v.string(),
    clientId: v.id("clients"),
  }),
  handler: async (ctx, args) => {
    // "Merge clients": Manager and Admin only.
    const user = await requireRole(ctx, ["manager", "admin"]);
    const plan = await planClientMerge(ctx, args, { strictName: true });
    if (plan.nameConflict !== null) clientExistsError(plan.nameConflict, plan.keptKey);
    if (plan.tooMany) {
      domainError(
        "INVALID_INPUT",
        `This merge would move more than ${MERGE_PROJECT_LIMIT} projects. Merge fewer clients at a time.`
      );
    }
    const now = Date.now();

    // 1. The kept client exists as an active row (created from its company
    //    row when the backfill has not reached it yet).
    const keptClientId =
      plan.keep.client?._id ??
      (await ctx.db.insert("clients", {
        name: sideName(plan.keep),
        nameKey: plan.keep.key,
        status: "active",
        createdBy: user._id,
        createdAt: now,
        updatedAt: now,
      }));

    // 2. Merged clients become tombstones pointing at the kept client; a
    //    merged company name without a client row gets one so the history
    //    exists. Done before any rename so two active rows never share a key.
    for (const side of plan.merged) {
      const tombstone = {
        status: "merged" as const,
        mergedIntoClientId: keptClientId,
        mergedAt: now,
        mergedBy: user._id,
        updatedAt: now,
      };
      if (side.client) {
        await ctx.db.patch(side.client._id, tombstone);
      } else {
        await ctx.db.insert("clients", {
          name: sideName(side),
          nameKey: side.key,
          createdBy: user._id,
          createdAt: now,
          ...tombstone,
        });
      }
    }

    // 3. A new name renames the kept client.
    if (plan.keptName !== sideName(plan.keep) || plan.keptKey !== plan.keep.key) {
      await ctx.db.patch(keptClientId, {
        name: plan.keptName,
        nameKey: plan.keptKey,
        updatedAt: now,
      });
    }

    // 4. Projects that stay on their key are linked first (read in the plan
    //    before anything moved onto the kept key; no updatedAt bump).
    for (const project of plan.linking) {
      await ctx.db.patch(project._id, { clientId: keptClientId });
    }

    // 5. Projects move: client name and clientId, then the dashboard
    //    projection (company counts, stage buckets, search text) follows in
    //    the same transaction. Project numbers are not changed.
    for (const project of plan.moving) {
      const patch = { clientName: plan.keptName, clientId: keptClientId, updatedAt: now };
      await ctx.db.patch(project._id, patch);
      await syncProjectDashboardFields(ctx, project._id, patch);
    }

    // 6. Every live project of the merged keys has moved, so a company row
    //    still standing for one of them only holds drifted counts; remove it
    //    so the name does not linger in the client list. If a live project
    //    is still on the key, the plan missed it: fail the whole transaction
    //    rather than delete a row that still counts it.
    const leftKeys = plan.merged.map((side) => side.key);
    if (plan.keepMoves) leftKeys.push(plan.keep.key);
    for (const key of leftKeys) {
      if (key === plan.keptKey) continue;
      const row = await dashboardCompanyForKey(ctx, key);
      if (!row) continue;
      const remaining = await liveProjectsOfKey(ctx, key, 0);
      if (remaining.rows.length > 0 || !remaining.complete) {
        throw new Error(
          `mergeClients invariant: live projects remain on merged key ${JSON.stringify(key)}`
        );
      }
      await ctx.db.delete(row._id);
    }

    return {
      moved: plan.moving.length,
      keptKey: plan.keptKey,
      keptName: plan.keptName,
      clientId: keptClientId,
    };
  },
});

// ─── Backfill (2026-10-14 amendment, "Backfill") ────────────────────────────
// Admin-run, resumable, dry-run first, runKey-fenced like
// dashboardBackfill.runStageCounts. One company per scheduled transaction:
// creates the active client for a dashboardCompanies row that has none
// (name = the row's clientName, nameKey = its companyKey) and sets
// `clientId` on that key's live projects, a page at a time. It only ever
// links a project to the client with its own key; it never joins two keys.
// Re-running is safe: existing clients and links are left as they are.

const CLIENTS_BACKFILL_RUN_PREFIX = "clients-v1";
const CLIENTS_BACKFILL_PROJECT_PAGE = 100;
const CLIENTS_BACKFILL_STALE_RUNNING_MS = 10 * 60 * 1000;

const backfillStatsValidator = v.object({
  companiesScanned: v.number(),
  clientsCreated: v.number(),
  projectsLinked: v.number(),
});

type BackfillStats = {
  companiesScanned: number;
  clientsCreated: number;
  projectsLinked: number;
};

const backfillStartValidator = v.object({
  started: v.boolean(),
  dryRun: v.boolean(),
  runKey: v.string(),
  reason: v.optional(v.string()),
});

type BackfillPending = {
  companyKey: string;
  clientId?: Id<"clients">;
  projectCursor: string;
};

async function scheduleClientsBackfillStep(
  ctx: MutationCtx,
  base: { runKey: string; runStartedAt: number; dryRun: boolean; actorId: Id<"users"> },
  afterKey: string | null,
  pending: BackfillPending | null,
  stats: BackfillStats
) {
  await ctx.scheduler.runAfter(0, internal.clients.backfillClientsStep, {
    runKey: base.runKey,
    runStartedAt: base.runStartedAt,
    dryRun: base.dryRun,
    actorId: base.actorId,
    afterKey,
    ...(pending ? { pending } : {}),
    stats,
  });
}

function clientsBackfillRunKey(dryRun: boolean) {
  return `${CLIENTS_BACKFILL_RUN_PREFIX}-${dryRun ? "dry" : "live"}`;
}

async function scheduleClientsBackfill(
  ctx: MutationCtx,
  actorId: Id<"users">,
  dryRun: boolean,
  force: boolean
) {
  const runKey = clientsBackfillRunKey(dryRun);
  const existing = await ctx.db
    .query("dashboardBackfillRuns")
    .withIndex("by_runKey", (q) => q.eq("runKey", runKey))
    .unique();
  const now = Date.now();
  // startedAt doubles as the run generation: a takeover always moves it
  // forward, and a step from an older chain stops when it no longer matches.
  const startedAt = existing ? Math.max(now, existing.startedAt + 1) : now;
  if (existing?.status === "running") {
    const stale = now - existing.startedAt > CLIENTS_BACKFILL_STALE_RUNNING_MS;
    if (!stale && !force) {
      return {
        started: false,
        dryRun,
        runKey,
        reason:
          "A run is already in progress. Pass force: true (or wait 10 minutes) to take it over.",
      };
    }
  }
  if (existing) {
    await ctx.db.patch(existing._id, {
      status: "running",
      dryRun,
      startedAt,
      completedAt: undefined,
      stats: undefined,
      note: undefined,
    });
  } else {
    await ctx.db.insert("dashboardBackfillRuns", {
      runKey,
      status: "running",
      dryRun,
      startedAt,
    });
  }
  await scheduleClientsBackfillStep(
    ctx,
    { runKey, runStartedAt: startedAt, dryRun, actorId },
    null,
    null,
    {
      companiesScanned: 0,
      clientsCreated: 0,
      projectsLinked: 0,
    }
  );
  return { started: true, dryRun, runKey };
}

/**
 * Admin entry point. Defaults to a dry run that writes nothing but the run
 * row's stats; `dryRun: false` applies. `force` takes over a stuck run.
 */
export const backfillClients = mutation({
  args: { dryRun: v.optional(v.boolean()), force: v.optional(v.boolean()) },
  returns: backfillStartValidator,
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, ["admin"]);
    return await scheduleClientsBackfill(ctx, user._id, args.dryRun ?? true, args.force ?? false);
  },
});

/** Internal twin for `npx convex run`; `actorId` becomes the clients' createdBy. */
export const backfillClientsInternal = internalMutation({
  args: {
    actorId: v.id("users"),
    dryRun: v.optional(v.boolean()),
    force: v.optional(v.boolean()),
  },
  returns: backfillStartValidator,
  handler: async (ctx, args) =>
    await scheduleClientsBackfill(ctx, args.actorId, args.dryRun ?? true, args.force ?? false),
});

/** The latest run of the clients backfill (dry or live) with its stats. */
export const getClientsBackfillRun = query({
  args: { dryRun: v.boolean() },
  returns: v.union(
    v.object({
      runKey: v.string(),
      status: v.union(v.literal("running"), v.literal("completed"), v.literal("failed")),
      dryRun: v.boolean(),
      startedAt: v.number(),
      completedAt: v.optional(v.number()),
      stats: v.optional(v.record(v.string(), v.number())),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin"]);
    const run = await ctx.db
      .query("dashboardBackfillRuns")
      .withIndex("by_runKey", (q) => q.eq("runKey", clientsBackfillRunKey(args.dryRun)))
      .unique();
    if (!run) return null;
    return {
      runKey: run.runKey,
      status: run.status,
      dryRun: run.dryRun,
      startedAt: run.startedAt,
      ...(run.completedAt !== undefined ? { completedAt: run.completedAt } : {}),
      ...(run.stats !== undefined ? { stats: run.stats } : {}),
    };
  },
});

export const backfillClientsStep = internalMutation({
  args: {
    runKey: v.string(),
    // The run generation this chain belongs to (the run row's startedAt).
    runStartedAt: v.number(),
    dryRun: v.boolean(),
    actorId: v.id("users"),
    // The last company key fully processed; null before the first.
    afterKey: v.union(v.string(), v.null()),
    // A company whose projects are still being linked, page by page.
    pending: v.optional(
      v.object({
        companyKey: v.string(),
        clientId: v.optional(v.id("clients")),
        projectCursor: v.string(),
      })
    ),
    stats: backfillStatsValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await ctx.db
      .query("dashboardBackfillRuns")
      .withIndex("by_runKey", (q) => q.eq("runKey", args.runKey))
      .unique();
    // A run that was taken over or finished elsewhere stops this chain.
    if (!run || run.status !== "running" || run.startedAt !== args.runStartedAt) return null;

    const stats: BackfillStats = { ...args.stats };
    let companyKey: string;
    let clientId: Id<"clients"> | undefined;
    let projectCursor: string | null;

    if (args.pending) {
      companyKey = args.pending.companyKey;
      projectCursor = args.pending.projectCursor;
      // Re-read every step: the client saved on an earlier page may have
      // been merged since. `pending.clientId` is ignored (kept in the
      // validator only so chains scheduled before this change still run).
      clientId = (await activeClientForKey(ctx, companyKey))?._id;
      if (clientId === undefined && !args.dryRun) {
        // No active client for this key any more (merged away): nothing to
        // link it to, so move on to the next company.
        await scheduleClientsBackfillStep(ctx, args, companyKey, null, stats);
        return null;
      }
    } else {
      const afterKey = args.afterKey;
      const company =
        afterKey === null
          ? await ctx.db.query("dashboardCompanies").withIndex("by_companyKey").first()
          : await ctx.db
              .query("dashboardCompanies")
              .withIndex("by_companyKey", (q) => q.gt("companyKey", afterKey))
              .first();
      if (!company) {
        await ctx.db.patch(run._id, {
          status: "completed",
          completedAt: Date.now(),
          stats: { ...stats },
        });
        return null;
      }
      stats.companiesScanned += 1;
      companyKey = company.companyKey;
      projectCursor = null;
      if (companyKey === DASHBOARD_UNNAMED_COMPANY_KEY) {
        // Unnamed projects get no client.
        await scheduleClientsBackfillStep(ctx, args, companyKey, null, stats);
        return null;
      }
      clientId = (await activeClientForKey(ctx, companyKey))?._id;
      if (!clientId) {
        stats.clientsCreated += 1;
        if (!args.dryRun) {
          const now = Date.now();
          clientId = await ctx.db.insert("clients", {
            name: company.clientName.trim() || companyKey,
            nameKey: companyKey,
            status: "active",
            createdBy: args.actorId,
            createdAt: now,
            updatedAt: now,
          });
        }
      }
    }

    const page = await ctx.db
      .query("projects")
      .withIndex("by_dashboardCompanyKey", (q) => q.eq("dashboardCompanyKey", companyKey))
      .paginate({ cursor: projectCursor, numItems: CLIENTS_BACKFILL_PROJECT_PAGE });
    for (const project of page.page) {
      if (project.deletionStartedAt !== undefined) continue;
      // A dry run has no client to compare with when one would be created.
      if (clientId !== undefined && project.clientId === clientId) continue;
      stats.projectsLinked += 1;
      if (!args.dryRun && clientId !== undefined) {
        await ctx.db.patch(project._id, { clientId });
      }
    }

    await scheduleClientsBackfillStep(
      ctx,
      args,
      page.isDone ? companyKey : args.afterKey,
      page.isDone
        ? null
        : { companyKey, projectCursor: page.continueCursor },
      stats
    );
    return null;
  },
});
