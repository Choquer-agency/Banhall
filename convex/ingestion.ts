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
import { domainError } from "./lib/contracts";
import { graphConfiguration } from "./lib/providerConfig";
import {
  changedFields,
  cleanWriterName,
  definedFields,
  fieldsForLabels,
  followsRememberedWriter,
  hasReadText,
  labelPatchFields,
  mergeEditedLabels,
  pairGroupsTouched,
  pathFieldsFor,
  previewScienceCode,
  rememberedWriterFields,
  settleItem,
  sheetTabForStatus,
  writerInitialsKey,
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
  batchResultValidator,
  checkReasonValidator,
  editableLabelValidator,
  importCategoryCountsValidator,
  importCountsValidator,
  ingestionCategoryValidator,
  pdVersionCodeValidator,
  scienceCodeSourceValidator,
  sheetLabelPatchValidator,
  sheetTabValidator,
  writerNameSourceValidator,
} from "./lib/ingestionSheetValidators";
import {
  activeClientAfterMerges,
  activeClientForKey,
  dashboardCompanyForKey,
  mergedClientForKey,
} from "./lib/clients";
import { dashboardCompanyKey, normalizeDashboardText } from "../shared/dashboardProjection";
import { normalizeCraScienceCode } from "../shared/craScienceCodes";
import { industrySlug } from "../shared/industries";
import {
  canDelete,
  canPutBack,
  DELETED_IN_ONEDRIVE_NOTE,
  deletedReasonFor,
  labelApplies,
  type BatchSkipReason,
} from "../shared/importSheetRules";

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

/**
 * The writer a person said some initials stand for, by initials, as one
 * mutation has read them (2026-11-12). A batch passes one so it reads each
 * match once; a mutation that writes a match fills it with the new value.
 */
type RememberedWriters = Map<string, string | null>;

async function rememberedWriter(
  ctx: QueryCtx,
  initials: string,
  memo?: RememberedWriters
): Promise<string | null> {
  if (memo?.has(initials)) return memo.get(initials) ?? null;
  const match = await ctx.db
    .query("importWriterInitials")
    .withIndex("by_initials", (q) => q.eq("initials", initials))
    .first();
  const name = match?.writerName ?? null;
  memo?.set(initials, name);
  return name;
}

/**
 * A settled row with the writer its initials stand for (2026-11-12): every
 * write of a row that follows the remembered initials (not approved, no
 * writer a person set on the file) reads the match, so a new file, a file
 * put back or renamed, and a match made or undone all show the same name.
 */
async function settleWithWriter(
  ctx: MutationCtx,
  row: IngestionItemFields,
  memo?: RememberedWriters
): Promise<IngestionItemFields> {
  const settled = settleItem(row);
  if (!followsRememberedWriter(settled)) return settled;
  const initials = writerInitialsKey(settled.writerInitials);
  const name = initials === null ? null : await rememberedWriter(ctx, initials, memo);
  const writer = rememberedWriterFields(settled, name);
  return Object.keys(writer).length === 0 ? settled : settleItem({ ...settled, ...writer });
}

/** Insert an ingestion item: the one place rows are created. */
async function insertItem(ctx: MutationCtx, fields: IngestionItemFields): Promise<Id<"ingestionItems">> {
  const row = definedFields(await settleWithWriter(ctx, fields));
  const id = await ctx.db.insert("ingestionItems", row);
  await adjustImportCompanyCounts(ctx, null, row);
  return id;
}

/**
 * Patch an ingestion item: settles the patched row, writes only the fields
 * that changed and keeps the company counts right. With `touch`, updatedAt
 * moves only when something else changed. `writers` lets a batch read each
 * remembered writer once.
 */
async function patchItem(
  ctx: MutationCtx,
  before: Doc<"ingestionItems">,
  patch: Partial<IngestionItemFields>,
  options: { touch?: boolean; writers?: RememberedWriters } = {}
): Promise<{ after: Doc<"ingestionItems">; changed: boolean }> {
  const { _id, _creationTime, ...fields } = before;
  let settled = await settleWithWriter(ctx, { ...fields, ...patch }, options.writers);
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
  // 2026-11-12: "initials" when the name is the writer a person said the
  // file name's initials stand for (no AI mark: the file name and a person).
  writerNameSource: v.optional(writerNameSourceValidator),
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
  // Why a file is on the Deleted tab (2026-11-11, phase 3b;
  // shared/importSheetRules.ts deletedReasonFor): a person deleted it in
  // Import, it was removed in OneDrive (its review note says so, even if a
  // person deleted it after), or it was rejected on the old review page.
  // "Put back" takes every kind but a file removed in OneDrive.
  deletedReason: v.optional(
    v.union(v.literal("deleted"), v.literal("removed_in_onedrive"), v.literal("rejected"))
  ),
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
    writerNameSource: item.writerNameSource,
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
    deletedReason: deletedReasonFor(item),
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
  // A new company's industry, as a person picked it on the sheet
  // (2026-11-12, importNewCompanies): a slug from the app's industry list.
  pickedIndustry: v.optional(v.string()),
});

/** What a person picked on the sheet for a company the app does not have yet. */
async function newCompanyPicks(ctx: QueryCtx, companyKey: string): Promise<Doc<"importNewCompanies"> | null> {
  return await ctx.db
    .query("importNewCompanies")
    .withIndex("by_companyKey", (q) => q.eq("companyKey", companyKey))
    .first();
}

/**
 * A page of company bands for a tab in name order (the no-company band, key
 * "", comes first), or only those with a file that needs a check. Each band
 * carries its counts, with each category's check reasons for the section's
 * note ("9 need a writer"), what the app knows about that company (its
 * industry among it), and for a new company the industry a person picked on
 * the sheet (2026-11-12).
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
      const isNew = band.companyKey !== NO_COMPANY_KEY && company === null;
      const picks = isNew ? await newCompanyPicks(ctx, band.companyKey) : null;
      page.push(
        definedFields({
          companyKey: band.companyKey,
          displayName: band.displayName,
          total: band.total,
          needsCheck: band.needsCheck,
          ready: band.ready,
          beingRead: band.beingRead,
          categories: band.categories,
          company,
          isNew,
          pickedIndustry: picks?.industry,
        })
      );
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
          .withIndex("by_sheetTab_companyKey_category_needsCheck_sortKey", (q) =>
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
      hasText: hasReadText(item),
      hasOriginal: item.storageId !== undefined,
    });
  },
});

// ─── Review actions (the human in the loop) ─────────────────────────────────

// Refusals people read (2026-11-11, phase 3b fixes: plain words, as they
// reach the Import page's toasts), shared by the single-file mutations below.
const ITEM_NOT_FOUND = "This file is no longer in Import.";
const ALREADY_IN_BRAIN = "This file is already approved into the Brain. Remove it from the Brain page instead.";
const STILL_PROCESSING = "This file is still processing and cannot be deleted yet";
const ONLY_DELETED_RESTORE = "This file is not deleted, so there is nothing to put back.";

/** Auth + preconditions for approval; runs with the caller's identity. */
export const getItemForApproval = internalQuery({
  args: { itemId: v.id("ingestionItems") },
  handler: async (ctx, args) => {
    await assertAdmin(ctx);
    const item = await ctx.db.get(args.itemId);
    if (!item) throw new Error(ITEM_NOT_FOUND);
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
    if (!item) throw new Error(ITEM_NOT_FOUND);
    if (item.status === "approved") throw new Error(ALREADY_IN_BRAIN);
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

/** Why a staged item cannot be deleted, or null when it can (or already is). */
function removalRefusal(item: Doc<"ingestionItems">): string | null {
  if (item.status === "approved") return ALREADY_IN_BRAIN;
  if (item.status === "deleted") return null;
  if (!canDelete(item.status)) return STILL_PROCESSING;
  return null;
}

/** The deleted state for an item: reversible, restoreItem puts the old status back. */
function removedFields(item: Doc<"ingestionItems">, admin: string): Partial<IngestionItemFields> {
  const now = Date.now();
  return {
    status: "deleted",
    pairStatus: undefined,
    deletedFromStatus: item.status as NonNullable<Doc<"ingestionItems">["deletedFromStatus"]>,
    deletedBy: admin,
    deletedAt: now,
    updatedAt: now,
  };
}

/** The status a deleted item goes back to, with its deletion cleared (restoreItem, the old page). */
function restoredFields(item: Doc<"ingestionItems">): Partial<IngestionItemFields> {
  return {
    status: item.deletedFromStatus ?? "pending_review",
    deletedFromStatus: undefined,
    deletedBy: undefined,
    deletedAt: undefined,
    updatedAt: Date.now(),
  };
}

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
    if (!item) throw new Error(ITEM_NOT_FOUND);
    const refusal = removalRefusal(item);
    if (refusal) throw new Error(refusal);
    if (item.status === "deleted") return null;
    const { after } = await patchItem(ctx, item, removedFields(item, admin));
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
    if (!item) throw new Error(ITEM_NOT_FOUND);
    if (item.status !== "deleted") throw new Error(ONLY_DELETED_RESTORE);
    const { after } = await patchItem(ctx, item, restoredFields(item));
    // The old group, and the new one if settling an old row moved it.
    await recomputeGroups(ctx, [after.pairGroupKey, item.pairGroupKey], ONE_ROW);
    return null;
  },
});

// ─── The Import page's batch calls (2026-11-11, phase 3b fixes) ─────────────
// setSheetLabels, removeItems and restoreItems take up to 100 files and never
// refuse the whole call for one file: each file they cannot change is left as
// it is and named in `skipped` with why (shared/importSheetRules.ts
// BatchSkipReason), and `changedIds` is exactly what the call changed. Only a
// call that is wrong in itself (more than 100 files, a value no file can take)
// is refused, before anything is written.

/** Files one Import page call may change, delete or put back. */
const SHEET_BATCH_MAX_FILES = 100;

/** Put-back files read again are spaced like the sync's PDFs (ingestionSync.ts PDF_READ_SPACING_MS). */
const PUT_BACK_READ_SPACING_MS = 2_000;

type BatchResult = Infer<typeof batchResultValidator>;

/** What one batch call changed and left, as it goes. */
function batchOutcome() {
  const changedIds: Array<Id<"ingestionItems">> = [];
  const skipped: BatchResult["skipped"] = [];
  return {
    changed: (id: Id<"ingestionItems">) => changedIds.push(id),
    skip: (id: Id<"ingestionItems">, reason: BatchSkipReason) => skipped.push({ id, reason }),
    result: (): BatchResult => ({ changed: changedIds.length, changedIds, skipped }),
  };
}

/**
 * The ids of one Import page batch, once each; refuses more than the
 * batch limit with `tooMany`. Refusals here are ConvexErrors so the page
 * can show their words (a plain Error's message never reaches a deployed page).
 */
function batchIds(ids: Array<Id<"ingestionItems">>, tooMany: string): Array<Id<"ingestionItems">> {
  const unique = [...new Set(ids)];
  if (unique.length > SHEET_BATCH_MAX_FILES) domainError("INVALID_INPUT", tooMany);
  return unique;
}

/** Why removeItems leaves a file as it is, or null when it deletes it (removeItem's rules). */
function removalSkip(item: Doc<"ingestionItems"> | null): BatchSkipReason | null {
  if (!item) return "missing";
  if (item.status === "approved") return "approved";
  if (item.status === "deleted") return "already_deleted";
  if (!canDelete(item.status)) return "being_read";
  return null;
}

/**
 * Delete up to 100 files from the Import page (2026-11-11, phase 3b), with
 * removeItem's rules: a file that is missing, approved, already deleted or
 * still being read is skipped with its reason, and the rest are deleted.
 * Counts move through patchItem; pairing for every group touched is scheduled.
 */
export const removeItems = mutation({
  args: { ids: v.array(v.id("ingestionItems")) },
  returns: batchResultValidator,
  handler: async (ctx, args) => {
    const admin = await assertAdmin(ctx);
    const ids = batchIds(args.ids, `Delete up to ${SHEET_BATCH_MAX_FILES} files at a time.`);
    const outcome = batchOutcome();
    const groups = new Set<string>();
    for (const id of ids) {
      const item = await ctx.db.get(id);
      const skip = removalSkip(item);
      if (skip || !item) {
        outcome.skip(id, skip ?? "missing");
        continue;
      }
      const { after } = await patchItem(ctx, item, removedFields(item, admin));
      groups.add(after.pairGroupKey);
      groups.add(item.pairGroupKey);
      outcome.changed(id);
    }
    await recomputeGroups(ctx, groups, MANY_ROWS);
    return outcome.result();
  },
});

/** Why restoreItems leaves a file as it is, or null when it puts it back (canPutBack). */
function putBackSkip(item: Doc<"ingestionItems"> | null): BatchSkipReason | null {
  if (!item) return "missing";
  const deletedReason = deletedReasonFor(item);
  if (deletedReason === "removed_in_onedrive") return "removed_in_onedrive";
  if (!canPutBack({ status: item.status, deletedReason })) return "not_on_tab";
  return null;
}

/**
 * The status a put-back file takes on To review, so it is never stranded:
 * - deleted while waiting for review or after it could not be read: that status;
 * - otherwise (rejected, now or before it was deleted, so the status it had
 *   before is not known), from what it holds: text read from it, or bytes
 *   with a reading note but no text (a scan), waits for review; an error from
 *   reading means it could not be read; bytes stored but never read go back
 *   to be read ("fetched", and extractUploadedItem is scheduled, as for an
 *   upload); nothing stored goes back to "discovered", which the next
 *   OneDrive sync fetches and reads (takeUnprocessedItems).
 */
function putBackStatus(item: Doc<"ingestionItems">): "pending_review" | "failed" | "fetched" | "discovered" {
  const from = item.status === "deleted" ? item.deletedFromStatus : undefined;
  if (from === "pending_review" || from === "failed") return from;
  if (hasReadText(item)) return "pending_review";
  if (item.error !== undefined) return "failed";
  if (item.storageId !== undefined) return item.extractNote !== undefined ? "pending_review" : "fetched";
  return "discovered";
}

/** A put-back file: on To review again, its deletion and any rejection undone. */
function putBackFields(item: Doc<"ingestionItems">): Partial<IngestionItemFields> {
  return {
    status: putBackStatus(item),
    deletedFromStatus: undefined,
    deletedBy: undefined,
    deletedAt: undefined,
    reviewNote: undefined,
    reviewedBy: undefined,
    reviewedAt: undefined,
    updatedAt: Date.now(),
  };
}

/**
 * Put back up to 100 files on the Deleted tab (2026-11-11, phase 3b; the
 * Undo after a delete and "Put back"): each returns to To review in the
 * state its data calls for (putBackStatus), a file to be read again is
 * handed to extraction, a few seconds apart. A file that is missing, not on
 * the Deleted tab, or removed in OneDrive is skipped with its reason. The
 * old page's restoreItem still returns a file to the status it was deleted from.
 */
export const restoreItems = mutation({
  args: { ids: v.array(v.id("ingestionItems")) },
  returns: batchResultValidator,
  handler: async (ctx, args) => {
    await assertAdmin(ctx);
    const ids = batchIds(args.ids, `Put back up to ${SHEET_BATCH_MAX_FILES} files at a time.`);
    const outcome = batchOutcome();
    const groups = new Set<string>();
    let reads = 0;
    for (const id of ids) {
      const item = await ctx.db.get(id);
      const skip = putBackSkip(item);
      if (skip || !item) {
        outcome.skip(id, skip ?? "missing");
        continue;
      }
      const { after } = await patchItem(ctx, item, putBackFields(item));
      if (after.status === "fetched") {
        await ctx.scheduler.runAfter(reads * PUT_BACK_READ_SPACING_MS, internal.ingestionSync.extractUploadedItem, {
          itemId: id,
        });
        reads += 1;
      }
      groups.add(after.pairGroupKey);
      groups.add(item.pairGroupKey);
      outcome.changed(id);
    }
    await recomputeGroups(ctx, groups, MANY_ROWS);
    return outcome.result();
  },
});

/**
 * The company name a typed one is stored as (2026-11-11, phase 3b fixes): an
 * existing company's own spelling wins, so typing "cedarline systems" or
 * "Cédarline Systems" files into Cedarline Systems and never renames it. The
 * active company with the typed name's key first, then a band with that key
 * on any tab (its display name), then the name projects give a company with
 * no company row; only a key that matches nothing keeps the typed name, as
 * labelPatchFields cleaned it (trimmed, inner spaces collapsed).
 */
async function companyNameToStore(ctx: MutationCtx, typed: string): Promise<string> {
  const key = dashboardCompanyKey(typed);
  const company = await activeClientForKey(ctx, key);
  if (company) return company.name;
  for (const tab of ["review", "approved", "deleted"] as const) {
    const band = await importCompanyRow(ctx, tab, key);
    if (band && band.displayName.trim()) return band.displayName;
  }
  const projects = await dashboardCompanyForKey(ctx, key);
  if (projects && projects.projectCount > 0 && projects.clientName.trim()) return projects.clientName;
  return typed;
}

/**
 * Change labels on up to 100 files of the review tab (2026-11-11, phase 2;
 * per file since the phase 3b fixes). Each file gets the patch's labels that
 * apply to it (shared/importSheetRules.ts labelApplies, judged by the
 * category it has after the change, the rule the page offers by); a file to
 * which none apply, or that is no longer on To review or no longer exists,
 * is skipped with its reason. A patch wrong in itself (an unknown science
 * code, a bad version) refuses the whole call before anything is written.
 * Each label set is marked in editedLabels, so a later move or new copy on
 * the drive keeps it. The row is settled (docKind, company key, fiscal year,
 * pairing key and sheet fields follow), the company counts move through
 * patchItem, and pairing for the groups the files left and joined is
 * scheduled (recomputePairs, two groups a run), so a 100-file edit never
 * reads whole pair groups in this transaction. A file a person makes a final
 * PD gets the science code its stored text preview gives, if it has none. A
 * company typed is stored in an existing company's spelling
 * (companyNameToStore). Its refusals are ConvexErrors, so the page can show
 * their words.
 */
export const setSheetLabels = mutation({
  args: {
    ids: v.array(v.id("ingestionItems")),
    patch: sheetLabelPatchValidator,
  },
  returns: batchResultValidator,
  handler: async (ctx, args) => {
    await assertAdmin(ctx);
    const ids = batchIds(args.ids, `Change up to ${SHEET_BATCH_MAX_FILES} files at a time.`);
    const outcome = batchOutcome();
    if (ids.length === 0) return outcome.result();
    const { fields, labels } = labelPatchFields(args.patch);
    if (fields.clientName !== undefined) fields.clientName = await companyNameToStore(ctx, fields.clientName);

    const groups = new Set<string>();
    for (const id of ids) {
      const item = await ctx.db.get(id);
      if (!item) {
        outcome.skip(id, "missing");
        continue;
      }
      if (sheetTabForStatus(item.status) !== "review") {
        outcome.skip(id, "not_on_tab");
        continue;
      }
      const { _id, _creationTime, ...stored } = item;
      const category = item.category ?? settleItem(stored).category ?? "unknown";
      const applying = labels.filter((label) =>
        labelApplies(label, { status: item.status, category }, fields.category ?? category)
      );
      if (applying.length === 0) {
        outcome.skip(id, "does_not_apply");
        continue;
      }
      const patch: Partial<IngestionItemFields> = {
        ...fieldsForLabels(fields, applying),
        editedLabels: mergeEditedLabels(item.editedLabels, applying),
      };
      if (patch.category !== undefined && patch.category !== item.category) {
        // The file name is read for the category the person chose: a
        // scheme-named PD kept in a supporting folder gives its number,
        // version and initials once it is made a final PD (labels a person
        // set stay).
        const read = pathFieldsFor(item.path, item.name, { ...item, ...patch });
        patch.pdNumber = read.pdNumber;
        patch.versionCode = read.versionCode;
        patch.versionNumber = read.versionNumber;
        patch.writerInitials = read.writerInitials;
        patch.reviewerInitials = read.reviewerInitials;
        patch.pdTitle = read.pdTitle;
      }
      if (patch.category === "final_pd" && item.category !== "final_pd") {
        // Extraction reads the code only for a file that was a final PD then.
        Object.assign(patch, previewScienceCode(settleItem({ ...stored, ...patch })));
      }
      const result = await patchItem(ctx, item, patch, { touch: true });
      if (!result.changed) continue;
      outcome.changed(id);
      for (const key of pairGroupsTouched(item, result.after)) groups.add(key);
    }
    await recomputeGroups(ctx, groups, MANY_ROWS);
    return outcome.result();
  },
});

// ─── Writers by initials (2026-11-12) ───────────────────────────────────────
// A final PD's file name gives its writer's initials ("T2.KT"), never a
// person (shared/pdFilename.ts): the code never guesses who KT is. When an
// admin picks a writer on a file whose initials have no writer yet, that pick
// says "KT is Kim Tran" for the whole firm (importWriterInitials), and every
// import file with those initials whose writer no person set on the file
// takes the name (writerNameSource "initials"; patchItem reads the match on
// every write, so new and put-back files take it too). A writer set on one
// file still wins for that file. Undo sets the match back the same way.

/** Files one run of a writer match settles before it schedules the rest. */
const WRITER_MATCH_BATCH = 100;

/** The tabs a match walks, To review first. Approved files keep what they were approved as. */
const WRITER_MATCH_TABS = ["review", "deleted"] as const;
type WriterMatchTab = (typeof WRITER_MATCH_TABS)[number];
const writerMatchTabValidator = v.union(v.literal("review"), v.literal("deleted"));

/**
 * One page of the files on `tab` whose name gave `initials`, each settled
 * with the writer they stand for now (patchItem reads it, from `writers`).
 * Counts move through patchItem; pairing does not read the writer, but a row
 * written for the first time since the labels may move group, so the groups
 * touched are recomputed.
 */
async function applyWriterPage(
  ctx: MutationCtx,
  initials: string,
  tab: WriterMatchTab,
  cursor: string | null,
  writers: RememberedWriters
): Promise<{ changed: number; isDone: boolean; continueCursor: string }> {
  const page = await ctx.db
    .query("ingestionItems")
    .withIndex("by_sheetTab_and_writerInitials", (q) => q.eq("sheetTab", tab).eq("writerInitials", initials))
    .paginate({ cursor, numItems: WRITER_MATCH_BATCH });
  let changed = 0;
  const groups = new Set<string>();
  for (const item of page.page) {
    if (!followsRememberedWriter(item)) continue;
    const result = await patchItem(ctx, item, {}, { touch: true, writers });
    if (!result.changed) continue;
    changed += 1;
    for (const key of pairGroupsTouched(item, result.after)) groups.add(key);
  }
  await recomputeGroups(ctx, groups, MANY_ROWS);
  return { changed, isDone: page.isDone, continueCursor: page.continueCursor };
}

/** Schedules the rest of a match's walk: the next page of `tab`, else the next tab. */
async function continueWriterMatch(
  ctx: MutationCtx,
  initials: string,
  tab: WriterMatchTab,
  page: { isDone: boolean; continueCursor: string }
): Promise<void> {
  const next = page.isDone ? WRITER_MATCH_TABS[WRITER_MATCH_TABS.indexOf(tab) + 1] : tab;
  if (next === undefined) return;
  await ctx.scheduler.runAfter(0, internal.ingestion.applyWriterInitials, {
    initials,
    tab: next,
    cursor: page.isDone ? null : page.continueCursor,
  });
}

/**
 * Says which writer some initials stand for, for the whole firm, or with
 * `writerName` null that no one has said (Undo). Admin only. The first 100
 * files with those initials on To review take the name in this call; the
 * rest of To review, then Deleted, follow in scheduled runs of 100.
 * Returns the match before (for Undo), how many files changed now, and
 * whether more To review files are still to follow. The name follows the
 * writer name rules (cleanWriterName); refusals are ConvexErrors.
 */
export const matchWriterInitials = mutation({
  args: { initials: v.string(), writerName: v.union(v.string(), v.null()) },
  returns: v.object({
    initials: v.string(),
    writerName: v.union(v.string(), v.null()),
    previous: v.union(v.string(), v.null()),
    changed: v.number(),
    more: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const admin = await assertAdmin(ctx);
    const initials = writerInitialsKey(args.initials);
    if (initials === null) domainError("INVALID_INPUT", "Initials are two or three letters, such as KT.");
    const name = args.writerName === null ? null : cleanWriterName(args.writerName);
    const match = await ctx.db
      .query("importWriterInitials")
      .withIndex("by_initials", (q) => q.eq("initials", initials))
      .first();
    const previous = match?.writerName ?? null;
    if (name === null) {
      if (match) await ctx.db.delete(match._id);
    } else if (!match) {
      await ctx.db.insert("importWriterInitials", { initials, writerName: name, setBy: admin, updatedAt: Date.now() });
    } else if (match.writerName !== name) {
      await ctx.db.patch(match._id, { writerName: name, setBy: admin, updatedAt: Date.now() });
    }
    const page = await applyWriterPage(ctx, initials, "review", null, new Map([[initials, name]]));
    await continueWriterMatch(ctx, initials, "review", page);
    return { initials, writerName: name, previous, changed: page.changed, more: !page.isDone };
  },
});

/** The rest of a match's walk (matchWriterInitials): one page, then it schedules the next. */
export const applyWriterInitials = internalMutation({
  args: { initials: v.string(), tab: writerMatchTabValidator, cursor: v.union(v.string(), v.null()) },
  returns: v.object({ changed: v.number(), done: v.boolean() }),
  handler: async (ctx, args) => {
    const initials = writerInitialsKey(args.initials);
    if (initials === null) return { changed: 0, done: true };
    // The match as it is now: a later pick or an Undo meanwhile wins.
    const page = await applyWriterPage(ctx, initials, args.tab, args.cursor, new Map());
    await continueWriterMatch(ctx, initials, args.tab, page);
    return { changed: page.changed, done: page.isDone && args.tab === WRITER_MATCH_TABS[WRITER_MATCH_TABS.length - 1] };
  },
});

// ─── A new company's industry (2026-11-12) ──────────────────────────────────

/** The longest industry slug kept. */
const MAX_INDUSTRY = 60;

/**
 * Picks the industry of a company on the sheet that the app does not have
 * yet (no company, merged company or projects with its key), kept by company
 * key so it holds on every tab and can be used when the company is created
 * on approval. `industry` is from the app's industry list (stored as its
 * slug, as clients.industry is); admins may add one, as on New company.
 * Admin only.
 */
export const setNewCompanyIndustry = mutation({
  args: { companyKey: v.string(), industry: v.string() },
  returns: v.object({ industry: v.string() }),
  handler: async (ctx, args) => {
    const admin = await assertAdmin(ctx);
    const companyKey = args.companyKey.trim();
    if (companyKey === NO_COMPANY_KEY || dashboardCompanyKey(companyKey) !== companyKey) {
      domainError("INVALID_INPUT", "Pick the company first.");
    }
    const industry = industrySlug(args.industry);
    if (!industry) domainError("INVALID_INPUT", "Pick an industry.");
    if (industry.length > MAX_INDUSTRY) domainError("INVALID_INPUT", `An industry can be up to ${MAX_INDUSTRY} characters.`);
    if ((await knownCompany(ctx, companyKey)) !== null) {
      domainError("INVALID_INPUT", "This company is already in Banhall. Change its industry on its company page.");
    }
    const picks = await newCompanyPicks(ctx, companyKey);
    if (!picks) {
      await ctx.db.insert("importNewCompanies", { companyKey, industry, setBy: admin, updatedAt: Date.now() });
    } else if (picks.industry !== industry) {
      await ctx.db.patch(picks._id, { industry, setBy: admin, updatedAt: Date.now() });
    }
    return { industry };
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
    const movePatch: Partial<IngestionItemFields> = {
      path: args.path,
      name: args.name,
      ...fromPath,
      lastModifiedAt: args.lastModifiedAt,
      updatedAt: Date.now(),
    };
    if (movePatch.category === "final_pd" && existing.category !== "final_pd") {
      // Extraction kept a science code only for a file that was a final PD
      // then, and unchanged bytes are not read again: read it from the
      // stored preview, as a person's change of category does.
      const { _id, _creationTime, ...stored } = existing;
      Object.assign(movePatch, previewScienceCode(settleItem({ ...stored, ...movePatch })));
    }
    const { after } = await patchItem(ctx, existing, movePatch);
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
      reviewNote: DELETED_IN_ONEDRIVE_NOTE,
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
      // The earliest file's spelling (pages run in creation order), used only
      // when the band has no name yet and no company has its key
      // (bandDisplayName, 2026-11-11 phase 3b fixes).
      if (item.clientName !== undefined && displayName === "") {
        displayName = item.clientName;
        displayNameAt = item._creationTime;
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
    // The name: the company's with this key, else the band's own, else the
    // earliest file's spelling (bandDisplayName).
    await writeImportCompany(
      ctx,
      args.sheetTab,
      args.companyKey,
      rows[0] ?? null,
      counts,
      displayName === "" ? undefined : displayName,
      { checkCompany: true }
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
