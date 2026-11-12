/// <reference types="vite/client" />
// The Import sheet's data (2026-11-11, phase 2): the move fix, the company
// counts, the sheet queries, label edits and the science code from text.
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { dashboardCompanyKey } from "../shared/dashboardProjection";
import { classify } from "./lib/ingestionClassify";
import { docKindForCategory, settleItem } from "./lib/ingestionSheet";
import { adjustImportCompanyCounts } from "./lib/importCompanyCounts";
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

/**
 * Run only the scheduled rest of writer matches (applyWriterInitials) to the
 * end, leaving other scheduled work waiting, as runPairing does for pairing.
 */
async function runWriterWalk(t: T) {
  const done = writerJobsRun.get(t) ?? new Set<string>();
  writerJobsRun.set(t, done);
  for (;;) {
    const jobs = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    const next = jobs.find((job) => job.name.includes("applyWriterInitials") && job.state.kind === "pending" && !done.has(job._id));
    if (!next) return;
    done.add(next._id);
    await t.mutation(internal.ingestion.applyWriterInitials, next.args[0] as { initials: string; tab: "review" | "deleted"; cursor: string | null });
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

const embedPoolRegistered = new WeakSet<T>();

/** Approves a file into the Brain the way the old page does (its embedding is scheduled, never run). */
async function approveForTest(t: T, admin: ReturnType<T["withIdentity"]>, id: Id<"ingestionItems">) {
  vi.stubEnv("VOYAGE_API_KEY", "test-voyage-key");
  if (!embedPoolRegistered.has(t)) {
    t.registerComponent("embedPool", workpoolSchema, workpoolModules);
    embedPoolRegistered.add(t);
  }
  await admin.mutation(internal.ingestion.finalizeApproval, {
    itemId: id,
    content: "Approved text",
    industry: "Cold chain logistics",
    writerTier: 0.5,
  });
}

/** Takes a row out of Import altogether, with its band share, so a later call finds it missing. */
async function removeRow(t: T, id: Id<"ingestionItems">) {
  await t.run(async (ctx) => {
    const row = await ctx.db.get(id);
    await ctx.db.delete(id);
    await adjustImportCompanyCounts(ctx, row, null);
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
  for (const key of ["sheetTab", "needsCheck", "checkReasons", "sortKey", "scienceCodeSource", "writerNameSource"] as const) {
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
      await admin.mutation(api.ingestion.setSheetLabels, { ids: [pd], patch: { writerName: "Dana Whitlock" } });
      await admin.mutation(internal.ingestion.finalizeApproval, {
        itemId: pd,
        content: "The approved PD text",
        industry: "Cold chain logistics",
        writerTier: 0.5,
      });
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
};
type BandCounts = {
  total: number;
  needsCheck: number;
  ready: number;
  beingRead: number;
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
  if (row.status === "pending_review" && !(row.text ?? "").trim() && row.textStorageId === undefined) {
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
 * A band, category, year or reason with no file is left out, and so is a
 * category's checkReasons when none of its files needs a check.
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
    const categoryName = row.category!;
    band.categories[categoryName] ??= { total: 0, needsCheck: 0, fiscalYears: {} };
    const category = band.categories[categoryName];
    category.total += 1;
    if (check) category.needsCheck += 1;
    const year = row.fiscalYearEnd === undefined ? "none" : String(new Date(row.fiscalYearEnd).getUTCFullYear());
    category.fiscalYears[year] = (category.fiscalYears[year] ?? 0) + 1;
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
      categories: band.categories,
    };
    expect(band.hasCheck, key).toBe(band.needsCheck > 0);
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
  `${CEDARLINE_FY}/Drafts/03 CedarlineSystems 2025-03-31 R2.PN SensorDraft.docx`,
  "Cedarline Systems/2024 - Dec 31/In Review/notes.docx",
  // Same company key as Cedarline Systems, written another way.
  "cedarline  systems/2024/Financials/budget.pdf",
  "Cedarline Systems/glossary.docx",
  "Halden Foods/2025 - Jun 30/Submitted/02 HaldenFoods 2025-06-30 S1.SO Fermentation.docx",
  "Halden Foods/FY2023/Audio/call.vtt",
  "Northgate Labs/Contracts/nda.pdf",
  "Northgate Labs/2024 - Sep 30/To be submitted/pd.docx",
  "Brightwell Dairy/2025/Drafts/plan.docx",
  "loose.docx",
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
      const rows = async () => await t.run((ctx) => ctx.db.query("ingestionItems").collect());
      const withStatus = async (...statuses: Array<Doc<"ingestionItems">["status"]>) =>
        (await rows()).filter((row) => statuses.includes(row.status));

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
          await t.mutation(internal.ingestion.markItemProcessed, {
            itemId: pick(candidates)._id,
            storageId,
            // A scan is read with a note and no text.
            ...(scan
              ? { extractNote: "The PDF has no text layer; a scan needs OCR." }
              : { text: "Field of science or technology: 2.02.09" }),
            ...(!scan && rand() < 0.5 ? { documentScienceCode: "2.02.09" } : {}),
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
          await admin.mutation(internal.ingestion.finalizeApproval, {
            itemId: pick(candidates)._id,
            content: `Approved text ${hashes++}`,
            industry: "Food processing",
            writerTier: 0.5,
          });
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
          // A person says who some initials are, or an Undo says no one has (2026-11-12).
          const initials = pick(["DW", "PN", "SO"]);
          const writerName = pick(["Dana Whitlock", "Priya Nair", "Sam Okafor", null]);
          await admin.mutation(api.ingestion.matchWriterInitials, { initials, writerName });
          // The rest of the walk, as the scheduler runs it.
          await runWriterWalk(t);
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
      let twoReasonsSeen = false;
      for (let step = 0; step < 220; step++) {
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
      }
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

      // A rebuild of every band, in pages of three files, changes nothing.
      const { stored } = await countsNowAndRecount(t);
      let pagedBands = 0;
      for (const key of Object.keys(stored)) {
        const [sheetTab, companyKey] = key.split("|") as ["review" | "approved" | "deleted", string];
        const pages = await driveRebuild(t, { sheetTab, companyKey, pageSize: 3 });
        expect(pages, key).toBeGreaterThanOrEqual(Math.ceil(stored[key].total / 3));
        if (pages > 2) pagedBands += 1;
      }
      expect(pagedBands, "some bands needed several pages").toBeGreaterThan(0);
      expect((await countsNowAndRecount(t)).stored).toEqual(stored);
    } finally {
      vi.unstubAllEnvs();
      vi.useRealTimers();
    }
  });

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
    expect(stored["review|halden foods"].categories).toEqual({
      draft: { total: 1, needsCheck: 0, fiscalYears: { "2025": 1 } },
    });
    await markRead(t, id);
    ({ stored } = await countsNowAndRecount(t));
    expect(stored["review|halden foods"]).toMatchObject({ total: 1, beingRead: 0, ready: 1, needsCheck: 0 });
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
      // The four final PDs (no science code) and the loose file.
      needsCheck: 5,
      ready: 3,
      beingRead: 1,
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
      writerInitials: "DW",
      reviewerInitials: "PN",
      editedLabels: [],
      needsCheck: true,
      // Initials alone are not a writer until a person says who DW is (2026-11-12).
      checkReasons: ["no_science_code", "unmatched_initials"],
      size: 2048,
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
      [ids.pd4r, ["no_science_code", "unmatched_initials"]],
      [ids.pd4, ["no_science_code", "unmatched_initials"]],
      [ids.pd12, ["no_science_code", "unmatched_initials"]],
      [ids.pdBare, ["no_science_code", "no_writer"]],
    ]);

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
    const ids = await seedSheet(t);
    const result = await admin.query(api.ingestion.sheetCompanies, { tab: "review", onlyToCheck: false, paginationOpts: PAGE });
    const byKey = Object.fromEntries(result.page.map((band) => [band.companyKey, band]));
    // Four final PDs with no science code; the one with nothing in its name
    // has no writer either, and the three whose name gave "DW" need a person
    // to say who DW is: four need a check, each counted under its reasons.
    expect(byKey["cedarline systems"].categories.final_pd).toEqual({
      total: 4,
      needsCheck: 4,
      fiscalYears: { "2025": 4 },
      checkReasons: { no_science_code: 4, no_writer: 1, unmatched_initials: 3 },
    });
    expect(byKey[""].categories.unknown).toEqual({
      total: 1,
      needsCheck: 1,
      fiscalYears: { none: 1 },
      checkReasons: { no_company: 1, unknown_category: 1 },
    });
    // A section with nothing to check has no reasons at all.
    expect(byKey["halden foods"].categories.draft).toEqual({ total: 1, needsCheck: 0, fiscalYears: { "2025": 1 } });

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
    expect(cedarline.categories.final_pd).toEqual({ total: 4, needsCheck: 4, fiscalYears: { "2025": 4 } });

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
        // A writer set on the file is a person's, and the initials no longer need one.
        { writerName: "Priya Nair", writerNameSource: "person", checkReasons: ["no_science_code"], editedLabels: ["writerName"] },
      ],
      [
        { scienceCode: "2.02.09" },
        // The code's check goes; "DW" from the file name still needs a person to say who it is.
        {
          scienceCode: "2.02.09",
          scienceCodeSource: "person",
          needsCheck: true,
          checkReasons: ["unmatched_initials"],
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
    expect(stored["review|halden foods"]).toMatchObject({
      total: 3,
      categories: { draft: { total: 3, needsCheck: 0, fiscalYears: { "2025": 3 } } },
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
      // Only the writer's initials are left for a person.
      checkReasons: ["unmatched_initials"],
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
      "This file is already approved into the Brain. Remove it from the Brain page instead."
    );
    await expect(admin.mutation(api.ingestion.rejectItem, { itemId: approved })).rejects.toThrow(
      "This file is already approved into the Brain. Remove it from the Brain page instead."
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
    // "DW" from the file name still needs a person to say who it is.
    expect(row).toMatchObject({ scienceCode: "2.02.09", scienceCodeSource: "document", checkReasons: ["unmatched_initials"] });
    expectInvariants(row);
  });

  it("stores nothing for other categories or a code that is not real", async () => {
    const t = convexTest(schema, modules);
    const draft = await stage(t, `${CEDARLINE_FY}/Drafts/${PD_NAME}`);
    await processWith(t, draft, "2.02.09");
    expect((await getItem(t, draft)).scienceCode).toBeUndefined();
    const pd = await stage(t, `${CEDARLINE_FY}/To be submitted/${PD_NAME}`);
    await processWith(t, pd, "2.02.99");
    expect(await getItem(t, pd)).toMatchObject({ needsCheck: true, checkReasons: ["no_science_code", "unmatched_initials"] });
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
    expect(row.text!.length).toBeLessThan(text.length);
    expect(row.text).not.toContain("2.02.09");
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

    await t.mutation(internal.ingestion.backfillIngestionLabels, {});
    for (const id of [old, settled]) {
      const row = await getItem(t, id);
      expect(row, row.driveItemId).toMatchObject({
        scienceCode: "2.02.09",
        scienceCodeSource: "document",
        checkReasons: ["unmatched_initials"],
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

// ─── Writers by initials (2026-11-12) ───────────────────────────────────────

describe("matchWriterInitials", () => {
  /** A read final PD whose name gives these initials, with its science code read, so only the writer is left. */
  async function pdBy(t: T, initials: string, n: number, folder = CEDARLINE_FY) {
    const name = `${String(n).padStart(2, "0")} CedarlineSystems 2025-03-31 T1.${initials} Project${n}.docx`;
    const id = await stage(t, `${folder}/To be submitted/${name}`, { driveItemId: `${initials}-${n}-${folder}` });
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["bytes"])));
    await t.mutation(internal.ingestion.markItemProcessed, { itemId: id, storageId, text: "Text", documentScienceCode: "2.02.09" });
    return id;
  }

  it("says who the initials are on every file with them, which then needs no writer, and Undo takes it back", async () => {
    const { t, admin } = await setup();
    const kt1 = await pdBy(t, "KT", 1);
    const kt2 = await pdBy(t, "KT", 2);
    const dw = await pdBy(t, "DW", 3);
    // Before: initials alone need a person.
    expect(await getItem(t, kt1)).toMatchObject({ needsCheck: true, checkReasons: ["unmatched_initials"] });

    const result = await admin.mutation(api.ingestion.matchWriterInitials, { initials: "kt", writerName: " Kim  Tran " });
    expect(result).toEqual({ initials: "KT", writerName: "Kim Tran", previous: null, changed: 2, more: false });
    for (const id of [kt1, kt2]) {
      const row = await getItem(t, id);
      // The file name and a person: no AI mark, and not a writer set on the file.
      expect(row).toMatchObject({ writerName: "Kim Tran", writerNameSource: "initials", needsCheck: false, checkReasons: [] });
      expect(row.editedLabels ?? []).not.toContain("writerName");
      expectInvariants(row);
    }
    // Other initials are left alone.
    expect(await getItem(t, dw)).toMatchObject({ checkReasons: ["unmatched_initials"] });
    expect((await getItem(t, dw)).writerName).toBeUndefined();
    await expectCountsMatchRecount(t, "after the match");
    const bands = await admin.query(api.ingestion.sheetCompanies, { tab: "review", onlyToCheck: false, paginationOpts: PAGE });
    expect(bands.page[0].categories.final_pd.checkReasons).toEqual({ unmatched_initials: 1 });

    // Undo: no one has said who KT is any more.
    await expect(admin.mutation(api.ingestion.matchWriterInitials, { initials: "KT", writerName: result.previous })).resolves.toEqual({
      initials: "KT",
      writerName: null,
      previous: "Kim Tran",
      changed: 2,
      more: false,
    });
    for (const id of [kt1, kt2]) {
      const row = await getItem(t, id);
      expect(row.writerName).toBeUndefined();
      expect(row.writerNameSource).toBeUndefined();
      expect(row.checkReasons).toEqual(["unmatched_initials"]);
    }
    expect(await t.run((ctx) => ctx.db.query("importWriterInitials").collect())).toEqual([]);
    await expectCountsMatchRecount(t, "after the Undo");
  });

  it("keeps a writer a person set on one file, before and after, and that file's choice wins", async () => {
    const { t, admin } = await setup();
    const own = await pdBy(t, "KT", 1);
    const other = await pdBy(t, "KT", 2);
    await admin.mutation(api.ingestion.setSheetLabels, { ids: [own], patch: { writerName: "Jordan Ellis" } });
    await admin.mutation(api.ingestion.matchWriterInitials, { initials: "KT", writerName: "Kim Tran" });
    expect(await getItem(t, own)).toMatchObject({ writerName: "Jordan Ellis", writerNameSource: "person" });
    expect(await getItem(t, other)).toMatchObject({ writerName: "Kim Tran", writerNameSource: "initials" });
    // A file that took the name can still be set to another writer: that wins for it.
    await admin.mutation(api.ingestion.setSheetLabels, { ids: [other], patch: { writerName: "Sam Okafor" } });
    await admin.mutation(api.ingestion.matchWriterInitials, { initials: "KT", writerName: "Kim Tranh" });
    expect(await getItem(t, other)).toMatchObject({ writerName: "Sam Okafor", writerNameSource: "person" });
    expect(await getItem(t, own)).toMatchObject({ writerName: "Jordan Ellis" });
    await expectCountsMatchRecount(t, "after a file's own writer");
  });

  it("gives the name to files that come later or are put back, and never to an approved file", async () => {
    const { t, admin } = await setup();
    const deleted = await pdBy(t, "KT", 1);
    await admin.mutation(api.ingestion.removeItems, { ids: [deleted] });
    const approved = await pdBy(t, "KT", 2);
    await approveForTest(t, admin, approved);
    await admin.mutation(api.ingestion.matchWriterInitials, { initials: "KT", writerName: "Kim Tran" });
    await runWriterWalk(t);
    // The Deleted tab is walked after To review, so a file put back shows the name too.
    expect(await getItem(t, deleted)).toMatchObject({ status: "deleted", writerName: "Kim Tran", writerNameSource: "initials" });
    // An approved file keeps what it was approved as.
    expect((await getItem(t, approved)).writerName).toBeUndefined();
    // A file staged after the match takes the name as it is staged.
    const later = await pdBy(t, "KT", 3);
    expect(await getItem(t, later)).toMatchObject({ writerName: "Kim Tran", writerNameSource: "initials", checkReasons: [] });
    await admin.mutation(api.ingestion.restoreItems, { ids: [deleted] });
    expect(await getItem(t, deleted)).toMatchObject({ status: "pending_review", writerName: "Kim Tran", checkReasons: [] });
    // A rename to other initials drops the name it took.
    await t.mutation(
      internal.ingestion.upsertDiscoveredItem,
      discoveredArgs(`${CEDARLINE_FY}/To be submitted/03 CedarlineSystems 2025-03-31 T1.MN Project3.docx`, {
        driveItemId: `KT-3-${CEDARLINE_FY}`,
      })
    );
    const renamed = await getItem(t, later);
    expect(renamed.writerInitials).toBe("MN");
    expect(renamed.writerName).toBeUndefined();
    expect(renamed.checkReasons).toEqual(["unmatched_initials"]);
    await expectCountsMatchRecount(t, "after later files");
  });

  it("changes 100 files in the call and the rest in scheduled runs, keeping the counts right", async () => {
    const { t, admin } = await setup();
    // 120 files on To review: rows written straight in (staging each would be slow), then counted.
    await t.run(async (ctx) => {
      for (let n = 1; n <= 120; n++) {
        const name = `${String(n % 20 || 20).padStart(2, "0")} CedarlineSystems 2025-03-31 T1.KT Project${n}.docx`;
        const fields = settleItem({
          ...discoveredArgs(`${CEDARLINE_FY}/To be submitted/${name}`, { driveItemId: `many-${n}` }),
          status: "pending_review",
          text: "Text",
          scienceCode: "2.02.09",
          scienceCodeSource: "document",
          updatedAt: 1,
        });
        const row = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as typeof fields;
        await ctx.db.insert("ingestionItems", row);
        await adjustImportCompanyCounts(ctx, null, row);
      }
    });
    const result = await admin.mutation(api.ingestion.matchWriterInitials, { initials: "KT", writerName: "Kim Tran" });
    expect(result).toMatchObject({ changed: 100, more: true });
    const named = async () => (await t.run((ctx) => ctx.db.query("ingestionItems").collect())).filter((row) => row.writerName === "Kim Tran").length;
    expect(await named()).toBe(100);
    await runWriterWalk(t);
    expect(await named()).toBe(120);
    await expectCountsMatchRecount(t, "after 120 files");
    const { stored } = await countsNowAndRecount(t);
    expect(stored["review|cedarline systems"]).toMatchObject({ needsCheck: 0, ready: 120 });
  });

  it("refuses anyone but an admin, initials that are not initials, and an email address", async () => {
    const { admin, writer } = await setup();
    await expect(writer.mutation(api.ingestion.matchWriterInitials, { initials: "KT", writerName: "Kim Tran" })).rejects.toThrow(/Admin only/);
    await expect(admin.mutation(api.ingestion.matchWriterInitials, { initials: "K", writerName: "Kim Tran" })).rejects.toThrow(
      "Initials are two or three letters, such as KT."
    );
    await expect(
      admin.mutation(api.ingestion.matchWriterInitials, { initials: "KT", writerName: "kim.tran@example.com" })
    ).rejects.toThrow("Type the writer's name, not an email address.");
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
