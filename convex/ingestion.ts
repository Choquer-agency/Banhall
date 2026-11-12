import {
  query,
  mutation,
  action,
  internalMutation,
  internalQuery,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import { v, type Infer } from "convex/values";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { importSource } from "./brain";
import { getCurrentUserOrNull } from "./lib/auth";
import { graphConfiguration } from "./lib/providerConfig";
import {
  changedFields,
  definedFields,
  labelPatchFields,
  mergeEditedLabels,
  pairGroupsTouched,
  pathFieldsFor,
  previewScienceCode,
  settleItem,
  sheetTabForStatus,
  type IngestionItemFields,
} from "./lib/ingestionSheet";
import {
  addShare,
  adjustImportCompanyCounts,
  countShareOf,
  emptyImportCounts,
  importCompanyRow,
  NO_COMPANY_KEY,
  writeImportCompany,
} from "./lib/importCompanyCounts";
import {
  checkReasonValidator,
  editableLabelValidator,
  importCategoryCountsValidator,
  importCountsValidator,
  ingestionCategoryValidator,
  pdVersionCodeValidator,
  scienceCodeSourceValidator,
  sheetLabelPatchValidator,
  sheetTabValidator,
} from "./lib/ingestionSheetValidators";
import {
  activeClientAfterMerges,
  activeClientForKey,
  dashboardCompanyForKey,
  mergedClientForKey,
} from "./lib/clients";
import { normalizeDashboardText } from "../shared/dashboardProjection";
import { normalizeCraScienceCode } from "../shared/craScienceCodes";

// ─── OneDrive corpus ingestion staging (BNH-17) ─────────────────────────────
// Human-in-the-loop bridge between the client's OneDrive and The Brain.
// Two feeders — the Graph delta sync (convex/ingestionSync.ts, Path A) and
// the local crawler upload endpoint (convex/http.ts, Path B) — stage files
// here; the admin reviews them at /admin/ingestion and each approval creates
// an approved brainSources row (which schedules its embedding). Nothing is
// ever auto-ingested — same gate as the rest of the Brain.

const SYNC_STATE_KEY = "onedrive";
// Statuses that participate in pair math / can still be acted on.
const LIVE_STATUSES = new Set(["discovered", "fetched", "pending_review", "approved"]);

async function assertAdmin(ctx: QueryCtx | MutationCtx): Promise<string> {
  const user = await getCurrentUserOrNull(ctx);
  if (!user || user.isAnonymous === true) throw new Error("Not authenticated");
  if (user.role !== "admin") throw new Error("Admin only");
  return user._id;
}

async function adminOrNull(ctx: QueryCtx): Promise<string | null> {
  const user = await getCurrentUserOrNull(ctx);
  return user?.role === "admin" && user.isAnonymous !== true ? user._id : null;
}

// ─── Writing an ingestion item (Import sheet, phase 2) ──────────────────────
// Every insert and patch of an ingestionItems row goes through insertItem or
// patchItem. They settle the row (convex/lib/ingestionSheet.ts: docKind
// follows category, companyKey follows clientName, fiscalYear follows
// fiscalYearEnd, pairGroupKey follows companyKey and fiscalYear, and the
// sheet fields follow the rest), then move the row's share between the
// company bands (convex/lib/importCompanyCounts.ts). The only other writes to
// these rows are recomputePairGroup (pairStatus and updatedAt), porting
// (convex/ingestionPort.ts, the ported* fields) and project erasure
// (convex/projects.ts, which clears the ported* fields): none of them writes
// a field the sheet fields or the counts are worked out from.

/** Insert an ingestion item: the one place rows are created. */
async function insertItem(ctx: MutationCtx, fields: IngestionItemFields): Promise<Id<"ingestionItems">> {
  const row = definedFields(settleItem(fields));
  const id = await ctx.db.insert("ingestionItems", row);
  await adjustImportCompanyCounts(ctx, null, row);
  return id;
}

/**
 * Patch an ingestion item: settles the patched row, writes only the fields
 * that changed and keeps the company counts right. With `touch`, updatedAt
 * moves only when something else changed.
 */
async function patchItem(
  ctx: MutationCtx,
  before: Doc<"ingestionItems">,
  patch: Partial<IngestionItemFields>,
  options: { touch?: boolean } = {}
): Promise<{ after: Doc<"ingestionItems">; changed: boolean }> {
  const { _id, _creationTime, ...fields } = before;
  let settled = settleItem({ ...fields, ...patch });
  let changes = changedFields(fields, settled);
  const changed = Object.keys(changes).length > 0;
  if (changed && options.touch) {
    settled = { ...settled, updatedAt: Date.now() };
    changes = { ...changes, updatedAt: settled.updatedAt };
  }
  if (changed) await ctx.db.patch(_id, changes);
  const after = { _id, _creationTime, ...definedFields(settled) } as Doc<"ingestionItems">;
  await adjustImportCompanyCounts(ctx, before, after);
  return { after, changed };
}

/**
 * Groups one recomputePairs run recomputes before it schedules itself for the
 * rest. A group read takes up to 300 whole rows, each about 10 KB with its
 * text preview, so two groups stay far under a transaction's read limit.
 */
const PAIR_GROUPS_PER_RUN = 2;

/**
 * Recompute pairing for the groups a write touched. A write to one row passes
 * `oneRow`: its current group (the first key) is recomputed in the same
 * mutation, as main did, and the group it left is scheduled. Writes to many
 * rows schedule every group, so no mutation reads more than one group on top
 * of its own rows.
 */
async function recomputeGroups(ctx: MutationCtx, groupKeys: Iterable<string>, oneRow: boolean) {
  const keys = [...new Set(groupKeys)];
  const now = oneRow ? keys.slice(0, 1) : [];
  for (const key of now) await recomputePairGroup(ctx, key);
  const later = keys.slice(now.length);
  if (later.length > 0) {
    await ctx.scheduler.runAfter(0, internal.ingestion.recomputePairs, { groupKeys: later });
  }
}

const ONE_ROW = true;
const MANY_ROWS = false;

/** Recompute pairStatus for one company and fiscal year group. It reads up to
 * 300 whole rows (each about 10 KB with its text preview), so a mutation
 * recomputes at most one group inline and recomputePairs two (recomputeGroups).
 * Non-live rows (rejected/failed) neither count nor carry a pairStatus.
 * Writes only pairStatus and updatedAt, which neither the sheet fields nor
 * the company counts read, so it patches directly. */
async function recomputePairGroup(ctx: MutationCtx, groupKey: string) {
  const items = await ctx.db
    .query("ingestionItems")
    .withIndex("by_pairGroupKey", (q) => q.eq("pairGroupKey", groupKey))
    .take(300);
  const live = items.filter((i) => LIVE_STATUSES.has(i.status));
  const pds = live.filter((i) => i.docKind === "pd").length;
  const transcripts = live.filter((i) => i.docKind === "transcript").length;
  for (const item of items) {
    let pairStatus: Doc<"ingestionItems">["pairStatus"];
    if (!LIVE_STATUSES.has(item.status)) {
      pairStatus = undefined;
    } else if (item.docKind === "pd") {
      pairStatus =
        pds > 1 ? "ambiguous_pd" : transcripts > 0 ? "paired" : "missing_transcript";
    } else if (item.docKind === "transcript") {
      pairStatus = pds > 0 ? "paired" : "missing_pd";
    } else {
      pairStatus = pds > 0 ? "paired" : undefined;
    }
    if (item.pairStatus !== pairStatus) {
      await ctx.db.patch(item._id, { pairStatus, updatedAt: Date.now() });
    }
  }
}

// ─── Admin dashboard queries ────────────────────────────────────────────────

export const ingestionStats = query({
  args: {},
  handler: async (ctx) => {
    if ((await adminOrNull(ctx)) === null) return null;
    const count = async (
      status: Doc<"ingestionItems">["status"]
    ): Promise<number> =>
      (
        await ctx.db
          .query("ingestionItems")
          .withIndex("by_status", (q) => q.eq("status", status))
          .take(1000)
      ).length;
    return {
      pendingReview: await count("pending_review"),
      discovered: await count("discovered"),
      fetched: await count("fetched"),
      approved: await count("approved"),
      rejected: await count("rejected"),
      failed: await count("failed"),
      deleted: await count("deleted"),
      graph: graphConfiguration(),
    };
  },
});

export const listItems = query({
  args: {
    status: v.union(
      v.literal("discovered"),
      v.literal("fetched"),
      v.literal("pending_review"),
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("failed"),
      v.literal("deleted")
    ),
  },
  handler: async (ctx, args) => {
    if ((await adminOrNull(ctx)) === null) return null;
    const items = await ctx.db
      .query("ingestionItems")
      .withIndex("by_status", (q) => q.eq("status", args.status))
      .order("desc")
      .take(300);
    // Newest first (Aug 18 request) — the index walk is already _creationTime
    // desc; keep it rather than re-sorting into client+FY groups.
    return items;
  },
});

/** Pairing gaps — "we need to get the transcript for this one" (Jun 19).
 * Non-live rows never carry a pairStatus, so these lists are review-relevant
 * by construction. */
export const listGaps = query({
  args: {},
  handler: async (ctx) => {
    if ((await adminOrNull(ctx)) === null) return null;
    const missingTranscript = await ctx.db
      .query("ingestionItems")
      .withIndex("by_pairStatus", (q) => q.eq("pairStatus", "missing_transcript"))
      .take(200);
    const missingPd = await ctx.db
      .query("ingestionItems")
      .withIndex("by_pairStatus", (q) => q.eq("pairStatus", "missing_pd"))
      .take(200);
    const ambiguous = await ctx.db
      .query("ingestionItems")
      .withIndex("by_pairStatus", (q) => q.eq("pairStatus", "ambiguous_pd"))
      .take(200);
    return { missingTranscript, missingPd, ambiguous };
  },
});

export const listSyncRuns = query({
  args: {},
  handler: async (ctx) => {
    if ((await adminOrNull(ctx)) === null) return null;
    return await ctx.db
      .query("oneDriveSyncRuns")
      .withIndex("by_startedAt")
      .order("desc")
      .take(20);
  },
});

// ─── Import sheet queries (2026-11-11, phase 2) ─────────────────────────────
// Admin only (null, or an empty page, for anyone else, like the queries
// above). Each returns slim rows (never the text preview) read through
// indexes and bounded.

const itemStatusValidator = v.union(
  v.literal("discovered"),
  v.literal("fetched"),
  v.literal("pending_review"),
  v.literal("approved"),
  v.literal("rejected"),
  v.literal("failed"),
  v.literal("deleted")
);

/** One file row on the sheet. */
const sheetRowFields = {
  _id: v.id("ingestionItems"),
  name: v.string(),
  category: ingestionCategoryValidator,
  // So the page can say "being read" (discovered, fetched) or "could not be read" (failed).
  status: itemStatusValidator,
  pdNumber: v.optional(v.string()),
  pdTitle: v.optional(v.string()),
  fiscalYearEnd: v.optional(v.number()),
  fiscalYearEndAssumed: v.optional(v.boolean()),
  versionCode: v.optional(pdVersionCodeValidator),
  versionNumber: v.optional(v.number()),
  writerName: v.optional(v.string()),
  writerInitials: v.optional(v.string()),
  reviewerInitials: v.optional(v.string()),
  scienceCode: v.optional(v.string()),
  scienceCodeSource: v.optional(scienceCodeSourceValidator),
  editedLabels: v.array(editableLabelValidator),
  needsCheck: v.boolean(),
  checkReasons: v.array(checkReasonValidator),
  size: v.number(),
  extractNote: v.optional(v.string()),
  error: v.optional(v.string()),
};
const sheetRowValidator = v.object(sheetRowFields);
type SheetRow = Infer<typeof sheetRowValidator>;

function sheetRow(item: Doc<"ingestionItems">): SheetRow {
  return definedFields({
    _id: item._id,
    name: item.name,
    category: item.category ?? "unknown",
    status: item.status,
    pdNumber: item.pdNumber,
    pdTitle: item.pdTitle,
    fiscalYearEnd: item.fiscalYearEnd,
    fiscalYearEndAssumed: item.fiscalYearEndAssumed,
    versionCode: item.versionCode,
    versionNumber: item.versionNumber,
    writerName: item.writerName,
    writerInitials: item.writerInitials,
    reviewerInitials: item.reviewerInitials,
    scienceCode: item.scienceCode,
    scienceCodeSource: item.scienceCodeSource,
    editedLabels: item.editedLabels ?? [],
    needsCheck: item.needsCheck ?? false,
    checkReasons: item.checkReasons ?? [],
    size: item.size,
    extractNote: item.extractNote,
    error: item.error,
  });
}

/** A page size the sheet may ask for, from 1 to `max`. */
function boundedPage<T extends { numItems: number }>(opts: T, max: number): T {
  const n = Number.isFinite(opts.numItems) ? Math.floor(opts.numItems) : max;
  return { ...opts, numItems: Math.min(Math.max(1, n), max) };
}

const EMPTY_PAGE = { page: [], isDone: true, continueCursor: "" };

/** Company bands read to sum the tab totals or to match a search. */
const SHEET_BAND_READ_LIMIT = 1000;
const SHEET_COMPANIES_PAGE_MAX = 100;
const SHEET_FILES_PAGE_MAX = 200;
const SHEET_SEARCH_FILES = 50;
const SHEET_SEARCH_COMPANIES = 20;

/**
 * The tab's totals, summed from the company bands: files, companies (bands
 * other than the no-company one), files that need a check, files ready
 * (no check needed and already read) and files still being read.
 * `complete` is false if there were more bands than it reads.
 */
export const sheetTotals = query({
  args: { tab: sheetTabValidator },
  returns: v.union(
    v.null(),
    v.object({
      files: v.number(),
      companies: v.number(),
      needsCheck: v.number(),
      ready: v.number(),
      beingRead: v.number(),
      complete: v.boolean(),
    })
  ),
  handler: async (ctx, args) => {
    if ((await adminOrNull(ctx)) === null) return null;
    const bands = await ctx.db
      .query("importCompanies")
      .withIndex("by_sheetTab_and_companyKey", (q) => q.eq("sheetTab", args.tab))
      .take(SHEET_BAND_READ_LIMIT + 1);
    const totals = { files: 0, companies: 0, needsCheck: 0, ready: 0, beingRead: 0 };
    for (const band of bands.slice(0, SHEET_BAND_READ_LIMIT)) {
      // A rebuild's start row has no files yet; it is not a company on the sheet.
      if (band.total <= 0) continue;
      totals.files += band.total;
      if (band.companyKey !== NO_COMPANY_KEY) totals.companies += 1;
      totals.needsCheck += band.needsCheck;
      totals.ready += band.ready;
      totals.beingRead += band.beingRead;
    }
    return { ...totals, complete: bands.length <= SHEET_BAND_READ_LIMIT };
  },
});

/** What the app already knows about a band's company, or null for a new one. */
const knownCompanyValidator = v.object({
  // name: an active company has this key; merge: a company merged into
  // `clientId` had it; projects: only projects have it (no company row).
  via: v.union(v.literal("name"), v.literal("merge"), v.literal("projects")),
  clientId: v.optional(v.id("clients")),
  name: v.string(),
  industry: v.optional(v.string()),
  fiscalYearEndMonth: v.optional(v.number()),
  fiscalYearEndDay: v.optional(v.number()),
});
type KnownCompany = Infer<typeof knownCompanyValidator>;

function fromClient(via: "name" | "merge", client: Doc<"clients">): KnownCompany {
  return definedFields({
    via,
    clientId: client._id,
    name: client.name,
    industry: client.industry,
    fiscalYearEndMonth: client.fiscalYearEndMonth,
    fiscalYearEndDay: client.fiscalYearEndDay,
  });
}

async function knownCompany(ctx: QueryCtx, companyKey: string): Promise<KnownCompany | null> {
  if (companyKey === NO_COMPANY_KEY) return null;
  const active = await activeClientForKey(ctx, companyKey);
  if (active) return fromClient("name", active);
  const merged = await mergedClientForKey(ctx, companyKey);
  const kept = merged ? await activeClientAfterMerges(ctx, merged) : null;
  if (kept) return fromClient("merge", kept);
  const projects = await dashboardCompanyForKey(ctx, companyKey);
  if (projects && projects.projectCount > 0) return { via: "projects", name: projects.clientName };
  return null;
}

const sheetBandValidator = v.object({
  companyKey: v.string(), // "" for files with no company yet
  displayName: v.string(),
  total: v.number(),
  needsCheck: v.number(),
  ready: v.number(),
  beingRead: v.number(),
  categories: v.record(v.string(), importCategoryCountsValidator),
  company: v.union(v.null(), knownCompanyValidator),
  // A company key the app does not know yet (never true for the no-company band).
  isNew: v.boolean(),
});

/**
 * A page of company bands for a tab in name order (the no-company band, key
 * "", comes first), or only those with a file that needs a check. Each band
 * carries its counts and what the app knows about that company.
 */
export const sheetCompanies = query({
  args: {
    tab: sheetTabValidator,
    onlyToCheck: v.boolean(),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(sheetBandValidator),
  handler: async (ctx, args) => {
    if ((await adminOrNull(ctx)) === null) return EMPTY_PAGE;
    const bands = args.onlyToCheck
      ? ctx.db
          .query("importCompanies")
          .withIndex("by_sheetTab_and_hasCheck_and_companyKey", (q) =>
            q.eq("sheetTab", args.tab).eq("hasCheck", true)
          )
      : ctx.db
          .query("importCompanies")
          .withIndex("by_sheetTab_and_companyKey", (q) => q.eq("sheetTab", args.tab));
    const result = await bands.paginate(boundedPage(args.paginationOpts, SHEET_COMPANIES_PAGE_MAX));
    const page = [];
    for (const band of result.page) {
      // A rebuild's start row has no files yet (rebuildImportCompanyCounts).
      if (band.total <= 0) continue;
      const company = await knownCompany(ctx, band.companyKey);
      page.push({
        companyKey: band.companyKey,
        displayName: band.displayName,
        total: band.total,
        needsCheck: band.needsCheck,
        ready: band.ready,
        beingRead: band.beingRead,
        categories: band.categories,
        company,
        isNew: band.companyKey !== NO_COMPANY_KEY && company === null,
      });
    }
    return { ...result, page };
  },
});

/**
 * A page of one section's files (one tab, company and category) in sortKey
 * order, or only the ones that need a check. companyKey "" lists the files
 * with no company.
 */
export const sheetFiles = query({
  args: {
    tab: sheetTabValidator,
    companyKey: v.string(),
    category: ingestionCategoryValidator,
    onlyToCheck: v.boolean(),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(sheetRowValidator),
  handler: async (ctx, args) => {
    if ((await adminOrNull(ctx)) === null) return EMPTY_PAGE;
    const companyKey = args.companyKey === NO_COMPANY_KEY ? undefined : args.companyKey;
    const files = args.onlyToCheck
      ? ctx.db
          .query("ingestionItems")
          .withIndex("by_sheetTab_and_companyKey_and_category_and_needsCheck_and_sortKey", (q) =>
            q
              .eq("sheetTab", args.tab)
              .eq("companyKey", companyKey)
              .eq("category", args.category)
              .eq("needsCheck", true)
          )
      : ctx.db
          .query("ingestionItems")
          .withIndex("by_sheetTab_and_companyKey_and_category_and_sortKey", (q) =>
            q.eq("sheetTab", args.tab).eq("companyKey", companyKey).eq("category", args.category)
          );
    const result = await files.paginate(boundedPage(args.paginationOpts, SHEET_FILES_PAGE_MAX));
    return { ...result, page: result.page.map(sheetRow) };
  },
});

const sheetSearchRowValidator = v.object({
  ...sheetRowFields,
  companyKey: v.string(), // "" for a file with no company
  clientName: v.optional(v.string()),
});

/**
 * Up to 50 files on the tab whose name matches the text (full text search,
 * the last word matching as a prefix), and up to 20 company bands whose name
 * contains it.
 */
export const sheetSearch = query({
  args: { tab: sheetTabValidator, text: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      files: v.array(sheetSearchRowValidator),
      companies: v.array(
        v.object({
          companyKey: v.string(),
          displayName: v.string(),
          total: v.number(),
          needsCheck: v.number(),
        })
      ),
    })
  ),
  handler: async (ctx, args) => {
    if ((await adminOrNull(ctx)) === null) return null;
    const text = args.text.trim().slice(0, 200);
    const needle = normalizeDashboardText(text);
    if (!needle) return { files: [], companies: [] };
    const files = await ctx.db
      .query("ingestionItems")
      .withSearchIndex("search_name", (q) => q.search("name", text).eq("sheetTab", args.tab))
      .take(SHEET_SEARCH_FILES);
    const bands = await ctx.db
      .query("importCompanies")
      .withIndex("by_sheetTab_and_companyKey", (q) => q.eq("sheetTab", args.tab))
      .take(SHEET_BAND_READ_LIMIT);
    // companyKey is the band's normalized name.
    const companies = bands
      .filter((band) => band.total > 0 && band.companyKey !== NO_COMPANY_KEY && band.companyKey.includes(needle))
      .slice(0, SHEET_SEARCH_COMPANIES)
      .map((band) => ({
        companyKey: band.companyKey,
        displayName: band.displayName,
        total: band.total,
        needsCheck: band.needsCheck,
      }));
    return {
      files: files.map((file) =>
        definedFields({
          ...sheetRow(file),
          companyKey: file.companyKey ?? NO_COMPANY_KEY,
          clientName: file.clientName,
        })
      ),
      companies,
    };
  },
});

/**
 * One file's labels for the side panel, with its path, when and how it was
 * added, and whether its text and original are stored. Never the text or a
 * file address.
 */
export const sheetFile = query({
  args: { id: v.id("ingestionItems") },
  returns: v.union(
    v.null(),
    v.object({
      ...sheetRowFields,
      sheetTab: v.optional(sheetTabValidator),
      companyKey: v.string(),
      clientName: v.optional(v.string()),
      fiscalYearLabel: v.optional(v.string()),
      path: v.string(),
      docKind: v.union(
        v.literal("pd"),
        v.literal("transcript"),
        v.literal("supporting"),
        v.literal("unknown")
      ),
      pairStatus: v.optional(
        v.union(
          v.literal("paired"),
          v.literal("missing_transcript"),
          v.literal("missing_pd"),
          v.literal("ambiguous_pd")
        )
      ),
      reviewNote: v.optional(v.string()),
      // When the row was first staged, and by which feeder. The person who
      // uploaded it is not recorded yet.
      addedAt: v.number(),
      addedVia: v.union(v.literal("onedrive_sync"), v.literal("folder_upload")),
      lastModifiedAt: v.number(),
      reviewedAt: v.optional(v.number()),
      hasText: v.boolean(),
      hasOriginal: v.boolean(),
    })
  ),
  handler: async (ctx, args) => {
    if ((await adminOrNull(ctx)) === null) return null;
    const item = await ctx.db.get(args.id);
    if (!item) return null;
    return definedFields({
      ...sheetRow(item),
      sheetTab: item.sheetTab,
      companyKey: item.companyKey ?? NO_COMPANY_KEY,
      clientName: item.clientName,
      fiscalYearLabel: item.fiscalYearLabel,
      path: item.path,
      docKind: item.docKind,
      pairStatus: item.pairStatus,
      reviewNote: item.reviewNote,
      addedAt: item._creationTime,
      // The crawler upload endpoint (convex/http.ts) keys its rows "local:<path>".
      addedVia: item.driveItemId.startsWith("local:") ? ("folder_upload" as const) : ("onedrive_sync" as const),
      lastModifiedAt: item.lastModifiedAt,
      reviewedAt: item.reviewedAt,
      hasText: Boolean(item.text?.trim()) || item.textStorageId !== undefined,
      hasOriginal: item.storageId !== undefined,
    });
  },
});

// ─── Review actions (the human in the loop) ─────────────────────────────────

/** Auth + preconditions for approval; runs with the caller's identity. */
export const getItemForApproval = internalQuery({
  args: { itemId: v.id("ingestionItems") },
  handler: async (ctx, args) => {
    await assertAdmin(ctx);
    const item = await ctx.db.get(args.itemId);
    if (!item) throw new Error("Ingestion item not found");
    if (item.status !== "pending_review") {
      throw new Error("Only items pending review can be approved");
    }
    if (!item.text?.trim() && !item.textStorageId) {
      throw new Error("No extracted text on this item — it cannot enter the Brain");
    }
    return item;
  },
});

export const finalizeApproval = internalMutation({
  args: {
    itemId: v.id("ingestionItems"),
    content: v.string(),
    industry: v.string(),
    writerName: v.optional(v.string()),
    writerTier: v.number(),
    scienceCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const admin = await assertAdmin(ctx);
    const item = await ctx.db.get(args.itemId);
    if (!item || item.status !== "pending_review") {
      throw new Error("Item is no longer pending review");
    }
    const docType =
      item.docKind === "pd"
        ? "pd"
        : item.docKind === "transcript"
          ? "transcript"
          : "supporting_doc";
    const title = [item.clientName, item.fiscalYearLabel, item.name]
      .filter(Boolean)
      .join(" — ");
    const sourceId = await importSource(
      ctx,
      {
        kind: "pd_pair",
        title,
        industry: args.industry.trim(),
        writerName: args.writerName?.trim() || undefined,
        writerTier: args.writerTier,
        docType,
        fiscalYear: item.fiscalYear,
        content: args.content,
        scienceCode: args.scienceCode?.trim() || undefined,
        approve: true,
      },
      admin
    );
    const { after } = await patchItem(ctx, item, {
      status: "approved",
      brainSourceId: sourceId,
      reviewedBy: admin,
      reviewedAt: Date.now(),
      updatedAt: Date.now(),
    });
    // The old group, and the new one if settling an old row moved it.
    await recomputeGroups(ctx, [after.pairGroupKey, item.pairGroupKey], ONE_ROW);
    return sourceId;
  },
});

/**
 * Approve one reviewed item into The Brain. An action (not a mutation)
 * because the full extracted text lives in storage; reuses brain.importSource
 * with approve=true (the review happening here IS the approval), so dedupe,
 * audit logging, and embed scheduling behave exactly like a curated import.
 */
export const approveItem = action({
  args: {
    itemId: v.id("ingestionItems"),
    industry: v.string(),
    writerName: v.optional(v.string()),
    writerTier: v.number(),
    scienceCode: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"brainSources">> => {
    if (
      !Number.isFinite(args.writerTier) ||
      args.writerTier < 0 ||
      args.writerTier > 1
    ) {
      throw new Error("Writer tier must be between 0 and 1");
    }
    if (!args.industry.trim()) throw new Error("Industry is required");
    const item = await ctx.runQuery(internal.ingestion.getItemForApproval, {
      itemId: args.itemId,
    });
    let content = item.text ?? "";
    if (item.textStorageId) {
      const blob = await ctx.storage.get(item.textStorageId);
      if (!blob) throw new Error("Extracted text not found in storage");
      content = await blob.text();
    }
    if (!content.trim()) {
      throw new Error("No extracted text on this item — it cannot enter the Brain");
    }
    return await ctx.runMutation(internal.ingestion.finalizeApproval, {
      itemId: args.itemId,
      content,
      industry: args.industry,
      writerName: args.writerName,
      writerTier: args.writerTier,
      scienceCode: args.scienceCode,
    });
  },
});

export const rejectItem = mutation({
  args: { itemId: v.id("ingestionItems"), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const admin = await assertAdmin(ctx);
    const item = await ctx.db.get(args.itemId);
    if (!item) throw new Error("Ingestion item not found");
    if (item.status === "approved") {
      throw new Error(
        "Already in the Brain — revoke it from the Brain admin page instead"
      );
    }
    if (item.status === "deleted") {
      throw new Error("Restore this item before rejecting it");
    }
    const { after } = await patchItem(ctx, item, {
      status: "rejected",
      pairStatus: undefined,
      reviewNote: args.note?.trim() || undefined,
      reviewedBy: admin,
      reviewedAt: Date.now(),
      updatedAt: Date.now(),
    });
    // The old group, and the new one if settling an old row moved it.
    await recomputeGroups(ctx, [after.pairGroupKey, item.pairGroupKey], ONE_ROW);
    return null;
  },
});

/**
 * Remove a staged item from active review without touching OneDrive or an
 * approved Brain source. The explicit deleted state keeps this reversible;
 * the prior queue state is restored exactly by restoreItem.
 */
export const removeItem = mutation({
  args: { itemId: v.id("ingestionItems") },
  handler: async (ctx, args) => {
    const admin = await assertAdmin(ctx);
    const item = await ctx.db.get(args.itemId);
    if (!item) throw new Error("Ingestion item not found");
    if (item.status === "approved") {
      throw new Error(
        "Already in the Brain — revoke it from the Brain admin page instead"
      );
    }
    if (item.status === "deleted") return null;
    if (
      item.status !== "pending_review" &&
      item.status !== "rejected" &&
      item.status !== "failed"
    ) {
      throw new Error("This file is still processing and cannot be deleted yet");
    }
    const now = Date.now();
    const { after } = await patchItem(ctx, item, {
      status: "deleted",
      pairStatus: undefined,
      deletedFromStatus: item.status,
      deletedBy: admin,
      deletedAt: now,
      updatedAt: now,
    });
    // The old group, and the new one if settling an old row moved it.
    await recomputeGroups(ctx, [after.pairGroupKey, item.pairGroupKey], ONE_ROW);
    return null;
  },
});

export const restoreItem = mutation({
  args: { itemId: v.id("ingestionItems") },
  handler: async (ctx, args) => {
    await assertAdmin(ctx);
    const item = await ctx.db.get(args.itemId);
    if (!item) throw new Error("Ingestion item not found");
    if (item.status !== "deleted") {
      throw new Error("Only deleted ingestion items can be restored");
    }
    const restoredStatus = item.deletedFromStatus ?? "pending_review";
    const { after } = await patchItem(ctx, item, {
      status: restoredStatus,
      deletedFromStatus: undefined,
      deletedBy: undefined,
      deletedAt: undefined,
      updatedAt: Date.now(),
    });
    // The old group, and the new one if settling an old row moved it.
    await recomputeGroups(ctx, [after.pairGroupKey, item.pairGroupKey], ONE_ROW);
    return null;
  },
});

/** Files one label edit may change. */
const SHEET_LABEL_MAX_FILES = 100;

/**
 * Change labels on up to 100 files of the review tab (2026-11-11, phase 2).
 * Each label set is marked in editedLabels, so a later move or new copy on
 * the drive keeps it. The row is settled (docKind, company key, fiscal year,
 * pairing key and sheet fields follow), the company counts move through
 * patchItem, and pairing for the groups the files left and joined is
 * scheduled (recomputePairs, two groups a run), so a 100-file edit never
 * reads whole pair groups in this transaction. A file a person makes a final
 * PD gets the science code its stored text preview gives, if it has none.
 * Approved or deleted files are refused before anything is written. Returns
 * how many files changed.
 */
export const setSheetLabels = mutation({
  args: {
    ids: v.array(v.id("ingestionItems")),
    patch: sheetLabelPatchValidator,
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    await assertAdmin(ctx);
    const ids = [...new Set(args.ids)];
    if (ids.length === 0) return 0;
    if (ids.length > SHEET_LABEL_MAX_FILES) {
      throw new Error(`Change up to ${SHEET_LABEL_MAX_FILES} files at a time.`);
    }
    const { fields, labels } = labelPatchFields(args.patch);

    const items: Array<Doc<"ingestionItems">> = [];
    for (const id of ids) {
      const item = await ctx.db.get(id);
      if (!item) throw new Error("One of these files is no longer in the import. Refresh and try again.");
      const tab = sheetTabForStatus(item.status);
      if (tab === "approved") {
        throw new Error(`"${item.name}" is already approved, so its labels cannot be changed here.`);
      }
      if (item.status === "rejected") {
        throw new Error(`"${item.name}" was rejected, so its labels cannot be changed here.`);
      }
      if (tab === "deleted") {
        throw new Error(`"${item.name}" is deleted. Restore it before changing its labels.`);
      }
      items.push(item);
    }

    let changed = 0;
    const groups = new Set<string>();
    for (const item of items) {
      const patch: Partial<IngestionItemFields> = {
        ...fields,
        editedLabels: mergeEditedLabels(item.editedLabels, labels),
      };
      if (fields.category === "final_pd" && item.category !== "final_pd") {
        // Extraction reads the code only for a file that was a final PD then.
        const { _id, _creationTime, ...stored } = item;
        Object.assign(patch, previewScienceCode(settleItem({ ...stored, ...patch })));
      }
      const result = await patchItem(ctx, item, patch, { touch: true });
      if (!result.changed) continue;
      changed += 1;
      for (const key of pairGroupsTouched(item, result.after)) groups.add(key);
    }
    await recomputeGroups(ctx, groups, MANY_ROWS);
    return changed;
  },
});

// ─── Sync trigger ───────────────────────────────────────────────────────────

export const startSync = mutation({
  args: {},
  handler: async (ctx) => {
    const admin = await assertAdmin(ctx);
    if (graphConfiguration().state !== "configured") {
      throw new Error(
        "Microsoft Graph is not configured — set MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MS_DRIVE_ID"
      );
    }
    const latest = await ctx.db
      .query("oneDriveSyncRuns")
      .withIndex("by_startedAt")
      .order("desc")
      .first();
    // Heartbeat-based staleness: a healthy continuation chain keeps patching
    // lastProgressAt, so long backlogs don't trip this; a crashed action goes
    // quiet and frees the lock after 15 minutes.
    const lastBeat = latest?.lastProgressAt ?? latest?.startedAt ?? 0;
    if (latest?.status === "running" && Date.now() - lastBeat < 15 * 60 * 1000) {
      throw new Error("A sync is already running");
    }
    const runId = await ctx.db.insert("oneDriveSyncRuns", {
      status: "running",
      triggeredBy: admin,
      startedAt: Date.now(),
      lastProgressAt: Date.now(),
      discovered: 0,
      processed: 0,
      skipped: 0,
    });
    await ctx.scheduler.runAfter(0, internal.ingestionSync.syncOneDrive, {
      runId,
    });
    return runId;
  },
});

// ─── Internal plumbing used by convex/ingestionSync.ts and http.ts ──────────

export const getSyncState = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("oneDriveSyncState")
      .withIndex("by_key", (q) => q.eq("key", SYNC_STATE_KEY))
      .unique();
  },
});

async function patchSyncState(
  ctx: MutationCtx,
  patch: { deltaLink?: string | undefined; nextLink?: string | undefined }
) {
  const existing = await ctx.db
    .query("oneDriveSyncState")
    .withIndex("by_key", (q) => q.eq("key", SYNC_STATE_KEY))
    .unique();
  if (existing) {
    await ctx.db.patch(existing._id, { ...patch, updatedAt: Date.now() });
  } else {
    await ctx.db.insert("oneDriveSyncState", {
      key: SYNC_STATE_KEY,
      ...patch,
      updatedAt: Date.now(),
    });
  }
}

/** Walk complete: store the deltaLink, clear any mid-walk checkpoint. */
export const saveDeltaLink = internalMutation({
  args: { deltaLink: v.string() },
  handler: async (ctx, args) => {
    await patchSyncState(ctx, { deltaLink: args.deltaLink, nextLink: undefined });
    return null;
  },
});

/** Mid-walk checkpoint so a large discovery resumes instead of replaying. */
export const saveNextLink = internalMutation({
  args: { nextLink: v.string() },
  handler: async (ctx, args) => {
    await patchSyncState(ctx, { nextLink: args.nextLink });
    return null;
  },
});

/** Graph 410 resyncRequired: drop cursors and re-walk from scratch. */
export const clearSyncCursor = internalMutation({
  args: {},
  handler: async (ctx) => {
    await patchSyncState(ctx, { deltaLink: undefined, nextLink: undefined });
    return null;
  },
});

const upsertFields = {
  driveItemId: v.string(),
  path: v.string(),
  name: v.string(),
  clientName: v.optional(v.string()),
  fiscalYearLabel: v.optional(v.string()),
  fiscalYear: v.optional(v.number()),
  docKind: v.union(
    v.literal("pd"),
    v.literal("transcript"),
    v.literal("supporting"),
    v.literal("unknown")
  ),
  size: v.number(),
  lastModifiedAt: v.number(),
  contentHash: v.string(),
  pairGroupKey: v.string(),
};

type UpsertArgs = {
  driveItemId: string;
  path: string;
  name: string;
  clientName?: string;
  fiscalYearLabel?: string;
  fiscalYear?: number;
  docKind: "pd" | "transcript" | "supporting" | "unknown";
  size: number;
  lastModifiedAt: number;
  contentHash: string;
  pairGroupKey: string;
};

/**
 * A science code read from the document belongs to the bytes it was read
 * from: clear it when the file goes back to be read again. A person's code stays.
 */
function documentCodeCleared(item: Doc<"ingestionItems">): Partial<IngestionItemFields> {
  return item.scienceCodeSource === "document"
    ? { scienceCode: undefined, scienceCodeSource: undefined }
    : {};
}

/**
 * Stage or refresh one drive item. The feeders send classify's view of the
 * path; the stored client, fiscal year, docKind, pairing key and labels are
 * worked out here from the path (pathFieldsFor, then settleItem), keeping
 * any label a person set. Adds the pair groups the write touched to `groups`.
 */
async function upsertDiscovered(
  ctx: MutationCtx,
  args: UpsertArgs,
  groups: Set<string>
): Promise<Id<"ingestionItems"> | null> {
  const existing = await ctx.db
    .query("ingestionItems")
    .withIndex("by_driveItemId", (q) => q.eq("driveItemId", args.driveItemId))
    .unique();
  const fromPath = pathFieldsFor(args.path, args.name, existing);
  if (!existing) {
    return await insertItem(ctx, {
      ...args,
      ...fromPath,
      status: "discovered",
      updatedAt: Date.now(),
    });
  }
  const noteGroups = (after: Doc<"ingestionItems">) => {
    for (const key of pairGroupsTouched(existing, after)) groups.add(key);
  };
  if (existing.contentHash === args.contentHash) {
    // Failed items with unchanged bytes still deserve a retry — a transient
    // download/extract error must not be permanent.
    if (existing.status === "failed") {
      const { after } = await patchItem(ctx, existing, {
        ...args,
        ...fromPath,
        ...documentCodeCleared(existing),
        status: "discovered",
        error: undefined,
        updatedAt: Date.now(),
      });
      noteGroups(after);
      return existing._id;
    }
    if (existing.status === "approved") {
      // An approved file keeps what it was approved as: the Brain (and a
      // project it was ported to) hold that client, year and kind. Patch only
      // what main patched; no label, client, year, docKind, category, pairing
      // key or count moves. (settleItem still fills the labels of a row
      // approved before they existed, from its approved client and year.)
      const { after } = await patchItem(ctx, existing, {
        path: args.path,
        name: args.name,
        lastModifiedAt: args.lastModifiedAt,
        updatedAt: Date.now(),
      });
      noteGroups(after);
      return null;
    }
    // Metadata-only change (rename or move) of a file on the review tab, or
    // a rejected or deleted one (so it is right if it is restored): keep the
    // review state (status, notes, reviewer). The client, fiscal year,
    // docKind and pairing key follow the new path like the labels do, so
    // approval and pairing see the company the sheet shows; both pair groups
    // are recomputed.
    const { after } = await patchItem(ctx, existing, {
      path: args.path,
      name: args.name,
      ...fromPath,
      lastModifiedAt: args.lastModifiedAt,
      updatedAt: Date.now(),
    });
    noteGroups(after);
    return null;
  }
  if (existing.status === "approved") {
    // Never silently reset an approved item: its brainSources row would go
    // stale with no revocation. Flag it for the admin instead.
    const { after } = await patchItem(ctx, existing, {
      extractNote:
        "Content changed in OneDrive after approval — re-review; the Brain still holds the earlier version",
      lastModifiedAt: args.lastModifiedAt,
      updatedAt: Date.now(),
    });
    noteGroups(after);
    return null;
  }
  // Content changed on the drive — back to the start of the pipeline.
  const { after } = await patchItem(ctx, existing, {
    ...args,
    ...fromPath,
    ...documentCodeCleared(existing),
    status: "discovered",
    text: undefined,
    textStorageId: undefined,
    extractNote: undefined,
    error: undefined,
    deletedFromStatus: undefined,
    deletedBy: undefined,
    deletedAt: undefined,
    updatedAt: Date.now(),
  });
  noteGroups(after);
  return existing._id;
}

/**
 * Upsert a discovered drive item. Returns the item id when it needs
 * fetching/extraction, or null when the stored copy is already current or the
 * item was already reviewed.
 */
export const upsertDiscoveredItem = internalMutation({
  args: upsertFields,
  handler: async (ctx, args): Promise<Id<"ingestionItems"> | null> => {
    const groups = new Set<string>();
    const id = await upsertDiscovered(ctx, args, groups);
    await recomputeGroups(ctx, groups, ONE_ROW);
    return id;
  },
});

/** Page-sized batch upsert for the delta walk (one mutation per Graph page
 * instead of one per file — keeps huge initial crawls inside action limits). */
export const upsertDiscoveredBatch = internalMutation({
  args: { items: v.array(v.object(upsertFields)) },
  handler: async (ctx, args): Promise<number> => {
    let inserted = 0;
    const groups = new Set<string>();
    for (const item of args.items.slice(0, 250)) {
      if ((await upsertDiscovered(ctx, item, groups)) !== null) inserted++;
    }
    // The batch already read up to 250 rows: schedule every group it touched.
    await recomputeGroups(ctx, groups, MANY_ROWS);
    return inserted;
  },
});

/** Graph delta reported the item deleted — retire it from the queue. */
export const markDriveItemRemoved = internalMutation({
  args: { driveItemId: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("ingestionItems")
      .withIndex("by_driveItemId", (q) => q.eq("driveItemId", args.driveItemId))
      .unique();
    if (!existing) return null;
    if (existing.status === "approved") {
      const { after } = await patchItem(ctx, existing, {
        extractNote:
          "Deleted in OneDrive after approval — the Brain still holds it; revoke from the Brain page if unwanted",
        updatedAt: Date.now(),
      });
      // Only an old row the write settled can have moved group.
      await recomputeGroups(ctx, pairGroupsTouched(existing, after), ONE_ROW);
      return null;
    }
    if (existing.status === "rejected" || existing.status === "deleted") return null;
    const { after } = await patchItem(ctx, existing, {
      status: "rejected",
      pairStatus: undefined,
      reviewNote: "Deleted in OneDrive",
      updatedAt: Date.now(),
    });
    // The old group, and the new one if settling an old row moved it.
    await recomputeGroups(ctx, [after.pairGroupKey, existing.pairGroupKey], ONE_ROW);
    return null;
  },
});

export const getItem = internalQuery({
  args: { itemId: v.id("ingestionItems") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.itemId);
  },
});

/**
 * Path B (crawler upload), and each PDF of the Graph path since 2026-10-26:
 * attach stored bytes and hand off to extraction in its own action.
 */
export const attachUpload = internalMutation({
  args: { itemId: v.id("ingestionItems"), storageId: v.id("_storage"), delayMs: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item || item.status !== "discovered") return null;
    const { after } = await patchItem(ctx, item, {
      storageId: args.storageId,
      status: "fetched",
      updatedAt: Date.now(),
    });
    // Only an old row the write settled can have moved group.
    await recomputeGroups(ctx, pairGroupsTouched(item, after), ONE_ROW);
    await ctx.scheduler.runAfter(
      Math.max(0, args.delayMs ?? 0),
      internal.ingestionSync.extractUploadedItem,
      { itemId: args.itemId }
    );
    return null;
  },
});

export const takeUnprocessedItems = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(1, Math.floor(args.limit)), 50);
    return await ctx.db
      .query("ingestionItems")
      .withIndex("by_status", (q) => q.eq("status", "discovered"))
      .take(limit);
  },
});

export const markItemProcessed = internalMutation({
  args: {
    itemId: v.id("ingestionItems"),
    storageId: v.id("_storage"),
    text: v.optional(v.string()),
    textStorageId: v.optional(v.id("_storage")),
    extractNote: v.optional(v.string()),
    // 2026-11-11 (Import sheet, phase 2): the CRA science code the
    // extraction read from the full text (lib/scienceCodeFromText.ts), if any.
    documentScienceCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    // Compare-and-set: never clobber a concurrent admin decision (e.g. a
    // reject that landed while this item's download was in flight).
    if (!item || (item.status !== "discovered" && item.status !== "fetched")) {
      return null;
    }
    // A final PD keeps the code its text gives, unless a person set one.
    const documentCode = normalizeCraScienceCode(args.documentScienceCode);
    const category = item.category ?? pathFieldsFor(item.path, item.name, item).category;
    const personCode =
      item.scienceCodeSource === "person" || (item.editedLabels ?? []).includes("scienceCode");
    const scienceCode =
      category === "final_pd" && documentCode !== undefined && !personCode
        ? { scienceCode: documentCode, scienceCodeSource: "document" as const }
        : {};
    const { after } = await patchItem(ctx, item, {
      ...scienceCode,
      storageId: args.storageId,
      text: args.text,
      textStorageId: args.textStorageId,
      extractNote: args.extractNote,
      // No text (pdf/legacy .doc) still lands in review — the admin can see
      // the file exists and chase a readable copy; it just can't be approved.
      status: "pending_review",
      error: undefined,
      updatedAt: Date.now(),
    });
    // The extraction recomputes the group it read; only an old row the
    // write settled can have moved to another.
    await recomputeGroups(ctx, pairGroupsTouched(item, after), ONE_ROW);
    return null;
  },
});

export const markItemFailed = internalMutation({
  args: { itemId: v.id("ingestionItems"), error: v.string() },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item || !LIVE_STATUSES.has(item.status) || item.status === "approved") {
      return null;
    }
    const { after } = await patchItem(ctx, item, {
      status: "failed",
      pairStatus: undefined,
      error: args.error.slice(0, 500),
      updatedAt: Date.now(),
    });
    // Failure changes the group's live membership — a failed lone PD must
    // surface the transcript's missing_pd gap, and vice versa.
    await recomputeGroups(ctx, [after.pairGroupKey, item.pairGroupKey], ONE_ROW);
    return null;
  },
});

const LABEL_BACKFILL_DEFAULT_BATCH = 100;
const LABEL_BACKFILL_MAX_BATCH = 200;

/**
 * One-off, owner-run (2026-11-11): fills the Import sheet labels on rows
 * staged before they existed, and corrects any that no longer match the
 * stored path. Since phase 2 it also settles each row (sheetTab, needsCheck,
 * checkReasons, sortKey, and docKind, client, fiscal year and pairing key
 * from the path, as a move now does) and counts it into importCompanies
 * through patchItem. A label a person set is kept. An approved row is not
 * re-read from its path (a move does not change it either): it is only
 * settled, and one approved before the labels existed gets them from its
 * approved client and year. Settling moves a row staged with main's pairing
 * key ("<client folder>::<year folder>") to the new key ("<company
 * key>::<year>"). A final PD read with no science code gets the one its
 * stored text preview gives. One page per run; it schedules the next page
 * until the table is done. Status, review notes and updatedAt are left alone;
 * the pair groups a row left and joined are recomputed by scheduled
 * recomputePairs runs. A row that already matches is skipped.
 */
export const backfillIngestionLabels = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    batchSize: v.optional(v.number()),
  },
  returns: v.object({ scanned: v.number(), updated: v.number(), done: v.boolean() }),
  handler: async (ctx, args) => {
    const requested = Number.isFinite(args.batchSize)
      ? Math.floor(args.batchSize!)
      : LABEL_BACKFILL_DEFAULT_BATCH;
    const batchSize = Math.min(Math.max(1, requested), LABEL_BACKFILL_MAX_BATCH);
    const page = await ctx.db
      .query("ingestionItems")
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize });
    let updated = 0;
    const groups = new Set<string>();
    for (const item of page.page) {
      const { _id, _creationTime, ...stored } = item;
      const patch: Partial<IngestionItemFields> =
        item.status === "approved" ? {} : pathFieldsFor(item.path, item.name, item);
      Object.assign(patch, previewScienceCode(settleItem({ ...stored, ...patch })));
      const { after, changed } = await patchItem(ctx, item, patch);
      if (!changed) continue;
      for (const key of pairGroupsTouched(item, after)) groups.add(key);
      updated += 1;
    }
    await recomputeGroups(ctx, groups, MANY_ROWS);
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.ingestion.backfillIngestionLabels, {
        cursor: page.continueCursor,
        batchSize,
      });
    }
    return { scanned: page.page.length, updated, done: page.isDone };
  },
});

const COUNTS_REBUILD_DEFAULT_PAGE = 100;
const COUNTS_REBUILD_MAX_PAGE = 200;
const COUNTS_REBUILD_MAX_RESTARTS = 3;

const countsRebuildProgressValidator = v.object({
  counts: importCountsValidator,
  displayName: v.string(),
  displayNameAt: v.number(),
  // The band row as it was when the first page was read.
  startedFrom: v.object({ id: v.id("importCompanies"), revision: v.number() }),
});

/**
 * Owner-run repair (2026-11-11): rebuild one company band's counts
 * (importCompanies) for one tab from its files. companyKey "" is the band for
 * files with no company. Reads one page of files per run in creation order
 * and schedules the next page with the running counts; the last page writes
 * the band, or deletes it when no file is left. If the band changed while it
 * paged (a file was written meanwhile), it starts again, up to three times,
 * rather than write counts that may miss that file.
 *
 * So that "changed" can always be seen, the first run makes sure the band row
 * exists: when it is missing it inserts one with zero counts (the sheet
 * queries skip a band with no files). Every later write to the band raises
 * its revision, or deletes the row when its total reaches zero, so a file
 * that moves in or out while it pages always shows at the end.
 */
export const rebuildImportCompanyCounts = internalMutation({
  args: {
    sheetTab: sheetTabValidator,
    companyKey: v.string(),
    cursor: v.optional(v.union(v.string(), v.null())),
    progress: v.optional(countsRebuildProgressValidator),
    restarts: v.optional(v.number()),
    pageSize: v.optional(v.number()),
  },
  returns: v.object({ scanned: v.number(), done: v.boolean(), written: v.boolean() }),
  handler: async (ctx, args) => {
    const requested = Number.isFinite(args.pageSize)
      ? Math.floor(args.pageSize!)
      : COUNTS_REBUILD_DEFAULT_PAGE;
    const pageSize = Math.min(Math.max(1, requested), COUNTS_REBUILD_MAX_PAGE);
    const restarts = args.restarts ?? 0;
    let band = await importCompanyRow(ctx, args.sheetTab, args.companyKey);
    if (!band && !args.progress) {
      const id = await ctx.db.insert("importCompanies", {
        sheetTab: args.sheetTab,
        companyKey: args.companyKey,
        displayName: "",
        ...emptyImportCounts(),
        hasCheck: false,
        revision: 1,
        updatedAt: Date.now(),
      });
      band = await ctx.db.get(id);
    }
    const marker = band ? { id: band._id, revision: band.revision } : null;
    const progress = args.progress ?? {
      counts: emptyImportCounts(),
      displayName: "",
      displayNameAt: -1,
      startedFrom: marker!,
    };

    const page = await ctx.db
      .query("ingestionItems")
      .withIndex("by_sheetTab_and_companyKey", (q) =>
        q
          .eq("sheetTab", args.sheetTab)
          .eq("companyKey", args.companyKey === NO_COMPANY_KEY ? undefined : args.companyKey)
      )
      .paginate({ cursor: args.cursor ?? null, numItems: pageSize });

    let { counts, displayName, displayNameAt } = progress;
    for (const item of page.page) {
      const share = countShareOf(item);
      if (!share) continue;
      counts = addShare(counts, share, 1);
      // The band shows the client name of the latest file written.
      if (item.clientName !== undefined && item.updatedAt >= displayNameAt) {
        displayName = item.clientName;
        displayNameAt = item.updatedAt;
      }
    }
    const scanned = page.page.length;
    const base = { sheetTab: args.sheetTab, companyKey: args.companyKey, pageSize };

    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.ingestion.rebuildImportCompanyCounts, {
        ...base,
        cursor: page.continueCursor,
        progress: { counts, displayName, displayNameAt, startedFrom: progress.startedFrom },
        restarts,
      });
      return { scanned, done: false, written: false };
    }

    const started = progress.startedFrom;
    const unchanged = marker !== null && marker.id === started.id && marker.revision === started.revision;
    if (!unchanged) {
      if (restarts >= COUNTS_REBUILD_MAX_RESTARTS) {
        console.warn("rebuildImportCompanyCounts: the band kept changing; run it again later", {
          sheetTab: args.sheetTab,
          companyKey: args.companyKey,
        });
        // Leave no empty band behind.
        if (band && band.total <= 0) await ctx.db.delete(band._id);
        return { scanned, done: true, written: false };
      }
      await ctx.scheduler.runAfter(0, internal.ingestion.rebuildImportCompanyCounts, {
        ...base,
        restarts: restarts + 1,
      });
      return { scanned, done: false, written: false };
    }

    // A band has one row per tab and key; remove any extra a bad write left.
    const rows = await ctx.db
      .query("importCompanies")
      .withIndex("by_sheetTab_and_companyKey", (q) =>
        q.eq("sheetTab", args.sheetTab).eq("companyKey", args.companyKey)
      )
      .take(10);
    for (const extra of rows.slice(1)) await ctx.db.delete(extra._id);
    await writeImportCompany(
      ctx,
      args.sheetTab,
      args.companyKey,
      rows[0] ?? null,
      counts,
      displayName === "" ? undefined : displayName
    );
    return { scanned, done: true, written: true };
  },
});

const TAB_REPAIR_DEFAULT_PAGE = 50;
const TAB_REPAIR_MAX_PAGE = 100;

/**
 * Owner-run repair (2026-11-11): rebuild every company band of one tab.
 * First it walks the distinct company keys of the tab's files through the
 * by_sheetTab_and_companyKey index (one read per key: the first file past
 * the last key) and schedules rebuildImportCompanyCounts for each, including
 * the no-company band. Then it walks the tab's band rows and deletes each one
 * whose company has no file left on the tab; a band that has files was
 * rebuilt by the first part. Each run handles up to `pageSize` keys or bands
 * and schedules the next run; `rebuildPageSize` is passed to the rebuilds.
 */
export const repairImportCompanyTab = internalMutation({
  args: {
    sheetTab: sheetTabValidator,
    // "files" (the default): the company keys after `afterKey` (absent at the
    // start, which also checks for files with no company). "bands": the band
    // rows from `cursor`.
    stage: v.optional(v.union(v.literal("files"), v.literal("bands"))),
    afterKey: v.optional(v.string()),
    cursor: v.optional(v.union(v.string(), v.null())),
    pageSize: v.optional(v.number()),
    rebuildPageSize: v.optional(v.number()),
  },
  returns: v.object({ rebuilds: v.number(), removed: v.number(), done: v.boolean() }),
  handler: async (ctx, args) => {
    const requested = Number.isFinite(args.pageSize) ? Math.floor(args.pageSize!) : TAB_REPAIR_DEFAULT_PAGE;
    const pageSize = Math.min(Math.max(1, requested), TAB_REPAIR_MAX_PAGE);
    const base = {
      sheetTab: args.sheetTab,
      pageSize,
      ...(args.rebuildPageSize === undefined ? {} : { rebuildPageSize: args.rebuildPageSize }),
    };
    const filesOf = (companyKey: string) =>
      ctx.db
        .query("ingestionItems")
        .withIndex("by_sheetTab_and_companyKey", (q) =>
          q
            .eq("sheetTab", args.sheetTab)
            .eq("companyKey", companyKey === NO_COMPANY_KEY ? undefined : companyKey)
        );

    if ((args.stage ?? "files") === "files") {
      let rebuilds = 0;
      const rebuild = async (companyKey: string) => {
        await ctx.scheduler.runAfter(0, internal.ingestion.rebuildImportCompanyCounts, {
          sheetTab: args.sheetTab,
          companyKey,
          ...(args.rebuildPageSize === undefined ? {} : { pageSize: args.rebuildPageSize }),
        });
        rebuilds += 1;
      };
      if (args.afterKey === undefined && (await filesOf(NO_COMPANY_KEY).first())) {
        await rebuild(NO_COMPANY_KEY);
      }
      // Company keys are never "" (dashboardCompanyKey), so "" starts the walk.
      let last = args.afterKey ?? "";
      while (rebuilds < pageSize) {
        const next = await ctx.db
          .query("ingestionItems")
          .withIndex("by_sheetTab_and_companyKey", (q) =>
            q.eq("sheetTab", args.sheetTab).gt("companyKey", last)
          )
          .first();
        if (!next || next.companyKey === undefined) {
          await ctx.scheduler.runAfter(0, internal.ingestion.repairImportCompanyTab, {
            ...base,
            stage: "bands" as const,
          });
          return { rebuilds, removed: 0, done: false };
        }
        await rebuild(next.companyKey);
        last = next.companyKey;
      }
      await ctx.scheduler.runAfter(0, internal.ingestion.repairImportCompanyTab, {
        ...base,
        stage: "files" as const,
        afterKey: last,
      });
      return { rebuilds, removed: 0, done: false };
    }

    const page = await ctx.db
      .query("importCompanies")
      .withIndex("by_sheetTab_and_companyKey", (q) => q.eq("sheetTab", args.sheetTab))
      .paginate({ cursor: args.cursor ?? null, numItems: pageSize });
    let removed = 0;
    for (const band of page.page) {
      if (await filesOf(band.companyKey).first()) continue;
      await ctx.db.delete(band._id);
      removed += 1;
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.ingestion.repairImportCompanyTab, {
        ...base,
        stage: "bands" as const,
        cursor: page.continueCursor,
      });
    }
    return { rebuilds: 0, removed, done: page.isDone };
  },
});

/**
 * Recompute pairing for the given groups: the first two in this mutation,
 * then it schedules itself for the rest, so each run reads at most two groups.
 */
export const recomputePairs = internalMutation({
  args: { groupKeys: v.array(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const keys = [...new Set(args.groupKeys)];
    for (const key of keys.slice(0, PAIR_GROUPS_PER_RUN)) {
      await recomputePairGroup(ctx, key);
    }
    const rest = keys.slice(PAIR_GROUPS_PER_RUN);
    if (rest.length > 0) {
      await ctx.scheduler.runAfter(0, internal.ingestion.recomputePairs, { groupKeys: rest });
    }
    return null;
  },
});

export const updateSyncRun = internalMutation({
  args: {
    runId: v.id("oneDriveSyncRuns"),
    status: v.optional(v.union(v.literal("completed"), v.literal("failed"))),
    error: v.optional(v.string()),
    addDiscovered: v.optional(v.number()),
    addProcessed: v.optional(v.number()),
    addSkipped: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return null;
    await ctx.db.patch(args.runId, {
      ...(args.status ? { status: args.status, completedAt: Date.now() } : {}),
      ...(args.error ? { error: args.error.slice(0, 500) } : {}),
      discovered: run.discovered + (args.addDiscovered ?? 0),
      processed: run.processed + (args.addProcessed ?? 0),
      skipped: run.skipped + (args.addSkipped ?? 0),
      lastProgressAt: Date.now(),
    });
    return null;
  },
});
