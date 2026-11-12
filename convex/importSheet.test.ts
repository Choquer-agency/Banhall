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
  for (const key of ["sheetTab", "needsCheck", "checkReasons", "sortKey", "scienceCodeSource"] as const) {
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

type CategoryCounts = { total: number; needsCheck: number; fiscalYears: Record<string, number> };
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

/** Whether a row needs a person to look at it, written out from its labels. */
function needsCheckByHand(row: Doc<"ingestionItems">): boolean {
  // Only files on the review tab are ever flagged.
  if (tabByHand(row.status) !== "review") return false;
  // No company folder or company name.
  if (row.clientName === undefined) return true;
  // Not known what kind of file it is.
  if (row.category === "unknown") return true;
  // It could not be read.
  if (row.status === "failed") return true;
  // No fiscal year end, on a category that belongs to a fiscal year.
  if (row.category !== "company_file" && row.fiscalYearEnd === undefined) return true;
  if (row.category === "final_pd") {
    // No science code, once reading is over (reading may still find one).
    if (!row.scienceCode && !beingReadByHand(row)) return true;
    // No writer's name or initials.
    if (!row.writerName && !row.writerInitials) return true;
  }
  return false;
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
 * A band, category or year with no file is left out.
 */
function recountByHand(items: Array<Doc<"ingestionItems">>): Record<string, BandCounts> {
  const bands: Record<string, BandCounts> = {};
  for (const row of items) {
    if (row.sheetTab === undefined) continue;
    expect(row.sheetTab, `${row.path} sheetTab`).toBe(tabByHand(row.status));
    const check = needsCheckByHand(row);
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
          await t.mutation(internal.ingestion.markItemProcessed, {
            itemId: pick(candidates)._id,
            storageId,
            text: "Field of science or technology: 2.02.09",
            ...(rand() < 0.5 ? { documentScienceCode: "2.02.09" } : {}),
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
          const refused = chosen.some((row) => ["approved", "rejected", "deleted"].includes(row.status));
          const call = admin.mutation(api.ingestion.setSheetLabels, { ids: chosen.map((row) => row._id), patch });
          if (refused) await expect(call).rejects.toThrow();
          else await call;
        }],
      ];

      const used = new Set<string>();
      const statusesSeen = new Set<string>();
      const bandsSeen = new Set<string>();
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
        for (const row of await rows()) statusesSeen.add(row.status);
        for (const key of Object.keys((await countsNowAndRecount(t)).stored)) bandsSeen.add(key);
      }
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
      needsCheck: 1,
      hasCheck: true,
      categories: { unknown: { total: 1, needsCheck: 1, fiscalYears: { none: 1 } } },
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
      checkReasons: ["no_science_code"],
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
      [ids.pd4r, ["no_science_code"]],
      [ids.pd4, ["no_science_code"]],
      [ids.pd12, ["no_science_code"]],
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
        },
      ],
      [{ pdNumber: "07" }, { pdNumber: "7", editedLabels: ["pdNumber"] }],
      [{ version: { code: "S", number: 4 } }, { versionCode: "S", versionNumber: 4, editedLabels: ["version"] }],
      [{ writerName: "Priya Nair" }, { writerName: "Priya Nair", editedLabels: ["writerName"] }],
      [
        { scienceCode: "2.02.09" },
        { scienceCode: "2.02.09", scienceCodeSource: "person", needsCheck: false, checkReasons: [], editedLabels: ["scienceCode"] },
      ],
    ];
    for (const [patch, expected] of cases) {
      const { admin, t, id } = await oneFinalPd();
      await expect(admin.mutation(api.ingestion.setSheetLabels, { ids: [id], patch })).resolves.toBe(1);
      const row = await getItem(t, id);
      expect(row, JSON.stringify(patch)).toMatchObject(expected);
      expectInvariants(row);
      await expectCountsMatchRecount(t, JSON.stringify(patch));
    }
  });

  it("sets several labels at once, and a second identical edit changes nothing", async () => {
    const { admin, t, id } = await oneFinalPd();
    const patch = { writerName: "Sam Okafor", scienceCode: "2.02.09", pdNumber: "12a" };
    await expect(admin.mutation(api.ingestion.setSheetLabels, { ids: [id], patch })).resolves.toBe(1);
    const row = await getItem(t, id);
    expect(row).toMatchObject({
      writerName: "Sam Okafor",
      scienceCode: "2.02.09",
      pdNumber: "12a",
      editedLabels: ["pdNumber", "writerName", "scienceCode"],
      needsCheck: false,
    });
    expect(row.sortKey).toBe(`0012a 20002 ${PD_NAME.toLowerCase()}`);
    vi.setSystemTime(Date.now() + 60_000);
    await expect(admin.mutation(api.ingestion.setSheetLabels, { ids: [id], patch })).resolves.toBe(0);
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
    ).resolves.toBe(100);
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

  it("refuses approved, rejected and deleted files, changing nothing", async () => {
    const { admin, t } = await setup();
    const open = await stage(t, `${CEDARLINE_FY}/Drafts/open.docx`);
    const approved = await stage(t, `${CEDARLINE_FY}/Drafts/approved.docx`);
    const rejected = await stage(t, `${CEDARLINE_FY}/Drafts/rejected.docx`);
    const deleted = await stage(t, `${CEDARLINE_FY}/Drafts/deleted.docx`);
    await markRead(t, deleted);
    await admin.mutation(api.ingestion.removeItem, { itemId: deleted });
    await admin.mutation(api.ingestion.rejectItem, { itemId: rejected });
    await t.run((ctx) => ctx.db.patch(approved, { status: "approved" }));
    const before = await getItem(t, open);
    await expect(
      admin.mutation(api.ingestion.setSheetLabels, { ids: [open, approved], patch: { writerName: "Dana Whitlock" } })
    ).rejects.toThrow('"approved.docx" is already approved, so its labels cannot be changed here.');
    await expect(
      admin.mutation(api.ingestion.setSheetLabels, { ids: [open, rejected], patch: { writerName: "Dana Whitlock" } })
    ).rejects.toThrow(/was rejected/);
    await expect(
      admin.mutation(api.ingestion.setSheetLabels, { ids: [open, deleted], patch: { writerName: "Dana Whitlock" } })
    ).rejects.toThrow(/Restore it before changing its labels/);
    expect(await getItem(t, open)).toEqual(before);
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
    ).resolves.toBe(100);
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
    // A person already set the code.
    const set = await stage(t, `${CEDARLINE_FY}/In Review/set.docx`);
    await markRead(t, set, preview);
    await admin.mutation(api.ingestion.setSheetLabels, { ids: [set], patch: { scienceCode: "1.02.01" } });

    await admin.mutation(api.ingestion.setSheetLabels, { ids: [copy, reading, set], patch: { category: "final_pd" } });
    expect(await getItem(t, copy)).toMatchObject({
      category: "final_pd",
      docKind: "pd",
      scienceCode: "2.02.09",
      scienceCodeSource: "document",
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

  it("keeps the pair when a person retypes the company with other capitals", async () => {
    const { t, admin } = await setup();
    const pd = await stage(t, `${CEDARLINE_FY}/To be submitted/${PD_NAME}`);
    const transcript = await stage(t, `${CEDARLINE_FY}/WIP/Technical/Audio/interview.vtt`);
    await markRead(t, pd);
    await t.mutation(internal.ingestion.recomputePairs, { groupKeys: ["cedarline systems::2025"] });
    await admin.mutation(api.ingestion.setSheetLabels, { ids: [pd], patch: { company: "CEDARLINE  systems" } });
    // Nothing pairing reads moved, so nothing was even scheduled.
    expect(await runPairing(t)).toEqual([]);
    expect(await getItem(t, pd)).toMatchObject({
      clientName: "CEDARLINE systems",
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

  it("stores a final PD's code with its source, which clears the check", async () => {
    const t = convexTest(schema, modules);
    const id = await stage(t, `${CEDARLINE_FY}/To be submitted/${PD_NAME}`);
    await processWith(t, id, "2.02.09");
    const row = await getItem(t, id);
    expect(row).toMatchObject({ scienceCode: "2.02.09", scienceCodeSource: "document", needsCheck: false });
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
    await admin.mutation(api.ingestion.setSheetLabels, { ids: [personal], patch: { scienceCode: "1.02.01" } });
    await processWith(t, personal, "2.02.09");
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
      expect(row, row.driveItemId).toMatchObject({ scienceCode: "2.02.09", scienceCodeSource: "document", checkReasons: [] });
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
