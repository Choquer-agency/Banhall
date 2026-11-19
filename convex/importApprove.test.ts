/// <reference types="vite/client" />
// Approve on Import (2026-11-17, docs/product-domain.md): every approved
// file goes on its company's page, a final PD waits for its Brain check, the
// old review page's Approve is switched off. Every company and person here
// is made up.
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConvexError } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { classify } from "./lib/ingestionClassify";
import { addShare, countShareOf, countsOf, emptyImportCounts } from "./lib/importCompanyCounts";
import type { ImportCounts } from "./lib/ingestionSheetValidators";
import { IMPORT_BRAIN_LEAK_LOG_REASON, IMPORT_BRAIN_NOT_COVERED } from "./lib/importBrainCopy";
import { BRAIN_CHECK_GONE, BRAIN_COPY_CHANGED, BRAIN_COPY_DIFFERS, BRAIN_COPY_LABELS_DIFFER, FILE_TEXT_PAGE_CHARS, OLD_APPROVE_OFF } from "./ingestion";
import { importSource } from "./brain";
import schema from "./schema";
import workpoolSchema from "../node_modules/@convex-dev/workpool/src/component/schema.js";

const modules = import.meta.glob("./**/*.ts");
const workpoolModules = import.meta.glob("../node_modules/@convex-dev/workpool/src/component/**/*.ts");
type T = ReturnType<typeof convexTest<typeof schema.tables>>;
type Admin = ReturnType<T["withIdentity"]>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("VOYAGE_API_KEY", "test-voyage-key");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function setup() {
  const t = convexTest(schema, modules);
  t.registerComponent("embedPool", workpoolSchema, workpoolModules);
  const ids = await t.run(async (ctx) => ({
    adminId: await ctx.db.insert("users", { authId: "approve-admin", role: "admin", firstName: "Jordan", lastName: "Ellis" }),
    writerId: await ctx.db.insert("users", { authId: "approve-writer", role: "writer", firstName: "Sam" }),
    managerId: await ctx.db.insert("users", { authId: "approve-manager", role: "manager", firstName: "Lee" }),
  }));
  return {
    t,
    ...ids,
    admin: t.withIdentity({ subject: "approve-admin" }),
    writer: t.withIdentity({ subject: "approve-writer" }),
    manager: t.withIdentity({ subject: "approve-manager" }),
  };
}

const CEDARLINE = "Cedarline Systems";
const FY = `${CEDARLINE}/2025 - Mar 31`;
const PD = `${FY}/Submitted/04 CedarlineSystems 2025-03-31 T2.DW.PN ColdChainSensorDrift.docx`;
const PD_TEXT = [
  "Prepared by Dana Whitlock",
  "Cedarline Systems built a cold chain sensor that drifts less in freezers.",
  "Field of science or technology: 2.02.09",
  "We tested the sensor at minus 30 degrees for six weeks.",
].join("\n");

/** Stages a file at `path` the way the feeders do. */
async function stage(t: T, path: string, contentHash = `bytes-${path}`): Promise<Id<"ingestionItems">> {
  const segments = path.split("/");
  const name = segments.pop()!;
  const meta = classify(segments.join("/"), name);
  const driveItemId = `drive-${path}`;
  const id = await t.mutation(internal.ingestion.upsertDiscoveredItem, {
    driveItemId,
    path,
    name,
    clientName: meta.clientName,
    fiscalYearLabel: meta.fiscalYearLabel,
    fiscalYear: meta.fiscalYear,
    docKind: meta.docKind,
    size: 2048,
    lastModifiedAt: 1_700_000_000_000,
    contentHash,
    pairGroupKey: meta.pairGroupKey,
  });
  if (id) return id;
  const row = await t.run((ctx) =>
    ctx.db.query("ingestionItems").withIndex("by_driveItemId", (q) => q.eq("driveItemId", driveItemId)).unique()
  );
  return row!._id;
}

/** Reads a staged file the way extraction does: its original, its whole text in storage and a preview. */
async function read(
  t: T,
  id: Id<"ingestionItems">,
  text: string,
  extra: { scienceCode?: string; extractNote?: string; textCut?: boolean } = {}
) {
  const { storageId, textStorageId } = await t.run(async (ctx) => ({
    storageId: await ctx.storage.store(new Blob(["original bytes"])),
    textStorageId: await ctx.storage.store(new Blob([text], { type: "text/plain" })),
  }));
  await t.mutation(internal.ingestion.markItemProcessed, {
    itemId: id,
    storageId,
    text: text.slice(0, 8000),
    textStorageId,
    ...(extra.extractNote ? { extractNote: extra.extractNote } : {}),
    ...(extra.textCut !== undefined ? { textCut: extra.textCut } : {}),
    ...(extra.scienceCode ? { documentScienceCode: extra.scienceCode } : {}),
  });
  return { storageId, textStorageId };
}

async function stageRead(t: T, path: string, text: string, extra: { scienceCode?: string; extractNote?: string; textCut?: boolean } = {}) {
  const id = await stage(t, path);
  await read(t, id, text, extra);
  return id;
}

/** A ready final PD of Cedarline Systems (writer from DW, code from its text). */
async function readyPd(t: T, path = PD, text = PD_TEXT) {
  return await stageRead(t, path, text, { scienceCode: "2.02.09" });
}

async function item(t: T, id: Id<"ingestionItems">): Promise<Doc<"ingestionItems">> {
  const row = await t.run((ctx) => ctx.db.get(id));
  if (!row) throw new Error("item missing");
  return row;
}

async function pickIndustry(admin: Admin, companyKey = "cedarline systems", industry = "manufacturing") {
  await admin.mutation(api.ingestion.setNewCompanyIndustry, { companyKey, industry });
}

/** Approve on selected files, and the chain run to its end. */
async function approve(t: T, admin: Admin, ids: Id<"ingestionItems">[]) {
  const { approvalId } = await admin.mutation(api.ingestion.approveFiles, { ids });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  return approvalId;
}

async function fileRows(t: T, approvalId: Id<"importApprovals">) {
  return await t.run((ctx) =>
    ctx.db
      .query("importApprovalFiles")
      .withIndex("by_approvalId_and_state_and_position", (q) => q.eq("approvalId", approvalId))
      .collect()
  );
}

async function companyFiles(t: T) {
  return await t.run((ctx) => ctx.db.query("companyFiles").collect());
}

async function clients(t: T) {
  return await t.run((ctx) => ctx.db.query("clients").collect());
}

/** Every company band equals a recount of its files (the counts' own rule, from scratch). */
async function expectCountsMatchRecount(t: T) {
  const { items, bands } = await t.run(async (ctx) => ({
    items: await ctx.db.query("ingestionItems").collect(),
    bands: await ctx.db.query("importCompanies").collect(),
  }));
  const recount: Record<string, ImportCounts> = {};
  for (const row of items) {
    const share = countShareOf(row);
    if (!share) continue;
    const key = `${share.sheetTab}|${share.companyKey}`;
    recount[key] = addShare(recount[key] ?? emptyImportCounts(), share, 1);
  }
  const stored: Record<string, ImportCounts> = {};
  for (const band of bands) stored[`${band.sheetTab}|${band.companyKey}`] = countsOf(band);
  expect(stored).toEqual(recount);
}

function refusal(err: unknown) {
  return err instanceof ConvexError ? (err.data as { code: string; message: string }) : null;
}

describe("approving a file", () => {
  it("puts a final PD on a new company's page with the picked industry, sharing its original, and waits for its Brain check", async () => {
    const { t, admin, adminId } = await setup();
    // A team member whose saved initials are the reviewer's.
    const reviewerUser = await t.run((ctx) =>
      ctx.db.insert("users", { authId: "approve-pn", role: "writer", firstName: "Priya", lastName: "Nadeau", initials: "PN" })
    );
    const pd = await readyPd(t);
    const before = await item(t, pd);
    expect(before.needsCheck).toBe(false);
    await pickIndustry(admin);

    const approvalId = await approve(t, admin, [pd]);
    const after = await item(t, pd);
    expect(after).toMatchObject({ status: "approved", sheetTab: "approved", brainCheck: "waiting", reviewedBy: adminId });
    expect(after.brainSourceId).toBeUndefined();

    const [client] = await clients(t);
    expect(client).toMatchObject({ name: CEDARLINE, nameKey: "cedarline systems", industry: "manufacturing", status: "active", createdBy: adminId });
    // The sheet's pick has done its job.
    expect(await t.run((ctx) => ctx.db.query("importNewCompanies").collect())).toEqual([]);

    const [file] = await companyFiles(t);
    const reviewerWriter = await t.run((ctx) => ctx.db.query("pdWriters").withIndex("by_userId", (q) => q.eq("userId", reviewerUser)).first());
    expect(file).toMatchObject({
      clientId: client._id,
      fileName: before.name,
      fileType: "docx",
      category: "final_pd",
      storageId: before.storageId,
      fiscalYear: 2025,
      pdNumber: "4",
      writerId: before.writerId,
      reviewerId: reviewerWriter!._id,
      importItemId: pd,
      uploadedBy: adminId,
      hasText: true,
      textLength: PD_TEXT.length,
      searchPiecesDue: true,
      importLabels: {
        pdTitle: before.pdTitle,
        versionCode: "T",
        versionNumber: 2,
        scienceCode: "2.02.09",
        fiscalYearEnd: before.fiscalYearEnd,
        writerInitials: "DW",
        reviewerInitials: "PN",
      },
    });
    expect(after.companyFileId).toBe(file._id);
    // The text is the Import file's own, read once: no reading of the original is queued.
    const pieces = await t.run((ctx) =>
      ctx.db.query("companyFileTexts").withIndex("by_companyFileId_and_start", (q) => q.eq("companyFileId", file._id)).collect()
    );
    expect(pieces.map((piece) => piece.text).join("")).toBe(PD_TEXT);
    const events = await t.run((ctx) => ctx.db.query("companyFileEvents").collect());
    expect(events).toMatchObject([{ companyFileId: file._id, action: "add", userId: adminId }]);

    // The approval counted it.
    expect((await admin.query(api.ingestion.approvalProgress, {}))[0]).toMatchObject({
      approvalId,
      status: "done",
      total: 1,
      done: 1,
      approved: 1,
      refused: 0,
      lastProgressAt: (await t.run((ctx) => ctx.db.get(approvalId)))!.updatedAt,
      companyName: CEDARLINE,
    });
    // The band moved tabs, with its Brain check counted.
    expect(await admin.query(api.ingestion.sheetTotals, { tab: "approved" })).toMatchObject({ files: 1, brainCheck: 1 });
    expect(await admin.query(api.ingestion.sheetTotals, { tab: "review" })).toMatchObject({ files: 0 });
    await expectCountsMatchRecount(t);
    // Approve never makes a project, a previous_pd or a lesson set.
    expect(await t.run((ctx) => ctx.db.query("projects").collect())).toEqual([]);
    expect(file.category).not.toBe("previous_pd");
    expect(await t.run((ctx) => ctx.db.query("brainSources").collect())).toEqual([]);
  });

  it("files the reviewer the file has: one an Admin chose, or one it kept after its initials changed", async () => {
    const { t, admin } = await setup();
    await pickIndustry(admin);
    // Read while no member had the initials PN: its reviewer is a past writer made from them.
    const kept = await readyPd(t);
    const pastPn = (await item(t, kept)).reviewerId!;
    expect(pastPn).toBeDefined();
    const chosen = await readyPd(t, `${FY}/Submitted/05 CedarlineSystems 2025-03-31 T1.DW.PN SensorHousing.docx`);
    const draft = await stageRead(t, `${FY}/Drafts/03 CedarlineSystems 2025-03-31 R2.DW.PN SensorDraft.docx`, "Draft text");
    // A member gets the initials PN since: the initials alone would now give her.
    const priya = await t.run((ctx) =>
      ctx.db.insert("users", { authId: "approve-pn", role: "writer", firstName: "Priya", lastName: "Nadeau", initials: "PN" })
    );
    // An Admin chooses another reviewer for a PD and a draft.
    await admin.mutation(api.ingestion.setFileReviewers, { ids: [chosen, draft], reviewer: { kind: "name", name: "Sam Okafor" } });
    const sam = (await item(t, chosen)).reviewerId!;
    expect(await item(t, chosen)).toMatchObject({ reviewerSource: "person" });
    expect((await item(t, kept)).reviewerId).toBe(pastPn);

    await approve(t, admin, [kept, chosen, draft]);
    const byItem = new Map((await companyFiles(t)).map((file) => [file.importItemId, file]));
    expect(byItem.get(kept)!.reviewerId).toBe(pastPn);
    expect(byItem.get(chosen)!.reviewerId).toBe(sam);
    expect(byItem.get(draft)!.reviewerId).toBe(sam);
    const priyaWriter = await t.run((ctx) => ctx.db.query("pdWriters").withIndex("by_userId", (q) => q.eq("userId", priya)).first());
    for (const id of [kept, chosen, draft]) expect(byItem.get(id)!.reviewerId).not.toBe(priyaWriter?._id);
  });

  it("files a final PD with no saved reviewer under the one its reviewer initials give", async () => {
    const { t, admin } = await setup();
    await pickIndustry(admin);
    const reviewerUser = await t.run((ctx) =>
      ctx.db.insert("users", { authId: "approve-pn", role: "writer", firstName: "Priya", lastName: "Nadeau", initials: "PN" })
    );
    const pd = await readyPd(t);
    // A row read before files kept a reviewer.
    await t.run((ctx) => ctx.db.patch(pd, { reviewerId: undefined, reviewerSource: undefined }));
    await approve(t, admin, [pd]);
    const reviewerWriter = await t.run((ctx) => ctx.db.query("pdWriters").withIndex("by_userId", (q) => q.eq("userId", reviewerUser)).first());
    const [file] = await companyFiles(t);
    expect(file.reviewerId).toBe(reviewerWriter!._id);
  });

  it("files every category under its company file category, with no Brain check for anything but a final PD", async () => {
    const { t, admin } = await setup();
    const paths = {
      draft: `${FY}/Drafts/Sensor notes.docx`,
      review_copy: `${FY}/In Review/Sensor review.docx`,
      transcript: `${FY}/WIP/Technical/Audio/Kickoff call.txt`,
      supporting: `${FY}/Data/Freezer readings.pdf`,
      company_file: `${CEDARLINE}/About Cedarline.pdf`,
    } as const;
    const ids: Record<string, Id<"ingestionItems">> = {};
    for (const [category, path] of Object.entries(paths)) {
      ids[category] = await stageRead(t, path, `Text of ${category}`);
      expect((await item(t, ids[category])).category, category).toBe(category);
    }
    // A new company with no industry: files that need no Brain copy are still approved.
    await approve(t, admin, Object.values(ids));
    const [client] = await clients(t);
    expect(client.industry).toBeUndefined();
    const files = await companyFiles(t);
    const byItem = new Map(files.map((file) => [file.importItemId, file]));
    const expected = { draft: "draft", review_copy: "review_copy", transcript: "transcript", supporting: "supporting", company_file: "background" };
    for (const [category, id] of Object.entries(ids)) {
      const row = await item(t, id);
      expect(row.status, category).toBe("approved");
      expect(row.brainCheck, category).toBeUndefined();
      const file = byItem.get(id)!;
      expect(file.category, category).toBe(expected[category as keyof typeof expected]);
      expect(file.storageId, category).toBe(row.storageId);
      expect(file.clientId).toBe(client._id);
    }
    expect(byItem.get(ids.company_file)!.fiscalYear).toBeUndefined();
    expect(byItem.get(ids.draft)!.fiscalYear).toBe(2025);
    await expectCountsMatchRecount(t);
  });

  it("refuses each file that is not ready, in plain reasons per file, and approves the rest", async () => {
    const { t, admin, adminId } = await setup();
    await pickIndustry(admin);
    const ok = await readyPd(t);
    const needsCheck = await stageRead(t, `${FY}/Submitted/05 CedarlineSystems 2025-03-31 T1.DW Second.docx`, "No code here");
    const beingRead = await stage(t, `${FY}/Drafts/Still reading.docx`);
    const deleted = await stageRead(t, `${FY}/Drafts/Gone.docx`, "Gone text");
    await admin.mutation(api.ingestion.removeItems, { ids: [deleted] });
    const missing = await stageRead(t, `${FY}/Drafts/Missing.docx`, "Missing text");
    // A final PD of a new company nobody picked an industry for.
    const noIndustry = await readyPd(t, "Halden Foods/2024 - Dec 31/Submitted/02 HaldenFoods 2024-12-31 S1.DW Proofing.docx");
    // A company merged into another one.
    const merged = await stageRead(t, "Brightwell Dairy/2024 - Dec 31/Drafts/Notes.docx", "Dairy notes");
    // Two active companies with one key: never a guess.
    const unclear = await stageRead(t, "Orchard Lane/2024 - Dec 31/Drafts/Notes.docx", "Orchard notes");
    await t.run(async (ctx) => {
      const keep = await ctx.db.insert("clients", { name: "Brightwell Farms", nameKey: "brightwell farms", status: "active", nameHistoryComplete: true, createdBy: adminId, createdAt: 1, updatedAt: 1 });
      await ctx.db.insert("clients", { name: "Brightwell Dairy", nameKey: "brightwell dairy", status: "merged", mergedIntoClientId: keep, mergedAt: 2, nameHistoryComplete: true, createdBy: adminId, createdAt: 1, updatedAt: 2 });
      for (const n of [1, 2]) {
        await ctx.db.insert("clients", { name: "Orchard Lane", nameKey: "orchard lane", status: "active", nameHistoryComplete: true, createdBy: adminId, createdAt: n, updatedAt: n });
      }
    });
    const { approvalId } = await admin.mutation(api.ingestion.approveFiles, {
      ids: [ok, needsCheck, beingRead, deleted, missing, noIndustry, merged, unclear],
    });
    await t.run(async (ctx) => {
      const row = await ctx.db.get(missing);
      await ctx.db.delete(missing);
      const band = await ctx.db.query("importCompanies").withIndex("by_sheetTab_and_companyKey", (q) => q.eq("sheetTab", "review").eq("companyKey", row!.companyKey!)).first();
      const share = countShareOf(row!)!;
      await ctx.db.patch(band!._id, addShare(countsOf(band!), share, -1));
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const rows = await fileRows(t, approvalId);
    const byItem = new Map(rows.map((row) => [row.itemId, row]));
    expect(byItem.get(ok)).toMatchObject({ state: "approved" });
    expect(byItem.get(needsCheck)).toMatchObject({ state: "refused", reason: "needs_check" });
    expect(byItem.get(beingRead)).toMatchObject({ state: "refused", reason: "being_read" });
    expect(byItem.get(deleted)).toMatchObject({ state: "refused", reason: "not_on_review" });
    expect(byItem.get(missing)).toMatchObject({ state: "refused", reason: "missing" });
    expect(byItem.get(noIndustry)).toMatchObject({ state: "refused", reason: "no_industry", detail: "Pick an industry for this company." });
    expect(byItem.get(merged)).toMatchObject({ state: "refused", reason: "company_merged", detail: "Merged into Brightwell Farms" });
    expect(byItem.get(unclear)).toMatchObject({ state: "refused", reason: "company_unclear" });
    for (const id of [needsCheck, beingRead, noIndustry, merged, unclear]) {
      expect((await item(t, id)).status, id).not.toBe("approved");
      expect((await item(t, id)).companyFileId).toBeUndefined();
    }
    // Nothing made for the refused: one company file, and no Halden Foods company.
    expect(await companyFiles(t)).toHaveLength(1);
    expect((await clients(t)).map((client) => client.nameKey).sort()).toEqual(["brightwell dairy", "brightwell farms", "cedarline systems", "orchard lane", "orchard lane"]);

    expect((await admin.query(api.ingestion.approvalProgress, {}))[0]).toMatchObject({ total: 8, done: 8, approved: 1, refused: 7, status: "done" });
    const result = await admin.query(api.ingestion.approvalRefusals, { approvalId });
    expect(result.more).toBe(false);
    expect(result.files.map((file) => file.reason).sort()).toEqual(
      ["being_read", "company_merged", "company_unclear", "missing", "needs_check", "no_industry", "not_on_review"].sort()
    );
    await expectCountsMatchRecount(t);
  });

  it("leaves a file whose approval fails on To review, named, and goes on", async () => {
    const { t, admin } = await setup();
    // More text than a company file keeps (1,000,000 characters).
    const tooLong = await stageRead(t, `${FY}/Drafts/Huge.docx`, "x".repeat(1_000_001));
    const fine = await stageRead(t, `${FY}/Drafts/Fine.docx`, "Fine text");
    const approvalId = await approve(t, admin, [tooLong, fine]);
    const rows = await fileRows(t, approvalId);
    expect(rows.find((row) => row.itemId === tooLong)).toMatchObject({ state: "refused", reason: "not_saved" });
    expect((await item(t, tooLong)).status).toBe("pending_review");
    expect((await item(t, fine)).status).toBe("approved");
    await expectCountsMatchRecount(t);
  });

  it("refuses a file whose text could not be read in plain words, goes on with the next, and approves it when tried again", async () => {
    const { t, admin } = await setup();
    const unreadable = await stageRead(t, `${FY}/Drafts/Unreadable.docx`, "Unreadable text");
    const fine = await stageRead(t, `${FY}/Drafts/Fine.docx`, "Fine text");
    // What staging scheduled runs first, so the only text read below is the approval's.
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const { approvalId } = await admin.mutation(api.ingestion.approveFiles, { ids: [unreadable, fine] });
    // Storage fails for the first file's text only.
    const failedRead = vi.spyOn(Blob.prototype, "text").mockRejectedValueOnce(new Error("storage is down"));
    try {
      await t.action(internal.ingestion.runApproval, { approvalId });
      expect(failedRead).toHaveBeenCalledTimes(2);
    } finally {
      failedRead.mockRestore();
    }
    const rows = await fileRows(t, approvalId);
    expect(rows.find((row) => row.itemId === unreadable)).toMatchObject({ state: "refused", reason: "text_not_read", detail: "Try again." });
    expect(rows.find((row) => row.itemId === fine)).toMatchObject({ state: "approved" });
    expect((await item(t, unreadable)).status).toBe("pending_review");
    expect((await item(t, unreadable)).companyFileId).toBeUndefined();
    expect((await item(t, fine)).status).toBe("approved");
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await admin.query(api.ingestion.approvalProgress, {}))[0]).toMatchObject({ status: "done", done: 2, approved: 1, refused: 1 });
    expect((await admin.query(api.ingestion.approvalRefusals, { approvalId })).files).toEqual([
      { itemId: unreadable, name: "Unreadable.docx", reason: "text_not_read", detail: "Try again." },
    ]);
    await expectCountsMatchRecount(t);
    // Approving it again reads its text again.
    await approve(t, admin, [unreadable]);
    expect((await item(t, unreadable)).status).toBe("approved");
    const file = (await companyFiles(t)).find((row) => row.importItemId === unreadable)!;
    expect(file).toMatchObject({ hasText: true, textLength: "Unreadable text".length });
  });

  it("reads the original again on the server when Import does not hold the whole text, and says so", async () => {
    const { t, admin } = await setup();
    // The extraction says it cut the text; and a row read before that field existed says so only in its note.
    const cut = await stageRead(t, `${FY}/Drafts/Long.docx`, "Cut text", { textCut: true, extractNote: "Read with notes" });
    const legacy = await stageRead(t, `${FY}/Drafts/Older.docx`, "Older cut text", { extractNote: "text truncated at 700000 bytes" });
    expect((await item(t, legacy)).textCut).toBeUndefined();
    const { approvalId } = await admin.mutation(api.ingestion.approveFiles, { ids: [cut, legacy] });
    await t.action(internal.ingestion.runApproval, { approvalId });
    const files = await companyFiles(t);
    // No text from Import (it was cut); the shared original is read on the server, as for a file a person adds.
    for (const id of [cut, legacy]) {
      const file = files.find((row) => row.importItemId === id)!;
      expect(file).toMatchObject({ storageId: (await item(t, id)).storageId, hasText: false, textLength: 0 });
    }
    // The older row stores the answer at its approval.
    expect((await item(t, legacy)).textCut).toBe(true);
    const jobs = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(jobs.filter((job) => job.name.endsWith(":readStoredCompanyFile")).map((job) => job.args[0])).toHaveLength(2);
  });

  it("uses the text the action read only if it is still the file's text; otherwise reads the original", async () => {
    const { t, admin } = await setup();
    const draft = await stageRead(t, `${FY}/Drafts/Notes.docx`, "First reading");
    const { approvalId } = await admin.mutation(api.ingestion.approveFiles, { ids: [draft] });
    const first = await item(t, draft);
    // The file gets new text in storage after the action read the old text (as a reading again would leave it).
    await t.run(async (ctx) => {
      const textStorageId = await ctx.storage.store(new Blob(["Second reading"]));
      await ctx.db.patch(draft, { textStorageId });
    });
    const [row] = await fileRows(t, approvalId);
    await t.mutation(internal.ingestion.approveImportFile, { fileRowId: row._id, text: "First reading", textStorageId: first.textStorageId! });
    const [file] = await companyFiles(t);
    expect(file).toMatchObject({ hasText: false, textLength: 0 });
    const jobs = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(jobs.filter((job) => job.name.endsWith(":readStoredCompanyFile")).map((job) => job.args[0])).toEqual([{ companyFileId: file._id }]);
  });

  it("refuses a file moved to another company before its turn in a company's approval", async () => {
    const { t, admin } = await setup();
    const stays = await stageRead(t, `${FY}/Drafts/Stays.docx`, "Stays");
    const moves = await stageRead(t, `${FY}/Drafts/Moves.docx`, "Moves");
    const { approvalId } = await admin.mutation(api.ingestion.approveCompanyReady, { companyKey: "cedarline systems" });
    // One step lists the company's ready files, then they wait.
    await t.mutation(internal.ingestion.approvalNext, { approvalId });
    expect(await fileRows(t, approvalId)).toHaveLength(2);
    await admin.mutation(api.ingestion.setSheetLabels, { ids: [moves], patch: { company: "Halden Foods" } });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const rows = await fileRows(t, approvalId);
    expect(rows.find((row) => row.itemId === moves)).toMatchObject({ state: "refused", reason: "left_company" });
    expect((await item(t, moves)).status).toBe("pending_review");
    expect((await item(t, stays)).status).toBe("approved");
  });

  it("makes nothing twice: a retried step, a second approval and a second company approval of the same files", async () => {
    const { t, admin } = await setup();
    await pickIndustry(admin);
    const pd = await readyPd(t);
    const draft = await stageRead(t, `${FY}/Drafts/Notes.docx`, "Draft text");
    const first = await approve(t, admin, [pd, draft]);
    // The same step again: settled rows are left as they are.
    for (const row of await fileRows(t, first)) {
      expect(await t.mutation(internal.ingestion.approveImportFile, { fileRowId: row._id })).toEqual({ state: "approved" });
    }
    // A new approval of the same files: already approved, counted, nothing made.
    const second = await approve(t, admin, [pd, draft]);
    expect((await fileRows(t, second)).map((row) => row.state)).toEqual(["already", "already"]);
    expect((await admin.query(api.ingestion.approvalProgress, {}))[0]).toMatchObject({ approved: 2, refused: 0 });
    expect(await companyFiles(t)).toHaveLength(2);
    expect(await clients(t)).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.query("companyFileEvents").collect())).toHaveLength(2);
    await expectCountsMatchRecount(t);
  });

  it("uses the company that has the key, and makes one from its projects when only projects have it", async () => {
    const { t, admin, adminId } = await setup();
    const existing = await t.run((ctx) =>
      ctx.db.insert("clients", { name: "Cedarline Systems Inc.", nameKey: "cedarline systems", industry: "software", status: "active", nameHistoryComplete: true, createdBy: adminId, createdAt: 1, updatedAt: 1 })
    );
    const pd = await readyPd(t);
    // Only projects carry Halden Foods.
    const project = await t.run(async (ctx) => {
      await ctx.db.insert("dashboardCompanies", { companyKey: "halden foods", clientName: "Halden Foods", projectCount: 1, updatedAt: 1 });
      return await ctx.db.insert("projects", {
        title: "Proofing",
        clientName: "Halden Foods",
        dashboardCompanyKey: "halden foods",
        industry: "food_beverage",
        status: "draft",
        createdBy: adminId,
        shareToken: "halden-token",
        createdAt: 1,
        updatedAt: 1,
      });
    });
    const halden = await readyPd(t, "Halden Foods/2024 - Dec 31/Submitted/02 HaldenFoods 2024-12-31 S1.DW Proofing.docx");
    await approve(t, admin, [pd, halden]);
    const files = await companyFiles(t);
    expect(files.find((file) => file.importItemId === pd)!.clientId).toBe(existing);
    const haldenClient = (await clients(t)).find((client) => client.nameKey === "halden foods")!;
    expect(haldenClient).toMatchObject({ name: "Halden Foods", industry: "food_beverage" });
    expect(files.find((file) => file.importItemId === halden)!.clientId).toBe(haldenClient._id);
    expect((await t.run((ctx) => ctx.db.get(project)))!.clientId).toBe(haldenClient._id);
    expect(await clients(t)).toHaveLength(2);
  });

  it("keeps pairing and counts through the write path, and a PD approved with its transcript stays paired", async () => {
    const { t, admin } = await setup();
    await pickIndustry(admin);
    const pd = await readyPd(t);
    const transcript = await stageRead(t, `${FY}/WIP/Technical/Audio/Kickoff call.txt`, "Call text");
    // Extraction recomputes the group it read (ingestionSync.ts); here, by hand.
    await t.mutation(internal.ingestion.recomputePairs, { groupKeys: ["cedarline systems::2025"] });
    expect((await item(t, pd)).pairStatus).toBe("paired");
    // Approving a PD alone recomputes its group: the transcript left on To review is still paired with it.
    await t.run((ctx) => ctx.db.patch(transcript, { pairStatus: undefined }));
    await approve(t, admin, [pd]);
    expect((await item(t, pd)).pairStatus).toBe("paired");
    expect((await item(t, transcript)).pairStatus).toBe("paired");
    await approve(t, admin, [transcript]);
    expect((await item(t, transcript)).pairStatus).toBe("paired");
    await expectCountsMatchRecount(t);
  });

  it("shares the original: removing the company file keeps the Import file's bytes", async () => {
    const { t, admin } = await setup();
    const draft = await stageRead(t, `${FY}/Drafts/Notes.docx`, "Draft text");
    await approve(t, admin, [draft]);
    const [file] = await companyFiles(t);
    const storageId = (await item(t, draft)).storageId!;
    expect(file.storageId).toBe(storageId);
    await admin.mutation(api.companyFiles.removeCompanyFile, { companyFileId: file._id });
    expect(await t.run((ctx) => ctx.db.system.get(storageId))).not.toBeNull();
    expect((await item(t, draft)).companyFileId).toBe(file._id);
    // The Approved tab says it is no longer on a company page.
    const rows = await admin.query(api.ingestion.sheetFiles, {
      tab: "approved",
      companyKey: "cedarline systems",
      category: "draft",
      onlyToCheck: false,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(rows.page[0].companyPage).toBeUndefined();
  });
});

describe("approving in batches", () => {
  it("approves a company's 130 ready files in pages of one mutation each, with a counter, leaving the ones to check", async () => {
    const { t, admin } = await setup();
    const ready: Id<"ingestionItems">[] = [];
    for (let i = 0; i < 130; i++) ready.push(await stageRead(t, `${FY}/Data/Reading ${i}.pdf`, `Reading ${i}`));
    const toCheck = await stageRead(t, `${FY}/Submitted/09 CedarlineSystems 2025-03-31 T1 NoWriter.docx`, "No writer, no code");
    expect((await item(t, toCheck)).needsCheck).toBe(true);
    const band = await admin.query(api.ingestion.sheetCompanies, {
      tab: "review",
      onlyToCheck: false,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(band.page[0]).toMatchObject({ companyKey: "cedarline systems", ready: 130, needsCheck: 1 });

    const { approvalId, ready: count } = await admin.mutation(api.ingestion.approveCompanyReady, { companyKey: "cedarline systems" });
    expect(count).toBe(130);
    // Pressing it again while it runs gets the same approval.
    expect((await admin.mutation(api.ingestion.approveCompanyReady, { companyKey: "cedarline systems" })).approvalId).toBe(approvalId);
    expect((await admin.query(api.ingestion.approvalProgress, {}))[0]).toMatchObject({ status: "running", total: 130, done: 0 });

    // One step: it lists a page, then approves at most ten files, then schedules the next step.
    await t.action(internal.ingestion.runApproval, { approvalId });
    const [partway] = await admin.query(api.ingestion.approvalProgress, {});
    expect(partway).toMatchObject({ status: "running", done: 10, approved: 10 });
    const steps = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(steps.filter((job) => job.name.endsWith(":runApproval") && job.state.kind === "pending").length).toBeGreaterThan(0);

    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await admin.query(api.ingestion.approvalProgress, {}))[0]).toMatchObject({ status: "done", total: 130, done: 130, approved: 130, refused: 0 });
    for (const id of ready) expect((await item(t, id)).status).toBe("approved");
    expect((await item(t, toCheck)).status).toBe("pending_review");
    expect(await companyFiles(t)).toHaveLength(130);
    expect(await admin.query(api.ingestion.sheetTotals, { tab: "approved" })).toMatchObject({ files: 130, companies: 1 });
    expect(await admin.query(api.ingestion.sheetTotals, { tab: "review" })).toMatchObject({ files: 1, ready: 0, needsCheck: 1 });
    await expectCountsMatchRecount(t);

    // A company with nothing ready, or no company at all, is refused.
    expect(refusal(await admin.mutation(api.ingestion.approveCompanyReady, { companyKey: "cedarline systems" }).catch((e: unknown) => e))?.message).toBe(
      "This company has no files ready to approve."
    );
    expect(refusal(await admin.mutation(api.ingestion.approveCompanyReady, { companyKey: "" }).catch((e: unknown) => e))?.message).toBe(
      "Files with no company cannot be approved. Pick their company first."
    );
  });

  it("takes a selection of more than 100 in parts of up to 100 into one approval with one counter", async () => {
    const { t, admin } = await setup();
    const ids: Id<"ingestionItems">[] = [];
    for (let i = 0; i < 120; i++) ids.push(await stageRead(t, `${FY}/Data/Sheet ${i}.pdf`, `Sheet ${i}`));
    const tooMany = await admin.mutation(api.ingestion.approveFiles, { ids }).catch((e: unknown) => e);
    expect(refusal(tooMany)?.message).toBe("Approve up to 100 files at a time.");
    const { approvalId, added } = await admin.mutation(api.ingestion.approveFiles, { ids: ids.slice(0, 100) });
    expect(added).toBe(100);
    const more = await admin.mutation(api.ingestion.approveFiles, { ids: [...ids.slice(95, 120)], approvalId });
    // The five already in it are not added twice.
    expect(more).toEqual({ approvalId, added: 20 });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await admin.query(api.ingestion.approvalProgress, {}))[0]).toMatchObject({ total: 120, done: 120, approved: 120 });
    expect(await companyFiles(t)).toHaveLength(120);
    // Another Admin cannot add to it.
    await t.run((ctx) => ctx.db.insert("users", { authId: "approve-admin-2", role: "admin" }));
    const other = t.withIdentity({ subject: "approve-admin-2" });
    const err = await other.mutation(api.ingestion.approveFiles, { ids: [ids[0]], approvalId }).catch((e: unknown) => e);
    expect(refusal(err)?.message).toBe("That approval is not yours to add files to.");
  });

  it("shows a running approval to every Admin, and says who started it when another Admin presses it again", async () => {
    const { t, admin } = await setup();
    await stageRead(t, `${FY}/Drafts/Notes.docx`, "Draft text");
    await t.run((ctx) => ctx.db.insert("users", { authId: "approve-admin-2", role: "admin", firstName: "Robin", lastName: "Sample" }));
    const other = t.withIdentity({ subject: "approve-admin-2" });
    const { approvalId } = await admin.mutation(api.ingestion.approveCompanyReady, { companyKey: "cedarline systems" });
    expect(await other.query(api.ingestion.approvalProgress, {})).toMatchObject([{ approvalId, status: "running", mine: false, startedByName: "Jordan Ellis" }]);
    expect(await admin.query(api.ingestion.approvalProgress, {})).toMatchObject([{ approvalId, mine: true }]);
    expect(await other.mutation(api.ingestion.approveCompanyReady, { companyKey: "cedarline systems" })).toEqual({
      approvalId,
      ready: 1,
      alreadyRunningBy: "Jordan Ellis",
    });
    // An older approval still running stays on the line beside a newer one.
    const { approvalId: second } = await admin.mutation(api.ingestion.approveFiles, { ids: [(await t.run((ctx) => ctx.db.query("ingestionItems").first()))!._id] });
    expect((await admin.query(api.ingestion.approvalProgress, {})).map((run) => run.approvalId).sort()).toEqual([approvalId, second].sort());
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await other.query(api.ingestion.approvalProgress, {})).toEqual([]);
  });

  it("gives when its chain last moved, so the page tells a stopped one on its own clock, and starts again after five quiet minutes", async () => {
    const { t, admin } = await setup();
    await stageRead(t, `${FY}/Drafts/Notes.docx`, "Draft text");
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const { approvalId } = await admin.mutation(api.ingestion.approveCompanyReady, { companyKey: "cedarline systems" });
    const run = (await t.run((ctx) => ctx.db.get(approvalId)))!;
    const [line] = await admin.query(api.ingestion.approvalProgress, {});
    expect(line).toMatchObject({ approvalId, status: "running", lastProgressAt: run.updatedAt });
    expect(line).not.toHaveProperty("stalled");
    // Its chain has not moved for five minutes: the query still says running, with the old time,
    // and pressing it again starts a new one (the server's own check).
    const quiet = Date.now() - 5 * 60_000;
    await t.run((ctx) => ctx.db.patch(approvalId, { updatedAt: quiet }));
    expect((await admin.query(api.ingestion.approvalProgress, {}))[0]).toMatchObject({ approvalId, status: "running", lastProgressAt: quiet });
    const again = await admin.mutation(api.ingestion.approveCompanyReady, { companyKey: "cedarline systems" });
    expect(again.approvalId).not.toBe(approvalId);
    expect((await t.run((ctx) => ctx.db.get(approvalId)))!.status).toBe("stopped");
  });

  it("stops when its starter is no longer an Admin, and a closed line stays closed", async () => {
    const { t, admin, adminId } = await setup();
    const id = await stageRead(t, `${FY}/Drafts/Notes.docx`, "Draft text");
    const { approvalId } = await admin.mutation(api.ingestion.approveFiles, { ids: [id] });
    await t.run((ctx) => ctx.db.patch(adminId, { role: "writer" }));
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await t.run((ctx) => ctx.db.get(approvalId)))!.status).toBe("stopped");
    expect((await item(t, id)).status).toBe("pending_review");
    await t.run((ctx) => ctx.db.patch(adminId, { role: "admin" }));
    await admin.mutation(api.ingestion.dismissApproval, { approvalId });
    expect(await admin.query(api.ingestion.approvalProgress, {})).toEqual([]);
  });
});

describe("the Brain check", () => {
  /** An approved final PD waiting for its Brain check, of a company with an industry. */
  async function waitingPd(t: T, admin: Admin, text = PD_TEXT, path = PD) {
    const key = classify(path.split("/").slice(0, -1).join("/"), path.split("/").pop()!).clientName!;
    const known = await t.run((ctx) =>
      ctx.db.query("clients").withIndex("by_status_and_nameKey", (q) => q.eq("status", "active").eq("nameKey", key.toLowerCase())).first()
    );
    const pd = await readyPd(t, path, text);
    if (!known) await pickIndustry(admin, (await item(t, pd)).companyKey!);
    await approve(t, admin, [pd]);
    expect((await item(t, pd)).brainCheck).toBe("waiting");
    return pd;
  }

  it("lists the PDs waiting, shows the scrubbed copy with its notes, and adds the copy the person read", async () => {
    const { t, admin, adminId } = await setup();
    const pd = await waitingPd(t, admin);
    const list = await admin.query(api.ingestion.brainCheckFiles, { paginationOpts: { numItems: 25, cursor: null } });
    expect(list.page).toMatchObject([{ _id: pd, companyName: CEDARLINE, fiscalYear: 2025, pdNumber: "4", writerName: "Dana Whitlock", scienceCode: "2.02.09" }]);

    const preview = await admin.action(api.ingestion.previewBrainCopy, { itemId: pd, alsoRemove: ["cold chain sensor"] });
    expect(preview.ok).toBe(true);
    if (!preview.ok) throw new Error("no preview");
    expect(preview.content).not.toMatch(/Cedarline/i);
    expect(preview.content).not.toMatch(/cold chain sensor/i);
    expect(preview.content).toContain("[redacted]");
    expect(preview).toMatchObject({ title: "Past PD, FY2025", industry: "manufacturing", notCovered: IMPORT_BRAIN_NOT_COVERED });

    // A copy other than the one read is refused.
    expect(await admin.action(api.ingestion.addToBrain, { itemId: pd, alsoRemove: [], seen: preview.seen })).toEqual({
      ok: false,
      reason: BRAIN_COPY_CHANGED,
      changed: true,
    });
    const added = await admin.action(api.ingestion.addToBrain, { itemId: pd, alsoRemove: ["cold chain sensor"], seen: preview.seen });
    expect(added).toMatchObject({ ok: true, outcome: "added" });
    if (!added.ok) throw new Error("not added");
    const source = await t.run((ctx) => ctx.db.get(added.sourceId));
    expect(source).toMatchObject({
      status: "approved",
      title: "Past PD, FY2025",
      docType: "pd",
      industry: "manufacturing",
      importItemId: pd,
      importContentHash: (await item(t, pd)).contentHash,
      content: preview.content,
    });
    expect(await item(t, pd)).toMatchObject({ brainSourceId: added.sourceId, brainCheck: "added", brainCheckedBy: adminId });
    // Approved as a curated import (its embedding goes to the embed pool), and logged.
    const audit = await t.run((ctx) => ctx.db.query("brainAuditLog").collect());
    expect(audit).toMatchObject([{ action: "approve", sourceId: added.sourceId, actorId: adminId }]);
    // The company file is untouched, and the Brain check count went down.
    expect(await companyFiles(t)).toHaveLength(1);
    expect(await admin.query(api.ingestion.sheetTotals, { tab: "approved" })).toMatchObject({ brainCheck: 0 });
    await expectCountsMatchRecount(t);
    // It is no longer waiting.
    expect(refusal(await admin.action(api.ingestion.previewBrainCopy, { itemId: pd, alsoRemove: [] }).catch((e: unknown) => e))?.message).toBe(
      BRAIN_CHECK_GONE
    );
  });

  it("refuses a copy whose title, industry or writer changed after it was read", async () => {
    const { t, admin } = await setup();
    const pd = await waitingPd(t, admin);
    const preview = await admin.action(api.ingestion.previewBrainCopy, { itemId: pd, alsoRemove: [] });
    if (!preview.ok) throw new Error("no preview");
    const client = (await clients(t))[0];
    await t.run((ctx) => ctx.db.patch(client._id, { industry: "agriculture" }));
    expect(await admin.action(api.ingestion.addToBrain, { itemId: pd, alsoRemove: [], seen: preview.seen })).toEqual({
      ok: false,
      reason: BRAIN_COPY_CHANGED,
      changed: true,
    });
    const again = await admin.action(api.ingestion.previewBrainCopy, { itemId: pd, alsoRemove: [] });
    if (!again.ok) throw new Error("no preview");
    expect(again.industry).toBe("agriculture");
    expect(await admin.action(api.ingestion.addToBrain, { itemId: pd, alsoRemove: [], seen: again.seen })).toMatchObject({ ok: true });
  });

  it("never links a PD to a Brain source that holds a different copy of it", async () => {
    const { t, admin, adminId } = await setup();
    // A: the same bytes approved on the old page, stored unscrubbed.
    const pd = await waitingPd(t, admin);
    const bytes = (await item(t, pd)).contentHash;
    await t.run((ctx) =>
      importSource(
        ctx,
        { title: "Cedarline Systems FY2025 PD", industry: "manufacturing", writerTier: 0.5, docType: "pd", content: PD_TEXT, approve: true, importItem: { itemId: pd, contentHash: bytes } },
        adminId
      )
    );
    const preview = await admin.action(api.ingestion.previewBrainCopy, { itemId: pd, alsoRemove: [] });
    if (!preview.ok) throw new Error("no preview");
    expect(await admin.action(api.ingestion.addToBrain, { itemId: pd, alsoRemove: [], seen: preview.seen })).toEqual({ ok: false, reason: BRAIN_COPY_DIFFERS });
    expect(await item(t, pd)).toMatchObject({ brainCheck: "waiting" });
    expect((await item(t, pd)).brainSourceId).toBeUndefined();

    // B: two copies of one file; the first added with no Also remove words,
    // the second read with "sensor" hidden is not linked to the first.
    const { t: t2, admin: admin2 } = await setup();
    const one = await waitingPd(t2, admin2);
    const two = await stage(t2, `${FY}/Submitted/04 CedarlineSystems 2025-03-31 T2.DW.PN ColdChainSensorDrift copy.docx`, (await item(t2, one)).contentHash);
    await read(t2, two, PD_TEXT, { scienceCode: "2.02.09" });
    await approve(t2, admin2, [two]);
    const plain = await admin2.action(api.ingestion.previewBrainCopy, { itemId: one, alsoRemove: [] });
    if (!plain.ok) throw new Error("no preview");
    expect(await admin2.action(api.ingestion.addToBrain, { itemId: one, alsoRemove: [], seen: plain.seen })).toMatchObject({ ok: true, outcome: "added" });
    const hidden = await admin2.action(api.ingestion.previewBrainCopy, { itemId: two, alsoRemove: ["sensor"] });
    if (!hidden.ok) throw new Error("no preview");
    expect(await admin2.action(api.ingestion.addToBrain, { itemId: two, alsoRemove: ["sensor"], seen: hidden.seen })).toEqual({
      ok: false,
      reason: BRAIN_COPY_DIFFERS,
    });
    expect((await item(t2, two)).brainSourceId).toBeUndefined();
    expect(await t2.run((ctx) => ctx.db.query("brainSources").collect())).toHaveLength(1);
  });

  it("remembers every file it adds, so a later copy of those bytes read another way is refused as a different copy", async () => {
    const { t, admin } = await setup();
    const pd = await waitingPd(t, admin);
    const plain = await admin.action(api.ingestion.previewBrainCopy, { itemId: pd, alsoRemove: [] });
    if (!plain.ok) throw new Error("no preview");
    const added = await admin.action(api.ingestion.addToBrain, { itemId: pd, alsoRemove: [], seen: plain.seen });
    if (!added.ok) throw new Error("not added");
    // B: other bytes, the same text. It reuses the source by text, and its bytes are remembered.
    const b = await stage(t, `${FY}/Submitted/04 CedarlineSystems 2025-03-31 T2.DW.PN ColdChainSensorDrift B.docx`, "bytes-b");
    await read(t, b, PD_TEXT, { scienceCode: "2.02.09" });
    await approve(t, admin, [b]);
    const forB = await admin.action(api.ingestion.previewBrainCopy, { itemId: b, alsoRemove: [] });
    if (!forB.ok) throw new Error("no preview");
    expect(await admin.action(api.ingestion.addToBrain, { itemId: b, alsoRemove: [], seen: forB.seen })).toMatchObject({
      ok: true,
      outcome: "matched",
      sourceId: added.sourceId,
    });
    const links = await t.run((ctx) => ctx.db.query("brainSourceImportFiles").collect());
    expect(links.map((link) => [link.contentHash, link.sourceId, link.importItemId])).toEqual([
      [(await item(t, pd)).contentHash, added.sourceId, pd],
      ["bytes-b", added.sourceId, b],
    ]);
    // B again, read with "sensor" hidden: only B's remembered bytes find the source, which holds another copy.
    const bAgain = await stage(t, `${FY}/Submitted/04 CedarlineSystems 2025-03-31 T2.DW.PN ColdChainSensorDrift B copy.docx`, "bytes-b");
    await read(t, bAgain, PD_TEXT, { scienceCode: "2.02.09" });
    await approve(t, admin, [bAgain]);
    const hidden = await admin.action(api.ingestion.previewBrainCopy, { itemId: bAgain, alsoRemove: ["sensor"] });
    if (!hidden.ok) throw new Error("no preview");
    expect(await admin.action(api.ingestion.addToBrain, { itemId: bAgain, alsoRemove: ["sensor"], seen: hidden.seen })).toEqual({
      ok: false,
      reason: BRAIN_COPY_DIFFERS,
    });
    expect(await item(t, bAgain)).toMatchObject({ brainCheck: "waiting" });
    expect(await t.run((ctx) => ctx.db.query("brainSources").collect())).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.query("brainSourceImportFiles").collect())).toHaveLength(2);
  });

  it("never reuses an approved Brain source with the same text but other labels (Greptile, 2026-11-19)", async () => {
    const { t, admin } = await setup();
    const pd = await waitingPd(t, admin);
    const plain = await admin.action(api.ingestion.previewBrainCopy, { itemId: pd, alsoRemove: [] });
    if (!plain.ok) throw new Error("no preview");
    const added = await admin.action(api.ingestion.addToBrain, { itemId: pd, alsoRemove: [], seen: plain.seen });
    if (!added.ok) throw new Error("not added");
    // The approved source now holds other labels, as another company's PD
    // that scrubbed to the same text would.
    const before = (await t.run((ctx) => ctx.db.get(added.sourceId)))!;
    await t.run((ctx) => ctx.db.patch(added.sourceId, { industry: "finance", writerName: "Another Writer", writerTier: 0.9 }));
    const b = await stage(t, `${FY}/Submitted/04 CedarlineSystems 2025-03-31 T2.DW.PN ColdChainSensorDrift B.docx`, "bytes-b");
    await read(t, b, PD_TEXT, { scienceCode: "2.02.09" });
    await approve(t, admin, [b]);
    const forB = await admin.action(api.ingestion.previewBrainCopy, { itemId: b, alsoRemove: [] });
    if (!forB.ok) throw new Error("no preview");
    expect(forB.industry).toBe("manufacturing");
    expect(await admin.action(api.ingestion.addToBrain, { itemId: b, alsoRemove: [], seen: forB.seen })).toEqual({
      ok: false,
      reason: BRAIN_COPY_LABELS_DIFFER,
    });
    expect(await item(t, b)).toMatchObject({ brainCheck: "waiting" });
    expect((await item(t, b)).brainSourceId).toBeUndefined();
    expect(await t.run((ctx) => ctx.db.query("brainSourceImportFiles").collect())).toHaveLength(1);
    // With the labels back as read, it is reused.
    await t.run((ctx) => ctx.db.patch(added.sourceId, { industry: before.industry, writerName: before.writerName, writerTier: before.writerTier }));
    expect(await admin.action(api.ingestion.addToBrain, { itemId: b, alsoRemove: [], seen: forB.seen })).toMatchObject({
      ok: true,
      outcome: "matched",
      sourceId: added.sourceId,
    });
  });

  it("keeps a PD out of the Brain when the person says so, and remembers it", async () => {
    const { t, admin } = await setup();
    const pd = await waitingPd(t, admin);
    await admin.mutation(api.ingestion.keepOutOfBrain, { itemId: pd });
    expect(await item(t, pd)).toMatchObject({ brainCheck: "kept_out" });
    expect(await t.run((ctx) => ctx.db.query("brainSources").collect())).toEqual([]);
    expect(await companyFiles(t)).toHaveLength(1);
    expect((await admin.query(api.ingestion.brainCheckFiles, { paginationOpts: { numItems: 25, cursor: null } })).page).toEqual([]);
    expect(refusal(await admin.mutation(api.ingestion.keepOutOfBrain, { itemId: pd }).catch((e: unknown) => e))?.message).toBe(BRAIN_CHECK_GONE);
    await expectCountsMatchRecount(t);
  });

  it("refuses a copy that would still name the company, showing why and logging only the log reason", async () => {
    const { t, admin, adminId } = await setup();
    await t.run((ctx) =>
      ctx.db.insert("clients", { name: "Northern Equity Partners", nameKey: "northern equity partners", industry: "finance", status: "active", nameHistoryComplete: true, createdBy: adminId, createdAt: 1, updatedAt: 1 })
    );
    const text = "Field of science or technology: 2.02.09\nThe Northern ------- Equity ------- Partners team built a kiln.";
    const pd = await waitingPd(t, admin, text, "Northern Equity Partners/2024 - Dec 31/Submitted/03 NorthernEquityPartners 2024-12-31 S1.DW Kiln.docx");
    const preview = await admin.action(api.ingestion.previewBrainCopy, { itemId: pd, alsoRemove: [] });
    expect(preview).toMatchObject({ ok: false, code: "names_left" });
    if (preview.ok) throw new Error("not refused");
    expect(preview.reason).toContain("would still name the company");
    const added = await admin.action(api.ingestion.addToBrain, { itemId: pd, alsoRemove: [], seen: "anything" });
    expect(added.ok).toBe(false);
    const audit = await t.run((ctx) => ctx.db.query("brainAuditLog").collect());
    expect(audit).toMatchObject([{ action: "reject", reason: IMPORT_BRAIN_LEAK_LOG_REASON, actorId: adminId }]);
    expect(JSON.stringify(audit)).not.toMatch(/northern/i);
    expect(await t.run((ctx) => ctx.db.query("brainSources").collect())).toEqual([]);
    expect((await item(t, pd)).brainCheck).toBe("waiting");
  });

  it("reuses a pending match (approved with the approver's metadata) and an approved one, and refuses a revoked one in plain words", async () => {
    const { t, admin } = await setup();
    const pd = await waitingPd(t, admin);
    const preview = await admin.action(api.ingestion.previewBrainCopy, { itemId: pd, alsoRemove: [] });
    if (!preview.ok) throw new Error("no preview");
    // A pending nomination with the same scrubbed text.
    const pending = await admin.mutation(api.brain.importPdPair, { title: "Nominated", industry: "general", writerTier: 0.2, docType: "pd", content: preview.content });
    const added = await admin.action(api.ingestion.addToBrain, { itemId: pd, alsoRemove: [], seen: preview.seen });
    expect(added).toMatchObject({ ok: true, outcome: "matched", sourceId: pending });
    expect(await t.run((ctx) => ctx.db.get(pending))).toMatchObject({ status: "approved", industry: "manufacturing", title: "Past PD, FY2025", importItemId: pd });

    // The same bytes approved again in another file: the approved source is reused, by its bytes.
    const copy = await stage(t, `${FY}/Submitted/04 CedarlineSystems 2025-03-31 T2.DW.PN ColdChainSensorDrift copy.docx`, (await item(t, pd)).contentHash);
    await read(t, copy, PD_TEXT, { scienceCode: "2.02.09" });
    await approve(t, admin, [copy]);
    const again = await admin.action(api.ingestion.previewBrainCopy, { itemId: copy, alsoRemove: [] });
    if (!again.ok) throw new Error("no preview");
    expect(await admin.action(api.ingestion.addToBrain, { itemId: copy, alsoRemove: [], seen: again.seen })).toMatchObject({
      ok: true,
      outcome: "matched",
      sourceId: pending,
    });
    expect((await item(t, copy)).brainSourceId).toBe(pending);
    expect(await t.run((ctx) => ctx.db.query("brainSources").collect())).toHaveLength(1);

    // Revoked: a third copy is refused in plain words and stays in Brain check.
    await admin.mutation(api.brain.revokeSource, { sourceId: pending });
    const third = await stageRead(t, `${FY}/Submitted/04 CedarlineSystems 2025-03-31 T2.DW.PN ColdChainSensorDrift final.docx`, PD_TEXT, { scienceCode: "2.02.09" });
    await approve(t, admin, [third]);
    const last = await admin.action(api.ingestion.previewBrainCopy, { itemId: third, alsoRemove: [] });
    if (!last.ok) throw new Error("no preview");
    expect(await admin.action(api.ingestion.addToBrain, { itemId: third, alsoRemove: [], seen: last.seen })).toEqual({
      ok: false,
      reason: "This PD matches a Brain source an Admin removed from the Brain, so it cannot be approved here.",
    });
    expect(await item(t, third)).toMatchObject({ brainCheck: "waiting" });
    expect((await item(t, third)).brainSourceId).toBeUndefined();
    expect(await t.run((ctx) => ctx.db.query("brainSources").collect())).toHaveLength(1);
  });

  it("shows what each approved file became on the Approved tab", async () => {
    const { t, admin } = await setup();
    const added = await waitingPd(t, admin);
    const kept = await waitingPd(t, admin, `${PD_TEXT}\nAnother year.`, `${CEDARLINE}/2024 - Mar 31/Submitted/04 CedarlineSystems 2024-03-31 S1.DW Earlier.docx`);
    const waiting = await waitingPd(t, admin, `${PD_TEXT}\nYet another year.`, `${CEDARLINE}/2023 - Mar 31/Submitted/04 CedarlineSystems 2023-03-31 S1.DW Oldest.docx`);
    const draft = await stageRead(t, `${FY}/Drafts/Notes.docx`, "Draft text");
    await approve(t, admin, [draft]);
    const preview = await admin.action(api.ingestion.previewBrainCopy, { itemId: added, alsoRemove: [] });
    if (!preview.ok) throw new Error("no preview");
    await admin.action(api.ingestion.addToBrain, { itemId: added, alsoRemove: [], seen: preview.seen });
    await admin.mutation(api.ingestion.keepOutOfBrain, { itemId: kept });
    const list = async (category: "final_pd" | "draft") =>
      (
        await admin.query(api.ingestion.sheetFiles, {
          tab: "approved",
          companyKey: "cedarline systems",
          category,
          onlyToCheck: false,
          paginationOpts: { numItems: 10, cursor: null },
        })
      ).page;
    const pds = new Map((await list("final_pd")).map((row) => [row._id, row]));
    const page = { key: "cedarline systems", name: CEDARLINE };
    expect(pds.get(added)).toMatchObject({ companyPage: page, brain: "in_brain" });
    expect(pds.get(kept)).toMatchObject({ companyPage: page, brain: "kept_out" });
    expect(pds.get(waiting)).toMatchObject({ companyPage: page, brain: "brain_check" });
    const [draftRow] = await list("draft");
    expect(draftRow.companyPage).toEqual(page);
    expect(draftRow.brain).toBeUndefined();
    // A Brain copy removed on the Brain page since.
    await admin.mutation(api.brain.revokeSource, { sourceId: (await item(t, added)).brainSourceId! });
    expect((await list("final_pd")).find((row) => row._id === added)!.brain).toBe("removed");
    expect(await admin.query(api.ingestion.sheetFile, { id: added })).toMatchObject({ companyPage: page, brain: "removed" });
    // Removed for good since (the source and its card are gone, the file keeps its brainSourceId): still removed.
    const sourceId = (await item(t, added)).brainSourceId!;
    await t.mutation(internal.brain.removeSourcePermanently, { sourceId });
    expect(await t.run((ctx) => ctx.db.get(sourceId))).toBeNull();
    expect((await item(t, added)).brainSourceId).toBe(sourceId);
    expect((await list("final_pd")).find((row) => row._id === added)!.brain).toBe("removed");
    expect(await admin.query(api.ingestion.sheetFile, { id: added })).toMatchObject({ brain: "removed" });
  });
});

describe("the file view's text", () => {
  it("reads a file's whole text a page at a time, or its preview, or says it has none", async () => {
    const { t, admin } = await setup();
    const long = "word ".repeat(9_000); // 45,000 characters
    const id = await stageRead(t, `${FY}/Drafts/Long.docx`, long);
    const first = await admin.action(api.ingestion.sheetFileText, { id });
    expect(first).toMatchObject({ start: 0, end: FILE_TEXT_PAGE_CHARS, total: long.length, source: "full", cutAtImport: false });
    expect(first!.text).toBe(long.slice(0, FILE_TEXT_PAGE_CHARS));
    const last = await admin.action(api.ingestion.sheetFileText, { id, start: 40_000 });
    expect(last).toMatchObject({ start: 40_000, end: long.length });

    const preview = await stage(t, `${FY}/Drafts/Old.docx`);
    await t.mutation(internal.ingestion.markItemProcessed, {
      itemId: preview,
      storageId: await t.run((ctx) => ctx.storage.store(new Blob(["bytes"]))),
      text: "Only a preview",
    });
    expect(await admin.action(api.ingestion.sheetFileText, { id: preview })).toMatchObject({ text: "Only a preview", source: "preview" });
    const none = await stage(t, `${FY}/Drafts/Unread.docx`);
    expect(await admin.action(api.ingestion.sheetFileText, { id: none })).toMatchObject({ text: "", total: 0, source: "none" });
  });
});

describe("the old review page's Approve", () => {
  it("is switched off on the server in plain words; reject, delete and port to a project keep working", async () => {
    const { t, admin, writer } = await setup();
    const pd = await readyPd(t);
    const args = { itemId: pd, industry: "manufacturing", writerTier: 0.5 };
    expect(refusal(await admin.action(api.ingestion.approveItem, args).catch((e: unknown) => e))).toMatchObject({
      code: "INVALID_STATE",
      message: OLD_APPROVE_OFF,
    });
    await expect(writer.action(api.ingestion.approveItem, args)).rejects.toThrow(/Admin only/);
    expect((await item(t, pd)).status).toBe("pending_review");
    expect(await t.run((ctx) => ctx.db.query("brainSources").collect())).toEqual([]);

    // Port to a project, from a file approved on Import.
    await pickIndustry(admin);
    await approve(t, admin, [pd]);
    const ported = await admin.action(api.ingestionPort.portItemToProject, { itemId: pd });
    expect(ported.created).toBe(true);
    // Reject and delete still work on files not approved, and refuse an approved one.
    const other = await stageRead(t, `${FY}/Drafts/Notes.docx`, "Draft text");
    await admin.mutation(api.ingestion.rejectItem, { itemId: other });
    expect((await item(t, other)).status).toBe("rejected");
    await expect(admin.mutation(api.ingestion.rejectItem, { itemId: pd })).rejects.toThrow(
      "This file is already approved, so it cannot be rejected or deleted here."
    );
  });
});

describe("who may approve", () => {
  it("lets only Admins use every new function", async () => {
    const { t, admin, writer, manager } = await setup();
    const pd = await readyPd(t);
    await pickIndustry(admin);
    const approvalId = await approve(t, admin, [pd]);
    for (const user of [writer, manager]) {
      await expect(user.mutation(api.ingestion.approveCompanyReady, { companyKey: "cedarline systems" })).rejects.toThrow(/Admin only/);
      await expect(user.mutation(api.ingestion.approveFiles, { ids: [pd] })).rejects.toThrow(/Admin only/);
      await expect(user.mutation(api.ingestion.dismissApproval, { approvalId })).rejects.toThrow(/Admin only/);
      await expect(user.mutation(api.ingestion.keepOutOfBrain, { itemId: pd })).rejects.toThrow(/Admin only/);
      await expect(user.action(api.ingestion.previewBrainCopy, { itemId: pd, alsoRemove: [] })).rejects.toThrow(/Admin only/);
      await expect(user.action(api.ingestion.addToBrain, { itemId: pd, alsoRemove: [], seen: "x" })).rejects.toThrow(/Admin only/);
      await expect(user.action(api.ingestion.sheetFileText, { id: pd })).rejects.toThrow(/Admin only/);
      expect(await user.query(api.ingestion.approvalProgress, {})).toEqual([]);
      expect(await user.query(api.ingestion.approvalRefusals, { approvalId })).toEqual({ files: [], more: false });
      expect((await user.query(api.ingestion.brainCheckFiles, { paginationOpts: { numItems: 5, cursor: null } })).page).toEqual([]);
    }
    const anonymous = t;
    await expect(anonymous.mutation(api.ingestion.approveFiles, { ids: [pd] })).rejects.toThrow(/Not authenticated/);
    expect((await item(t, pd)).brainCheck).toBe("waiting");
  });

  it("bounds the Also remove box", async () => {
    const { t, admin } = await setup();
    const pd = await readyPd(t);
    await pickIndustry(admin);
    await approve(t, admin, [pd]);
    const many = Array.from({ length: 31 }, (_, i) => `word${i}`);
    expect(refusal(await admin.action(api.ingestion.previewBrainCopy, { itemId: pd, alsoRemove: many }).catch((e: unknown) => e))?.message).toBe(
      "Add up to 30 words to Also remove."
    );
    expect(
      refusal(await admin.action(api.ingestion.previewBrainCopy, { itemId: pd, alsoRemove: ["x".repeat(81)] }).catch((e: unknown) => e))?.message
    ).toBe("Each Also remove entry can be at most 80 characters.");
  });
});
