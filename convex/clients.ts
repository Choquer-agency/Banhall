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
import {
  activeClientAfterMerges,
  activeClientForKey,
  companyOtherNames,
  dashboardCompanyForKey,
  linkKeyProjects,
  mergedClientForKey,
  NameHistoryTooLongError,
} from "./lib/clients";
import { linkKeyProjectsPage } from "./companyFiles";
import { contactsInMerge, MERGE_COMPANY_CONTACT_LIMIT, moveContactsInMerge } from "./companyContacts";
import { validatedIndustry } from "./projects";
import {
  DASHBOARD_NO_FISCAL_YEAR_RANK,
  DASHBOARD_UNNAMED_COMPANY_KEY,
  dashboardCompanyKey,
  dashboardFiscalYearRank,
} from "../shared/dashboardProjection";
import { clientNamesLookAlike, isValidClientYearEnd } from "../shared/clientNames";
import { COMPANY_WEBSITE_INVALID, companyWebsiteProblem, normalizeCompanyWebsite } from "../shared/companyWebsite";
import { onCompanyWebsiteChanged } from "./companyWebsite";
import { userDisplayLabel } from "./lib/teamRoster";

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
/** Company files one merge may move (2026-10-26, Phase C); more refuses the merge. */
export const MERGE_COMPANY_FILE_LIMIT = 500;
/** Former names one company keeps (Phase C); a merge that would need more is refused. */
export const MAX_FORMER_NAMES = 200;
/**
 * Most project index rows one merge reads per key while looking for live
 * projects. Rows of projects being deleted are skipped but still read; a key
 * that is not exhausted within this many rows makes the merge refuse (the
 * same user-safe 200 message) rather than guess.
 */
const MERGE_KEY_SCAN_LIMIT = 2_000;
/** Most clients one merge may fold into the kept client. */
const MERGE_KEY_LIMIT = 20;
/**
 * Most kept-client project rows the number collision check reads, across
 * every fiscal year a numbered moving project falls in. Past this bound the
 * preview says the check is incomplete instead of silently missing a
 * collision.
 */
const MERGE_COLLISION_READ_LIMIT = 1_000;

const clientListEntryValidator = v.object({
  key: v.string(),
  clientId: v.union(v.id("clients"), v.null()),
  name: v.string(),
  projectCount: v.number(),
  fiscalYearEndMonth: v.optional(v.number()),
  fiscalYearEndDay: v.optional(v.number()),
  industry: v.optional(v.string()),
  // 2026-10-28 (All companies, "Last update"): the later of the company
  // row's last change and its projects' projection row's (a project added,
  // moved, removed or changing stage).
  updatedAt: v.optional(v.number()),
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
  updatedAt?: number;
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
    updatedAt: Math.max(client.updatedAt, company?.updatedAt ?? 0),
  };
}

function companyEntry(company: Doc<"dashboardCompanies">): ClientListEntry {
  return {
    key: company.companyKey,
    clientId: null,
    name: company.clientName,
    projectCount: company.projectCount,
    updatedAt: company.updatedAt,
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

/** The website to store for what was sent: undefined for none (empty), refused when it is not a usable website. */
function requireWebsite(raw: string | undefined): string | undefined {
  if (raw === undefined || !raw.trim()) return undefined;
  const website = normalizeCompanyWebsite(raw);
  if (!website) domainError("INVALID_INPUT", companyWebsiteProblem(raw) ?? COMPANY_WEBSITE_INVALID);
  return website;
}

function requireClientName(raw: string): string {
  const name = raw.trim();
  if (!name || dashboardCompanyKey(name) === DASHBOARD_UNNAMED_COMPANY_KEY) {
    domainError("INVALID_INPUT", "Enter a company name.");
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
    /** 2026-10-29: the company's website, read into a company file once saved. */
    website: v.optional(v.string()),
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
    const website = requireWebsite(args.website);
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
      ...(website ? { website } : {}),
      status: "active",
      nameHistoryComplete: true,
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    });
    // A key with no company row has no counted projects; link any uncounted
    // stragglers so the dual-write invariant holds from the start.
    await linkKeyProjects(ctx, key, clientId, MERGE_PROJECT_LIMIT);
    if (website) await onCompanyWebsiteChanged(ctx, clientId, website, user._id, now);
    return { clientId, key, name };
  },
});

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
      "One of the selected companies no longer exists. Refresh and try again."
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
  validateMergeKeys(args);

  let name: string | undefined;
  if (args.name !== undefined) {
    if (options.strictName || args.name.trim()) name = requireClientName(args.name);
  }

  const keep = await loadMergeSide(ctx, args.keepKey);
  const merged: MergeSide[] = [];
  for (const key of args.mergeKeys) merged.push(await loadMergeSide(ctx, key));
  return await planCompanyMove(ctx, keep, merged, name);
}

function validateMergeKeys(args: MergeArgs) {
  if (args.mergeKeys.length === 0) {
    domainError("INVALID_INPUT", "Select at least one company to merge.");
  }
  if (args.mergeKeys.length > MERGE_KEY_LIMIT) {
    domainError("INVALID_INPUT", `Merge at most ${MERGE_KEY_LIMIT} companies at a time.`);
  }
  if (new Set(args.mergeKeys).size !== args.mergeKeys.length) {
    domainError("INVALID_INPUT", "Each company can be merged only once.");
  }
  if (args.mergeKeys.includes(args.keepKey)) {
    domainError("INVALID_INPUT", "The company you keep cannot also be merged into itself.");
  }
  if (
    args.keepKey === DASHBOARD_UNNAMED_COMPANY_KEY ||
    args.mergeKeys.includes(DASHBOARD_UNNAMED_COMPANY_KEY)
  ) {
    domainError("INVALID_INPUT", "Projects without a company name cannot be merged.");
  }
}

/**
 * What folding `merged` into `keep` under `name` (or keep's own name) would
 * move and link (2026-10-14 merge; Edit company's rename, 2026-10-28, is the
 * same move with nothing merged). Reads every key until it is exhausted or
 * MERGE_PROJECT_LIMIT is passed; writes nothing.
 */
async function planCompanyMove(
  ctx: Ctx,
  keep: MergeSide,
  merged: MergeSide[],
  name: string | undefined
): Promise<MergePlan> {
  const mergeKeys = merged.map((side) => side.key);
  const keptName = name ?? sideName(keep);
  const keptKey = name ? dashboardCompanyKey(name) : keep.key;
  const involved = new Set([keep.key, ...mergeKeys]);
  let nameConflict: string | null = null;
  if (name && !involved.has(keptKey)) {
    const otherClient = await activeClientForKey(ctx, keptKey);
    const otherCompany = otherClient ? null : await dashboardCompanyForKey(ctx, keptKey);
    nameConflict = otherClient?.name ?? otherCompany?.clientName ?? null;
  }

  const keepMoves = keptKey !== keep.key || keptName !== sideName(keep);
  const moveKeys = keepMoves ? [keep.key, ...mergeKeys] : mergeKeys;
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
 *
 * When the kept client's own projects stay put, every kept project in each
 * fiscal year a numbered moving project falls in is read, by index, up to
 * MERGE_COLLISION_READ_LIMIT rows in all. `complete` is false when that bound
 * cut the read short, so a collision may be missing from the list.
 */
async function mergeNumberCollisions(ctx: Ctx, plan: MergePlan) {
  const pool = new Map<Id<"projects">, Doc<"projects">>();
  for (const project of [...plan.moving, ...plan.linking]) pool.set(project._id, project);
  let complete = true;
  if (!plan.keepMoves) {
    const ranks = new Set<number>();
    for (const project of plan.moving) {
      if (project.projectNumber?.trim()) ranks.add(projectRank(project));
    }
    let read = 0;
    for (const rank of ranks) {
      const left = MERGE_COLLISION_READ_LIMIT - read;
      // One row past the bound tells a cut read from an exhausted one.
      const rows = await ctx.db
        .query("projects")
        .withIndex("by_dashboardCompanyKey_and_dashboardFiscalYearRank", (q) =>
          q.eq("dashboardCompanyKey", plan.keep.key).eq("dashboardFiscalYearRank", rank)
        )
        .take(left + 1);
      for (const row of rows.slice(0, left)) {
        if (row.deletionStartedAt === undefined) pool.set(row._id, row);
      }
      read += Math.min(rows.length, left);
      if (rows.length > left) {
        complete = false;
        break;
      }
    }
  }
  const groups = new Map<
    string,
    { rank: number; projectNumber: string; titles: string[]; keys: Set<string> }
  >();
  for (const project of pool.values()) {
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
  const collisions = [...groups.values()]
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
  return { collisions, complete };
}

/**
 * The merged companies' files, which move to the kept company (Phase C),
 * read up to one past MERGE_COMPANY_FILE_LIMIT.
 */
async function mergedCompanyFiles(ctx: QueryCtx, plan: MergePlan): Promise<Doc<"companyFiles">[]> {
  const files: Doc<"companyFiles">[] = [];
  for (const side of plan.merged) {
    if (!side.client) continue;
    const clientId = side.client._id;
    const room = MERGE_COMPANY_FILE_LIMIT + 1 - files.length;
    if (room <= 0) break;
    files.push(
      ...(await ctx.db
        .query("companyFiles")
        .withIndex("by_clientId_and_archived", (q) => q.eq("clientId", clientId))
        .take(room))
    );
  }
  return files;
}

/** The merge's contacts (2026-11-04): the kept company's count and those that move. */
async function mergeContacts(ctx: QueryCtx, plan: MergePlan) {
  return await contactsInMerge(
    ctx,
    plan.keep.client?._id ?? null,
    plan.merged.flatMap((side) => (side.client ? [side.client._id] : []))
  );
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
    /** The collision check hit its read bound: numbers may repeat unlisted. */
    collisionCheckIncomplete: v.boolean(),
    /** Company files that move to the kept company (read up to one past the cap). */
    companyFileCount: v.number(),
    tooManyCompanyFiles: v.boolean(),
    /** Company contacts that move to the kept company (2026-11-04). */
    companyContactCount: v.number(),
    /** The kept company would end up with more than MERGE_COMPANY_CONTACT_LIMIT contacts. */
    tooManyCompanyContacts: v.boolean(),
  }),
  handler: async (ctx, args) => {
    // "Merge clients": Manager and Admin only.
    await requireRole(ctx, ["manager", "admin"]);
    const plan = await planClientMerge(ctx, args, { strictName: false });
    const check = await mergeNumberCollisions(ctx, plan);
    const files = await mergedCompanyFiles(ctx, plan);
    const contacts = await mergeContacts(ctx, plan);
    return {
      projectCount: plan.projectCount,
      // Projects whose client name changes; capped reads stop just past 200.
      movedCount: plan.moving.length,
      tooMany: plan.tooMany,
      keptName: plan.keptName,
      keptKey: plan.keptKey,
      nameConflict: plan.nameConflict,
      numberCollisions: check.collisions,
      collisionCheckIncomplete: !check.complete,
      companyFileCount: files.length,
      tooManyCompanyFiles: files.length > MERGE_COMPANY_FILE_LIMIT,
      companyContactCount: contacts.moving.length,
      tooManyCompanyContacts: contacts.tooMany,
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
        `This merge would move more than ${MERGE_PROJECT_LIMIT} projects. Merge fewer companies at a time.`
      );
    }
    const movingFiles = await mergedCompanyFiles(ctx, plan);
    if (movingFiles.length > MERGE_COMPANY_FILE_LIMIT) {
      domainError(
        "INVALID_INPUT",
        `This merge would move more than ${MERGE_COMPANY_FILE_LIMIT} company files. Merge fewer companies at a time.`
      );
    }
    // 2026-11-04 (company contacts): the merged companies' contacts move too,
    // and the kept company may end up with at most MERGE_COMPANY_CONTACT_LIMIT.
    const contacts = await mergeContacts(ctx, plan);
    if (contacts.tooMany) {
      domainError(
        "INVALID_INPUT",
        `The kept company would have more than ${MERGE_COMPANY_CONTACT_LIMIT} contacts. Merge fewer companies at a time, or remove some contacts first.`
      );
    }
    const movingContacts = contacts.moving;
    // The kept company's name history (Phase C): its own, its old name when
    // renamed, and each merged company's name and history, so company file
    // labels hide every name its files may carry.
    // Older rows' histories include their merge tombstones' names.
    const formerNames = new Set<string>();
    try {
      if (plan.keep.client) for (const name of await companyOtherNames(ctx, plan.keep.client)) formerNames.add(name);
      if (plan.keptName !== sideName(plan.keep)) formerNames.add(sideName(plan.keep));
      for (const side of plan.merged) {
        formerNames.add(sideName(side));
        if (side.client) for (const name of await companyOtherNames(ctx, side.client)) formerNames.add(name);
      }
    } catch (error) {
      if (!(error instanceof NameHistoryTooLongError)) throw error;
      domainError("INVALID_INPUT", "These companies have too many earlier merges to merge again here. Ask an admin for help.");
    }
    formerNames.delete(plan.keptName);
    if (formerNames.size > MAX_FORMER_NAMES) {
      domainError(
        "INVALID_INPUT",
        `The kept company would carry more than ${MAX_FORMER_NAMES} former names. Merge fewer companies at a time.`
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
        nameHistoryComplete: true,
        createdBy: user._id,
        createdAt: now,
        updatedAt: now,
      }));

    // 2. Merged clients become tombstones pointing at the kept client; a
    //    merged company name without a client row gets one so the history
    //    exists. Done before any rename so two active rows never share a key.
    //    Each records how many of its projects moved, for the note an old
    //    link to it shows on the company page (2026-10-28).
    for (const side of plan.merged) {
      const tombstone = {
        status: "merged" as const,
        mergedIntoClientId: keptClientId,
        mergedAt: now,
        mergedBy: user._id,
        mergedProjectCount: plan.moving.filter((project) => projectKey(project) === side.key).length,
        updatedAt: now,
      };
      if (side.client) {
        await ctx.db.patch(side.client._id, tombstone);
      } else {
        await ctx.db.insert("clients", {
          name: sideName(side),
          nameKey: side.key,
          nameHistoryComplete: true,
          createdBy: user._id,
          createdAt: now,
          ...tombstone,
        });
      }
    }

    // 2b. The merged companies' files move to the kept company in the same
    //     step (2026-10-26, Phase C), each logged on both companies. Their
    //     search pieces are cut again under the kept company; until then
    //     search skips them (a piece counts only for the file's company).
    for (const file of movingFiles) {
      await ctx.db.patch(file._id, {
        clientId: keptClientId,
        ...(file.hasText ? { searchPiecesDue: true as const, searchPiecesNextAt: 0, searchPiecesAttempts: undefined } : {}),
      });
      for (const [clientId, action, otherClientId] of [
        [file.clientId, "merge_out", keptClientId],
        [keptClientId, "merge_in", file.clientId],
      ] as const) {
        await ctx.db.insert("companyFileEvents", {
          clientId,
          companyFileId: file._id,
          fileName: file.fileName,
          action,
          otherClientId,
          userId: user._id,
          at: now,
        });
      }
    }

    // 2b'. A merged company's website file (2026-10-29) moved with its
    //      files; its website does not come along, so the file is archived
    //      rather than left feeding drafts with no website behind it.
    for (const side of plan.merged) {
      const websiteFileId = side.client?.websiteFileId;
      const file = websiteFileId ? movingFiles.find((moving) => moving._id === websiteFileId) : undefined;
      if (!file || file.archived === true) continue;
      await ctx.db.patch(file._id, { archived: true });
      await ctx.db.insert("companyFileEvents", {
        clientId: keptClientId,
        companyFileId: file._id,
        fileName: file.fileName,
        action: "archive",
        userId: user._id,
        at: now,
      });
    }

    // 2c. The merged companies' contacts (2026-11-04) move to the kept
    //     company; the kept company's main contact stays its main contact.
    await moveContactsInMerge(ctx, movingContacts, keptClientId, user._id, now);

    await ctx.db.patch(keptClientId, {
      ...(formerNames.size > 0 ? { formerNames: [...formerNames] } : {}),
      nameHistoryComplete: true,
    });

    // 3 to 6: the rename, links, moves and leftover company rows.
    await applyCompanyMove(ctx, plan, keptClientId, now);

    return {
      moved: plan.moving.length,
      keptKey: plan.keptKey,
      keptName: plan.keptName,
      clientId: keptClientId,
    };
  },
});

/**
 * Applies a planned move once the kept company has its row (merge steps 3 to
 * 6; Edit company's rename runs the same steps). The caller has already
 * refused a name conflict and a plan over the limit.
 */
async function applyCompanyMove(
  ctx: MutationCtx,
  plan: MergePlan,
  keptClientId: Id<"clients">,
  now: number
) {
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
}

// ─── Edit company (2026-10-28, the company page) ────────────────────────────
// Managers and Admins (the people who merge companies and archive company
// files) change a company's name, usual fiscal year end and industry. The
// year end and industry change the company row only; projects keep their
// own. A rename re-keys every live project exactly as a merge renames the
// kept company (the same plan and steps, with nothing merged), keeps the old
// name in `formerNames`, and is refused onto another company's name.

function sameYearEnd(
  client: Doc<"clients"> | null,
  month: number | undefined,
  day: number | undefined
) {
  return client?.fiscalYearEndMonth === month && client?.fiscalYearEndDay === day;
}

/** Every stale Edit company dialog is refused with the same words. */
const COMPANY_CHANGED =
  "This company changed since you opened Edit company. Close and try again.";

export const updateCompany = mutation({
  args: {
    key: v.string(),
    // The company as the dialog opened it: its name, its company row (null
    // for a company known only by its projects) and that row's last change.
    expectedName: v.string(),
    expectedClientId: v.union(v.id("clients"), v.null()),
    expectedUpdatedAt: v.union(v.number(), v.null()),
    name: v.string(),
    // Absent means not set: the dialog always sends the whole company.
    fiscalYearEndMonth: v.optional(v.number()),
    fiscalYearEndDay: v.optional(v.number()),
    industry: v.optional(v.string()),
    // 2026-10-29: absent leaves the website as it is (an older tab never
    // clears it); "" removes it.
    website: v.optional(v.string()),
  },
  returns: v.object({
    clientId: v.id("clients"),
    key: v.string(),
    name: v.string(),
    moved: v.number(),
  }),
  handler: async (ctx, args) => {
    // "Edit company": Manager and Admin only, as "Merge clients".
    const user = await requireRole(ctx, ["manager", "admin"]);
    if (args.key === DASHBOARD_UNNAMED_COMPANY_KEY) {
      domainError("INVALID_INPUT", "Projects with no company name are not a company. Name their company first.");
    }
    const name = requireClientName(args.name);
    if (!isValidClientYearEnd(args.fiscalYearEndMonth, args.fiscalYearEndDay)) {
      domainError(
        "INVALID_INPUT",
        "Enter a fiscal year end with both a month and a day that exists in that month."
      );
    }
    const keep: MergeSide = {
      key: args.key,
      client: await activeClientForKey(ctx, args.key),
      company: await dashboardCompanyForKey(ctx, args.key),
    };
    // A stale dialog never overwrites a change made since it opened: the
    // company left this key, its name changed, another company took the key
    // (a new row), or its year end or industry changed (a newer row).
    if (
      (!keep.client && !keep.company) ||
      sideName(keep) !== args.expectedName ||
      (keep.client?._id ?? null) !== args.expectedClientId ||
      (keep.client?.updatedAt ?? null) !== args.expectedUpdatedAt
    ) {
      domainError("STALE_REVISION", COMPANY_CHANGED);
    }
    // Only a changed industry is checked: the company's own, even one no
    // project uses, is kept by whoever may edit the company.
    const industry =
      args.industry !== undefined && args.industry === keep.client?.industry
        ? keep.client.industry
        : await validatedIndustry(ctx, args.industry);
    const website = args.website === undefined ? keep.client?.website : requireWebsite(args.website);
    const renames = name !== sideName(keep);
    const websiteChanges = keep.client?.website !== website;
    const detailsChange =
      !sameYearEnd(keep.client, args.fiscalYearEndMonth, args.fiscalYearEndDay) ||
      keep.client?.industry !== industry ||
      websiteChanges;
    if (!renames && !detailsChange && keep.client) {
      return { clientId: keep.client._id, key: keep.key, name, moved: 0 };
    }

    let plan: MergePlan | null = null;
    let formerNames: string[] | null = null;
    if (renames) {
      plan = await planCompanyMove(ctx, keep, [], name);
      if (plan.nameConflict !== null) {
        domainError(
          "CLIENT_EXISTS",
          `A company named ${plan.nameConflict} already exists. Merge them instead.`,
          { existingName: plan.nameConflict, existingKey: plan.keptKey }
        );
      }
      if (plan.tooMany) {
        domainError(
          "INVALID_INPUT",
          `This company has more than ${MERGE_PROJECT_LIMIT} projects, too many to rename at once. Ask an admin for help.`
        );
      }
      // The old name joins the company's history, so company file labels
      // still hide it; the history stays as complete as it was.
      const names = new Set(keep.client?.formerNames ?? []);
      names.add(sideName(keep));
      names.delete(name);
      if (names.size > MAX_FORMER_NAMES) {
        domainError(
          "INVALID_INPUT",
          `This company already has ${MAX_FORMER_NAMES} former names. Ask an admin for help.`
        );
      }
      formerNames = [...names];
    }

    const now = Date.now();
    // A company known only by its projects' name gets its row first, as a
    // merge or a first company file makes it.
    const clientId =
      keep.client?._id ??
      (await ctx.db.insert("clients", {
        name: sideName(keep),
        nameKey: keep.key,
        status: "active",
        nameHistoryComplete: true,
        createdBy: user._id,
        createdAt: now,
        updatedAt: now,
      }));
    if (plan) {
      await applyCompanyMove(ctx, plan, clientId, now);
    } else if (!keep.client) {
      // The new row's projects point at it, a page now and the rest in steps.
      await linkKeyProjectsPage(ctx, keep.key, clientId, null);
    }
    // Last, after the rename's own write: the details, and a last change
    // always later than before, even within the same millisecond, so an
    // older dialog's expectedUpdatedAt never matches again.
    await ctx.db.patch(clientId, {
      fiscalYearEndMonth: args.fiscalYearEndMonth,
      fiscalYearEndDay: args.fiscalYearEndDay,
      industry,
      website,
      ...(formerNames ? { formerNames } : {}),
      updatedAt: Math.max(now, (keep.client?.updatedAt ?? 0) + 1),
    });
    // A new website is read into a company file (never blocking the save);
    // a removed one archives its file.
    if (websiteChanges) await onCompanyWebsiteChanged(ctx, clientId, website, user._id, now);
    return {
      clientId,
      key: plan?.keptKey ?? keep.key,
      name: plan?.keptName ?? sideName(keep),
      moved: plan?.moving.length ?? 0,
    };
  },
});

// ─── The company page (2026-10-28) ──────────────────────────────────────────

// Fiscal year end and industry fall back to the company's newest project's
// values when the company has none saved (the clients backfill made rows
// without them; their projects carry `fiscalYearEnd` and `industry`).

/**
 * Rows read, latest fiscal year first, to find the company's latest year
 * end: enough for every live project of its latest fiscal year in all but
 * the largest companies, and for projects being deleted, which are skipped.
 */
const FALLBACK_YEAR_END_READ = 50;
/** Newest projects (by when they were made) read for an industry. */
const FALLBACK_INDUSTRY_READ = 25;
/**
 * Companies one year end read may ask about: All companies reads its column
 * in chunks of this many, so one read stays within 25 x 50 project rows.
 */
export const COMPANY_YEAR_END_KEY_LIMIT = 25;

/**
 * The month and day of the latest fiscal year end among a company's live
 * projects of its latest fiscal year, or null. The rank index puts the
 * latest fiscal year first; within it rows come in the order they were made,
 * so every row of that year is read (up to FALLBACK_YEAR_END_READ rows in
 * all) and the latest date wins (a short year and a full year in the same
 * fiscal year: the later one). Projects being deleted are skipped. A row the
 * rank backfill has not reached has no rank, so the index puts it first
 * whatever its year: its rank is worked out from its year end, and only a
 * ranked row past the latest year found ends the read.
 */
async function projectYearEnd(
  ctx: Ctx,
  key: string
): Promise<{ month: number; day: number } | null> {
  if (key === DASHBOARD_UNNAMED_COMPANY_KEY) return null;
  let latest: number | null = null;
  let latestRank = DASHBOARD_NO_FISCAL_YEAR_RANK;
  let read = 0;
  for await (const row of ctx.db
    .query("projects")
    .withIndex("by_dashboardCompanyKey_and_dashboardFiscalYearRank", (q) => q.eq("dashboardCompanyKey", key))
    .order("asc")) {
    const rank = projectRank(row);
    // Ranked rows come in rank order: one past the latest fiscal year found
    // means no later date follows.
    if (latest !== null && row.dashboardFiscalYearRank !== undefined && rank > latestRank) break;
    if (row.deletionStartedAt === undefined && row.fiscalYearEnd !== undefined) {
      if (latest === null || row.fiscalYearEnd > latest) latest = row.fiscalYearEnd;
      latestRank = Math.min(latestRank, rank);
    }
    read += 1;
    if (read >= FALLBACK_YEAR_END_READ) break;
  }
  if (latest === null) return null;
  const date = new Date(latest);
  return { month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

/**
 * The industry of the most recently updated live project that has one,
 * among the company's FALLBACK_INDUSTRY_READ newest projects (by when they
 * were made; no index orders a company's projects by their last update), or
 * null. An older project updated lately, past those 25, is not read.
 */
async function projectIndustry(ctx: Ctx, key: string): Promise<string | null> {
  if (key === DASHBOARD_UNNAMED_COMPANY_KEY) return null;
  const rows = await ctx.db
    .query("projects")
    .withIndex("by_dashboardCompanyKey", (q) => q.eq("dashboardCompanyKey", key))
    .order("desc")
    .take(FALLBACK_INDUSTRY_READ);
  let best: Doc<"projects"> | null = null;
  for (const row of rows) {
    if (row.deletionStartedAt !== undefined || !row.industry) continue;
    if (!best || row.updatedAt > best.updatedAt) best = row;
  }
  return best?.industry ?? null;
}

/**
 * All companies' Fiscal year end column for companies with none saved: each
 * key's latest project year end (as the company page shows it). At most
 * COMPANY_YEAR_END_KEY_LIMIT keys, each read by index up to
 * FALLBACK_YEAR_END_READ rows; keys with no project year end are left out.
 */
export const listCompanyYearEnds = query({
  args: { keys: v.array(v.string()) },
  returns: v.array(
    v.object({ key: v.string(), fiscalYearEndMonth: v.number(), fiscalYearEndDay: v.number() })
  ),
  handler: async (ctx, args) => {
    // D1: firm-wide read visibility for internal users.
    await requireInternalActor(ctx);
    if (args.keys.length > COMPANY_YEAR_END_KEY_LIMIT) {
      domainError("INVALID_INPUT", `Ask for at most ${COMPANY_YEAR_END_KEY_LIMIT} companies at a time.`);
    }
    const out: { key: string; fiscalYearEndMonth: number; fiscalYearEndDay: number }[] = [];
    for (const key of new Set(args.keys)) {
      const yearEnd = await projectYearEnd(ctx, key);
      if (yearEnd) out.push({ key, fiscalYearEndMonth: yearEnd.month, fiscalYearEndDay: yearEnd.day });
    }
    return out;
  },
});

// ─── The company profile (2026-11-04) ───────────────────────────────────────
// docs/product-domain.md "The company profile": the page header's "Client
// since" and team, the summary card, and the Details tab's record.

/** Projects read, oldest first, to find when the company's earliest live project was made. */
const CLIENT_SINCE_PROJECT_READ = 50;
/** Newest projects read for the people on this company (their owners). */
const COMPANY_TEAM_PROJECT_READ = 50;
/** Merge tombstones read for the dates the "also known as" names were merged. */
const FORMER_NAME_TOMBSTONE_READ = 50;

const companyTeamMemberValidator = v.object({ id: v.id("users"), name: v.string(), initials: v.string() });

/** Two letters from a display name ("Priya Nair" is "PN"), as the workflow pickers show them. */
function nameInitials(label: string): string {
  const parts = label.split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts.at(-1)?.[0] ?? ""}` : label.slice(0, 2)).toUpperCase();
}

/**
 * When the company became a client: the earliest `createdAt` among its live
 * projects (the first CLIENT_SINCE_PROJECT_READ by when they were made), else
 * the company row's `createdAt`, else null. A backfilled or merged row's
 * `createdAt` is not trusted while a project exists.
 */
async function companyClientSince(ctx: Ctx, key: string, client: Doc<"clients"> | null): Promise<number | null> {
  let earliest: number | null = null;
  let read = 0;
  for await (const project of ctx.db
    .query("projects")
    .withIndex("by_dashboardCompanyKey", (q) => q.eq("dashboardCompanyKey", key))
    .order("asc")) {
    read += 1;
    if (project.deletionStartedAt === undefined && (earliest === null || project.createdAt < earliest)) {
      earliest = project.createdAt;
    }
    if (read >= CLIENT_SINCE_PROJECT_READ) break;
  }
  return earliest ?? client?.createdAt ?? null;
}

/**
 * The Banhall people on this company: the distinct owners of its newest
 * COMPANY_TEAM_PROJECT_READ projects that are live, newest project first.
 */
async function companyTeam(ctx: Ctx, key: string) {
  const projects = await ctx.db
    .query("projects")
    .withIndex("by_dashboardCompanyKey", (q) => q.eq("dashboardCompanyKey", key))
    .order("desc")
    .take(COMPANY_TEAM_PROJECT_READ);
  const ownerIds: Id<"users">[] = [];
  for (const project of projects) {
    if (project.deletionStartedAt !== undefined || !project.ownerId || ownerIds.includes(project.ownerId)) continue;
    ownerIds.push(project.ownerId);
  }
  const team: { id: Id<"users">; name: string; initials: string }[] = [];
  for (const id of ownerIds) {
    const user = await ctx.db.get(id);
    if (!user) continue;
    const name = userDisplayLabel(user);
    team.push({ id, name, initials: nameInitials(name) });
  }
  return team;
}

/** The names merged into or renamed away from the company, with the merge date where a tombstone has it. */
async function companyFormerNames(ctx: Ctx, client: Doc<"clients">) {
  const tombstones = await ctx.db
    .query("clients")
    .withIndex("by_mergedIntoClientId", (q) => q.eq("mergedIntoClientId", client._id))
    .take(FORMER_NAME_TOMBSTONE_READ);
  const mergedAtByName = new Map<string, number>();
  for (const tombstone of tombstones) {
    if (tombstone.mergedAt !== undefined) mergedAtByName.set(tombstone.name, tombstone.mergedAt);
  }
  const names = [...new Set(client.formerNames ?? [])].filter((name) => name !== client.name);
  return names.map((name) => {
    const mergedAt = mergedAtByName.get(name);
    return mergedAt !== undefined ? { name, mergedAt } : { name };
  });
}

/** The summary card's fields, with the name of the person who last wrote it. */
async function companySummaryView(ctx: Ctx, client: Doc<"clients"> | null) {
  const summary = client?.summary;
  if (!summary) return null;
  const editor = summary.editedBy ? await ctx.db.get(summary.editedBy) : null;
  return {
    text: summary.text,
    ...(summary.aiDraftedFrom ? { aiDraftedFrom: summary.aiDraftedFrom } : {}),
    ...(summary.aiDraftedAt !== undefined ? { aiDraftedAt: summary.aiDraftedAt } : {}),
    ...(summary.editedBy ? { editedByName: editor ? userDisplayLabel(editor) : "A former team member" } : {}),
    ...(summary.editedAt !== undefined ? { editedAt: summary.editedAt } : {}),
  };
}

const mergedNoteValidator = v.object({
  /** The tombstone the note is about: closing it is kept per tombstone. */
  noteId: v.id("clients"),
  fromName: v.string(),
  mergedAt: v.number(),
  /** Projects that moved with it; null on merges made before it was kept. */
  projectCount: v.union(v.number(), v.null()),
});

/**
 * What `/companies/<key>` shows: the company (a saved client, or a name its
 * projects carry with no row yet) with its facts; for a key a merge took
 * away, the company it ended up in (the page opens that one); otherwise
 * missing. `mergedFrom` (the old key the page was sent from) adds the note
 * when that key's merge ended in this company.
 */
export const getCompanyPage = query({
  args: { key: v.string(), mergedFrom: v.optional(v.string()) },
  returns: v.union(
    v.object({
      kind: v.literal("company"),
      key: v.string(),
      clientId: v.union(v.id("clients"), v.null()),
      /** The company row's last change, which Edit company sends back (null with no row). */
      clientUpdatedAt: v.union(v.number(), v.null()),
      name: v.string(),
      projectCount: v.number(),
      fiscalYearEndMonth: v.optional(v.number()),
      fiscalYearEndDay: v.optional(v.number()),
      industry: v.optional(v.string()),
      /** The year end shown is the newest project's (the company has none saved). */
      fiscalYearEndFromProjects: v.boolean(),
      /** The industry shown is the newest project's (the company has none saved). */
      industryFromProjects: v.boolean(),
      /** A project has a year end: an emptied one shows it (Edit company says so). */
      hasProjectFiscalYearEnd: v.boolean(),
      /** A project has an industry: an emptied one shows it. */
      hasProjectIndustry: v.boolean(),
      /** 2026-10-29: the company's website, and how its latest read went. */
      website: v.optional(v.string()),
      websiteRead: v.union(
        v.object({
          status: v.union(v.literal("reading"), v.literal("read"), v.literal("failed")),
          reason: v.optional(v.string()),
          finishedAt: v.optional(v.number()),
        }),
        v.null()
      ),
      mergedNote: v.union(mergedNoteValidator, v.null()),
      // ── 2026-11-04 (the company profile) ──
      /** The earliest live project's creation, else the company row's; null with neither. */
      clientSince: v.union(v.number(), v.null()),
      /** The distinct owners of the newest 50 live projects, newest first. */
      team: v.array(companyTeamMemberValidator),
      /** The company summary, or null with none. */
      summary: v.union(
        v.object({
          text: v.string(),
          aiDraftedFrom: v.optional(v.string()),
          aiDraftedAt: v.optional(v.number()),
          editedByName: v.optional(v.string()),
          editedAt: v.optional(v.number()),
        }),
        v.null()
      ),
      /** Who added the company row (null with no row, or a removed user). */
      createdByName: v.union(v.string(), v.null()),
      /** The company's last change, as All companies' Last update. */
      updatedAt: v.union(v.number(), v.null()),
      /** Names merged into or renamed away from it, with the merge date where known. */
      formerNames: v.array(v.object({ name: v.string(), mergedAt: v.optional(v.number()) })),
    }),
    v.object({ kind: v.literal("merged"), key: v.string(), name: v.string() }),
    v.object({ kind: v.literal("missing") })
  ),
  handler: async (ctx, args) => {
    // D1: firm-wide read visibility for internal users.
    await requireInternalActor(ctx);
    const client = await activeClientForKey(ctx, args.key);
    const projection = await dashboardCompanyForKey(ctx, args.key);
    const entry =
      args.key === DASHBOARD_UNNAMED_COMPANY_KEY
        ? null
        : client
          ? clientEntry(client, projection)
          : projection
            ? companyEntry(projection)
            : null;
    if (entry) {
      let mergedNote = null;
      if (args.mergedFrom !== undefined && entry.clientId !== null && args.mergedFrom !== args.key) {
        const old = await mergedClientForKey(ctx, args.mergedFrom);
        const into = old ? await activeClientAfterMerges(ctx, old) : null;
        if (old && into?._id === entry.clientId) {
          mergedNote = {
            noteId: old._id,
            fromName: old.name,
            mergedAt: old.mergedAt ?? old.updatedAt,
            projectCount: old.mergedProjectCount ?? null,
          };
        }
      }
      // A value saved on the company wins; with none, its newest project's.
      // The projects' values are read either way, so Edit company can say
      // what an emptied field will show.
      const savedYearEnd =
        entry.fiscalYearEndMonth !== undefined && entry.fiscalYearEndDay !== undefined
          ? { month: entry.fiscalYearEndMonth, day: entry.fiscalYearEndDay }
          : null;
      const fromProjects = { yearEnd: await projectYearEnd(ctx, entry.key), industry: await projectIndustry(ctx, entry.key) };
      const yearEnd = savedYearEnd ?? fromProjects.yearEnd;
      const industry = entry.industry ?? fromProjects.industry;
      const creator = client ? await ctx.db.get(client.createdBy) : null;
      return {
        kind: "company" as const,
        key: entry.key,
        clientId: entry.clientId,
        clientUpdatedAt: client?.updatedAt ?? null,
        name: entry.name,
        projectCount: entry.projectCount,
        ...(yearEnd ? { fiscalYearEndMonth: yearEnd.month, fiscalYearEndDay: yearEnd.day } : {}),
        ...(industry ? { industry } : {}),
        fiscalYearEndFromProjects: savedYearEnd === null && yearEnd !== null,
        industryFromProjects: entry.industry === undefined && industry !== null,
        hasProjectFiscalYearEnd: fromProjects.yearEnd !== null,
        hasProjectIndustry: fromProjects.industry !== null,
        ...(client?.website ? { website: client.website } : {}),
        websiteRead:
          client?.website && client.websiteRead?.url === client.website
            ? {
                status: client.websiteRead.status,
                ...(client.websiteRead.reason ? { reason: client.websiteRead.reason } : {}),
                ...(client.websiteRead.finishedAt ? { finishedAt: client.websiteRead.finishedAt } : {}),
              }
            : null,
        mergedNote,
        clientSince: await companyClientSince(ctx, entry.key, client),
        team: await companyTeam(ctx, entry.key),
        summary: await companySummaryView(ctx, client),
        createdByName: creator ? userDisplayLabel(creator) : null,
        updatedAt: entry.updatedAt ?? null,
        formerNames: client ? await companyFormerNames(ctx, client) : [],
      };
    }
    const old = await mergedClientForKey(ctx, args.key);
    const into = old ? await activeClientAfterMerges(ctx, old) : null;
    if (into) return { kind: "merged" as const, key: into.nameKey, name: into.name };
    return { kind: "missing" as const };
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
            nameHistoryComplete: true,
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
