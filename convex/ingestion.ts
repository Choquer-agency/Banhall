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
import {
  contentHash as brainContentHash,
  findImportMatch,
  importSource,
  relabelImportedSource,
  revokeBrainSourceRow,
} from "./brain";
import { patchBrainSource } from "./ai/brain/rag";
import {
  addImportedCompanyFile,
  linkKeyProjectsPage,
  removeImportedCompanyFile,
  updateImportedCompanyFileLabels,
} from "./companyFiles";
import { hasReadText as hasServerReadText } from "./lib/serverReading";
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
  type IngestionCategory,
} from "./lib/ingestionClassify";
import {
  changedFields,
  definedFields,
  fieldsForLabels,
  followsRememberedWriter,
  hasReadText,
  IMPORT_TEXT_CUT_NOTE,
  isBeingRead,
  labelPatchFields,
  initialsReviewerFields,
  initialsReviewerStep,
  initialsWriterFields,
  initialsWriterStep,
  followsRememberedReviewer,
  pickReviewerFields,
  reviewerBeforePickFields,
  takesInitialsReviewer,
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
  approveRefusalValidator,
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
  companyIdentityNames,
  dashboardCompanyForKey,
  mergedClientForKey,
} from "./lib/clients";
import { projectIndustry } from "./clients";
import {
  buildImportBrainCopy,
  IMPORT_BRAIN_DEFAULT_WRITER_TIER,
  IMPORT_BRAIN_NOT_COVERED,
  IMPORT_BRAIN_REFUSALS,
  type ImportBrainCopyResult,
} from "./lib/importBrainCopy";
import { dashboardCompanyKey, normalizeDashboardText } from "../shared/dashboardProjection";
import { normalizeCraScienceCode } from "../shared/craScienceCodes";
import { cleanDocumentWriterNames, writerNamesFromText } from "../shared/writerNameFromText";
import { industrySlug } from "../shared/industries";
import {
  APPROVAL_STALE_MS,
  approvedEditApplies,
  approveRefusalFor,
  canDelete,
  canPutBack,
  craReviewedApplies,
  DELETED_IN_ONEDRIVE_NOTE,
  deletedReasonFor,
  labelApplies,
  looksLikeEmail,
  reviewerApplies,
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
  previousInitials?: string | null,
  previousReviewerInitials?: string | null
): Promise<IngestionItemFields> {
  const withWriter = await settleInitialsWriter(ctx, row, previousInitials);
  const settled = await settleInitialsReviewer(ctx, withWriter, previousReviewerInitials);
  return await withDocumentName(ctx, { ...settled, ...previewWriterNames(settled) });
}

/**
 * The row with the reviewer its reviewer initials give (2026-11-17): the
 * writer's steps (initialsReviewerStep), with the same pick and the same
 * check (writerForInitials), so "PN" is one person whether PN wrote a PD or
 * reviewed it. A missing reviewer is never a check reason.
 */
async function settleInitialsReviewer(
  ctx: MutationCtx,
  settled: IngestionItemFields,
  previousInitials?: string | null
): Promise<IngestionItemFields> {
  const initials = writerInitialsKey(settled.reviewerInitials);
  const initialsChanged = previousInitials !== undefined && writerInitialsKey(previousInitials) !== initials;
  const pick = initials === null ? null : await pickedWriter(ctx, initials);
  const step = initialsReviewerStep(settled, { hasPick: pick !== null, initialsChanged });
  let fields: Partial<IngestionItemFields> | null = null;
  if (step === "clear") fields = initialsReviewerFields(null, "initials");
  else if (step === "pick") fields = pickReviewerFields(settled, pick!, initialsChanged);
  else if (step === "fill") {
    const before = reviewerBeforePickFields(settled, initialsChanged);
    fields =
      before && (await liveWriter(ctx, before.reviewerId))
        ? before
        : initialsReviewerFields(await writerForInitials(ctx, initials!), "initials");
  }
  if (fields === null) return settled;
  const changed = Object.keys(changedFields(settled, { ...settled, ...fields })).length > 0;
  return changed ? settleItem({ ...settled, ...fields }) : settled;
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
  await adjustWriterFiles(ctx, null, row);
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
  let settled = await settleWithWriter(ctx, { ...fields, ...patch }, before.writerInitials ?? null, before.reviewerInitials ?? null);
  let changes = changedFields(fields, settled);
  const changed = Object.keys(changes).length > 0;
  if (changed && options.touch) {
    settled = { ...settled, updatedAt: Date.now() };
    changes = { ...changes, updatedAt: settled.updatedAt };
  }
  if (changed) await ctx.db.patch(_id, changes);
  const after = { _id, _creationTime, ...definedFields(settled) } as Doc<"ingestionItems">;
  await adjustImportCompanyCounts(ctx, before, after);
  await adjustWriterFiles(ctx, before, after);
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
  // 2026-11-17: the writer who reviewed the PD, its label as it is now
  // (withWriterLabels), whether it has a login, and where it came from
  // ("initials", "pick" or "person", as writerNameSource).
  reviewerId: v.optional(v.id("pdWriters")),
  reviewerName: v.optional(v.string()),
  reviewerHasLogin: v.optional(v.boolean()),
  reviewerSource: v.optional(writerNameSourceValidator),
  // 2026-11-17: an Admin marked this final PD "Reviewed by CRA" (final PDs only).
  craReviewed: v.optional(v.boolean()),
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
  // 2026-11-17 (Approve on Import), approved files only: the company page
  // the file is on (absent when its company file was removed since, or it
  // was approved on the old page), and what became of it in the Brain:
  // in_brain, brain_check (waiting for a person), kept_out, or removed (an
  // Admin removed its Brain copy since). Absent: it has no Brain copy and
  // none is waiting (every file but a final PD).
  companyPage: v.optional(v.object({ key: v.string(), name: v.string() })),
  brain: v.optional(
    v.union(v.literal("in_brain"), v.literal("brain_check"), v.literal("kept_out"), v.literal("removed"))
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
    writerId: item.writerId,
    writerInitials: item.writerInitials,
    reviewerInitials: item.reviewerInitials,
    reviewerId: item.reviewerId,
    reviewerSource: item.reviewerSource,
    craReviewed: item.craReviewed === true && item.category === "final_pd" ? true : undefined,
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
    for (const id of [row.writerId, row.reviewerId]) {
      if (!id || labels.has(id)) continue;
      const writer = await liveWriter(ctx, id);
      const user = writer?.userId ? await ctx.db.get(writer.userId) : null;
      labels.set(id, writer ? { label: writerLabelFor(writer, user), hasLogin: isLoginMember(user) } : null);
    }
  }
  return rows.map((row) => {
    const found = row.writerId ? labels.get(row.writerId) : null;
    const reviewer = row.reviewerId ? labels.get(row.reviewerId) : null;
    const withWriter = found ? { ...row, writerName: found.label, writerHasLogin: found.hasLogin } : row;
    // The reviewer (2026-11-17) has no stored name: a gone one shows as none.
    if (!row.reviewerId) return withWriter;
    if (!reviewer) {
      const { reviewerId: _gone, reviewerSource: _source, ...rest } = withWriter;
      return rest as R;
    }
    return { ...withWriter, reviewerName: reviewer.label, reviewerHasLogin: reviewer.hasLogin };
  });
}

/**
 * Approved rows with what each became (2026-11-17): the company page its
 * company file is on, and its Brain state, read from the company file, its
 * company and the Brain source's list card (each read once a page). Other
 * rows are returned as they are.
 */
async function withApprovedLinks<R extends SheetRow>(
  ctx: QueryCtx,
  items: readonly Doc<"ingestionItems">[],
  rows: R[]
): Promise<R[]> {
  const clients = new Map<Id<"clients">, Doc<"clients"> | null>();
  const out: R[] = [];
  for (const [index, row] of rows.entries()) {
    const item = items[index];
    if (!item || item.status !== "approved") {
      out.push(row);
      continue;
    }
    let companyPage: { key: string; name: string } | undefined;
    const file = item.companyFileId ? await ctx.db.get(item.companyFileId) : null;
    if (file) {
      if (!clients.has(file.clientId)) clients.set(file.clientId, await ctx.db.get(file.clientId));
      const client = clients.get(file.clientId);
      if (client?.status === "active") companyPage = { key: client.nameKey, name: client.name };
    }
    let brain: SheetRow["brain"];
    if (item.brainSourceId) {
      const card = await ctx.db
        .query("brainSourceCards")
        .withIndex("by_sourceId", (q) => q.eq("sourceId", item.brainSourceId!))
        .first();
      // No card: the source was removed for good on /admin/brain
      // (removeSourcePermanently leaves the file's brainSourceId).
      brain = !card || card.status === "revoked" ? "removed" : "in_brain";
    } else if (item.brainCheck === "waiting") brain = "brain_check";
    else if (item.brainCheck === "kept_out") brain = "kept_out";
    out.push(definedFields({ ...row, companyPage, brain }));
  }
  return out;
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
      // 2026-11-17: approved final PDs waiting for their Brain check (Approved only).
      brainCheck: v.number(),
      complete: v.boolean(),
    })
  ),
  handler: async (ctx, args) => {
    if ((await adminOrNull(ctx)) === null) return null;
    const bands = await ctx.db
      .query("importCompanies")
      .withIndex("by_sheetTab_and_companyKey", (q) => q.eq("sheetTab", args.tab))
      .take(SHEET_BAND_READ_LIMIT + 1);
    const totals = { files: 0, companies: 0, needsCheck: 0, ready: 0, beingRead: 0, newFiles: 0, brainCheck: 0 };
    for (const band of bands.slice(0, SHEET_BAND_READ_LIMIT)) {
      // A rebuild's start row has no files yet; it is not a company on the sheet.
      if (band.total <= 0) continue;
      totals.files += band.total;
      if (band.companyKey !== NO_COMPANY_KEY) totals.companies += 1;
      totals.needsCheck += band.needsCheck;
      totals.ready += band.ready;
      totals.beingRead += band.beingRead;
      totals.newFiles += band.newFiles ?? 0;
      totals.brainCheck += band.brainCheck ?? 0;
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
  // 2026-11-17: its approved final PDs waiting for a Brain check (Approved only).
  brainCheck: v.number(),
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

// ─── Brain copy of an imported final PD (2026-11-17) ────────────────────────
// What a later Approve needs to turn an approved final PD into a scrubbed
// Brain copy (docs/product-domain.md, the 2026-11-17 Brain copy amendment).
// Nothing here writes: Approve calls `importBrainCopyFor` in its own
// mutation, passes the fields to `importSource` with `approve: true`, and
// sets the file's `brainSourceId` (retrieval's own-company check reads it).

/** The company row an import file's company key names (following merges), or null. */
async function importClientForKey(ctx: QueryCtx, companyKey: string): Promise<Doc<"clients"> | null> {
  if (companyKey === NO_COMPANY_KEY) return null;
  const active = await activeClientForKey(ctx, companyKey);
  if (active) return active;
  const merged = await mergedClientForKey(ctx, companyKey);
  return merged ? await activeClientAfterMerges(ctx, merged) : null;
}

/**
 * The Brain copy of one import file from its full text (read from storage by
 * the caller), or the plain reason it cannot have one. Reads the company and
 * every name tied to it, the industry picked for a new company, and the
 * file's writer.
 */
export async function importBrainCopyFor(
  ctx: QueryCtx,
  item: Doc<"ingestionItems">,
  fullText: string,
  alsoRemove: readonly string[] = []
): Promise<ImportBrainCopyResult> {
  const companyKey = item.companyKey;
  const company = companyKey ? await importClientForKey(ctx, companyKey) : null;
  let identity: { organizations: string[]; people: string[] } = { organizations: [], people: [] };
  if (company) {
    try {
      identity = await companyIdentityNames(ctx, company);
    } catch {
      return {
        ok: false,
        code: "names_unreadable",
        reason: IMPORT_BRAIN_REFUSALS.names_unreadable,
        logReason: IMPORT_BRAIN_REFUSALS.names_unreadable,
        notCovered: IMPORT_BRAIN_NOT_COVERED,
      };
    }
  }
  const picks = !company && companyKey ? await newCompanyPicks(ctx, companyKey) : null;
  const writer = item.writerId ? await ctx.db.get(item.writerId) : null;
  return buildImportBrainCopy(
    {
      item,
      company,
      identity,
      newCompanyIndustry: picks?.industry,
      writer,
      alsoRemove,
    },
    fullText
  );
}

const importBrainCopyResultValidator = v.union(
  v.object({
    ok: v.literal(true),
    warnings: v.array(v.string()),
    notCovered: v.string(),
    fields: v.object({
      kind: v.literal("pd_pair"),
      docType: v.literal("pd"),
      title: v.string(),
      content: v.string(),
      industry: v.string(),
      writerName: v.optional(v.string()),
      writerTier: v.number(),
      scienceCode: v.optional(v.string()),
      fiscalYear: v.optional(v.number()),
      importItemId: v.id("ingestionItems"),
      importContentHash: v.string(),
    }),
  }),
  v.object({
    ok: v.literal(false),
    code: v.union(
      v.literal("not_final_pd"),
      v.literal("no_company"),
      v.literal("no_text"),
      v.literal("no_industry"),
      v.literal("names_unreadable"),
      v.literal("also_remove_no_word"),
      v.literal("names_left"),
      v.literal("not_found")
    ),
    reason: v.string(),
    logReason: v.string(),
    notCovered: v.string(),
  })
);

/**
 * The Brain copy an Approve would make for one import file, without making
 * it (internal: Approve's action reads the file's text from storage first).
 * Approve shows a person the scrubbed text or the reason, with a box for
 * more words to remove (`alsoRemove`, such as product names), before the
 * copy is made.
 */
export const importBrainCopyPreview = internalQuery({
  args: { itemId: v.id("ingestionItems"), text: v.string(), alsoRemove: v.optional(v.array(v.string())) },
  returns: importBrainCopyResultValidator,
  handler: async (
    ctx,
    args
  ): Promise<ImportBrainCopyResult | { ok: false; code: "not_found"; reason: string; logReason: string; notCovered: string }> => {
    const item = await ctx.db.get(args.itemId);
    if (!item) return { ok: false, code: "not_found", reason: ITEM_NOT_FOUND, logReason: ITEM_NOT_FOUND, notCovered: IMPORT_BRAIN_NOT_COVERED };
    return await importBrainCopyFor(ctx, item, args.text, args.alsoRemove ?? []);
  },
});

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
          brainCheck: band.brainCheck ?? 0,
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
    const rows = await withWriterLabels(ctx, result.page.map(sheetRow));
    return { ...result, page: await withApprovedLinks(ctx, result.page, rows) };
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
    const rows = await withWriterLabels(
      ctx,
      files.map((file) =>
        definedFields({
          ...sheetRow(file),
          companyKey: file.companyKey ?? NO_COMPANY_KEY,
          clientName: file.clientName,
        })
      )
    );
    return { files: await withApprovedLinks(ctx, files, rows), companies };
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
    const [row] = await withApprovedLinks(ctx, [item], await withWriterLabels(ctx, [sheetRow(item)]));
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
// 2026-11-17: an approved file is on its company's page (and a final PD may
// be in the Brain), so it is neither rejected nor deleted here.
const ALREADY_APPROVED = "This file is already approved, so it cannot be rejected or deleted here.";
const STILL_PROCESSING = "This file is still processing and cannot be deleted yet";
const ONLY_DELETED_RESTORE = "This file is not deleted, so there is nothing to put back.";

/**
 * 2026-11-17 (owner): the old review page's Approve is switched off. Files
 * are approved on the Import page, which puts every approved file on its
 * company's page and gives a final PD a Brain check first.
 */
export const OLD_APPROVE_OFF =
  "Approving here is switched off. Approve files on the Import page: they go on their company's page, and final PDs get a Brain check.";

/**
 * The old review page's Approve (BNH-17), switched off on 2026-11-17: it
 * refuses every call in plain words that point to the Import page, so an
 * old page or preview that still offers it changes nothing. Its arguments
 * stay as they were. Reject, delete and port to a project keep working.
 */
export const approveItem = action({
  args: {
    itemId: v.id("ingestionItems"),
    industry: v.string(),
    writerName: v.optional(v.string()),
    writerTier: v.number(),
    scienceCode: v.optional(v.string()),
  },
  handler: async (ctx): Promise<Id<"brainSources">> => {
    await ctx.runQuery(internal.ingestion.adminCheck, {});
    domainError("INVALID_STATE", OLD_APPROVE_OFF, { reason: "OLD_APPROVE_OFF" });
  },
});

/** Throws "Admin only" for anyone else; for actions, which have no database. */
export const adminCheck = internalQuery({
  args: {},
  returns: v.id("users"),
  handler: async (ctx) => await assertAdmin(ctx),
});

// ─── Approve on Import (2026-11-17, docs/product-domain.md) ─────────────────
// Owner rule, "as told to the client": approving a file on the Import page
// puts every approved file on its company's page; a final PD also gets a
// scrubbed Brain copy, but only after a person has read it (the Brain check
// below). Approve finds or makes the company (a new one takes the industry
// picked on the sheet), adds the company file with the Import file's own
// stored original, and marks the file approved through patchItem, so the
// company counts and pairing follow. It never makes a project, a
// previous_pd file or a lesson set. Admins only.

/** Files one approval step handles before it schedules the next step. */
const APPROVAL_STEP_FILES = 10;
/** Import files one step of a company's approval reads to find its ready files. */
const APPROVAL_LIST_PAGE = 40;
/** Refused files one approval's result lists. */
const APPROVAL_REFUSALS_LISTED = 100;

/**
 * Whether the extraction cut the Import file's text at the import's limit
 * (2026-11-17): the stored `textCut`, set by every extraction; for a row
 * read before it existed, the words finishExtraction left in its note
 * (IMPORT_TEXT_CUT_NOTE). Approval stores the answer on the row.
 */
export function importTextCut(item: Pick<Doc<"ingestionItems">, "textCut" | "extractNote">): boolean {
  return item.textCut ?? (item.extractNote ?? "").includes(IMPORT_TEXT_CUT_NOTE);
}

/**
 * Whether the Import file holds its whole text (2026-11-17): read into
 * storage, and not cut at the import's limit. A file read long ago has only
 * its preview; its company file is read again on the server.
 */
export function importHasWholeText(item: Pick<Doc<"ingestionItems">, "textStorageId" | "extractNote" | "textCut">): boolean {
  return item.textStorageId !== undefined && !importTextCut(item);
}

/** The company file category an Import category is filed under on approval. */
export function companyFileCategoryFor(
  category: Doc<"ingestionItems">["category"]
): NonNullable<Doc<"companyFiles">["category"]> | null {
  switch (category) {
    case "final_pd":
    case "draft":
    case "review_copy":
    case "transcript":
    case "supporting":
      return category;
    // A file of the company, not of a fiscal year: company background, which
    // a draft reads as a file added by hand (2026-11-17 company files entry).
    case "company_file":
      return "background";
    default:
      return null;
  }
}

type ApproveRefusalCode = Infer<typeof approveRefusalValidator>;
type ImportCompany =
  | { kind: "client"; client: Doc<"clients"> }
  | { kind: "create"; name: string; industry?: string; fromProjects: boolean }
  | { kind: "refuse"; reason: ApproveRefusalCode; detail?: string };

/**
 * The company an Import file is approved into, by the app's company key
 * (as porting matches projects), failing closed (D7: never merge or pick
 * on its own): the one active company with the key; a key merged into
 * another company is refused with that company's name, so a person moves
 * the file there; two active companies with the key are refused. A key only
 * projects carry gets its company row made from them, as the company page
 * does; a new key gets a new company with the industry picked on the sheet.
 */
async function importCompanyFor(ctx: MutationCtx, item: Doc<"ingestionItems">): Promise<ImportCompany> {
  const key = item.companyKey;
  if (!key) return { kind: "refuse", reason: "needs_check" };
  const active = await ctx.db
    .query("clients")
    .withIndex("by_status_and_nameKey", (q) => q.eq("status", "active").eq("nameKey", key))
    .take(2);
  if (active.length > 1) return { kind: "refuse", reason: "company_unclear" };
  if (active.length === 1) return { kind: "client", client: active[0] };
  const merged = await mergedClientForKey(ctx, key);
  if (merged) {
    const kept = await activeClientAfterMerges(ctx, merged);
    return { kind: "refuse", reason: "company_merged", ...(kept ? { detail: `Merged into ${kept.name}` } : {}) };
  }
  const picks = await newCompanyPicks(ctx, key);
  const projects = await dashboardCompanyForKey(ctx, key);
  if (projects && projects.projectCount > 0) {
    const industry = picks?.industry ?? (await projectIndustry(ctx, key)) ?? undefined;
    return {
      kind: "create",
      name: projects.clientName.trim() || item.clientName?.trim() || key,
      ...(industry ? { industry } : {}),
      fromProjects: true,
    };
  }
  const band = await importCompanyRow(ctx, "review", key);
  const name = (band?.displayName.trim() || item.clientName?.trim() || key).slice(0, 200);
  return { kind: "create", name, ...(picks?.industry ? { industry: picks.industry } : {}), fromProjects: false };
}

/** Makes the company an approval found no row for: the sheet's picked industry, its projects linked. */
async function createImportCompany(
  ctx: MutationCtx,
  key: string,
  plan: Extract<ImportCompany, { kind: "create" }>,
  actor: Doc<"users">
): Promise<Doc<"clients">> {
  const now = Date.now();
  const clientId = await ctx.db.insert("clients", {
    name: plan.name,
    nameKey: key,
    ...(plan.industry ? { industry: plan.industry } : {}),
    status: "active",
    nameHistoryComplete: true,
    createdBy: actor._id,
    createdAt: now,
    updatedAt: now,
  });
  // Projects with the key reach their new company's files, as when the
  // company page makes a company from its projects.
  if (plan.fromProjects) await linkKeyProjectsPage(ctx, key, clientId, null);
  // The company is made: what the sheet held for it until now has done its job.
  const picks = await newCompanyPicks(ctx, key);
  if (picks) await ctx.db.delete(picks._id);
  return (await ctx.db.get(clientId))!;
}

type ApproveOutcome =
  | { state: "approved" | "already"; companyFileId?: Id<"companyFiles">; readOnServer?: boolean }
  | { state: "refused"; reason: ApproveRefusalCode; detail?: string };

/**
 * Approves one Import file in the caller's mutation (2026-11-17): the
 * refusals first, then the company (found or made), the company file
 * (sharing the original; `text` is the Import file's whole text, read by the
 * caller's action, when it has it), then the file approved with its link,
 * and pairing for its group. A final PD waits for its Brain check. Safe to
 * run again: an approved file is "already", and its company file is found.
 */
async function approveOneFile(
  ctx: MutationCtx,
  itemId: Id<"ingestionItems">,
  read: { text: string; textStorageId: Id<"_storage"> } | undefined,
  actor: Doc<"users">,
  options: { companyKey?: string } = {}
): Promise<ApproveOutcome> {
  const item = await ctx.db.get(itemId);
  if (!item) return { state: "refused", reason: "missing" };
  if (item.status === "approved") {
    return { state: "already", ...(item.companyFileId ? { companyFileId: item.companyFileId } : {}) };
  }
  const refusal = approveRefusalFor(item);
  if (refusal) return { state: "refused", reason: refusal };
  // A company's "Approve N ready" approves only files still in that company.
  if (options.companyKey !== undefined && item.companyKey !== options.companyKey) {
    return { state: "refused", reason: "left_company" };
  }
  // The text the action read is used only if it is still the file's whole
  // text (the file may have been read again meanwhile); otherwise the
  // original is read on the server, as for a file a person adds.
  const text =
    read && read.textStorageId === item.textStorageId && importHasWholeText(item) ? read.text : undefined;
  const category = companyFileCategoryFor(item.category);
  if (!category || !item.companyKey) return { state: "refused", reason: "needs_check" };
  const found = await importCompanyFor(ctx, item);
  if (found.kind === "refuse") return { state: "refused", reason: found.reason, ...(found.detail ? { detail: found.detail } : {}) };
  // A final PD's Brain copy needs an industry: the company's, or the one
  // picked for a new company. Refused before anything is made.
  const industry = found.kind === "client" ? found.client.industry : found.industry;
  if (item.category === "final_pd" && !industry?.trim()) {
    return { state: "refused", reason: "no_industry", detail: "Pick an industry for this company." };
  }
  const client = found.kind === "client" ? found.client : await createImportCompany(ctx, item.companyKey, found, actor);
  const wholeText = text !== undefined && hasServerReadText(text) ? text : undefined;
  // A file with no original and only its preview keeps the preview: nothing else can be read.
  const companyText = wholeText ?? (item.storageId === undefined && item.text?.trim() ? item.text : null);
  // The file's own reviewer as the Reviewer column shows it (from its
  // reviewer initials, a pick for them, or a person; an edit after approval
  // is kept through Send back), counted in its writer's reviewCount, so the
  // company file never names a writer that could be removed. A reviewer
  // that no longer exists is left out.
  const savedReviewer = await liveWriter(ctx, item.reviewerId);
  const reviewerId = savedReviewer?._id ?? null;
  const importLabels = definedFields({
    pdTitle: item.pdTitle,
    versionCode: item.versionCode,
    versionNumber: item.versionNumber,
    scienceCode: item.scienceCode,
    fiscalYearEnd: item.fiscalYearEnd,
    writerInitials: item.writerInitials,
    reviewerInitials: item.reviewerInitials,
    craReviewed: item.category === "final_pd" && item.craReviewed === true ? true : undefined,
  });
  const added = await addImportedCompanyFile(ctx, {
    clientId: client._id,
    importItemId: item._id,
    fileName: item.name,
    category,
    ...(item.storageId ? { storageId: item.storageId } : {}),
    text: companyText,
    ...(item.fiscalYear !== undefined ? { fiscalYear: item.fiscalYear } : {}),
    ...(item.pdNumber ? { pdNumber: item.pdNumber } : {}),
    ...(item.writerId ? { writerId: item.writerId } : {}),
    ...(reviewerId ? { reviewerId } : {}),
    ...(Object.keys(importLabels).length > 0 ? { importLabels } : {}),
    addedBy: actor,
  });
  const now = Date.now();
  const { after } = await patchItem(ctx, item, {
    status: "approved",
    companyFileId: added.companyFileId,
    reviewedBy: actor._id,
    reviewedAt: now,
    updatedAt: now,
    // A row read before textCut existed stores the answer now.
    ...(item.textCut === undefined && item.textStorageId !== undefined ? { textCut: importTextCut(item) } : {}),
    ...(item.category === "final_pd" && !item.brainSourceId ? { brainCheck: "waiting" as const } : {}),
  });
  await recomputeGroups(ctx, [after.pairGroupKey, item.pairGroupKey], ONE_ROW);
  return { state: "approved", companyFileId: added.companyFileId, readOnServer: added.readOnServer };
}

/** The approval's starter, while still a signed-in Admin; null otherwise. */
async function approvalActor(ctx: MutationCtx, run: Doc<"importApprovals">): Promise<Doc<"users"> | null> {
  const user = await ctx.db.get(run.startedBy);
  return user && user.role === "admin" && user.isAnonymous !== true ? user : null;
}

async function startApprovalChain(ctx: MutationCtx, approvalId: Id<"importApprovals">) {
  await ctx.scheduler.runAfter(0, internal.ingestion.runApproval, { approvalId });
}

/**
 * "Approve N ready" on a company band (2026-11-17): approves the band's
 * ready files on To review (read, nothing to check) in a scheduled chain,
 * one mutation per file, with a counter the page shows. A company whose
 * approval is still moving gets that one back, not a second.
 */
export const approveCompanyReady = mutation({
  args: { companyKey: v.string() },
  returns: v.object({
    approvalId: v.id("importApprovals"),
    ready: v.number(),
    // Set when this company's approval was already running, started by another Admin.
    alreadyRunningBy: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const adminId = await assertAdmin(ctx);
    if (args.companyKey === NO_COMPANY_KEY) {
      domainError("INVALID_INPUT", "Files with no company cannot be approved. Pick their company first.");
    }
    const band = await importCompanyRow(ctx, "review", args.companyKey);
    if (!band || band.ready <= 0) domainError("INVALID_STATE", "This company has no files ready to approve.");
    const now = Date.now();
    const running = await ctx.db
      .query("importApprovals")
      .withIndex("by_scope_and_companyKey_and_status", (q) =>
        q.eq("scope", "company").eq("companyKey", args.companyKey).eq("status", "running")
      )
      .take(5);
    for (const run of running) {
      if (now - run.updatedAt < APPROVAL_STALE_MS) {
        const by = run.startedBy === adminId ? null : await ctx.db.get(run.startedBy);
        return { approvalId: run._id, ready: band.ready, ...(by ? { alreadyRunningBy: userDisplayLabel(by) } : {}) };
      }
      await ctx.db.patch(run._id, { status: "stopped", updatedAt: now });
    }
    const approvalId = await ctx.db.insert("importApprovals", {
      startedBy: adminId,
      startedAt: now,
      updatedAt: now,
      scope: "company",
      companyKey: args.companyKey,
      companyName: band.displayName,
      listed: 0,
      status: "running",
      total: band.ready,
      done: 0,
      approved: 0,
      refused: 0,
    });
    await startApprovalChain(ctx, approvalId);
    return { approvalId, ready: band.ready };
  },
});

/**
 * Approve on selected files (2026-11-17): up to 100 files a call. The first
 * call starts an approval; a later call with its `approvalId` adds more of
 * the same selection to it (the page sends a large selection in parts), so
 * one counter covers them all. A file already in it is not added twice.
 */
export const approveFiles = mutation({
  args: { ids: v.array(v.id("ingestionItems")), approvalId: v.optional(v.id("importApprovals")) },
  returns: v.object({ approvalId: v.id("importApprovals"), added: v.number() }),
  handler: async (ctx, args) => {
    const adminId = await assertAdmin(ctx);
    const ids = batchIds(args.ids, `Approve up to ${SHEET_BATCH_MAX_FILES} files at a time.`);
    const now = Date.now();
    let run = args.approvalId ? await ctx.db.get(args.approvalId) : null;
    if (args.approvalId && (!run || run.startedBy !== adminId || run.scope !== "files")) {
      domainError("INVALID_INPUT", "That approval is not yours to add files to.");
    }
    if (!run) {
      const approvalId = await ctx.db.insert("importApprovals", {
        startedBy: adminId,
        startedAt: now,
        updatedAt: now,
        scope: "files",
        listed: 0,
        status: "running",
        total: 0,
        done: 0,
        approved: 0,
        refused: 0,
      });
      run = (await ctx.db.get(approvalId))!;
      await startApprovalChain(ctx, approvalId);
    } else if (run.status !== "running" || now - run.updatedAt >= APPROVAL_STALE_MS) {
      // Finished or stopped: it runs again for the files added now.
      await startApprovalChain(ctx, run._id);
    }
    let listed = run.listed ?? run.total;
    let added = 0;
    // One company's name; "" once the files are of several companies.
    let companyName: string | null | undefined = run.companyName === "" ? null : run.companyName;
    for (const id of ids) {
      const there = await ctx.db
        .query("importApprovalFiles")
        .withIndex("by_approvalId_and_itemId", (q) => q.eq("approvalId", run!._id).eq("itemId", id))
        .first();
      if (there) continue;
      const item = await ctx.db.get(id);
      await ctx.db.insert("importApprovalFiles", {
        approvalId: run._id,
        itemId: id,
        position: listed,
        state: "waiting",
        name: item?.name ?? "A file no longer in Import",
      });
      // One company's name, or none when the files are of several.
      const name = item?.clientName?.trim() || null;
      companyName = companyName === undefined ? name : companyName === name ? companyName : null;
      listed += 1;
      added += 1;
    }
    await ctx.db.patch(run._id, {
      listed,
      total: run.total + added,
      status: "running",
      updatedAt: now,
      companyName: companyName === null ? "" : companyName,
      dismissedAt: undefined,
    });
    return { approvalId: run._id, added };
  },
});

const approvalNextValidator = v.union(
  v.object({ kind: v.literal("stop") }),
  v.object({ kind: v.literal("listed") }),
  v.object({
    kind: v.literal("file"),
    fileRowId: v.id("importApprovalFiles"),
    itemId: v.id("ingestionItems"),
    textStorageId: v.optional(v.id("_storage")),
  })
);

/**
 * The approval's next step (internal): stops when the approval is not
 * running or its starter is no longer an Admin; for a company, lists a page
 * of its ready files first; then hands back the next waiting file (with
 * where its whole text is, when Import has it), or finishes the approval.
 */
export const approvalNext = internalMutation({
  args: { approvalId: v.id("importApprovals") },
  returns: approvalNextValidator,
  handler: async (ctx, args): Promise<Infer<typeof approvalNextValidator>> => {
    const run = await ctx.db.get(args.approvalId);
    if (!run || run.status !== "running") return { kind: "stop" };
    const now = Date.now();
    if (!(await approvalActor(ctx, run))) {
      await ctx.db.patch(run._id, { status: "stopped", updatedAt: now });
      return { kind: "stop" };
    }
    if (run.scope === "company" && run.paged !== true && run.companyKey) {
      const companyKey = run.companyKey;
      const page = await ctx.db
        .query("ingestionItems")
        .withIndex("by_sheetTab_and_companyKey", (q) => q.eq("sheetTab", "review").eq("companyKey", companyKey))
        .paginate({ cursor: run.cursor ?? null, numItems: APPROVAL_LIST_PAGE });
      let listed = run.listed ?? 0;
      for (const item of page.page) {
        if (item.status !== "pending_review" || approveRefusalFor(item) !== null) continue;
        const there = await ctx.db
          .query("importApprovalFiles")
          .withIndex("by_approvalId_and_itemId", (q) => q.eq("approvalId", run._id).eq("itemId", item._id))
          .first();
        if (there) continue;
        await ctx.db.insert("importApprovalFiles", {
          approvalId: run._id,
          itemId: item._id,
          position: listed,
          state: "waiting",
          name: item.name,
        });
        listed += 1;
      }
      await ctx.db.patch(run._id, {
        cursor: page.continueCursor,
        paged: page.isDone,
        listed,
        // The band's ready count until every page is read, then exactly the files listed.
        total: page.isDone ? listed : Math.max(run.total, listed),
        updatedAt: now,
      });
      return { kind: "listed" };
    }
    const next = await ctx.db
      .query("importApprovalFiles")
      .withIndex("by_approvalId_and_state_and_position", (q) => q.eq("approvalId", run._id).eq("state", "waiting"))
      .first();
    if (!next) {
      await ctx.db.patch(run._id, { status: "done", total: run.done, updatedAt: now });
      return { kind: "stop" };
    }
    const item = await ctx.db.get(next.itemId);
    return {
      kind: "file",
      fileRowId: next._id,
      itemId: next.itemId,
      ...(item && importHasWholeText(item) ? { textStorageId: item.textStorageId } : {}),
    };
  },
});

/** What one approved file came to, for the approval's counters and the batch result. */
async function recordApprovalFile(
  ctx: MutationCtx,
  fileRow: Doc<"importApprovalFiles">,
  outcome: ApproveOutcome
): Promise<void> {
  const run = await ctx.db.get(fileRow.approvalId);
  await ctx.db.patch(fileRow._id, {
    state: outcome.state,
    ...(outcome.state === "refused" ? { reason: outcome.reason, ...(outcome.detail ? { detail: outcome.detail } : {}) } : {}),
  });
  if (!run) return;
  await ctx.db.patch(run._id, {
    done: run.done + 1,
    approved: run.approved + (outcome.state === "refused" ? 0 : 1),
    refused: run.refused + (outcome.state === "refused" ? 1 : 0),
    updatedAt: Date.now(),
  });
}

/**
 * Approves one file of an approval (internal; the chain's one mutation per
 * file). `text` is the Import file's whole text, read from storage by the
 * chain's action. A file row already settled is left as it is (a retried
 * step), so nothing is made or counted twice.
 */
export const approveImportFile = internalMutation({
  args: {
    fileRowId: v.id("importApprovalFiles"),
    // The Import file's whole text as the action read it, and from which stored file.
    text: v.optional(v.string()),
    textStorageId: v.optional(v.id("_storage")),
  },
  returns: v.object({ state: v.string(), reason: v.optional(approveRefusalValidator) }),
  handler: async (ctx, args) => {
    const fileRow = await ctx.db.get(args.fileRowId);
    if (!fileRow || fileRow.state !== "waiting") return { state: fileRow?.state ?? "missing" };
    const run = await ctx.db.get(fileRow.approvalId);
    const actor = run ? await approvalActor(ctx, run) : null;
    if (!run || !actor || run.status !== "running") return { state: "stopped" };
    const read = args.text !== undefined && args.textStorageId ? { text: args.text, textStorageId: args.textStorageId } : undefined;
    const outcome = await approveOneFile(ctx, fileRow.itemId, read, actor, run.scope === "company" ? { companyKey: run.companyKey } : {});
    await recordApprovalFile(ctx, fileRow, outcome);
    return { state: outcome.state, ...(outcome.state === "refused" ? { reason: outcome.reason } : {}) };
  },
});

/**
 * A file whose approval threw (a text too long to keep, say): left on To
 * review, and named. `text_not_read`: its text could not be read from
 * storage, so it was not tried; approving it again tries again.
 */
export const recordApprovalFailure = internalMutation({
  args: { fileRowId: v.id("importApprovalFiles"), reason: v.optional(v.literal("text_not_read")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const fileRow = await ctx.db.get(args.fileRowId);
    if (!fileRow || fileRow.state !== "waiting") return null;
    await recordApprovalFile(
      ctx,
      fileRow,
      args.reason === "text_not_read"
        ? { state: "refused", reason: "text_not_read", detail: "Try again." }
        : { state: "refused", reason: "not_saved" }
    );
    return null;
  },
});

/**
 * One step of an approval's chain (internal): up to ten files, each read
 * here (an action, since an Import file's whole text is in storage) and
 * approved in its own mutation, then the next step is scheduled. A file
 * that fails is left on To review and named; the chain goes on.
 */
export const runApproval = internalAction({
  args: { approvalId: v.id("importApprovals") },
  returns: v.null(),
  handler: async (ctx, args) => {
    let files = 0;
    // Listing steps do not count as files, but are bounded too.
    for (let step = 0; step < APPROVAL_STEP_FILES * 3 && files < APPROVAL_STEP_FILES; step++) {
      const next: Infer<typeof approvalNextValidator> = await ctx.runMutation(internal.ingestion.approvalNext, {
        approvalId: args.approvalId,
      });
      if (next.kind === "stop") return null;
      if (next.kind === "listed") continue;
      files += 1;
      let text: string | undefined;
      // A failed read of one file's text refuses that file in plain words;
      // the chain goes on with the next.
      try {
        if (next.textStorageId) {
          const blob = await ctx.storage.get(next.textStorageId);
          text = blob ? await blob.text() : undefined;
        }
      } catch (error) {
        console.error("runApproval: a file's text could not be read", { itemId: next.itemId, error: String(error) });
        await ctx.runMutation(internal.ingestion.recordApprovalFailure, { fileRowId: next.fileRowId, reason: "text_not_read" });
        continue;
      }
      try {
        await ctx.runMutation(internal.ingestion.approveImportFile, {
          fileRowId: next.fileRowId,
          ...(text !== undefined && next.textStorageId ? { text, textStorageId: next.textStorageId } : {}),
        });
      } catch (error) {
        console.error("runApproval: a file could not be approved", { itemId: next.itemId, error: String(error) });
        await ctx.runMutation(internal.ingestion.recordApprovalFailure, { fileRowId: next.fileRowId });
      }
    }
    await ctx.scheduler.runAfter(0, internal.ingestion.runApproval, args);
    return null;
  },
});

const approvalProgressValidator = v.object({
  approvalId: v.id("importApprovals"),
  scope: v.union(v.literal("company"), v.literal("files")),
  companyName: v.optional(v.string()),
  status: v.union(v.literal("running"), v.literal("done"), v.literal("stopped")),
  // When its chain last moved (2026-11-17): the page says a running
  // approval stopped once this is APPROVAL_STALE_MS old, on its own timer,
  // since this query does not run again as time passes.
  lastProgressAt: v.number(),
  total: v.number(),
  done: v.number(),
  approved: v.number(),
  refused: v.number(),
  startedAt: v.number(),
  // Started by the signed-in Admin (only they close its line), else by whom.
  mine: v.boolean(),
  startedByName: v.optional(v.string()),
});

/** Approvals running at once that the line shows (every Admin's). */
const APPROVALS_SHOWN = 5;

/**
 * The approvals the line under the toolbar shows, newest first: every
 * approval still running, whoever started it (so two Admins see the same
 * company's approval), and the signed-in Admin's latest one until they
 * close its line. Empty for anyone but an Admin.
 */
export const approvalProgress = query({
  args: {},
  returns: v.array(approvalProgressValidator),
  handler: async (ctx) => {
    const adminId = await adminOrNull(ctx);
    if (adminId === null) return [];
    const running = await ctx.db
      .query("importApprovals")
      .withIndex("by_status_and_startedAt", (q) => q.eq("status", "running"))
      .order("desc")
      .take(APPROVALS_SHOWN);
    const latest = await ctx.db
      .query("importApprovals")
      .withIndex("by_startedBy_and_startedAt", (q) => q.eq("startedBy", adminId as Id<"users">))
      .order("desc")
      .first();
    const runs = [...running];
    if (latest && latest.dismissedAt === undefined && !runs.some((run) => run._id === latest._id)) runs.push(latest);
    runs.sort((a, b) => b.startedAt - a.startedAt);
    const names = new Map<Id<"users">, string>();
    const out = [];
    for (const run of runs) {
      const mine = run.startedBy === adminId;
      if (!mine && !names.has(run.startedBy)) {
        const user = await ctx.db.get(run.startedBy);
        names.set(run.startedBy, user ? userDisplayLabel(user) : "another Admin");
      }
      out.push(
        definedFields({
          approvalId: run._id,
          scope: run.scope,
          companyName: run.companyName || undefined,
          status: run.status,
          lastProgressAt: run.updatedAt,
          total: Math.max(run.total, run.done),
          done: run.done,
          approved: run.approved,
          refused: run.refused,
          startedAt: run.startedAt,
          mine,
          startedByName: mine ? undefined : names.get(run.startedBy),
        })
      );
    }
    return out;
  },
});

/** The files an approval left on To review, with why (up to 100), for "Show why". */
export const approvalRefusals = query({
  args: { approvalId: v.id("importApprovals") },
  returns: v.object({
    files: v.array(
      v.object({
        itemId: v.id("ingestionItems"),
        name: v.string(),
        reason: approveRefusalValidator,
        detail: v.optional(v.string()),
      })
    ),
    more: v.boolean(),
  }),
  handler: async (ctx, args) => {
    if ((await adminOrNull(ctx)) === null) return { files: [], more: false };
    const rows = await ctx.db
      .query("importApprovalFiles")
      .withIndex("by_approvalId_and_state_and_position", (q) => q.eq("approvalId", args.approvalId).eq("state", "refused"))
      .take(APPROVAL_REFUSALS_LISTED + 1);
    return {
      files: rows.slice(0, APPROVAL_REFUSALS_LISTED).map((row) =>
        definedFields({ itemId: row.itemId, name: row.name, reason: row.reason ?? "not_saved", detail: row.detail })
      ),
      more: rows.length > APPROVAL_REFUSALS_LISTED,
    };
  },
});

/** Closes an approval's line on the page; a running approval goes on. */
export const dismissApproval = mutation({
  args: { approvalId: v.id("importApprovals") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const adminId = await assertAdmin(ctx);
    const run = await ctx.db.get(args.approvalId);
    if (!run || run.startedBy !== adminId) return null;
    await ctx.db.patch(run._id, { dismissedAt: Date.now() });
    return null;
  },
});

// ─── Brain check (2026-11-17) ───────────────────────────────────────────────
// A person reads each approved final PD's scrubbed Brain copy before one is
// made (the 2026-11-17 Brain copy amendment's condition): the copy, its
// warnings, what the check does not cover, and an "Also remove" box. Then
// "Add to the Brain" (importSource with the import file's links, approved,
// its embedding queued, the file's brainSourceId set) or "Keep out of the
// Brain", which is remembered. The company file is not touched either way.

/** Words a person may add to Also remove, and how long each may be. */
const ALSO_REMOVE_MAX_WORDS = 30;
const ALSO_REMOVE_MAX_CHARS = 80;
const BRAIN_CHECK_PAGE_MAX = 25;

/** The Also remove words, trimmed, each once, bounded. */
function cleanAlsoRemove(words: readonly string[]): string[] {
  const cleaned = [...new Set(words.map((word) => word.replace(/\s+/g, " ").trim()).filter(Boolean))];
  if (cleaned.length > ALSO_REMOVE_MAX_WORDS) {
    domainError("INVALID_INPUT", `Add up to ${ALSO_REMOVE_MAX_WORDS} words to Also remove.`);
  }
  if (cleaned.some((word) => word.length > ALSO_REMOVE_MAX_CHARS)) {
    domainError("INVALID_INPUT", `Each Also remove entry can be at most ${ALSO_REMOVE_MAX_CHARS} characters.`);
  }
  return cleaned;
}

export const BRAIN_CHECK_GONE = "This PD is no longer waiting for a Brain check.";
export const BRAIN_COPY_CHANGED = "The Brain copy changed since you read it. Read it again, then add it.";
export const BRAIN_COPY_DIFFERS =
  "This PD is already in the Brain as a different copy. Remove that copy on the Brain page first, or keep this one out.";

/**
 * The fingerprint of a Brain copy as the person read it: its text and what
 * the Brain stores with it (title, industry, writer and tier), so a change
 * to any of them between reading and adding is refused until read again.
 */
export function brainCopySeen(fields: { content: string; title: string; industry: string; writerName?: string; writerTier: number }): string {
  return brainContentHash(JSON.stringify([fields.content, fields.title, fields.industry, fields.writerName ?? "", fields.writerTier]));
}

const brainCheckRowValidator = v.object({
  _id: v.id("ingestionItems"),
  name: v.string(),
  companyKey: v.string(),
  companyName: v.string(),
  fiscalYear: v.optional(v.number()),
  pdNumber: v.optional(v.string()),
  pdTitle: v.optional(v.string()),
  versionCode: v.optional(pdVersionCodeValidator),
  versionNumber: v.optional(v.number()),
  writerName: v.optional(v.string()),
  scienceCode: v.optional(v.string()),
});

/** The approved final PDs waiting for a Brain check, company by company, then by year. */
export const brainCheckFiles = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(brainCheckRowValidator),
  handler: async (ctx, args) => {
    if ((await adminOrNull(ctx)) === null) return EMPTY_PAGE;
    const result = await ctx.db
      .query("ingestionItems")
      .withIndex("by_brainCheck_and_companyKey_and_fiscalYear", (q) => q.eq("brainCheck", "waiting"))
      .paginate(boundedPage(args.paginationOpts, BRAIN_CHECK_PAGE_MAX));
    const labelled = await withWriterLabels(ctx, result.page.map(sheetRow));
    return {
      ...result,
      page: result.page.map((item, index) =>
        definedFields({
          _id: item._id,
          name: item.name,
          companyKey: item.companyKey ?? NO_COMPANY_KEY,
          companyName: item.clientName?.trim() || item.companyKey || "",
          fiscalYear: item.fiscalYear,
          pdNumber: item.pdNumber,
          pdTitle: item.pdTitle,
          versionCode: item.versionCode,
          versionNumber: item.versionNumber,
          writerName: labelled[index]?.writerName,
          scienceCode: item.scienceCode,
        })
      ),
    };
  },
});

const brainCheckTargetValidator = v.object({ textStorageId: v.optional(v.id("_storage")), preview: v.optional(v.string()) });
type BrainCheckTarget = Infer<typeof brainCheckTargetValidator>;

/** A final PD waiting for its Brain check, for the check's actions (with the caller's identity). */
export const brainCheckTarget = internalQuery({
  args: { itemId: v.id("ingestionItems") },
  returns: brainCheckTargetValidator,
  handler: async (ctx, args) => {
    await assertAdmin(ctx);
    const item = await ctx.db.get(args.itemId);
    if (!item || item.status !== "approved" || item.brainCheck !== "waiting") {
      domainError("INVALID_STATE", BRAIN_CHECK_GONE);
    }
    return definedFields({ textStorageId: item.textStorageId, preview: item.text });
  },
});

/** The Import file's text for its Brain copy: its whole text in storage, else its preview. */
async function brainCheckText(
  ctx: ActionCtx,
  target: { textStorageId?: Id<"_storage">; preview?: string }
): Promise<string> {
  if (target.textStorageId) {
    const blob = await ctx.storage.get(target.textStorageId);
    if (blob) return await blob.text();
  }
  return target.preview ?? "";
}

const brainPreviewValidator = v.union(
  v.object({
    ok: v.literal(true),
    content: v.string(),
    title: v.string(),
    industry: v.string(),
    writerName: v.optional(v.string()),
    warnings: v.array(v.string()),
    notCovered: v.string(),
    // The copy's fingerprint: "Add to the Brain" adds only the copy the person read.
    seen: v.string(),
  }),
  v.object({ ok: v.literal(false), code: v.string(), reason: v.string(), notCovered: v.string() })
);

/**
 * The scrubbed Brain copy a final PD would get, or the plain reason it
 * cannot have one, with the words a person added to Also remove. Nothing
 * is written.
 */
export const previewBrainCopy = action({
  args: { itemId: v.id("ingestionItems"), alsoRemove: v.array(v.string()) },
  returns: brainPreviewValidator,
  handler: async (ctx, args): Promise<Infer<typeof brainPreviewValidator>> => {
    const alsoRemove = cleanAlsoRemove(args.alsoRemove);
    const target: BrainCheckTarget = await ctx.runQuery(internal.ingestion.brainCheckTarget, { itemId: args.itemId });
    const text = await brainCheckText(ctx, target);
    const copy: Infer<typeof importBrainCopyResultValidator> = await ctx.runQuery(internal.ingestion.importBrainCopyPreview, {
      itemId: args.itemId,
      text,
      alsoRemove,
    });
    if (!copy.ok) return { ok: false, code: copy.code, reason: copy.reason, notCovered: copy.notCovered };
    return definedFields({
      ok: true as const,
      content: copy.fields.content,
      title: copy.fields.title,
      industry: copy.fields.industry,
      writerName: copy.fields.writerName,
      warnings: copy.warnings,
      notCovered: copy.notCovered,
      seen: brainCopySeen(copy.fields),
    });
  },
});

const brainAddResultValidator = v.union(
  v.object({ ok: v.literal(true), outcome: v.union(v.literal("added"), v.literal("matched")), sourceId: v.id("brainSources") }),
  // `changed` (2026-11-17): the copy is no longer the one the person read,
  // so the page offers Check again to read it as it is now.
  v.object({ ok: v.literal(false), reason: v.string(), changed: v.optional(v.literal(true)) })
);

/**
 * Adds a final PD's scrubbed copy to the Brain (internal; the action reads
 * its text). The copy is made again here, in the same transaction as the
 * write, and must be the one the person read (`seen`). A leak refusal is
 * logged with its log reason only, never the word. Dedup is importSource's:
 * a pending match is approved and reused, an approved one reused, a revoked
 * one refused in plain words (the PD stays in Brain check).
 */
export const finishBrainCheck = internalMutation({
  args: { itemId: v.id("ingestionItems"), text: v.string(), alsoRemove: v.array(v.string()), seen: v.string() },
  returns: brainAddResultValidator,
  handler: async (ctx, args): Promise<Infer<typeof brainAddResultValidator>> => {
    const adminId = await assertAdmin(ctx);
    const item = await ctx.db.get(args.itemId);
    if (!item || item.status !== "approved" || item.brainCheck !== "waiting") return { ok: false, reason: BRAIN_CHECK_GONE };
    const copy = await importBrainCopyFor(ctx, item, args.text, cleanAlsoRemove(args.alsoRemove));
    if (!copy.ok) {
      if (copy.code === "names_left") {
        await ctx.db.insert("brainAuditLog", { action: "reject", actorId: adminId, reason: copy.logReason, at: Date.now() });
      }
      return { ok: false, reason: copy.reason };
    }
    if (brainCopySeen(copy.fields) !== args.seen) return { ok: false, reason: BRAIN_COPY_CHANGED, changed: true };
    const { importItemId, importContentHash, ...fields } = copy.fields;
    // A Brain source this file already matches (by its bytes, then by text)
    // is reused only when it holds exactly this scrubbed copy: one approved
    // on the old page unscrubbed, or a copy made with other Also remove
    // words, is never linked as this one.
    // A source revoked by Send back to review (2026-11-17) is passed over:
    // it undid an approval, so this copy, read by a person just now, is new.
    const match = await findImportMatch(ctx, brainContentHash(fields.content), importContentHash, { skipSentBack: true });
    if (match && match.status !== "revoked" && match.sourceHash !== brainContentHash(fields.content)) {
      return { ok: false, reason: BRAIN_COPY_DIFFERS };
    }
    const result = await importSource(
      ctx,
      {
        ...fields,
        approve: true,
        importItem: { itemId: importItemId, contentHash: importContentHash },
        supersedeSentBack: true,
      },
      adminId
    );
    if (result.outcome === "revoked") return { ok: false, reason: result.message };
    await patchItem(ctx, item, {
      brainSourceId: result.sourceId,
      brainCheck: "added",
      brainCheckedBy: adminId,
      brainCheckedAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { ok: true, outcome: result.outcome, sourceId: result.sourceId };
  },
});

/** "Add to the Brain" in the Brain check: the copy the person read (`seen`), with their Also remove words. */
export const addToBrain = action({
  args: { itemId: v.id("ingestionItems"), alsoRemove: v.array(v.string()), seen: v.string() },
  returns: brainAddResultValidator,
  handler: async (ctx, args): Promise<Infer<typeof brainAddResultValidator>> => {
    const target: BrainCheckTarget = await ctx.runQuery(internal.ingestion.brainCheckTarget, { itemId: args.itemId });
    const text = await brainCheckText(ctx, target);
    return await ctx.runMutation(internal.ingestion.finishBrainCheck, {
      itemId: args.itemId,
      text,
      alsoRemove: args.alsoRemove,
      seen: args.seen,
    });
  },
});

/** "Keep out of the Brain": remembered on the file; its company file stays. */
export const keepOutOfBrain = mutation({
  args: { itemId: v.id("ingestionItems") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const adminId = await assertAdmin(ctx);
    const item = await ctx.db.get(args.itemId);
    if (!item || item.status !== "approved" || item.brainCheck !== "waiting") domainError("INVALID_STATE", BRAIN_CHECK_GONE);
    await patchItem(ctx, item, {
      brainCheck: "kept_out",
      brainCheckedBy: adminId,
      brainCheckedAt: Date.now(),
      updatedAt: Date.now(),
    });
    return null;
  },
});

// ─── Send back to review, and edit after approval (2026-11-17) ──────────────
// Owner decisions of 2026-11-17 (docs/product-domain.md, the fifth entry of
// that day). Send back to review, Admin only, undoes an approval (a file
// approved to the wrong company, say): the company file the approval made is
// removed by the company file delete path (its original is the Import
// file's own and stays; drafts keep the text versions they read), the
// file's Brain copy is revoked as an audited unlearn unless another approved
// Import file still links it (then only this file lets go of it), and the
// file goes back to To review with its labels. A company the approval made
// stays. Edit after approval, Admin only, changes an approved file's
// metadata (writer, reviewer, science code, PD title, "Reviewed by CRA"),
// never the file itself, and never its company, category or fiscal year:
// the company file and the Brain copy follow. Every Send back and every
// edit is a row in importFileEvents.

/** Files one Send back call takes (each removes a company file and may revoke a Brain copy). */
export const SEND_BACK_MAX_FILES = 50;

/** The Brain audit log's reason for a revoke made by Send back. */
export const SEND_BACK_BRAIN_REASON = "Sent back to review on Import";

/**
 * Rows one check reads to find another approved Import file that still
 * links a Brain source: its link rows, and the files with each linked
 * file's bytes (copies of one PD: a handful at most).
 */
const SHARED_SOURCE_READ = 20;

// missing: no longer in Import; not_approved: not on Approved (already sent
// back, say); approval_running: an approval of its company is still moving,
// and would take the file straight back once it is ready on To review.
const sendBackRefusalValidator = v.union(v.literal("missing"), v.literal("not_approved"), v.literal("approval_running"));

/** Whether an approval of this company is still moving (not stalled), so a file sent back now would be approved again. */
async function companyApprovalMoving(ctx: MutationCtx, companyKey: string | undefined): Promise<boolean> {
  if (!companyKey) return false;
  const running = await ctx.db
    .query("importApprovals")
    .withIndex("by_scope_and_companyKey_and_status", (q) => q.eq("scope", "company").eq("companyKey", companyKey).eq("status", "running"))
    .take(5);
  return running.some((run) => Date.now() - run.updatedAt < APPROVAL_STALE_MS);
}

const sendBackResultValidator = v.object({
  sentBack: v.array(v.id("ingestionItems")),
  refused: v.array(v.object({ id: v.id("ingestionItems"), reason: sendBackRefusalValidator })),
  // Sent back with no company file to remove (removed by hand since, or
  // approved on the old page, which made none).
  companyFileGone: v.array(v.id("ingestionItems")),
  // Sent back with its Brain copy left in the Brain, because another
  // approved Import file still links it.
  brainKept: v.array(v.id("ingestionItems")),
  // Sent back with its Brain copy revoked.
  brainRevoked: v.array(v.id("ingestionItems")),
});
type SendBackResult = Infer<typeof sendBackResultValidator>;

/**
 * Another approved Import file (not `itemId`) that links this Brain source,
 * or null. Read through the Brain's own link rows (brainSourceImportFiles,
 * convex/ai/brain/rag.ts): each names a file's bytes and the file that
 * first linked them; a later file with the same bytes is linked by those
 * same bytes (linkBrainSourceImportFile adds no second row), so the files
 * with each linked hash are read too. A file counts when it is approved
 * and its own brainSourceId is still this source.
 */
async function otherApprovedLink(
  ctx: MutationCtx,
  sourceId: Id<"brainSources">,
  itemId: Id<"ingestionItems">
): Promise<Doc<"ingestionItems"> | null> {
  const shares = (row: Doc<"ingestionItems"> | null): row is Doc<"ingestionItems"> =>
    row !== null && row._id !== itemId && row.status === "approved" && row.brainSourceId === sourceId;
  const links = await ctx.db
    .query("brainSourceImportFiles")
    .withIndex("by_sourceId", (q) => q.eq("sourceId", sourceId))
    .take(SHARED_SOURCE_READ);
  for (const link of links) {
    const first = await ctx.db.get(link.importItemId);
    if (shares(first)) return first;
    const copies = await ctx.db
      .query("ingestionItems")
      .withIndex("by_contentHash", (q) => q.eq("contentHash", link.contentHash))
      .take(SHARED_SOURCE_READ);
    const copy = copies.find(shares);
    if (copy) return copy;
  }
  return null;
}

/**
 * Sends one approved Import file back to To review in the caller's mutation
 * (the steps above). The company file is the one the approval recorded, or
 * one made from this file (by_importItemId) when the link is missing.
 */
async function sendBackOne(
  ctx: MutationCtx,
  item: Doc<"ingestionItems">,
  adminId: Id<"users">
): Promise<{ companyFile: "removed" | "gone"; brain: "revoked" | "shared" | "already_removed" | "none"; groups: string[] }> {
  const companyFileId =
    item.companyFileId ??
    (await ctx.db
      .query("companyFiles")
      .withIndex("by_importItemId", (q) => q.eq("importItemId", item._id))
      .first())?._id;
  const companyFile =
    companyFileId && (await removeImportedCompanyFile(ctx, companyFileId, item._id, adminId)) ? "removed" : "gone";

  let brain: "revoked" | "shared" | "already_removed" | "none" = "none";
  const source = item.brainSourceId ? await ctx.db.get(item.brainSourceId) : null;
  if (source) {
    const other = await otherApprovedLink(ctx, source._id, item._id);
    if (other) {
      // Only this file lets go: the copy stays for the other file, which
      // retrieval now reads its company from.
      brain = "shared";
      if (source.importItemId === item._id) await patchBrainSource(ctx, source, { importItemId: other._id });
    } else if (source.status !== "revoked") {
      await revokeBrainSourceRow(ctx, source, adminId, SEND_BACK_BRAIN_REASON, { sentBackItemId: item._id });
      brain = "revoked";
    } else {
      // Removed on the Brain page already: nothing more to unlearn.
      brain = "already_removed";
    }
  }

  const now = Date.now();
  const { after } = await patchItem(ctx, item, {
    status: "pending_review",
    companyFileId: undefined,
    brainSourceId: undefined,
    brainCheck: undefined,
    brainCheckedBy: undefined,
    brainCheckedAt: undefined,
    reviewedBy: undefined,
    reviewedAt: undefined,
    sentBackBy: adminId,
    sentBackAt: now,
    updatedAt: now,
  });
  await ctx.db.insert("importFileEvents", {
    itemId: item._id,
    action: "send_back",
    userId: adminId,
    at: now,
    ...(companyFileId ? { companyFileId } : {}),
    companyFile,
    ...(source ? { brainSourceId: source._id } : {}),
    brain: brain === "shared" || brain === "already_removed" ? "unlinked" : brain,
  });
  return { companyFile, brain, groups: [after.pairGroupKey, item.pairGroupKey] };
}

/**
 * Send back to review (Admins only): up to 50 approved Import files, each
 * back on To review with its labels, its company file removed and its Brain
 * copy revoked (or only unlinked when another approved file still links
 * it). A file no longer in Import or not approved is refused by name and
 * left as it is; the rest go. Counts, pairing and writers' file counts move
 * through patchItem; pairing for the groups is scheduled.
 */
export const sendBackToReview = mutation({
  args: { ids: v.array(v.id("ingestionItems")) },
  returns: sendBackResultValidator,
  handler: async (ctx, args): Promise<SendBackResult> => {
    const adminId = await assertAdmin(ctx);
    if (args.ids.length === 0) domainError("INVALID_INPUT", "Select at least one file.");
    if (args.ids.length > SEND_BACK_MAX_FILES) {
      domainError("INVALID_INPUT", `Send back up to ${SEND_BACK_MAX_FILES} files at a time.`);
    }
    const result: SendBackResult = { sentBack: [], refused: [], companyFileGone: [], brainKept: [], brainRevoked: [] };
    const groups = new Set<string>();
    for (const id of new Set(args.ids)) {
      const item = await ctx.db.get(id);
      if (!item) {
        result.refused.push({ id, reason: "missing" });
        continue;
      }
      if (item.status !== "approved") {
        result.refused.push({ id, reason: "not_approved" });
        continue;
      }
      if (await companyApprovalMoving(ctx, item.companyKey)) {
        result.refused.push({ id, reason: "approval_running" });
        continue;
      }
      const done = await sendBackOne(ctx, item, adminId);
      result.sentBack.push(id);
      if (done.companyFile === "gone") result.companyFileGone.push(id);
      if (done.brain === "shared") result.brainKept.push(id);
      if (done.brain === "revoked") result.brainRevoked.push(id);
      for (const key of done.groups) groups.add(key);
    }
    await recomputeGroups(ctx, groups, MANY_ROWS);
    return result;
  },
});

const approvedEditFieldValidator = v.union(
  v.literal("writer"),
  v.literal("reviewer"),
  v.literal("scienceCode"),
  v.literal("pdTitle"),
  v.literal("craReviewed")
);
type ApprovedEditField = Infer<typeof approvedEditFieldValidator>;

/** The longest PD title an Admin may give a file. */
export const MAX_PD_TITLE = 200;

/** Why an edit after approval cannot go on this file, in plain words. */
const APPROVED_EDIT_REFUSALS: Record<ApprovedEditField, string> = {
  writer: "A writer only goes on a final PD, draft or review copy.",
  reviewer: "A reviewer only goes on a final PD, draft or review copy.",
  pdTitle: "A PD title only goes on a final PD, draft or review copy.",
  scienceCode: "A science code only goes on a final PD.",
  craReviewed: "Only a final PD can be marked as reviewed by CRA.",
};

export const NOT_APPROVED_ANY_MORE = "This file is no longer approved. Change it on To review.";

const approvedEditPatchValidator = v.object({
  writer: v.optional(writerChoiceValidator),
  // null: no reviewer.
  reviewer: v.optional(v.union(writerChoiceValidator, v.null())),
  scienceCode: v.optional(v.string()),
  // "" clears the title (the sheet then shows the file name).
  pdTitle: v.optional(v.string()),
  craReviewed: v.optional(v.boolean()),
});

type AuditChange = NonNullable<Doc<"importFileEvents">["changes"]>[number];

/** A PD title as it is stored: trimmed, inner spaces collapsed; undefined for none. */
function cleanPdTitle(value: string): string | undefined {
  const title = value.trim().replace(/\s+/g, " ");
  if (title.length > MAX_PD_TITLE) domainError("INVALID_INPUT", `A PD title can be up to ${MAX_PD_TITLE} characters.`);
  return title || undefined;
}

/** A writer's label as it is now, for the audit row; undefined for none or a writer gone since. */
async function writerAuditLabel(ctx: MutationCtx, id: Id<"pdWriters"> | undefined): Promise<string | undefined> {
  const writer = await liveWriter(ctx, id);
  return writer ? await writerLabel(ctx, writer) : undefined;
}

/**
 * Edit after approval (Admins only): an approved file's writer, reviewer,
 * science code, PD title or "Reviewed by CRA" mark. Metadata only: the
 * file, its text, company, category and fiscal year never change here (Send
 * back to review moves a file). A writer chosen here is set on this file
 * alone, never a firm-wide pick for its initials (approved files keep
 * skipping picks, the freeze rule). The company file's own fields follow
 * (writerId, reviewerId and the labels it stores), and so does the Brain
 * copy when the file has one (writer's name and tier, science code; it is
 * embedded again only when the writer's name or the science code it stores
 * changed). One importFileEvents row lists every field that changed, before
 * and after. Returns the fields that changed and whether the Brain copy is
 * embedded again.
 */
export const editApprovedFile = mutation({
  args: { id: v.id("ingestionItems"), patch: approvedEditPatchValidator },
  returns: v.object({ changed: v.array(approvedEditFieldValidator), reembed: v.boolean() }),
  handler: async (ctx, args) => {
    const adminId = await assertAdmin(ctx);
    const item = await ctx.db.get(args.id);
    if (!item) domainError("NOT_FOUND", ITEM_NOT_FOUND);
    if (item.status !== "approved") domainError("INVALID_STATE", NOT_APPROVED_ANY_MORE);
    const asked = (Object.keys(args.patch) as ApprovedEditField[]).filter((key) => args.patch[key] !== undefined);
    if (asked.length === 0) domainError("INVALID_INPUT", "Choose a detail to change.");
    const category = item.category ?? "unknown";
    for (const field of asked) {
      if (!approvedEditApplies(field, { status: item.status, category })) domainError("INVALID_INPUT", APPROVED_EDIT_REFUSALS[field]);
    }

    const patch: Partial<IngestionItemFields> = {};
    const labelsAdded: Array<"writerName" | "scienceCode" | "pdTitle"> = [];
    const changes: AuditChange[] = [];
    let newWriter: Doc<"pdWriters"> | null = null;

    // The writer and the science code are checked and cleaned as on To review.
    const sheet =
      args.patch.writer !== undefined || args.patch.scienceCode !== undefined
        ? labelPatchFields({
            ...(args.patch.writer !== undefined ? { writer: args.patch.writer } : {}),
            ...(args.patch.scienceCode !== undefined ? { scienceCode: args.patch.scienceCode } : {}),
          })
        : null;
    if (sheet?.writer) {
      const chosen = await writerForChoice(ctx, sheet.writer, { by: adminId });
      if (chosen._id !== item.writerId) {
        const label = await writerLabel(ctx, chosen);
        Object.assign(patch, { writerId: chosen._id, writerName: label, writerNameSource: "person" as const, writerBeforePick: undefined });
        labelsAdded.push("writerName");
        changes.push(
          definedFields({
            field: "writer" as const,
            before: item.writerId,
            after: chosen._id,
            beforeLabel: (await writerAuditLabel(ctx, item.writerId)) ?? item.writerName,
            afterLabel: label,
          })
        );
        newWriter = chosen;
      }
    }
    if (args.patch.reviewer !== undefined) {
      const chosen = args.patch.reviewer === null ? null : await writerForChoice(ctx, args.patch.reviewer, { by: adminId });
      if ((chosen?._id ?? undefined) !== item.reviewerId) {
        // As setFileReviewers: the file alone, and it forgets any reviewer it
        // remembered from before a pick, so every count moves in patchItem.
        Object.assign(
          patch,
          chosen
            ? { reviewerId: chosen._id, reviewerSource: "person" as const, reviewerBeforePick: undefined }
            : { reviewerId: undefined, reviewerSource: undefined, reviewerBeforePick: undefined }
        );
        changes.push(
          definedFields({
            field: "reviewer" as const,
            before: item.reviewerId,
            after: chosen?._id,
            beforeLabel: await writerAuditLabel(ctx, item.reviewerId),
            afterLabel: chosen ? await writerLabel(ctx, chosen) : undefined,
          })
        );
      }
    }
    if (sheet?.fields.scienceCode !== undefined && sheet.fields.scienceCode !== item.scienceCode) {
      Object.assign(patch, { scienceCode: sheet.fields.scienceCode, scienceCodeSource: "person" as const });
      labelsAdded.push("scienceCode");
      changes.push(definedFields({ field: "scienceCode" as const, before: item.scienceCode, after: sheet.fields.scienceCode }));
    } else if (sheet?.fields.scienceCode !== undefined && item.scienceCodeSource !== "person") {
      // The AI's code confirmed by a person becomes theirs; nothing else changes.
      Object.assign(patch, { scienceCodeSource: "person" as const });
      labelsAdded.push("scienceCode");
    }
    if (args.patch.pdTitle !== undefined) {
      const title = cleanPdTitle(args.patch.pdTitle);
      if (title !== item.pdTitle) {
        patch.pdTitle = title;
        labelsAdded.push("pdTitle");
        changes.push(definedFields({ field: "pdTitle" as const, before: item.pdTitle, after: title }));
      }
    }
    if (args.patch.craReviewed !== undefined && args.patch.craReviewed !== (item.craReviewed === true)) {
      const now = Date.now();
      Object.assign(
        patch,
        args.patch.craReviewed
          ? { craReviewed: true, craReviewedBy: adminId, craReviewedAt: now }
          : { craReviewed: undefined, craReviewedBy: undefined, craReviewedAt: undefined }
      );
      changes.push({ field: "craReviewed", before: item.craReviewed ? "yes" : "no", after: args.patch.craReviewed ? "yes" : "no" });
    }
    if (Object.keys(patch).length === 0) return { changed: [], reembed: false };
    if (labelsAdded.length > 0) patch.editedLabels = mergeEditedLabels(item.editedLabels, labelsAdded);
    await patchItem(ctx, item, patch, { touch: true });
    if (changes.length === 0) return { changed: [], reembed: false };

    const changed = new Set(changes.map((change) => change.field));
    // The company file's own fields follow.
    let companyFile: "updated" | "gone" = "gone";
    if (item.companyFileId) {
      const found = await updateImportedCompanyFileLabels(ctx, item.companyFileId, item._id, {
        ...(changed.has("writer") ? { writerId: patch.writerId ?? null } : {}),
        ...(changed.has("reviewer") ? { reviewerId: patch.reviewerId ?? null } : {}),
        ...(changed.has("pdTitle") ? { pdTitle: patch.pdTitle ?? null } : {}),
        ...(changed.has("scienceCode") ? { scienceCode: patch.scienceCode ?? null } : {}),
        ...(changed.has("craReviewed") ? { craReviewed: patch.craReviewed === true } : {}),
      });
      if (found) companyFile = "updated";
    }
    // The Brain copy follows its writer and science code (its title is fixed words and a year).
    let brain: "relabeled" | "reembedded" | "none" = "none";
    let reembed = false;
    const source = item.brainSourceId ? await ctx.db.get(item.brainSourceId) : null;
    if (source && source.status !== "revoked" && (changed.has("writer") || changed.has("scienceCode"))) {
      const tier = newWriter?.tier;
      const result = await relabelImportedSource(
        ctx,
        source,
        {
          ...(newWriter
            ? {
                // As the Brain copy is made (convex/lib/importBrainCopy.ts): the writer's own name, else its label.
                writerName: newWriter.name?.trim() || patch.writerName || null,
                writerTier:
                  typeof tier === "number" && Number.isFinite(tier) ? Math.max(0, Math.min(1, tier)) : IMPORT_BRAIN_DEFAULT_WRITER_TIER,
              }
            : {}),
          ...(changed.has("scienceCode") ? { scienceCode: patch.scienceCode ?? null } : {}),
        },
        adminId
      );
      reembed = result.reembed;
      if (result.changed) brain = reembed ? "reembedded" : "relabeled";
    }
    await ctx.db.insert("importFileEvents", {
      itemId: item._id,
      action: "edit",
      userId: adminId,
      at: Date.now(),
      changes,
      ...(item.companyFileId ? { companyFileId: item.companyFileId } : {}),
      companyFile,
      ...(source ? { brainSourceId: source._id } : {}),
      brain,
    });
    return { changed: [...changed], reembed };
  },
});

const importFileEventValidator = v.object({
  _id: v.id("importFileEvents"),
  action: v.union(v.literal("edit"), v.literal("send_back")),
  at: v.number(),
  by: v.string(),
  changes: v.array(
    v.object({
      field: approvedEditFieldValidator,
      before: v.optional(v.string()),
      after: v.optional(v.string()),
      beforeLabel: v.optional(v.string()),
      afterLabel: v.optional(v.string()),
    })
  ),
  companyFile: v.optional(v.union(v.literal("removed"), v.literal("gone"), v.literal("updated"))),
  brain: v.optional(
    v.union(v.literal("revoked"), v.literal("unlinked"), v.literal("relabeled"), v.literal("reembedded"), v.literal("none"))
  ),
});

/** A file's Send backs and edits after approval, newest first, up to 20 (Admins only). */
export const importFileEvents = query({
  args: { id: v.id("ingestionItems") },
  returns: v.array(importFileEventValidator),
  handler: async (ctx, args) => {
    if ((await adminOrNull(ctx)) === null) return [];
    const rows = await ctx.db
      .query("importFileEvents")
      .withIndex("by_itemId_and_at", (q) => q.eq("itemId", args.id))
      .order("desc")
      .take(20);
    const names = new Map<Id<"users">, string>();
    const out: Infer<typeof importFileEventValidator>[] = [];
    for (const row of rows) {
      if (!names.has(row.userId)) {
        const user = await ctx.db.get(row.userId);
        names.set(row.userId, user ? userDisplayLabel(user) : "Someone no longer in Banhall");
      }
      out.push(
        definedFields({
          _id: row._id,
          action: row.action,
          at: row.at,
          by: names.get(row.userId)!,
          changes: row.changes ?? [],
          companyFile: row.companyFile,
          brain: row.brain,
        })
      );
    }
    return out;
  },
});

// ─── A file's text, for the file view (2026-11-17) ──────────────────────────

/** Characters the file view reads at a time. */
export const FILE_TEXT_PAGE_CHARS = 20_000;

const fileTextSourceValidator = v.object({
  textStorageId: v.optional(v.id("_storage")),
  preview: v.optional(v.string()),
  cutAtImport: v.boolean(),
});

const fileTextPageValidator = v.object({
  text: v.string(),
  start: v.number(),
  end: v.number(),
  total: v.number(),
  source: v.union(v.literal("full"), v.literal("preview"), v.literal("none")),
  cutAtImport: v.boolean(),
});

/** Where an Import file's text is, for the file view (with the caller's identity). */
export const sheetFileTextSource = internalQuery({
  args: { id: v.id("ingestionItems") },
  returns: v.union(v.null(), fileTextSourceValidator),
  handler: async (ctx, args) => {
    await assertAdmin(ctx);
    const item = await ctx.db.get(args.id);
    if (!item) return null;
    return definedFields({
      textStorageId: item.textStorageId,
      preview: item.text,
      cutAtImport: importTextCut(item),
    });
  },
});

/**
 * A page of an Import file's text for the file view (read only): up to
 * 20,000 characters from `start`, the whole length, and where it came from
 * (its whole text in storage, its preview only, or none). Admins only.
 */
export const sheetFileText = action({
  args: { id: v.id("ingestionItems"), start: v.optional(v.number()) },
  returns: v.union(v.null(), fileTextPageValidator),
  handler: async (ctx, args): Promise<Infer<typeof fileTextPageValidator> | null> => {
    const found: Infer<typeof fileTextSourceValidator> | null = await ctx.runQuery(internal.ingestion.sheetFileTextSource, {
      id: args.id,
    });
    if (!found) return null;
    let whole: string | null = null;
    if (found.textStorageId) {
      const blob = await ctx.storage.get(found.textStorageId);
      whole = blob ? await blob.text() : null;
    }
    const source = whole !== null ? ("full" as const) : found.preview?.trim() ? ("preview" as const) : ("none" as const);
    const text = whole ?? found.preview ?? "";
    const start = Math.min(Math.max(0, Math.floor(args.start ?? 0)), text.length);
    const end = Math.min(text.length, start + FILE_TEXT_PAGE_CHARS);
    return { text: text.slice(start, end), start, end, total: text.length, source, cutAtImport: found.cutAtImport };
  },
});

export const rejectItem = mutation({
  args: { itemId: v.id("ingestionItems"), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const admin = await assertAdmin(ctx);
    const item = await ctx.db.get(args.itemId);
    if (!item) throw new Error(ITEM_NOT_FOUND);
    if (item.status === "approved") throw new Error(ALREADY_APPROVED);
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
  if (item.status === "approved") return ALREADY_APPROVED;
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
        patch.initialsGroups = read.initialsGroups;
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

// ─── Reviewers and "Reviewed by CRA" (2026-11-17) ──────────────────────────

/** Why a file was left out of a reviewer or CRA change: missing, approved, still being read, or it does not take it. */
function reviewerSkip(
  item: Doc<"ingestionItems"> | null,
  applies: (row: { status: Doc<"ingestionItems">["status"]; category: IngestionCategory }) => boolean
): BatchSkipReason | null {
  if (!item) return "missing";
  if (item.status === "approved") return "approved";
  if (isBeingRead(item.status)) return "being_read";
  const category = item.category ?? "unknown";
  return applies({ status: item.status, category }) ? null : "does_not_apply";
}

/**
 * Sets the reviewer of up to 100 files alone (2026-11-17: a file's own
 * Reviewer cell, when its reviewer does not follow its initials, or the
 * selection bar): a team member, a writer, or a typed name, as the writer
 * picker gives (writerForChoice). Admin only. It wins for those files
 * (reviewerSource "person"): a pick for their initials, a change of a
 * member's initials and a later read never move it. Read final PDs, drafts
 * and review copies on To review, and those on Deleted
 * (shared/importSheetRules.ts reviewerApplies); every other file is skipped
 * with its reason. A file that already has that reviewer from a person is
 * in neither list. Counts move through patchItem.
 */
export const setFileReviewers = mutation({
  args: { ids: v.array(v.id("ingestionItems")), reviewer: writerChoiceValidator },
  returns: batchResultValidator,
  handler: async (ctx, args) => {
    const admin = await assertAdmin(ctx);
    const ids = batchIds(args.ids, `Change up to ${SHEET_BATCH_MAX_FILES} files at a time.`);
    const outcome = batchOutcome();
    if (ids.length === 0) return outcome.result();
    const chosen = await writerForChoice(ctx, args.reviewer, { by: admin });
    for (const id of ids) {
      const item = await ctx.db.get(id);
      const skip = reviewerSkip(item, reviewerApplies);
      if (skip || !item) {
        outcome.skip(id, skip ?? "missing");
        continue;
      }
      const result = await patchItem(
        ctx,
        item,
        { reviewerId: chosen._id, reviewerSource: "person", reviewerBeforePick: undefined },
        { touch: true }
      );
      if (result.changed) outcome.changed(id);
    }
    return outcome.result();
  },
});

/**
 * Marks up to 100 final PDs as reviewed by CRA, or clears the mark
 * (2026-11-17). Admin only, by hand only: no AI path sets it, and it is
 * never written into any craOutcome field (that one steers retrieval).
 * Final PDs on To review that were read, and final PDs on Deleted
 * (craReviewedApplies); every other file is skipped with its reason. Who
 * set it and when are kept with it; clearing takes all three away.
 */
export const setCraReviewed = mutation({
  args: { ids: v.array(v.id("ingestionItems")), reviewed: v.boolean() },
  returns: batchResultValidator,
  handler: async (ctx, args) => {
    const admin = await assertAdmin(ctx);
    const ids = batchIds(args.ids, `Change up to ${SHEET_BATCH_MAX_FILES} files at a time.`);
    const outcome = batchOutcome();
    const now = Date.now();
    for (const id of ids) {
      const item = await ctx.db.get(id);
      const skip = reviewerSkip(item, craReviewedApplies);
      if (skip || !item) {
        outcome.skip(id, skip ?? "missing");
        continue;
      }
      if ((item.craReviewed === true) === args.reviewed) continue;
      const patch: Partial<IngestionItemFields> = args.reviewed
        ? { craReviewed: true, craReviewedBy: admin, craReviewedAt: now }
        : { craReviewed: undefined, craReviewedBy: undefined, craReviewedAt: undefined };
      const result = await patchItem(ctx, item, patch, { touch: true });
      if (result.changed) outcome.changed(id);
    }
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
 * Which initials a walk follows (2026-11-17): the files whose name gave
 * them as the writer's, or as the reviewer's. A pick names a person, so it
 * moves both.
 */
type WriterMatchRole = "writer" | "reviewer";
const writerMatchRoleValidator = v.union(v.literal("writer"), v.literal("reviewer"));

/** A walk's steps in order: To review for both roles, then Deleted for both. */
const WRITER_MATCH_PHASES: ReadonlyArray<{ role: WriterMatchRole; tab: WriterMatchTab }> = [
  { role: "writer", tab: "review" },
  { role: "reviewer", tab: "review" },
  { role: "writer", tab: "deleted" },
  { role: "reviewer", tab: "deleted" },
];

/**
 * One page of the files on `tab` whose name gave `initials` for `role`,
 * each settled again (patchItem settles both the writer and the reviewer:
 * a file following a pick takes it, a file with none is filled, a file
 * with one from the check keeps it). Counts move through patchItem;
 * pairing does not read the writer, but a row written for the first time
 * since the labels may move group, so the groups touched are recomputed.
 */
async function applyWriterPage(
  ctx: MutationCtx,
  initials: string,
  phase: { role: WriterMatchRole; tab: WriterMatchTab },
  cursor: string | null
): Promise<{ changed: number; isDone: boolean; continueCursor: string }> {
  const { role, tab } = phase;
  const page =
    role === "writer"
      ? await ctx.db
          .query("ingestionItems")
          .withIndex("by_sheetTab_and_writerInitials", (q) => q.eq("sheetTab", tab).eq("writerInitials", initials))
          .paginate({ cursor, numItems: WRITER_MATCH_BATCH })
      : await ctx.db
          .query("ingestionItems")
          .withIndex("by_sheetTab_and_reviewerInitials", (q) => q.eq("sheetTab", tab).eq("reviewerInitials", initials))
          .paginate({ cursor, numItems: WRITER_MATCH_BATCH });
  let changed = 0;
  const groups = new Set<string>();
  for (const item of page.page) {
    if (!(role === "writer" ? followsRememberedWriter(item) : followsRememberedReviewer(item))) continue;
    const result = await patchItem(ctx, item, {}, { touch: true });
    if (!result.changed) continue;
    changed += 1;
    for (const key of pairGroupsTouched(item, result.after)) groups.add(key);
  }
  await recomputeGroups(ctx, groups, MANY_ROWS);
  return { changed, isDone: page.isDone, continueCursor: page.continueCursor };
}

/**
 * The first 100 files on To review whose reviewer initials these are,
 * settled again (matchWriterInitials, which has paginated once already).
 * `more` when there are others after them.
 */
async function applyReviewerFirstFiles(ctx: MutationCtx, initials: string): Promise<{ changed: number; more: boolean }> {
  const items = await ctx.db
    .query("ingestionItems")
    .withIndex("by_sheetTab_and_reviewerInitials", (q) => q.eq("sheetTab", "review").eq("reviewerInitials", initials))
    .take(WRITER_MATCH_BATCH + 1);
  let changed = 0;
  const groups = new Set<string>();
  for (const item of items.slice(0, WRITER_MATCH_BATCH)) {
    if (!followsRememberedReviewer(item)) continue;
    const result = await patchItem(ctx, item, {}, { touch: true });
    if (!result.changed) continue;
    changed += 1;
    for (const key of pairGroupsTouched(item, result.after)) groups.add(key);
  }
  await recomputeGroups(ctx, groups, MANY_ROWS);
  return { changed, more: items.length > WRITER_MATCH_BATCH };
}

/** The step after `phase`, or null at the end of the walk. */
function nextWriterPhase(phase: { role: WriterMatchRole; tab: WriterMatchTab }) {
  const at = WRITER_MATCH_PHASES.findIndex((entry) => entry.role === phase.role && entry.tab === phase.tab);
  return WRITER_MATCH_PHASES[at + 1] ?? null;
}

/** Schedules the rest of a match's walk: the next page of this step, else the next step. */
async function continueWriterMatch(
  ctx: MutationCtx,
  initials: string,
  phase: { role: WriterMatchRole; tab: WriterMatchTab },
  page: { isDone: boolean; continueCursor: string }
): Promise<void> {
  const next = page.isDone ? nextWriterPhase(phase) : phase;
  if (next === null) return;
  await ctx.scheduler.runAfter(0, internal.ingestion.applyWriterInitials, {
    initials,
    tab: next.tab,
    role: next.role,
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
 * its Undo leaves every file as it was. Since 2026-11-17 the pick names a
 * person, so it applies to reviewers too: every file whose reviewer
 * initials they are, and whose reviewer no person set on the file, follows
 * it the same way (reviewerBeforePick), and the Undo gives each its
 * reviewer back exactly. The first 100 files with the initials as the
 * writer's on To review follow in this call, then, when those were all,
 * the first 100 with them as the reviewer's (applyReviewerFirstFiles); the
 * rest of To review, then Deleted, follow in scheduled runs of 100. Returns the writer and its
 * label, the pick before as a choice an Undo can send back (it still works
 * when that writer was a bare one that has been removed since), how many
 * files changed now, and whether more To review files are still to follow.
 * Refusals are ConvexErrors.
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
    // To review now: the writers' first page, then, when that was all of
    // them, the first 100 files with the initials as the reviewer's. One
    // function may paginate once, so those are read with take, and the
    // reviewers' scheduled walk starts from the first page again (the
    // files done here change nothing then).
    const page = await applyWriterPage(ctx, initials, WRITER_MATCH_PHASES[0], null);
    let changed = page.changed;
    let more = !page.isDone;
    if (page.isDone) {
      const reviewed = await applyReviewerFirstFiles(ctx, initials);
      changed += reviewed.changed;
      more = reviewed.more;
    }
    await continueWriterMatch(ctx, initials, WRITER_MATCH_PHASES[0], page);
    return {
      initials,
      writerId: chosen?._id ?? null,
      writerName: chosen ? await writerLabel(ctx, chosen) : null,
      previous,
      changed,
      more,
    };
  },
});

/**
 * The rest of a match's walk (matchWriterInitials), and the walk after any
 * other change of the facts for some initials (users.setUserInitials, a
 * writer linked or unlinked, a pick deleted with its writer): one page,
 * then it schedules the next. Under the freeze rule it moves only files
 * that follow a pick, and fills only files with no writer or reviewer yet
 * (for example initials two people shared, once only one member has them).
 * `role` (2026-11-17): which initials the page follows; absent is the
 * writer's, and a walk started for the writer goes on to the reviewer.
 */
export const applyWriterInitials = internalMutation({
  args: {
    initials: v.string(),
    tab: writerMatchTabValidator,
    role: v.optional(writerMatchRoleValidator),
    cursor: v.union(v.string(), v.null()),
  },
  returns: v.object({ changed: v.number(), done: v.boolean() }),
  handler: async (ctx, args) => {
    const initials = writerInitialsKey(args.initials);
    if (initials === null) return { changed: 0, done: true };
    const phase = { role: args.role ?? "writer", tab: args.tab };
    // The facts as they are now: a later pick or an Undo meanwhile wins.
    const page = await applyWriterPage(ctx, initials, phase, args.cursor);
    await continueWriterMatch(ctx, initials, phase, page);
    return { changed: page.changed, done: page.isDone && nextWriterPhase(phase) === null };
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
 * shows the writer's label as it is now). Since 2026-11-17 it gives every
 * file its reviewer the same way (settled on To review and Deleted; an
 * approved file gains only the reference, from the pick or the check for
 * its reviewer initials). 100 files a run; it schedules the rest. Safe to
 * run again.
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
      if (item.reviewerId === undefined && item.status === "approved" && takesInitialsReviewer(item)) {
        // 2026-11-17: an approved file gains only a reviewer reference too,
        // the pick or the check for its reviewer initials. Files on To
        // review and Deleted get theirs when they are settled below.
        const initials = writerInitialsKey(item.reviewerInitials)!;
        const reviewer = (await pickedWriter(ctx, initials)) ?? (await writerForInitials(ctx, initials));
        // Only the reference, as for the writer: no source, since an
        // approved file follows neither a pick nor the check any more.
        if (reviewer) patch = { ...patch, reviewerId: reviewer.id };
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
 * waits for its reading. A file that was still waiting in another batch
 * stops waiting there (that batch counts it as done), so no batch waits on
 * a file that left it.
 */
async function arrivalFields(
  ctx: MutationCtx,
  existing: Doc<"ingestionItems"> | null,
  arrival: Arrival
): Promise<Partial<IngestionItemFields>> {
  if (existing?.batchReadPending && existing.batchId && existing.batchId !== arrival.batchId) {
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
    // 2026-11-17: whether the extraction cut the text at the import's limit.
    textCut: v.optional(v.boolean()),
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
      textCut: args.textCut,
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
