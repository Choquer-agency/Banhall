/// <reference types="vite/client" />
// The Import sheet's data (2026-11-11, phase 2): the move fix, the company
// counts, the sheet queries, label edits and the science code from text.
import { TOO_MANY_PENDING_INVITES } from "./lib/inviteRows";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { dashboardCompanyKey } from "../shared/dashboardProjection";
import { classify } from "./lib/ingestionClassify";
import { docKindForCategory, settleItem } from "./lib/ingestionSheet";
import { adjustImportCompanyCounts, adjustImportFinalPdCounts } from "./lib/importCompanyCounts";
import { bareWriterFromInitials } from "./lib/teamRoster";
import { nameMatchesInitials, writerNamesFromText } from "../shared/writerNameFromText";
import schema from "./schema";
import workpoolSchema from "../node_modules/@convex-dev/workpool/src/component/schema.js";

const modules = import.meta.glob("./**/*.ts");
const workpoolModules = import.meta.glob("../node_modules/@convex-dev/workpool/src/component/**/*.ts");
type T = ReturnType<typeof convexTest<typeof schema.tables>>;

// Many writes schedule pairing (recomputePairs) and some schedule extraction or
// the Brain's embedding. Fake timers keep all of it from running on its own,
// so each test runs exactly the scheduled work it means to.
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

/** Run every scheduled function, and what they schedule, to the end. */
async function runScheduled(t: T) {
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

/** The scheduled recomputePairs jobs runPairing already ran, per test backend. */
const pairJobsRun = new WeakMap<T, Set<string>>();

/**
 * Run only the scheduled pairing (recomputePairs) to the end, leaving other
 * scheduled work (an extraction, the Brain's embedding) waiting. Each job is
 * run once, by calling the mutation with its arguments; what that schedules
 * is run next. Returns the group keys of each run since the last call, in order.
 */
async function runPairing(t: T): Promise<string[][]> {
  const done = pairJobsRun.get(t) ?? new Set<string>();
  pairJobsRun.set(t, done);
  const runs: string[][] = [];
  for (;;) {
    const jobs = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    const next = jobs.find((job) => job.name.includes("recomputePairs") && job.state.kind === "pending" && !done.has(job._id));
    if (!next) return runs;
    done.add(next._id);
    const args = next.args[0] as { groupKeys: string[] };
    runs.push(args.groupKeys);
    await t.mutation(internal.ingestion.recomputePairs, args);
  }
}

/** The scheduled writer-match runs runWriterWalk already ran, per test backend. */
const writerJobsRun = new WeakMap<T, Set<string>>();

/** The scheduled writer walks (2026-11-16), by the name the scheduler gives each. */
const WRITER_WALKS = {
  applyWriterInitials: internal.ingestion.applyWriterInitials,
  refreshWriterFiles: internal.ingestion.refreshWriterFiles,
  migrateImportWriterInitials: internal.ingestion.migrateImportWriterInitials,
  backfillImportWriters: internal.ingestion.backfillImportWriters,
  backfillUserInitials: internal.users.backfillUserInitials,
} as const;

/** The scheduled writer walks that are actions (the names backfill reads text from storage). */
const WRITER_ACTION_WALKS = {
  backfillDocumentWriterNames: internal.ingestion.backfillDocumentWriterNames,
  readDocumentWriterNames: internal.ingestion.readDocumentWriterNames,
} as const;

/**
 * Run only the scheduled writer walks (the rest of a match, a refresh after
 * a writer changed, the moves to writers) to the end, leaving other
 * scheduled work waiting, as runPairing does for pairing. Returns how many
 * runs it made of each.
 */
async function runWriterWalk(t: T): Promise<Record<string, number>> {
  const done = writerJobsRun.get(t) ?? new Set<string>();
  writerJobsRun.set(t, done);
  const runs: Record<string, number> = {};
  for (;;) {
    const jobs = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    const names = [...Object.keys(WRITER_WALKS), ...Object.keys(WRITER_ACTION_WALKS)];
    const next = jobs.find(
      (job) => job.state.kind === "pending" && !done.has(job._id) && names.some((name) => job.name.endsWith(`:${name}`))
    );
    if (!next) return runs;
    done.add(next._id);
    const name = next.name.split(":").pop()!;
    runs[name] = (runs[name] ?? 0) + 1;
    // Each walk's own arguments, as the scheduler stored them.
    if (name in WRITER_ACTION_WALKS) {
      const act = t.action as (fn: unknown, args: unknown) => Promise<unknown>;
      await act(WRITER_ACTION_WALKS[name as keyof typeof WRITER_ACTION_WALKS], next.args[0]);
      continue;
    }
    const run = t.mutation as (fn: unknown, args: unknown) => Promise<unknown>;
    await run(WRITER_WALKS[name as keyof typeof WRITER_WALKS], next.args[0]);
  }
}

async function setup() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("users", { authId: "sheet-admin", role: "admin", firstName: "Dana" });
    await ctx.db.insert("users", { authId: "sheet-writer", role: "writer", firstName: "Sam" });
  });
  return {
    t,
    admin: t.withIdentity({ subject: "sheet-admin" }),
    writer: t.withIdentity({ subject: "sheet-writer" }),
  };
}

/**
 * Gives both setup users these saved initials (2026-11-16), so files with
 * them could be either person: they get no writer, and need a person to
 * choose one ("unmatched_initials").
 */
async function twoMembersWith(t: T, initials: string) {
  await t.run(async (ctx) => {
    for (const user of await ctx.db.query("users").collect()) await ctx.db.patch(user._id, { initials });
  });
}

const CEDARLINE_FY = "Cedarline Systems/2025 - Mar 31";
const PD_NAME = "04 CedarlineSystems 2025-03-31 T2.DW.PN ColdChainSensorDrift.docx";

/** The upsert arguments a feeder sends for a file at `path`, as http.ts builds them. */
function discoveredArgs(path: string, extra: { driveItemId?: string; contentHash?: string } = {}) {
  const segments = path.split("/");
  const name = segments.pop()!;
  const meta = classify(segments.join("/"), name);
  return {
    driveItemId: extra.driveItemId ?? `drive-${path}`,
    path,
    name,
    clientName: meta.clientName,
    fiscalYearLabel: meta.fiscalYearLabel,
    fiscalYear: meta.fiscalYear,
    docKind: meta.docKind,
    size: 2048,
    lastModifiedAt: 1_700_000_000_000,
    contentHash: extra.contentHash ?? "hash-1",
    pairGroupKey: meta.pairGroupKey,
  };
}

async function stage(t: T, path: string, extra: { driveItemId?: string; contentHash?: string } = {}) {
  const args = discoveredArgs(path, extra);
  const id = await t.mutation(internal.ingestion.upsertDiscoveredItem, args);
  if (id) return id;
  const row = await t.run((ctx) =>
    ctx.db
      .query("ingestionItems")
      .withIndex("by_driveItemId", (q) => q.eq("driveItemId", args.driveItemId))
      .unique()
  );
  return row!._id;
}

async function getItem(t: T, id: Id<"ingestionItems">): Promise<Doc<"ingestionItems">> {
  const row = await t.run((ctx) => ctx.db.get(id));
  if (!row) throw new Error("item missing");
  return row;
}

/** Puts a staged row in review the way extraction does. */
async function markRead(t: T, id: Id<"ingestionItems">, text = "Extracted text") {
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["bytes"])));
  await t.mutation(internal.ingestion.markItemProcessed, { itemId: id, storageId, text });
}

/**
 * Approves a file the way the Import page does (2026-11-17): an approval of
 * that one file, then one step of its chain run here (its next step stays
 * scheduled). Industry for a final PD's new company is picked first.
 */
async function approveForTest(
  t: T,
  admin: ReturnType<T["withIdentity"]>,
  id: Id<"ingestionItems">,
  options: { mayRefuse?: boolean } = {}
) {
  const item = await getItem(t, id);
  if (item.companyKey && item.category === "final_pd") {
    const picked = await t.run((ctx) =>
      ctx.db.query("importNewCompanies").withIndex("by_companyKey", (q) => q.eq("companyKey", item.companyKey!)).first()
    );
    const client = await t.run((ctx) =>
      ctx.db.query("clients").withIndex("by_status_and_nameKey", (q) => q.eq("status", "active").eq("nameKey", item.companyKey!)).first()
    );
    if (!picked && !client) await admin.mutation(api.ingestion.setNewCompanyIndustry, { companyKey: item.companyKey, industry: "Food processing" });
  }
  const { approvalId } = await admin.mutation(api.ingestion.approveFiles, { ids: [id] });
  await t.action(internal.ingestion.runApproval, { approvalId });
  const after = await getItem(t, id);
  if (!options.mayRefuse && after.status !== "approved") {
    throw new Error(`approveForTest: not approved (${after.status}; ${(after.checkReasons ?? []).join(", ")})`);
  }
}

/** Takes a row out of Import altogether, with its band share, so a later call finds it missing. */
async function removeRow(t: T, id: Id<"ingestionItems">) {
  await t.run(async (ctx) => {
    const row = await ctx.db.get(id);
    await ctx.db.delete(id);
    await adjustImportCompanyCounts(ctx, row, null);
    await adjustImportFinalPdCounts(ctx, row, null);
  });
}

/** Every stored row keeps the invariants the old page and the sheet both rely on. */
function expectInvariants(row: Doc<"ingestionItems">) {
  expect(row.category, row.path).toBeDefined();
  expect(row.docKind, row.path).toBe(docKindForCategory(row.category!));
  expect(row.companyKey, row.path).toBe(
    row.clientName === undefined ? undefined : dashboardCompanyKey(row.clientName)
  );
  expect(row.fiscalYear, row.path).toBe(
    row.fiscalYearEnd === undefined ? undefined : new Date(row.fiscalYearEnd).getUTCFullYear()
  );
  expect(row.pairGroupKey, row.path).toBe(`${row.companyKey ?? "?"}::${row.fiscalYear ?? "?"}`);
  const { _id, _creationTime, ...fields } = row;
  const settled = settleItem(fields);
  for (const key of ["sheetTab", "needsCheck", "checkReasons", "sortKey", "scienceCodeSource", "writerNameSource", "sheetSection"] as const) {
    expect(row[key], `${row.path} ${key}`).toEqual(settled[key]);
  }
}

describe("a move with unchanged bytes", () => {
  async function pairedPd(t: T) {
    const pd = await stage(t, `${CEDARLINE_FY}/To be submitted/${PD_NAME}`, { driveItemId: "pd" });
    const transcript = await stage(t, `${CEDARLINE_FY}/WIP/Technical/Audio/interview.txt`, {
      driveItemId: "transcript",
    });
    await markRead(t, pd);
    await markRead(t, transcript);
    await t.mutation(internal.ingestion.recomputePairs, { groupKeys: ["cedarline systems::2025"] });
    await t.run((ctx) => ctx.db.patch(pd, { reviewNote: "Check the title" }));
    expect(await getItem(t, pd)).toMatchObject({ pairStatus: "paired" });
    return { pd, transcript };
  }

  it("moves the client, pairing key and labels to the new company, keeping the review state", async () => {
    const t = convexTest(schema, modules);
    const { pd, transcript } = await pairedPd(t);
    await t.mutation(
      internal.ingestion.upsertDiscoveredItem,
      discoveredArgs(`Halden Foods/2025 - Mar 31/To be submitted/${PD_NAME}`, { driveItemId: "pd" })
    );
    const moved = await getItem(t, pd);
    expect(moved).toMatchObject({
      clientName: "Halden Foods",
      companyKey: "halden foods",
      fiscalYearLabel: "2025 - Mar 31",
      pairGroupKey: "halden foods::2025",
      docKind: "pd",
      category: "final_pd",
      status: "pending_review",
      reviewNote: "Check the title",
      // Its new group, recomputed in the same mutation, has no transcript.
      pairStatus: "missing_transcript",
    });
    expectInvariants(moved);
    // The group it left is recomputed by a scheduled run: the transcript lost its PD.
    expect(await runPairing(t)).toEqual([["cedarline systems::2025"]]);
    expect(await getItem(t, transcript)).toMatchObject({ pairStatus: "missing_pd" });
  });

  it("moves the fiscal year, its end and the pairing key across years", async () => {
    const t = convexTest(schema, modules);
    const { pd, transcript } = await pairedPd(t);
    await t.mutation(
      internal.ingestion.upsertDiscoveredItem,
      discoveredArgs(`Cedarline Systems/2024 - Dec 31/To be submitted/${PD_NAME}`, { driveItemId: "pd" })
    );
    const moved = await getItem(t, pd);
    expect(moved).toMatchObject({
      clientName: "Cedarline Systems",
      fiscalYearLabel: "2024 - Dec 31",
      fiscalYear: 2024,
      fiscalYearEnd: Date.UTC(2024, 11, 31),
      fiscalYearEndAssumed: false,
      pairGroupKey: "cedarline systems::2024",
      pairStatus: "missing_transcript",
      status: "pending_review",
    });
    expectInvariants(moved);
    await runPairing(t);
    expect(await getItem(t, transcript)).toMatchObject({ pairStatus: "missing_pd" });
  });

  it("changes docKind with the category, and repairs pairing in the same group", async () => {
    const t = convexTest(schema, modules);
    const { pd, transcript } = await pairedPd(t);
    await t.mutation(
      internal.ingestion.upsertDiscoveredItem,
      discoveredArgs(`${CEDARLINE_FY}/Drafts/${PD_NAME}`, { driveItemId: "pd" })
    );
    const moved = await getItem(t, pd);
    expect(moved).toMatchObject({
      category: "draft",
      docKind: "supporting",
      pairGroupKey: "cedarline systems::2025",
      status: "pending_review",
      reviewNote: "Check the title",
    });
    expect(moved.pairStatus).toBeUndefined();
    expectInvariants(moved);
    // One group, recomputed in the same mutation.
    expect(await getItem(t, transcript)).toMatchObject({ pairStatus: "missing_pd" });
  });

  it("keeps a company a person set, and the pairing key follows it", async () => {
    const t = convexTest(schema, modules);
    const { pd } = await pairedPd(t);
    // A person filed it under another company.
    await t.run((ctx) => ctx.db.patch(pd, { clientName: "Northgate Labs", editedLabels: ["company"] }));
    await t.mutation(
      internal.ingestion.upsertDiscoveredItem,
      discoveredArgs(`Halden Foods/2024 - Dec 31/Drafts/${PD_NAME}`, { driveItemId: "pd" })
    );
    const moved = await getItem(t, pd);
    expect(moved).toMatchObject({
      clientName: "Northgate Labs",
      companyKey: "northgate labs",
      // Labels a person did not set still follow the path.
      category: "draft",
      fiscalYearLabel: "2024 - Dec 31",
      pairGroupKey: "northgate labs::2024",
      editedLabels: ["company"],
    });
    expectInvariants(moved);
  });

  it("keeps a person's company when new bytes arrive too", async () => {
    const t = convexTest(schema, modules);
    const id = await stage(t, `${CEDARLINE_FY}/Drafts/notes.docx`, { driveItemId: "notes" });
    await t.run((ctx) => ctx.db.patch(id, { clientName: "Brightwell Dairy", editedLabels: ["company"] }));
    await t.mutation(
      internal.ingestion.upsertDiscoveredItem,
      discoveredArgs(`${CEDARLINE_FY}/Drafts/notes.docx`, { driveItemId: "notes", contentHash: "hash-2" })
    );
    const row = await getItem(t, id);
    expect(row).toMatchObject({ clientName: "Brightwell Dairy", companyKey: "brightwell dairy", status: "discovered" });
    expectInvariants(row);
  });

  /** The fields a move must leave alone on an approved row. */
  const KEPT_ON_APPROVED = [
    "clientName",
    "companyKey",
    "fiscalYearLabel",
    "fiscalYear",
    "fiscalYearEnd",
    "fiscalYearEndAssumed",
    "docKind",
    "category",
    "pairGroupKey",
    "pairStatus",
    "pdNumber",
    "versionCode",
    "versionNumber",
    "writerInitials",
    "reviewerInitials",
    "pdTitle",
    "writerName",
    "scienceCode",
    "scienceCodeSource",
    "editedLabels",
    "sheetTab",
    "needsCheck",
    "checkReasons",
    "status",
    "brainSourceId",
    "portedProjectId",
    "portedDocumentId",
  ] as const;
  const keptOf = (row: Doc<"ingestionItems">) => Object.fromEntries(KEPT_ON_APPROVED.map((key) => [key, row[key]]));

  it("leaves an approved and ported PD as it was approved, wherever it moves", async () => {
    vi.stubEnv("VOYAGE_API_KEY", "test-voyage-key");
    try {
      const { t, admin } = await setup();
      t.registerComponent("embedPool", workpoolSchema, workpoolModules);
      const { pd, transcript } = await pairedPd(t);
      await admin.mutation(api.ingestion.setSheetLabels, { ids: [pd], patch: { writerName: "Dana Whitlock", scienceCode: "2.02.09" } });
      await approveForTest(t, admin, pd);
      await admin.action(api.ingestionPort.portItemToProject, { itemId: pd });
      await runPairing(t);
      const approved = await getItem(t, pd);
      expect(approved).toMatchObject({ status: "approved", docKind: "pd", portedProjectId: expect.any(String) });
      const kept = keptOf(approved);
      const { stored: bandsBefore } = await countsNowAndRecount(t);

      for (const path of [
        // Another folder of the same company and year.
        `${CEDARLINE_FY}/Drafts/${PD_NAME}`,
        // Another company's folder, in another year.
        `Halden Foods/2024 - Dec 31/To be submitted/renamed ${PD_NAME}`,
      ]) {
        const args = discoveredArgs(path, { driveItemId: "pd" });
        await expect(t.mutation(internal.ingestion.upsertDiscoveredItem, args)).resolves.toBeNull();
        const moved = await getItem(t, pd);
        // Only what main patched follows the drive.
        expect(moved).toMatchObject({ path, name: args.name, lastModifiedAt: args.lastModifiedAt });
        expect(keptOf(moved), path).toEqual(kept);
        expect((await countsNowAndRecount(t)).stored, path).toEqual(bandsBefore);
        await expectCountsMatchRecount(t, path);
      }
      // Nothing about pairing moved, so nothing was recomputed.
      expect(await runPairing(t)).toEqual([]);
      expect(await getItem(t, transcript)).toMatchObject({ pairStatus: "paired" });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("moves a rejected or deleted file with its path, so it is right when restored", async () => {
    const { t, admin } = await setup();
    const rejected = await stage(t, `${CEDARLINE_FY}/Drafts/rejected.docx`, { driveItemId: "rejected" });
    const deleted = await stage(t, `${CEDARLINE_FY}/Drafts/deleted.docx`, { driveItemId: "deleted" });
    await markRead(t, rejected);
    await markRead(t, deleted);
    await admin.mutation(api.ingestion.rejectItem, { itemId: rejected });
    await admin.mutation(api.ingestion.removeItem, { itemId: deleted });
    for (const [id, name] of [[rejected, "rejected.docx"], [deleted, "deleted.docx"]] as const) {
      await t.mutation(
        internal.ingestion.upsertDiscoveredItem,
        discoveredArgs(`Halden Foods/2024 - Dec 31/Drafts/${name}`, { driveItemId: name.replace(".docx", "") })
      );
      const moved = await getItem(t, id);
      expect(moved).toMatchObject({ clientName: "Halden Foods", fiscalYear: 2024, pairGroupKey: "halden foods::2024" });
      expectInvariants(moved);
    }
    expect((await getItem(t, rejected)).status).toBe("rejected");
    await admin.mutation(api.ingestion.restoreItem, { itemId: deleted });
    expect(await getItem(t, deleted)).toMatchObject({
      status: "pending_review",
      sheetTab: "review",
      companyKey: "halden foods",
      category: "draft",
    });
    await expectCountsMatchRecount(t, "after moving and restoring");
  });
});

// ─── Company counts ─────────────────────────────────────────────────────────

type CategoryCounts = {
  total: number;
  needsCheck: number;
  fiscalYears: Record<string, number>;
  checkReasons?: Record<string, number>;
  newFiles?: number;
  newFiscalYears?: Record<string, number>;
};
type BandCounts = {
  total: number;
  needsCheck: number;
  ready: number;
  beingRead: number;
  newFiles?: number;
  categories: Record<string, CategoryCounts>;
};

/** The sheet tab of a status, written out here rather than taken from the app. */
function tabByHand(status: Doc<"ingestionItems">["status"]): "review" | "approved" | "deleted" {
  if (status === "approved") return "approved";
  if (status === "rejected" || status === "deleted") return "deleted";
  return "review"; // discovered, fetched, pending_review, failed
}

function beingReadByHand(row: Doc<"ingestionItems">): boolean {
  return row.status === "discovered" || row.status === "fetched";
}

/** Why a row needs a person to look at it, written out from its labels. */
function checkReasonsByHand(row: Doc<"ingestionItems">): string[] {
  // Only files on the review tab are ever flagged.
  if (tabByHand(row.status) !== "review") return [];
  // A file still being read is not flagged yet: its row has nothing to pick.
  if (beingReadByHand(row)) return [];
  const reasons: string[] = [];
  // No company folder or company name.
  if (row.clientName === undefined) reasons.push("no_company");
  // Not known what kind of file it is.
  if (row.category === "unknown") reasons.push("unknown_category");
  // It could not be read.
  if (row.status === "failed") reasons.push("could_not_read");
  // It was read, but no text came out (a scan): no preview text and no stored text.
  if (
    row.status === "pending_review" &&
    !(row.text ?? "").trim() &&
    (row.textLength ?? 0) === 0 &&
    row.textStorageId === undefined
  ) {
    reasons.push("no_text");
  }
  // No fiscal year end, on a category that belongs to a fiscal year: not a
  // company file, and not an unsorted file (until a person sorts it).
  if (row.category !== "company_file" && row.category !== "unknown" && row.fiscalYearEnd === undefined) {
    reasons.push("no_fiscal_year");
  }
  if (row.category === "final_pd") {
    // No science code.
    if (!row.scienceCode) reasons.push("no_science_code");
    // No writer's name: initials (two or three letters) a person has not
    // matched to a writer yet, or nothing at all.
    if (!row.writerName) reasons.push(/^[A-Z]{2,3}$/.test(row.writerInitials ?? "") ? "unmatched_initials" : "no_writer");
  }
  return reasons;
}

/**
 * Whether one label of an edit goes on a row, written out here (the rule
 * shared/importSheetRules.ts labelApplies gives the page and the server):
 * moves on any file on To review, other labels only once it is read, a
 * writer, version or PD number on final PDs, drafts and review copies, a
 * science code on final PDs, by the category the edit gives it.
 */
function labelGoesOnByHand(label: string, row: Doc<"ingestionItems">, categoryAfter: string): boolean {
  if (tabByHand(row.status) !== "review") return false;
  if (label === "company" || label === "category") return true;
  if (row.status !== "pending_review") return false;
  if (label === "fiscalYearEnd") return true;
  if (label === "scienceCode") return categoryAfter === "final_pd";
  return ["final_pd", "draft", "review_copy"].includes(categoryAfter);
}

/**
 * Whether a reviewer can be set on a row (2026-11-17), written out here: a
 * final PD, draft or review copy that was read and waits on To review, or
 * one on Deleted. Never an approved file or one still being read.
 */
function reviewerGoesOnByHand(row: Doc<"ingestionItems">): boolean {
  if (!["final_pd", "draft", "review_copy"].includes(row.category ?? "unknown")) return false;
  if (tabByHand(row.status) === "review") return row.status === "pending_review";
  return tabByHand(row.status) === "deleted";
}

function needsCheckByHand(row: Doc<"ingestionItems">): boolean {
  return checkReasonsByHand(row).length > 0;
}

/**
 * The company bands as a hand count of the rows gives them, keyed
 * "tab|companyKey", written with plain loops and no app counting code. A row
 * counts once it is on the sheet (it has a sheetTab; a row staged before the
 * sheet fields is not counted until it is next written), in the band of its
 * tab and its company ("" when it has none).
 * - total: the band's files.
 * - needsCheck: files that need a person to look at them (needsCheckByHand).
 * - beingRead: files still being fetched or read (discovered, fetched).
 * - ready: files that need no check and are already read; on the approved
 *   and deleted tabs nothing needs a check or is being read, so every file.
 * - categories[c].total, categories[c].needsCheck: the same counts for one category.
 * - categories[c].fiscalYears[y]: that category's files whose fiscal year end
 *   is in UTC year y, or y "none" for files with no fiscal year end.
 * - categories[c].checkReasons[r]: that category's files with check reason r
 *   (checkReasonsByHand). A file with two reasons counts under both.
 * - c is the section the file shows in (2026-11-12): its category, or
 *   "unknown" (Not sorted yet) while it is still being read.
 * - newFiles, categories[c].newFiles and categories[c].newFiscalYears[y]:
 *   the same counts for the files that are New (isNew), on To review only.
 * A band, category, year or reason with no file is left out, and so is a
 * category's checkReasons when none of its files needs a check, and every
 * New count with no New file.
 */
function recountByHand(items: Array<Doc<"ingestionItems">>): Record<string, BandCounts> {
  const bands: Record<string, BandCounts> = {};
  for (const row of items) {
    if (row.sheetTab === undefined) continue;
    expect(row.sheetTab, `${row.path} sheetTab`).toBe(tabByHand(row.status));
    const reasons = checkReasonsByHand(row);
    const check = reasons.length > 0;
    const beingRead = beingReadByHand(row);
    expect(row.needsCheck === true, `${row.path} needsCheck`).toBe(check);
    const company = row.clientName === undefined ? "" : dashboardCompanyKey(row.clientName);
    const key = `${row.sheetTab}|${company}`;
    bands[key] ??= { total: 0, needsCheck: 0, ready: 0, beingRead: 0, categories: {} };
    const band = bands[key];
    band.total += 1;
    if (check) band.needsCheck += 1;
    if (beingRead) band.beingRead += 1;
    if (!check && !beingRead) band.ready += 1;
    const isNew = row.sheetTab === "review" && row.isNew === true;
    if (isNew) band.newFiles = (band.newFiles ?? 0) + 1;
    // A file still being read waits under Not sorted yet.
    const categoryName = beingRead ? "unknown" : row.category!;
    band.categories[categoryName] ??= { total: 0, needsCheck: 0, fiscalYears: {} };
    const category = band.categories[categoryName];
    category.total += 1;
    if (check) category.needsCheck += 1;
    const year = row.fiscalYearEnd === undefined ? "none" : String(new Date(row.fiscalYearEnd).getUTCFullYear());
    category.fiscalYears[year] = (category.fiscalYears[year] ?? 0) + 1;
    if (isNew) {
      category.newFiles = (category.newFiles ?? 0) + 1;
      category.newFiscalYears ??= {};
      category.newFiscalYears[year] = (category.newFiscalYears[year] ?? 0) + 1;
    }
    for (const reason of reasons) {
      category.checkReasons ??= {};
      category.checkReasons[reason] = (category.checkReasons[reason] ?? 0) + 1;
    }
  }
  return bands;
}

/** The bands as a fresh hand count of the rows gives them, and as stored. */
async function countsNowAndRecount(t: T) {
  const { items, bands } = await t.run(async (ctx) => ({
    items: await ctx.db.query("ingestionItems").collect(),
    bands: await ctx.db.query("importCompanies").collect(),
  }));
  const recount = recountByHand(items);
  const stored: Record<string, BandCounts> = {};
  for (const band of bands) {
    const key = `${band.sheetTab}|${band.companyKey}`;
    expect(stored[key], `one row per band: ${key}`).toBeUndefined();
    stored[key] = {
      total: band.total,
      needsCheck: band.needsCheck,
      ready: band.ready,
      beingRead: band.beingRead,
      ...(band.newFiles === undefined ? {} : { newFiles: band.newFiles }),
      categories: band.categories,
    };
    expect(band.hasCheck, key).toBe(band.needsCheck > 0);
    expect(band.hasNew === true, key).toBe((band.newFiles ?? 0) > 0);
    expect(band.total, key).toBeGreaterThan(0);
    if (band.companyKey === "") expect(band.displayName).toBe("");
    else expect(dashboardCompanyKey(band.displayName), key).toBe(band.companyKey);
  }
  return { items, bands, recount, stored };
}

/**
 * Run a band rebuild to its end, page by page, by calling each next page the
 * run scheduled (other scheduled work is left waiting). Returns the pages run.
 */
async function driveRebuild(
  t: T,
  args: { sheetTab: "review" | "approved" | "deleted"; companyKey: string; pageSize: number }
): Promise<number> {
  const seen = new Set<string>();
  const pendingRebuilds = async () =>
    (await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).filter(
      (job) => job.name.includes("rebuildImportCompanyCounts") && job.state.kind === "pending" && !seen.has(job._id)
    );
  for (const job of await pendingRebuilds()) seen.add(job._id);
  let pages = 1;
  let result = await t.mutation(internal.ingestion.rebuildImportCompanyCounts, args);
  while (!result.done) {
    const [next, ...others] = await pendingRebuilds();
    expect(others, "a rebuild schedules one next page").toEqual([]);
    seen.add(next._id);
    pages += 1;
    result = await t.mutation(internal.ingestion.rebuildImportCompanyCounts, next.args[0] as never);
  }
  return pages;
}

async function expectCountsMatchRecount(t: T, label: string) {
  const { items, recount, stored } = await countsNowAndRecount(t);
  for (const item of items) if (item.sheetTab !== undefined) expectInvariants(item);
  expect(stored, label).toEqual(recount);
  await expectWriterCountsMatchRecount(t, items, label);
  await expectFinalPdCountsMatchRecount(t, items, label);
}

type FinalPdTallies = Record<string, { review: number; approved: number }>;

/**
 * The final PD progress counts (2026-11-17) as a hand count of the rows
 * gives them: final PDs on To review and Approved only (never Deleted), by
 * tab, under "all", their fiscal year's UTC year (or "none") and their
 * writer (or "none", or "unsorted" for a name with three or four initials
 * groups and no writer).
 */
function finalPdRecountByHand(items: Array<Doc<"ingestionItems">>): FinalPdTallies {
  const tallies: FinalPdTallies = {};
  const add = (key: string, tab: "review" | "approved") => {
    tallies[key] ??= { review: 0, approved: 0 };
    tallies[key][tab] += 1;
  };
  for (const row of items) {
    if (row.sheetTab === undefined || row.category !== "final_pd") continue;
    const tab = tabByHand(row.status);
    if (tab === "deleted") continue;
    const year = row.fiscalYearEnd === undefined ? "none" : String(new Date(row.fiscalYearEnd).getUTCFullYear());
    const writer =
      row.writerId ?? (row.writerInitials === undefined && (row.initialsGroups?.length ?? 0) >= 3 ? "unsorted" : "none");
    add("total|all", tab);
    add(`year|${year}`, tab);
    add(`writer|${writer}`, tab);
  }
  return tallies;
}

/** The stored final PD counts, one entry per row (a total row at zero included only when it has counts). */
async function storedFinalPdCounts(t: T): Promise<FinalPdTallies> {
  const rows = await t.run((ctx) => ctx.db.query("importFinalPdCounts").collect());
  const stored: FinalPdTallies = {};
  for (const row of rows) {
    const key = `${row.kind}|${row.key}`;
    expect(stored[key], `one row per final PD count: ${key}`).toBeUndefined();
    if (row.kind === "writer" && row.key !== "none" && row.key !== "unsorted") expect(row.writerId, key).toBe(row.key);
    if (row.kind === "total" && row.review === 0 && row.approved === 0) continue;
    expect(row.review + row.approved, `${key} has counts`).toBeGreaterThan(0);
    stored[key] = { review: row.review, approved: row.approved };
  }
  return stored;
}

async function expectFinalPdCountsMatchRecount(t: T, items: Array<Doc<"ingestionItems">>, label: string) {
  expect(await storedFinalPdCounts(t), `${label}: final PD counts`).toEqual(finalPdRecountByHand(items));
}

/**
 * Run the final PD counts rebuild to its end, page by page, by calling each
 * next run it scheduled (other scheduled work is left waiting). Returns the
 * runs made and whether the last one wrote.
 */
async function driveFinalPdRebuild(
  t: T,
  args: { pageSize: number },
  between?: (run: number) => Promise<void>
): Promise<{ runs: number; written: boolean }> {
  const seen = new Set<string>();
  const pending = async () =>
    (await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).filter(
      (job) => job.name.includes("rebuildImportFinalPdCounts") && job.state.kind === "pending" && !seen.has(job._id)
    );
  for (const job of await pending()) seen.add(job._id);
  let runs = 1;
  let result = await t.mutation(internal.ingestion.rebuildImportFinalPdCounts, args);
  while (!result.done) {
    await between?.(runs);
    const [next, ...others] = await pending();
    expect(others, "a rebuild schedules one next run").toEqual([]);
    seen.add(next._id);
    runs += 1;
    result = await t.mutation(internal.ingestion.rebuildImportFinalPdCounts, next.args[0] as never);
  }
  return { runs, written: result.written };
}

/**
 * Each writer's file count (2026-11-16) is the number of import files that
 * point at it, counted here by hand on every tab; every file's writer is
 * there, and a file not approved has a writer's name with it.
 */
async function expectWriterCountsMatchRecount(t: T, items: Array<Doc<"ingestionItems">>, label: string) {
  const writers = await t.run((ctx) => ctx.db.query("pdWriters").collect());
  const byHand = new Map<string, number>();
  for (const item of items) {
    if (item.writerId === undefined) continue;
    byHand.set(item.writerId, (byHand.get(item.writerId) ?? 0) + 1);
    expect(writers.some((writer) => writer._id === item.writerId), `${label}: ${item.path} writer is there`).toBe(true);
    // An approved file given its writer by the backfill keeps the stored name it had (maybe none).
    if (item.status !== "approved") expect(item.writerName, `${label}: ${item.path} writer name`).toBeTruthy();
  }
  // 2026-11-17: the files that name it as their reviewer, and the files that
  // remember it (as writer or reviewer) from before a pick, by hand too.
  const reviewedByHand = new Map<string, number>();
  const heldByHand = new Map<string, number>();
  const bump = (map: Map<string, number>, id: string | undefined) => {
    if (id !== undefined) map.set(id, (map.get(id) ?? 0) + 1);
  };
  for (const item of items) {
    bump(reviewedByHand, item.reviewerId);
    bump(heldByHand, item.writerBeforePick?.writerId);
    bump(heldByHand, item.reviewerBeforePick?.reviewerId);
    if (item.reviewerId !== undefined) {
      expect(writers.some((writer) => writer._id === item.reviewerId), `${label}: ${item.path} reviewer is there`).toBe(true);
    }
    for (const held of [item.writerBeforePick?.writerId, item.reviewerBeforePick?.reviewerId]) {
      if (held !== undefined) expect(writers.some((writer) => writer._id === held), `${label}: ${item.path} remembered writer is there`).toBe(true);
    }
  }
  for (const writer of writers) {
    const who = writer.name ?? writer.initials ?? writer.userId;
    expect(writer.fileCount, `${label}: files of writer ${who}`).toBe(byHand.get(writer._id) ?? 0);
    expect(writer.reviewCount ?? 0, `${label}: files reviewed by ${who}`).toBe(reviewedByHand.get(writer._id) ?? 0);
    expect(writer.heldCount ?? 0, `${label}: files remembering ${who}`).toBe(heldByHand.get(writer._id) ?? 0);
  }
}

/** The random run's seed: fixed, and printed when the run fails, so it can be replayed. */
const RANDOM_SEED = 20261111;

/** A small seeded random number generator, so a failing run can be replayed. */
function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let x = state;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const RANDOM_PATHS = [
  `${CEDARLINE_FY}/To be submitted/${PD_NAME}`,
  `${CEDARLINE_FY}/WIP/Technical/Audio/interview.txt`,
  // Reviewer initials too (2026-11-17): DW reviewed this draft, PN the Halden PD.
  `${CEDARLINE_FY}/Drafts/03 CedarlineSystems 2025-03-31 R2.PN.DW SensorDraft.docx`,
  "Cedarline Systems/2024 - Dec 31/In Review/notes.docx",
  // Same company key as Cedarline Systems, written another way.
  "cedarline  systems/2024/Financials/budget.pdf",
  "Cedarline Systems/glossary.docx",
  "Halden Foods/2025 - Jun 30/Submitted/02 HaldenFoods 2025-06-30 S1.SO.PN Fermentation.docx",
  "Halden Foods/FY2023/Audio/call.vtt",
  "Northgate Labs/Contracts/nda.pdf",
  "Northgate Labs/2024 - Sep 30/To be submitted/pd.docx",
  "Brightwell Dairy/2025/Drafts/plan.docx",
  "loose.docx",
  // Three initials groups (writer.reviewer.client): unpacked positionally since 2026-11-23.
  "Halden Foods/2025 - Jun 30/To be submitted/05 HaldenFoods 2025-06-30 T0.SO.PN.KT Brining.docx",
];

const LABEL_PATCHES = [
  { company: "Halden Foods" },
  { company: "Brightwell Dairy" },
  { company: "cedarline systems" },
  { category: "final_pd" as const },
  { category: "company_file" as const },
  { category: "transcript" as const },
  { category: "unknown" as const },
  { fiscalYearEnd: Date.UTC(2023, 5, 30) },
  { pdNumber: "9" },
  { version: { code: "R" as const, number: 1 } },
  { writerName: "Priya Nair" },
  { writer: { kind: "name" as const, name: "Sam Okafor" } },
  { scienceCode: "2.02.09" },
  { company: "Northgate Labs", category: "draft" as const, fiscalYearEnd: Date.UTC(2025, 8, 30) },
];

describe("importCompanies counts", () => {
  it("equal a fresh recount after every step of a long random run of the real mutations", async () => {
    // Approval schedules the Brain's embedding; fake timers keep it from running.
    vi.useFakeTimers();
    vi.stubEnv("VOYAGE_API_KEY", "test-voyage-key");
    try {
      const { t, admin } = await setup();
      t.registerComponent("embedPool", workpoolSchema, workpoolModules);
      const rand = seeded(RANDOM_SEED);
      const pick = <X>(list: readonly X[]): X => list[Math.floor(rand() * list.length)];
      const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["bytes"])));
      const driveIds: string[] = [];
      let hashes = 0;
      // Who each read text says wrote it (2026-11-16): for each file's
      // initials in turn, without drawing more randoms, so a past writer the
      // check made may take a name from a PD, or lose it when PDs disagree,
      // under the same recount after every step.
      const namesRead: Record<string, string[][]> = {
        DW: [["Dana Whitlock"], ["Dana Whitlock", "Priya Nair"], ["Dan Wells"], []],
        PN: [["Priya Nair"], ["Priya Nair"], ["Pat Nolan"]],
        SO: [["Sam Okafor"]],
      };
      const reads = new Map<string, number>();
      const namesFor = (initials: string | undefined) => {
        const list = namesRead[initials ?? ""] ?? [["Kim Tran"]];
        const n = reads.get(initials ?? "") ?? 0;
        reads.set(initials ?? "", n + 1);
        return list[n % list.length];
      };
      const rows = async () => await t.run((ctx) => ctx.db.query("ingestionItems").collect());
      const withStatus = async (...statuses: Array<Doc<"ingestionItems">["status"]>) =>
        (await rows()).filter((row) => statuses.includes(row.status));

      /** Writer steps that changed something (2026-11-16), so the run is known to reach them. */
      const writerSteps = { linked: 0, unlinked: 0, renamed: 0, undone: 0, reviewersPicked: 0, reviewersSet: 0, craSet: 0 };
      const steps: Array<[string, () => Promise<unknown>]> = [
        ["insert", async () => {
          const id = `d${driveIds.length}`;
          driveIds.push(id);
          await t.mutation(internal.ingestion.upsertDiscoveredItem, discoveredArgs(pick(RANDOM_PATHS), { driveItemId: id }));
        }],
        ["batch", async () => {
          const items = [0, 1, 2].map(() => {
            const id = rand() < 0.5 && driveIds.length > 0 ? pick(driveIds) : `d${driveIds.push(`d${driveIds.length}`) - 1}`;
            return discoveredArgs(pick(RANDOM_PATHS), { driveItemId: id, contentHash: rand() < 0.3 ? `h${hashes++}` : "hash-1" });
          });
          // One drive id once per batch, as a Graph page has it.
          const unique = [...new Map(items.map((item) => [item.driveItemId, item])).values()];
          await t.mutation(internal.ingestion.upsertDiscoveredBatch, { items: unique });
        }],
        ["move", async () => {
          if (driveIds.length === 0) return;
          const id = pick(driveIds);
          const row = (await rows()).find((r) => r.driveItemId === id);
          await t.mutation(
            internal.ingestion.upsertDiscoveredItem,
            discoveredArgs(pick(RANDOM_PATHS), { driveItemId: id, contentHash: row?.contentHash ?? "hash-1" })
          );
        }],
        ["new bytes", async () => {
          if (driveIds.length === 0) return;
          await t.mutation(
            internal.ingestion.upsertDiscoveredItem,
            discoveredArgs(pick(RANDOM_PATHS), { driveItemId: pick(driveIds), contentHash: `h${hashes++}` })
          );
        }],
        ["attach", async () => {
          const candidates = await withStatus("discovered");
          if (candidates.length === 0) return;
          await t.mutation(internal.ingestion.attachUpload, { itemId: pick(candidates)._id, storageId });
        }],
        ["process", async () => {
          const candidates = await withStatus("discovered", "fetched");
          if (candidates.length === 0) return;
          const scan = rand() < 0.25;
          const chosen = pick(candidates);
          await t.mutation(internal.ingestion.markItemProcessed, {
            itemId: chosen._id,
            storageId,
            // A scan is read with a note and no text.
            ...(scan
              ? { extractNote: "The PDF has no text layer; a scan needs OCR." }
              : { text: "Field of science or technology: 2.02.09" }),
            ...(!scan && rand() < 0.5 ? { documentScienceCode: "2.02.09" } : {}),
            ...(scan ? {} : { documentWriterNames: namesFor(chosen.writerInitials) }),
          });
        }],
        ["fail", async () => {
          const candidates = await withStatus("discovered", "fetched", "pending_review");
          if (candidates.length === 0) return;
          await t.mutation(internal.ingestion.markItemFailed, { itemId: pick(candidates)._id, error: "Could not read" });
        }],
        ["approve", async () => {
          const candidates = await withStatus("pending_review");
          if (candidates.length === 0) return;
          // Files that are not ready are left on To review, as on the page.
          await approveForTest(t, admin, pick(candidates)._id, { mayRefuse: true });
        }],
        ["approve a final PD", async () => {
          // 2026-11-17 (the progress counts): a person gives a final PD on
          // To review what it lacks (a science code, a writer), then approves it.
          const candidates = (await withStatus("pending_review")).filter((row) => row.category === "final_pd");
          if (candidates.length === 0) return;
          const chosen = pick(candidates);
          if (!chosen.scienceCode) await admin.mutation(api.ingestion.setSheetLabels, { ids: [chosen._id], patch: { scienceCode: "2.02.09" } });
          if (!chosen.writerId) {
            await admin.mutation(api.ingestion.setSheetLabels, { ids: [chosen._id], patch: { writer: { kind: "name" as const, name: "Sam Okafor" } } });
          }
          await approveForTest(t, admin, chosen._id, { mayRefuse: true });
        }],
        ["reject", async () => {
          const candidates = await withStatus("discovered", "fetched", "pending_review", "failed", "rejected");
          if (candidates.length === 0) return;
          await admin.mutation(api.ingestion.rejectItem, { itemId: pick(candidates)._id, note: "Not needed" });
        }],
        ["delete", async () => {
          const candidates = await withStatus("pending_review", "rejected", "failed");
          if (candidates.length === 0) return;
          await admin.mutation(api.ingestion.removeItem, { itemId: pick(candidates)._id });
        }],
        ["restore", async () => {
          const candidates = await withStatus("deleted");
          if (candidates.length === 0) return;
          await admin.mutation(api.ingestion.restoreItem, { itemId: pick(candidates)._id });
        }],
        ["removed in OneDrive", async () => {
          if (driveIds.length === 0) return;
          await t.mutation(internal.ingestion.markDriveItemRemoved, { driveItemId: pick(driveIds) });
        }],
        ["old row", async () => {
          // A row staged before the sheet fields existed: not counted until written.
          const id = `d${driveIds.length}`;
          driveIds.push(id);
          const args = discoveredArgs(pick(RANDOM_PATHS), { driveItemId: id });
          await t.run((ctx) => ctx.db.insert("ingestionItems", { ...args, status: "pending_review", text: "Old", updatedAt: 1 }));
        }],
        ["backfill", async () => {
          await t.mutation(internal.ingestion.backfillIngestionLabels, { batchSize: 200 });
        }],
        ["label edit", async () => {
          const all = await rows();
          if (all.length === 0) return;
          const chosen = [...new Set([pick(all), pick(all), pick(all)].slice(0, 1 + Math.floor(rand() * 3)))];
          const patch = pick(LABEL_PATCHES);
          const result = await admin.mutation(api.ingestion.setSheetLabels, { ids: chosen.map((row) => row._id), patch });
          // Each file not on To review, or that takes none of the labels, is skipped and named.
          expect(result.skipped).toEqual(
            chosen.flatMap((row) => {
              if (tabByHand(row.status) !== "review") return [{ id: row._id, reason: "not_on_tab" }];
              const { _id, _creationTime, ...stored } = row;
              const category = row.category ?? settleItem(stored).category!;
              const goes = Object.keys(patch).some((label) => labelGoesOnByHand(label, row, patch.category ?? category));
              return goes ? [] : [{ id: row._id, reason: "does_not_apply" }];
            })
          );
          expect(result.changed).toBe(result.changedIds.length);
        }],
        ["match initials", async () => {
          // A person says who some initials are, or an Undo takes the pick away (2026-11-12, 2026-11-16).
          const initials = pick(["DW", "PN", "SO"]);
          const users = await t.run((ctx) => ctx.db.query("users").collect());
          const writer = pick([
            { kind: "name" as const, name: "Dana Whitlock" },
            { kind: "name" as const, name: "Priya Nair" },
            { kind: "user" as const, userId: pick(users)._id },
            null,
          ]);
          await admin.mutation(api.ingestion.matchWriterInitials, { initials, writer });
          // The rest of the walk, as the scheduler runs it.
          await runWriterWalk(t);
        }],
        ["pick and Undo", async () => {
          // A person picks a writer for some initials over files that already had
          // different writers, then Undo (2026-11-16): every file is exactly as it was.
          const initials = pick(["DW", "PN", "SO"]);
          const users = await t.run((ctx) => ctx.db.query("users").collect());
          const before = await writerState(t);
          const choice = pick([
            { kind: "name" as const, name: "Jordan Ellis" },
            { kind: "user" as const, userId: pick(users)._id },
          ]);
          const result = await admin.mutation(api.ingestion.matchWriterInitials, { initials, writer: choice });
          await runWriterWalk(t);
          // The pick named a person: files with the initials as their reviewer's follow it too (2026-11-17).
          if ((await rows()).some((row) => row.reviewerSource === "pick" && row.reviewerInitials === initials)) writerSteps.reviewersPicked += 1;
          await admin.mutation(api.ingestion.matchWriterInitials, { initials, writer: result.previous });
          await runWriterWalk(t);
          expect(await writerState(t)).toEqual(before);
          writerSteps.undone += 1;
        }],
        ["link a past writer", async () => {
          // An Admin links a past writer to a member (2026-11-16): no file and no pick changes writer.
          const writers = await t.run((ctx) => ctx.db.query("pdWriters").collect());
          const users = await t.run((ctx) => ctx.db.query("users").collect());
          const past = writers.filter((writer) => !writer.userId);
          const free = users.filter((user) => !writers.some((writer) => writer.userId === user._id && writer.linkedAt !== undefined));
          if (past.length === 0 || free.length === 0) return;
          const before = await writerPointers(t);
          await admin.mutation(api.users.linkPastWriter, { writerId: pick(past)._id, userId: pick(free)._id });
          await runWriterWalk(t);
          expect(await writerPointers(t)).toEqual(before);
          writerSteps.linked += 1;
        }],
        ["unlink a past writer", async () => {
          const linked = (await t.run((ctx) => ctx.db.query("pdWriters").collect())).filter((writer) => writer.linkedAt !== undefined);
          if (linked.length === 0) return;
          const before = await writerPointers(t);
          await admin.mutation(api.users.unlinkPastWriter, { writerId: pick(linked)._id });
          await runWriterWalk(t);
          expect(await writerPointers(t)).toEqual(before);
          writerSteps.unlinked += 1;
        }],
        ["rename a past writer", async () => {
          const past = (await t.run((ctx) => ctx.db.query("pdWriters").collect())).filter((writer) => !writer.userId);
          if (past.length === 0) return;
          const writer = pick(past);
          const name = writer.initials ? pick(["Priya Nair", "Jordan Ellis", ""]) : pick(["Priya Nair", "Jordan Ellis"]);
          await admin.mutation(api.users.renamePastWriter, { writerId: writer._id, name });
          await runWriterWalk(t);
          writerSteps.renamed += 1;
        }],
        ["member initials", async () => {
          // An Admin changes a team member's saved initials (2026-11-16): files with the old and new ones are checked again.
          const users = await t.run((ctx) => ctx.db.query("users").collect());
          await admin.mutation(api.users.setUserInitials, { userId: pick(users)._id, initials: pick(["DW", "PN", "SO", ""]) });
          await runWriterWalk(t);
        }],
        ["set reviewer", async () => {
          // A person sets the reviewer of some files alone (2026-11-17): it wins for them.
          const all = await rows();
          if (all.length === 0) return;
          const chosen = [...new Set([pick(all), pick(all)])];
          const users = await t.run((ctx) => ctx.db.query("users").collect());
          const reviewer = pick([
            { kind: "name" as const, name: "Priya Nair" },
            { kind: "user" as const, userId: pick(users)._id },
          ]);
          const result = await admin.mutation(api.ingestion.setFileReviewers, { ids: chosen.map((row) => row._id), reviewer });
          for (const row of chosen) {
            const takes = reviewerGoesOnByHand(row);
            expect(result.skipped.some((entry) => entry.id === row._id), `${row.path} skipped`).toBe(!takes);
            if (takes) expect((await getItem(t, row._id)).reviewerSource).toBe("person");
          }
          if (result.changed > 0) writerSteps.reviewersSet += 1;
        }],
        ["reviewed by CRA", async () => {
          const all = await rows();
          if (all.length === 0) return;
          // Mostly final PDs, so the mark is set along the way; any file at times, which is skipped.
          const finals = all.filter((row) => row.category === "final_pd");
          const row = pick(finals.length > 0 && rand() < 0.8 ? finals : all);
          const result = await admin.mutation(api.ingestion.setCraReviewed, { ids: [row._id], reviewed: rand() < 0.7 });
          const takes = row.category === "final_pd" && reviewerGoesOnByHand(row);
          expect(result.skipped.length, row.path).toBe(takes ? 0 : 1);
          if (result.changed > 0) writerSteps.craSet += 1;
        }],
        ["delete many", async () => {
          const all = await rows();
          if (all.length === 0) return;
          const chosen = [...new Set([pick(all), pick(all), pick(all)])];
          const result = await admin.mutation(api.ingestion.removeItems, { ids: chosen.map((row) => row._id) });
          const skipBy: Record<string, string> = { approved: "approved", deleted: "already_deleted", discovered: "being_read", fetched: "being_read" };
          expect(result.skipped).toEqual(chosen.filter((row) => skipBy[row.status]).map((row) => ({ id: row._id, reason: skipBy[row.status] })));
          expect(result.changedIds).toEqual(chosen.filter((row) => !skipBy[row.status]).map((row) => row._id));
        }],
        ["put back many", async () => {
          const candidates = await withStatus("deleted", "rejected", "pending_review");
          if (candidates.length === 0) return;
          const chosen = [...new Set([pick(candidates), pick(candidates)])];
          const result = await admin.mutation(api.ingestion.restoreItems, { ids: chosen.map((row) => row._id) });
          const skip = (row: Doc<"ingestionItems">) =>
            row.status === "pending_review" ? "not_on_tab" : row.reviewNote === "Deleted in OneDrive" ? "removed_in_onedrive" : null;
          expect(result.skipped).toEqual(chosen.filter(skip).map((row) => ({ id: row._id, reason: skip(row) })));
          for (const id of result.changedIds) expect(tabByHand((await getItem(t, id)).status)).toBe("review");
        }],
      ];

      const used = new Set<string>();
      const statusesSeen = new Set<string>();
      const bandsSeen = new Set<string>();
      const reasonsSeen = new Set<string>();
      const finalPdKeysSeen = new Set<string>();
      let twoReasonsSeen = false;
      for (let step = 0; step < 400; step++) {
        const [name, run] = pick(steps);
        used.add(name);
        try {
          await run();
          await expectCountsMatchRecount(t, `seed ${RANDOM_SEED}, step ${step}: ${name}`);
        } catch (error) {
          console.error(`The random run failed with seed ${RANDOM_SEED} at step ${step} (${name}).`);
          throw error;
        }
        for (const row of await rows()) {
          statusesSeen.add(row.status);
          for (const reason of row.checkReasons ?? []) reasonsSeen.add(reason);
          if ((row.checkReasons?.length ?? 0) >= 2) twoReasonsSeen = true;
        }
        for (const key of Object.keys((await countsNowAndRecount(t)).stored)) bandsSeen.add(key);
        for (const [key, counts] of Object.entries(await storedFinalPdCounts(t))) {
          if (key === "total|all") {
            if (counts.review > 0) finalPdKeysSeen.add("review");
            if (counts.approved > 0) finalPdKeysSeen.add("approved");
          } else if (key.startsWith("writer|")) {
            finalPdKeysSeen.add(key === "writer|none" || key === "writer|unsorted" ? key : "writer|id");
          }
        }
      }
      // Past writers were linked, unlinked and renamed along the way.
      expect(writerSteps.linked).toBeGreaterThan(0);
      expect(writerSteps.unlinked).toBeGreaterThan(0);
      expect(writerSteps.renamed).toBeGreaterThan(0);
      expect(writerSteps.undone).toBeGreaterThan(0);
      // Reviewers followed a pick and were set by a person; CRA marks were set (2026-11-17).
      expect(writerSteps.reviewersPicked).toBeGreaterThan(0);
      expect(writerSteps.reviewersSet).toBeGreaterThan(0);
      expect(writerSteps.craSet).toBeGreaterThan(0);
      // Some file needed a check for two reasons at once, and some read file gave no text.
      expect(twoReasonsSeen).toBe(true);
      expect(reasonsSeen.has("no_text")).toBe(true);
      // The run reached every kind of step, every status, every tab and the
      // no-company band.
      expect(used.size).toBe(steps.length);
      expect([...statusesSeen].sort()).toEqual(
        ["approved", "deleted", "discovered", "failed", "fetched", "pending_review", "rejected"]
      );
      for (const tab of ["review", "approved", "deleted"]) {
        expect([...bandsSeen].some((key) => key.startsWith(`${tab}|`)), tab).toBe(true);
      }
      expect(bandsSeen.has("review|")).toBe(true);

      // A rebuild of every band, in pages of two files, changes nothing. (Two,
      // not three: with Approve's chain and the reviewer steps in the run, its
      // biggest band at the end holds six files.)
      const { stored } = await countsNowAndRecount(t);
      let pagedBands = 0;
      for (const key of Object.keys(stored)) {
        const [sheetTab, companyKey] = key.split("|") as ["review" | "approved" | "deleted", string];
        const pages = await driveRebuild(t, { sheetTab, companyKey, pageSize: 2 });
        expect(pages, key).toBeGreaterThanOrEqual(Math.ceil(stored[key].total / 2));
        if (pages > 2) pagedBands += 1;
      }
      expect(pagedBands, "some bands needed several pages").toBeGreaterThan(0);
      expect((await countsNowAndRecount(t)).stored).toEqual(stored);

      // The final PD progress counts (2026-11-17) reached both tabs, a
      // writer, and no writer yet along the way; a rebuild in pages of two
      // files changes nothing.
      expect(finalPdKeysSeen.has("review"), "a final PD on To review").toBe(true);
      expect(finalPdKeysSeen.has("approved"), "an approved final PD").toBe(true);
      expect(finalPdKeysSeen.has("writer|none"), "a final PD with no writer yet").toBe(true);
      expect(finalPdKeysSeen.has("writer|id"), "a final PD with a writer").toBe(true);
      const progressBefore = await storedFinalPdCounts(t);
      const rebuilt = await driveFinalPdRebuild(t, { pageSize: 2 });
      expect(rebuilt.written).toBe(true);
      expect(rebuilt.runs).toBeGreaterThan(2);
      expect(await storedFinalPdCounts(t)).toEqual(progressBefore);
    } finally {
      vi.unstubAllEnvs();
      vi.useRealTimers();
    }
    // 400 steps since 2026-11-17 (the progress counts' own step), each with a full recount.
  }, 90_000);

  it("moves a file's share between two company bands, and drops a band at zero", async () => {
    const t = convexTest(schema, modules);
    const id = await stage(t, `${CEDARLINE_FY}/Drafts/notes.docx`, { driveItemId: "notes" });
    let { stored } = await countsNowAndRecount(t);
    expect(Object.keys(stored)).toEqual(["review|cedarline systems"]);
    expect(stored["review|cedarline systems"]).toMatchObject({ total: 1, beingRead: 1, ready: 0 });

    await t.mutation(
      internal.ingestion.upsertDiscoveredItem,
      discoveredArgs("Halden Foods/2025 - Jun 30/Drafts/notes.docx", { driveItemId: "notes" })
    );
    ({ stored } = await countsNowAndRecount(t));
    expect(Object.keys(stored)).toEqual(["review|halden foods"]);
    // Still being read: under Not sorted yet ("unknown"), and New.
    expect(stored["review|halden foods"].categories).toEqual({
      unknown: { total: 1, needsCheck: 0, fiscalYears: { "2025": 1 }, newFiles: 1, newFiscalYears: { "2025": 1 } },
    });
    await markRead(t, id);
    ({ stored } = await countsNowAndRecount(t));
    expect(stored["review|halden foods"]).toMatchObject({ total: 1, beingRead: 0, ready: 1, needsCheck: 0, newFiles: 1 });
    // Read: in its own section.
    expect(stored["review|halden foods"].categories).toEqual({
      draft: { total: 1, needsCheck: 0, fiscalYears: { "2025": 1 }, newFiles: 1, newFiscalYears: { "2025": 1 } },
    });
  });

  it("keeps rows with no company in the band with an empty key", async () => {
    const t = convexTest(schema, modules);
    await stage(t, "loose.docx");
    const { bands } = await countsNowAndRecount(t);
    expect(bands).toHaveLength(1);
    expect(bands[0]).toMatchObject({
      sheetTab: "review",
      companyKey: "",
      displayName: "",
      total: 1,
      // Still being read, so not flagged yet (it is once reading ends).
      needsCheck: 0,
      hasCheck: false,
      beingRead: 1,
      categories: { unknown: { total: 1, needsCheck: 0, fiscalYears: { none: 1 } } },
    });
  });

  it("counts old rows into their bands when the backfill settles them", async () => {
    const t = convexTest(schema, modules);
    for (const path of RANDOM_PATHS.slice(0, 6)) {
      const args = discoveredArgs(path);
      await t.run((ctx) => ctx.db.insert("ingestionItems", { ...args, status: "pending_review", updatedAt: 1 }));
    }
    expect((await countsNowAndRecount(t)).bands).toHaveLength(0);
    await t.mutation(internal.ingestion.backfillIngestionLabels, {});
    const { bands } = await countsNowAndRecount(t);
    expect(bands.map((band) => band.companyKey)).toEqual(["cedarline systems"]);
    expect(bands[0].total).toBe(6);
    await expectCountsMatchRecount(t, "after backfill");
  });
});

describe("rebuildImportCompanyCounts", () => {
  async function corrupt(t: T, companyKey: string) {
    await t.run(async (ctx) => {
      const band = await ctx.db
        .query("importCompanies")
        .withIndex("by_sheetTab_and_companyKey", (q) => q.eq("sheetTab", "review").eq("companyKey", companyKey))
        .unique();
      await ctx.db.patch(band!._id, { total: 99, ready: 0, categories: {} });
    });
  }

  it("rebuilds a wrong band page by page", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema, modules);
      for (let i = 0; i < 7; i++) await stage(t, `${CEDARLINE_FY}/Financials/sheet ${i}.pdf`);
      const { stored: right } = await countsNowAndRecount(t);
      await corrupt(t, "cedarline systems");
      const first = await t.mutation(internal.ingestion.rebuildImportCompanyCounts, {
        sheetTab: "review",
        companyKey: "cedarline systems",
        pageSize: 3,
      });
      expect(first).toEqual({ scanned: 3, done: false, written: false });
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      expect((await countsNowAndRecount(t)).stored).toEqual(right);
      const jobs = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
      expect(jobs.filter((job) => job.name.includes("rebuildImportCompanyCounts")).every((job) => job.state.kind === "success")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("starts again when a file changes the band between pages", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema, modules);
      for (let i = 0; i < 4; i++) await stage(t, `${CEDARLINE_FY}/Financials/sheet ${i}.pdf`);
      await corrupt(t, "cedarline systems");
      await t.mutation(internal.ingestion.rebuildImportCompanyCounts, {
        sheetTab: "review",
        companyKey: "cedarline systems",
        pageSize: 2,
      });
      // A new file lands on the page already read.
      await stage(t, `${CEDARLINE_FY}/Financials/late.pdf`);
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      await expectCountsMatchRecount(t, "after a restarted rebuild");
      const runs = (await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).filter((job) =>
        job.name.includes("rebuildImportCompanyCounts")
      );
      // Page two, then a restart from the top (two pages of five files, plus the last).
      expect(runs.length).toBeGreaterThanOrEqual(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("deletes a band that has no files, and builds a missing one", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) =>
      ctx.db.insert("importCompanies", {
        sheetTab: "approved",
        companyKey: "northgate labs",
        displayName: "Northgate Labs",
        total: 3,
        needsCheck: 0,
        ready: 3,
        beingRead: 0,
        categories: {},
        hasCheck: false,
        revision: 1,
        updatedAt: 1,
      })
    );
    await t.mutation(internal.ingestion.rebuildImportCompanyCounts, { sheetTab: "approved", companyKey: "northgate labs" });
    expect((await countsNowAndRecount(t)).bands).toHaveLength(0);

    await stage(t, "Halden Foods/glossary.docx");
    await t.run(async (ctx) => {
      for (const band of await ctx.db.query("importCompanies").collect()) await ctx.db.delete(band._id);
    });
    await expect(
      t.mutation(internal.ingestion.rebuildImportCompanyCounts, { sheetTab: "review", companyKey: "halden foods" })
    ).resolves.toEqual({ scanned: 1, done: true, written: true });
    await expectCountsMatchRecount(t, "after building a missing band");
    expect((await countsNowAndRecount(t)).bands[0]).toMatchObject({ displayName: "Halden Foods", total: 1 });
  });

  async function bandRow(t: T, sheetTab: "review" | "approved" | "deleted", companyKey: string) {
    return await t.run((ctx) =>
      ctx.db
        .query("importCompanies")
        .withIndex("by_sheetTab_and_companyKey", (q) => q.eq("sheetTab", sheetTab).eq("companyKey", companyKey))
        .unique()
    );
  }

  it("starts again when its band was missing and files moved in and out while it paged", async () => {
    const { t, admin } = await setup();
    for (let i = 0; i < 4; i++) {
      await stage(t, `Halden Foods/2025 - Jun 30/Financials/sheet ${i}.pdf`, { driveItemId: `halden-${i}` });
    }
    await stage(t, `${CEDARLINE_FY}/Financials/incoming.pdf`, { driveItemId: "incoming" });
    // Drift: the Halden Foods band row is gone.
    await t.run(async (ctx) => {
      const band = await ctx.db
        .query("importCompanies")
        .withIndex("by_sheetTab_and_companyKey", (q) => q.eq("sheetTab", "review").eq("companyKey", "halden foods"))
        .unique();
      await ctx.db.delete(band!._id);
    });

    const first = await t.mutation(internal.ingestion.rebuildImportCompanyCounts, {
      sheetTab: "review",
      companyKey: "halden foods",
      pageSize: 2,
    });
    expect(first).toEqual({ scanned: 2, done: false, written: false });
    // The rebuild made a band row to watch, with nothing in it yet; the sheet
    // does not show it (until the rebuild ends, the Halden files are not counted).
    expect(await bandRow(t, "review", "halden foods")).toMatchObject({ total: 0, revision: 1 });
    const bands = await admin.query(api.ingestion.sheetCompanies, { tab: "review", onlyToCheck: false, paginationOpts: PAGE });
    expect(bands.page.map((band) => band.companyKey)).toEqual(["cedarline systems"]);
    expect(await admin.query(api.ingestion.sheetTotals, { tab: "review" })).toMatchObject({ files: 1, companies: 1 });
    expect((await admin.query(api.ingestion.sheetSearch, { tab: "review", text: "Halden" }))!.companies).toEqual([]);

    // While it pages, a file moves in, which makes the band, and a file it
    // already counted moves out, which takes the band back to nothing: the
    // band is gone again at the end, as it was at the start.
    await t.mutation(
      internal.ingestion.upsertDiscoveredItem,
      discoveredArgs("Halden Foods/2025 - Jun 30/Financials/incoming.pdf", { driveItemId: "incoming" })
    );
    await t.mutation(
      internal.ingestion.upsertDiscoveredItem,
      discoveredArgs(`${CEDARLINE_FY}/Financials/sheet 0.pdf`, { driveItemId: "halden-0" })
    );
    expect(await bandRow(t, "review", "halden foods")).toBeNull();

    await runScheduled(t);
    await expectCountsMatchRecount(t, "after the rebuild that raced two moves");
    expect((await countsNowAndRecount(t)).stored["review|halden foods"].total).toBe(4);
    const restarts = (await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).filter(
      (job) =>
        job.name.includes("rebuildImportCompanyCounts") &&
        (job.args[0] as { restarts?: number }).restarts === 1 &&
        (job.args[0] as { cursor?: string }).cursor === undefined
    );
    expect(restarts).toHaveLength(1);
  });

  it("repairs a whole tab: a wrong count, a band with no files and a missing band", async () => {
    const { t, admin } = await setup();
    for (let i = 0; i < 5; i++) await stage(t, `${CEDARLINE_FY}/Financials/sheet ${i}.pdf`);
    for (let i = 0; i < 3; i++) await stage(t, `Halden Foods/2025 - Jun 30/Drafts/plan ${i}.docx`);
    await stage(t, "loose.docx");
    await stage(t, "Brightwell Dairy/glossary.docx");
    // A file on another tab, whose band this tab's repair leaves alone.
    const rejected = await stage(t, "Northgate Labs/2024 - Sep 30/Drafts/notes.docx");
    await markRead(t, rejected);
    await admin.mutation(api.ingestion.rejectItem, { itemId: rejected });
    const { stored: right } = await countsNowAndRecount(t);
    expect(Object.keys(right).sort()).toEqual([
      "deleted|northgate labs",
      "review|",
      "review|brightwell dairy",
      "review|cedarline systems",
      "review|halden foods",
    ]);

    await corrupt(t, "cedarline systems");
    await t.run(async (ctx) => {
      const halden = await ctx.db
        .query("importCompanies")
        .withIndex("by_sheetTab_and_companyKey", (q) => q.eq("sheetTab", "review").eq("companyKey", "halden foods"))
        .unique();
      await ctx.db.delete(halden!._id);
      // Northgate Labs has no file on the review tab.
      await ctx.db.insert("importCompanies", {
        sheetTab: "review",
        companyKey: "northgate labs",
        displayName: "Northgate Labs",
        total: 2,
        needsCheck: 1,
        ready: 1,
        beingRead: 0,
        categories: { draft: { total: 2, needsCheck: 1, fiscalYears: { "2024": 2 } } },
        hasCheck: true,
        revision: 4,
        updatedAt: 1,
      });
    });
    expect((await countsNowAndRecount(t)).stored).not.toEqual(right);

    await expect(
      t.mutation(internal.ingestion.repairImportCompanyTab, { sheetTab: "review", pageSize: 2, rebuildPageSize: 2 })
    ).resolves.toEqual({ rebuilds: 2, removed: 0, done: false });
    await runScheduled(t);
    expect((await countsNowAndRecount(t)).stored).toEqual(right);
    await expectCountsMatchRecount(t, "after the tab repair");

    const jobs = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    const rebuildsOf = (companyKey: string) =>
      jobs.filter(
        (job) => job.name.includes("rebuildImportCompanyCounts") && (job.args[0] as { companyKey: string }).companyKey === companyKey
      );
    // Every company on the tab was rebuilt, and none on another tab.
    for (const key of ["", "brightwell dairy", "cedarline systems", "halden foods"]) {
      expect(rebuildsOf(key).length, key).toBeGreaterThan(0);
    }
    expect(rebuildsOf("northgate labs")).toEqual([]);
    // Two files a page: five Cedarline files took three runs.
    expect(rebuildsOf("cedarline systems").length).toBeGreaterThanOrEqual(3);
    expect(jobs.every((job) => job.state.kind === "success")).toBe(true);
    const repairs = jobs.filter((job) => job.name.includes("repairImportCompanyTab"));
    expect(repairs.map((job) => (job.args[0] as { stage?: string }).stage)).toContain("bands");
  });
});

// ─── Sheet queries ──────────────────────────────────────────────────────────

const PAGE = { numItems: 50, cursor: null };

async function seedSheet(t: T) {
  const ids = {
    pd4: await stage(t, `${CEDARLINE_FY}/To be submitted/${PD_NAME}`),
    pd12: await stage(t, `${CEDARLINE_FY}/To be submitted/12 CedarlineSystems 2025-03-31 R1.DW Valves.docx`),
    pd4r: await stage(t, `${CEDARLINE_FY}/Submitted/04 CedarlineSystems 2025-03-31 R3.DW ColdChain.docx`),
    // A final PD with nothing in its name: no writer, so it needs a check.
    pdBare: await stage(t, `${CEDARLINE_FY}/To be submitted/pd.docx`),
    halden: await stage(t, "Halden Foods/2025 - Jun 30/Drafts/plan.docx"),
    northgate: await stage(t, "Northgate Labs/2024 - Sep 30/In Review/notes.docx"),
    brightwell: await stage(t, "Brightwell Dairy/glossary.docx"),
    loose: await stage(t, "loose.docx"),
  };
  // Plain text with no science code, so every final PD still needs one.
  for (const id of Object.values(ids)) await markRead(t, id);
  return ids;
}

async function seedCompanies(t: T) {
  await t.run(async (ctx) => {
    const userId = (await ctx.db.query("users").first())!._id;
    const base = { createdBy: userId, createdAt: 1, updatedAt: 1 };
    await ctx.db.insert("clients", {
      ...base,
      name: "Cedarline Systems",
      nameKey: "cedarline systems",
      status: "active",
      industry: "Cold chain logistics",
      fiscalYearEndMonth: 3,
      fiscalYearEndDay: 31,
    });
    const kept = await ctx.db.insert("clients", {
      ...base,
      name: "Halden Foods Group",
      nameKey: "halden foods group",
      status: "active",
    });
    await ctx.db.insert("clients", {
      ...base,
      name: "Halden Foods",
      nameKey: "halden foods",
      status: "merged",
      mergedIntoClientId: kept,
      mergedAt: 2,
    });
    await ctx.db.insert("dashboardCompanies", {
      companyKey: "northgate labs",
      clientName: "Northgate Labs",
      projectCount: 2,
      updatedAt: 1,
    });
  });
}

describe("sheet queries", () => {
  it("sums the tab totals from the bands", async () => {
    const { t, admin, writer } = await setup();
    await seedSheet(t);
    await stage(t, "Halden Foods/2025 - Jun 30/Drafts/still reading.docx");
    expect(await admin.query(api.ingestion.sheetTotals, { tab: "review" })).toEqual({
      files: 9,
      companies: 4,
      brainCheck: 0,
      // The four final PDs (no science code) and the loose file.
      needsCheck: 5,
      ready: 3,
      beingRead: 1,
      // Every file just arrived, so every one is New (2026-11-12).
      newFiles: 9,
      complete: true,
    });
    expect(await admin.query(api.ingestion.sheetTotals, { tab: "approved" })).toMatchObject({ files: 0, companies: 0 });
    expect(await writer.query(api.ingestion.sheetTotals, { tab: "review" })).toBeNull();
  });

  it("lists bands in name order with what the app knows about each company", async () => {
    const { t, admin, writer } = await setup();
    await seedSheet(t);
    await seedCompanies(t);
    const result = await admin.query(api.ingestion.sheetCompanies, { tab: "review", onlyToCheck: false, paginationOpts: PAGE });
    expect(result.isDone).toBe(true);
    expect(result.page.map((band) => band.companyKey)).toEqual([
      "",
      "brightwell dairy",
      "cedarline systems",
      "halden foods",
      "northgate labs",
    ]);
    const byKey = Object.fromEntries(result.page.map((band) => [band.companyKey, band]));
    expect(byKey[""]).toMatchObject({ displayName: "", company: null, isNew: false, needsCheck: 1 });
    expect(byKey["brightwell dairy"]).toMatchObject({ displayName: "Brightwell Dairy", company: null, isNew: true });
    expect(byKey["cedarline systems"]).toMatchObject({
      displayName: "Cedarline Systems",
      total: 4,
      needsCheck: 4,
      ready: 0,
      isNew: false,
      company: {
        via: "name",
        name: "Cedarline Systems",
        industry: "Cold chain logistics",
        fiscalYearEndMonth: 3,
        fiscalYearEndDay: 31,
      },
      categories: { final_pd: { total: 4, needsCheck: 4, fiscalYears: { "2025": 4 } } },
    });
    expect(byKey["halden foods"]).toMatchObject({ isNew: false, company: { via: "merge", name: "Halden Foods Group" } });
    expect(byKey["northgate labs"]).toMatchObject({ isNew: false, company: { via: "projects", name: "Northgate Labs" } });
    expect(byKey["northgate labs"].company!.clientId).toBeUndefined();

    const toCheck = await admin.query(api.ingestion.sheetCompanies, { tab: "review", onlyToCheck: true, paginationOpts: PAGE });
    expect(toCheck.page.map((band) => band.companyKey)).toEqual(["", "cedarline systems"]);

    const first = await admin.query(api.ingestion.sheetCompanies, {
      tab: "review",
      onlyToCheck: false,
      paginationOpts: { numItems: 2, cursor: null },
    });
    expect(first.page).toHaveLength(2);
    expect(first.isDone).toBe(false);
    const second = await admin.query(api.ingestion.sheetCompanies, {
      tab: "review",
      onlyToCheck: false,
      paginationOpts: { numItems: 50, cursor: first.continueCursor },
    });
    expect(second.page.map((band) => band.companyKey)).toEqual(["cedarline systems", "halden foods", "northgate labs"]);

    expect(await writer.query(api.ingestion.sheetCompanies, { tab: "review", onlyToCheck: false, paginationOpts: PAGE })).toEqual({
      page: [],
      isDone: true,
      continueCursor: "",
    });
  });

  it("lists one section's files in sort order as slim rows", async () => {
    const { t, admin, writer } = await setup();
    const ids = await seedSheet(t);
    const result = await admin.query(api.ingestion.sheetFiles, {
      tab: "review",
      companyKey: "cedarline systems",
      category: "final_pd",
      onlyToCheck: false,
      paginationOpts: PAGE,
    });
    expect(result.page.map((row) => row._id)).toEqual([ids.pd4r, ids.pd4, ids.pd12, ids.pdBare]);
    const pd4 = result.page[1];
    expect(pd4).toEqual({
      _id: ids.pd4,
      name: PD_NAME,
      category: "final_pd",
      status: "pending_review",
      pdNumber: "4",
      pdTitle: "Cold Chain Sensor Drift",
      fiscalYearEnd: Date.UTC(2025, 2, 31),
      fiscalYearEndAssumed: false,
      versionCode: "T",
      versionNumber: 2,
      // No one on the team has the initials DW, so the file's writer is a
      // new writer with no login, just "DW" (2026-11-16).
      writerName: "DW",
      writerNameSource: "initials",
      writerId: expect.any(String),
      writerHasLogin: false,
      writerInitials: "DW",
      reviewerInitials: "PN",
      // Its reviewer comes from PN by the same check (2026-11-17): a new
      // writer with no login, just "PN", and no check reason for it.
      reviewerId: expect.any(String),
      reviewerName: "PN",
      reviewerHasLogin: false,
      reviewerSource: "initials",
      editedLabels: [],
      needsCheck: true,
      checkReasons: ["no_science_code"],
      size: 2048,
      // It arrived in the last 24 hours (2026-11-12).
      isNew: true,
    });
    expect("text" in pd4).toBe(false);

    const toCheck = await admin.query(api.ingestion.sheetFiles, {
      tab: "review",
      companyKey: "cedarline systems",
      category: "final_pd",
      onlyToCheck: true,
      paginationOpts: PAGE,
    });
    expect(toCheck.page.map((row) => [row._id, row.checkReasons])).toEqual([
      [ids.pd4r, ["no_science_code"]],
      [ids.pd4, ["no_science_code"]],
      [ids.pd12, ["no_science_code"]],
      [ids.pdBare, ["no_science_code", "no_writer"]],
    ]);
    // The three DW files share one writer.
    expect(new Set(result.page.slice(0, 3).map((row) => row.writerId)).size).toBe(1);

    const loose = await admin.query(api.ingestion.sheetFiles, {
      tab: "review",
      companyKey: "",
      category: "unknown",
      onlyToCheck: false,
      paginationOpts: PAGE,
    });
    expect(loose.page.map((row) => [row._id, row.checkReasons])).toEqual([[ids.loose, ["no_company", "unknown_category"]]]);

    expect(
      (await writer.query(api.ingestion.sheetFiles, {
        tab: "review",
        companyKey: "cedarline systems",
        category: "final_pd",
        onlyToCheck: false,
        paginationOpts: PAGE,
      })).page
    ).toEqual([]);
  });

  it("lists final PDs newest fiscal year first, so two PD 1 files of different years never sit together", async () => {
    const { t, admin } = await setup();
    const FY2024 = "Cedarline Systems/2024 - Mar 31";
    const ids = {
      pd1Of2025: await stage(t, `${CEDARLINE_FY}/To be submitted/01 CedarlineSystems 2025-03-31 T1.DW LabelVision.docx`),
      pd2Of2025: await stage(t, `${CEDARLINE_FY}/To be submitted/02 CedarlineSystems 2025-03-31 T1.DW Conveyor.docx`),
      pd1Of2024: await stage(t, `${FY2024}/To be submitted/01 CedarlineSystems 2024-03-31 T1.DW Barcode.docx`),
    };
    for (const id of Object.values(ids)) await markRead(t, id);
    const finalPds = async () =>
      (
        await admin.query(api.ingestion.sheetFiles, {
          tab: "review",
          companyKey: "cedarline systems",
          category: "final_pd",
          onlyToCheck: false,
          paginationOpts: PAGE,
        })
      ).page.map((row) => row._id);
    expect(await finalPds()).toEqual([ids.pd1Of2025, ids.pd2Of2025, ids.pd1Of2024]);

    // A new year end moves the row at once: setSheetLabels settles it.
    await admin.mutation(api.ingestion.setSheetLabels, { ids: [ids.pd1Of2024], patch: { fiscalYearEnd: Date.UTC(2026, 2, 31) } });
    expect(await finalPds()).toEqual([ids.pd1Of2024, ids.pd1Of2025, ids.pd2Of2025]);
    expectInvariants(await getItem(t, ids.pd1Of2024));

    // A row stored with the key from before the year led it: the label backfill rewrites it.
    const oldKey = `0001- 10001 ${(await getItem(t, ids.pd2Of2025)).name.toLowerCase()}`;
    await t.run((ctx) => ctx.db.patch(ids.pd2Of2025, { sortKey: oldKey }));
    await t.mutation(internal.ingestion.backfillIngestionLabels, {});
    const rewritten = await getItem(t, ids.pd2Of2025);
    expect(rewritten.sortKey).not.toBe(oldKey);
    expect(rewritten.sortKey!.startsWith("7974 0002- ")).toBe(true);
    expectInvariants(rewritten);
    expect(await finalPds()).toEqual([ids.pd1Of2024, ids.pd1Of2025, ids.pd2Of2025]);
  });

  it("gives each section's check reasons with its band, a file with two counted under both", async () => {
    const { t, admin } = await setup();
    await twoMembersWith(t, "DW");
    const ids = await seedSheet(t);
    const result = await admin.query(api.ingestion.sheetCompanies, { tab: "review", onlyToCheck: false, paginationOpts: PAGE });
    const byKey = Object.fromEntries(result.page.map((band) => [band.companyKey, band]));
    // Four final PDs with no science code; the one with nothing in its name
    // has no writer either, and the three whose name gave "DW" need a person
    // to choose (two team members have the initials DW): four need a
    // check, each counted under its reasons.
    expect(byKey["cedarline systems"].categories.final_pd).toEqual({
      total: 4,
      needsCheck: 4,
      fiscalYears: { "2025": 4 },
      checkReasons: { no_science_code: 4, no_writer: 1, unmatched_initials: 3 },
      newFiles: 4,
      newFiscalYears: { "2025": 4 },
    });
    expect(byKey[""].categories.unknown).toEqual({
      total: 1,
      needsCheck: 1,
      fiscalYears: { none: 1 },
      checkReasons: { no_company: 1, unknown_category: 1 },
      newFiles: 1,
      newFiscalYears: { none: 1 },
    });
    // A section with nothing to check has no reasons at all.
    expect(byKey["halden foods"].categories.draft).toEqual({
      total: 1,
      needsCheck: 0,
      fiscalYears: { "2025": 1 },
      newFiles: 1,
      newFiscalYears: { "2025": 1 },
    });

    // A person fills in the writer: that reason goes, the other stays.
    await admin.mutation(api.ingestion.setSheetLabels, { ids: [ids.pdBare], patch: { writerName: "Sam Okafor" } });
    const after = await admin.query(api.ingestion.sheetCompanies, { tab: "review", onlyToCheck: true, paginationOpts: PAGE });
    const cedarline = after.page.find((band) => band.companyKey === "cedarline systems")!;
    expect(cedarline.categories.final_pd.checkReasons).toEqual({ no_science_code: 4, unmatched_initials: 3 });
    await expectCountsMatchRecount(t, "after a writer was filled in");

    // Off the review tab nothing needs a check, so a rejected PD takes its reasons with it.
    await admin.mutation(api.ingestion.rejectItem, { itemId: ids.pd4, note: "Not needed" });
    const deleted = await admin.query(api.ingestion.sheetCompanies, { tab: "deleted", onlyToCheck: false, paginationOpts: PAGE });
    expect(deleted.page.map((band) => band.categories)).toEqual([
      { final_pd: { total: 1, needsCheck: 0, fiscalYears: { "2025": 1 } } },
    ]);
    const review = await admin.query(api.ingestion.sheetCompanies, { tab: "review", onlyToCheck: false, paginationOpts: PAGE });
    expect(review.page.find((band) => band.companyKey === "cedarline systems")!.categories.final_pd.checkReasons).toEqual({
      no_science_code: 3,
      unmatched_initials: 2,
    });
    await expectCountsMatchRecount(t, "after a reject");
  });

  it("reads a band row from before check reasons as having none, and the tab repair fills them in", async () => {
    const { t, admin } = await setup();
    await twoMembersWith(t, "DW");
    const ids = await seedSheet(t);
    const { stored: right } = await countsNowAndRecount(t);
    // Band rows written before the reasons existed.
    await t.run(async (ctx) => {
      for (const band of await ctx.db.query("importCompanies").collect()) {
        const categories = Object.fromEntries(
          Object.entries(band.categories).map(([name, { checkReasons: _, ...counts }]) => [name, counts])
        );
        await ctx.db.patch(band._id, { categories });
      }
    });
    const before = await admin.query(api.ingestion.sheetCompanies, { tab: "review", onlyToCheck: false, paginationOpts: PAGE });
    const cedarline = before.page.find((band) => band.companyKey === "cedarline systems")!;
    expect(cedarline.categories.final_pd).toEqual({
      total: 4,
      needsCheck: 4,
      fiscalYears: { "2025": 4 },
      newFiles: 4,
      newFiscalYears: { "2025": 4 },
    });

    // A write to such a band takes a reason it never counted below zero:
    // drift, which the helper reports and the repair puts right.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await admin.mutation(api.ingestion.setSheetLabels, { ids: [ids.pdBare], patch: { writerName: "Sam Okafor" } });
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("importCompanies went below zero"),
        expect.objectContaining({ companyKey: "cedarline systems" })
      );
    } finally {
      warn.mockRestore();
    }
    await admin.query(api.ingestion.sheetCompanies, { tab: "review", onlyToCheck: false, paginationOpts: PAGE });

    await t.mutation(internal.ingestion.repairImportCompanyTab, { sheetTab: "review" });
    await runScheduled(t);
    await expectCountsMatchRecount(t, "after the tab repair");
    const { stored } = await countsNowAndRecount(t);
    expect(stored["review|cedarline systems"].categories.final_pd.checkReasons).toEqual({ no_science_code: 4, unmatched_initials: 3 });
    expect(stored["review|"]).toEqual(right["review|"]);
  });

  it("finds files by name on one tab, and bands by name", async () => {
    const { t, admin, writer } = await setup();
    const ids = await seedSheet(t);
    await admin.mutation(api.ingestion.rejectItem, { itemId: ids.halden });
    const found = await admin.query(api.ingestion.sheetSearch, { tab: "review", text: "plan" });
    // The rejected plan is on the deleted tab.
    expect(found!.files).toEqual([]);
    const deleted = await admin.query(api.ingestion.sheetSearch, { tab: "deleted", text: "plan" });
    expect(deleted!.files.map((row) => [row._id, row.companyKey, row.clientName])).toEqual([
      [ids.halden, "halden foods", "Halden Foods"],
    ]);
    const glossary = await admin.query(api.ingestion.sheetSearch, { tab: "review", text: "glossary" });
    expect(glossary!.files.map((row) => row._id)).toEqual([ids.brightwell]);
    expect("text" in glossary!.files[0]).toBe(false);

    const companies = await admin.query(api.ingestion.sheetSearch, { tab: "review", text: "Labs" });
    expect(companies!.companies).toEqual([
      { companyKey: "northgate labs", displayName: "Northgate Labs", total: 1, needsCheck: 0 },
    ]);
    expect(await admin.query(api.ingestion.sheetSearch, { tab: "review", text: "   " })).toEqual({ files: [], companies: [] });
    expect(await writer.query(api.ingestion.sheetSearch, { tab: "review", text: "plan" })).toBeNull();
  });

  it("gives one file's labels for the side panel, without its text", async () => {
    const { t, admin, writer } = await setup();
    const ids = await seedSheet(t);
    const file = await admin.query(api.ingestion.sheetFile, { id: ids.pd4 });
    expect(file).toMatchObject({
      _id: ids.pd4,
      sheetTab: "review",
      companyKey: "cedarline systems",
      clientName: "Cedarline Systems",
      fiscalYearLabel: "2025 - Mar 31",
      path: `${CEDARLINE_FY}/To be submitted/${PD_NAME}`,
      docKind: "pd",
      addedAt: expect.any(Number),
      addedVia: "onedrive_sync",
      lastModifiedAt: 1_700_000_000_000,
      hasText: true,
      hasOriginal: true,
      pdNumber: "4",
    });
    expect("text" in file!).toBe(false);
    expect(await writer.query(api.ingestion.sheetFile, { id: ids.pd4 })).toBeNull();
    await t.run((ctx) => ctx.db.delete(ids.loose));
    expect(await admin.query(api.ingestion.sheetFile, { id: ids.loose })).toBeNull();
  });
});

// ─── Label edits ────────────────────────────────────────────────────────────

describe("setSheetLabels", () => {
  async function oneFinalPd() {
    const f = await setup();
    const id = await stage(f.t, `${CEDARLINE_FY}/To be submitted/${PD_NAME}`, { driveItemId: "pd" });
    await markRead(f.t, id);
    return { ...f, id };
  }

  it("sets each label on its own, marking it as set by a person", async () => {
    const cases: Array<[Record<string, unknown>, Record<string, unknown>]> = [
      [{ company: "Halden Foods" }, { clientName: "Halden Foods", companyKey: "halden foods", editedLabels: ["company"] }],
      [{ category: "draft" }, { category: "draft", docKind: "supporting", editedLabels: ["category"] }],
      [
        { fiscalYearEnd: Date.UTC(2024, 11, 31) },
        {
          fiscalYearEnd: Date.UTC(2024, 11, 31),
          fiscalYearEndAssumed: false,
          fiscalYear: 2024,
          // The folder's label stays as it is; pairing reads the year.
          fiscalYearLabel: "2025 - Mar 31",
          pairGroupKey: "cedarline systems::2024",
          editedLabels: ["fiscalYearEnd"],
          // The row moves with its year: FY 2024 now leads its sort key.
          sortKey: `7975 0004- 20002 ${PD_NAME.toLowerCase()}`,
        },
      ],
      [{ pdNumber: "07" }, { pdNumber: "7", editedLabels: ["pdNumber"] }],
      [{ version: { code: "S", number: 4 } }, { versionCode: "S", versionNumber: 4, editedLabels: ["version"] }],
      [
        { writerName: "Priya Nair" },
        // A writer set on the file is a person's, and wins over the one its initials gave.
        { writerName: "Priya Nair", writerNameSource: "person", checkReasons: ["no_science_code"], editedLabels: ["writerName"] },
      ],
      [
        { scienceCode: "2.02.09" },
        // The code's check goes; "DW" from the file name already gave it a writer (2026-11-16).
        {
          scienceCode: "2.02.09",
          scienceCodeSource: "person",
          needsCheck: false,
          checkReasons: [],
          writerName: "DW",
          writerNameSource: "initials",
          editedLabels: ["scienceCode"],
        },
      ],
    ];
    for (const [patch, expected] of cases) {
      const { admin, t, id } = await oneFinalPd();
      await expect(admin.mutation(api.ingestion.setSheetLabels, { ids: [id], patch })).resolves.toEqual({
        changed: 1,
        changedIds: [id],
        skipped: [],
      });
      const row = await getItem(t, id);
      expect(row, JSON.stringify(patch)).toMatchObject(expected);
      expectInvariants(row);
      await expectCountsMatchRecount(t, JSON.stringify(patch));
    }
  });

  it("sets several labels at once, and a second identical edit changes nothing", async () => {
    const { admin, t, id } = await oneFinalPd();
    const patch = { writerName: "Sam Okafor", scienceCode: "2.02.09", pdNumber: "12a" };
    await expect(admin.mutation(api.ingestion.setSheetLabels, { ids: [id], patch })).resolves.toMatchObject({ changed: 1 });
    const row = await getItem(t, id);
    expect(row).toMatchObject({
      writerName: "Sam Okafor",
      scienceCode: "2.02.09",
      pdNumber: "12a",
      editedLabels: ["pdNumber", "writerName", "scienceCode"],
      needsCheck: false,
    });
    // FY 2025 (9999 less the year, newest first), then the number and version.
    expect(row.sortKey).toBe(`7974 0012a 20002 ${PD_NAME.toLowerCase()}`);
    vi.setSystemTime(Date.now() + 60_000);
    // Neither changed nor skipped: it already has those labels.
    await expect(admin.mutation(api.ingestion.setSheetLabels, { ids: [id], patch })).resolves.toEqual({
      changed: 0,
      changedIds: [],
      skipped: [],
    });
    expect((await getItem(t, id)).updatedAt).toBe(row.updatedAt);
  });

  it("sets a PD number on a draft whose file name gave none, and refuses one that is not 1 to 99", async () => {
    const { admin, t } = await setup();
    const id = await stage(t, `${CEDARLINE_FY}/Drafts/route planning notes.docx`);
    await markRead(t, id);
    expect((await getItem(t, id)).pdNumber).toBeUndefined();
    for (const pdNumber of ["100", "0", "PD 4", "4ab"]) {
      await expect(admin.mutation(api.ingestion.setSheetLabels, { ids: [id], patch: { pdNumber } }), pdNumber).rejects.toThrow(
        "A PD number is 1 to 99, with an optional letter, for example 4 or 12a."
      );
    }
    await expect(admin.mutation(api.ingestion.setSheetLabels, { ids: [id], patch: { pdNumber: "06" } })).resolves.toMatchObject({
      changed: 1,
    });
    const row = await getItem(t, id);
    expect(row).toMatchObject({ category: "draft", pdNumber: "6", editedLabels: ["pdNumber"] });
    expectInvariants(row);
    await expectCountsMatchRecount(t, "after a PD number on a draft");
  });

  it("changes up to 100 files in one call, and refuses more", async () => {
    const { admin, t } = await setup();
    const ids: Array<Id<"ingestionItems">> = [];
    for (let i = 0; i < 101; i++) ids.push(await stage(t, `${CEDARLINE_FY}/Financials/sheet ${i}.pdf`));
    await expect(
      admin.mutation(api.ingestion.setSheetLabels, { ids, patch: { company: "Northgate Labs" } })
    ).rejects.toThrow("Change up to 100 files at a time.");
    await expect(
      admin.mutation(api.ingestion.setSheetLabels, { ids: ids.slice(0, 100), patch: { company: "Northgate Labs" } })
    ).resolves.toMatchObject({ changed: 100, skipped: [] });
    const { stored } = await countsNowAndRecount(t);
    expect(stored["review|northgate labs"].total).toBe(100);
    expect(stored["review|cedarline systems"].total).toBe(1);
    await expectCountsMatchRecount(t, "after 100 files");
  });

  it("moves a company change's counts from one band to the other", async () => {
    const { admin, t } = await setup();
    const a = await stage(t, `${CEDARLINE_FY}/Drafts/a.docx`);
    const b = await stage(t, `${CEDARLINE_FY}/Drafts/b.docx`);
    await stage(t, "Halden Foods/2025 - Jun 30/Drafts/c.docx");
    await admin.mutation(api.ingestion.setSheetLabels, { ids: [a, b], patch: { company: "Halden Foods" } });
    const { stored } = await countsNowAndRecount(t);
    expect(Object.keys(stored)).toEqual(["review|halden foods"]);
    // Still being read: under Not sorted yet until read (2026-11-12).
    expect(stored["review|halden foods"]).toMatchObject({
      total: 3,
      categories: { unknown: { total: 3, needsCheck: 0, fiscalYears: { "2025": 3 } } },
    });
    await expectCountsMatchRecount(t, "after the company change");
  });

  it("skips approved, rejected, deleted and missing files, and changes the rest", async () => {
    const { admin, t } = await setup();
    const open = await stage(t, `${CEDARLINE_FY}/Drafts/open.docx`);
    const approved = await stage(t, `${CEDARLINE_FY}/Drafts/approved.docx`);
    const rejected = await stage(t, `${CEDARLINE_FY}/Drafts/rejected.docx`);
    const deleted = await stage(t, `${CEDARLINE_FY}/Drafts/deleted.docx`);
    const gone = await stage(t, `${CEDARLINE_FY}/Drafts/gone.docx`);
    for (const id of [open, deleted, approved]) await markRead(t, id);
    await admin.mutation(api.ingestion.removeItem, { itemId: deleted });
    await admin.mutation(api.ingestion.rejectItem, { itemId: rejected });
    await approveForTest(t, admin, approved);
    await removeRow(t, gone);
    const untouched = await Promise.all([approved, rejected, deleted].map((id) => getItem(t, id)));

    await expect(
      admin.mutation(api.ingestion.setSheetLabels, {
        ids: [open, approved, rejected, deleted, gone],
        patch: { writerName: "Dana Whitlock" },
      })
    ).resolves.toEqual({
      changed: 1,
      changedIds: [open],
      skipped: [
        { id: approved, reason: "not_on_tab" },
        { id: rejected, reason: "not_on_tab" },
        { id: deleted, reason: "not_on_tab" },
        { id: gone, reason: "missing" },
      ],
    });
    expect((await getItem(t, open)).writerName).toBe("Dana Whitlock");
    expect(await Promise.all([approved, rejected, deleted].map((id) => getItem(t, id)))).toEqual(untouched);
    await expectCountsMatchRecount(t, "after a change that skipped four files");
  });

  it("gives each file of a mixed selection only the labels that go on it", async () => {
    const { admin, t } = await setup();
    const pd = await stage(t, `${CEDARLINE_FY}/To be submitted/${PD_NAME}`);
    const draft = await stage(t, `${CEDARLINE_FY}/Drafts/03 CedarlineSystems 2025-03-31 R2.PN SensorDraft.docx`);
    const transcript = await stage(t, `${CEDARLINE_FY}/WIP/Technical/Audio/interview.txt`);
    const supporting = await stage(t, `${CEDARLINE_FY}/Financials/budget.pdf`);
    const reading = await stage(t, `${CEDARLINE_FY}/To be submitted/05 CedarlineSystems 2025-03-31 T1 Reading.docx`);
    const failed = await stage(t, `${CEDARLINE_FY}/Drafts/failed.docx`);
    for (const id of [pd, draft, transcript, supporting]) await markRead(t, id);
    await t.mutation(internal.ingestion.markItemFailed, { itemId: failed, error: "Could not open it" });
    const all = [pd, draft, transcript, supporting, reading, failed];
    const call = (patch: Record<string, unknown>) => admin.mutation(api.ingestion.setSheetLabels, { ids: all, patch });
    const skipped = (ids: Array<Id<"ingestionItems">>) => ids.map((id) => ({ id, reason: "does_not_apply" }));

    // The bar's actions, one at a time. A science code: final PDs only.
    expect(await call({ scienceCode: "2.02.09" })).toEqual({
      changed: 1,
      changedIds: [pd],
      skipped: skipped([draft, transcript, supporting, reading, failed]),
    });
    for (const id of [draft, transcript, supporting, reading, failed]) expect((await getItem(t, id)).scienceCode).toBeUndefined();
    // A writer: final PDs, drafts and review copies, once read.
    expect(await call({ writerName: "Priya Nair" })).toMatchObject({
      changedIds: [pd, draft],
      skipped: skipped([transcript, supporting, reading, failed]),
    });
    expect((await getItem(t, transcript)).writerName).toBeUndefined();
    expect((await getItem(t, reading)).editedLabels ?? []).toEqual([]);
    // A year end: any read file.
    expect(await call({ fiscalYearEnd: Date.UTC(2024, 11, 31) })).toMatchObject({
      changedIds: [pd, draft, transcript, supporting],
      skipped: skipped([reading, failed]),
    });
    expect((await getItem(t, failed)).fiscalYearEnd).toBe(Date.UTC(2025, 2, 31));
    // A company or a category: every file on To review, read or not.
    expect(await call({ company: "Halden Foods" })).toMatchObject({ changedIds: all, skipped: [] });
    // The supporting file already was one: a person confirming it still marks the label as theirs.
    expect(await call({ category: "supporting" })).toMatchObject({ changedIds: all, skipped: [] });
    // One change with several labels: each file takes those that go on it.
    expect(await call({ category: "final_pd", scienceCode: "1.02.01", writerName: "Sam Okafor" })).toMatchObject({
      changedIds: all,
      skipped: [],
    });
    expect(await getItem(t, transcript)).toMatchObject({ category: "final_pd", scienceCode: "1.02.01", writerName: "Sam Okafor" });
    expect(await getItem(t, reading)).toMatchObject({ category: "final_pd", editedLabels: ["company", "category"] });
    expect((await getItem(t, reading)).writerName).toBeUndefined();
    for (const id of all) expectInvariants(await getItem(t, id));
    await expectCountsMatchRecount(t, "after a mixed selection");
  });

  it("changes the other 99 of a run of 100 when one was approved elsewhere, and names that one", async () => {
    const { admin, t } = await setup();
    const ids: Array<Id<"ingestionItems">> = [];
    for (let i = 0; i < 100; i++) {
      const id = await stage(t, `${CEDARLINE_FY}/Drafts/draft ${i}.docx`);
      await markRead(t, id);
      ids.push(id);
    }
    // Approved on the old page while it was selected here.
    await approveForTest(t, admin, ids[42]);
    const result = await admin.mutation(api.ingestion.setSheetLabels, { ids, patch: { category: "review_copy" } });
    expect(result.changed).toBe(99);
    expect(result.changedIds).toEqual(ids.filter((_, index) => index !== 42));
    expect(result.skipped).toEqual([{ id: ids[42], reason: "not_on_tab" }]);
    expect((await getItem(t, ids[42])).category).toBe("draft");
    await expectCountsMatchRecount(t, "after 99 of 100");
  });

  it("stores a typed company in the spelling of the company that already has its key", async () => {
    const { admin, t } = await setup();
    await seedCompanies(t);
    const a = await stage(t, "loose a.docx");
    const b = await stage(t, "loose b.docx");
    const c = await stage(t, "loose c.docx");
    const d = await stage(t, "loose d.docx");
    // Lower case and accents: the saved company Cedarline Systems keeps its name.
    await admin.mutation(api.ingestion.setSheetLabels, { ids: [a], patch: { company: "cedarline systems" } });
    await admin.mutation(api.ingestion.setSheetLabels, { ids: [b], patch: { company: "  Cédarline   SYSTEMS " } });
    expect((await getItem(t, a)).clientName).toBe("Cedarline Systems");
    expect((await getItem(t, b)).clientName).toBe("Cedarline Systems");
    // A key only a band has: the band's name.
    await stage(t, "Brightwell Dairy/2025/Drafts/plan.docx");
    await admin.mutation(api.ingestion.setSheetLabels, { ids: [c], patch: { company: "brightwell dairy" } });
    expect((await getItem(t, c)).clientName).toBe("Brightwell Dairy");
    // A company only projects know: their name.
    const e = await stage(t, "loose e.docx");
    await admin.mutation(api.ingestion.setSheetLabels, { ids: [e], patch: { company: "northgate LABS" } });
    expect((await getItem(t, e)).clientName).toBe("Northgate Labs");
    // A key that matches nothing (Halden Foods was merged away, so no
    // active company has it): the name as typed, trimmed, inner spaces collapsed.
    await admin.mutation(api.ingestion.setSheetLabels, { ids: [d], patch: { company: "  halden   FOODS " } });
    expect((await getItem(t, d)).clientName).toBe("halden FOODS");

    const { bands } = await countsNowAndRecount(t);
    const names = Object.fromEntries(bands.map((band) => [`${band.sheetTab}|${band.companyKey}`, band.displayName]));
    expect(names["review|cedarline systems"]).toBe("Cedarline Systems");
    expect(names["review|brightwell dairy"]).toBe("Brightwell Dairy");
    expect(names["review|northgate labs"]).toBe("Northgate Labs");
    expect(names["review|halden foods"]).toBe("halden FOODS");
  });

  it("never lets a later file's spelling rename a band: the company's name wins, else the first spelling stays", async () => {
    const { t } = await setup();
    const bandName = async (key: string) =>
      (await countsNowAndRecount(t)).bands.find((band) => band.sheetTab === "review" && band.companyKey === key)?.displayName;
    // No saved company: the first file's spelling stays.
    await stage(t, "Brightwell Dairy/2025/Drafts/plan.docx", { driveItemId: "first" });
    await stage(t, "BRIGHTWELL  dairy/2025/Drafts/later.docx", { driveItemId: "later" });
    expect(await bandName("brightwell dairy")).toBe("Brightwell Dairy");
    // The first file moving to another spelling does not rename it either.
    await t.mutation(internal.ingestion.upsertDiscoveredItem, discoveredArgs("brightwell DAIRY/2025/Drafts/plan.docx", { driveItemId: "first" }));
    expect(await bandName("brightwell dairy")).toBe("Brightwell Dairy");
    // A saved company with the key: its name wins, from the next spelling that comes.
    await seedCompanies(t);
    await stage(t, "cedarline systems/2025 - Mar 31/Drafts/one.docx", { driveItemId: "one" });
    expect(await bandName("cedarline systems")).toBe("Cedarline Systems");
    await t.run(async (ctx) => {
      const userId = (await ctx.db.query("users").first())!._id;
      await ctx.db.insert("clients", {
        name: "BrightWell Dairy",
        nameKey: "brightwell dairy",
        status: "active",
        createdBy: userId,
        createdAt: 1,
        updatedAt: 1,
      });
    });
    // A company saved later: the next spelling that comes takes its name.
    await stage(t, "brightwell dairy/2025/Drafts/third.docx", { driveItemId: "third" });
    expect(await bandName("brightwell dairy")).toBe("BrightWell Dairy");
    // A rebuild gives the same name.
    await driveRebuild(t, { sheetTab: "review", companyKey: "brightwell dairy", pageSize: 2 });
    expect(await bandName("brightwell dairy")).toBe("BrightWell Dairy");
  });

  it("refuses an unknown science code and anyone but an admin", async () => {
    const { admin, writer, t, id } = await oneFinalPd();
    const before = await getItem(t, id);
    await expect(
      admin.mutation(api.ingestion.setSheetLabels, { ids: [id], patch: { scienceCode: "2.02.99" } })
    ).rejects.toThrow("That is not a CRA field of science code.");
    await expect(
      writer.mutation(api.ingestion.setSheetLabels, { ids: [id], patch: { writerName: "Sam Okafor" } })
    ).rejects.toThrow(/admin only/i);
    expect(await getItem(t, id)).toEqual(before);
  });

  it("recomputes pairing for the groups a file left and joined", async () => {
    const { admin, t } = await setup();
    const pd = await stage(t, `${CEDARLINE_FY}/To be submitted/${PD_NAME}`);
    const transcript = await stage(t, `${CEDARLINE_FY}/WIP/Technical/Audio/interview.txt`);
    await markRead(t, pd);
    await markRead(t, transcript);
    await t.mutation(internal.ingestion.recomputePairs, { groupKeys: ["cedarline systems::2025"] });
    expect(await getItem(t, transcript)).toMatchObject({ pairStatus: "paired" });

    await admin.mutation(api.ingestion.setSheetLabels, { ids: [pd], patch: { company: "Brightwell Dairy" } });
    // Scheduled, not in the edit itself.
    expect(await getItem(t, transcript)).toMatchObject({ pairStatus: "paired" });
    expect(await runPairing(t)).toEqual([["brightwell dairy::2025", "cedarline systems::2025"]]);
    expect(await getItem(t, transcript)).toMatchObject({ pairStatus: "missing_pd" });
    expect(await getItem(t, pd)).toMatchObject({
      pairGroupKey: "brightwell dairy::2025",
      pairStatus: "missing_transcript",
    });

    await admin.mutation(api.ingestion.setSheetLabels, { ids: [pd], patch: { company: "Cedarline Systems" } });
    await runPairing(t);
    expect(await getItem(t, transcript)).toMatchObject({ pairStatus: "paired" });
    await admin.mutation(api.ingestion.setSheetLabels, { ids: [pd], patch: { category: "draft" } });
    await runPairing(t);
    expect(await getItem(t, transcript)).toMatchObject({ pairStatus: "missing_pd" });
    expect((await getItem(t, pd)).pairStatus).toBeUndefined();
  });

  it("recomputes every group 100 files touched, two groups a run, none in the edit itself", async () => {
    const { admin, t } = await setup();
    const years = Array.from({ length: 10 }, (_, i) => 2016 + i);
    const edited: Array<Id<"ingestionItems">> = [];
    const pds: Array<Id<"ingestionItems">> = [];
    const transcripts: Array<Id<"ingestionItems">> = [];
    const supporting: Array<Id<"ingestionItems">> = [];
    for (const year of years) {
      const folder = `Cedarline Systems/${year} - Mar 31`;
      const pd = await stage(t, `${folder}/To be submitted/pd ${year}.docx`);
      pds.push(pd);
      edited.push(pd);
      transcripts.push(await stage(t, `${folder}/WIP/Technical/Audio/call ${year}.vtt`));
      for (let i = 0; i < 9; i++) {
        const id = await stage(t, `${folder}/Financials/sheet ${i}.pdf`);
        supporting.push(id);
        edited.push(id);
      }
    }
    expect(edited).toHaveLength(100);
    await t.mutation(internal.ingestion.recomputePairs, { groupKeys: years.map((year) => `cedarline systems::${year}`) });
    await runPairing(t);
    for (const id of transcripts) expect(await getItem(t, id)).toMatchObject({ pairStatus: "paired" });

    await expect(
      admin.mutation(api.ingestion.setSheetLabels, { ids: edited, patch: { company: "Northgate Labs" } })
    ).resolves.toMatchObject({ changed: 100 });
    // Nothing was recomputed in the edit: the transcripts still show their old pairing.
    for (const id of transcripts) expect(await getItem(t, id)).toMatchObject({ pairStatus: "paired" });

    const runs = await runPairing(t);
    // 20 groups (10 left, 10 joined): each run did two and scheduled the rest.
    expect(runs.map((keys) => keys.length)).toEqual([20, 18, 16, 14, 12, 10, 8, 6, 4, 2]);
    expect(new Set(runs[0])).toEqual(
      new Set(years.flatMap((year) => [`northgate labs::${year}`, `cedarline systems::${year}`]))
    );
    for (const id of transcripts) expect(await getItem(t, id)).toMatchObject({ pairStatus: "missing_pd" });
    for (const id of pds) expect(await getItem(t, id)).toMatchObject({ pairStatus: "missing_transcript" });
    for (const id of supporting) expect(await getItem(t, id)).toMatchObject({ pairStatus: "paired" });
    await expectCountsMatchRecount(t, "after 100 files across 20 groups");
  });

  it("reads the science code from the stored preview when a person makes a file a final PD", async () => {
    const { admin, t } = await setup();
    const preview = "Project summary\nField of science or technology: 2.02.09 Industrial biotechnology";
    const copy = await stage(t, `${CEDARLINE_FY}/In Review/04 CedarlineSystems 2025-03-31 R2.DW Drift.docx`);
    await markRead(t, copy, preview);
    // Still being read: extraction will read the whole text itself.
    const reading = await stage(t, `${CEDARLINE_FY}/In Review/reading.docx`);
    // A person set the code in the same change that makes it a final PD (a
    // code goes only on a final PD, judged by the category after the change).
    const set = await stage(t, `${CEDARLINE_FY}/In Review/set.docx`);
    await markRead(t, set, preview);
    await expect(
      admin.mutation(api.ingestion.setSheetLabels, { ids: [set], patch: { scienceCode: "1.02.01" } })
    ).resolves.toEqual({ changed: 0, changedIds: [], skipped: [{ id: set, reason: "does_not_apply" }] });
    await admin.mutation(api.ingestion.setSheetLabels, { ids: [set], patch: { category: "final_pd", scienceCode: "1.02.01" } });

    await admin.mutation(api.ingestion.setSheetLabels, { ids: [copy, reading, set], patch: { category: "final_pd" } });
    expect(await getItem(t, copy)).toMatchObject({
      category: "final_pd",
      docKind: "pd",
      scienceCode: "2.02.09",
      scienceCodeSource: "document",
      // Its initials already gave it a writer (2026-11-16): nothing is left to check.
      writerName: "DW",
      checkReasons: [],
    });
    expect((await getItem(t, reading)).scienceCode).toBeUndefined();
    expect(await getItem(t, set)).toMatchObject({ scienceCode: "1.02.01", scienceCodeSource: "person" });
    for (const id of [copy, reading, set]) expectInvariants(await getItem(t, id));
    await expectCountsMatchRecount(t, "after making three files final PDs");

    // A file that already was a final PD is not read again by an edit.
    const pd = await stage(t, `${CEDARLINE_FY}/To be submitted/${PD_NAME}`);
    await markRead(t, pd, preview);
    expect((await getItem(t, pd)).scienceCode).toBeUndefined();
    await admin.mutation(api.ingestion.setSheetLabels, { ids: [pd], patch: { category: "final_pd" } });
    expect((await getItem(t, pd)).scienceCode).toBeUndefined();
  });
});

// ─── Deleting and putting back many files (phase 3b) ────────────────────────

describe("removeItems and restoreItems", () => {
  /** The data a ConvexError carries, or the error itself when it is not one. */
  async function refusal(promise: Promise<unknown>) {
    const error = await promise.then(
      () => null,
      (caught: unknown) => caught
    );
    expect(error, "the call was refused").not.toBeNull();
    return (error as { data?: unknown }).data ?? error;
  }

  async function pendingRecomputes(t: T) {
    const jobs = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    return jobs
      .filter((job) => job.name.includes("recomputePairs") && job.state.kind === "pending")
      .flatMap((job) => (job.args[0] as { groupKeys: string[] }).groupKeys);
  }

  /** The pending extractions scheduled for one file. */
  async function pendingReads(t: T, id: Id<"ingestionItems">) {
    const jobs = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    return jobs.filter(
      (job) =>
        job.name.includes("extractUploadedItem") &&
        job.state.kind === "pending" &&
        (job.args[0] as { itemId: string }).itemId === id
    ).length;
  }

  it("deletes a batch of mixed statuses with removeItem's rules, and puts exactly those back on To review", async () => {
    const { t, admin } = await setup();
    const pending = await stage(t, `${CEDARLINE_FY}/To be submitted/${PD_NAME}`);
    const rejected = await stage(t, `${CEDARLINE_FY}/Drafts/rejected.docx`);
    const failed = await stage(t, `${CEDARLINE_FY}/WIP/Technical/Audio/interview.txt`);
    const earlier = await stage(t, `${CEDARLINE_FY}/Drafts/earlier.docx`);
    for (const id of [pending, rejected, earlier]) await markRead(t, id);
    await admin.mutation(api.ingestion.rejectItem, { itemId: rejected });
    await t.mutation(internal.ingestion.markItemFailed, { itemId: failed, error: "Could not open it" });
    await admin.mutation(api.ingestion.removeItem, { itemId: earlier });
    await runPairing(t);
    const earlierRow = await getItem(t, earlier);

    // A file already deleted is left as it is and named, never counted.
    await expect(
      admin.mutation(api.ingestion.removeItems, { ids: [pending, rejected, failed, earlier, pending] })
    ).resolves.toEqual({
      changed: 3,
      changedIds: [pending, rejected, failed],
      skipped: [{ id: earlier, reason: "already_deleted" }],
    });
    for (const [id, from] of [
      [pending, "pending_review"],
      [rejected, "rejected"],
      [failed, "failed"],
    ] as const) {
      const row = await getItem(t, id);
      expect(row, from).toMatchObject({ status: "deleted", deletedFromStatus: from, sheetTab: "deleted" });
      expect(row.deletedBy, from).toEqual(expect.any(String));
      expect(row.pairStatus, from).toBeUndefined();
      expectInvariants(row);
    }
    expect(await getItem(t, earlier)).toEqual(earlierRow);
    // Pairing is scheduled for the group, never read in the call itself.
    expect(await pendingRecomputes(t)).toContain("cedarline systems::2025");
    await expectCountsMatchRecount(t, "after removeItems");
    const { stored } = await countsNowAndRecount(t);
    expect(stored["deleted|cedarline systems"].total).toBe(4);
    expect(stored["review|cedarline systems"]).toBeUndefined();
    await runPairing(t);

    // Undo puts back exactly those, every one onto To review: the read ones
    // to wait for review (the rejected one too: its text was read), the
    // failed one as could not be read.
    await expect(admin.mutation(api.ingestion.restoreItems, { ids: [pending, rejected, failed] })).resolves.toEqual({
      changed: 3,
      changedIds: [pending, rejected, failed],
      skipped: [],
    });
    expect((await getItem(t, pending)).status).toBe("pending_review");
    expect(await getItem(t, rejected)).toMatchObject({ status: "pending_review", sheetTab: "review" });
    expect((await getItem(t, rejected)).reviewNote).toBeUndefined();
    expect((await getItem(t, failed)).status).toBe("failed");
    for (const id of [pending, rejected, failed]) {
      const row = await getItem(t, id);
      expect(row.deletedFromStatus).toBeUndefined();
      expect(row.deletedBy).toBeUndefined();
      expect(row.deletedAt).toBeUndefined();
      expectInvariants(row);
    }
    expect((await getItem(t, earlier)).status).toBe("deleted");
    await expectCountsMatchRecount(t, "after restoreItems");
    await runPairing(t);
    // The PD is live again, so pairing sees it once more.
    expect((await getItem(t, pending)).pairStatus).toBe("missing_transcript");
  });

  it("skips an approved file, one still being read and a missing one with their reasons, and deletes the rest", async () => {
    const { t, admin, writer } = await setup();
    const open = await stage(t, `${CEDARLINE_FY}/Drafts/open.docx`);
    const approved = await stage(t, `${CEDARLINE_FY}/Drafts/approved.docx`);
    const reading = await stage(t, `${CEDARLINE_FY}/Drafts/reading.docx`);
    const gone = await stage(t, `${CEDARLINE_FY}/Drafts/gone.docx`);
    for (const id of [open, approved]) await markRead(t, id);
    await approveForTest(t, admin, approved);
    await removeRow(t, gone);
    const untouched = await Promise.all([approved, reading].map((id) => getItem(t, id)));

    await expect(admin.mutation(api.ingestion.removeItems, { ids: [approved, open, reading, gone] })).resolves.toEqual({
      changed: 1,
      changedIds: [open],
      skipped: [
        { id: approved, reason: "approved" },
        { id: reading, reason: "being_read" },
        { id: gone, reason: "missing" },
      ],
    });
    expect((await getItem(t, open)).status).toBe("deleted");
    expect(await Promise.all([approved, reading].map((id) => getItem(t, id)))).toEqual(untouched);
    await expectCountsMatchRecount(t, "after a delete that skipped three");

    // The single-file mutations keep their rules, in plain words.
    await expect(admin.mutation(api.ingestion.removeItem, { itemId: approved })).rejects.toThrow(
      "This file is already approved, so it cannot be rejected or deleted here."
    );
    await expect(admin.mutation(api.ingestion.rejectItem, { itemId: approved })).rejects.toThrow(
      "This file is already approved, so it cannot be rejected or deleted here."
    );
    await expect(admin.mutation(api.ingestion.restoreItem, { itemId: reading })).rejects.toThrow(
      "This file is not deleted, so there is nothing to put back."
    );
    await expect(admin.mutation(api.ingestion.removeItem, { itemId: gone })).rejects.toThrow("This file is no longer in Import.");
    await expect(admin.mutation(api.ingestion.restoreItem, { itemId: gone })).rejects.toThrow("This file is no longer in Import.");
    await expect(writer.mutation(api.ingestion.removeItems, { ids: [open] })).rejects.toThrow(/admin only/i);
    await expect(writer.mutation(api.ingestion.restoreItems, { ids: [open] })).rejects.toThrow(/admin only/i);

    // Putting back a file that is not on Deleted, or is gone, is skipped the same way.
    await expect(admin.mutation(api.ingestion.restoreItems, { ids: [open, reading, approved, gone] })).resolves.toEqual({
      changed: 1,
      changedIds: [open],
      skipped: [
        { id: reading, reason: "not_on_tab" },
        { id: approved, reason: "not_on_tab" },
        { id: gone, reason: "missing" },
      ],
    });
    await expect(admin.mutation(api.ingestion.removeItems, { ids: [] })).resolves.toEqual({ changed: 0, changedIds: [], skipped: [] });
  });

  it("puts back with Undo only the files a partial delete took out", async () => {
    const { t, admin } = await setup();
    const a = await stage(t, `${CEDARLINE_FY}/Drafts/a.docx`);
    const b = await stage(t, `${CEDARLINE_FY}/Drafts/b.docx`);
    const reading = await stage(t, `${CEDARLINE_FY}/Drafts/reading.docx`);
    const earlier = await stage(t, `${CEDARLINE_FY}/Drafts/earlier.docx`);
    for (const id of [a, b, earlier]) await markRead(t, id);
    await admin.mutation(api.ingestion.removeItem, { itemId: earlier });

    const deleted = await admin.mutation(api.ingestion.removeItems, { ids: [a, reading, earlier, b] });
    expect(deleted.changedIds).toEqual([a, b]);
    // Undo sends exactly changedIds: the file deleted before stays deleted.
    await expect(admin.mutation(api.ingestion.restoreItems, { ids: deleted.changedIds })).resolves.toMatchObject({
      changedIds: [a, b],
      skipped: [],
    });
    expect((await getItem(t, earlier)).status).toBe("deleted");
    expect((await getItem(t, reading)).status).toBe("discovered");
    for (const id of [a, b]) expect((await getItem(t, id)).status).toBe("pending_review");
    await expectCountsMatchRecount(t, "after Undo of a partial delete");
  });

  it("puts each kind of file back onto To review in the state its data calls for, so none is stranded", async () => {
    const { t, admin } = await setup();
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["bytes"])));
    const at = (name: string) => `${CEDARLINE_FY}/Drafts/${name}.docx`;
    const ids = {
      // Deleted in Import from To review: the status it was deleted from.
      deletedRead: await stage(t, at("deleted read")),
      deletedFailed: await stage(t, at("deleted failed")),
      // Rejected on the old page at each stage: from what it holds.
      rejectedRead: await stage(t, at("rejected read")),
      rejectedScan: await stage(t, at("rejected scan")),
      rejectedFailed: await stage(t, at("rejected failed")),
      rejectedFetched: await stage(t, at("rejected fetched")),
      rejectedDiscovered: await stage(t, at("rejected discovered")),
      // Deleted after it was rejected: the same.
      deletedRejected: await stage(t, at("deleted rejected")),
      // Removed in OneDrive, then deleted too: neither is put back.
      inOneDrive: await stage(t, at("in onedrive"), { driveItemId: "onedrive-a" }),
      inOneDriveDeleted: await stage(t, at("in onedrive deleted"), { driveItemId: "onedrive-b" }),
    };
    for (const id of [ids.deletedRead, ids.rejectedRead, ids.deletedRejected, ids.inOneDrive, ids.inOneDriveDeleted]) {
      await markRead(t, id);
    }
    await t.mutation(internal.ingestion.markItemProcessed, {
      itemId: ids.rejectedScan,
      storageId,
      extractNote: "The PDF has no text layer; a scan needs OCR.",
    });
    for (const id of [ids.deletedFailed, ids.rejectedFailed]) {
      await t.mutation(internal.ingestion.markItemFailed, { itemId: id, error: "Could not open it" });
    }
    await t.mutation(internal.ingestion.attachUpload, { itemId: ids.rejectedFetched, storageId });
    for (const id of [ids.rejectedRead, ids.rejectedScan, ids.rejectedFailed, ids.rejectedFetched, ids.rejectedDiscovered, ids.deletedRejected]) {
      await admin.mutation(api.ingestion.rejectItem, { itemId: id, note: "Not ours" });
    }
    for (const driveItemId of ["onedrive-a", "onedrive-b"]) await t.mutation(internal.ingestion.markDriveItemRemoved, { driveItemId });
    await admin.mutation(api.ingestion.removeItems, {
      ids: [ids.deletedRead, ids.deletedFailed, ids.deletedRejected, ids.inOneDriveDeleted],
    });
    await expectCountsMatchRecount(t, "before putting back");
    expect(await admin.query(api.ingestion.sheetTotals, { tab: "review" })).toMatchObject({ files: 0 });
    const readsBefore = await pendingReads(t, ids.rejectedFetched);

    const all = Object.values(ids);
    const result = await admin.mutation(api.ingestion.restoreItems, { ids: all });
    expect(result.skipped).toEqual([
      { id: ids.inOneDrive, reason: "removed_in_onedrive" },
      { id: ids.inOneDriveDeleted, reason: "removed_in_onedrive" },
    ]);
    expect(result.changedIds).toEqual(all.filter((id) => id !== ids.inOneDrive && id !== ids.inOneDriveDeleted));
    const status = async (id: Id<"ingestionItems">) => (await getItem(t, id)).status;
    expect(await status(ids.deletedRead)).toBe("pending_review");
    expect(await status(ids.deletedFailed)).toBe("failed");
    expect(await status(ids.rejectedRead)).toBe("pending_review");
    expect(await status(ids.deletedRejected)).toBe("pending_review");
    // Read with a note and no text: waiting for review, flagged "no text".
    expect(await getItem(t, ids.rejectedScan)).toMatchObject({ status: "pending_review", checkReasons: ["no_text"] });
    expect(await getItem(t, ids.rejectedFailed)).toMatchObject({ status: "failed", error: "Could not open it" });
    // Its bytes are here but were never read: read again, by a scheduled extraction.
    expect(await status(ids.rejectedFetched)).toBe("fetched");
    expect(await pendingReads(t, ids.rejectedFetched)).toBe(readsBefore + 1);
    // Nothing stored: back where the next OneDrive sync fetches and reads it.
    expect(await status(ids.rejectedDiscovered)).toBe("discovered");
    expect(
      (await t.query(internal.ingestion.takeUnprocessedItems, { limit: 50 })).map((row) => row._id)
    ).toContain(ids.rejectedDiscovered);
    for (const id of result.changedIds) {
      const row = await getItem(t, id);
      expect(row.sheetTab, row.name).toBe("review");
      expect(row.reviewNote, row.name).toBeUndefined();
      expectInvariants(row);
    }
    expect(await status(ids.inOneDrive)).toBe("rejected");
    expect(await status(ids.inOneDriveDeleted)).toBe("deleted");

    await expectCountsMatchRecount(t, "after putting back every kind");
    const { stored } = await countsNowAndRecount(t);
    expect(stored["review|cedarline systems"]).toMatchObject({ total: 8, beingRead: 2 });
    expect(stored["review|cedarline systems"].categories.draft.checkReasons).toEqual({ could_not_read: 2, no_text: 1 });
    expect(stored["deleted|cedarline systems"]).toMatchObject({ total: 2 });
  });

  it("deletes and puts back 100 files in one call, refuses 101, and keeps the counts right", async () => {
    const { t, admin } = await setup();
    const ids: Array<Id<"ingestionItems">> = [];
    for (let i = 0; i < 101; i++) {
      const id = await stage(t, `${CEDARLINE_FY}/Financials/sheet ${i}.pdf`);
      await markRead(t, id);
      ids.push(id);
    }
    expect(await refusal(admin.mutation(api.ingestion.removeItems, { ids }))).toEqual({
      code: "INVALID_INPUT",
      message: "Delete up to 100 files at a time.",
    });
    await expect(admin.mutation(api.ingestion.removeItems, { ids: ids.slice(0, 100) })).resolves.toMatchObject({ changed: 100 });
    let { stored } = await countsNowAndRecount(t);
    expect(stored["deleted|cedarline systems"].total).toBe(100);
    expect(stored["review|cedarline systems"].total).toBe(1);
    await expectCountsMatchRecount(t, "after deleting 100");
    expect(await admin.query(api.ingestion.sheetTotals, { tab: "deleted" })).toMatchObject({ files: 100, companies: 1 });

    await admin.mutation(api.ingestion.removeItems, { ids: [ids[100]] });
    expect(await refusal(admin.mutation(api.ingestion.restoreItems, { ids }))).toEqual({
      code: "INVALID_INPUT",
      message: "Put back up to 100 files at a time.",
    });
    await expect(admin.mutation(api.ingestion.restoreItems, { ids: ids.slice(1) })).resolves.toMatchObject({ changed: 100 });
    ({ stored } = await countsNowAndRecount(t));
    expect(stored["review|cedarline systems"].total).toBe(100);
    expect(stored["deleted|cedarline systems"].total).toBe(1);
    await expectCountsMatchRecount(t, "after putting back 100");
    expect(await admin.query(api.ingestion.sheetTotals, { tab: "review" })).toMatchObject({ files: 100 });
  });

  it("says on each Deleted tab row why it is there", async () => {
    const { t, admin } = await setup();
    const byPerson = await stage(t, `${CEDARLINE_FY}/Drafts/a.docx`, { driveItemId: "a" });
    const inOneDrive = await stage(t, `${CEDARLINE_FY}/Drafts/b.docx`, { driveItemId: "b" });
    const rejected = await stage(t, `${CEDARLINE_FY}/Drafts/c.docx`, { driveItemId: "c" });
    const open = await stage(t, `${CEDARLINE_FY}/Drafts/d.docx`, { driveItemId: "d" });
    for (const id of [byPerson, rejected, open]) await markRead(t, id);
    await admin.mutation(api.ingestion.removeItems, { ids: [byPerson] });
    await t.mutation(internal.ingestion.markDriveItemRemoved, { driveItemId: "b" });
    await admin.mutation(api.ingestion.rejectItem, { itemId: rejected, note: "Not ours" });

    const page = await admin.query(api.ingestion.sheetFiles, {
      tab: "deleted",
      companyKey: "cedarline systems",
      category: "draft",
      onlyToCheck: false,
      paginationOpts: PAGE,
    });
    expect(page.page.map((row) => [row._id, row.status, row.deletedReason])).toEqual([
      [byPerson, "deleted", "deleted"],
      [inOneDrive, "rejected", "removed_in_onedrive"],
      [rejected, "rejected", "rejected"],
    ]);
    const review = await admin.query(api.ingestion.sheetFiles, {
      tab: "review",
      companyKey: "cedarline systems",
      category: "draft",
      onlyToCheck: false,
      paginationOpts: PAGE,
    });
    expect(review.page.map((row) => [row._id, row.deletedReason])).toEqual([[open, undefined]]);
  });
});

// ─── A read file with no text (phase 3b fixes) ──────────────────────────────

describe("a read file with no text", () => {
  it("needs a check for no text, counted in its section and the tab, until text is read", async () => {
    const { t, admin } = await setup();
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["bytes"])));
    const scans: Array<Id<"ingestionItems">> = [];
    for (const name of ["scan a", "scan b", "scan c"]) {
      const id = await stage(t, `${CEDARLINE_FY}/Financials/${name}.pdf`);
      await t.mutation(internal.ingestion.markItemProcessed, {
        itemId: id,
        storageId,
        extractNote: "The PDF has no text layer; a scan needs OCR.",
      });
      scans.push(id);
    }
    const read = await stage(t, `${CEDARLINE_FY}/Financials/budget.pdf`);
    await markRead(t, read);
    const failed = await stage(t, `${CEDARLINE_FY}/Financials/broken.pdf`);
    await t.mutation(internal.ingestion.markItemFailed, { itemId: failed, error: "Damaged" });

    for (const id of scans) expect(await getItem(t, id)).toMatchObject({ needsCheck: true, checkReasons: ["no_text"] });
    expect(await getItem(t, read)).toMatchObject({ needsCheck: false, checkReasons: [] });
    // A file that failed stays "could not be read" alone.
    expect((await getItem(t, failed)).checkReasons).toEqual(["could_not_read"]);
    const band = (
      await admin.query(api.ingestion.sheetCompanies, { tab: "review", onlyToCheck: true, paginationOpts: PAGE })
    ).page.find((entry) => entry.companyKey === "cedarline systems")!;
    expect(band.categories.supporting.checkReasons).toEqual({ no_text: 3, could_not_read: 1 });
    expect(await admin.query(api.ingestion.sheetTotals, { tab: "review" })).toMatchObject({ files: 5, needsCheck: 4 });
    await expectCountsMatchRecount(t, "with three scans");

    // It can still be moved and deleted; its year end follows the read-file rule.
    await expect(
      admin.mutation(api.ingestion.setSheetLabels, { ids: [scans[0]], patch: { fiscalYearEnd: Date.UTC(2024, 11, 31) } })
    ).resolves.toMatchObject({ changedIds: [scans[0]] });
    await expect(admin.mutation(api.ingestion.removeItems, { ids: [scans[1]] })).resolves.toMatchObject({ changedIds: [scans[1]] });
    // Read again with text, the check goes.
    await t.mutation(internal.ingestion.upsertDiscoveredItem, discoveredArgs(`${CEDARLINE_FY}/Financials/scan c.pdf`, { contentHash: "hash-2" }));
    await markRead(t, scans[2]);
    expect(await getItem(t, scans[2])).toMatchObject({ needsCheck: false, checkReasons: [] });
    await expectCountsMatchRecount(t, "after the scans changed");
  });
});

// ─── Pairing by company and fiscal year ─────────────────────────────────────

describe("pairing by company key and fiscal year", () => {
  async function pairStatusOf(t: T, id: Id<"ingestionItems">) {
    return (await getItem(t, id)).pairStatus;
  }

  it("pairs a PD and a transcript whose folders spell the company and year differently", async () => {
    const t = convexTest(schema, modules);
    const pd = await stage(t, `${CEDARLINE_FY}/To be submitted/${PD_NAME}`);
    const transcript = await stage(t, "CEDARLINE SYSTEMS/FY2025/WIP/Technical/Audio/interview.vtt");
    const pdRow = await getItem(t, pd);
    const transcriptRow = await getItem(t, transcript);
    expect(pdRow.fiscalYearLabel).toBe("2025 - Mar 31");
    expect(transcriptRow.fiscalYearLabel).toBe("FY2025");
    expect(pdRow.pairGroupKey).toBe("cedarline systems::2025");
    expect(transcriptRow.pairGroupKey).toBe(pdRow.pairGroupKey);
    await t.mutation(internal.ingestion.recomputePairs, { groupKeys: [pdRow.pairGroupKey] });
    expect(await pairStatusOf(t, pd)).toBe("paired");
    expect(await pairStatusOf(t, transcript)).toBe("paired");
  });

  it("pairs a PD with that year's transcript once a person fixes its year end", async () => {
    const { t, admin } = await setup();
    // The PD sits in the wrong year's folder.
    const pd = await stage(t, `${CEDARLINE_FY}/To be submitted/${PD_NAME}`, { driveItemId: "pd" });
    const transcript = await stage(t, "Cedarline Systems/FY2024/WIP/Technical/Audio/interview.vtt");
    await markRead(t, pd);
    await t.mutation(internal.ingestion.recomputePairs, { groupKeys: ["cedarline systems::2025", "cedarline systems::2024"] });
    expect(await pairStatusOf(t, pd)).toBe("missing_transcript");
    expect(await pairStatusOf(t, transcript)).toBe("missing_pd");

    await admin.mutation(api.ingestion.setSheetLabels, { ids: [pd], patch: { fiscalYearEnd: Date.UTC(2024, 2, 31) } });
    expect(await runPairing(t)).toEqual([["cedarline systems::2024", "cedarline systems::2025"]]);
    expect(await getItem(t, pd)).toMatchObject({
      fiscalYear: 2024,
      fiscalYearEnd: Date.UTC(2024, 2, 31),
      fiscalYearEndAssumed: false,
      // No label is made up: the old page still shows the folder's name.
      fiscalYearLabel: "2025 - Mar 31",
      pairGroupKey: "cedarline systems::2024",
      pairStatus: "paired",
    });
    expect(await pairStatusOf(t, transcript)).toBe("paired");

    // A later move keeps the person's year end, and so the pair.
    await t.mutation(
      internal.ingestion.upsertDiscoveredItem,
      discoveredArgs(`Cedarline Systems/2025 - Mar 31/Submitted/${PD_NAME}`, { driveItemId: "pd" })
    );
    await runPairing(t);
    expect(await getItem(t, pd)).toMatchObject({ pairGroupKey: "cedarline systems::2024", pairStatus: "paired" });
    expect(await pairStatusOf(t, transcript)).toBe("paired");
  });

  it("keeps the pair, and the company spelling, when a person retypes the company with other capitals", async () => {
    const { t, admin } = await setup();
    const pd = await stage(t, `${CEDARLINE_FY}/To be submitted/${PD_NAME}`);
    const transcript = await stage(t, `${CEDARLINE_FY}/WIP/Technical/Audio/interview.vtt`);
    await markRead(t, pd);
    await t.mutation(internal.ingestion.recomputePairs, { groupKeys: ["cedarline systems::2025"] });
    await admin.mutation(api.ingestion.setSheetLabels, { ids: [pd], patch: { company: "CEDARLINE  systems" } });
    // Nothing pairing reads moved, so nothing was even scheduled.
    expect(await runPairing(t)).toEqual([]);
    expect(await getItem(t, pd)).toMatchObject({
      // The band already spells it "Cedarline Systems" (companyNameToStore).
      clientName: "Cedarline Systems",
      companyKey: "cedarline systems",
      pairGroupKey: "cedarline systems::2025",
      pairStatus: "paired",
    });
    expect(await pairStatusOf(t, transcript)).toBe("paired");
  });

  it("puts two year ends in one calendar year in one group (known and accepted)", async () => {
    const t = convexTest(schema, modules);
    const march = await stage(t, `${CEDARLINE_FY}/To be submitted/${PD_NAME}`);
    const december = await stage(t, "Cedarline Systems/2025 - Dec 31/WIP/Technical/Audio/interview.vtt");
    expect((await getItem(t, march)).pairGroupKey).toBe((await getItem(t, december)).pairGroupKey);
  });

  it("is moved to the new key by the backfill, which recomputes the old and new groups", async () => {
    const t = convexTest(schema, modules);
    // Staged on main: one group per raw client folder and year folder.
    const oldRow = async (path: string, mainKey: string) => {
      const args = discoveredArgs(path);
      return await t.run((ctx) =>
        ctx.db.insert("ingestionItems", { ...args, pairGroupKey: mainKey, status: "pending_review", text: "Old", updatedAt: 1 })
      );
    };
    const pd = await oldRow(`${CEDARLINE_FY}/To be submitted/${PD_NAME}`, "Cedarline Systems::2025 - Mar 31");
    const transcript = await oldRow("Cedarline Systems/FY2025/WIP/Technical/Audio/interview.vtt", "Cedarline Systems::FY2025");
    await t.mutation(internal.ingestion.recomputePairs, {
      groupKeys: ["Cedarline Systems::2025 - Mar 31", "Cedarline Systems::FY2025"],
    });
    expect(await pairStatusOf(t, pd)).toBe("missing_transcript");
    expect(await pairStatusOf(t, transcript)).toBe("missing_pd");

    await t.mutation(internal.ingestion.backfillIngestionLabels, {});
    const runs = await runPairing(t);
    expect(new Set(runs.flat())).toEqual(
      new Set(["cedarline systems::2025", "Cedarline Systems::2025 - Mar 31", "Cedarline Systems::FY2025"])
    );
    for (const id of [pd, transcript]) {
      const row = await getItem(t, id);
      expect(row).toMatchObject({ pairGroupKey: "cedarline systems::2025", pairStatus: "paired" });
      expectInvariants(row);
    }
  });
});

// ─── Science code from the document text ────────────────────────────────────

describe("Greptile review of the labels layer (2026-11-17)", () => {
  it("reads the file name of a scheme-named PD once a person makes it a final PD", async () => {
    const { t, admin } = await setup();
    const id = await stage(t, `${CEDARLINE_FY}/Background/${PD_NAME}`, { driveItemId: "kept-aside" });
    await markRead(t, id);
    const before = await getItem(t, id);
    expect(before).toMatchObject({ category: "supporting" });
    expect(before.pdNumber).toBeUndefined();
    expect(before.writerInitials).toBeUndefined();

    await admin.mutation(api.ingestion.setSheetLabels, { ids: [id], patch: { category: "final_pd" } });
    const after = await getItem(t, id);
    expect(after).toMatchObject({
      category: "final_pd",
      pdNumber: "4",
      versionCode: "T",
      versionNumber: 2,
      writerInitials: "DW",
      reviewerInitials: "PN",
      pdTitle: "Cold Chain Sensor Drift",
    });
    expectInvariants(after);

    // A later sync of the same file keeps the person's category and the labels it gives.
    await t.mutation(
      internal.ingestion.upsertDiscoveredItem,
      discoveredArgs(`${CEDARLINE_FY}/Background/${PD_NAME}`, { driveItemId: "kept-aside" })
    );
    expect(await getItem(t, id)).toMatchObject({ category: "final_pd", pdNumber: "4", writerInitials: "DW" });
  });

  it("reads the science code from the preview when a move makes a read draft a final PD", async () => {
    const t = convexTest(schema, modules);
    const id = await stage(t, `${CEDARLINE_FY}/Drafts/${PD_NAME}`, { driveItemId: "moving" });
    await markRead(t, id, "Field of science or technology: 2.02.09");
    expect((await getItem(t, id)).scienceCode).toBeUndefined();

    await t.mutation(
      internal.ingestion.upsertDiscoveredItem,
      discoveredArgs(`${CEDARLINE_FY}/To be submitted/${PD_NAME}`, { driveItemId: "moving" })
    );
    const moved = await getItem(t, id);
    expect(moved).toMatchObject({
      category: "final_pd",
      status: "pending_review",
      scienceCode: "2.02.09",
      scienceCodeSource: "document",
    });
    expectInvariants(moved);
  });
});

describe("the science code read from a final PD's text", () => {
  async function processWith(t: T, id: Id<"ingestionItems">, documentScienceCode?: string) {
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["bytes"])));
    await t.mutation(internal.ingestion.markItemProcessed, {
      itemId: id,
      storageId,
      text: "Text",
      ...(documentScienceCode === undefined ? {} : { documentScienceCode }),
    });
  }

  it("stores a final PD's code with its source, which clears the code's check", async () => {
    const t = convexTest(schema, modules);
    const id = await stage(t, `${CEDARLINE_FY}/To be submitted/${PD_NAME}`);
    await processWith(t, id, "2.02.09");
    const row = await getItem(t, id);
    // "DW" from the file name gave it a writer with no login (2026-11-16).
    expect(row).toMatchObject({ scienceCode: "2.02.09", scienceCodeSource: "document", writerName: "DW", checkReasons: [] });
    expectInvariants(row);
  });

  it("stores nothing for other categories or a code that is not real", async () => {
    const t = convexTest(schema, modules);
    const draft = await stage(t, `${CEDARLINE_FY}/Drafts/${PD_NAME}`);
    await processWith(t, draft, "2.02.09");
    expect((await getItem(t, draft)).scienceCode).toBeUndefined();
    const pd = await stage(t, `${CEDARLINE_FY}/To be submitted/${PD_NAME}`);
    await processWith(t, pd, "2.02.99");
    expect(await getItem(t, pd)).toMatchObject({ needsCheck: true, checkReasons: ["no_science_code"] });
    expect((await getItem(t, pd)).scienceCode).toBeUndefined();
  });

  it("keeps a code a person set, and clears only a document code when new bytes arrive", async () => {
    const { t, admin } = await setup();
    const personal = await stage(t, `${CEDARLINE_FY}/To be submitted/${PD_NAME}`, { driveItemId: "a" });
    // A code goes on a file only once it is read (labelApplies).
    await expect(
      admin.mutation(api.ingestion.setSheetLabels, { ids: [personal], patch: { scienceCode: "1.02.01" } })
    ).resolves.toMatchObject({ skipped: [{ id: personal, reason: "does_not_apply" }] });
    await processWith(t, personal, "2.02.09");
    // A person's code replaces the document's.
    await admin.mutation(api.ingestion.setSheetLabels, { ids: [personal], patch: { scienceCode: "1.02.01" } });
    expect(await getItem(t, personal)).toMatchObject({ scienceCode: "1.02.01", scienceCodeSource: "person" });

    const read = await stage(t, `${CEDARLINE_FY}/To be submitted/${PD_NAME}`, { driveItemId: "b" });
    await processWith(t, read, "2.02.09");
    for (const driveItemId of ["a", "b"]) {
      await t.mutation(
        internal.ingestion.upsertDiscoveredItem,
        discoveredArgs(`${CEDARLINE_FY}/To be submitted/${PD_NAME}`, { driveItemId, contentHash: "hash-2" })
      );
    }
    expect(await getItem(t, personal)).toMatchObject({ scienceCode: "1.02.01", scienceCodeSource: "person", status: "discovered" });
    // Read again, the person's code stays.
    await processWith(t, personal, "2.02.09");
    expect(await getItem(t, personal)).toMatchObject({ scienceCode: "1.02.01", scienceCodeSource: "person" });
    const reread = await getItem(t, read);
    expect(reread.scienceCode).toBeUndefined();
    expect(reread.scienceCodeSource).toBeUndefined();
    expectInvariants(reread);
  });

  it("is read from the whole text by the import's extraction", async () => {
    const t = convexTest(schema, modules);
    const id = await stage(t, `${CEDARLINE_FY}/To be submitted/04 CedarlineSystems 2025-03-31 T2.DW Drift.txt`);
    // Past the 8,000-character preview, so only the full text has it.
    const text = `${"Background work. ".repeat(600)}\nField of science or technology: 2.02.09\n`;
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob([text])));
    // A .txt is not a Word file, so make it a final PD the way a person would.
    await t.run((ctx) => ctx.db.patch(id, { status: "fetched", storageId }));
    await t.run(async (ctx) => {
      const row = (await ctx.db.get(id))!;
      const { _id, _creationTime, ...fields } = row;
      await ctx.db.patch(id, settleItem({ ...fields, category: "final_pd", editedLabels: ["category"] }));
    });
    await t.action(internal.ingestionSync.extractUploadedItem, { itemId: id });
    const row = await getItem(t, id);
    const companion = await t.run((ctx) =>
      ctx.db
        .query("ingestionItemTexts")
        .withIndex("by_itemId", (q) => q.eq("itemId", id))
        .unique()
    );
    expect(row.text).toBeUndefined();
    expect(row.textLength).toBe(companion!.text.length);
    expect(companion!.text.length).toBeLessThan(text.length);
    expect(companion!.text).not.toContain("2.02.09");
    expect(row).toMatchObject({ status: "pending_review", scienceCode: "2.02.09", scienceCodeSource: "document" });
  });

  it("is read from the stored preview by the backfill when extraction missed it", async () => {
    const { t, admin } = await setup();
    const preview = "Project summary\nField of science or technology\n2.02.09 Industrial biotechnology\n";
    // Read before the code was read at all: a row staged on main.
    const old = await t.run((ctx) =>
      ctx.db.insert("ingestionItems", {
        ...discoveredArgs(`${CEDARLINE_FY}/To be submitted/${PD_NAME}`, { driveItemId: "old" }),
        status: "pending_review",
        text: preview,
        updatedAt: 1,
      })
    );
    // Settled already, but extraction gave no code.
    const settled = await stage(t, `${CEDARLINE_FY}/Submitted/${PD_NAME}`, { driveItemId: "settled" });
    await markRead(t, settled, preview);
    expect((await getItem(t, settled)).scienceCode).toBeUndefined();
    // Not read by the backfill: a person's code, a file still being read, and an approved file.
    const personal = await stage(t, `${CEDARLINE_FY}/To be submitted/a ${PD_NAME}`, { driveItemId: "personal" });
    await markRead(t, personal, preview);
    await admin.mutation(api.ingestion.setSheetLabels, { ids: [personal], patch: { scienceCode: "1.02.01" } });
    const reading = await stage(t, `${CEDARLINE_FY}/To be submitted/b ${PD_NAME}`, { driveItemId: "reading" });
    await t.run((ctx) => ctx.db.patch(reading, { text: preview }));
    const approved = await stage(t, `${CEDARLINE_FY}/To be submitted/c ${PD_NAME}`, { driveItemId: "approved" });
    await markRead(t, approved, preview);
    await t.run((ctx) => ctx.db.patch(approved, { status: "approved", sheetTab: "approved", needsCheck: false, checkReasons: [] }));
    await t.mutation(internal.ingestion.rebuildImportCompanyCounts, { sheetTab: "review", companyKey: "cedarline systems" });
    await t.mutation(internal.ingestion.rebuildImportCompanyCounts, { sheetTab: "approved", companyKey: "cedarline systems" });
    await t.mutation(internal.ingestion.rebuildImportFinalPdCounts, { pageSize: 200 });

    await t.mutation(internal.ingestion.backfillIngestionLabels, {});
    for (const id of [old, settled]) {
      const row = await getItem(t, id);
      expect(row, row.driveItemId).toMatchObject({
        scienceCode: "2.02.09",
        scienceCodeSource: "document",
        // The backfill's write gives it the writer its initials give (2026-11-16).
        writerName: "DW",
        checkReasons: [],
      });
      expectInvariants(row);
    }
    expect(await getItem(t, personal)).toMatchObject({ scienceCode: "1.02.01", scienceCodeSource: "person" });
    expect((await getItem(t, reading)).scienceCode).toBeUndefined();
    expect((await getItem(t, approved)).scienceCode).toBeUndefined();
    await expectCountsMatchRecount(t, "after the backfill read the previews");
  });
});

// ─── Rows staged before the sheet fields ────────────────────────────────────

describe("a row moved on main, before the move fix", () => {
  /** A PD moved to Halden Foods on main: path says Halden, client and group still say Cedarline. */
  async function staleRow(t: T, status: Doc<"ingestionItems">["status"]) {
    const path = `Halden Foods/2025 - Mar 31/To be submitted/${PD_NAME}`;
    const old = discoveredArgs(`${CEDARLINE_FY}/To be submitted/${PD_NAME}`, { driveItemId: "stale" });
    return await t.run((ctx) =>
      ctx.db.insert("ingestionItems", { ...old, path, status, text: "Old", updatedAt: 1 })
    );
  }

  async function transcriptIn(t: T, folder: string) {
    const id = await stage(t, `${folder}/WIP/Technical/Audio/interview.txt`, { driveItemId: folder });
    await markRead(t, id);
    return id;
  }

  it("moves to the path's company on its next write, and both groups are recomputed", async () => {
    // attachUpload schedules the extraction; fake timers keep it from running.
    vi.useFakeTimers();
    try {
      const t = convexTest(schema, modules);
      const cedarline = await transcriptIn(t, CEDARLINE_FY);
      const halden = await transcriptIn(t, "Halden Foods/2025 - Mar 31");
      const id = await staleRow(t, "discovered");
      await t.mutation(internal.ingestion.recomputePairs, {
        groupKeys: ["cedarline systems::2025", "halden foods::2025"],
      });
      expect(await getItem(t, cedarline)).toMatchObject({ pairStatus: "paired" });
      expect(await getItem(t, halden)).toMatchObject({ pairStatus: "missing_pd" });

      const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["bytes"])));
      await t.mutation(internal.ingestion.attachUpload, { itemId: id, storageId });
      const row = await getItem(t, id);
      expect(row).toMatchObject({ clientName: "Halden Foods", pairGroupKey: "halden foods::2025", status: "fetched" });
      expectInvariants(row);
      // Its new group in the same mutation; the one it left by a scheduled run.
      expect(await getItem(t, halden)).toMatchObject({ pairStatus: "paired" });
      expect(await runPairing(t)).toEqual([["cedarline systems::2025"]]);
      expect(await getItem(t, cedarline)).toMatchObject({ pairStatus: "missing_pd" });
      await expectCountsMatchRecount(t, "after settling a stale row");
    } finally {
      vi.useRealTimers();
    }
  });

  it("is moved by the backfill, which schedules both groups' pairing", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema, modules);
      const cedarline = await transcriptIn(t, CEDARLINE_FY);
      const halden = await transcriptIn(t, "Halden Foods/2025 - Mar 31");
      await staleRow(t, "pending_review");
      await t.mutation(internal.ingestion.recomputePairs, {
        groupKeys: ["cedarline systems::2025", "halden foods::2025"],
      });
      await t.mutation(internal.ingestion.backfillIngestionLabels, {});
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      expect(await getItem(t, cedarline)).toMatchObject({ pairStatus: "missing_pd" });
      expect(await getItem(t, halden)).toMatchObject({ pairStatus: "paired" });
      await expectCountsMatchRecount(t, "after the backfill");
    } finally {
      vi.useRealTimers();
    }
  });
});

// ─── Writers from initials (2026-11-12, 2026-11-16) ─────────────────────────

/** A read final PD whose name gives these initials, with its science code read, so only the writer is left. */
async function pdBy(t: T, initials: string, n: number, folder = CEDARLINE_FY) {
  const name = `${String(n).padStart(2, "0")} CedarlineSystems 2025-03-31 T1.${initials} Project${n}.docx`;
  const id = await stage(t, `${folder}/To be submitted/${name}`, { driveItemId: `${initials}-${n}-${folder}` });
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["bytes"])));
  await t.mutation(internal.ingestion.markItemProcessed, { itemId: id, storageId, text: "Text", documentScienceCode: "2.02.09" });
  return id;
}

/** A team member with a login, with these saved initials (or none saved). */
async function addMember(
  t: T,
  firstName: string,
  lastName: string,
  options: { initials?: string; role?: "writer" | "manager" | "admin" } = {}
): Promise<Id<"users">> {
  return await t.run((ctx) =>
    ctx.db.insert("users", {
      authId: `member-${firstName}-${lastName}`,
      firstName,
      lastName,
      role: options.role ?? "writer",
      ...(options.initials === undefined ? {} : { initials: options.initials }),
    })
  );
}

async function allWriters(t: T) {
  return await t.run((ctx) => ctx.db.query("pdWriters").collect());
}

async function writerOf(t: T, id: Id<"ingestionItems">) {
  const row = await getItem(t, id);
  return row.writerId ? await t.run((ctx) => ctx.db.get(row.writerId!)) : null;
}

/** The writer's label the sheet shows for a file (as it is now). */
async function shownWriter(admin: ReturnType<T["withIdentity"]>, id: Id<"ingestionItems">) {
  const file = await admin.query(api.ingestion.sheetFile, { id });
  return { name: file?.writerName, hasLogin: file?.writerHasLogin };
}

/** Rows written straight in, settled and counted but with no writer yet (as before 2026-11-16). */
async function insertRaw(t: T, rows: Array<{ path: string; driveItemId: string; extra?: Partial<Doc<"ingestionItems">> }>) {
  return await t.run(async (ctx) => {
    const ids: Array<Id<"ingestionItems">> = [];
    for (const { path, driveItemId, extra } of rows) {
      const fields = settleItem({
        ...discoveredArgs(path, { driveItemId }),
        status: "pending_review",
        text: "Text",
        scienceCode: "2.02.09",
        scienceCodeSource: "document",
        updatedAt: 1,
        ...extra,
      });
      const row = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as typeof fields;
      ids.push(await ctx.db.insert("ingestionItems", row));
      await adjustImportCompanyCounts(ctx, null, row);
      await adjustImportFinalPdCounts(ctx, null, row);
    }
    return ids;
  });
}

const pdPath = (initials: string, n: number) =>
  `${CEDARLINE_FY}/To be submitted/${String(n).padStart(2, "0")} CedarlineSystems 2025-03-31 T1.${initials} Project${n}.docx`;

/** A member's own writer (not a past writer linked to them). */
async function ownWriterOf(t: T, userId: Id<"users">) {
  const rows = await t.run((ctx) => ctx.db.query("pdWriters").withIndex("by_userId", (q) => q.eq("userId", userId)).collect());
  return rows.find((row) => row.linkedAt === undefined) ?? null;
}

/** Every file's writer and source, and every pick: what Link and Unlink never change. */
async function writerPointers(t: T) {
  return await t.run(async (ctx) => ({
    files: (await ctx.db.query("ingestionItems").collect()).map((row) => [
      row._id,
      row.writerId ?? null,
      row.writerNameSource ?? null,
      // 2026-11-17: the reviewer never moves on a Link or Unlink either.
      row.reviewerId ?? null,
      row.reviewerSource ?? null,
    ]),
    picks: (await ctx.db.query("pdWriterPicks").collect()).map((pick) => [pick.initials, pick.writerId]),
  }));
}

/** Every file's writer and source, and every pick, to compare a state before and after. */
async function writerState(t: T) {
  return await t.run(async (ctx) => ({
    files: (await ctx.db.query("ingestionItems").collect()).map((row) => [
      row._id,
      row.writerId ?? null,
      row.writerNameSource ?? null,
      row.writerName ?? null,
      row.writerBeforePick ?? null,
      // 2026-11-17: a pick and its Undo put the reviewer back exactly too.
      row.reviewerId ?? null,
      row.reviewerSource ?? null,
      row.reviewerBeforePick ?? null,
    ]),
    picks: (await ctx.db.query("pdWriterPicks").collect()).map((pick) => [pick.initials, pick.writerId]),
  }));
}

describe("the writer check on each imported file", () => {
  it("gives a file the one team member whose saved initials are its own, however the file arrives", async () => {
    const { t, admin } = await setup();
    const dana = await addMember(t, "Dana", "Whitlock", { initials: "DW" });
    // OneDrive sync, one file.
    const sync = await stage(t, pdPath("DW", 1));
    // The client uploader.
    const uploader = await t.mutation(internal.ingestion.upsertDiscoveredItem, {
      ...discoveredArgs(pdPath("DW", 2), { driveItemId: `local:${pdPath("DW", 2)}` }),
      via: "uploader",
    });
    // OneDrive sync, a page of files.
    await t.mutation(internal.ingestion.upsertDiscoveredBatch, { items: [discoveredArgs(pdPath("DW", 3), { driveItemId: "batch-3" })] });
    const batch = (await t.run((ctx) => ctx.db.query("ingestionItems").withIndex("by_driveItemId", (q) => q.eq("driveItemId", "batch-3")).unique()))!._id;
    // A drop on the Import page.
    const bytes = await uploaded(t, "Dana's PD");
    const batchId = await admin.mutation(api.ingestion.startImportBatch, { toSend: 1, alreadyHere: 0 });
    await admin.mutation(api.ingestion.stageImportFiles, { batchId, files: [{ path: pdPath("DW", 4), ...bytes, lastModifiedAt: 1 }] });
    const dropped = (await itemAt(t, pdPath("DW", 4)))._id;
    // Put back: a file deleted while two people had KT (no writer); once only
    // Kim has KT, putting it back gives it Kim.
    const kim = await addMember(t, "Kim", "Tran", { initials: "KT" });
    const jordan = await addMember(t, "Jordan", "Ellis", { initials: "KT" });
    const putBack = await pdBy(t, "KT", 5);
    expect((await getItem(t, putBack)).writerId).toBeUndefined();
    await admin.mutation(api.ingestion.removeItems, { ids: [putBack] });
    await t.run((ctx) => ctx.db.patch(jordan, { initials: "JE" }));
    await admin.mutation(api.ingestion.restoreItems, { ids: [putBack] });

    const danaWriter = (await ownWriterOf(t, dana))!;
    for (const id of [sync, uploader!, batch, dropped]) {
      expect(await getItem(t, id), id).toMatchObject({ writerId: danaWriter._id, writerName: "Dana Whitlock", writerNameSource: "initials" });
      expect(await shownWriter(admin, id)).toEqual({ name: "Dana Whitlock", hasLogin: true });
    }
    expect(await getItem(t, putBack)).toMatchObject({ writerId: (await ownWriterOf(t, kim))!._id, needsCheck: false, checkReasons: [] });
    expect(danaWriter.fileCount).toBe(4);
    await expectCountsMatchRecount(t, "after five ways in");
  });

  it("gives no writer when two team members share the initials, so the file waits for a person to choose", async () => {
    const { t, admin } = await setup();
    await addMember(t, "Kim", "Tran", { initials: "KT" });
    // An Admin gave Jordan the same initials.
    await addMember(t, "Jordan", "Ellis", { initials: "KT" });
    const pd = await pdBy(t, "KT", 1);
    const row = await getItem(t, pd);
    expect(row.writerId).toBeUndefined();
    expect(row.writerName).toBeUndefined();
    expect(row).toMatchObject({ needsCheck: true, checkReasons: ["unmatched_initials"] });
    expect(await allWriters(t)).toEqual([]);
    const bands = await admin.query(api.ingestion.sheetCompanies, { tab: "review", onlyToCheck: true, paginationOpts: PAGE });
    expect(bands.page[0].categories.final_pd.checkReasons).toEqual({ unmatched_initials: 1 });
    await expectCountsMatchRecount(t, "after a file two people could have written");
  });

  it("makes one writer with no login from new initials and gives it every later file; two such writers mean a person chooses", async () => {
    const { t, admin } = await setup();
    const first = await pdBy(t, "SO", 1);
    const second = await pdBy(t, "SO", 2);
    const writers = await allWriters(t);
    expect(writers).toHaveLength(1);
    expect(writers[0]).toMatchObject({ initials: "SO", createdVia: "import", fileCount: 2 });
    expect(writers[0].name).toBeUndefined();
    expect(writers[0].userId).toBeUndefined();
    for (const id of [first, second]) expect(await shownWriter(admin, id)).toEqual({ name: "SO", hasLogin: false });
    // A writer a person made with these initials (the migration of a match) is not one the check made: it does not count.
    await t.run((ctx) => ctx.db.insert("pdWriters", { initials: "SO", name: "Sam Okafor", createdVia: "person", createdAt: 1, fileCount: 0 }));
    expect((await getItem(t, await pdBy(t, "SO", 3))).writerId).toBe(writers[0]._id);
    // A second writer the check made from SO: it never guesses between them.
    await t.run((ctx) => ctx.db.insert("pdWriters", { initials: "SO", createdVia: "import", createdAt: 1, fileCount: 0 }));
    const fourth = await pdBy(t, "SO", 4);
    expect((await getItem(t, fourth)).writerId).toBeUndefined();
    expect((await getItem(t, fourth)).checkReasons).toEqual(["unmatched_initials"]);
    await expectCountsMatchRecount(t, "after two writers with the same initials");
  });

  it("gives no writer to a file whose name has no initials, nor to a file whose category takes none", async () => {
    const { t } = await setup();
    const bare = await stage(t, `${CEDARLINE_FY}/To be submitted/pd.docx`);
    await markRead(t, bare);
    expect(await getItem(t, bare)).toMatchObject({ checkReasons: ["no_science_code", "no_writer"] });
    const pd = await pdBy(t, "SO", 1);
    expect((await getItem(t, pd)).writerName).toBe("SO");
    // Moved to Transcripts: a transcript takes no writer, so it loses the one its initials gave, and the bare writer goes.
    await t.mutation(internal.ingestion.upsertDiscoveredItem, {
      ...discoveredArgs(`${CEDARLINE_FY}/WIP/Technical/Audio/01 CedarlineSystems 2025-03-31 T1.SO Project1.docx`, {
        driveItemId: `SO-1-${CEDARLINE_FY}`,
      }),
    });
    const moved = await getItem(t, pd);
    expect(moved.category).toBe("transcript");
    expect(moved.writerId).toBeUndefined();
    expect(await allWriters(t)).toEqual([]);
    await expectCountsMatchRecount(t, "after a file that takes no writer");
  });

  it("keeps a file's writer once it has one: new saved initials and an edit to the file never move it (the freeze rule)", async () => {
    const { t, admin } = await setup();
    const frozen = await pdBy(t, "DW", 1);
    const pastDw = (await writerOf(t, frozen))!;
    // Dana saves her name on Settings: her initials are prefilled as DW.
    const dana = await addMember(t, "Dana", "Whitlock");
    await t.withIdentity({ subject: "member-Dana-Whitlock" }).mutation(api.users.updateMyProfile, { firstName: "Dana", lastName: "Whitlock" });
    expect((await t.run((ctx) => ctx.db.get(dana)))?.initials).toBe("DW");
    // Editing the file (its science code, its year) never runs the match again.
    await admin.mutation(api.ingestion.setSheetLabels, { ids: [frozen], patch: { scienceCode: "1.02.01" } });
    await admin.mutation(api.ingestion.setSheetLabels, { ids: [frozen], patch: { fiscalYearEnd: Date.UTC(2024, 11, 31) } });
    expect(await getItem(t, frozen)).toMatchObject({ writerId: pastDw._id, writerName: "DW", writerNameSource: "initials" });
    // Nor does an Admin changing her initials (away and back).
    await admin.mutation(api.users.setUserInitials, { userId: dana, initials: "DN" });
    await admin.mutation(api.users.setUserInitials, { userId: dana, initials: "DW" });
    await runWriterWalk(t);
    expect((await getItem(t, frozen)).writerId).toBe(pastDw._id);
    // A new DW file is hers; the Team hint is the way to move the old ones.
    expect((await writerOf(t, await pdBy(t, "DW", 2)))?.userId).toBe(dana);
    expect((await admin.query(api.users.listPastWriters, {}))[0]).toMatchObject({
      _id: pastDw._id,
      sameInitialsAs: { userId: dana, name: "Dana Whitlock", canLink: true },
    });
    await expectCountsMatchRecount(t, "after the facts changed under a frozen file");
  });

  it("keeps a writer a person set on one file over the check, a pick and a change of initials", async () => {
    const { t, admin } = await setup();
    const own = await pdBy(t, "KT", 1);
    const other = await pdBy(t, "KT", 2);
    await admin.mutation(api.ingestion.setSheetLabels, { ids: [own], patch: { writer: { kind: "name", name: "Jordan Ellis" } } });
    expect(await getItem(t, own)).toMatchObject({ writerName: "Jordan Ellis", writerNameSource: "person" });
    expect(await writerOf(t, own)).toMatchObject({ name: "Jordan Ellis", createdVia: "person" });
    expect((await writerOf(t, own))?.initials).toBeUndefined();
    await admin.mutation(api.ingestion.matchWriterInitials, { initials: "KT", writer: { kind: "name", name: "Kim Tran" } });
    expect(await getItem(t, other)).toMatchObject({ writerName: "Kim Tran", writerNameSource: "pick" });
    expect(await getItem(t, own)).toMatchObject({ writerName: "Jordan Ellis", writerNameSource: "person" });
    // A member with KT: the pick a person made still wins, and the file a person set keeps its writer.
    const kim = await addMember(t, "Kim", "Tran");
    await admin.mutation(api.users.setUserInitials, { userId: kim, initials: "kt" });
    await runWriterWalk(t);
    expect(await getItem(t, own)).toMatchObject({ writerName: "Jordan Ellis", writerNameSource: "person" });
    expect((await writerOf(t, other))?.userId).toBeUndefined();
    // The same name typed again is the same writer, not a second one.
    await admin.mutation(api.ingestion.setSheetLabels, { ids: [other], patch: { writer: { kind: "name", name: "Jordan  Ellis" } } });
    expect((await getItem(t, other)).writerId).toBe((await getItem(t, own)).writerId);
    await expectCountsMatchRecount(t, "after a file's own writer");
  });
});

describe("matchWriterInitials", () => {
  it("says which writer the initials are for the whole firm, and Undo takes the pick away", async () => {
    const { t, admin } = await setup();
    const kim = await addMember(t, "Kim", "Tran", { initials: "KT" });
    await addMember(t, "Jordan", "Ellis", { initials: "KT" });
    const kt1 = await pdBy(t, "KT", 1);
    const kt2 = await pdBy(t, "KT", 2);
    const dw = await pdBy(t, "DW", 3);
    // Before: two people have KT, so a person must choose.
    expect(await getItem(t, kt1)).toMatchObject({ needsCheck: true, checkReasons: ["unmatched_initials"] });

    const result = await admin.mutation(api.ingestion.matchWriterInitials, { initials: "kt", writer: { kind: "user", userId: kim } });
    const kimWriter = (await ownWriterOf(t, kim))!;
    expect(result).toEqual({ initials: "KT", writerId: kimWriter._id, writerName: "Kim Tran", previous: null, changed: 2, more: false });
    for (const id of [kt1, kt2]) {
      const row = await getItem(t, id);
      // Not a writer set on the file: it follows the pick.
      expect(row).toMatchObject({ writerId: kimWriter._id, writerName: "Kim Tran", writerNameSource: "pick", needsCheck: false, checkReasons: [] });
      expect(row.editedLabels ?? []).not.toContain("writerName");
    }
    // Other initials are left alone.
    expect((await getItem(t, dw)).writerName).toBe("DW");
    await expectCountsMatchRecount(t, "after the pick");

    // Undo: no pick, so the check decides again (two people: choose).
    await expect(admin.mutation(api.ingestion.matchWriterInitials, { initials: "KT", writer: result.previous })).resolves.toEqual({
      initials: "KT",
      writerId: null,
      writerName: null,
      // A member's writer is never removed, so a later Undo always finds it by id.
      previous: { kind: "writer", writerId: kimWriter._id },
      changed: 2,
      more: false,
    });
    for (const id of [kt1, kt2]) {
      const row = await getItem(t, id);
      expect(row.writerId).toBeUndefined();
      expect(row.writerNameSource).toBeUndefined();
      expect(row.checkReasons).toEqual(["unmatched_initials"]);
    }
    expect(await t.run((ctx) => ctx.db.query("pdWriterPicks").collect())).toEqual([]);
    // A member's writer is never removed, even with no file left.
    expect(await t.run((ctx) => ctx.db.get(kimWriter._id))).toMatchObject({ fileCount: 0 });
    // The old table is not written any more.
    expect(await t.run((ctx) => ctx.db.query("importWriterInitials").collect())).toEqual([]);
    await expectCountsMatchRecount(t, "after the Undo");
  });

  it("undoes a second pick back to the first, even when the first writer's last file left it", async () => {
    const { t, admin } = await setup();
    const kim = await addMember(t, "Kim", "Tran", { initials: "KT" });
    const jordan = await addMember(t, "Jordan", "Ellis", { initials: "KT" });
    const kt = await pdBy(t, "KT", 1);
    await admin.mutation(api.ingestion.matchWriterInitials, { initials: "KT", writer: { kind: "user", userId: kim } });
    const kimWriter = (await ownWriterOf(t, kim))!;
    const second = await admin.mutation(api.ingestion.matchWriterInitials, { initials: "KT", writer: { kind: "user", userId: jordan } });
    expect(second.previous).toEqual({ kind: "writer", writerId: kimWriter._id });
    expect((await getItem(t, kt)).writerName).toBe("Jordan Ellis");
    // Kim's writer has no file left, and stays: a writer with an account is never removed.
    expect(await t.run((ctx) => ctx.db.get(kimWriter._id))).toMatchObject({ fileCount: 0 });
    await admin.mutation(api.ingestion.matchWriterInitials, { initials: "KT", writer: second.previous });
    expect(await getItem(t, kt)).toMatchObject({ writerId: kimWriter._id, writerName: "Kim Tran" });

    // A bare writer no file had before the pick: picked, then replaced, it is removed; Undo brings back an equal one.
    const dw = await pdBy(t, "DW", 2);
    const own = (await writerOf(t, dw))!;
    const spare = await t.run((ctx) => ctx.db.insert("pdWriters", { initials: "DW", createdVia: "import", createdAt: 1, fileCount: 0 }));
    await admin.mutation(api.ingestion.matchWriterInitials, { initials: "DW", writer: { kind: "writer", writerId: spare } });
    const replaced = await admin.mutation(api.ingestion.matchWriterInitials, { initials: "DW", writer: { kind: "name", name: "Sam Okafor" } });
    expect(replaced.previous).toEqual({ kind: "writer", writerId: spare, orInitials: "DW" });
    expect(await t.run((ctx) => ctx.db.get(spare))).toBeNull();
    // The file's own writer is kept for it: it had that one before the picks.
    expect(await t.run((ctx) => ctx.db.get(own._id))).toMatchObject({ fileCount: 0, heldCount: 1 });
    await expect(admin.mutation(api.ingestion.matchWriterInitials, { initials: "DW", writer: replaced.previous })).resolves.toMatchObject({
      writerName: "DW",
      changed: 1,
    });
    expect(await getItem(t, dw)).toMatchObject({ writerName: "DW", writerNameSource: "pick" });
    // The last Undo: exactly the writer it had at first.
    await admin.mutation(api.ingestion.matchWriterInitials, { initials: "DW", writer: null });
    expect(await getItem(t, dw)).toMatchObject({ writerId: own._id, writerName: "DW", writerNameSource: "initials" });
    expect((await getItem(t, dw)).writerBeforePick).toBeUndefined();
    await expectCountsMatchRecount(t, "after the Undos");
  });

  it("makes a writer with no login and no initials for a typed name, and its Undo gives the files back to the check", async () => {
    const { t, admin } = await setup();
    const pd = await pdBy(t, "SO", 1);
    const result = await admin.mutation(api.ingestion.matchWriterInitials, { initials: "SO", writer: { kind: "name", name: " Sam  Okafor " } });
    expect(result).toMatchObject({ writerName: "Sam Okafor", changed: 1, previous: null });
    const writers = await allWriters(t);
    // The typed writer carries no initials (the pick does). The bare "SO"
    // writer has no file now, and is kept: the file remembers it.
    const typed = writers.find((writer) => writer.name === "Sam Okafor")!;
    expect(typed).toMatchObject({ createdVia: "person", fileCount: 1 });
    expect(typed.initials).toBeUndefined();
    const bare = writers.find((writer) => writer.initials === "SO")!;
    expect(bare).toMatchObject({ fileCount: 0, heldCount: 1 });
    expect(await shownWriter(admin, pd)).toEqual({ name: "Sam Okafor", hasLogin: false });
    // The same name again is the same writer.
    await admin.mutation(api.ingestion.matchWriterInitials, { initials: "SO", writer: { kind: "name", name: "Sam Okafor" } });
    expect(await allWriters(t)).toHaveLength(2);
    // Undo: never "Choose writer", never stuck on Sam Okafor: exactly the SO writer it had.
    await admin.mutation(api.ingestion.matchWriterInitials, { initials: "SO", writer: null });
    expect(await getItem(t, pd)).toMatchObject({ writerId: bare._id, writerName: "SO", writerNameSource: "initials", checkReasons: [] });
    await expectCountsMatchRecount(t, "after a typed writer and its Undo");
  });

  it("follows on files that come later or are put back, and never on an approved file", async () => {
    const { t, admin } = await setup();
    const deleted = await pdBy(t, "KT", 1);
    await admin.mutation(api.ingestion.removeItems, { ids: [deleted] });
    const approved = await pdBy(t, "KT", 2);
    await approveForTest(t, admin, approved);
    const approvedWriter = (await getItem(t, approved)).writerId;
    await admin.mutation(api.ingestion.matchWriterInitials, { initials: "KT", writer: { kind: "name", name: "Kim Tran" } });
    await runWriterWalk(t);
    // The Deleted tab is walked after To review, so a file put back shows the writer too.
    expect(await getItem(t, deleted)).toMatchObject({ status: "deleted", writerName: "Kim Tran", writerNameSource: "pick" });
    // An approved file keeps what it was approved as.
    expect(await getItem(t, approved)).toMatchObject({ writerId: approvedWriter, writerName: "KT" });
    // A file staged after the pick takes the writer as it is staged.
    const later = await pdBy(t, "KT", 3);
    expect(await getItem(t, later)).toMatchObject({ writerName: "Kim Tran", writerNameSource: "pick", checkReasons: [] });
    await admin.mutation(api.ingestion.restoreItems, { ids: [deleted] });
    expect(await getItem(t, deleted)).toMatchObject({ status: "pending_review", writerName: "Kim Tran", checkReasons: [] });
    // A rename to other initials takes the writer those give.
    await t.mutation(
      internal.ingestion.upsertDiscoveredItem,
      discoveredArgs(`${CEDARLINE_FY}/To be submitted/03 CedarlineSystems 2025-03-31 T1.MN Project3.docx`, {
        driveItemId: `KT-3-${CEDARLINE_FY}`,
      })
    );
    expect(await getItem(t, later)).toMatchObject({ writerInitials: "MN", writerName: "MN", writerNameSource: "initials", checkReasons: [] });
    await expectCountsMatchRecount(t, "after later files");
  });

  it("changes 100 files in the call and the rest in scheduled runs, keeping the counts right", async () => {
    const { t, admin } = await setup();
    // 120 files on To review, two people with KT: rows written straight in (staging each would be slow).
    await twoMembersWith(t, "KT");
    await insertRaw(
      t,
      Array.from({ length: 120 }, (_, i) => ({ path: pdPath("KT", (i % 20) + 1).replace("Project", `P${i} Project`), driveItemId: `many-${i}` }))
    );
    const result = await admin.mutation(api.ingestion.matchWriterInitials, { initials: "KT", writer: { kind: "name", name: "Kim Tran" } });
    expect(result).toMatchObject({ changed: 100, more: true });
    const named = async () => (await t.run((ctx) => ctx.db.query("ingestionItems").collect())).filter((row) => row.writerName === "Kim Tran").length;
    expect(await named()).toBe(100);
    // The rest of To review, then Deleted; then the reviewers' To review and Deleted (2026-11-17).
    expect(await runWriterWalk(t)).toMatchObject({ applyWriterInitials: 4 });
    expect(await named()).toBe(120);
    await expectCountsMatchRecount(t, "after 120 files");
    const { stored } = await countsNowAndRecount(t);
    expect(stored["review|cedarline systems"]).toMatchObject({ needsCheck: 0, ready: 120 });
  });

  it("refuses anyone but an admin, initials that are not initials, an email address and a writer that is gone", async () => {
    const { t, admin, writer } = await setup();
    const kim = { kind: "name" as const, name: "Kim Tran" };
    await expect(writer.mutation(api.ingestion.matchWriterInitials, { initials: "KT", writer: kim })).rejects.toThrow(/Admin only/);
    await expect(admin.mutation(api.ingestion.matchWriterInitials, { initials: "K", writer: kim })).rejects.toThrow(
      "Initials are two or three letters, such as KT."
    );
    await expect(
      admin.mutation(api.ingestion.matchWriterInitials, { initials: "KT", writer: { kind: "name", name: "kim.tran@example.com" } })
    ).rejects.toThrow("Type the writer's name, not an email address.");
    const gone = await t.run(async (ctx) => {
      const id = await ctx.db.insert("pdWriters", { initials: "KT", createdVia: "import", createdAt: 1, fileCount: 0 });
      await ctx.db.delete(id);
      return id;
    });
    await expect(
      admin.mutation(api.ingestion.matchWriterInitials, { initials: "KT", writer: { kind: "writer", writerId: gone } })
    ).rejects.toThrow("That writer is no longer in Banhall.");
    expect(await t.run((ctx) => ctx.db.query("pdWriterPicks").collect())).toEqual([]);
  });
});

describe("files checked again when the facts change", () => {
  it("fills the files that have no writer after an Admin sets a member's initials, in pages, on To review and Deleted only", async () => {
    const { t, admin } = await setup();
    const kim = await addMember(t, "Kim", "Tran", { initials: "KT" });
    const jordan = await addMember(t, "Jordan", "Ellis", { initials: "KT" });
    const deleted = await pdBy(t, "KT", 1);
    await admin.mutation(api.ingestion.removeItems, { ids: [deleted] });
    const approved = await pdBy(t, "KT", 2);
    // Approve needs a writer (2026-11-17): a person names one on this file.
    await admin.mutation(api.ingestion.setSheetLabels, { ids: [approved], patch: { writerName: "Robin Sample" } });
    await approveForTest(t, admin, approved);
    const approvedWriter = (await getItem(t, approved)).writerId;
    const review = await insertRaw(
      t,
      Array.from({ length: 104 }, (_, i) => ({ path: pdPath("KT", (i % 20) + 1).replace("Project", `P${i} Project`), driveItemId: `kt-${i}` }))
    );

    const saved = await admin.mutation(api.users.setUserInitials, { userId: jordan, initials: " je " });
    expect(saved).toEqual({ initials: "JE", sharedWith: [] });
    // Nothing moves in the call itself: the files follow in scheduled pages of 100.
    expect((await getItem(t, review[0])).writerId).toBeUndefined();
    const runs = await runWriterWalk(t);
    // KT: To review in two pages, then Deleted; JE: To review, then Deleted;
    // and for each, the reviewers' To review and Deleted (2026-11-17).
    expect(runs).toMatchObject({ applyWriterInitials: 9 });
    const kimWriter = (await ownWriterOf(t, kim))!;
    for (const id of [...review, deleted]) expect((await getItem(t, id)).writerId, id).toBe(kimWriter._id);
    // An approved file keeps what it was approved with (the writer a person named).
    expect((await getItem(t, approved)).writerId).toBe(approvedWriter);
    await expectCountsMatchRecount(t, "after Jordan's initials");

    // Kim's initials change: her files keep her (frozen).
    await admin.mutation(api.users.setUserInitials, { userId: kim, initials: "KM" });
    await runWriterWalk(t);
    expect((await getItem(t, review[0])).writerId).toBe(kimWriter._id);
    // Empty means no initials.
    await expect(admin.mutation(api.users.setUserInitials, { userId: kim, initials: "" })).resolves.toEqual({ initials: "", sharedWith: [] });
    expect((await t.run((ctx) => ctx.db.get(kim)))?.initials).toBe("");
    await expectCountsMatchRecount(t, "after Kim's initials changed");
  });

  it("says which other members already have the initials, and refuses initials that are not 1 to 4 letters", async () => {
    const { t, admin } = await setup();
    await addMember(t, "Kim", "Tran", { initials: "KT" });
    const jordan = await addMember(t, "Jordan", "Ellis");
    await expect(admin.mutation(api.users.setUserInitials, { userId: jordan, initials: "kt" })).resolves.toEqual({
      initials: "KT",
      sharedWith: ["Kim Tran"],
    });
    for (const bad of ["K1", "ABCDE", "K T", "É"]) {
      await expect(admin.mutation(api.users.setUserInitials, { userId: jordan, initials: bad }), bad).rejects.toThrow(
        "Initials are 1 to 4 letters, such as DW."
      );
    }
    await expect(admin.mutation(api.users.setUserInitials, { userId: jordan, initials: "J" })).resolves.toMatchObject({ initials: "J" });
  });

  it("shows a past writer's new name on every file at once, and writes its files on To review and Deleted again", async () => {
    const { t, admin } = await setup();
    const open = await pdBy(t, "SO", 1);
    const deleted = await pdBy(t, "SO", 2);
    await admin.mutation(api.ingestion.removeItems, { ids: [deleted] });
    const approved = await pdBy(t, "SO", 3);
    await approveForTest(t, admin, approved);
    const so = (await writerOf(t, open))!;

    await expect(admin.mutation(api.users.renamePastWriter, { writerId: so._id, name: " Sam  Okafor " })).resolves.toEqual({ label: "Sam Okafor" });
    // Shown at once everywhere, approved files too: the sheet reads the writer's label.
    for (const id of [open, deleted, approved]) expect((await shownWriter(admin, id)).name).toBe("Sam Okafor");
    expect((await getItem(t, open)).writerName).toBe("SO");
    await runWriterWalk(t);
    expect((await getItem(t, open)).writerName).toBe("Sam Okafor");
    expect((await getItem(t, deleted)).writerName).toBe("Sam Okafor");
    // The approved file keeps the name it was approved with.
    expect((await getItem(t, approved)).writerName).toBe("SO");
    // An empty name goes back to the initials.
    await expect(admin.mutation(api.users.renamePastWriter, { writerId: so._id, name: "" })).resolves.toEqual({ label: "SO" });
    await expectCountsMatchRecount(t, "after the renames");
  });

  it("links a past writer to a member, so its PDs, approved ones too, show under that person; Unlink takes it back", async () => {
    const { t, admin } = await setup();
    const open = await pdBy(t, "SO", 1);
    const approved = await pdBy(t, "SO", 2);
    await approveForTest(t, admin, approved);
    const so = (await writerOf(t, open))!;
    const sam = await addMember(t, "Sam", "Okafor", { initials: "SK" });
    const past = await admin.query(api.users.listPastWriters, {});
    expect(past).toEqual([{ _id: so._id, name: null, initials: "SO", label: "SO", nameFromDocument: false, fileCount: 2, reviewCount: 0, canDelete: false, invitePending: false, staffRole: null, isActive: false, weight: null, sameInitialsAs: null }]);

    await expect(admin.mutation(api.users.linkPastWriter, { writerId: so._id, userId: sam })).resolves.toEqual({ label: "Sam Okafor" });
    for (const id of [open, approved]) expect(await shownWriter(admin, id)).toEqual({ name: "Sam Okafor", hasLogin: true });
    await runWriterWalk(t);
    expect((await getItem(t, open)).writerName).toBe("Sam Okafor");
    // Later SO files are Sam's too: the writer made from SO is his now.
    const later = await pdBy(t, "SO", 3);
    expect((await getItem(t, later)).writerId).toBe(so._id);
    expect(await admin.query(api.users.listPastWriters, {})).toEqual([]);
    const members = await admin.query(api.team.listMembers, {});
    expect(members.find((member) => member._id === sam)).toMatchObject({
      initials: "SK",
      linkedWriter: { writerId: so._id, label: "SO", initials: "SO", fileCount: 3 },
    });
    // One past writer per account.
    const other = (await writerOf(t, await pdBy(t, "PN", 4)))!;
    await expect(admin.mutation(api.users.linkPastWriter, { writerId: other._id, userId: sam })).rejects.toThrow(
      "Sam Okafor already has past PDs linked. Unlink them first."
    );
    await expectCountsMatchRecount(t, "after the link");

    await admin.mutation(api.users.unlinkPastWriter, { writerId: so._id });
    await runWriterWalk(t);
    expect(await shownWriter(admin, open)).toEqual({ name: "SO", hasLogin: false });
    expect((await admin.query(api.users.listPastWriters, {})).map((row) => row.label)).toEqual(["PN", "SO"]);
    await expectCountsMatchRecount(t, "after the unlink");
  });

  it("puts back exactly what there was when a link is undone: a person's writer and a pick stay with the member", async () => {
    const { t, admin } = await setup();
    const dana = await addMember(t, "Dana", "Whitlock");
    // Scenario A: an Admin set Dana on file X; DW is a past writer from file Y.
    const x = await pdBy(t, "DW", 1);
    await admin.mutation(api.ingestion.setSheetLabels, { ids: [x], patch: { writer: { kind: "user", userId: dana } } });
    const y = await pdBy(t, "DW", 2);
    const dw = (await writerOf(t, y))!;
    // Scenario B: a pick says DX is Dana; DZ is another past writer.
    const z = await pdBy(t, "DX", 3);
    await admin.mutation(api.ingestion.matchWriterInitials, { initials: "DX", writer: { kind: "user", userId: dana } });
    const q = await pdBy(t, "DZ", 4);
    const dz = (await writerOf(t, q))!;
    await runWriterWalk(t);
    const before = await writerState(t);

    await admin.mutation(api.users.linkPastWriter, { writerId: dw._id, userId: dana });
    await runWriterWalk(t);
    for (const id of [x, y, z]) expect((await shownWriter(admin, id)).name, id).toBe("Dana Whitlock");
    await admin.mutation(api.users.unlinkPastWriter, { writerId: dw._id });
    await runWriterWalk(t);
    expect(await shownWriter(admin, x)).toEqual({ name: "Dana Whitlock", hasLogin: true });
    expect(await getItem(t, x)).toMatchObject({ writerNameSource: "person" });
    expect(await shownWriter(admin, y)).toEqual({ name: "DW", hasLogin: false });

    // The other past writer, linked and unlinked: the DX files stay Dana's.
    await admin.mutation(api.users.linkPastWriter, { writerId: dz._id, userId: dana });
    await runWriterWalk(t);
    await admin.mutation(api.users.unlinkPastWriter, { writerId: dz._id });
    await runWriterWalk(t);
    expect(await shownWriter(admin, z)).toEqual({ name: "Dana Whitlock", hasLogin: true });
    expect(await shownWriter(admin, q)).toEqual({ name: "DZ", hasLogin: false });
    expect(await writerState(t)).toEqual(before);
    await expectCountsMatchRecount(t, "after link and unlink");
  });

  it("links a past writer to a member who already has a writer of their own: both show under that person, and Unlink parts them", async () => {
    const { t, admin } = await setup();
    const a = await pdBy(t, "DW", 1);
    const b = await pdBy(t, "DW", 2);
    const past = (await writerOf(t, a))!;
    // Dana joins with DW (no file is checked again), and a new DW file is hers.
    const dana = await addMember(t, "Dana", "Whitlock", { initials: "DW" });
    const c = await pdBy(t, "DW", 3);
    const own = (await writerOf(t, c))!;
    expect(own).toMatchObject({ userId: dana });
    expect(own.linkedAt).toBeUndefined();
    expect((await admin.query(api.users.listPastWriters, {}))[0]).toMatchObject({
      _id: past._id,
      fileCount: 2,
      sameInitialsAs: { userId: dana, name: "Dana Whitlock", canLink: true },
    });

    await admin.mutation(api.users.linkPastWriter, { writerId: past._id, userId: dana });
    await runWriterWalk(t);
    for (const id of [a, b, c]) expect((await shownWriter(admin, id)).name, id).toBe("Dana Whitlock");
    expect((await getItem(t, a)).writerId).toBe(past._id);
    expect((await getItem(t, c)).writerId).toBe(own._id);
    await admin.mutation(api.users.unlinkPastWriter, { writerId: past._id });
    await runWriterWalk(t);
    expect((await shownWriter(admin, a)).name).toBe("DW");
    expect((await shownWriter(admin, c)).name).toBe("Dana Whitlock");
    await expectCountsMatchRecount(t, "after the link and unlink");
  });

  it("deletes a past writer only when no file points at it, and the picks that named it go too", async () => {
    const { t, admin } = await setup();
    const pd = await pdBy(t, "KT", 1);
    await admin.mutation(api.ingestion.matchWriterInitials, { initials: "KT", writer: { kind: "name", name: "Jordan Ellis" } });
    const jordan = (await writerOf(t, pd))!;
    await expect(admin.mutation(api.users.deletePastWriter, { writerId: jordan._id })).rejects.toThrow(
      "Files still point at this writer, so it cannot be deleted."
    );
    await admin.mutation(api.ingestion.setSheetLabels, { ids: [pd], patch: { writer: { kind: "name", name: "Priya Nair" } } });
    await admin.mutation(api.users.deletePastWriter, { writerId: jordan._id });
    expect(await t.run((ctx) => ctx.db.get(jordan._id))).toBeNull();
    expect(await t.run((ctx) => ctx.db.query("pdWriterPicks").collect())).toEqual([]);
    await runWriterWalk(t);
    await expectCountsMatchRecount(t, "after the delete");
  });

  it("lets only Admins change initials and writers, Managers read Past writers, and the picker's list only Admins", async () => {
    const { t, admin, writer } = await setup();
    await addMember(t, "Kim", "Tran", { role: "manager" });
    const manager = t.withIdentity({ subject: "member-Kim-Tran" });
    const pd = await pdBy(t, "SO", 1);
    const so = (await writerOf(t, pd))!;
    const sam = await addMember(t, "Sam", "Okafor");
    for (const who of [writer, manager]) {
      await expect(who.mutation(api.users.setUserInitials, { userId: sam, initials: "SO" })).rejects.toThrow(/elevated role/);
      await expect(who.mutation(api.users.renamePastWriter, { writerId: so._id, name: "Sam Okafor" })).rejects.toThrow(/elevated role/);
      await expect(who.mutation(api.users.linkPastWriter, { writerId: so._id, userId: sam })).rejects.toThrow(/elevated role/);
      await expect(who.mutation(api.users.unlinkPastWriter, { writerId: so._id })).rejects.toThrow(/elevated role/);
      await expect(who.mutation(api.users.deletePastWriter, { writerId: so._id })).rejects.toThrow(/elevated role/);
      await expect(who.mutation(api.ingestion.setSheetLabels, { ids: [pd], patch: { writer: { kind: "user", userId: sam } } })).rejects.toThrow(/Admin only/);
    }
    expect(await writer.query(api.users.listPastWriters, {})).toEqual([]);
    expect((await manager.query(api.users.listPastWriters, {})).map((row) => row.label)).toEqual(["SO"]);
    expect(await manager.query(api.ingestion.writerChoices, {})).toBeNull();
    const choices = await admin.query(api.ingestion.writerChoices, {});
    // Dana and Sam (setup) have no last name or initials, but a name: they are listed; past writers after.
    expect(choices!.members.map((member) => member.label)).toEqual(["Dana", "Kim Tran", "Sam", "Sam Okafor"]);
    expect(choices!.pastWriters).toEqual([{ writerId: so._id, label: "SO", initials: "SO", nameFromDocument: false }]);
    // Nothing changed.
    expect(await writerOf(t, pd)).toMatchObject({ _id: so._id, fileCount: 1 });
    expect((await t.run((ctx) => ctx.db.get(sam)))?.initials).toBeUndefined();
  });
});

describe("a pick and its Undo put back exactly what there was (review round 2)", () => {
  it("gives a past writer's old PDs back after a pick and Undo, even once a member has its initials", async () => {
    const { t, admin } = await setup();
    // Old DW files, on a bare past writer.
    const old1 = await pdBy(t, "DW", 1);
    const old2 = await pdBy(t, "DW", 2);
    await admin.mutation(api.ingestion.removeItems, { ids: [old2] });
    const past = (await writerOf(t, old1))!;
    // Dana joins and gets DW: the old files stay with the past writer (the freeze rule).
    const dana = await addMember(t, "Dana", "Whitlock");
    await admin.mutation(api.users.setUserInitials, { userId: dana, initials: "DW" });
    await runWriterWalk(t);
    expect((await getItem(t, old1)).writerId).toBe(past._id);
    const before = await writerState(t);
    // Someone chooses Sam on a DW file, then Undo at once.
    const result = await admin.mutation(api.ingestion.matchWriterInitials, { initials: "DW", writer: { kind: "name", name: "Sam Okafor" } });
    await runWriterWalk(t);
    expect((await shownWriter(admin, old1)).name).toBe("Sam Okafor");
    // The past writer has no file while the pick stands, and is kept for the Undo.
    expect(await t.run((ctx) => ctx.db.get(past._id))).toMatchObject({ fileCount: 0, heldCount: 2 });
    await admin.mutation(api.ingestion.matchWriterInitials, { initials: "DW", writer: result.previous });
    await runWriterWalk(t);
    expect(await shownWriter(admin, old1)).toEqual({ name: "DW", hasLogin: false });
    expect(await writerState(t)).toEqual(before);
    expect(await t.run((ctx) => ctx.db.get(past._id))).toMatchObject({ fileCount: 2, heldCount: 0 });
    await expectCountsMatchRecount(t, "after a pick and its Undo");
  });

  it("lets go of the writer a file remembered once the file is approved, so that writer can be removed", async () => {
    const { t, admin } = await setup();
    const file = await pdBy(t, "DW", 1);
    const bare = (await writerOf(t, file))!;
    const result = await admin.mutation(api.ingestion.matchWriterInitials, { initials: "DW", writer: { kind: "name", name: "Sam Okafor" } });
    await runWriterWalk(t);
    expect(await t.run((ctx) => ctx.db.get(bare._id))).toMatchObject({ fileCount: 0, heldCount: 1 });
    await approveForTest(t, admin, file);
    expect((await getItem(t, file)).writerBeforePick).toBeUndefined();
    // Nothing holds the bare writer any more, and the approved file keeps Sam after the Undo.
    await admin.mutation(api.ingestion.matchWriterInitials, { initials: "DW", writer: result.previous });
    await runWriterWalk(t);
    expect(await t.run((ctx) => ctx.db.get(bare._id))).toBeNull();
    expect(await getItem(t, file)).toMatchObject({ status: "approved", writerName: "Sam Okafor" });
    await expectCountsMatchRecount(t, "after an approved file let go of its remembered writer");
  });

  it("walks a chain of picks back one Undo at a time to where it started", async () => {
    const { t, admin } = await setup();
    const kim = await addMember(t, "Kim", "Tran", { initials: "KT" });
    const jordan = await addMember(t, "Jordan", "Ellis", { initials: "KT" });
    const kt = await pdBy(t, "KT", 1);
    const first = await admin.mutation(api.ingestion.matchWriterInitials, { initials: "KT", writer: { kind: "user", userId: kim } });
    const second = await admin.mutation(api.ingestion.matchWriterInitials, { initials: "KT", writer: { kind: "user", userId: jordan } });
    await admin.mutation(api.ingestion.matchWriterInitials, { initials: "KT", writer: second.previous });
    expect((await shownWriter(admin, kt)).name).toBe("Kim Tran");
    await admin.mutation(api.ingestion.matchWriterInitials, { initials: "KT", writer: first.previous });
    expect(await getItem(t, kt)).toMatchObject({ checkReasons: ["unmatched_initials"] });
    expect((await getItem(t, kt)).writerId).toBeUndefined();

    // A bare DW writer picked, replaced by a typed name, then by Kim, and back, on To review and Deleted.
    const dw = await pdBy(t, "DW", 2);
    const deleted = await pdBy(t, "DW", 3);
    await admin.mutation(api.ingestion.removeItems, { ids: [deleted] });
    const bare = (await writerOf(t, dw))!;
    const start = await writerState(t);
    const p1 = await admin.mutation(api.ingestion.matchWriterInitials, { initials: "DW", writer: { kind: "writer", writerId: bare._id } });
    const p2 = await admin.mutation(api.ingestion.matchWriterInitials, { initials: "DW", writer: { kind: "name", name: "Dana W" } });
    await runWriterWalk(t);
    const p3 = await admin.mutation(api.ingestion.matchWriterInitials, { initials: "DW", writer: { kind: "user", userId: kim } });
    await runWriterWalk(t);
    await admin.mutation(api.ingestion.matchWriterInitials, { initials: "DW", writer: p3.previous });
    await runWriterWalk(t);
    for (const id of [dw, deleted]) expect((await shownWriter(admin, id)).name).toBe("Dana W");
    await admin.mutation(api.ingestion.matchWriterInitials, { initials: "DW", writer: p2.previous });
    await runWriterWalk(t);
    for (const id of [dw, deleted]) expect((await shownWriter(admin, id)).name).toBe("DW");
    await admin.mutation(api.ingestion.matchWriterInitials, { initials: "DW", writer: p1.previous });
    await runWriterWalk(t);
    expect(await writerState(t)).toEqual(start);
    await expectCountsMatchRecount(t, "after the chain");
  });

  it("gives a member's files back after a typed-name pick and its Undo, on To review and Deleted", async () => {
    const { t, admin } = await setup();
    const dana = await addMember(t, "Dana", "Whitlock", { initials: "DW" });
    const a = await pdBy(t, "DW", 1);
    const b = await pdBy(t, "DW", 2);
    await admin.mutation(api.ingestion.removeItems, { ids: [b] });
    const before = await writerState(t);
    const result = await admin.mutation(api.ingestion.matchWriterInitials, { initials: "DW", writer: { kind: "name", name: "Dana W" } });
    await runWriterWalk(t);
    for (const id of [a, b]) expect((await shownWriter(admin, id)).name).toBe("Dana W");
    await admin.mutation(api.ingestion.matchWriterInitials, { initials: "DW", writer: result.previous });
    await runWriterWalk(t);
    for (const id of [a, b]) expect((await getItem(t, id)).writerId).toBe((await ownWriterOf(t, dana))!._id);
    expect(await writerState(t)).toEqual(before);
    await expectCountsMatchRecount(t, "after the typed pick and Undo");
  });

  it("undoes a pick whose earlier writer is a member who has left the team, or a past writer linked and unlinked since", async () => {
    const { t, admin } = await setup();
    const kim = await addMember(t, "Kim", "Tran", { initials: "KT" });
    const jordan = await addMember(t, "Jordan", "Ellis", { initials: "KT" });
    const kt = await pdBy(t, "KT", 1);
    await admin.mutation(api.ingestion.matchWriterInitials, { initials: "KT", writer: { kind: "user", userId: kim } });
    const second = await admin.mutation(api.ingestion.matchWriterInitials, { initials: "KT", writer: { kind: "user", userId: jordan } });
    await t.run((ctx) => ctx.db.patch(kim, { isAnonymous: true }));
    await admin.mutation(api.ingestion.matchWriterInitials, { initials: "KT", writer: second.previous });
    expect((await getItem(t, kt)).writerId).toBe((await ownWriterOf(t, kim))!._id);

    const dw = await pdBy(t, "DW", 2);
    const past = (await writerOf(t, dw))!;
    await admin.mutation(api.ingestion.matchWriterInitials, { initials: "DW", writer: { kind: "writer", writerId: past._id } });
    await admin.mutation(api.users.linkPastWriter, { writerId: past._id, userId: jordan });
    const result = await admin.mutation(api.ingestion.matchWriterInitials, { initials: "DW", writer: { kind: "user", userId: jordan } });
    await admin.mutation(api.users.unlinkPastWriter, { writerId: past._id });
    await runWriterWalk(t);
    await admin.mutation(api.ingestion.matchWriterInitials, { initials: "DW", writer: result.previous });
    await runWriterWalk(t);
    expect(await shownWriter(admin, dw)).toEqual({ name: "DW", hasLogin: false });
    expect((await getItem(t, dw)).writerId).toBe(past._id);
    // Linked once, it is never removed on its own: it stays until an Admin deletes it.
    await admin.mutation(api.ingestion.matchWriterInitials, { initials: "DW", writer: { kind: "name", name: "Priya Nair" } });
    await admin.mutation(api.ingestion.setSheetLabels, { ids: [dw], patch: { writer: { kind: "name", name: "Priya Nair" } } });
    expect(await t.run((ctx) => ctx.db.get(past._id))).toMatchObject({ fileCount: 0, heldCount: 0 });
    await expectCountsMatchRecount(t, "after the Undos");
  });

  it("never moves a frozen file on a name saved, a change of initials, an edit or a new read", async () => {
    const { t, admin } = await setup();
    const a = await pdBy(t, "KT", 1);
    const past = (await writerOf(t, a))!;
    const kim = await addMember(t, "Kim", "");
    await t.withIdentity({ subject: "member-Kim-" }).mutation(api.users.updateMyProfile, { firstName: "Kim", lastName: "Tran" });
    await runWriterWalk(t);
    await admin.mutation(api.ingestion.setSheetLabels, { ids: [a], patch: { scienceCode: "2.02.01" } });
    await admin.mutation(api.ingestion.setSheetLabels, { ids: [a], patch: { fiscalYearEnd: Date.UTC(2024, 2, 31) } });
    await admin.mutation(api.users.setUserInitials, { userId: kim, initials: "KX" });
    await admin.mutation(api.users.setUserInitials, { userId: kim, initials: "KT" });
    await runWriterWalk(t);
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["bytes"])));
    await t.mutation(internal.ingestion.markItemProcessed, { itemId: a, storageId, text: "Text 2", documentScienceCode: "2.02.09" });
    expect((await getItem(t, a)).writerId).toBe(past._id);
    await expectCountsMatchRecount(t, "after the facts changed");
  });

  it("shows a member with no real name by their initials, never their email", async () => {
    const { t, admin } = await setup();
    const id = await t.run((ctx) => ctx.db.insert("users", { authId: "email-only", role: "writer", email: "pat@example.com" }));
    await admin.mutation(api.users.setUserInitials, { userId: id, initials: "PQ" });
    const file = await pdBy(t, "PQ", 1);
    expect((await getItem(t, file)).writerName).toBe("PQ");
    expect(await shownWriter(admin, file)).toEqual({ name: "PQ", hasLogin: true });
  });
});

describe("moving to writers (2026-11-16)", () => {
  it("copies each saved match into a writer and a pick, linked only to the one member with that name and those initials, then gives every file its writer", async () => {
    const { t, admin } = await setup();
    const kim = await addMember(t, "Kim", "Tran", { initials: "KT" });
    // Priya's saved initials are not the ones the match was made for: not linked.
    await addMember(t, "Priya", "Nair", { initials: "PR" });
    const setBy = (await t.run((ctx) => ctx.db.query("users").first()))!._id;
    await t.run(async (ctx) => {
      for (const [initials, writerName] of [["KT", "Kim Tran"], ["PN", "Priya Nair"], ["SO", "Sam Okafor"]]) {
        await ctx.db.insert("importWriterInitials", { initials, writerName, setBy, updatedAt: 5 });
      }
    });
    const [kt, pn, so, setKim, setJordan, approvedDw, approvedSet] = await insertRaw(t, [
      { path: pdPath("KT", 1), driveItemId: "kt", extra: { writerName: "Kim Tran", writerNameSource: "initials" } },
      { path: pdPath("PN", 2), driveItemId: "pn" },
      { path: pdPath("SO", 3), driveItemId: "so" },
      // Writers a person typed on one file, as text, before writers existed.
      { path: `${CEDARLINE_FY}/To be submitted/a.docx`, driveItemId: "set-kim", extra: { writerName: "Kim Tran", writerNameSource: "person", editedLabels: ["writerName"] } },
      { path: `${CEDARLINE_FY}/To be submitted/b.docx`, driveItemId: "set-jordan", extra: { writerName: "Jordan Ellis", editedLabels: ["writerName"] } },
      // Approved before the deploy: one with only initials, one a person named.
      { path: pdPath("DW", 4), driveItemId: "approved-dw", extra: { status: "approved" } },
      { path: `${CEDARLINE_FY}/To be submitted/c.docx`, driveItemId: "approved-set", extra: { status: "approved", writerName: "Jordan Ellis", editedLabels: ["writerName"] } },
    ]);

    await expect(t.mutation(internal.ingestion.migrateImportWriterInitials, {})).resolves.toEqual({ migrated: 3, done: true });
    // To review, Deleted, then Approved.
    expect(await runWriterWalk(t)).toMatchObject({ backfillImportWriters: 3 });
    const kimWriter = (await ownWriterOf(t, kim))!;
    const picks = await t.run((ctx) => ctx.db.query("pdWriterPicks").collect());
    expect(picks.map((pick) => pick.initials).sort()).toEqual(["KT", "PN", "SO"]);
    expect(picks.find((pick) => pick.initials === "KT")!.writerId).toBe(kimWriter._id);
    expect(await writerOf(t, pn)).toMatchObject({ name: "Priya Nair", initials: "PN", createdVia: "person" });
    expect((await writerOf(t, pn))?.userId).toBeUndefined();
    expect(await shownWriter(admin, kt)).toEqual({ name: "Kim Tran", hasLogin: true });
    expect(await shownWriter(admin, so)).toEqual({ name: "Sam Okafor", hasLogin: false });
    expect((await getItem(t, setKim)).writerId).toBe(kimWriter._id);
    expect(await writerOf(t, setJordan)).toMatchObject({ name: "Jordan Ellis" });
    expect((await getItem(t, setJordan)).writerNameSource).toBeUndefined();
    // Approved files gain a writer, never a new stored name; the sheet shows the writer.
    expect((await getItem(t, approvedDw)).writerName).toBeUndefined();
    expect(await writerOf(t, approvedDw)).toMatchObject({ initials: "DW", fileCount: 1 });
    expect(await shownWriter(admin, approvedDw)).toEqual({ name: "DW", hasLogin: false });
    expect((await getItem(t, approvedSet)).writerId).toBe((await getItem(t, setJordan)).writerId);
    expect((await getItem(t, approvedSet)).writerName).toBe("Jordan Ellis");
    expect(await writerOf(t, setJordan)).toMatchObject({ fileCount: 2 });
    await expectCountsMatchRecount(t, "after the move to writers");

    // Run again: nothing more.
    const before = await allWriters(t);
    await expect(t.mutation(internal.ingestion.migrateImportWriterInitials, {})).resolves.toEqual({ migrated: 0, done: true });
    await runWriterWalk(t);
    expect(await allWriters(t)).toEqual(before);
    expect(await t.run((ctx) => ctx.db.query("pdWriterPicks").collect())).toHaveLength(3);
  });

  it("gives an approved file the writer it was approved with, even when its initials stand for someone else now", async () => {
    const { t, admin } = await setup();
    const setBy = (await t.run((ctx) => ctx.db.query("users").first()))!._id;
    // KT was matched to Kim Tran when the file was approved, and to Kevin Tse since.
    await t.run((ctx) => ctx.db.insert("importWriterInitials", { initials: "KT", writerName: "Kevin Tse", setBy, updatedAt: 5 }));
    const [approvedKt, approvedPn] = await insertRaw(t, [
      { path: pdPath("KT", 1), driveItemId: "akt", extra: { status: "approved", writerName: "Kim Tran", writerNameSource: "initials" } },
      // PN's match was undone after approval: no old row for it.
      { path: pdPath("PN", 2), driveItemId: "apn", extra: { status: "approved", writerName: "Priya Nair", writerNameSource: "initials" } },
    ]);
    await t.mutation(internal.users.backfillUserInitials, {});
    await t.mutation(internal.ingestion.migrateImportWriterInitials, {});
    await runWriterWalk(t);
    expect(await shownWriter(admin, approvedKt)).toEqual({ name: "Kim Tran", hasLogin: false });
    expect(await shownWriter(admin, approvedPn)).toEqual({ name: "Priya Nair", hasLogin: false });
    expect((await getItem(t, approvedKt)).writerName).toBe("Kim Tran");
    await expectCountsMatchRecount(t, "after approved files got their writers");
  });

  it("never brings back a pick a person undid when the migration runs again", async () => {
    const { t, admin } = await setup();
    const setBy = (await t.run((ctx) => ctx.db.query("users").first()))!._id;
    await t.run((ctx) => ctx.db.insert("importWriterInitials", { initials: "SO", writerName: "Sam Okafor", setBy, updatedAt: 5 }));
    const [so] = await insertRaw(t, [{ path: pdPath("SO", 1), driveItemId: "so", extra: { writerName: "Sam Okafor", writerNameSource: "initials" } }]);
    await t.mutation(internal.ingestion.migrateImportWriterInitials, {});
    await runWriterWalk(t);
    expect((await shownWriter(admin, so)).name).toBe("Sam Okafor");
    expect((await t.run((ctx) => ctx.db.query("importWriterInitials").collect()))[0].migratedAt).toEqual(expect.any(Number));
    await admin.mutation(api.ingestion.matchWriterInitials, { initials: "SO", writer: null });
    await runWriterWalk(t);
    expect((await shownWriter(admin, so)).name).toBe("SO");
    await expect(t.mutation(internal.ingestion.migrateImportWriterInitials, {})).resolves.toEqual({ migrated: 0, done: true });
    await runWriterWalk(t);
    expect((await shownWriter(admin, so)).name).toBe("SO");
    expect(await t.run((ctx) => ctx.db.query("pdWriterPicks").collect())).toEqual([]);
  });

  it("prefills saved initials from first and last names for team members only, keeps what an Admin saved, and can run again", async () => {
    const { t } = await setup();
    const jordan = await addMember(t, "Jordan", "Ellis");
    const priya = await addMember(t, "Priya", "Nair", { initials: "" });
    const sam = await addMember(t, "Sam", "Okafor", { initials: "SAM" });
    const kim = await addMember(t, "Kim", "");
    // No role: not a team member, never given initials.
    const roleless = await t.run((ctx) => ctx.db.insert("users", { authId: "no-role", firstName: "Dana", lastName: "Whitlock" }));
    await expect(
      t.mutation(internal.users.backfillUserInitials, { paginationOpts: { numItems: 2, cursor: null } })
    ).resolves.toMatchObject({ done: false });
    await runWriterWalk(t);
    const initials = async (id: Id<"users">) => (await t.run((ctx) => ctx.db.get(id)))?.initials;
    expect(await initials(jordan)).toBe("JE");
    expect(await initials(priya)).toBe("");
    expect(await initials(sam)).toBe("SAM");
    expect(await initials(kim)).toBeUndefined();
    expect(await initials(roleless)).toBeUndefined();
    await expect(t.mutation(internal.users.backfillUserInitials, {})).resolves.toEqual({ updated: 0, done: true });
    // A name saved on Settings fills initials only while none are saved.
    await t.withIdentity({ subject: "member-Kim-" }).mutation(api.users.updateMyProfile, { firstName: "Kim", lastName: "Tran" });
    expect(await initials(kim)).toBe("KT");
    await t.withIdentity({ subject: "member-Kim-" }).mutation(api.users.updateMyProfile, { firstName: "Kimberly", lastName: "Hale" });
    expect(await initials(kim)).toBe("KT");
  });
});

// ─── Past writers named from their PDs (2026-11-16) ─────────────────────────

/**
 * A read PD whose name gives these initials and whose full text is `text`,
 * read the way extraction reads it: the names after a writer cue come from
 * the whole text (writerNamesFromText), the preview is only the start.
 * `folder` is the stage folder under the fiscal year.
 */
async function readPd(t: T, initials: string, n: number, text: string, folder = "To be submitted", fy = CEDARLINE_FY) {
  const name = `${String(n).padStart(2, "0")} CedarlineSystems 2025-03-31 T1.${initials} Project${n}.docx`;
  const id = await stage(t, `${fy}/${folder}/${name}`, { driveItemId: `${initials}-${n}-${folder}` });
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["bytes"])));
  const textStorageId = await t.run((ctx) => ctx.storage.store(new Blob([text], { type: "text/plain" })));
  await t.mutation(internal.ingestion.markItemProcessed, {
    itemId: id,
    storageId,
    text: "Text",
    textStorageId,
    documentScienceCode: "2.02.09",
    documentWriterNames: writerNamesFromText(text),
  });
  return id;
}

/**
 * A file read before 2026-11-16: its full text is in storage, its names are
 * not kept. Its text id is written straight in, as the old code left it, so
 * no read of its names is scheduled.
 */
async function readBefore(t: T, initials: string, n: number, text: string, path = pdPath(initials, n)) {
  const id = await stage(t, path, { driveItemId: `before-${initials}-${n}` });
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["bytes"])));
  await t.mutation(internal.ingestion.markItemProcessed, { itemId: id, storageId, text: "Text", documentScienceCode: "2.02.09" });
  const textStorageId = await t.run((ctx) => ctx.storage.store(new Blob([text], { type: "text/plain" })));
  await t.run((ctx) => ctx.db.patch(id, { textStorageId, documentWriterNames: undefined }));
  return id;
}

const DANA_PD = "Cold chain sensor drift\nPrepared by Dana Whitlock, reviewed by Priya Nair.\nCedarline Systems";

describe("past writers named from their PDs (2026-11-16)", () => {
  it("names a past writer from its PD's writer cue, shows it on every file, and gives it the next file with those initials", async () => {
    const { t, admin } = await setup();
    // Staged before anything was read: its stored name is the initials for now.
    const waiting = await stage(t, pdPath("DW", 9), { driveItemId: "dw-waiting" });
    expect((await getItem(t, waiting)).writerName).toBe("DW");
    const pd = await readPd(t, "DW", 1, DANA_PD);
    const writer = (await writerOf(t, pd))!;
    expect(writer).toMatchObject({ initials: "DW", name: "Dana Whitlock", nameSource: "document", createdVia: "import" });
    expect(writer.userId).toBeUndefined();
    expect(writer.updatedBy).toBeUndefined();
    expect(await getItem(t, pd)).toMatchObject({ documentWriterNames: ["Dana Whitlock"], writerName: "Dana Whitlock", writerNameSource: "initials" });
    expect(await shownWriter(admin, pd)).toEqual({ name: "Dana Whitlock", hasLogin: false });
    // Shown at once on the file staged before; its stored name follows in the walk.
    expect(await shownWriter(admin, waiting)).toEqual({ name: "Dana Whitlock", hasLogin: false });
    expect(await runWriterWalk(t)).toMatchObject({ refreshWriterFiles: 2 });
    expect((await getItem(t, waiting)).writerName).toBe("Dana Whitlock");

    // The next DW file, whatever its text, goes to the same writer: no second DW.
    const next = await pdBy(t, "DW", 2);
    expect((await getItem(t, next)).writerId).toBe(writer._id);
    expect((await getItem(t, next)).writerName).toBe("Dana Whitlock");
    // The same name again changes nothing.
    await readPd(t, "DW", 3, "Prepared by DANA WHITLOCK");
    expect(await allWriters(t)).toHaveLength(1);
    expect((await allWriters(t))[0]).toMatchObject({ name: "Dana Whitlock", nameSource: "document", fileCount: 4 });
    expect(await runWriterWalk(t)).toEqual({});

    expect(await admin.query(api.users.listPastWriters, {})).toEqual([
      expect.objectContaining({ _id: writer._id, name: "Dana Whitlock", label: "Dana Whitlock", nameFromDocument: true, fileCount: 4 }),
    ]);
    await expectCountsMatchRecount(t, "after a past writer was named from its PD");
  });

  it("leaves the initials when no name in the text matches, or when two do", async () => {
    const { t } = await setup();
    // Reviewer only, a name for other initials, and a single word.
    const none = await readPd(t, "KT", 1, "Reviewed by Kim Tran.\nPrepared by Priya Nair.\nWriter: Kim");
    expect(await getItem(t, none)).toMatchObject({ documentWriterNames: ["Priya Nair"], writerName: "KT" });
    expect((await writerOf(t, none))!.name).toBeUndefined();
    const two = await readPd(t, "SO", 2, "Prepared by Sam Okafor.\nWritten by Sara Oduya.");
    expect((await writerOf(t, two))!).toMatchObject({ initials: "SO" });
    expect((await writerOf(t, two))!.name).toBeUndefined();
    expect((await writerOf(t, two))!.nameSource).toBeUndefined();
    // A later file with only one of them names it.
    await readPd(t, "SO", 3, "Prepared by Sam Okafor.");
    expect((await writerOf(t, two))!.name).toBe("Sam Okafor");
    await expectCountsMatchRecount(t, "after texts with no clear name");
  });

  it("names a writer set after the text was read, in either order", async () => {
    const { t, admin } = await setup();
    // Two members have DW: the file is read with no writer.
    const dana = await addMember(t, "Dana", "Wells", { initials: "DW" });
    const dan = await addMember(t, "Dan", "Walsh", { initials: "DW" });
    const pd = await readPd(t, "DW", 1, DANA_PD);
    expect(await getItem(t, pd)).toMatchObject({ documentWriterNames: ["Dana Whitlock"], checkReasons: ["unmatched_initials"] });
    expect((await getItem(t, pd)).writerId).toBeUndefined();
    expect(await allWriters(t)).toEqual([]);
    // Neither has DW any more: the check makes a past writer, which takes the name the text gave.
    await admin.mutation(api.users.setUserInitials, { userId: dana, initials: "DN" });
    await admin.mutation(api.users.setUserInitials, { userId: dan, initials: "DA" });
    await runWriterWalk(t);
    expect(await writerOf(t, pd)).toMatchObject({ initials: "DW", name: "Dana Whitlock", nameSource: "document" });
    expect(await getItem(t, pd)).toMatchObject({ writerName: "Dana Whitlock", needsCheck: false });
    await expectCountsMatchRecount(t, "after the writer came after the text");
  });

  it("names drafts' and review copies' writers too, never a transcript's", async () => {
    const { t } = await setup();
    const draft = await readPd(t, "PN", 1, "Written by Priya Nair", "Drafts");
    expect((await getItem(t, draft)).category).toBe("draft");
    expect((await writerOf(t, draft))!.name).toBe("Priya Nair");
    const review = await readPd(t, "SO", 2, "Author: Sam Okafor", "In Review");
    expect((await getItem(t, review)).category).toBe("review_copy");
    expect((await writerOf(t, review))!.name).toBe("Sam Okafor");
    const transcript = await readPd(t, "KT", 3, "Prepared by Kim Tran", "WIP/Technical/Audio");
    expect(await getItem(t, transcript)).toMatchObject({ category: "transcript", documentWriterNames: ["Kim Tran"] });
    expect((await getItem(t, transcript)).writerId).toBeUndefined();
    expect((await allWriters(t)).map((writer) => writer.initials).sort()).toEqual(["PN", "SO"]);
    await expectCountsMatchRecount(t, "after drafts, review copies and a transcript");
  });

  it("never overwrites an Admin's name, and an Admin clearing the name stops PDs naming it", async () => {
    const { t, admin } = await setup();
    const first = await readPd(t, "DW", 1, DANA_PD);
    const writer = (await writerOf(t, first))!;
    // Saving the name a PD gave makes it the Admin's.
    await admin.mutation(api.users.renamePastWriter, { writerId: writer._id, name: "Dana Whitlock" });
    expect(await writerOf(t, first)).toMatchObject({ name: "Dana Whitlock", nameSource: "person" });
    expect((await admin.query(api.users.listPastWriters, {}))[0]).toMatchObject({ nameFromDocument: false });
    await readPd(t, "DW", 2, "Prepared by Dan Wells");
    expect(await writerOf(t, first)).toMatchObject({ name: "Dana Whitlock", nameSource: "person" });
    await admin.mutation(api.users.renamePastWriter, { writerId: writer._id, name: "Dana R Whitlock" });
    await readPd(t, "DW", 3, DANA_PD);
    expect((await writerOf(t, first))!.name).toBe("Dana R Whitlock");
    // Cleared: just the initials, and no PD names it again.
    await expect(admin.mutation(api.users.renamePastWriter, { writerId: writer._id, name: "" })).resolves.toEqual({ label: "DW" });
    await readPd(t, "DW", 4, DANA_PD);
    const cleared = (await writerOf(t, first))!;
    expect(cleared.name).toBeUndefined();
    expect(cleared.nameSource).toBe("person");
    expect(await allWriters(t)).toHaveLength(1);
    await runWriterWalk(t);
    expect((await getItem(t, first)).writerName).toBe("DW");
    // The Admin's writer is never removed on its own, even with no files.
    await t.mutation(internal.ingestion.upsertDiscoveredItem, {
      ...discoveredArgs(`${CEDARLINE_FY}/WIP/Technical/Audio/x.docx`, { driveItemId: "DW-1-To be submitted" }),
    });
    expect(await allWriters(t)).toHaveLength(1);
    await expectCountsMatchRecount(t, "after an Admin's names");
  });

  it("goes back to the initials when two PDs name different people, and stays there until an Admin names it", async () => {
    const { t, admin } = await setup();
    const first = await readPd(t, "DW", 1, DANA_PD);
    const writer = (await writerOf(t, first))!;
    await runWriterWalk(t);
    const second = await readPd(t, "DW", 2, "Written by Dan Wells");
    expect(await writerOf(t, first)).toMatchObject({ nameSource: "documents_disagree" });
    expect((await writerOf(t, first))!.name).toBeUndefined();
    expect((await getItem(t, second)).writerName).toBe("DW");
    await runWriterWalk(t);
    expect((await getItem(t, first)).writerName).toBe("DW");
    expect(await shownWriter(admin, first)).toEqual({ name: "DW", hasLogin: false });
    // Another PD that agrees with either one changes nothing.
    await readPd(t, "DW", 3, DANA_PD);
    expect((await writerOf(t, first))!.name).toBeUndefined();
    expect(await allWriters(t)).toHaveLength(1);
    expect((await admin.query(api.users.listPastWriters, {}))[0]).toMatchObject({ label: "DW", name: null, nameFromDocument: false });
    // The Admin can still name it.
    await admin.mutation(api.users.renamePastWriter, { writerId: writer._id, name: "Dana Whitlock" });
    expect(await writerOf(t, first)).toMatchObject({ name: "Dana Whitlock", nameSource: "person" });
    await expectCountsMatchRecount(t, "after PDs that disagree");
  });

  it("never names a member's writer or a linked past writer, and a member with the initials still comes first", async () => {
    const { t, admin } = await setup();
    const dana = await addMember(t, "Dana", "Wells", { initials: "DW" });
    const pd = await readPd(t, "DW", 1, DANA_PD);
    const own = (await ownWriterOf(t, dana))!;
    expect((await getItem(t, pd)).writerId).toBe(own._id);
    expect(own.name).toBeUndefined();
    expect(await shownWriter(admin, pd)).toEqual({ name: "Dana Wells", hasLogin: true });
    // A past writer linked to Sam keeps no name of its own while linked.
    const so = (await writerOf(t, await pdBy(t, "SO", 2)))!;
    const sam = await addMember(t, "Sam", "Okafor", { initials: "SK" });
    await admin.mutation(api.users.linkPastWriter, { writerId: so._id, userId: sam });
    const later = await readPd(t, "SO", 3, "Prepared by Sven Olsen");
    expect((await getItem(t, later)).writerId).toBe(so._id);
    expect((await writerOf(t, later))!.name).toBeUndefined();
    expect(await shownWriter(admin, later)).toEqual({ name: "Sam Okafor", hasLogin: true });
    // A past writer a person named on Import (no initials) is never named by a PD.
    const typed = await readPd(t, "KT", 4, "Prepared by Kevin Tse");
    await admin.mutation(api.ingestion.setSheetLabels, { ids: [typed], patch: { writer: { kind: "name", name: "Kim Tran" } } });
    expect((await writerOf(t, typed))!).toMatchObject({ name: "Kim Tran", createdVia: "person" });
    await expectCountsMatchRecount(t, "after writers a PD may not name");
  });

  it("makes a PD's name a person's once a person chooses that writer, so a later PD that disagrees never takes it back", async () => {
    const { t, admin } = await setup();
    // Typed on one file: the same name is the same writer, now confirmed.
    const first = await readPd(t, "DW", 1, DANA_PD);
    const dw = (await writerOf(t, first))!;
    const other = await readPd(t, "KT", 2, "No writer here.");
    await admin.mutation(api.ingestion.setSheetLabels, { ids: [other], patch: { writer: { kind: "name", name: "Dana Whitlock" } } });
    expect((await getItem(t, other)).writerId).toBe(dw._id);
    expect(await writerOf(t, first)).toMatchObject({ name: "Dana Whitlock", nameSource: "person" });
    await readPd(t, "DW", 3, "Written by Dan Wells");
    expect(await writerOf(t, first)).toMatchObject({ name: "Dana Whitlock", nameSource: "person" });
    expect(await shownWriter(admin, other)).toEqual({ name: "Dana Whitlock", hasLogin: false });

    // Chosen from the list for some initials (a firm-wide pick): confirmed too.
    const so = await readPd(t, "SO", 4, "Prepared by Sam Okafor");
    const sam = (await writerOf(t, so))!;
    expect(sam.nameSource).toBe("document");
    await readPd(t, "SK", 5, "No writer here.");
    await admin.mutation(api.ingestion.matchWriterInitials, { initials: "SK", writer: { kind: "writer", writerId: sam._id } });
    expect(await writerOf(t, so)).toMatchObject({ name: "Sam Okafor", nameSource: "person" });
    await readPd(t, "SO", 6, "Prepared by Sara Oduya");
    expect(await writerOf(t, so)).toMatchObject({ name: "Sam Okafor", nameSource: "person" });
    await runWriterWalk(t);
    await expectCountsMatchRecount(t, "after people chose writers named by PDs");
  });

  it("confirms a PD's name when a person chooses the writer a file already has, and changes no file, pick or count (Greptile fix, 2026-11-17)", async () => {
    const { t, admin, writer } = await setup();
    const first = await readPd(t, "DW", 1, DANA_PD);
    await readPd(t, "DW", 2, "No writer here.");
    const dw = (await writerOf(t, first))!;
    expect(dw).toMatchObject({ name: "Dana Whitlock", nameSource: "document", fileCount: 2 });
    await runWriterWalk(t);
    // The picker's list says which past writer's name came from a PD.
    const listed = async () => (await admin.query(api.ingestion.writerChoices, {}))!.pastWriters.find((row) => row.writerId === dw._id);
    expect(await listed()).toEqual({ writerId: dw._id, label: "Dana Whitlock", initials: "DW", nameFromDocument: true });

    const files = async () => await t.run((ctx) => ctx.db.query("ingestionItems").collect());
    const filesBefore = await files();
    const stateBefore = await writerState(t);
    // Only an Admin can.
    await addMember(t, "Kim", "Tran", { role: "manager" });
    const manager = t.withIdentity({ subject: "member-Kim-Tran" });
    for (const who of [writer, manager]) {
      await expect(who.mutation(api.ingestion.confirmWriterName, { writerId: dw._id })).rejects.toThrow(/Admin only/);
    }
    expect((await writerOf(t, first))!.nameSource).toBe("document");

    await expect(admin.mutation(api.ingestion.confirmWriterName, { writerId: dw._id })).resolves.toBe(true);
    const after = (await writerOf(t, first))!;
    expect(after).toMatchObject({ _id: dw._id, name: "Dana Whitlock", nameSource: "person", fileCount: 2 });
    expect(after.updatedBy).toBeDefined();
    // No file, pick or count moved: the writer's label is the same.
    expect(await files()).toEqual(filesBefore);
    expect(await writerState(t)).toEqual(stateBefore);
    await expectCountsMatchRecount(t, "after a PD's name was confirmed");
    expect(await listed()).toMatchObject({ label: "Dana Whitlock", nameFromDocument: false });
    // Once more changes nothing.
    await expect(admin.mutation(api.ingestion.confirmWriterName, { writerId: dw._id })).resolves.toBe(false);

    // A later PD that names someone else no longer takes the name back.
    await readPd(t, "DW", 3, "Written by Dan Wells");
    expect(await writerOf(t, first)).toMatchObject({ name: "Dana Whitlock", nameSource: "person" });
    expect(await shownWriter(admin, first)).toEqual({ name: "Dana Whitlock", hasLogin: false });

    // A writer whose name did not come from a PD is left as it was.
    const so = (await writerOf(t, await pdBy(t, "SO", 4)))!;
    await expect(admin.mutation(api.ingestion.confirmWriterName, { writerId: so._id })).resolves.toBe(false);
    const soAfter = (await writerOf(t, await pdBy(t, "SO", 5)))!;
    expect(soAfter._id).toBe(so._id);
    expect(soAfter.nameSource).toBeUndefined();
    expect(soAfter.updatedBy).toBeUndefined();
    // A writer that is gone says so.
    const gone = await t.run(async (ctx) => {
      const id = await ctx.db.insert("pdWriters", { initials: "ZZ", createdVia: "import", createdAt: Date.now(), fileCount: 0 });
      await ctx.db.delete(id);
      return id;
    });
    await expect(admin.mutation(api.ingestion.confirmWriterName, { writerId: gone })).rejects.toThrow(/no longer in Banhall/);
    await expectCountsMatchRecount(t, "after confirming writers");
  });

  it("leaves a past writer with no name as it was when an Admin saves an empty name", async () => {
    const { t, admin } = await setup();
    const pd = await pdBy(t, "DW", 1);
    const dw = (await writerOf(t, pd))!;
    await expect(admin.mutation(api.users.renamePastWriter, { writerId: dw._id, name: "  " })).resolves.toEqual({ label: "DW" });
    const after = (await writerOf(t, pd))!;
    expect(after.nameSource).toBeUndefined();
    expect(after.updatedBy).toBeUndefined();
    // So a PD can still name it, and it is still removed when nothing points at it.
    await readPd(t, "DW", 2, DANA_PD);
    expect(await writerOf(t, pd)).toMatchObject({ name: "Dana Whitlock", nameSource: "document" });
  });

  it("never takes the file's company name, nor a name another past writer already has", async () => {
    const { t } = await setup();
    // The company is called Delta Wave, and DW is its initials.
    const company = await readPd(t, "DW", 1, "Prepared by Delta Wave", "To be submitted", "Delta Wave/2025 - Mar 31");
    expect((await getItem(t, company)).documentWriterNames).toEqual(["Delta Wave"]);
    expect((await writerOf(t, company))!.name).toBeUndefined();
    // A person typed "Priya Nair" on Import first: the PN writer the check makes stays PN.
    const typed = await readPd(t, "KT", 2, "No writer here.");
    const { admin } = { admin: t.withIdentity({ subject: "sheet-admin" }) };
    await admin.mutation(api.ingestion.setSheetLabels, { ids: [typed], patch: { writer: { kind: "name", name: "Priya Nair" } } });
    const pn = await readPd(t, "PN", 3, "Author: Priya Nair");
    expect((await writerOf(t, pn))!).toMatchObject({ initials: "PN" });
    expect((await writerOf(t, pn))!.name).toBeUndefined();
    expect((await allWriters(t)).filter((writer) => writer.name === "Priya Nair")).toHaveLength(1);
    // A team member called Dana Whitlock (initials DAW): the DW writer stays DW.
    await addMember(t, "Dana", "Whitlock", { initials: "DAW" });
    const dw = await readPd(t, "DW", 4, DANA_PD);
    expect((await writerOf(t, dw))!.name).toBeUndefined();
    // A writer typed in lower case blocks the same name too.
    await admin.mutation(api.ingestion.setSheetLabels, { ids: [typed], patch: { writer: { kind: "name", name: "sam okafor" } } });
    const so = await readPd(t, "SO", 5, "Prepared by Sam Okafor");
    expect((await writerOf(t, so))!.name).toBeUndefined();
    await expectCountsMatchRecount(t, "after names a PD may not take");
  });

  it("reads the names of a file that comes to take a writer later, or whose reading began before the deploy", async () => {
    const { t, admin } = await setup();
    // A file in a supporting folder, read before its names were kept, then
    // moved on the drive into To be submitted: a final PD with initials now.
    const name = "01 CedarlineSystems 2025-03-31 T1.DW Project1.docx";
    const moved = await readBefore(t, "DW", 1, DANA_PD, `${CEDARLINE_FY}/Financials/${name}`);
    expect((await getItem(t, moved)).category).toBe("supporting");
    await t.mutation(internal.ingestion.upsertDiscoveredItem, {
      ...discoveredArgs(`${CEDARLINE_FY}/To be submitted/${name}`, { driveItemId: "before-DW-1" }),
    });
    expect((await getItem(t, moved))).toMatchObject({ category: "final_pd", writerInitials: "DW", status: "pending_review" });
    expect(await runWriterWalk(t)).toMatchObject({ readDocumentWriterNames: 1 });
    expect((await getItem(t, moved)).documentWriterNames).toEqual(["Dana Whitlock"]);
    expect(await writerOf(t, moved)).toMatchObject({ initials: "DW", name: "Dana Whitlock", nameSource: "document" });

    // A reading that began before the deploy lands with its text and no names.
    const late = await stage(t, pdPath("SO", 2), { driveItemId: "late-so" });
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["bytes"])));
    const textStorageId = await t.run((ctx) => ctx.storage.store(new Blob(["Prepared by Sam Okafor"], { type: "text/plain" })));
    await t.mutation(internal.ingestion.markItemProcessed, { itemId: late, storageId, text: "Text", textStorageId });
    expect(await runWriterWalk(t)).toMatchObject({ readDocumentWriterNames: 1 });
    expect(await writerOf(t, late)).toMatchObject({ name: "Sam Okafor", nameSource: "document" });
    // A row read long ago with only its preview, no full text: its names come
    // from the preview at its next write, with nothing to schedule.
    const old = await stage(t, pdPath("KT", 4), { driveItemId: "old-kt" });
    const oldStorage = await t.run((ctx) => ctx.storage.store(new Blob(["bytes"])));
    await t.mutation(internal.ingestion.markItemProcessed, { itemId: old, storageId: oldStorage, text: "Text" });
    await t.run((ctx) => ctx.db.patch(old, { text: "Cover page\nPrepared by Kim Tran", documentWriterNames: undefined }));
    await admin.mutation(api.ingestion.setSheetLabels, { ids: [old], patch: { scienceCode: "1.02.01" } });
    expect((await getItem(t, old)).documentWriterNames).toEqual(["Kim Tran"]);
    expect(await writerOf(t, old)).toMatchObject({ name: "Kim Tran", nameSource: "document" });
    // A file read with its names schedules nothing more.
    await readPd(t, "PN", 3, "Author: Priya Nair");
    expect(await runWriterWalk(t)).not.toHaveProperty("readDocumentWriterNames");
    await expectCountsMatchRecount(t, "after files read on their own");
  });

  it("keeps an approved file's stored name while the sheet shows the writer's new one", async () => {
    const { t, admin } = await setup();
    const approved = await pdBy(t, "DW", 1);
    await approveForTest(t, admin, approved);
    expect((await getItem(t, approved)).writerName).toBe("DW");
    await readPd(t, "DW", 2, DANA_PD);
    await runWriterWalk(t);
    expect((await getItem(t, approved)).writerName).toBe("DW");
    expect(await shownWriter(admin, approved)).toEqual({ name: "Dana Whitlock", hasLogin: false });
    await expectCountsMatchRecount(t, "after a name over an approved file");
  });

  it("removes a writer named only by a PD once nothing points at it, and an Undo's stand-in is that writer", async () => {
    const { t } = await setup();
    const pd = await readPd(t, "DW", 1, DANA_PD);
    expect((await writerOf(t, pd))!.name).toBe("Dana Whitlock");
    const standIn = await t.run((ctx) => bareWriterFromInitials(ctx, "DW"));
    expect(standIn._id).toBe((await getItem(t, pd)).writerId);
    // Moved to Transcripts: no file points at it, and it goes like a bare writer.
    await t.mutation(internal.ingestion.upsertDiscoveredItem, {
      ...discoveredArgs(`${CEDARLINE_FY}/WIP/Technical/Audio/01 CedarlineSystems 2025-03-31 T1.DW Project1.docx`, {
        driveItemId: "DW-1-To be submitted",
      }),
    });
    expect(await allWriters(t)).toEqual([]);
    await expectCountsMatchRecount(t, "after the named writer went");
  });

  it("clears the names when new bytes arrive, and a new text naming someone else counts as PDs that disagree", async () => {
    const { t } = await setup();
    const pd = await readPd(t, "SO", 1, "Prepared by Sam Okafor");
    await t.mutation(internal.ingestion.upsertDiscoveredItem, {
      ...discoveredArgs(pdPath("SO", 1), { driveItemId: "SO-1-To be submitted", contentHash: "hash-2" }),
    });
    const restaged = await getItem(t, pd);
    expect(restaged.status).toBe("discovered");
    expect(restaged.documentWriterNames).toBeUndefined();
    expect((await writerOf(t, pd))!.name).toBe("Sam Okafor");
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["bytes"])));
    await t.mutation(internal.ingestion.markItemProcessed, {
      itemId: pd,
      storageId,
      text: "Text",
      documentWriterNames: writerNamesFromText("Prepared by Sara Oduya"),
    });
    expect((await getItem(t, pd)).documentWriterNames).toEqual(["Sara Oduya"]);
    expect(await writerOf(t, pd)).toMatchObject({ initials: "SO", nameSource: "documents_disagree" });
    await expectCountsMatchRecount(t, "after new bytes");
  });

  it("keeps every count and the naming rules through a seeded run of reads, new bytes, picks, renames, deletes and approvals", async () => {
    vi.stubEnv("VOYAGE_API_KEY", "test-voyage-key");
    const { t, admin } = await setup();
    t.registerComponent("embedPool", workpoolSchema, workpoolModules);
    const rand = seeded(RANDOM_SEED + 16);
    const pick = <X>(list: readonly X[]): X => list[Math.floor(rand() * list.length)];
    const TEXTS: Record<string, string[]> = {
      DW: [DANA_PD, "Written by Dan Wells", "Prepared by Dana Whitlock. Written by Dan Wells.", "No writer here.", "Reviewed by Dana Whitlock"],
      PN: ["Author: Priya Nair", "Prepared by Pat Nolan", "Prepared by PN."],
      SO: ["Prepared by Sam Okafor", "Writer: Sam Okafor"],
    };
    const ids: Array<Id<"ingestionItems">> = [];
    /** The name an Admin last gave each writer: no PD ever changes it. */
    const adminNames = new Map<string, string | undefined>();
    const sourcesSeen = new Set<string>();
    let n = 0;
    const steps: Array<[string, () => Promise<unknown>]> = [
      ["read", async () => {
        const initials = pick(["DW", "PN", "SO"]);
        ids.push(await readPd(t, initials, ++n, pick(TEXTS[initials])));
      }],
      ["new bytes", async () => {
        if (ids.length === 0) return;
        const row = await getItem(t, pick(ids));
        if (row.status === "approved" || !row.writerInitials) return;
        await t.mutation(internal.ingestion.upsertDiscoveredItem, {
          ...discoveredArgs(row.path, { driveItemId: row.driveItemId, contentHash: `h${++n}` }),
        });
        const text = pick(TEXTS[row.writerInitials]);
        const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["bytes"])));
        await t.mutation(internal.ingestion.markItemProcessed, {
          itemId: row._id,
          storageId,
          text: "Text",
          documentScienceCode: "2.02.09",
          documentWriterNames: writerNamesFromText(text),
        });
      }],
      ["pick and Undo", async () => {
        const initials = pick(["DW", "PN", "SO"]);
        const before = await writerState(t);
        const result = await admin.mutation(api.ingestion.matchWriterInitials, { initials, writer: { kind: "name", name: "Jordan Ellis" } });
        await runWriterWalk(t);
        await admin.mutation(api.ingestion.matchWriterInitials, { initials, writer: result.previous });
        await runWriterWalk(t);
        expect(await writerState(t)).toEqual(before);
      }],
      ["rename", async () => {
        const past = (await allWriters(t)).filter((writer) => !writer.userId && writer.initials);
        if (past.length === 0) return;
        const writer = pick(past);
        const name = pick(["Dana Whitlock", "Kim Tran", ""]);
        await admin.mutation(api.users.renamePastWriter, { writerId: writer._id, name });
        // An empty name on a writer with none changes nothing.
        if (name || writer.name) adminNames.set(writer._id, name || undefined);
      }],
      ["delete or put back", async () => {
        if (ids.length === 0) return;
        const id = pick(ids);
        const row = await getItem(t, id);
        if (row.status === "pending_review") await admin.mutation(api.ingestion.removeItems, { ids: [id] });
        else if (row.status === "deleted") await admin.mutation(api.ingestion.restoreItems, { ids: [id] });
      }],
      ["approve", async () => {
        const open = [];
        for (const id of ids) if ((await getItem(t, id)).status === "pending_review") open.push(id);
        if (open.length === 0) return;
        await approveForTest(t, admin, pick(open));
      }],
    ];
    for (let step = 0; step < 60; step += 1) {
      // Reads three times as often as each other step.
      const [name, run] = step < 4 ? steps[0] : pick([steps[0], steps[0], ...steps]);
      await run();
      await runWriterWalk(t);
      const label = `seed ${RANDOM_SEED + 16}, step ${step}: ${name}`;
      await expectCountsMatchRecount(t, label);
      for (const writer of await allWriters(t)) {
        if (writer.nameSource) sourcesSeen.add(writer.nameSource);
        if (adminNames.has(writer._id)) {
          expect(writer.name, label).toBe(adminNames.get(writer._id));
          expect(writer.nameSource, label).toBe("person");
        }
        if (writer.nameSource === "document") {
          expect(writer, label).toMatchObject({ createdVia: "import" });
          expect(writer.userId, label).toBeUndefined();
          expect(nameMatchesInitials(writer.name!, writer.initials!), label).toBe(true);
        }
        if (writer.nameSource === "documents_disagree") expect(writer.name, label).toBeUndefined();
      }
      // At most one writer the check made per initials: a named one is still THE writer for them.
      const made = (await allWriters(t)).filter((writer) => writer.createdVia === "import" && writer.initials);
      expect(new Set(made.map((writer) => writer.initials)).size, label).toBe(made.length);
    }
    // The run reaches each case.
    expect([...sourcesSeen].sort()).toEqual(["document", "documents_disagree", "person"]);
  });

  it("reads the names of files read before, in pages on To review, Deleted and Approved, after the writers backfill, and can run again", async () => {
    const { t, admin } = await setup();
    const named = await readBefore(t, "DW", 1, DANA_PD);
    // More files to read on To review than one run reads (25), so its page runs twice.
    for (let n = 2; n <= 27; n += 1) await readBefore(t, "DW", n, "No writer here.");
    const deleted = await readBefore(t, "PN", 30, "Written by Priya Nair");
    await admin.mutation(api.ingestion.removeItems, { ids: [deleted] });
    const approved = await readBefore(t, "SO", 31, "Author: Sam Okafor");
    await approveForTest(t, admin, approved);
    const transcriptId = await stage(t, `${CEDARLINE_FY}/WIP/Technical/Audio/interview.docx`);
    await markRead(t, transcriptId, "Prepared by Kim Tran");
    expect((await writerOf(t, named))!.name).toBeUndefined();

    // Chained after the writers backfill: To review twice, then Deleted and Approved.
    await t.mutation(internal.ingestion.backfillImportWriters, { tab: "review", cursor: null });
    const runs = await runWriterWalk(t);
    expect(runs).toMatchObject({ backfillImportWriters: 2, backfillDocumentWriterNames: 4 });
    expect(await writerOf(t, named)).toMatchObject({ name: "Dana Whitlock", nameSource: "document" });
    expect(await writerOf(t, deleted)).toMatchObject({ name: "Priya Nair", nameSource: "document" });
    expect(await writerOf(t, approved)).toMatchObject({ name: "Sam Okafor", nameSource: "document" });
    // Every file with initials has its names; the transcript was not read for them.
    expect((await getItem(t, named)).documentWriterNames).toEqual(["Dana Whitlock"]);
    expect((await getItem(t, await stage(t, pdPath("DW", 2), { driveItemId: "before-DW-2" }))).documentWriterNames).toEqual([]);
    expect((await getItem(t, transcriptId)).documentWriterNames).toBeUndefined();
    // Stored names follow on To review and Deleted; the approved file keeps its own.
    expect((await getItem(t, named)).writerName).toBe("Dana Whitlock");
    expect((await getItem(t, deleted)).writerName).toBe("Priya Nair");
    expect((await getItem(t, approved)).writerName).toBe("SO");
    await expectCountsMatchRecount(t, "after the names backfill");

    // On its own, again: nothing more.
    const before = await t.run(async (ctx) => ({
      items: await ctx.db.query("ingestionItems").collect(),
      writers: await ctx.db.query("pdWriters").collect(),
    }));
    await expect(t.action(internal.ingestion.backfillDocumentWriterNames, {})).resolves.toEqual({ recorded: 0, done: false });
    // To review fits one page of 100 rows now; then Deleted and Approved.
    expect(await runWriterWalk(t)).toEqual({ backfillDocumentWriterNames: 2 });
    const after = await t.run(async (ctx) => ({
      items: await ctx.db.query("ingestionItems").collect(),
      writers: await ctx.db.query("pdWriters").collect(),
    }));
    expect(after).toEqual(before);
  });
});

// ─── Inviting a past writer (2026-11-17) ────────────────────────────────────

/** An invite's new account, made the way sign-up makes it (auth.ts onCreate). */
async function acceptInvite(t: T, token: string, email: string, firstName: string, lastName: string) {
  await t.mutation(api.invites.confirmInviteNames, { token, firstName, lastName });
  await t.mutation(internal.auth.onCreate, {
    model: "user",
    doc: { _id: `auth-${firstName}`, email, name: `${firstName} ${lastName}` },
  });
  return (await t.run((ctx) => ctx.db.query("users").withIndex("by_authId", (q) => q.eq("authId", `auth-${firstName}`)).unique()))!;
}

async function inviteFor(admin: ReturnType<T["withIdentity"]>, writerId: Id<"pdWriters">, email: string) {
  const [result] = await admin.mutation(api.invites.createInvites, { emails: [email], role: "writer", pdWriterId: writerId });
  if (result.status !== "created") throw new Error(result.status);
  return result;
}

describe("inviting a past writer (2026-11-17)", () => {
  it("lets only an Admin invite a past writer, one address, once while it waits, and shows the invite on the writer", async () => {
    const { t, admin } = await setup();
    const dw = (await writerOf(t, await pdBy(t, "DW", 1)))!;
    await addMember(t, "Sam", "Okafor", { role: "manager" });
    const manager = t.withIdentity({ subject: "member-Sam-Okafor" });
    await expect(
      manager.mutation(api.invites.createInvites, { emails: ["dana@example.com"], role: "writer", pdWriterId: dw._id })
    ).rejects.toThrow("Only an Admin can invite a past writer");
    // A Manager still invites people the usual way.
    await expect(manager.mutation(api.invites.createInvites, { emails: ["kim@example.com"], role: "writer" })).resolves.toMatchObject([
      { status: "created" },
    ]);
    await expect(
      admin.mutation(api.invites.createInvites, { emails: ["a@example.com", "b@example.com"], role: "writer", pdWriterId: dw._id })
    ).rejects.toThrow("Add one email address for this person");

    expect((await admin.query(api.users.listPastWriters, {}))[0]).toMatchObject({ _id: dw._id, invitePending: false });
    const created = await inviteFor(admin, dw._id, "dana@example.com");
    expect(await t.run((ctx) => ctx.db.get(created.inviteId))).toMatchObject({ pdWriterId: dw._id, status: "pending" });
    expect((await admin.query(api.users.listPastWriters, {}))[0]).toMatchObject({ _id: dw._id, invitePending: true });
    await expect(inviteFor(admin, dw._id, "dana.w@example.com")).rejects.toThrow("This person has an invite waiting already");
    // Managers read it too.
    expect((await manager.query(api.users.listPastWriters, {}))[0]).toMatchObject({ invitePending: true });

    // Revoking changes nothing on the writer, and a new invite can be sent.
    await admin.mutation(api.invites.revokeInvite, { inviteId: created.inviteId });
    expect((await admin.query(api.users.listPastWriters, {}))[0]).toMatchObject({ _id: dw._id, invitePending: false });
    expect(await t.run((ctx) => ctx.db.get(dw._id))).toEqual(dw);
    await inviteFor(admin, dw._id, "dana@example.com");
    // An expired invite no longer counts as waiting.
    await t.run(async (ctx) => {
      for (const invite of await ctx.db.query("invites").collect()) await ctx.db.patch(invite._id, { expiresAt: 1 });
    });
    expect((await admin.query(api.users.listPastWriters, {}))[0]).toMatchObject({ invitePending: false });
  });

  it("links the past writer to the new account when the invite is accepted, in the same step", async () => {
    const { t, admin } = await setup();
    const pd = await readPd(t, "DW", 1, DANA_PD);
    const approved = await pdBy(t, "DW", 2);
    await approveForTest(t, admin, approved);
    const dw = (await writerOf(t, pd))!;
    const adminId = (await t.run((ctx) => ctx.db.query("users").withIndex("by_authId", (q) => q.eq("authId", "sheet-admin")).unique()))!._id;
    const created = await inviteFor(admin, dw._id, "dana@example.com");
    const before = await writerPointers(t);
    const dana = await acceptInvite(t, created.token, "dana@example.com", "Dana", "Whitlock");
    expect(await t.run((ctx) => ctx.db.get(dw._id))).toMatchObject({ userId: dana._id, linkedBy: adminId, linkedAt: expect.any(Number) });
    expect(await t.run((ctx) => ctx.db.get(created.inviteId))).toMatchObject({ status: "accepted", acceptedUserId: dana._id });
    // No file changes writer; every file, approved too, shows her now.
    expect(await writerPointers(t)).toEqual(before);
    for (const id of [pd, approved]) expect(await shownWriter(admin, id)).toEqual({ name: "Dana Whitlock", hasLogin: true });
    await runWriterWalk(t);
    expect((await getItem(t, pd)).writerName).toBe("Dana Whitlock");
    expect(await admin.query(api.users.listPastWriters, {})).toEqual([]);
    const members = await admin.query(api.team.listMembers, {});
    expect(members.find((member) => member._id === dana._id)).toMatchObject({ initials: "DW", linkedWriter: { writerId: dw._id } });
    await expectCountsMatchRecount(t, "after an invite linked a past writer");
  });

  it("lets only an Admin resend an invite for a past writer, and never while a newer one waits or once it is linked", async () => {
    const { t, admin } = await setup();
    const dw = (await writerOf(t, await pdBy(t, "DW", 1)))!;
    await addMember(t, "Sam", "Okafor", { role: "manager" });
    const manager = t.withIdentity({ subject: "member-Sam-Okafor" });
    const old = await inviteFor(admin, dw._id, "dana@example.com");
    await expect(manager.mutation(api.invites.resendInvite, { inviteId: old.inviteId })).rejects.toThrow(
      "Only an Admin can resend an invite for a past writer"
    );
    // The only one: an Admin resends it.
    await expect(admin.mutation(api.invites.resendInvite, { inviteId: old.inviteId })).resolves.toMatchObject({ token: expect.any(String) });
    // It expires and a newer one is sent: the old one cannot come back.
    await t.run((ctx) => ctx.db.patch(old.inviteId, { expiresAt: 1 }));
    const newer = await inviteFor(admin, dw._id, "dana.w@example.com");
    await expect(admin.mutation(api.invites.resendInvite, { inviteId: old.inviteId })).rejects.toThrow("This person has a newer invite waiting");
    // Linked meanwhile: no resend at all.
    await admin.mutation(api.invites.revokeInvite, { inviteId: newer.inviteId });
    const kim = await addMember(t, "Kim", "Tran", { initials: "KT" });
    await admin.mutation(api.users.linkPastWriter, { writerId: dw._id, userId: kim });
    await expect(admin.mutation(api.invites.resendInvite, { inviteId: old.inviteId })).rejects.toThrow("This writer is linked to an account already");
    // A plain invite is resent by a Manager as before.
    const [plain] = await manager.mutation(api.invites.createInvites, { emails: ["jordan@example.com"], role: "writer" });
    if (plain.status !== "created") throw new Error(plain.status);
    await expect(manager.mutation(api.invites.resendInvite, { inviteId: plain.inviteId })).resolves.toMatchObject({ token: expect.any(String) });
  });

  it("never resends an invite while another for the same email waits, so sign-up links the writer of the invite it takes", async () => {
    const { t, admin } = await setup();
    const dw = (await writerOf(t, await pdBy(t, "DW", 1)))!;
    const pn = (await writerOf(t, await pdBy(t, "PN", 2)))!;
    // Writer A's invite expires; writer B's is sent to the same email.
    const forA = await inviteFor(admin, dw._id, "sam@example.com");
    await t.run((ctx) => ctx.db.patch(forA.inviteId, { expiresAt: 1 }));
    const forB = await inviteFor(admin, pn._id, "sam@example.com");
    // A's cannot come back while B's waits.
    await expect(admin.mutation(api.invites.resendInvite, { inviteId: forA.inviteId })).rejects.toThrow(
      "This email has a newer invite waiting. Use that one."
    );
    const sam = await acceptInvite(t, forB.token, "sam@example.com", "Sam", "Rivera");
    expect(await t.run((ctx) => ctx.db.get(pn._id))).toMatchObject({ userId: sam._id });
    expect((await t.run((ctx) => ctx.db.get(dw._id)))?.userId).toBeUndefined();
    // The same rule for a plain invite.
    const [one] = await admin.mutation(api.invites.createInvites, { emails: ["jo@example.com"], role: "writer" });
    if (one.status !== "created") throw new Error(one.status);
    await t.run((ctx) => ctx.db.patch(one.inviteId, { expiresAt: 1 }));
    const [two] = await admin.mutation(api.invites.createInvites, { emails: ["jo@example.com"], role: "writer" });
    if (two.status !== "created") throw new Error(two.status);
    await expect(admin.mutation(api.invites.resendInvite, { inviteId: one.inviteId })).rejects.toThrow("This email has a newer invite waiting");
    await expect(admin.mutation(api.invites.resendInvite, { inviteId: two.inviteId })).resolves.toMatchObject({ token: expect.any(String) });
  });

  it("refuses sign-up when an email has two live invites, so it never links the wrong past writer", async () => {
    const { t, admin } = await setup();
    const dw = (await writerOf(t, await pdBy(t, "DW", 1)))!;
    const pn = (await writerOf(t, await pdBy(t, "PN", 2)))!;
    const forA = await inviteFor(admin, dw._id, "sam@example.com");
    // Made before the resend rule, say: a second live invite for the same email.
    const forB = await t.run(async (ctx) => {
      const a = (await ctx.db.get(forA.inviteId))!;
      const { _id, _creationTime, ...rest } = a;
      return await ctx.db.insert("invites", { ...rest, token: "second-token", pdWriterId: pn._id });
    });
    await expect(acceptInvite(t, forA.token, "sam@example.com", "Sam", "Rivera")).rejects.toThrow(
      "This email has more than one invite waiting"
    );
    expect((await t.run((ctx) => ctx.db.get(dw._id)))?.userId).toBeUndefined();
    expect((await t.run((ctx) => ctx.db.get(pn._id)))?.userId).toBeUndefined();
    // Once the extra one is revoked, the link that is left works.
    await admin.mutation(api.invites.revokeInvite, { inviteId: forB });
    const sam = await acceptInvite(t, forA.token, "sam@example.com", "Sam", "Rivera");
    expect(await t.run((ctx) => ctx.db.get(dw._id))).toMatchObject({ userId: sam._id });
  });

  it("never misses a live invite behind many old ones for the same email", async () => {
    const { t, admin } = await setup();
    const dw = (await writerOf(t, await pdBy(t, "DW", 1)))!;
    const live = await inviteFor(admin, dw._id, "sam@example.com");
    const old = await t.run(async (ctx) => {
      const row = (await ctx.db.get(live.inviteId))!;
      const { _id, _creationTime, ...rest } = row;
      const ids = [];
      // 55 expired invites for the same email, all still pending.
      for (let n = 0; n < 55; n += 1) ids.push(await ctx.db.insert("invites", { ...rest, token: `old-${n}`, expiresAt: 1, pdWriterId: undefined }));
      return ids;
    });
    // No second live invite: not by a new invite, not by a resend.
    const [again] = await admin.mutation(api.invites.createInvites, { emails: ["sam@example.com"], role: "writer" });
    expect(again.status).toBe("already_invited");
    await expect(admin.mutation(api.invites.resendInvite, { inviteId: old[0] })).rejects.toThrow(TOO_MANY_PENDING_INVITES);
    // Sign-up cannot tell it read them all, so it refuses rather than guess.
    await expect(acceptInvite(t, live.token, "sam@example.com", "Sam", "Rivera")).rejects.toThrow(TOO_MANY_PENDING_INVITES);
    // Once the old ones are revoked, the live link works.
    for (const id of old) await admin.mutation(api.invites.revokeInvite, { inviteId: id });
    const sam = await acceptInvite(t, live.token, "sam@example.com", "Sam", "Rivera");
    expect(await t.run((ctx) => ctx.db.get(dw._id))).toMatchObject({ userId: sam._id });
  });

  it("links on acceptance only while the Admin who sent the invite is still an Admin", async () => {
    const { t, admin } = await setup();
    const dw = (await writerOf(t, await pdBy(t, "DW", 1)))!;
    const created = await inviteFor(admin, dw._id, "dana@example.com");
    await t.run(async (ctx) => {
      const sender = await ctx.db.query("users").withIndex("by_authId", (q) => q.eq("authId", "sheet-admin")).unique();
      await ctx.db.patch(sender!._id, { role: "manager" });
    });
    const dana = await acceptInvite(t, created.token, "dana@example.com", "Dana", "Whitlock");
    expect(dana).toMatchObject({ role: "writer" });
    expect(await t.run((ctx) => ctx.db.get(created.inviteId))).toMatchObject({ status: "accepted" });
    expect((await t.run((ctx) => ctx.db.get(dw._id)))!.userId).toBeUndefined();
  });

  it("finds the invite that waits behind five expired ones, and keeps a bare writer an invite waits for", async () => {
    const { t, admin } = await setup();
    const pd = await pdBy(t, "DW", 1);
    const dw = (await writerOf(t, pd))!;
    const adminId = (await t.run((ctx) => ctx.db.query("users").withIndex("by_authId", (q) => q.eq("authId", "sheet-admin")).unique()))!._id;
    await t.run(async (ctx) => {
      for (let n = 0; n < 5; n += 1) {
        await ctx.db.insert("invites", {
          email: `old${n}@example.com`, role: "writer", token: `old-${n}`, invitedBy: adminId,
          createdAt: 1, expiresAt: 2, status: "pending", pdWriterId: dw._id,
        });
      }
    });
    expect((await admin.query(api.users.listPastWriters, {}))[0]).toMatchObject({ invitePending: false });
    await t.run((ctx) =>
      ctx.db.insert("invites", {
        email: "dana@example.com", role: "writer", token: "live", invitedBy: adminId,
        createdAt: Date.now(), expiresAt: Date.now() + 86_400_000, status: "pending", pdWriterId: dw._id,
      })
    );
    expect((await admin.query(api.users.listPastWriters, {}))[0]).toMatchObject({ invitePending: true });
    await expect(inviteFor(admin, dw._id, "dana.w@example.com")).rejects.toThrow("This person has an invite waiting already");

    // Its only file moves to Transcripts: the bare writer stays while the invite waits.
    const move = () =>
      t.mutation(internal.ingestion.upsertDiscoveredItem, {
        ...discoveredArgs(`${CEDARLINE_FY}/WIP/Technical/Audio/01 CedarlineSystems 2025-03-31 T1.DW Project1.docx`, {
          driveItemId: `DW-1-${CEDARLINE_FY}`,
        }),
      });
    await move();
    expect(await t.run((ctx) => ctx.db.get(dw._id))).toMatchObject({ fileCount: 0 });
    await expectCountsMatchRecount(t, "after a bare writer an invite waits for lost its last file");
  });

  it("finds an old invite resent after ten newer ones expired: Invite sent shows and a new invite is refused", async () => {
    const { t, admin } = await setup();
    const dw = (await writerOf(t, await pdBy(t, "DW", 1)))!;
    const adminId = (await t.run((ctx) => ctx.db.query("users").withIndex("by_authId", (q) => q.eq("authId", "sheet-admin")).unique()))!._id;
    // Eleven expired invites; the first made is the oldest.
    const ids = await t.run(async (ctx) => {
      const made: Id<"invites">[] = [];
      for (let n = 0; n < 11; n += 1) {
        made.push(
          await ctx.db.insert("invites", {
            email: `old${n}@example.com`, role: "writer", token: `old-${n}`, invitedBy: adminId,
            createdAt: 1 + n, expiresAt: 2 + n, status: "pending", pdWriterId: dw._id,
          })
        );
      }
      return made;
    });
    expect((await admin.query(api.users.listPastWriters, {}))[0]).toMatchObject({ _id: dw._id, invitePending: false });
    // The oldest is resent: its expiry moves past now, its creation order stays.
    await expect(admin.mutation(api.invites.resendInvite, { inviteId: ids[0] })).resolves.toMatchObject({ token: expect.any(String) });
    expect((await admin.query(api.users.listPastWriters, {}))[0]).toMatchObject({ _id: dw._id, invitePending: true });
    await expect(inviteFor(admin, dw._id, "dana.w@example.com")).rejects.toThrow("This person has an invite waiting already");
    // Another of the expired ones cannot be resent beside it.
    await expect(admin.mutation(api.invites.resendInvite, { inviteId: ids[10] })).rejects.toThrow("This person has a newer invite waiting");
  });

  it("skips the link quietly when the writer was deleted or linked meanwhile, and accepts the invite as usual", async () => {
    const { t, admin } = await setup();
    // Deleted: a past writer no file points at.
    const lone = await t.run((ctx) => ctx.db.insert("pdWriters", { initials: "PN", name: "Priya Nair", createdVia: "person", createdAt: 1, fileCount: 0 }));
    const toDeleted = await inviteFor(admin, lone, "priya@example.com");
    await admin.mutation(api.users.deletePastWriter, { writerId: lone });
    const priya = await acceptInvite(t, toDeleted.token, "priya@example.com", "Priya", "Nair");
    expect(priya).toMatchObject({ role: "writer" });
    expect(await t.run((ctx) => ctx.db.get(toDeleted.inviteId))).toMatchObject({ status: "accepted" });
    expect(await t.run((ctx) => ctx.db.query("pdWriters").withIndex("by_userId", (q) => q.eq("userId", priya._id)).collect())).toEqual([]);

    // Linked to someone else meanwhile: it stays with them.
    const so = (await writerOf(t, await pdBy(t, "SO", 1)))!;
    const toLinked = await inviteFor(admin, so._id, "sam@example.com");
    const kim = await addMember(t, "Kim", "Tran", { initials: "KT" });
    await admin.mutation(api.users.linkPastWriter, { writerId: so._id, userId: kim });
    const sam = await acceptInvite(t, toLinked.token, "sam@example.com", "Sam", "Okafor");
    expect(await t.run((ctx) => ctx.db.get(so._id))).toMatchObject({ userId: kim });
    expect(await t.run((ctx) => ctx.db.query("pdWriters").withIndex("by_userId", (q) => q.eq("userId", sam._id)).collect())).toEqual([]);
    await expectCountsMatchRecount(t, "after invites whose writers moved on");
  });
});

// ─── A new company's industry (2026-11-12) ──────────────────────────────────

describe("setNewCompanyIndustry", () => {
  it("keeps a new company's industry by its key, on every tab, as a slug from the industry list", async () => {
    const { t, admin } = await setup();
    const id = await stage(t, "Halden Foods/2025 - Jun 30/Drafts/plan.docx");
    await markRead(t, id);
    await expect(
      admin.mutation(api.ingestion.setNewCompanyIndustry, { companyKey: "halden foods", industry: "Food processing" })
    ).resolves.toEqual({ industry: "food-processing" });
    const band = async (tab: "review" | "deleted") =>
      (await admin.query(api.ingestion.sheetCompanies, { tab, onlyToCheck: false, paginationOpts: PAGE })).page[0];
    expect(await band("review")).toMatchObject({ companyKey: "halden foods", isNew: true, pickedIndustry: "food-processing" });
    // Changed, then the company's files move to Deleted: the pick goes with the company.
    await admin.mutation(api.ingestion.setNewCompanyIndustry, { companyKey: "halden foods", industry: "manufacturing" });
    await admin.mutation(api.ingestion.removeItems, { ids: [id] });
    expect(await band("deleted")).toMatchObject({ companyKey: "halden foods", pickedIndustry: "manufacturing" });
    expect(await t.run((ctx) => ctx.db.query("importNewCompanies").collect())).toHaveLength(1);
  });

  it("refuses a company the app already has, no company, and anyone but an admin", async () => {
    const { t, admin, writer } = await setup();
    await seedCompanies(t);
    await expect(
      admin.mutation(api.ingestion.setNewCompanyIndustry, { companyKey: "cedarline systems", industry: "software" })
    ).rejects.toThrow("This company is already in Banhall. Change its industry on its company page.");
    await expect(admin.mutation(api.ingestion.setNewCompanyIndustry, { companyKey: "", industry: "software" })).rejects.toThrow(
      "Pick the company first."
    );
    await expect(admin.mutation(api.ingestion.setNewCompanyIndustry, { companyKey: "halden foods", industry: " - " })).rejects.toThrow(
      "Pick an industry."
    );
    await expect(
      writer.mutation(api.ingestion.setNewCompanyIndustry, { companyKey: "halden foods", industry: "software" })
    ).rejects.toThrow(/Admin only/);
  });
});

// ─── Adding files (2026-11-12, the Import page's drop and the uploader) ─────

/** The SHA-256 hex of some bytes, as the page and the uploader send it. */
async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** What the browser uploads: the bytes stored through an upload URL, and their hash. */
async function uploaded(t: T, text: string) {
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob([text])));
  return { storageId, contentHash: await sha256Hex(text) };
}

async function batchOf(t: T, id: Id<"importBatches">) {
  const batch = await t.run((ctx) => ctx.db.get(id));
  if (!batch) throw new Error("batch missing");
  return batch;
}

async function itemAt(t: T, path: string) {
  const row = await t.run((ctx) =>
    ctx.db
      .query("ingestionItems")
      .withIndex("by_driveItemId", (q) => q.eq("driveItemId", `local:${path}`))
      .unique()
  );
  if (!row) throw new Error(`no item at ${path}`);
  return row;
}

const DROP_PD = `${CEDARLINE_FY}/To be submitted/${PD_NAME}`;

describe("adding files on the Import page", () => {
  it("stages a dropped file through the upload route's own steps, so it is the same row either way", async () => {
    // The Import page: hash, start a batch, upload, stage.
    const page = await setup();
    const bytes = await uploaded(page.t, "Cold chain sensor drift, PD text");
    const batchId = await page.admin.mutation(api.ingestion.startImportBatch, { toSend: 1, alreadyHere: 0 });
    const outcomes = await page.admin.mutation(api.ingestion.stageImportFiles, {
      batchId,
      files: [{ path: DROP_PD, ...bytes, lastModifiedAt: 1_700_000_000_000 }],
    });
    expect(outcomes).toEqual([{ path: DROP_PD, outcome: "added" }]);
    const fromPage = await itemAt(page.t, DROP_PD);

    // The uploader: the upload route's two steps for the same path and bytes.
    const route = await setup();
    const routeBytes = await uploaded(route.t, "Cold chain sensor drift, PD text");
    const { uploadUpsertFields } = await import("./lib/ingestionClassify");
    const id = await route.t.mutation(internal.ingestion.upsertDiscoveredItem, {
      ...uploadUpsertFields(DROP_PD, 32, 1_700_000_000_000, routeBytes.contentHash),
      via: "uploader",
    });
    await route.t.mutation(internal.ingestion.attachUpload, { itemId: id!, storageId: routeBytes.storageId });
    const fromRoute = await itemAt(route.t, DROP_PD);

    const sameness = (row: Doc<"ingestionItems">) => {
      const { _id, _creationTime, storageId, batchId, arrivedAt, updatedAt, ...rest } = row;
      return rest;
    };
    expect(sameness(fromPage)).toEqual(sameness(fromRoute));
    expect(fromPage).toMatchObject({
      status: "fetched",
      category: "final_pd",
      sheetSection: "unknown",
      companyKey: "cedarline systems",
      isNew: true,
      batchId,
      batchReadPending: true,
      storageId: bytes.storageId,
    });
    // Reading is the route's too: the extraction action is scheduled for it.
    const jobs = await page.t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(jobs.filter((job) => job.name.includes("extractUploadedItem")).map((job) => job.args[0])).toEqual([
      { itemId: fromPage._id },
    ]);
    // Nothing reaches the Brain, a company or a project.
    const elsewhere = await page.t.run(async (ctx) => ({
      brain: await ctx.db.query("brainSources").collect(),
      clients: await ctx.db.query("clients").collect(),
      projects: await ctx.db.query("projects").collect(),
      documents: await ctx.db.query("projectDocuments").collect(),
    }));
    expect(elsewhere).toEqual({ brain: [], clients: [], projects: [], documents: [] });
    await expectCountsMatchRecount(page.t, "after a dropped file");
    expect(await batchOf(page.t, batchId)).toMatchObject({ source: "page", added: 1, alreadyHere: 0, read: 0 });
  });

  it("says which files are already here before their bytes are sent, and never a file that could not be read", async () => {
    const { t, admin, writer } = await setup();
    const kept = await uploaded(t, "kept bytes");
    const broken = await uploaded(t, "broken bytes");
    const batchId = await admin.mutation(api.ingestion.startImportBatch, { toSend: 2, alreadyHere: 0 });
    await admin.mutation(api.ingestion.stageImportFiles, {
      batchId,
      files: [
        { path: `${CEDARLINE_FY}/Drafts/kept.docx`, ...kept, lastModifiedAt: 1 },
        { path: `${CEDARLINE_FY}/Drafts/broken.docx`, ...broken, lastModifiedAt: 1 },
      ],
    });
    const brokenRow = await itemAt(t, `${CEDARLINE_FY}/Drafts/broken.docx`);
    await t.mutation(internal.ingestion.markItemFailed, { itemId: brokenRow._id, error: "Damaged" });
    const fresh = await sha256Hex("never seen");
    // Matched by bytes, whatever folder the file sits in now.
    expect(
      await admin.query(api.ingestion.importFilesHere, {
        hashes: [kept.contentHash, broken.contentHash, fresh, "not a hash"],
      })
    ).toEqual([kept.contentHash]);
    expect(await writer.query(api.ingestion.importFilesHere, { hashes: [kept.contentHash] })).toBeNull();
    await expect(
      admin.query(api.ingestion.importFilesHere, { hashes: Array.from({ length: 201 }, () => fresh) })
    ).rejects.toThrow(/at most 200/);

    // Sent anyway (another tab raced it): skipped, and its upload deleted.
    const again = await uploaded(t, "kept bytes");
    const outcomes = await admin.mutation(api.ingestion.stageImportFiles, {
      batchId,
      files: [{ path: `${CEDARLINE_FY}/Drafts/kept.docx`, ...again, lastModifiedAt: 1 }],
    });
    expect(outcomes).toEqual([{ path: `${CEDARLINE_FY}/Drafts/kept.docx`, outcome: "already_here" }]);
    expect(await t.run((ctx) => ctx.db.system.get("_storage", again.storageId))).toBeNull();
    expect(await batchOf(t, batchId)).toMatchObject({ added: 2, alreadyHere: 1 });
  });

  it("refuses what the upload route refuses, junk, a wrong hash, an upload a row holds, and another person's batch", async () => {
    const { t, admin, writer } = await setup();
    await t.run((ctx) => ctx.db.insert("users", { authId: "sheet-admin-2", role: "admin", firstName: "Priya" }));
    const other = t.withIdentity({ subject: "sheet-admin-2" });
    const batchId = await admin.mutation(api.ingestion.startImportBatch, { toSend: 6, alreadyHere: 0 });
    const bytes = async (text: string) => uploaded(t, text);
    const wrong = await bytes("the real bytes");
    const sheet = await bytes("a spreadsheet");
    const lock = await bytes("lock file");
    const empty = await bytes("");
    const held = await bytes("held by a row");
    const badPath = await bytes("a path with nothing safe left");
    await t.run((ctx) => ctx.db.insert("ingestionItems", { ...discoveredArgs("Halden Foods/x.docx"), storageId: held.storageId, status: "pending_review", updatedAt: 1 }));
    const outcomes = await admin.mutation(api.ingestion.stageImportFiles, {
      batchId,
      files: [
        { path: `${CEDARLINE_FY}/a.docx`, storageId: wrong.storageId, contentHash: await sha256Hex("other bytes"), lastModifiedAt: 1 },
        { path: `${CEDARLINE_FY}/budget.xlsx`, ...sheet, lastModifiedAt: 1 },
        { path: `${CEDARLINE_FY}/~$a.docx`, ...lock, lastModifiedAt: 1 },
        { path: `${CEDARLINE_FY}/empty.docx`, ...empty, lastModifiedAt: 1 },
        { path: `${CEDARLINE_FY}/held.docx`, ...held, lastModifiedAt: 1 },
        { path: "../..", ...badPath, lastModifiedAt: 1 },
      ],
    });
    expect(outcomes.map((outcome) => [outcome.outcome, outcome.reason])).toEqual([
      ["refused", "hash"],
      ["refused", "type"],
      ["refused", "junk"],
      ["refused", "empty"],
      ["refused", "in_use"],
      ["refused", "path"],
    ]);
    // Refused uploads are deleted; the one a row holds is kept.
    for (const id of [wrong.storageId, sheet.storageId, lock.storageId, empty.storageId, badPath.storageId]) {
      expect(await t.run((ctx) => ctx.db.system.get("_storage", id))).toBeNull();
    }
    expect(await t.run((ctx) => ctx.db.system.get("_storage", held.storageId))).not.toBeNull();
    expect(await batchOf(t, batchId)).toMatchObject({ added: 0, alreadyHere: 0 });

    // An upload older than an hour cannot be claimed.
    const stale = await bytes("stale bytes");
    vi.advanceTimersByTime(61 * 60_000);
    expect(
      await admin.mutation(api.ingestion.stageImportFiles, {
        batchId,
        files: [{ path: `${CEDARLINE_FY}/stale.docx`, ...stale, lastModifiedAt: 1 }],
      })
    ).toEqual([{ path: `${CEDARLINE_FY}/stale.docx`, outcome: "refused", reason: "missing" }]);

    // Only the admin who started a batch adds to it, finishes or reopens it.
    const mine = await bytes("mine");
    await expect(
      other.mutation(api.ingestion.stageImportFiles, { batchId, files: [{ path: `${CEDARLINE_FY}/m.docx`, ...mine, lastModifiedAt: 1 }] })
    ).rejects.toThrow(/another upload/);
    await expect(other.mutation(api.ingestion.finishImportBatch, { batchId, failed: 0 })).rejects.toThrow(/another upload/);
    await expect(writer.mutation(api.ingestion.startImportBatch, { toSend: 1, alreadyHere: 0 })).rejects.toThrow(/Admin only/);
    await expect(writer.mutation(api.ingestion.generateUploadUrl, {})).rejects.toThrow(/Admin only/);
    await expect(
      admin.mutation(api.ingestion.stageImportFiles, {
        batchId,
        files: Array.from({ length: 11 }, (_, index) => ({ path: `${CEDARLINE_FY}/${index}.docx`, ...mine, lastModifiedAt: 1 })),
      })
    ).rejects.toThrow(/at most 10/);
  });

  it("counts a batch's files as they are read, and what the browser could not send", async () => {
    const { t, admin } = await setup();
    const batchId = await admin.mutation(api.ingestion.startImportBatch, { toSend: 3, alreadyHere: 12 });
    const files = [];
    for (const name of ["a", "b", "c"]) {
      files.push({ path: `${CEDARLINE_FY}/Drafts/${name}.docx`, ...(await uploaded(t, `bytes ${name}`)), lastModifiedAt: 1 });
    }
    await admin.mutation(api.ingestion.stageImportFiles, { batchId, files });
    await admin.mutation(api.ingestion.finishImportBatch, { batchId, failed: 2 });
    expect(await batchOf(t, batchId)).toMatchObject({ added: 3, alreadyHere: 12, failed: 2, sendingDone: true, read: 0 });

    const [a, b] = [await itemAt(t, files[0].path), await itemAt(t, files[1].path)];
    await markRead(t, a._id);
    await t.mutation(internal.ingestion.markItemFailed, { itemId: b._id, error: "Damaged" });
    expect(await batchOf(t, batchId)).toMatchObject({ read: 2, couldNotRead: 1 });
    expect((await getItem(t, a._id)).batchReadPending).toBeUndefined();
    // A file read again later (put back, or read twice) is never counted twice.
    await t.mutation(internal.ingestion.markItemFailed, { itemId: a._id, error: "Again" });
    expect(await batchOf(t, batchId)).toMatchObject({ read: 2, couldNotRead: 1 });

    // "Try again" reopens the batch for the files that were not sent.
    await admin.mutation(api.ingestion.reopenImportBatch, { batchId });
    expect(await batchOf(t, batchId)).toMatchObject({ sendingDone: false });
    await admin.mutation(api.ingestion.finishImportBatch, { batchId, failed: 0 });
    expect(await batchOf(t, batchId)).toMatchObject({ sendingDone: true, failed: 0 });
    await expectCountsMatchRecount(t, "after a batch is read");
  });

  it("stages the uploader's request through the same fields, in the uploader's batch, and is unchanged otherwise", async () => {
    const { t } = await setup();
    vi.stubEnv("INGEST_API_KEY", "k".repeat(40));
    const body = "Proofing PD text";
    const hash = await sha256Hex(body);
    const send = (path: string) =>
      t.fetch(`/ingestion/upload?path=${encodeURIComponent(path)}&hash=${hash}&mtime=1700000000000`, {
        method: "POST",
        headers: { Authorization: `Bearer ${"k".repeat(40)}` },
        body,
      });
    const path = "Halden Foods/2025 - Jun 30/Submitted/02 HaldenFoods 2025-06-30 S1.SO Fermentation.docx";
    const first = await send(path);
    expect(await first.json()).toEqual({ staged: true, docKind: "pd", group: "halden foods::2025" });
    expect(await (await send(path)).json()).toEqual({ skipped: true, reason: "unchanged" });
    const row = await itemAt(t, path);
    expect(row).toMatchObject({ status: "fetched", category: "final_pd", isNew: true, batchReadPending: true });
    const batch = await batchOf(t, row.batchId!);
    expect(batch).toMatchObject({ source: "uploader", added: 1, alreadyHere: 1 });
    expect(batch.addedBy).toBeUndefined();
    // Still refused without the key.
    expect((await t.fetch(`/ingestion/upload?path=${encodeURIComponent(path)}&hash=${hash}`, { method: "POST", body })).status).toBe(401);
  });

  it("groups the uploader's files into one batch while they keep coming, and starts another after a quiet gap", async () => {
    const { t } = await setup();
    vi.setSystemTime(Date.UTC(2026, 10, 12, 9, 0));
    const send = (path: string, hash: string) =>
      t.mutation(internal.ingestion.upsertDiscoveredItem, { ...discoveredArgs(path, { driveItemId: `local:${path}`, contentHash: hash }), via: "uploader" });
    await send(`${CEDARLINE_FY}/Drafts/one.docx`, "h1");
    vi.advanceTimersByTime(5 * 60_000);
    await send(`${CEDARLINE_FY}/Drafts/two.docx`, "h2");
    // The same file again: already here.
    await send(`${CEDARLINE_FY}/Drafts/one.docx`, "h1");
    vi.advanceTimersByTime(11 * 60_000);
    await send(`${CEDARLINE_FY}/Drafts/three.docx`, "h3");
    const batches = await t.run((ctx) => ctx.db.query("importBatches").withIndex("by_startedAt").collect());
    expect(batches.map((batch) => [batch.source, batch.added, batch.alreadyHere, batch.addedBy])).toEqual([
      ["uploader", 2, 1, undefined],
      ["uploader", 1, 0, undefined],
    ]);
    expect((await itemAt(t, `${CEDARLINE_FY}/Drafts/two.docx`)).batchId).toBe(batches[0]._id);
    expect((await itemAt(t, `${CEDARLINE_FY}/Drafts/three.docx`)).batchId).toBe(batches[1]._id);
    // A file without the uploader's flag (another caller) joins no batch, but is still New.
    await t.mutation(internal.ingestion.upsertDiscoveredItem, discoveredArgs("Halden Foods/2025/Drafts/x.docx"));
    const loose = await t.run((ctx) =>
      ctx.db.query("ingestionItems").withIndex("by_driveItemId", (q) => q.eq("driveItemId", "drive-Halden Foods/2025/Drafts/x.docx")).unique()
    );
    expect(loose).toMatchObject({ isNew: true });
    expect(loose!.batchId).toBeUndefined();
  });

  it("counts a OneDrive sync run's files into the run's batch", async () => {
    const { t, admin } = await setup();
    const { runId, batchId } = await t.run(async (ctx) => {
      const userId = (await ctx.db.query("users").first())!._id;
      const batchId = await ctx.db.insert("importBatches", {
        source: "onedrive",
        addedBy: userId,
        startedAt: 1,
        lastFileAt: 1,
        added: 0,
        alreadyHere: 0,
        failed: 0,
        read: 0,
        couldNotRead: 0,
      });
      const runId = await ctx.db.insert("oneDriveSyncRuns", {
        status: "running",
        triggeredBy: userId,
        startedAt: 1,
        discovered: 0,
        processed: 0,
        skipped: 0,
        batchId,
      });
      return { runId, batchId };
    });
    const items = [discoveredArgs(`${CEDARLINE_FY}/Drafts/a.docx`), discoveredArgs(`${CEDARLINE_FY}/Drafts/b.docx`)];
    await t.mutation(internal.ingestion.upsertDiscoveredBatch, { items, runId });
    await t.mutation(internal.ingestion.upsertDiscoveredBatch, { items: items.slice(0, 1), runId });
    expect(await batchOf(t, batchId)).toMatchObject({ added: 2, alreadyHere: 1 });
    // The History tab shows the run once, as its batch.
    const history = await admin.query(api.ingestion.importHistory, { paginationOpts: { numItems: 25, cursor: null } });
    expect(history.page.map((row) => [row.source, row.who, row.added, row.alreadyHere])).toEqual([["onedrive", "Dana", 2, 1]]);
  });

  it("marks a file New when it arrives or its bytes change, never on a rename, and clears it after 24 hours in batches", async () => {
    const { t, admin } = await setup();
    const start = Date.UTC(2026, 10, 12, 9, 0);
    vi.setSystemTime(start);
    const first = await stage(t, `${CEDARLINE_FY}/Drafts/first.docx`, { driveItemId: "first" });
    await markRead(t, first);
    vi.advanceTimersByTime(23 * 60 * 60_000);
    const later = await stage(t, "Halden Foods/2025 - Jun 30/Drafts/later.docx", { driveItemId: "later" });
    await markRead(t, later);
    // A rename does not make an old file New again.
    await t.mutation(internal.ingestion.upsertDiscoveredItem, discoveredArgs(`${CEDARLINE_FY}/Drafts/renamed.docx`, { driveItemId: "first" }));
    expect((await getItem(t, first)).arrivedAt).toBe(start);

    vi.setSystemTime(start + 24 * 60 * 60_000 + 60_000);
    const result = await t.mutation(internal.ingestion.clearExpiredNew, {});
    expect(result).toEqual({ cleared: 1, more: false });
    expect((await getItem(t, first)).isNew).toBeUndefined();
    expect((await getItem(t, later)).isNew).toBe(true);
    await expectCountsMatchRecount(t, "after clearing New");
    expect(await admin.query(api.ingestion.sheetTotals, { tab: "review" })).toMatchObject({ files: 2, newFiles: 1 });

    // New bytes: New again, from now.
    await stage(t, `${CEDARLINE_FY}/Drafts/renamed.docx`, { driveItemId: "first", contentHash: "hash-2" });
    expect(await getItem(t, first)).toMatchObject({ isNew: true, arrivedAt: start + 24 * 60 * 60_000 + 60_000 });
    await expectCountsMatchRecount(t, "after new bytes");
  });

  it("clears more than a hundred expired New flags a batch at a time, keeping the counts right", async () => {
    const { t } = await setup();
    const start = Date.UTC(2026, 10, 12, 9, 0);
    vi.setSystemTime(start);
    for (let index = 0; index < 101; index++) {
      await stage(t, `${CEDARLINE_FY}/Supporting/file ${index}.pdf`, { driveItemId: `file-${index}` });
    }
    vi.setSystemTime(start + 25 * 60 * 60_000);
    expect(await t.mutation(internal.ingestion.clearExpiredNew, {})).toEqual({ cleared: 100, more: true });
    await expectCountsMatchRecount(t, "after the first hundred");
    const next = (await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).filter(
      (job) => job.name.includes("clearExpiredNew") && job.state.kind === "pending"
    );
    expect(next).toHaveLength(1);
    expect(await t.mutation(internal.ingestion.clearExpiredNew, {})).toEqual({ cleared: 1, more: false });
    await expectCountsMatchRecount(t, "after the rest");
    const bands = await t.run((ctx) => ctx.db.query("importCompanies").collect());
    expect(bands.map((band) => [band.newFiles, band.hasNew])).toEqual([[undefined, false]]);
  });

  it("lists New bands and files with the New filter, and a file being read under Not sorted yet until it is read", async () => {
    const { t, admin } = await setup();
    const start = Date.UTC(2026, 10, 12, 9, 0);
    vi.setSystemTime(start);
    const old = await stage(t, "Northgate Labs/2024 - Sep 30/In Review/old.docx");
    await markRead(t, old);
    vi.setSystemTime(start + 25 * 60 * 60_000);
    await t.mutation(internal.ingestion.clearExpiredNew, {});
    const pd = await stage(t, DROP_PD);
    const draft = await stage(t, `${CEDARLINE_FY}/Drafts/plan.docx`);
    await markRead(t, draft);

    const bands = await admin.query(api.ingestion.sheetCompanies, { tab: "review", onlyToCheck: false, onlyNew: true, paginationOpts: PAGE });
    expect(bands.page.map((band) => [band.companyKey, band.newFiles, band.total])).toEqual([["cedarline systems", 2, 2]]);
    const all = await admin.query(api.ingestion.sheetCompanies, { tab: "review", onlyToCheck: false, paginationOpts: PAGE });
    expect(all.page.map((band) => [band.companyKey, band.newFiles])).toEqual([
      ["cedarline systems", 2],
      ["northgate labs", 0],
    ]);
    // The final PD is still being read: it lists under Not sorted yet, not Final PDs.
    const files = (category: "final_pd" | "unknown" | "draft", onlyNew = false) =>
      admin.query(api.ingestion.sheetFiles, { tab: "review", companyKey: "cedarline systems", category, onlyToCheck: false, onlyNew, paginationOpts: PAGE });
    expect((await files("unknown")).page.map((row) => [row._id, row.category, row.status])).toEqual([[pd, "final_pd", "discovered"]]);
    expect((await files("final_pd")).page).toEqual([]);
    expect(all.page[0].categories.unknown).toMatchObject({ total: 1, newFiles: 1 });
    expect(all.page[0].categories.final_pd).toBeUndefined();
    // Read: in Final PDs, with its checks; Not sorted yet is gone.
    await markRead(t, pd);
    expect((await files("final_pd", true)).page.map((row) => [row._id, row.isNew])).toEqual([[pd, true]]);
    expect((await files("unknown")).page).toEqual([]);
    expect((await files("draft", true)).page.map((row) => row._id)).toEqual([draft]);
    await expectCountsMatchRecount(t, "after reading");
  });

  it("shows the latest batches for the status line, marking the signed-in admin's own", async () => {
    const { t, admin } = await setup();
    await t.run((ctx) => ctx.db.insert("users", { authId: "sheet-admin-2", role: "admin", firstName: "Sam", lastName: "Okafor" }));
    const other = t.withIdentity({ subject: "sheet-admin-2" });
    vi.setSystemTime(Date.UTC(2026, 10, 12, 9, 0));
    const mine = await admin.mutation(api.ingestion.startImportBatch, { toSend: 64, alreadyHere: 12 });
    vi.advanceTimersByTime(1000);
    const theirs = await other.mutation(api.ingestion.startImportBatch, { toSend: 412, alreadyHere: 0 });
    const activity = await admin.query(api.ingestion.importActivity, {});
    expect(activity!.map((batch) => [batch._id, batch.mine, batch.addedByName, batch.toSend, batch.sendingDone])).toEqual([
      [theirs, false, "Sam Okafor", 412, false],
      [mine, true, "Dana", 64, false],
    ]);
  });

  it("lists History newest first, with sync runs from before batches, a page at a time", async () => {
    const { t, admin, writer } = await setup();
    await t.run(async (ctx) => {
      const userId = (await ctx.db.query("users").first())!._id;
      await ctx.db.insert("oneDriveSyncRuns", { status: "completed", triggeredBy: userId, startedAt: 100, discovered: 40, processed: 40, skipped: 3 });
      await ctx.db.insert("importBatches", { source: "uploader", startedAt: 200, lastFileAt: 250, added: 30, alreadyHere: 5, failed: 0, read: 30, couldNotRead: 2 });
      await ctx.db.insert("importBatches", { source: "page", addedBy: userId, startedAt: 300, lastFileAt: 300, toSend: 52, sendingDone: true, added: 50, alreadyHere: 12, failed: 2, read: 50, couldNotRead: 1 });
    });
    const first = await admin.query(api.ingestion.importHistory, { paginationOpts: { numItems: 1, cursor: null } });
    expect(first).toMatchObject({
      page: [{ key: expect.any(String), startedAt: 300, source: "page", who: "Dana", added: 50, alreadyHere: 12, couldNotRead: 1, notSent: 2 }],
      isDone: false,
    });
    // The pages after it: the other batch, then the old sync run once no batches are left.
    const rest = [];
    let cursor = first.continueCursor;
    for (let page = 0; page < 5; page++) {
      const next = await admin.query(api.ingestion.importHistory, { paginationOpts: { numItems: 1, cursor } });
      rest.push(...next.page);
      if (next.isDone) break;
      cursor = next.continueCursor;
    }
    expect(rest).toEqual([
      { key: expect.any(String), startedAt: 200, source: "uploader", who: null, added: 30, alreadyHere: 5, couldNotRead: 2, notSent: 0 },
      { key: expect.any(String), startedAt: 100, source: "onedrive", who: "Dana", added: 40, alreadyHere: null, couldNotRead: null, notSent: 0 },
    ]);
    const everything = await admin.query(api.ingestion.importHistory, { paginationOpts: { numItems: 25, cursor: null } });
    expect(everything.page.map((row) => row.startedAt)).toEqual([300, 200, 100]);
    expect(everything.isDone).toBe(true);
    expect(await writer.query(api.ingestion.importHistory, { paginationOpts: { numItems: 25, cursor: null } })).toEqual({
      page: [],
      isDone: true,
      continueCursor: "",
    });
  });

  it("pages History past 500 batches, then through the old sync runs, each row once", async () => {
    const { t, admin } = await setup();
    await t.run(async (ctx) => {
      const userId = (await ctx.db.query("users").first())!._id;
      // Three old runs, two of them started at the same time, and a run that is a batch's (not its own row).
      for (const startedAt of [10, 20, 20]) {
        await ctx.db.insert("oneDriveSyncRuns", { status: "completed", triggeredBy: userId, startedAt, discovered: startedAt, processed: 0, skipped: 0 });
      }
      for (let n = 0; n < 530; n++) {
        await ctx.db.insert("importBatches", { source: "uploader", startedAt: 1000 + n, lastFileAt: 1000 + n, added: 1, alreadyHere: 0, failed: 0, read: 1, couldNotRead: 0 });
      }
      const linked = await ctx.db.query("importBatches").withIndex("by_startedAt").order("desc").first();
      await ctx.db.insert("oneDriveSyncRuns", { status: "completed", triggeredBy: userId, startedAt: 1529, discovered: 1, processed: 1, skipped: 0, batchId: linked!._id });
    });
    const keys: string[] = [];
    const sources: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    for (;;) {
      const result: { page: Array<{ key: string; source: string }>; isDone: boolean; continueCursor: string } = await admin.query(
        api.ingestion.importHistory,
        { paginationOpts: { numItems: 25, cursor } }
      );
      keys.push(...result.page.map((row) => row.key));
      sources.push(...result.page.map((row) => row.source));
      pages += 1;
      if (result.isDone) break;
      cursor = result.continueCursor;
      expect(pages).toBeLessThan(40);
    }
    expect(keys).toHaveLength(533);
    expect(new Set(keys).size).toBe(533);
    expect(sources.filter((source) => source === "uploader")).toHaveLength(530);
    expect(sources.slice(-3)).toEqual(["onedrive", "onedrive", "onedrive"]);
    // 25 batches a page; the old runs come with the last batches, or on one page after them.
    expect(pages).toBeLessThanOrEqual(23);
    // One run per page once the batches are done.
    const runsOnly = await admin.query(api.ingestion.importHistory, { paginationOpts: { numItems: 1, cursor: "runs:" } });
    expect(runsOnly.page.map((row) => row.added)).toEqual([20]);
    const nextRun = await admin.query(api.ingestion.importHistory, { paginationOpts: { numItems: 1, cursor: runsOnly.continueCursor } });
    expect(nextRun.page.map((row) => row.added)).toEqual([20]);
    expect(nextRun.page[0]!.key).not.toBe(runsOnly.page[0]!.key);
    await expect(admin.query(api.ingestion.importHistory, { paginationOpts: { numItems: 1, cursor: "nonsense" } })).rejects.toThrow(/InvalidCursor/);
  });
});

// ─── A page file whose path a row already has (2026-11-12 review fixes) ─────

/** Starts a batch for `files`, uploads each after it (as the browser does) and stages them in one call. */
async function addOnPage(t: T, admin: ReturnType<T["withIdentity"]>, files: Array<{ path: string; text: string }>) {
  const batchId = await admin.mutation(api.ingestion.startImportBatch, { toSend: files.length, alreadyHere: 0 });
  const sent = [];
  for (const entry of files) sent.push({ path: entry.path, ...(await uploaded(t, entry.text)), lastModifiedAt: 1_700_000_000_000 });
  const outcomes = await admin.mutation(api.ingestion.stageImportFiles, { batchId, files: sent });
  return { batchId, sent, outcomes };
}

/** Every row whose path is `path`, oldest first. */
async function rowsWithPath(t: T, path: string) {
  return (await t.run((ctx) => ctx.db.query("ingestionItems").collect())).filter((row) => row.path === path);
}

async function storedFile(t: T, id: Id<"_storage">) {
  return await t.run((ctx) => ctx.db.system.get("_storage", id));
}

describe("a file sent again with new bytes before it was read (Greptile, 2026-11-19)", () => {
  it("counts the replaced copy as done even in the same batch, so nothing is left unread", async () => {
    const { t } = await setup();
    vi.setSystemTime(Date.UTC(2026, 10, 12, 9, 0));
    const path = `${CEDARLINE_FY}/Drafts/plan.docx`;
    const send = (hash: string) =>
      t.mutation(internal.ingestion.upsertDiscoveredItem, { ...discoveredArgs(path, { driveItemId: `local:${path}`, contentHash: hash }), via: "uploader" });
    await send("h1");
    vi.advanceTimersByTime(2 * 60_000);
    // Changed bytes within the uploader's ten minutes: the same batch.
    await send("h2");
    const row = await itemAt(t, path);
    expect(await batchOf(t, row.batchId!)).toMatchObject({ added: 2, read: 1 });
    await markRead(t, row._id);
    expect(await batchOf(t, row.batchId!)).toMatchObject({ added: 2, read: 2, couldNotRead: 0 });
    expect((await getItem(t, row._id)).batchReadPending).toBeUndefined();
  });
});

describe("a file added on the page with a path a row already has", () => {
  it("skips the same path and bytes as already here, and the row keeps what a person set", async () => {
    const { t, admin } = await setup();
    const path = "Report.docx";
    await addOnPage(t, admin, [{ path, text: "Halden Foods proofing report" }]);
    const [first] = await rowsWithPath(t, path);
    await markRead(t, first._id);
    await admin.mutation(api.ingestion.setSheetLabels, { ids: [first._id], patch: { company: "Halden Foods" } });
    const before = await getItem(t, first._id);

    const again = await addOnPage(t, admin, [{ path, text: "Halden Foods proofing report" }]);
    expect(again.outcomes).toEqual([{ path, outcome: "already_here" }]);
    expect(await storedFile(t, again.sent[0].storageId)).toBeNull();
    expect(await rowsWithPath(t, path)).toHaveLength(1);
    expect(await getItem(t, first._id)).toMatchObject({
      storageId: before.storageId,
      contentHash: before.contentHash,
      status: "pending_review",
      clientName: "Halden Foods",
      editedLabels: before.editedLabels,
    });
    expect(await batchOf(t, again.batchId)).toMatchObject({ added: 0, alreadyHere: 1 });
    await expectCountsMatchRecount(t, "after the same file again");
  });

  it("stages a different file with the same path as its own row, and never touches the first on To review", async () => {
    const { t, admin } = await setup();
    const path = "Report.docx";
    await addOnPage(t, admin, [{ path, text: "Halden Foods proofing report" }]);
    const [first] = await rowsWithPath(t, path);
    await markRead(t, first._id);
    await admin.mutation(api.ingestion.setSheetLabels, { ids: [first._id], patch: { company: "Halden Foods", fiscalYearEnd: Date.UTC(2025, 5, 30) } });
    const before = await getItem(t, first._id);

    // A second "Report.docx", dropped on its own: other bytes, same path.
    const second = await addOnPage(t, admin, [{ path, text: "Northgate Labs sensor report" }]);
    expect(second.outcomes).toEqual([{ path, outcome: "added" }]);
    // The first row is exactly as it was: its bytes, labels and status.
    expect(await getItem(t, first._id)).toEqual(before);
    const rows = await rowsWithPath(t, path);
    expect(rows).toHaveLength(2);
    const added = rows.find((row) => row._id !== first._id)!;
    const hash = second.sent[0].contentHash;
    // Its own key; the path and name the admin sees stay as dropped.
    expect(added).toMatchObject({
      driveItemId: `local:${path}#${hash.slice(0, 12)}`,
      path,
      name: path,
      contentHash: hash,
      storageId: second.sent[0].storageId,
      status: "fetched",
      category: "unknown",
      isNew: true,
      batchId: second.batchId,
      batchReadPending: true,
    });
    // Nothing a person set on the first file comes with it.
    expect(added.clientName).toBeUndefined();
    expect(added.fiscalYearEnd).toBeUndefined();
    expect(added.editedLabels ?? []).toEqual([]);
    expect(added.extractNote).toBeUndefined();
    expect(await batchOf(t, second.batchId)).toMatchObject({ added: 1, alreadyHere: 0 });
    await expectCountsMatchRecount(t, "after a second file with the same path");

    // The second file again: already here, by its own row.
    const repeat = await addOnPage(t, admin, [{ path, text: "Northgate Labs sensor report" }]);
    expect(repeat.outcomes).toEqual([{ path, outcome: "already_here" }]);
    expect(await rowsWithPath(t, path)).toHaveLength(2);

    // The uploader's route is unchanged: there the same path is the same synced file.
    const { uploadUpsertFields } = await import("./lib/ingestionClassify");
    const changed = await sha256Hex("Halden Foods proofing report, edited");
    await t.mutation(internal.ingestion.upsertDiscoveredItem, { ...uploadUpsertFields(path, 64, 1_700_000_000_000, changed), via: "uploader" });
    expect(await rowsWithPath(t, path)).toHaveLength(2);
    expect((await getItem(t, first._id)).contentHash).toBe(changed);
    expect((await getItem(t, added._id)).contentHash).toBe(hash);
    await expectCountsMatchRecount(t, "after the uploader changes the first");
  });

  it("never touches an approved first file: no false note, and the new file is staged", async () => {
    const { t, admin } = await setup();
    await addOnPage(t, admin, [{ path: DROP_PD, text: "Cedarline cold chain PD, approved" }]);
    const [first] = await rowsWithPath(t, DROP_PD);
    await markRead(t, first._id);
    await admin.mutation(api.ingestion.setSheetLabels, { ids: [first._id], patch: { scienceCode: "2.02.09" } });
    await approveForTest(t, admin, first._id);
    const before = await getItem(t, first._id);
    expect(before.status).toBe("approved");

    const second = await addOnPage(t, admin, [{ path: DROP_PD, text: "Cedarline cold chain PD, another file" }]);
    expect(second.outcomes).toEqual([{ path: DROP_PD, outcome: "added" }]);
    const after = await getItem(t, first._id);
    expect(after).toEqual(before);
    expect(after.extractNote).toBeUndefined();
    // The new upload is kept and read, on To review.
    const added = (await rowsWithPath(t, DROP_PD)).find((row) => row._id !== first._id)!;
    expect(added).toMatchObject({ status: "fetched", sheetTab: "review", category: "final_pd", storageId: second.sent[0].storageId });
    expect(await storedFile(t, second.sent[0].storageId)).not.toBeNull();
    const reads = (await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).filter((job) =>
      job.name.includes("extractUploadedItem")
    );
    expect(reads.map((job) => job.args[0])).toContainEqual({ itemId: added._id });
    await expectCountsMatchRecount(t, "after a new file beside an approved one");
  });

  it("never brings a deleted first file back: the new file is staged beside it", async () => {
    const { t, admin } = await setup();
    const path = "Northgate Labs/2024 - Sep 30/Drafts/Report.docx";
    await addOnPage(t, admin, [{ path, text: "Northgate Labs draft, deleted" }]);
    const [first] = await rowsWithPath(t, path);
    await markRead(t, first._id);
    await admin.mutation(api.ingestion.removeItems, { ids: [first._id] });
    const before = await getItem(t, first._id);
    expect(before).toMatchObject({ status: "deleted", sheetTab: "deleted" });

    const second = await addOnPage(t, admin, [{ path, text: "Northgate Labs draft, a new one" }]);
    expect(second.outcomes).toEqual([{ path, outcome: "added" }]);
    expect(await getItem(t, first._id)).toEqual(before);
    const added = (await rowsWithPath(t, path)).find((row) => row._id !== first._id)!;
    expect(added).toMatchObject({ status: "fetched", sheetTab: "review", category: "draft", companyKey: "northgate labs" });
    await expectCountsMatchRecount(t, "after a new file beside a deleted one");
  });

  it("lets two different files with one path in one drop both in, and the same bytes again once", async () => {
    const { t, admin } = await setup();
    const path = `${CEDARLINE_FY}/Drafts/Report.docx`;
    const drop = await addOnPage(t, admin, [
      { path, text: "Cedarline report, from the desktop" },
      { path, text: "Cedarline report, from downloads" },
      { path, text: "Cedarline report, from the desktop" },
    ]);
    expect(drop.outcomes).toEqual([
      { path, outcome: "added" },
      { path, outcome: "added" },
      { path, outcome: "already_here" },
    ]);
    const rows = await rowsWithPath(t, path);
    expect(rows.map((row) => [row.driveItemId, row.contentHash, row.storageId])).toEqual([
      [`local:${path}`, drop.sent[0].contentHash, drop.sent[0].storageId],
      [`local:${path}#${drop.sent[1].contentHash.slice(0, 12)}`, drop.sent[1].contentHash, drop.sent[1].storageId],
    ]);
    expect(await storedFile(t, drop.sent[2].storageId)).toBeNull();
    expect(await batchOf(t, drop.batchId)).toMatchObject({ added: 2, alreadyHere: 1 });
    await expectCountsMatchRecount(t, "after two files with one path in one drop");
  });

  it("resumes an interrupted local upload whose bytes were missing instead of deleting the re-upload as already_here", async () => {
    const { t, admin } = await setup();
    const path = `${CEDARLINE_FY}/resumed-pd.docx`;
    const body = "Cedarline technical project description, resumed after interrupted upload";
    const first = await uploaded(t, body);
    const key = `local:${path}`;

    // Simulate a row from an earlier HTTP ingest that registered the path and hash but never stored bytes.
    const existingId = await t.run((ctx) =>
      ctx.db.insert("ingestionItems", {
        ...discoveredArgs(path),
        driveItemId: key,
        contentHash: first.contentHash,
        status: "discovered",
        updatedAt: 1,
      })
    );
    await t.run((ctx) => ctx.storage.delete(first.storageId));

    const drop = await addOnPage(t, admin, [{ path, text: body }]);
    expect(drop.outcomes).toEqual([{ path, outcome: "added" }]);
    const row = await getItem(t, existingId);
    expect(row.storageId).toBe(drop.sent[0].storageId);
    expect(row.status).toBe("fetched");
    expect(await storedFile(t, drop.sent[0].storageId)).not.toBeNull();
    expect(await batchOf(t, drop.batchId)).toMatchObject({ added: 1, alreadyHere: 0 });
    await expectCountsMatchRecount(t, "after resuming an interrupted upload via stageImportFiles");
  });
});

describe("a stored file that may not be this batch's own", () => {
  it("is refused and never deleted, whatever else is wrong with it", async () => {
    const { t, admin } = await setup();
    const otherId = await t.run((ctx) => ctx.db.insert("users", { authId: "sheet-admin-2", role: "admin", firstName: "Sam", lastName: "Okafor" }));
    // Uploaded before the batch started.
    const early = await uploaded(t, "Halden Foods notes, uploaded earlier");
    vi.advanceTimersByTime(1_000);
    const batchId = await admin.mutation(api.ingestion.startImportBatch, { toSend: 5, alreadyHere: 0 });
    // Held by a row, claimed by another person, and gone.
    const held = await uploaded(t, "Cedarline file a row holds");
    await t.run((ctx) => ctx.db.insert("ingestionItems", { ...discoveredArgs("Cedarline Systems/held.docx"), storageId: held.storageId, status: "pending_review", updatedAt: 1 }));
    const claimed = await uploaded(t, "Sam Okafor's own upload");
    await t.run((ctx) => ctx.db.insert("uploadClaims", { storageId: claimed.storageId, userId: otherId, claimedAt: Date.now() }));
    const gone = await uploaded(t, "already deleted");
    await t.run((ctx) => ctx.storage.delete(gone.storageId));

    const outcomes = await admin.mutation(api.ingestion.stageImportFiles, {
      batchId,
      files: [
        { path: "../..", ...early, lastModifiedAt: 1 },
        { path: `${CEDARLINE_FY}/~$held.docx`, ...held, lastModifiedAt: 1 },
        { path: `${CEDARLINE_FY}/budget.xlsx`, ...claimed, lastModifiedAt: 1 },
        { path: `${CEDARLINE_FY}/gone.docx`, storageId: gone.storageId, contentHash: "not a hash", lastModifiedAt: 1 },
      ],
    });
    expect(outcomes.map((outcome) => [outcome.outcome, outcome.reason])).toEqual([
      ["refused", "not_this_batch"],
      ["refused", "in_use"],
      ["refused", "in_use"],
      ["refused", "missing"],
    ]);
    for (const id of [early.storageId, held.storageId, claimed.storageId]) expect(await storedFile(t, id)).not.toBeNull();

    // An upload older than an hour, with a hash that is no hash: kept too.
    const stale = await uploaded(t, "Northgate Labs upload left behind");
    vi.advanceTimersByTime(61 * 60_000);
    expect(
      await admin.mutation(api.ingestion.stageImportFiles, {
        batchId,
        files: [{ path: `${CEDARLINE_FY}/stale.docx`, storageId: stale.storageId, contentHash: "not a hash", lastModifiedAt: 1 }],
      })
    ).toEqual([{ path: `${CEDARLINE_FY}/stale.docx`, outcome: "refused", reason: "missing" }]);
    expect(await storedFile(t, stale.storageId)).not.toBeNull();
    expect(await batchOf(t, batchId)).toMatchObject({ added: 0, alreadyHere: 0 });
  });
});

describe("a file rejected or deleted while it is still being read", () => {
  it("counts as done for its batch, once, so the status line settles and History still counts it as added", async () => {
    const { t, admin } = await setup();
    const drop = await addOnPage(t, admin, [
      { path: `${CEDARLINE_FY}/Drafts/rejected.docx`, text: "Cedarline draft, rejected before it was read" },
      { path: `${CEDARLINE_FY}/Drafts/read.docx`, text: "Cedarline draft, read" },
    ]);
    await admin.mutation(api.ingestion.finishImportBatch, { batchId: drop.batchId, failed: 0 });
    const rejected = await itemAt(t, `${CEDARLINE_FY}/Drafts/rejected.docx`);
    const read = await itemAt(t, `${CEDARLINE_FY}/Drafts/read.docx`);
    expect(rejected.status).toBe("fetched");

    await admin.mutation(api.ingestion.rejectItem, { itemId: rejected._id });
    expect(await batchOf(t, drop.batchId)).toMatchObject({ added: 2, read: 1, couldNotRead: 0 });
    expect((await getItem(t, rejected._id)).batchReadPending).toBeUndefined();
    // Its reading still runs, and finds the file rejected: nothing is counted again.
    await markRead(t, rejected._id);
    expect(await batchOf(t, drop.batchId)).toMatchObject({ read: 1 });
    await markRead(t, read._id);
    const activity = await admin.query(api.ingestion.importActivity, {});
    expect(activity!.find((batch) => batch._id === drop.batchId)).toMatchObject({ added: 2, read: 2, sendingDone: true });

    // Deleted after it was rejected: still counted once.
    await admin.mutation(api.ingestion.removeItems, { ids: [rejected._id] });
    expect(await batchOf(t, drop.batchId)).toMatchObject({ added: 2, read: 2, couldNotRead: 0 });
    const history = await admin.query(api.ingestion.importHistory, { paginationOpts: { numItems: 25, cursor: null } });
    expect(history.page.find((row) => row.key === drop.batchId)).toMatchObject({ added: 2, alreadyHere: 0, couldNotRead: 0, notSent: 0 });
    await expectCountsMatchRecount(t, "after a file rejected while it was read");
  });

  it("settles a batch still waiting on a file rejected before this fix, when that file is deleted", async () => {
    const { t, admin } = await setup();
    const path = `${CEDARLINE_FY}/Drafts/old reject.docx`;
    const drop = await addOnPage(t, admin, [{ path, text: "Cedarline draft rejected long ago" }]);
    const row = await itemAt(t, path);
    await admin.mutation(api.ingestion.rejectItem, { itemId: row._id });
    // As a row rejected before this fix was left: still waited for.
    await t.run(async (ctx) => {
      await ctx.db.patch(row._id, { batchReadPending: true });
      await ctx.db.patch(drop.batchId, { read: 0 });
    });
    await admin.mutation(api.ingestion.removeItems, { ids: [row._id] });
    expect(await batchOf(t, drop.batchId)).toMatchObject({ added: 1, read: 1, couldNotRead: 0 });
    expect((await getItem(t, row._id)).batchReadPending).toBeUndefined();
    await expectCountsMatchRecount(t, "after deleting an old rejected file");
  });
});

// ─── Final PD progress (2026-11-17, docs/product-domain.md) ─────────────────

/** The breakdown's writer rows as [label, noLogin, approved, staged]. */
async function writerRows(admin: ReturnType<T["withIdentity"]>) {
  const breakdown = await admin.query(api.ingestion.finalPdBreakdown, {});
  return breakdown!.writers.map((row) => [row.label, row.noLogin, row.approved, row.staged]);
}

const writerIdBy = async (t: T, initials: string) => (await allWriters(t)).find((writer) => writer.initials === initials)!._id;

describe("final PD progress counts", () => {
  it("count final PDs on To review and Approved by fiscal year and writer, never a deleted one or another category", async () => {
    const { t, admin, writer } = await setup();
    expect(await admin.query(api.ingestion.finalPdProgress, {})).toEqual({ approved: 0, staged: 0 });
    expect(await admin.query(api.ingestion.finalPdBreakdown, {})).toEqual({
      years: [],
      writers: [],
      noWriter: null,
      unsorted: null,
      complete: true,
    });
    await pdBy(t, "DW", 1);
    await pdBy(t, "DW", 2, "Cedarline Systems/2024 - Mar 31");
    const pn = await pdBy(t, "PN", 3);
    // A draft and a transcript are not final PDs.
    await stage(t, `${CEDARLINE_FY}/Drafts/03 CedarlineSystems 2025-03-31 R2.DW.PN SensorDraft.docx`);
    await stage(t, `${CEDARLINE_FY}/WIP/Technical/Audio/interview.txt`);
    // A final PD with no fiscal year.
    await stage(t, "Cedarline Systems/To be submitted/07 CedarlineSystems T1.PN Undated.docx");
    await expectCountsMatchRecount(t, "staged");

    expect(await admin.query(api.ingestion.finalPdProgress, {})).toEqual({ approved: 0, staged: 4 });
    const breakdown = (await admin.query(api.ingestion.finalPdBreakdown, {}))!;
    // Newest year first, no fiscal year last.
    expect(breakdown.years).toEqual([
      { key: "2025", approved: 0, staged: 2 },
      { key: "2024", approved: 0, staged: 1 },
      { key: "none", approved: 0, staged: 1 },
    ]);
    // Most staged first, then by name; past writers say they have no login.
    expect(await writerRows(admin)).toEqual([
      ["DW", true, 0, 2],
      ["PN", true, 0, 2],
    ]);

    // A deleted final PD is no longer counted; put back, it is again.
    await admin.mutation(api.ingestion.removeItem, { itemId: pn });
    await expectCountsMatchRecount(t, "deleted");
    expect(await admin.query(api.ingestion.finalPdProgress, {})).toEqual({ approved: 0, staged: 3 });
    await admin.mutation(api.ingestion.restoreItem, { itemId: pn });
    await expectCountsMatchRecount(t, "put back");
    expect(await admin.query(api.ingestion.finalPdProgress, {})).toEqual({ approved: 0, staged: 4 });

    // Admin only.
    expect(await writer.query(api.ingestion.finalPdProgress, {})).toBeNull();
    expect(await writer.query(api.ingestion.finalPdBreakdown, {})).toBeNull();
    expect(await t.query(api.ingestion.finalPdProgress, {})).toBeNull();
  });

  it("move a final PD from staged to approved when it is approved, in its year and its writer's row", async () => {
    const { t, admin } = await setup();
    const first = await pdBy(t, "DW", 1);
    await pdBy(t, "DW", 2, "Cedarline Systems/2024 - Mar 31");
    await approveForTest(t, admin, first);
    await expectCountsMatchRecount(t, "approved");
    expect(await admin.query(api.ingestion.finalPdProgress, {})).toEqual({ approved: 1, staged: 2 });
    const breakdown = (await admin.query(api.ingestion.finalPdBreakdown, {}))!;
    expect(breakdown.years).toEqual([
      { key: "2025", approved: 1, staged: 1 },
      { key: "2024", approved: 0, staged: 1 },
    ]);
    expect(await writerRows(admin)).toEqual([["DW", true, 1, 2]]);
  });

  it("show a writer's current label: a rename relabels, Link puts a past writer under the member, Unlink takes it back, a pick and its Undo move files", async () => {
    const { t, admin } = await setup();
    const dana = await addMember(t, "Dana", "Whitlock");
    await pdBy(t, "DW", 1);
    await pdBy(t, "DW", 2);
    await pdBy(t, "PN", 3);
    // One final PD whose writer a person set to Dana herself: her own writer.
    const own = await pdBy(t, "KT", 4);
    await admin.mutation(api.ingestion.setSheetLabels, { ids: [own], patch: { writer: { kind: "user", userId: dana } } });
    await expectCountsMatchRecount(t, "staged");
    expect(await writerRows(admin)).toEqual([
      ["DW", true, 0, 2],
      ["Dana Whitlock", false, 0, 1],
      ["PN", true, 0, 1],
    ]);

    const pnWriter = await writerIdBy(t, "PN");
    await admin.mutation(api.users.renamePastWriter, { writerId: pnWriter, name: "Priya Nair" });
    await runWriterWalk(t);
    await expectCountsMatchRecount(t, "renamed");
    expect(await writerRows(admin)).toEqual([
      ["DW", true, 0, 2],
      ["Dana Whitlock", false, 0, 1],
      ["Priya Nair", true, 0, 1],
    ]);

    // Link: DW's PDs show under Dana, in one row with her own.
    const dwWriter = await writerIdBy(t, "DW");
    await admin.mutation(api.users.linkPastWriter, { writerId: dwWriter, userId: dana });
    await runWriterWalk(t);
    await expectCountsMatchRecount(t, "linked");
    expect(await writerRows(admin)).toEqual([
      ["Dana Whitlock", false, 0, 3],
      ["Priya Nair", true, 0, 1],
    ]);

    // Unlink: back to two rows, no file moved.
    await admin.mutation(api.users.unlinkPastWriter, { writerId: dwWriter });
    await runWriterWalk(t);
    await expectCountsMatchRecount(t, "unlinked");
    expect(await writerRows(admin)).toEqual([
      ["DW", true, 0, 2],
      ["Dana Whitlock", false, 0, 1],
      ["Priya Nair", true, 0, 1],
    ]);

    // A pick for PN moves PN's PD to Dana's own writer; its Undo moves it back.
    const picked = await admin.mutation(api.ingestion.matchWriterInitials, { initials: "PN", writer: { kind: "user", userId: dana } });
    await runWriterWalk(t);
    await expectCountsMatchRecount(t, "picked");
    // Two each: by name.
    expect(await writerRows(admin)).toEqual([
      ["Dana Whitlock", false, 0, 2],
      ["DW", true, 0, 2],
    ]);
    await admin.mutation(api.ingestion.matchWriterInitials, { initials: "PN", writer: picked.previous });
    await runWriterWalk(t);
    await expectCountsMatchRecount(t, "undone");
    expect(await writerRows(admin)).toEqual([
      ["DW", true, 0, 2],
      ["Dana Whitlock", false, 0, 1],
      ["Priya Nair", true, 0, 1],
    ]);
  });

  it("unpacks three initials groups positionally and keeps legacy unsorted or writerless final PDs apart from the writers", async () => {
    const { t, admin } = await setup();
    await twoMembersWith(t, "SO");
    // Two members have SO: no writer until a person chooses.
    const so = await pdBy(t, "SO", 1);
    expect((await getItem(t, so)).writerId).toBeUndefined();
    // Three initials groups now unpack positionally (DW = writer, PN = reviewer, KT = client).
    const unpacked = await stage(t, `${CEDARLINE_FY}/To be submitted/05 CedarlineSystems 2025-03-31 T0.DW.PN.KT Brining.docx`);
    await markRead(t, unpacked);
    expect(await getItem(t, unpacked)).toMatchObject({
      writerInitials: "DW",
      reviewerInitials: "PN",
      clientInitials: "KT",
    });
    // Legacy pre-2026-11-23 row with 3+ initials groups and no writerInitials still lands in unsorted.
    const legacy = await stage(t, `${CEDARLINE_FY}/To be submitted/06 CedarlineSystems 2025-03-31 Legacy.docx`);
    await markRead(t, legacy);
    await t.run(async (ctx) => {
      await ctx.db.patch(legacy, {
        initialsGroups: ["DW", "PN", "KT"],
      });
    });
    await driveFinalPdRebuild(t, { pageSize: 10 });
    await pdBy(t, "DW", 2);
    await expectCountsMatchRecount(t, "staged");
    const breakdown = (await admin.query(api.ingestion.finalPdBreakdown, {}))!;
    expect(breakdown.noWriter).toEqual({ key: "none", approved: 0, staged: 1 });
    expect(breakdown.unsorted).toEqual({ key: "unsorted", approved: 0, staged: 1 });
    expect(breakdown.writers.map((row) => [row.label, row.staged])).toEqual([["DW", 2]]);
    // A person chooses a writer for the legacy unsorted one: it leaves its bucket.
    await admin.mutation(api.ingestion.setSheetLabels, { ids: [legacy], patch: { writer: { kind: "name", name: "Kim Tran" } } });
    await expectCountsMatchRecount(t, "chosen");
    const after = (await admin.query(api.ingestion.finalPdBreakdown, {}))!;
    expect(after.unsorted).toBeNull();
    expect(after.writers.map((row) => [row.label, row.staged])).toEqual([
      ["DW", 2],
      ["Kim Tran", 1],
    ]);
  });
});

describe("final PD progress breakdown limits", () => {
  it("says No login for a writer whose member has left the team, as the picker does", async () => {
    const { t, admin } = await setup();
    const dana = await addMember(t, "Dana", "Whitlock", { initials: "DW" });
    await pdBy(t, "DW", 1);
    expect(await writerRows(admin)).toEqual([["Dana Whitlock", false, 0, 1]]);
    // Dana leaves: her account has no role any more.
    await t.run((ctx) => ctx.db.patch(dana, { role: undefined }));
    expect(await writerRows(admin)).toEqual([["Dana Whitlock", true, 0, 1]]);
  });

  it("reads at most 500 writer rows and says when some are not shown", async () => {
    const { t, admin } = await setup();
    await t.run(async (ctx) => {
      for (let n = 0; n < 501; n++) {
        await ctx.db.insert("importFinalPdCounts", { kind: "writer", key: `k${String(n).padStart(3, "0")}`, review: 1, approved: 0, updatedAt: 1 });
      }
    });
    const breakdown = (await admin.query(api.ingestion.finalPdBreakdown, {}))!;
    expect(breakdown.writers).toHaveLength(500);
    expect(breakdown.complete).toBe(false);
  });
});

describe("rebuildImportFinalPdCounts", () => {
  async function seedFinalPds(t: T) {
    for (let n = 1; n <= 4; n++) await pdBy(t, n % 2 === 0 ? "DW" : "PN", n, n <= 2 ? CEDARLINE_FY : "Cedarline Systems/2024 - Mar 31");
    await stage(t, `${CEDARLINE_FY}/Drafts/notes.docx`);
    await stage(t, "Cedarline Systems/To be submitted/07 CedarlineSystems T1.PN Undated.docx");
  }

  it("rebuilds every count from the files in pages, and a second run changes nothing", async () => {
    const { t, admin } = await setup();
    await seedFinalPds(t);
    await approveForTest(t, admin, (await t.run((ctx) => ctx.db.query("ingestionItems").first()))!._id);
    const items = await t.run((ctx) => ctx.db.query("ingestionItems").collect());
    const before = await storedFinalPdCounts(t);
    expect(before).toEqual(finalPdRecountByHand(items));

    // Lost counts, a wrong one and a stray row: the rebuild puts all of it right.
    await t.run(async (ctx) => {
      const rows = await ctx.db.query("importFinalPdCounts").collect();
      for (const row of rows.filter((row) => row.kind === "year")) await ctx.db.delete(row._id);
      const writer = rows.find((row) => row.kind === "writer")!;
      await ctx.db.patch(writer._id, { review: 40 });
      await ctx.db.insert("importFinalPdCounts", { kind: "writer", key: "none", review: 3, approved: 0, revision: 1, updatedAt: 1 });
    });
    expect(await storedFinalPdCounts(t)).not.toEqual(before);
    const first = await driveFinalPdRebuild(t, { pageSize: 2 });
    // Six files (an approval adds none), two a page: three runs.
    expect(first).toEqual({ runs: 3, written: true });
    expect(await storedFinalPdCounts(t)).toEqual(before);
    const revision = (await t.run((ctx) => ctx.db.query("importFinalPdCounts").collect())).find((row) => row.kind === "total")!.revision!;

    const second = await driveFinalPdRebuild(t, { pageSize: 200 });
    expect(second).toEqual({ runs: 1, written: true });
    expect(await storedFinalPdCounts(t)).toEqual(before);
    // Its write raises the revision, so a rebuild running at the same time starts again.
    const after = (await t.run((ctx) => ctx.db.query("importFinalPdCounts").collect())).find((row) => row.kind === "total")!;
    expect(after.revision).toBe(revision + 1);
    expect(await admin.query(api.ingestion.finalPdProgress, {})).toEqual({ approved: 1, staged: 5 });
  });

  it("makes the counts from nothing, as after the deploy", async () => {
    const { t } = await setup();
    await seedFinalPds(t);
    const before = await storedFinalPdCounts(t);
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query("importFinalPdCounts").collect()) await ctx.db.delete(row._id);
    });
    expect(await storedFinalPdCounts(t)).toEqual({});
    expect(await driveFinalPdRebuild(t, { pageSize: 3 })).toEqual({ runs: 2, written: true });
    expect(await storedFinalPdCounts(t)).toEqual(before);
  });

  it("repairs two total rows rather than failing on them", async () => {
    const { t, admin } = await setup();
    await seedFinalPds(t);
    const before = await storedFinalPdCounts(t);
    // A bad write left a second total row with wrong counts.
    await t.run(async (ctx) => {
      await ctx.db.insert("importFinalPdCounts", { kind: "total", key: "all", review: 99, approved: 7, revision: 1, updatedAt: 1 });
    });
    const totalRows = async () =>
      (await t.run((ctx) => ctx.db.query("importFinalPdCounts").collect())).filter((row) => row.kind === "total");
    expect(await totalRows()).toHaveLength(2);
    expect(await driveFinalPdRebuild(t, { pageSize: 2 })).toEqual({ runs: 3, written: true });
    expect(await totalRows()).toHaveLength(1);
    expect(await storedFinalPdCounts(t)).toEqual(before);
    expect(await admin.query(api.ingestion.finalPdProgress, {})).toEqual({ approved: 0, staged: 5 });
  });

  it("starts again when a final PD changes while it pages, waits five minutes after three tries, and gives up after an hour", async () => {
    const { t, admin } = await setup();
    await seedFinalPds(t);
    const pd = (await t.run((ctx) => ctx.db.query("ingestionItems").first()))!._id;
    // Lose a count so a write that did happen would show.
    await t.run(async (ctx) => {
      const year = (await ctx.db.query("importFinalPdCounts").collect()).find((row) => row.key === "2024")!;
      await ctx.db.patch(year._id, { review: 0, approved: 0 });
    });
    // A file is deleted during the first pass only: the pass starts again and then writes.
    const once = await driveFinalPdRebuild(t, { pageSize: 2 }, async (run) => {
      if (run === 1) await admin.mutation(api.ingestion.removeItem, { itemId: pd });
    });
    expect(once.written).toBe(true);
    // Three runs for the first pass, which then schedules a fresh one of three.
    expect(once.runs).toBe(6);
    await expectCountsMatchRecount(t, "rebuilt after a change");

    // A file that changes through a whole round (the first pass and three
    // fresh ones, three runs each): the rebuild waits five minutes and tries
    // again, and once nothing changes it writes.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    let deleted = true;
    const toggle = async () => {
      await admin.mutation(deleted ? api.ingestion.restoreItem : api.ingestion.removeItem, { itemId: pd });
      deleted = !deleted;
    };
    let waitedMs = 0;
    const later = await driveFinalPdRebuild(t, { pageSize: 2 }, async (run) => {
      if (run < 12) return await toggle();
      if (run === 12) {
        const jobs = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
        // The run the last one scheduled (the driver calls each itself, so earlier ones stay pending).
        const next = jobs.filter((job) => job.name.includes("rebuildImportFinalPdCounts")).at(-1)!;
        expect(next.args[0]).toEqual({ waits: 1, pageSize: 2 });
        waitedMs = next.scheduledTime - next._creationTime;
      }
    });
    expect(later).toEqual({ runs: 15, written: true });
    expect(waitedMs).toBeGreaterThanOrEqual(5 * 60 * 1000 - 1);
    expect(warn).toHaveBeenCalledTimes(1);
    await expectCountsMatchRecount(t, "written after one wait");

    // One that never stops changing: twelve waits (an hour), then an error and nothing written.
    const never = await driveFinalPdRebuild(t, { pageSize: 2 }, toggle);
    expect(never).toEqual({ runs: 13 * 12, written: false });
    expect(warn).toHaveBeenCalledTimes(1 + 12);
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toContain("nothing was written");
    warn.mockRestore();
    error.mockRestore();
    // The live counts were kept right all along.
    await expectCountsMatchRecount(t, "after it gave up");
  });
});
