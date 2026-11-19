import {
  query,
  mutation,
  action,
  internalAction,
  internalMutation,
  internalQuery,
  type ActionCtx,
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
import { chatDisplayName } from "./lib/chatAuthors";
import { FRESH_UPLOAD_MS, isStorageReferenced, uploadClaimFor } from "./lib/storage";
import {
  extensionOf,
  INGEST_EXTENSIONS,
  isJunkPath,
  MAX_FILE_BYTES,
  sanitizeRelPath,
  uploadUpsertFields,
} from "./lib/ingestionClassify";
import {
  changedFields,
  definedFields,
  fieldsForLabels,
  followsRememberedWriter,
  hasReadText,
  isBeingRead,
  labelPatchFields,
  initialsWriterFields,
  initialsWriterStep,
  mergeEditedLabels,
  pairGroupsTouched,
  pathFieldsFor,
  pickWriterFields,
  previewScienceCode,
  settleItem,
  sheetTabForStatus,
  takesInitialsWriter,
  writerBeforePickFields,
  writerInitialsKey,
  writerSetByPerson,
  type IngestionItemFields,
} from "./lib/ingestionSheet";
import {
  adjustWriterFiles,
  choiceForUndo,
  confirmDocumentName,
  forgetWriterMatches,
  isLoginMember,
  linkedWriterOf,
  listTeamRoster,
  liveWriter,
  membersWithInitials,
  nameWriterFromDocument,
  pickedWriter,
  userDisplayLabel,
  writerForChoice,
  writerForInitials,
  writerForUser,
  writerLabel,
  writerLabelFor,
  writerOfUser,
  writerPick,
} from "./lib/teamRoster";
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
  writerChoiceValidator,
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
import { cleanDocumentWriterNames, writerNamesFromText } from "../shared/writerNameFromText";
import { industrySlug } from "../shared/industries";
import {
  canDelete,
  canPutBack,
  DELETED_IN_ONEDRIVE_NOTE,
  deletedReasonFor,
  labelApplies,
  looksLikeEmail,
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

async function assertAdmin(ctx: QueryCtx | MutationCtx): Promise<Id<"users">> {
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
 * A settled row with the writer its initials give (2026-11-12; since
 * 2026-11-16 the freeze rule, convex/lib/ingestionSheet.ts
 * initialsWriterStep): a file that follows its initials takes a person's
 * pick for them if there is one; otherwise the check (convex/lib/teamRoster.ts
 * writerForInitials) fills its writer only while it has none, or when its
 * initials changed. A file that has a writer from the check keeps it, so
 * editing a file (its science code, its year) never re-runs the match.
 * `previousInitials` are the row's initials before this write (a patch).
 * The lookup may make a writer; it reads only indexes. Then a past writer
 * the check made may take its name from the file's PD text (withDocumentName).
 */
async function settleWithWriter(
  ctx: MutationCtx,
  row: IngestionItemFields,
  previousInitials?: string | null
): Promise<IngestionItemFields> {
  const settled = await settleInitialsWriter(ctx, row, previousInitials);
  return await withDocumentName(ctx, { ...settled, ...previewWriterNames(settled) });
}

/**
 * The writer names of a file that needs them (needsDocumentWriterNames)
 * and has no full text in storage, only its preview (a row read long ago):
 * read from the preview here, as previewScienceCode does for the science
 * code; {} otherwise. A file with full text in storage has it read in an
 * action (scheduleNamesRead).
 */
function previewWriterNames(row: IngestionItemFields): Partial<IngestionItemFields> {
  if (row.textStorageId !== undefined || !needsDocumentWriterNames(row)) return {};
  return { documentWriterNames: writerNamesFromText(row.text ?? "") };
}

/**
 * A settled row after its writer may have taken a name from the row's PD
 * text (2026-11-16, convex/lib/teamRoster.ts nameWriterFromDocument), in
 * whichever order the text was read and the writer set. When the writer's
 * name changed, this row stores its new label (an approved one keeps the
 * name it was approved with) and the writer's other files on To review and
 * Deleted are written again in scheduled pages (refreshWriterFiles), as
 * after an Admin's rename.
 */
async function withDocumentName(ctx: MutationCtx, settled: IngestionItemFields): Promise<IngestionItemFields> {
  const named = await nameWriterFromDocument(ctx, settled);
  if (named === null) return settled;
  await ctx.scheduler.runAfter(0, internal.ingestion.refreshWriterFiles, { writerId: named.writerId, tab: "review", cursor: null });
  if (settled.status === "approved" || settled.writerName === undefined) return settled;
  return settleItem({ ...settled, writerName: named.label });
}

/** settleWithWriter's first step: the row settled with the writer its initials give. */
async function settleInitialsWriter(
  ctx: MutationCtx,
  row: IngestionItemFields,
  previousInitials?: string | null
): Promise<IngestionItemFields> {
  const settled = settleItem(row);
  const initials = writerInitialsKey(settled.writerInitials);
  const initialsChanged = previousInitials !== undefined && writerInitialsKey(previousInitials) !== initials;
  const pick = initials === null ? null : await pickedWriter(ctx, initials);
  const step = initialsWriterStep(settled, { hasPick: pick !== null, initialsChanged });
  let fields: Partial<IngestionItemFields> | null = null;
  if (step === "clear") fields = initialsWriterFields(null, "initials");
  else if (step === "pick") fields = pickWriterFields(settled, pick!, initialsChanged);
  else if (step === "fill") {
    // A pick's Undo: back to exactly the writer the file had before it
    // (never removed while a file remembers it); else the check.
    const before = writerBeforePickFields(settled, initialsChanged);
    fields =
      before && (await liveWriter(ctx, before.writerId))
        ? before
        : initialsWriterFields(await writerForInitials(ctx, initials!), "initials");
  }
  if (fields === null) return settled;
  const changed = Object.keys(changedFields(settled, { ...settled, ...fields })).length > 0;
  return changed ? settleItem({ ...settled, ...fields }) : settled;
}

/** Insert an ingestion item: the one place rows are created. */
async function insertItem(ctx: MutationCtx, fields: IngestionItemFields): Promise<Id<"ingestionItems">> {
  const row = definedFields(await settleWithWriter(ctx, fields));
  const id = await ctx.db.insert("ingestionItems", row);
  await adjustImportCompanyCounts(ctx, null, row);
  await adjustWriterFiles(ctx, null, row.writerId, null, row.writerBeforePick?.writerId);
  await scheduleNamesRead(ctx, null, { _id: id, _creationTime: 0, ...row });
  return id;
}

/**
 * Patch an ingestion item: settles the patched row, writes only the fields
 * that changed and keeps the company counts and the writers' file counts
 * right. With `touch`, updatedAt moves only when something else changed.
 */
async function patchItem(
  ctx: MutationCtx,
  before: Doc<"ingestionItems">,
  patch: Partial<IngestionItemFields>,
  options: { touch?: boolean } = {}
): Promise<{ after: Doc<"ingestionItems">; changed: boolean }> {
  const { _id, _creationTime, ...fields } = before;
  let settled = await settleWithWriter(ctx, { ...fields, ...patch }, before.writerInitials ?? null);
  let changes = changedFields(fields, settled);
  const changed = Object.keys(changes).length > 0;
  if (changed && options.touch) {
    settled = { ...settled, updatedAt: Date.now() };
    changes = { ...changes, updatedAt: settled.updatedAt };
  }
  if (changed) await ctx.db.patch(_id, changes);
  const after = { _id, _creationTime, ...definedFields(settled) } as Doc<"ingestionItems">;
  await adjustImportCompanyCounts(ctx, before, after);
  await adjustWriterFiles(ctx, before.writerId, after.writerId, before.writerBeforePick?.writerId, after.writerBeforePick?.writerId);
  await scheduleNamesRead(ctx, before, after);
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
  // The writer's label as it is now (2026-11-16: the linked member's name,
  // else the writer's name, else its initials), or the stored name of a row
  // with no writer record.
  writerName: v.optional(v.string()),
  // 2026-11-12: "initials" when the writer came from the file name's
  // initials (no AI mark: the file name and the firm's people).
  writerNameSource: v.optional(writerNameSourceValidator),
  // 2026-11-16: the writer the file points at, and whether it has a login.
  writerId: v.optional(v.id("pdWriters")),
  writerHasLogin: v.optional(v.boolean()),
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
  // New (2026-11-12): arrived in the last 24 hours. Only on To review.
  isNew: v.optional(v.boolean()),
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
    writerId: item.writerId,
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
    isNew: item.isNew === true && item.sheetTab === "review" ? true : undefined,
  });
}

/**
 * Rows with their writers' labels as they are now (2026-11-16): a writer
 * renamed or linked, or a member who changed their name, shows at once on
 * every file, approved ones included, without waiting for the files to be
 * written again. Reads each writer (and its member) once; a page holds at
 * most 200 rows.
 */
async function withWriterLabels<R extends SheetRow>(ctx: QueryCtx, rows: R[]): Promise<R[]> {
  const labels = new Map<Id<"pdWriters">, { label: string; hasLogin: boolean } | null>();
  for (const row of rows) {
    if (!row.writerId || labels.has(row.writerId)) continue;
    const writer = await liveWriter(ctx, row.writerId);
    const user = writer?.userId ? await ctx.db.get(writer.userId) : null;
    labels.set(row.writerId, writer ? { label: writerLabelFor(writer, user), hasLogin: isLoginMember(user) } : null);
  }
  return rows.map((row) => {
    const found = row.writerId ? labels.get(row.writerId) : null;
    return found ? { ...row, writerName: found.label, writerHasLogin: found.hasLogin } : row;
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
      // 2026-11-12: files that are New (To review only).
      newFiles: v.number(),
      complete: v.boolean(),
    })
  ),
  handler: async (ctx, args) => {
    if ((await adminOrNull(ctx)) === null) return null;
    const bands = await ctx.db
      .query("importCompanies")
      .withIndex("by_sheetTab_and_companyKey", (q) => q.eq("sheetTab", args.tab))
      .take(SHEET_BAND_READ_LIMIT + 1);
    const totals = { files: 0, companies: 0, needsCheck: 0, ready: 0, beingRead: 0, newFiles: 0 };
    for (const band of bands.slice(0, SHEET_BAND_READ_LIMIT)) {
      // A rebuild's start row has no files yet; it is not a company on the sheet.
      if (band.total <= 0) continue;
      totals.files += band.total;
      if (band.companyKey !== NO_COMPANY_KEY) totals.companies += 1;
      totals.needsCheck += band.needsCheck;
      totals.ready += band.ready;
      totals.beingRead += band.beingRead;
      totals.newFiles += band.newFiles ?? 0;
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
  // 2026-11-12: the band's New files (To review only).
  newFiles: v.number(),
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
 * the sheet (2026-11-12). `onlyNew` (2026-11-12, the New filter) lists only
 * the bands with New files, and wins over `onlyToCheck` (the page sends one).
 */
export const sheetCompanies = query({
  args: {
    tab: sheetTabValidator,
    onlyToCheck: v.boolean(),
    onlyNew: v.optional(v.boolean()),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(sheetBandValidator),
  handler: async (ctx, args) => {
    if ((await adminOrNull(ctx)) === null) return EMPTY_PAGE;
    const bands = args.onlyNew
      ? ctx.db
          .query("importCompanies")
          .withIndex("by_sheetTab_and_hasNew_and_companyKey", (q) => q.eq("sheetTab", args.tab).eq("hasNew", true))
      : args.onlyToCheck
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
          newFiles: band.newFiles ?? 0,
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
 * A page of one section's files (one tab, company and section) in sortKey
 * order, or only the ones that need a check, or (2026-11-12) only the New
 * ones. companyKey "" lists the files with no company. `category` is the
 * section: since 2026-11-12 a file still being read lists under "unknown"
 * (Not sorted yet) until it is read (ingestionItems.sheetSection).
 */
export const sheetFiles = query({
  args: {
    tab: sheetTabValidator,
    companyKey: v.string(),
    category: ingestionCategoryValidator,
    onlyToCheck: v.boolean(),
    onlyNew: v.optional(v.boolean()),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(sheetRowValidator),
  handler: async (ctx, args) => {
    if ((await adminOrNull(ctx)) === null) return EMPTY_PAGE;
    const companyKey = args.companyKey === NO_COMPANY_KEY ? undefined : args.companyKey;
    const files = args.onlyNew
      ? ctx.db
          .query("ingestionItems")
          .withIndex("by_sheetTab_companyKey_sheetSection_isNew_sortKey", (q) =>
            q
              .eq("sheetTab", args.tab)
              .eq("companyKey", companyKey)
              .eq("sheetSection", args.category)
              .eq("isNew", true)
          )
      : args.onlyToCheck
      ? ctx.db
          .query("ingestionItems")
          .withIndex("by_sheetTab_companyKey_sheetSection_needsCheck_sortKey", (q) =>
            q
              .eq("sheetTab", args.tab)
              .eq("companyKey", companyKey)
              .eq("sheetSection", args.category)
              .eq("needsCheck", true)
          )
      : ctx.db
          .query("ingestionItems")
          .withIndex("by_sheetTab_and_companyKey_and_sheetSection_and_sortKey", (q) =>
            q.eq("sheetTab", args.tab).eq("companyKey", companyKey).eq("sheetSection", args.category)
          );
    const result = await files.paginate(boundedPage(args.paginationOpts, SHEET_FILES_PAGE_MAX));
    return { ...result, page: await withWriterLabels(ctx, result.page.map(sheetRow)) };
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
      files: await withWriterLabels(
        ctx,
        files.map((file) =>
          definedFields({
            ...sheetRow(file),
            companyKey: file.companyKey ?? NO_COMPANY_KEY,
            clientName: file.clientName,
          })
        )
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
    const [row] = await withWriterLabels(ctx, [sheetRow(item)]);
    return definedFields({
      ...row,
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
      // A file rejected while it is still being read will never be read
      // now: its batch counts it as done, so the status line settles.
      ...(await finishBatchRead(ctx, item, false)),
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
    const { after } = await patchItem(ctx, item, {
      // One its batch still waits for (rejected before it was read) is done.
      ...(await finishBatchRead(ctx, item, false)),
      ...removedFields(item, admin),
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
      const { after } = await patchItem(ctx, item, {
        // One its batch still waits for (rejected before it was read) is done.
        ...(await finishBatchRead(ctx, item, false)),
        ...removedFields(item, admin),
      });
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
    const admin = await assertAdmin(ctx);
    const ids = batchIds(args.ids, `Change up to ${SHEET_BATCH_MAX_FILES} files at a time.`);
    const outcome = batchOutcome();
    if (ids.length === 0) return outcome.result();
    const { fields, labels, writer } = labelPatchFields(args.patch);
    if (fields.clientName !== undefined) fields.clientName = await companyNameToStore(ctx, fields.clientName);
    if (writer) {
      // 2026-11-16: a writer set on these files alone (it wins for them).
      const chosen = await writerForChoice(ctx, writer, { by: admin });
      fields.writerId = chosen._id;
      fields.writerName = await writerLabel(ctx, chosen);
    }

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

// ─── Writers from initials (2026-11-12, 2026-11-16) ──────────────────────────
// A final PD's file name gives its writer's initials ("T2.KT"). Since
// 2026-11-16 (docs/product-domain.md) a file whose name has them takes a
// person's pick for them for the whole firm (pdWriterPicks) when there is
// one; otherwise, only while it has no writer, the check
// (convex/lib/teamRoster.ts writerForInitials) fills it: the one team
// member whose saved initials they are, else the one writer the check made
// from them, else a new one ("KT"); when they could be more than one
// person the file has no writer and shows "Choose writer". The freeze
// rule: once a file has a writer it moves only on a pick (and its Undo), a
// person setting it on the file, or a change of its own initials; never on
// a change of a member's initials or an edit to the file. When a person
// chooses a writer on a file whose writer follows its initials, that choice
// is a pick: "KT is Kim Tran" for the whole firm, with Undo, which puts
// every file back exactly as it was. A writer set on one file still wins
// for that file. When the facts change, the files on To
// review and Deleted with the initials are settled again in pages (files
// following a pick move, files with no writer are filled); approved files
// keep their writer.

/** Files one run of a writer match settles before it schedules the rest. */
const WRITER_MATCH_BATCH = 100;

/** The tabs a match walks, To review first. Approved files keep what they were approved as. */
const WRITER_MATCH_TABS = ["review", "deleted"] as const;
type WriterMatchTab = (typeof WRITER_MATCH_TABS)[number];
const writerMatchTabValidator = v.union(v.literal("review"), v.literal("deleted"));

/**
 * One page of the files on `tab` whose name gave `initials`, each settled
 * again (patchItem: a file following a pick takes it, a file with no writer
 * is filled, a file with a writer from the check keeps it). Counts move
 * through patchItem; pairing does not read the writer, but a row written for
 * the first time since the labels may move group, so the groups touched are
 * recomputed.
 */
async function applyWriterPage(
  ctx: MutationCtx,
  initials: string,
  tab: WriterMatchTab,
  cursor: string | null
): Promise<{ changed: number; isDone: boolean; continueCursor: string }> {
  const page = await ctx.db
    .query("ingestionItems")
    .withIndex("by_sheetTab_and_writerInitials", (q) => q.eq("sheetTab", tab).eq("writerInitials", initials))
    .paginate({ cursor, numItems: WRITER_MATCH_BATCH });
  let changed = 0;
  const groups = new Set<string>();
  for (const item of page.page) {
    if (!followsRememberedWriter(item)) continue;
    const result = await patchItem(ctx, item, {}, { touch: true });
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
 * Says which writer some initials are, for the whole firm (2026-11-16: a
 * pdWriterPicks row), or with `writer` null takes the pick away (Undo).
 * Admin only. `writer` is a team member, a writer, or a typed name (a
 * writer with no login and that name; the pick carries the initials). Every
 * file with those initials whose writer no person set on the file follows
 * the pick, whatever writer it had, and remembers that writer
 * (writerBeforePick); when the pick goes, each file gets exactly the writer
 * it had before (or, if it had none, what the check gives), so a pick then
 * its Undo leaves every file as it was. The first 100
 * files with the initials on To review follow in this call; the rest of To
 * review, then Deleted, follow in scheduled runs of 100. Returns the writer
 * and its label, the pick before as a choice an Undo can send back (it still
 * works when that writer was a bare one that has been removed since), how
 * many files changed now, and whether more To review files are still to
 * follow. Refusals are ConvexErrors.
 */
export const matchWriterInitials = mutation({
  args: { initials: v.string(), writer: v.union(writerChoiceValidator, v.null()) },
  returns: v.object({
    initials: v.string(),
    writerId: v.union(v.id("pdWriters"), v.null()),
    writerName: v.union(v.string(), v.null()),
    previous: v.union(writerChoiceValidator, v.null()),
    changed: v.number(),
    more: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const admin = await assertAdmin(ctx);
    const initials = writerInitialsKey(args.initials);
    if (initials === null) domainError("INVALID_INPUT", "Initials are two or three letters, such as KT.");
    const chosen = args.writer === null ? null : await writerForChoice(ctx, args.writer, { by: admin });
    const pick = await writerPick(ctx, initials);
    const before = pick ? await liveWriter(ctx, pick.writerId) : null;
    const previous = before ? choiceForUndo(before) : null;
    if (chosen === null) {
      if (pick) await ctx.db.delete(pick._id);
    } else if (!pick) {
      await ctx.db.insert("pdWriterPicks", { initials, writerId: chosen._id, setBy: admin, updatedAt: Date.now() });
    } else if (pick.writerId !== chosen._id) {
      await ctx.db.patch(pick._id, { writerId: chosen._id, setBy: admin, updatedAt: Date.now() });
    }
    forgetWriterMatches(ctx);
    const page = await applyWriterPage(ctx, initials, "review", null);
    await continueWriterMatch(ctx, initials, "review", page);
    return {
      initials,
      writerId: chosen?._id ?? null,
      writerName: chosen ? await writerLabel(ctx, chosen) : null,
      previous,
      changed: page.changed,
      more: !page.isDone,
    };
  },
});

/**
 * The rest of a match's walk (matchWriterInitials), and the walk after any
 * other change of the facts for some initials (users.setUserInitials, a
 * writer linked or unlinked, a pick deleted with its writer): one page,
 * then it schedules the next. Under the freeze rule it moves only files
 * that follow a pick, and fills only files with no writer yet (for example
 * initials two people shared, once only one member has them).
 */
export const applyWriterInitials = internalMutation({
  args: { initials: v.string(), tab: writerMatchTabValidator, cursor: v.union(v.string(), v.null()) },
  returns: v.object({ changed: v.number(), done: v.boolean() }),
  handler: async (ctx, args) => {
    const initials = writerInitialsKey(args.initials);
    if (initials === null) return { changed: 0, done: true };
    // The facts as they are now: a later pick or an Undo meanwhile wins.
    const page = await applyWriterPage(ctx, initials, args.tab, args.cursor);
    await continueWriterMatch(ctx, initials, args.tab, page);
    return { changed: page.changed, done: page.isDone && args.tab === WRITER_MATCH_TABS[WRITER_MATCH_TABS.length - 1] };
  },
});

/**
 * One page of a writer's files on To review or Deleted, written again
 * (2026-11-16) after the writer was renamed, linked or unlinked, or took
 * or lost a name from a PD (withDocumentName): a file a
 * person set takes the writer's new label as its stored name, and every
 * file is settled again. Approved files keep the name they were approved
 * with (the sheet shows the writer's label as it is now anyway). Then it
 * schedules the next page, else the next tab. Bounded: 100 files a run.
 */
export const refreshWriterFiles = internalMutation({
  args: {
    writerId: v.id("pdWriters"),
    tab: writerMatchTabValidator,
    cursor: v.union(v.string(), v.null()),
  },
  returns: v.object({ changed: v.number(), done: v.boolean() }),
  handler: async (ctx, args) => {
    const writer = await liveWriter(ctx, args.writerId);
    if (!writer) return { changed: 0, done: true };
    const label = await writerLabel(ctx, writer);
    const page = await ctx.db
      .query("ingestionItems")
      .withIndex("by_writerId_and_sheetTab", (q) => q.eq("writerId", args.writerId).eq("sheetTab", args.tab))
      .paginate({ cursor: args.cursor, numItems: WRITER_MATCH_BATCH });
    let changed = 0;
    const groups = new Set<string>();
    for (const item of page.page) {
      const result = await patchItem(ctx, item, { writerName: label }, { touch: true });
      if (!result.changed) continue;
      changed += 1;
      for (const key of pairGroupsTouched(item, result.after)) groups.add(key);
    }
    await recomputeGroups(ctx, groups, MANY_ROWS);
    const next = page.isDone ? WRITER_MATCH_TABS[WRITER_MATCH_TABS.indexOf(args.tab) + 1] : args.tab;
    if (next !== undefined) {
      await ctx.scheduler.runAfter(0, internal.ingestion.refreshWriterFiles, {
        writerId: args.writerId,
        tab: next,
        cursor: page.isDone ? null : page.continueCursor,
      });
    }
    return { changed, done: next === undefined };
  },
});

/**
 * A person chose, on one file or for some initials, the writer the file
 * already has (2026-11-16; Greptile fix, 2026-11-17). When that writer's name
 * came from a PD, the name is now a person's (confirmDocumentName), so a
 * later PD that names someone else never takes it back. Nothing else
 * changes: no file's writer or stored name (the writer's label is the same),
 * no pick and no count. Admin only. True when the name became a person's.
 */
export const confirmWriterName = mutation({
  args: { writerId: v.id("pdWriters") },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const admin = await assertAdmin(ctx);
    const writer = await liveWriter(ctx, args.writerId);
    if (!writer) domainError("NOT_FOUND", "That writer is no longer in Banhall.");
    const after = await confirmDocumentName(ctx, writer, admin);
    return after.nameSource !== writer.nameSource;
  },
});

/** Past writers one read lists. */
const PAST_WRITERS_READ = 200;

/**
 * The writers the Import page's writer picker lists (2026-11-16): the team
 * members with a login (their own writer, if they have one yet, and the
 * past writer an Admin linked to them), then the writers with no login
 * (past writers), each with its label and whether its name came from a PD
 * (so choosing it on a file that has it can confirm that name,
 * confirmWriterName). Admin only (null otherwise).
 * Bounded: the roster's 200 people and 200 past writers (the index read
 * holds only writers with no account, so the cap counts them alone).
 */
export const writerChoices = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      members: v.array(
        v.object({
          userId: v.id("users"),
          label: v.string(),
          writerId: v.union(v.id("pdWriters"), v.null()),
          linkedWriterId: v.union(v.id("pdWriters"), v.null()),
        })
      ),
      pastWriters: v.array(
        v.object({
          writerId: v.id("pdWriters"),
          label: v.string(),
          initials: v.union(v.string(), v.null()),
          nameFromDocument: v.boolean(),
        })
      ),
    })
  ),
  handler: async (ctx) => {
    if ((await adminOrNull(ctx)) === null) return null;
    const roster = (await listTeamRoster(ctx)).filter(isLoginMember);
    const members = [];
    for (const user of roster) {
      const label = userDisplayLabel(user);
      if (label === "Unknown team member" || looksLikeEmail(label)) continue;
      const own = await writerOfUser(ctx, user._id);
      const linked = await linkedWriterOf(ctx, user._id);
      members.push({ userId: user._id, label, writerId: own?._id ?? null, linkedWriterId: linked?._id ?? null });
    }
    members.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
    const unlinked = await ctx.db
      .query("pdWriters")
      .withIndex("by_userId", (q) => q.eq("userId", undefined))
      .take(PAST_WRITERS_READ);
    const pastWriters = unlinked
      .map((writer) => ({
        writerId: writer._id,
        label: writerLabelFor(writer, null),
        initials: writer.initials ?? null,
        nameFromDocument: Boolean(writer.name) && writer.nameSource === "document",
      }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
    return { members, pastWriters };
  },
});

// ─── Moving to writers (2026-11-16, run once after the deploy) ──────────────
// Order: users.backfillUserInitials (saved initials from names), then
// ingestion.migrateImportWriterInitials (each "KT is Kim Tran" becomes a
// writer and a pick), which ends by scheduling
// ingestion.backfillImportWriters (every file on To review, Deleted and
// Approved gets its writer). Each is paged and safe to run again.

const WRITER_MIGRATION_BATCH = 50;

/**
 * Copies each importWriterInitials row (2026-11-12, "KT is Kim Tran" as text)
 * into the new model: a writer with that name, linked to a team member only
 * when exactly one member has that name and those saved initials (their own
 * writer), else the writer with no login that has that name (made with the
 * initials if there is none), and a pick for the initials, so the person's
 * statement still wins. Each row is marked as copied (migratedAt) in the
 * same transaction and never copied again, so running it again is safe and
 * never brings back a pick a person has undone. Paged; a pick already there
 * is kept. When done it schedules backfillImportWriters.
 */
export const migrateImportWriterInitials = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.object({ migrated: v.number(), done: v.boolean() }),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("importWriterInitials")
      .paginate({ cursor: args.cursor ?? null, numItems: WRITER_MIGRATION_BATCH });
    let migrated = 0;
    for (const row of page.page) {
      // A row copied once is never copied again: a pick a person has undone
      // since stays undone. A row a pick already covers is marked too.
      if (row.migratedAt !== undefined) continue;
      await ctx.db.patch(row._id, { migratedAt: Date.now() });
      const initials = writerInitialsKey(row.initials);
      if (initials === null || (await writerPick(ctx, initials))) continue;
      const name = row.writerName.trim().replace(/\s+/g, " ");
      if (!name) continue;
      const setBy = ctx.db.normalizeId("users", row.setBy);
      if (!setBy) continue;
      const members = (await membersWithInitials(ctx, initials)).filter((user) => userDisplayLabel(user) === name);
      let writerId: Id<"pdWriters">;
      if (members.length === 1) {
        writerId = (await writerForUser(ctx, members[0]))._id;
      } else {
        const named = await ctx.db
          .query("pdWriters")
          .withIndex("by_name", (q) => q.eq("name", name))
          .take(10);
        const reuse = named.find((w) => !w.userId);
        writerId =
          reuse?._id ??
          (await ctx.db.insert("pdWriters", { initials, name, createdVia: "person", createdBy: setBy, createdAt: row.updatedAt, fileCount: 0 }));
      }
      await ctx.db.insert("pdWriterPicks", { initials, writerId, setBy, updatedAt: row.updatedAt });
      forgetWriterMatches(ctx);
      migrated += 1;
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.ingestion.migrateImportWriterInitials, { cursor: page.continueCursor });
    } else {
      await ctx.scheduler.runAfter(0, internal.ingestion.backfillImportWriters, { tab: "review", cursor: null });
    }
    return { migrated, done: page.isDone };
  },
});

/** The tabs the backfill walks: To review and Deleted are settled; Approved only gains a writer. */
const WRITER_BACKFILL_TABS = ["review", "deleted", "approved"] as const;
const writerBackfillTabValidator = v.union(v.literal("review"), v.literal("deleted"), v.literal("approved"));

/**
 * The writer a file whose writer a person typed as text (before writers
 * existed) points at: the team member who has exactly that name when there
 * is one, else the writer with no login by that name (made if there is none).
 */
async function writerForTypedName(
  ctx: MutationCtx,
  roster: Array<Doc<"users">>,
  name: string
): Promise<Doc<"pdWriters">> {
  const named = roster.filter((user) => isLoginMember(user) && userDisplayLabel(user) === name);
  return named.length === 1 ? await writerForUser(ctx, named[0]) : await writerForChoice(ctx, { kind: "name", name }, {});
}

/**
 * Gives every file its writer (2026-11-16), To review, then Deleted, then
 * Approved. On To review and Deleted a file is settled (the pick or the
 * check fills a file with no writer), and one whose writer a person set as
 * text gets the writer for that name (writerForTypedName). An approved file
 * gains only a writer reference, so the PD counts and Link include it: the
 * writer for its stored name whenever it has one (so it shows what it was
 * approved as, even when its initials stand for someone else now), else the
 * pick or the check for its initials. Its stored name is never rewritten (the sheet
 * shows the writer's label as it is now). 100 files a run; it schedules the
 * rest. Safe to run again.
 */
export const backfillImportWriters = internalMutation({
  args: { tab: writerBackfillTabValidator, cursor: v.union(v.string(), v.null()) },
  returns: v.object({ changed: v.number(), done: v.boolean() }),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("ingestionItems")
      .withIndex("by_sheetTab_and_companyKey", (q) => q.eq("sheetTab", args.tab))
      .paginate({ cursor: args.cursor, numItems: WRITER_MATCH_BATCH });
    let changed = 0;
    const groups = new Set<string>();
    const roster = await listTeamRoster(ctx);
    for (const item of page.page) {
      let patch: Partial<IngestionItemFields> = {};
      if (item.writerId === undefined && item.status === "approved" && item.writerName) {
        // Approved with a stored name (a person's, or one its initials stood
        // for then): the writer for that name, so it shows what it was
        // approved as, whatever its initials stand for now.
        patch = { writerId: (await writerForTypedName(ctx, roster, item.writerName))._id };
      } else if (item.writerId === undefined && writerSetByPerson(item) && item.writerName) {
        const writer = await writerForTypedName(ctx, roster, item.writerName);
        patch = { writerId: writer._id, writerName: await writerLabel(ctx, writer) };
      } else if (item.writerId === undefined && item.status === "approved" && takesInitialsWriter(item)) {
        const initials = writerInitialsKey(item.writerInitials)!;
        const writer = (await pickedWriter(ctx, initials)) ?? (await writerForInitials(ctx, initials));
        if (writer) patch = { writerId: writer.id };
      }
      if (item.status === "approved" && Object.keys(patch).length === 0) continue;
      const result = await patchItem(ctx, item, patch);
      if (!result.changed) continue;
      changed += 1;
      for (const key of pairGroupsTouched(item, result.after)) groups.add(key);
    }
    await recomputeGroups(ctx, groups, MANY_ROWS);
    const next = page.isDone ? WRITER_BACKFILL_TABS[WRITER_BACKFILL_TABS.indexOf(args.tab) + 1] : args.tab;
    if (next !== undefined) {
      await ctx.scheduler.runAfter(0, internal.ingestion.backfillImportWriters, {
        tab: next,
        cursor: page.isDone ? null : page.continueCursor,
      });
    } else {
      // Every file has its writer: now past writers can take names from PDs read before.
      await ctx.scheduler.runAfter(0, internal.ingestion.backfillDocumentWriterNames, {});
    }
    return { changed, done: next === undefined };
  },
});

// ─── Names from PDs read before (2026-11-16, run after the deploy) ──────────
// Files read before the names were kept have their text in storage but no
// documentWriterNames. backfillDocumentWriterNames reads that text for the
// final PDs, drafts and review copies on To review, Deleted and Approved, a
// page at a time, keeps the names on each file, and so lets a past writer
// the check made take its name from them (settleWithWriter). It runs after
// backfillImportWriters, and on its own. Safe to run again: a file that has
// its names already is skipped. A file that comes to need its names later
// (a person makes it a final PD, draft or review copy, or a reading that
// started before the deploy lands without them) is read on its own
// (readDocumentWriterNames, scheduled by insertItem and patchItem).

/** Rows one run of the names backfill pages through. */
const NAMES_BACKFILL_ROWS = 100;
/** Files whose full text one run reads, at most: each is up to 700 KB. */
const NAMES_BACKFILL_READS = 25;

/** Whether a file still needs its writer names read: it takes a writer from its initials, has read text and no names yet. */
function needsDocumentWriterNames(item: IngestionItemFields): boolean {
  return item.documentWriterNames === undefined && takesInitialsWriter(item) && hasReadText(item) && !isBeingRead(item.status);
}

/**
 * Schedules readDocumentWriterNames for a file a write left needing its
 * names (needsDocumentWriterNames) with full text in storage: one that just
 * came to take a writer (a person changed its category), or whose text just
 * landed without names (a reading begun before the deploy).
 */
async function scheduleNamesRead(ctx: MutationCtx, before: IngestionItemFields | null, after: Doc<"ingestionItems">) {
  if (after.textStorageId === undefined || !needsDocumentWriterNames(after)) return;
  if (before && needsDocumentWriterNames(before) && before.textStorageId === after.textStorageId) return;
  await ctx.scheduler.runAfter(0, internal.ingestion.readDocumentWriterNames, { itemId: after._id });
}

const namesBackfillItemValidator = v.object({
  itemId: v.id("ingestionItems"),
  textStorageId: v.union(v.id("_storage"), v.null()),
  // Only for a file with no full text in storage.
  preview: v.union(v.string(), v.null()),
});
const namesBackfillPageValidator = v.object({
  items: v.array(namesBackfillItemValidator),
  isDone: v.boolean(),
  continueCursor: v.string(),
});

function namesBackfillItem(item: Doc<"ingestionItems">): Infer<typeof namesBackfillItemValidator> {
  return {
    itemId: item._id,
    textStorageId: item.textStorageId ?? null,
    preview: item.textStorageId === undefined ? (item.text ?? null) : null,
  };
}

/**
 * One page of 100 rows on `tab`, with the files among them the names
 * backfill reads (needsDocumentWriterNames).
 */
export const documentWriterNamesPage = internalQuery({
  args: { tab: writerBackfillTabValidator, cursor: v.union(v.string(), v.null()) },
  returns: namesBackfillPageValidator,
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("ingestionItems")
      .withIndex("by_sheetTab_and_companyKey", (q) => q.eq("sheetTab", args.tab))
      .paginate({ cursor: args.cursor, numItems: NAMES_BACKFILL_ROWS });
    const items = page.page.filter(needsDocumentWriterNames).map(namesBackfillItem);
    return { items, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** One file, when it still needs its names read; null otherwise. */
export const documentWriterNamesItem = internalQuery({
  args: { itemId: v.id("ingestionItems") },
  returns: v.union(namesBackfillItemValidator, v.null()),
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    return item && needsDocumentWriterNames(item) ? namesBackfillItem(item) : null;
  },
});

/**
 * Keeps the names read from each file's text (the names backfill's write),
 * which may name the file's past writer (settleWithWriter). A file that has
 * names already (a fresh read got there first), or whose text changed since
 * it was read, is left alone. Up to 25 files.
 */
export const recordDocumentWriterNames = internalMutation({
  args: {
    entries: v.array(
      v.object({
        itemId: v.id("ingestionItems"),
        textStorageId: v.union(v.id("_storage"), v.null()),
        names: v.array(v.string()),
      })
    ),
  },
  returns: v.object({ recorded: v.number() }),
  handler: async (ctx, args) => {
    let recorded = 0;
    const groups = new Set<string>();
    for (const entry of args.entries.slice(0, NAMES_BACKFILL_READS)) {
      const item = await ctx.db.get(entry.itemId);
      if (!item || item.documentWriterNames !== undefined || (item.textStorageId ?? null) !== entry.textStorageId) continue;
      const result = await patchItem(ctx, item, { documentWriterNames: cleanDocumentWriterNames(entry.names) });
      recorded += 1;
      for (const key of pairGroupsTouched(item, result.after)) groups.add(key);
    }
    await recomputeGroups(ctx, groups, MANY_ROWS);
    return { recorded };
  },
});

/**
 * The writer names in each file's text: its full text from storage, else its
 * preview (none when the stored text is gone or cannot be read).
 */
async function readNames(
  ctx: ActionCtx,
  items: ReadonlyArray<Infer<typeof namesBackfillItemValidator>>
): Promise<Array<{ itemId: Id<"ingestionItems">; textStorageId: Id<"_storage"> | null; names: string[] }>> {
  const entries = [];
  for (const item of items) {
    let names: string[] = [];
    try {
      const blob = item.textStorageId ? await ctx.storage.get(item.textStorageId) : null;
      names = writerNamesFromText(blob ? await blob.text() : (item.preview ?? ""));
    } catch (error) {
      // One unreadable text never stops the walk: the file keeps no names
      // (a person can still name its writer) and the rest go on.
      console.warn("Could not read a file's text for its writer names", {
        itemId: item.itemId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    entries.push({ itemId: item.itemId, textStorageId: item.textStorageId, names });
  }
  return entries;
}

/**
 * Reads the writer names in the text of files read before 2026-11-16 (see
 * above): To review, then Deleted, then Approved, 100 rows a run, reading
 * at most 25 files' text (a page with more is run again, without the files
 * just read), each run scheduling the next. Run it on its own with no
 * arguments. Returns how many files it kept names for in this run.
 */
export const backfillDocumentWriterNames = internalAction({
  args: { tab: v.optional(writerBackfillTabValidator), cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.object({ recorded: v.number(), done: v.boolean() }),
  handler: async (ctx, args): Promise<{ recorded: number; done: boolean }> => {
    const tab = args.tab ?? "review";
    const cursor = args.cursor ?? null;
    const page: Infer<typeof namesBackfillPageValidator> = await ctx.runQuery(internal.ingestion.documentWriterNamesPage, {
      tab,
      cursor,
    });
    const entries = await readNames(ctx, page.items.slice(0, NAMES_BACKFILL_READS));
    let recorded = 0;
    let saved = true;
    if (entries.length > 0) {
      try {
        recorded = (await ctx.runMutation(internal.ingestion.recordDocumentWriterNames, { entries })).recorded;
      } catch (error) {
        // Keep walking: these files stay without names until a later run.
        saved = false;
        console.warn("Could not keep the writer names of a page of files", {
          tab,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    // More files on this page than one run reads: the same page again (the
    // files just read have names now, so they are left out). Else, or when
    // keeping them failed, the next page, then the next tab.
    const again = page.items.length > NAMES_BACKFILL_READS && saved;
    const next = again || !page.isDone ? tab : WRITER_BACKFILL_TABS[WRITER_BACKFILL_TABS.indexOf(tab) + 1];
    if (next !== undefined) {
      await ctx.scheduler.runAfter(0, internal.ingestion.backfillDocumentWriterNames, {
        tab: next,
        cursor: again ? cursor : page.isDone ? null : page.continueCursor,
      });
    }
    return { recorded, done: next === undefined };
  },
});

/**
 * Reads the writer names of one file that came to need them after the
 * backfill (scheduleNamesRead), and keeps them. Nothing when it no longer
 * needs them.
 */
export const readDocumentWriterNames = internalAction({
  args: { itemId: v.id("ingestionItems") },
  returns: v.object({ recorded: v.number() }),
  handler: async (ctx, args): Promise<{ recorded: number }> => {
    const item: Infer<typeof namesBackfillItemValidator> | null = await ctx.runQuery(
      internal.ingestion.documentWriterNamesItem,
      { itemId: args.itemId }
    );
    if (item === null) return { recorded: 0 };
    const entries = await readNames(ctx, [item]);
    try {
      return await ctx.runMutation(internal.ingestion.recordDocumentWriterNames, { entries });
    } catch (error) {
      console.warn("Could not keep a file's writer names", {
        itemId: args.itemId,
        error: error instanceof Error ? error.message : String(error),
      });
      return { recorded: 0 };
    }
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
    // 2026-11-12: the run's files arrive in one Import batch (History tab).
    const now = Date.now();
    const batchId = await ctx.db.insert("importBatches", {
      source: "onedrive",
      addedBy: admin as Id<"users">,
      startedAt: now,
      lastFileAt: now,
      added: 0,
      alreadyHere: 0,
      failed: 0,
      read: 0,
      couldNotRead: 0,
    });
    const runId = await ctx.db.insert("oneDriveSyncRuns", {
      status: "running",
      triggeredBy: admin,
      startedAt: now,
      lastProgressAt: now,
      discovered: 0,
      processed: 0,
      skipped: 0,
      batchId,
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

// ─── Batches of arriving files (2026-11-12, the Import page) ────────────────
// Every file that arrives (new, or new bytes) is New for 24 hours and points
// at the batch it came in: a drop or Add files on the Import page, a run of
// the client uploader, or a OneDrive sync run. The batch counts what arrived,
// what was already here, what the browser could not send and how much has
// been read, for the History tab and the status line under the toolbar.

/** Files the uploader sends with no longer gap than this between them are one batch. */
const UPLOADER_BATCH_GAP_MS = 10 * 60_000;
/** How long a file stays New. */
const NEW_FOR_MS = 24 * 60 * 60_000;
/** New flags one clearExpiredNew run clears before it schedules the next. */
const NEW_CLEAR_BATCH = 100;

/** Where a file arrived from, for upsertDiscovered. */
type Arrival = { batchId?: Id<"importBatches">; now: number };

type BatchChange = Partial<Record<"added" | "alreadyHere" | "read" | "couldNotRead", number>>;

/** Moves a batch's counters (missing batch: nothing). `arrived` moves lastFileAt too. */
async function changeBatch(
  ctx: MutationCtx,
  batchId: Id<"importBatches"> | undefined,
  change: BatchChange,
  now: number,
  arrived: boolean
) {
  if (!batchId) return;
  const batch = await ctx.db.get(batchId);
  if (!batch) return;
  const patch: Partial<Doc<"importBatches">> = {};
  for (const key of ["added", "alreadyHere", "read", "couldNotRead"] as const) {
    const by = change[key] ?? 0;
    if (by !== 0) patch[key] = Math.max(0, batch[key] + by);
  }
  if (arrived) patch.lastFileAt = Math.max(batch.lastFileAt, now);
  if ((change.read ?? 0) > 0) patch.lastReadAt = now;
  if (Object.keys(patch).length > 0) await ctx.db.patch(batchId, patch);
}

/**
 * The fields of a file that just arrived: New from now, in its batch, which
 * waits for its reading. A file that was still waiting stops waiting for its
 * earlier copy (that copy's batch counts it as done), so no batch waits on a
 * copy that was replaced. Since 2026-11-19 this holds in the same batch too:
 * both arrivals count in `added`, so each needs its own done.
 */
async function arrivalFields(
  ctx: MutationCtx,
  existing: Doc<"ingestionItems"> | null,
  arrival: Arrival
): Promise<Partial<IngestionItemFields>> {
  if (existing?.batchReadPending && existing.batchId) {
    await changeBatch(ctx, existing.batchId, { read: 1 }, arrival.now, false);
  }
  return {
    isNew: true,
    arrivedAt: arrival.now,
    batchId: arrival.batchId,
    batchReadPending: arrival.batchId ? true : undefined,
  };
}

/**
 * A file left "being read" (read, could not be read, gone, or rejected or
 * deleted before it was read): the batch it arrived in counts it as done,
 * once. A file that will never be read counts as done rather than leaving
 * the batch's added count, so History still says how many were added.
 * Returns the fields that say it no longer waits.
 */
async function finishBatchRead(
  ctx: MutationCtx,
  item: Doc<"ingestionItems">,
  couldNotRead: boolean
): Promise<Partial<IngestionItemFields>> {
  if (!item.batchReadPending) return {};
  await changeBatch(ctx, item.batchId, { read: 1, couldNotRead: couldNotRead ? 1 : 0 }, Date.now(), false);
  return { batchReadPending: undefined };
}

/**
 * Stage or refresh one drive item. The feeders send classify's view of the
 * path; the stored client, fiscal year, docKind, pairing key and labels are
 * worked out here from the path (pathFieldsFor, then settleItem), keeping
 * any label a person set. Adds the pair groups the write touched to `groups`.
 * A file that arrives (a new row, new bytes, or a failed file sent again) is
 * New and joins `arrival`'s batch (2026-11-12); a rename or move is not.
 */
async function upsertDiscovered(
  ctx: MutationCtx,
  args: UpsertArgs,
  groups: Set<string>,
  arrival: Arrival = { now: Date.now() }
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
      ...(await arrivalFields(ctx, null, arrival)),
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
        ...(await arrivalFields(ctx, existing, arrival)),
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
    ...(await arrivalFields(ctx, existing, arrival)),
    status: "discovered",
    text: undefined,
    textStorageId: undefined,
    documentWriterNames: undefined,
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
 * The open batch of the client uploader, or a new one: the uploader sends
 * no person and no batch (scripts/client-uploader is unchanged), so files
 * that arrive within UPLOADER_BATCH_GAP_MS of the last one are one batch.
 */
async function uploaderBatch(ctx: MutationCtx, now: number): Promise<Id<"importBatches">> {
  const last = await ctx.db
    .query("importBatches")
    .withIndex("by_source_and_lastFileAt", (q) => q.eq("source", "uploader"))
    .order("desc")
    .first();
  if (last && now - last.lastFileAt <= UPLOADER_BATCH_GAP_MS) return last._id;
  return await ctx.db.insert("importBatches", {
    source: "uploader",
    startedAt: now,
    lastFileAt: now,
    added: 0,
    alreadyHere: 0,
    failed: 0,
    read: 0,
    couldNotRead: 0,
  });
}

/**
 * Upsert a discovered drive item. Returns the item id when it needs
 * fetching/extraction, or null when the stored copy is already current or the
 * item was already reviewed. `via: "uploader"` (the upload route): the file
 * joins the uploader's open batch, which counts it as added or already here.
 */
export const upsertDiscoveredItem = internalMutation({
  args: { ...upsertFields, via: v.optional(v.literal("uploader")) },
  handler: async (ctx, args): Promise<Id<"ingestionItems"> | null> => {
    const { via, ...fields } = args;
    const groups = new Set<string>();
    const now = Date.now();
    const batchId = via === "uploader" ? await uploaderBatch(ctx, now) : undefined;
    const id = await upsertDiscovered(ctx, fields, groups, { batchId, now });
    await changeBatch(ctx, batchId, id === null ? { alreadyHere: 1 } : { added: 1 }, now, true);
    await recomputeGroups(ctx, groups, ONE_ROW);
    return id;
  },
});

/** Page-sized batch upsert for the delta walk (one mutation per Graph page
 * instead of one per file, which keeps huge initial crawls inside action
 * limits). `runId` (2026-11-12): the sync run, whose batch the files join. */
export const upsertDiscoveredBatch = internalMutation({
  args: { items: v.array(v.object(upsertFields)), runId: v.optional(v.id("oneDriveSyncRuns")) },
  handler: async (ctx, args): Promise<number> => {
    let inserted = 0;
    let unchanged = 0;
    const groups = new Set<string>();
    const now = Date.now();
    const run = args.runId ? await ctx.db.get(args.runId) : null;
    const batchId = run?.batchId;
    for (const item of args.items.slice(0, 250)) {
      if ((await upsertDiscovered(ctx, item, groups, { batchId, now })) !== null) inserted++;
      else unchanged++;
    }
    await changeBatch(ctx, batchId, { added: inserted, alreadyHere: unchanged }, now, inserted + unchanged > 0);
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
      // A file gone before it was read is no longer waited for by its batch.
      ...(await finishBatchRead(ctx, existing, false)),
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
 * Attach stored bytes to a staged item and hand it to extraction in its own
 * action: the upload route's step (attachUpload) and the Import page's
 * (stageImportFiles) are this one function. Adds the pair groups the write
 * touched to `groups`. False when the item is not waiting for its bytes.
 */
async function attachStored(
  ctx: MutationCtx,
  item: Doc<"ingestionItems"> | null,
  storageId: Id<"_storage">,
  delayMs: number,
  groups: Set<string>
): Promise<boolean> {
  if (!item || item.status !== "discovered") return false;
  const { after } = await patchItem(ctx, item, {
    storageId,
    status: "fetched",
    updatedAt: Date.now(),
  });
  // Only an old row the write settled can have moved group.
  for (const key of pairGroupsTouched(item, after)) groups.add(key);
  await ctx.scheduler.runAfter(Math.max(0, delayMs), internal.ingestionSync.extractUploadedItem, {
    itemId: item._id,
  });
  return true;
}

/**
 * Path B (crawler upload), and each PDF of the Graph path since 2026-10-26:
 * attach stored bytes and hand off to extraction in its own action.
 */
export const attachUpload = internalMutation({
  args: { itemId: v.id("ingestionItems"), storageId: v.id("_storage"), delayMs: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const groups = new Set<string>();
    const item = await ctx.db.get(args.itemId);
    if (!(await attachStored(ctx, item, args.storageId, args.delayMs ?? 0, groups))) return null;
    await recomputeGroups(ctx, groups, ONE_ROW);
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
    // 2026-11-16 (writers from initials): the names after a writer cue in
    // the full text (shared/writerNameFromText.ts), [] when there are none.
    documentWriterNames: v.optional(v.array(v.string())),
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
      ...(await finishBatchRead(ctx, item, false)),
      storageId: args.storageId,
      text: args.text,
      textStorageId: args.textStorageId,
      extractNote: args.extractNote,
      // Kept for every file (its category may change); only a final PD,
      // draft or review copy names its writer (settleWithWriter).
      documentWriterNames:
        args.documentWriterNames === undefined ? undefined : cleanDocumentWriterNames(args.documentWriterNames),
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
      ...(await finishBatchRead(ctx, item, true)),
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

// ─── Adding files on the Import page (2026-11-12) ───────────────────────────
// The page's drop and Add files: the browser hashes each file (SHA-256),
// asks which are already here (importFilesHere) so their bytes are never
// sent, starts a batch (startImportBatch), uploads the rest a few at a time
// through upload URLs and stages each group it uploaded (stageImportFiles),
// then says it has finished (finishImportBatch). Staging goes through the
// upload route's own steps (uploadUpsertFields, upsertDiscovered,
// attachStored), so a file is classified, labelled, read and counted the
// same whichever way it arrives. Files only ever land in Import, for an
// admin to review: nothing here reaches the Brain, a company or a project.

/** Hashes one importFilesHere call may ask about. */
const HASH_CHECK_MAX = 200;
/** Files one stageImportFiles call may stage. */
const STAGE_FILES_MAX = 10;
/** Files one page batch may send. */
const PAGE_BATCH_MAX_FILES = 20_000;
/** PDFs staged together are read this far apart, like a put back's (PUT_BACK_READ_SPACING_MS). */
const STAGED_PDF_SPACING_MS = 2_000;

const SHA256_HEX = /^[a-f0-9]{64}$/;

/** Hex of a stored file's sha256, which Convex gives as hex or base64. */
function storedSha256Hex(stored: string): string {
  if (SHA256_HEX.test(stored.toLowerCase())) return stored.toLowerCase();
  try {
    return [...atob(stored)].map((char) => char.charCodeAt(0).toString(16).padStart(2, "0")).join("");
  } catch {
    return "";
  }
}

/** An upload URL for the Import page's files. Admin only. */
export const generateUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    await assertAdmin(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Which of these files (by the SHA-256 hex of their bytes) are already in
 * Import, on any tab, so the page skips them without sending them. A file
 * that could not be read is not "already here": sending it again reads it
 * again, as the uploader's does. Null for anyone but an admin.
 */
export const importFilesHere = query({
  args: { hashes: v.array(v.string()) },
  returns: v.union(v.null(), v.array(v.string())),
  handler: async (ctx, args) => {
    if ((await adminOrNull(ctx)) === null) return null;
    if (args.hashes.length > HASH_CHECK_MAX) {
      domainError("INVALID_INPUT", `Ask about at most ${HASH_CHECK_MAX} files at once.`);
    }
    const here: string[] = [];
    for (const hash of new Set(args.hashes.map((value) => value.toLowerCase()))) {
      if (!SHA256_HEX.test(hash)) continue;
      const rows = await ctx.db
        .query("ingestionItems")
        .withIndex("by_contentHash", (q) => q.eq("contentHash", hash))
        .take(10);
      if (rows.some((row) => row.status !== "failed")) here.push(hash);
    }
    return here;
  },
});

/** Hash characters a page file's own key adds to its path (pageItemKey). */
const PAGE_KEY_HASH_CHARS = 12;

/**
 * The key a file added on the Import page is staged under (2026-11-12). On
 * the page the same path is the same file only when the bytes are the same
 * too: two files called "Report.docx", dropped on their own, share a path
 * but are two files. So the first file with a path keeps the plain key
 * ("local:<path>"), and a file whose path a row already has with other
 * bytes gets a row of its own, keyed by its path and the start of its hash.
 * The row already there is never touched, whatever tab it is on, and the
 * path and name the admin sees stay as dropped. The same bytes again find
 * their own row, which says they are already here. The key ends after the
 * file's type, so no path the uploader sends can ever be one of these.
 * Null when each key is held by other bytes (in practice never).
 */
async function pageItemKey(ctx: MutationCtx, relPath: string, hash: string): Promise<string | null> {
  const plain = `local:${relPath}`;
  for (const key of [plain, `${plain}#${hash.slice(0, PAGE_KEY_HASH_CHARS)}`, `${plain}#${hash}`]) {
    const row = await ctx.db
      .query("ingestionItems")
      .withIndex("by_driveItemId", (q) => q.eq("driveItemId", key))
      .unique();
    if (!row || row.contentHash === hash) return key;
  }
  return null;
}

/** The page's batch, refused unless it is the caller's own. */
async function ownPageBatch(
  ctx: MutationCtx,
  batchId: Id<"importBatches">,
  admin: string
): Promise<Doc<"importBatches">> {
  const batch = await ctx.db.get(batchId);
  if (!batch || batch.source !== "page" || batch.addedBy !== admin) {
    domainError("INVALID_INPUT", "These files belong to another upload. Add them again.");
  }
  return batch;
}

function countArg(value: number, max: number): number {
  return Number.isFinite(value) ? Math.min(Math.max(0, Math.floor(value)), max) : 0;
}

/**
 * Starts a batch for files the signed-in admin dropped or picked: how many
 * the browser will send, and how many it left out as already here.
 */
export const startImportBatch = mutation({
  args: { toSend: v.number(), alreadyHere: v.number() },
  returns: v.id("importBatches"),
  handler: async (ctx, args) => {
    const admin = await assertAdmin(ctx);
    const now = Date.now();
    const toSend = countArg(args.toSend, PAGE_BATCH_MAX_FILES);
    return await ctx.db.insert("importBatches", {
      source: "page",
      addedBy: admin as Id<"users">,
      startedAt: now,
      lastFileAt: now,
      toSend,
      sendingDone: toSend === 0,
      added: 0,
      alreadyHere: countArg(args.alreadyHere, PAGE_BATCH_MAX_FILES),
      failed: 0,
      read: 0,
      couldNotRead: 0,
    });
  },
});

const stageOutcomeValidator = v.object({
  path: v.string(),
  outcome: v.union(v.literal("added"), v.literal("already_here"), v.literal("refused")),
  reason: v.optional(v.string()),
});

/**
 * Stages up to 10 files the browser uploaded into the caller's batch. The
 * server trusts nothing the browser says. First the stored file must be
 * this batch's own upload: there, uploaded within the hour and since the
 * batch started, held by no row and claimed by nobody else. A file that
 * fails that check is refused and never deleted, whatever else is wrong
 * with it. Then each path is cleaned, its type, size and junk rules are the
 * upload route's, and the bytes' SHA-256 must be the one claimed; a file
 * refused there has its upload deleted. A file whose path and bytes are
 * already here is skipped and its upload deleted. A different file with a
 * path a row already has gets a row of its own (pageItemKey). Each file
 * says what happened to it.
 */
export const stageImportFiles = mutation({
  args: {
    batchId: v.id("importBatches"),
    files: v.array(
      v.object({
        path: v.string(),
        storageId: v.id("_storage"),
        contentHash: v.string(),
        lastModifiedAt: v.number(),
      })
    ),
  },
  returns: v.array(stageOutcomeValidator),
  handler: async (ctx, args) => {
    const admin = await assertAdmin(ctx);
    const batch = await ownPageBatch(ctx, args.batchId, admin);
    if (args.files.length > STAGE_FILES_MAX) {
      domainError("INVALID_INPUT", `Stage at most ${STAGE_FILES_MAX} files at once.`);
    }
    const now = Date.now();
    const groups = new Set<string>();
    const outcomes: Array<Infer<typeof stageOutcomeValidator>> = [];
    let added = 0;
    let alreadyHere = 0;
    let pdfs = 0;
    for (const file of args.files) {
      // Refused, and the stored file left alone: it may not be this batch's.
      const refuseKeeping = (reason: string) => outcomes.push({ path: file.path, outcome: "refused", reason });
      const stored = await ctx.db.system.get("_storage", file.storageId);
      if (!stored || now - stored._creationTime > FRESH_UPLOAD_MS) {
        refuseKeeping("missing");
        continue;
      }
      // The browser uploads a batch's files after it starts the batch.
      if (stored._creationTime < batch.startedAt) {
        refuseKeeping("not_this_batch");
        continue;
      }
      const claim = await uploadClaimFor(ctx, file.storageId);
      if ((claim && claim.userId !== admin) || (await isStorageReferenced(ctx, file.storageId))) {
        refuseKeeping("in_use");
        continue;
      }
      // From here the stored file is this batch's own upload: a refused one is deleted.
      const refuse = async (reason: string) => {
        await ctx.storage.delete(file.storageId);
        outcomes.push({ path: file.path, outcome: "refused", reason });
      };
      const relPath = sanitizeRelPath(file.path);
      const hash = file.contentHash.toLowerCase();
      if (!relPath) {
        await refuse("path");
        continue;
      }
      if (isJunkPath(relPath)) {
        await refuse("junk");
        continue;
      }
      const name = relPath.split("/").pop()!;
      if (!INGEST_EXTENSIONS.has(extensionOf(name))) {
        await refuse("type");
        continue;
      }
      if (!SHA256_HEX.test(hash)) {
        await refuse("hash");
        continue;
      }
      if (stored.size === 0) {
        await refuse("empty");
        continue;
      }
      if (stored.size > MAX_FILE_BYTES) {
        await refuse("size");
        continue;
      }
      if (storedSha256Hex(stored.sha256) !== hash) {
        await refuse("hash");
        continue;
      }
      const key = await pageItemKey(ctx, relPath, hash);
      if (key === null) {
        await refuse("path_taken");
        continue;
      }
      const fields = { ...uploadUpsertFields(relPath, stored.size, file.lastModifiedAt, hash), driveItemId: key };
      const id = await upsertDiscovered(ctx, fields, groups, { batchId: args.batchId, now });
      if (id === null) {
        // Same path, same bytes: already here. The upload is not needed.
        await ctx.storage.delete(file.storageId);
        alreadyHere += 1;
        outcomes.push({ path: relPath, outcome: "already_here" });
        continue;
      }
      const delay = extensionOf(name) === "pdf" ? pdfs++ * STAGED_PDF_SPACING_MS : 0;
      await attachStored(ctx, await ctx.db.get(id), file.storageId, delay, groups);
      added += 1;
      outcomes.push({ path: relPath, outcome: "added" });
    }
    await changeBatch(ctx, args.batchId, { added, alreadyHere }, now, true);
    // Up to ten files: schedule every pair group they touched.
    await recomputeGroups(ctx, groups, MANY_ROWS);
    return outcomes;
  },
});

/**
 * The browser has finished sending its batch: `failed` files could not be
 * sent (it keeps them for "Try again", which reopens the batch).
 */
export const finishImportBatch = mutation({
  args: { batchId: v.id("importBatches"), failed: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const admin = await assertAdmin(ctx);
    await ownPageBatch(ctx, args.batchId, admin);
    await ctx.db.patch(args.batchId, {
      sendingDone: true,
      failed: countArg(args.failed, PAGE_BATCH_MAX_FILES),
      lastFileAt: Date.now(),
    });
    return null;
  },
});

/** "Try again": the browser sends the files that failed, into the same batch. */
export const reopenImportBatch = mutation({
  args: { batchId: v.id("importBatches") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const admin = await assertAdmin(ctx);
    await ownPageBatch(ctx, args.batchId, admin);
    await ctx.db.patch(args.batchId, { sendingDone: false, lastFileAt: Date.now() });
    return null;
  },
});

const batchSourceValidator = v.union(v.literal("page"), v.literal("uploader"), v.literal("onedrive"));

/** The person who added a batch, by name; null when none is on record. */
async function addedByName(ctx: QueryCtx, userId: string | undefined): Promise<string | null> {
  if (!userId) return null;
  const id = ctx.db.normalizeId("users", userId);
  return id ? (chatDisplayName(await ctx.db.get(id)) ?? null) : null;
}

/** Batches importActivity returns, newest file first. */
const ACTIVITY_BATCHES = 6;

/**
 * The latest batches by their last file, for the line under the toolbar:
 * the page decides with its own clock which one, if any, is still worth a
 * line (a query has no clock that moves). `mine`: the signed-in admin added it.
 */
export const importActivity = query({
  args: {},
  returns: v.union(
    v.null(),
    v.array(
      v.object({
        _id: v.id("importBatches"),
        source: batchSourceValidator,
        mine: v.boolean(),
        addedByName: v.union(v.null(), v.string()),
        startedAt: v.number(),
        lastFileAt: v.number(),
        toSend: v.optional(v.number()),
        sendingDone: v.boolean(),
        added: v.number(),
        alreadyHere: v.number(),
        failed: v.number(),
        read: v.number(),
        couldNotRead: v.number(),
        lastReadAt: v.optional(v.number()),
      })
    )
  ),
  handler: async (ctx) => {
    const me = await adminOrNull(ctx);
    if (me === null) return null;
    const batches = await ctx.db.query("importBatches").withIndex("by_lastFileAt").order("desc").take(ACTIVITY_BATCHES);
    const rows = [];
    for (const batch of batches) {
      rows.push(
        definedFields({
          _id: batch._id,
          source: batch.source,
          mine: batch.addedBy === me,
          addedByName: await addedByName(ctx, batch.addedBy),
          startedAt: batch.startedAt,
          lastFileAt: batch.lastFileAt,
          toSend: batch.toSend,
          sendingDone: batch.sendingDone ?? batch.source !== "page",
          added: batch.added,
          alreadyHere: batch.alreadyHere,
          failed: batch.failed,
          read: batch.read,
          couldNotRead: batch.couldNotRead,
          lastReadAt: batch.lastReadAt,
        })
      );
    }
    return rows;
  },
});

/** The most History rows one page asks for ("Show 25 more" asks for 25). */
const HISTORY_PAGE_MAX = 100;
/** History cursors: a batches cursor, then (once every batch is listed) where the old sync runs are up to. */
const HISTORY_BATCHES = "batches:";
const HISTORY_RUNS = "runs:";

const historyRowValidator = v.object({
  key: v.string(),
  startedAt: v.number(),
  source: batchSourceValidator,
  who: v.union(v.null(), v.string()),
  added: v.number(),
  // Null where nothing counted it (a OneDrive sync run from before batches).
  alreadyHere: v.union(v.null(), v.number()),
  couldNotRead: v.union(v.null(), v.number()),
  notSent: v.number(),
});
type HistoryRow = Infer<typeof historyRowValidator>;

/** The old sync runs after `after` (a "startedAt:creationTime" cursor, or "" for the newest), up to `numItems`. */
async function legacySyncRuns(
  ctx: QueryCtx,
  after: string,
  numItems: number
): Promise<{ rows: HistoryRow[]; isDone: boolean; continueCursor: string }> {
  // Runs from before batches all started before the first batch: every run
  // since has its batch, and is that batch's row (startSync makes both at once).
  const firstBatch = await ctx.db.query("importBatches").withIndex("by_startedAt").order("asc").first();
  let bound: { startedAt: number; creationTime: number } | null = null;
  if (after) {
    const [startedAt, creationTime] = after.split(":").map(Number);
    if (!Number.isFinite(startedAt) || !Number.isFinite(creationTime)) throw new Error("InvalidCursor: not a History cursor");
    bound = { startedAt, creationTime };
  }
  const want = numItems + 1;
  const found: Doc<"oneDriveSyncRuns">[] = [];
  if (bound) {
    const { startedAt, creationTime } = bound;
    // Runs that started at the same time as the last one listed, then older.
    found.push(
      ...(await ctx.db
        .query("oneDriveSyncRuns")
        .withIndex("by_startedAt", (q) => q.eq("startedAt", startedAt).lt("_creationTime", creationTime))
        .order("desc")
        .take(want))
    );
  }
  if (found.length < want) {
    const below = bound?.startedAt ?? firstBatch?.startedAt;
    const older =
      below === undefined
        ? ctx.db.query("oneDriveSyncRuns").withIndex("by_startedAt")
        : ctx.db.query("oneDriveSyncRuns").withIndex("by_startedAt", (q) => q.lt("startedAt", below));
    found.push(...(await older.order("desc").take(want - found.length)));
  }
  const page = found.slice(0, numItems);
  const rows: HistoryRow[] = [];
  for (const run of page) {
    if (run.batchId) continue;
    rows.push({
      key: run._id,
      startedAt: run.startedAt,
      source: "onedrive",
      who: await addedByName(ctx, run.triggeredBy),
      added: run.discovered,
      alreadyHere: null,
      couldNotRead: null,
      notSent: 0,
    });
  }
  const last = page.at(-1);
  return {
    rows,
    isDone: found.length <= numItems,
    continueCursor: last ? `${last.startedAt}:${last._creationTime}` : after,
  };
}

/**
 * The History tab, a page at a time (Greptile fix, 2026-11-17: "Show 25
 * more" reaches every row, not only the newest 500): one row per batch,
 * newest first, then the OneDrive sync runs from before batches (the old
 * page's sync log), which all started before the first batch. Batches are
 * paged with paginate, so a page keeps its rows while new batches arrive;
 * the page that lists the last batches also lists the first `numItems` old
 * runs, so a new batch never pushes one of those out between pages. Rows are
 * plain: a batch's files are not listed on their own (its files show on To
 * review, where the New filter shows what arrived lately).
 */
export const importHistory = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(historyRowValidator),
  handler: async (ctx, args) => {
    if ((await adminOrNull(ctx)) === null) return EMPTY_PAGE;
    const { numItems } = boundedPage(args.paginationOpts, HISTORY_PAGE_MAX);
    const cursor = args.paginationOpts.cursor ?? HISTORY_BATCHES;
    if (cursor.startsWith(HISTORY_RUNS)) {
      const runs = await legacySyncRuns(ctx, cursor.slice(HISTORY_RUNS.length), numItems);
      return { page: runs.rows, isDone: runs.isDone, continueCursor: HISTORY_RUNS + runs.continueCursor };
    }
    if (!cursor.startsWith(HISTORY_BATCHES)) throw new Error("InvalidCursor: not a History cursor");
    const batches = await ctx.db
      .query("importBatches")
      .withIndex("by_startedAt")
      .order("desc")
      .paginate({ numItems, cursor: cursor.slice(HISTORY_BATCHES.length) || null });
    const page: HistoryRow[] = [];
    for (const batch of batches.page) {
      page.push({
        key: batch._id,
        startedAt: batch.startedAt,
        source: batch.source,
        who: await addedByName(ctx, batch.addedBy),
        added: batch.added,
        alreadyHere: batch.alreadyHere,
        couldNotRead: batch.couldNotRead,
        notSent: batch.failed,
      });
    }
    if (!batches.isDone) return { page, isDone: false, continueCursor: HISTORY_BATCHES + batches.continueCursor };
    const runs = await legacySyncRuns(ctx, "", numItems);
    return { page: [...page, ...runs.rows], isDone: runs.isDone, continueCursor: HISTORY_RUNS + runs.continueCursor };
  },
});

/**
 * A file is New for 24 hours (2026-11-12): clears the flag on files whose
 * time is up, through patchItem so the bands' New counts follow, a hundred
 * a run, scheduling the next run while more are due. A cron starts it.
 */
export const clearExpiredNew = internalMutation({
  args: {},
  returns: v.object({ cleared: v.number(), more: v.boolean() }),
  handler: async (ctx) => {
    const cutoff = Date.now() - NEW_FOR_MS;
    const rows = await ctx.db
      .query("ingestionItems")
      .withIndex("by_isNew_and_arrivedAt", (q) => q.eq("isNew", true).lt("arrivedAt", cutoff))
      .take(NEW_CLEAR_BATCH);
    for (const row of rows) await patchItem(ctx, row, { isNew: undefined });
    const more = rows.length === NEW_CLEAR_BATCH;
    if (more) await ctx.scheduler.runAfter(0, internal.ingestion.clearExpiredNew, {});
    return { cleared: rows.length, more };
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
