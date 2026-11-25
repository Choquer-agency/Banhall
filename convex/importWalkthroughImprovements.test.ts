/// <reference types="vite/client" />
/**
 * Integration coverage for the 2026-11-23 walkthrough improvements:
 * 1. Full PD filename, W version stage, 3-4 positional initials groups,
 *    lowercase in-progress reviewer flag, 2-digit PD numbers up to 99,
 *    and submitted S0/S1 PDFs under Submitted folders.
 * 2. Admin-only writer weight privacy (omitted for Managers on Team).
 * 3. Role-based default weights (technical_manager 0.8, technical_writer 0.5,
 *    junior_technical_writer 0.2, financial 0.7), custom override precedence,
 *    and pre-entered non-login staff matching initials automatically.
 * 4. Initials role-reassignment (reassignFileInitials) preserved across re-reads.
 * 5. Canonical client matching suggestions, confirmNewCompanyDistinct, and
 *    snapBandToCompany without auto-merging.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { Workpool } from "@convex-dev/workpool";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { classify } from "./lib/ingestionClassify";
import { importSource } from "./brain";
import schema from "./schema";
import workpoolSchema from "../node_modules/@convex-dev/workpool/src/component/schema.js";

const modules = import.meta.glob("./**/*.ts");
const workpoolModules = import.meta.glob("../node_modules/@convex-dev/workpool/src/component/**/*.ts");
type T = ReturnType<typeof convexTest<typeof schema.tables>>;
type Admin = ReturnType<T["withIdentity"]>;

let enqueue: MockInstance;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("VOYAGE_API_KEY", "test-voyage-key");
  vi.stubGlobal("fetch", vi.fn(async () => {
    throw new Error("No network in these tests");
  }));
  enqueue = vi.spyOn(Workpool.prototype, "enqueueAction").mockResolvedValue("work-1" as never);
});

afterEach(() => {
  enqueue.mockRestore();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function setup() {
  const t = convexTest(schema, modules);
  t.registerComponent("embedPool", workpoolSchema, workpoolModules);
  const ids = await t.run(async (ctx) => ({
    adminId: await ctx.db.insert("users", { authId: "walk-admin", role: "admin", isOwner: true, firstName: "Jordan", lastName: "Ellis", initials: "JE" }),
    devAdminId: await ctx.db.insert("users", { authId: "walk-dev", role: "admin", isDeveloper: true, firstName: "Casey", lastName: "Cho", initials: "CC" }),
    plainAdminId: await ctx.db.insert("users", { authId: "walk-plain-admin", role: "admin", firstName: "Alex", lastName: "Mercer", initials: "AM" }),
    managerId: await ctx.db.insert("users", { authId: "walk-manager", role: "manager", firstName: "Morgan", lastName: "Reid", initials: "MR" }),
    writerId: await ctx.db.insert("users", { authId: "walk-writer", role: "writer", firstName: "Tracy", lastName: "Lindqvist", initials: "TL" }),
    reviewerId: await ctx.db.insert("users", { authId: "walk-reviewer", role: "writer", firstName: "Priya", lastName: "Nair", initials: "PN" }),
  }));
  return {
    t,
    ...ids,
    admin: t.withIdentity({ subject: "walk-admin" }),
    devAdmin: t.withIdentity({ subject: "walk-dev" }),
    plainAdmin: t.withIdentity({ subject: "walk-plain-admin" }),
    manager: t.withIdentity({ subject: "walk-manager" }),
    writer: t.withIdentity({ subject: "walk-writer" }),
  };
}

async function stageFile(t: T, path: string, extraText = "Field of science or technology: 2.02.09"): Promise<Id<"ingestionItems">> {
  const segments = path.split("/");
  const name = segments.pop()!;
  const meta = classify(segments.join("/"), name);
  const driveItemId = `drive-${path}`;
  await t.mutation(internal.ingestion.upsertDiscoveredItem, {
    driveItemId,
    path,
    name,
    clientName: meta.clientName,
    fiscalYearLabel: meta.fiscalYearLabel,
    fiscalYear: meta.fiscalYear,
    docKind: meta.docKind,
    size: 4096,
    lastModifiedAt: 1_700_000_000_000,
    contentHash: `bytes-${path}`,
    pairGroupKey: meta.pairGroupKey,
  });
  const row = await t.run((ctx) =>
    ctx.db.query("ingestionItems").withIndex("by_driveItemId", (q) => q.eq("driveItemId", driveItemId)).unique()
  );
  const text = `Cold chain telemetry engineering write-up.\n${extraText}\nDetailed experimental work across six weeks.`;
  const { storageId, textStorageId } = await t.run(async (ctx) => ({
    storageId: await ctx.storage.store(new Blob(["file-bytes"])),
    textStorageId: await ctx.storage.store(new Blob([text], { type: "text/plain" })),
  }));
  await t.mutation(internal.ingestion.markItemProcessed, {
    itemId: row!._id,
    storageId,
    text,
    textStorageId,
    documentScienceCode: "2.02.09",
  });
  return row!._id;
}

async function addToBrainForTest(t: T, admin: Admin, id: Id<"ingestionItems">, companyKey = "cedarline systems") {
  const known = await t.run((ctx) => ctx.db.query("clients").withIndex("by_nameKey", (q) => q.eq("nameKey", companyKey)).first());
  if (!known) await admin.mutation(api.ingestion.setNewCompanyIndustry, { companyKey, industry: "manufacturing" });
  await admin.mutation(api.ingestion.approveFiles, { ids: [id] });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const preview = await admin.action(api.ingestion.previewBrainCopy, { itemId: id, alsoRemove: [] });
  if (!preview.ok) throw new Error(`preview failed: ${preview.reason}`);
  const added = await admin.action(api.ingestion.addToBrain, { itemId: id, alsoRemove: [], seen: preview.seen });
  if (!added.ok) throw new Error(`addToBrain failed: ${added.reason}`);
  return added.sourceId;
}

describe("2026-11-23 walkthrough improvements", () => {
  it("classifies submitted S0/S1 PDFs as final_pd, unpacks 4 initials groups with lowercase reviewer cue, and sorts W before R/T/S", async () => {
    const { t } = await setup();
    const submittedPdf = await stageFile(
      t,
      "Cedarline Systems/2025 - Mar 31/Submitted/25 CedarlineSystems 2025-03-31 S0.TL.pn.CK.FR ColdChain.pdf"
    );
    const wipDocx = await stageFile(
      t,
      "Cedarline Systems/2025 - Mar 31/WIP/25 CedarlineSystems 2025-03-31 W0.TL ColdChain.docx"
    );
    const reviewDocx = await stageFile(
      t,
      "Cedarline Systems/2025 - Mar 31/Drafts/25 CedarlineSystems 2025-03-31 R1.TL.PN ColdChain.docx"
    );
    const nonSubmittedPdf = await stageFile(
      t,
      "Cedarline Systems/2025 - Mar 31/Submitted/CRA-Receipt.pdf"
    );

    const [pdfRow, wipRow, reviewRow, receiptRow] = await t.run(async (ctx) => [
      (await ctx.db.get(submittedPdf))!,
      (await ctx.db.get(wipDocx))!,
      (await ctx.db.get(reviewDocx))!,
      (await ctx.db.get(nonSubmittedPdf))!,
    ]);

    expect(pdfRow).toMatchObject({
      docKind: "pd",
      category: "final_pd",
      pdNumber: "25",
      versionCode: "S",
      versionNumber: 0,
      writerInitials: "TL",
      reviewerInitials: "PN",
      reviewerInProgress: true,
      clientInitials: "CK",
      financialInitials: "FR",
      initialsGroups: ["TL", "PN", "CK", "FR"],
    });
    expect(wipRow).toMatchObject({
      category: "draft",
      pdNumber: "25",
      versionCode: "W",
      versionNumber: 0,
    });
    expect(reviewRow.versionCode).toBe("R");
    // W sorts before R, and R sorts before S.
    expect(wipRow.sortKey!.localeCompare(reviewRow.sortKey!)).toBeLessThan(0);
    expect(reviewRow.sortKey!.localeCompare(pdfRow.sortKey!)).toBeLessThan(0);
    // Non-S0/S1 PDF in Submitted stays a supporting file, not final_pd.
    expect(receiptRow.docKind).toBe("supporting");
    expect(receiptRow.category).not.toBe("final_pd");
  });

  it("restricts writer weights to Owner and Developer Admins on Team and Brain while hiding them from plain Admins and Managers", async () => {
    const { t, admin, devAdmin, plainAdmin, manager, writerId } = await setup();
    await admin.mutation(api.users.setWriterWeight, { userId: writerId, weight: 0.9 });
    const created = await devAdmin.mutation(api.users.createPastWriter, {
      name: "Sam Okafor",
      initials: "SO",
      staffRole: "technical_manager",
      isActive: true,
      weight: 0.85,
    });

    // Plain Admin cannot set weights directly or via createPastWriter, but can still create a past writer without weight.
    await expect(
      plainAdmin.mutation(api.users.setWriterWeight, { userId: writerId, weight: 0.5 })
    ).rejects.toThrow();
    await expect(
      plainAdmin.mutation(api.users.createPastWriter, {
        name: "Blocked Weighted",
        initials: "BW",
        weight: 0.6,
      })
    ).rejects.toThrow();
    const unweighted = await plainAdmin.mutation(api.users.createPastWriter, {
      name: "Robin Brooks",
      initials: "RB",
      staffRole: "technical_writer",
      isActive: true,
    });
    expect(unweighted.label).toBe("Robin Brooks");

    // Owner and Developer both receive weight on Team; plain Admin and Manager do not.
    for (const allowed of [admin, devAdmin]) {
      const members = await allowed.query(api.team.listMembers, {});
      expect(members.find((m) => m._id === writerId)?.weight).toBe(0.9);
      const past = await allowed.query(api.users.listPastWriters, {});
      expect(past.find((w) => w._id === created.writerId)).toMatchObject({
        weight: 0.85,
        staffRole: "technical_manager",
        isActive: true,
      });
    }
    for (const restricted of [plainAdmin, manager]) {
      const members = await restricted.query(api.team.listMembers, {});
      for (const member of members) expect("weight" in member).toBe(false);
      const past = await restricted.query(api.users.listPastWriters, {});
      for (const row of past) expect("weight" in row).toBe(false);
    }

    // Brain scoring visibility & reweightSource follow the same Owner/Developer rule.
    const pdId = await stageFile(
      t,
      "Cedarline Systems/2025 - Mar 31/To be submitted/02 CedarlineSystems 2025-03-31 T1.SO.PN ColdChain.docx"
    );
    const sourceId = await addToBrainForTest(t, admin, pdId);
    await devAdmin.mutation(api.brain.reweightSource, { sourceId, writerTier: 0.92 });
    await expect(
      plainAdmin.mutation(api.brain.reweightSource, { sourceId, writerTier: 0.3 })
    ).rejects.toThrow();

    const ownerSources = await admin.query(api.brain.listBrainSources, {
      paginationOpts: { numItems: 10, cursor: null },
    });
    const plainAdminSources = await plainAdmin.query(api.brain.listBrainSources, {
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(ownerSources.page.find((s) => s._id === sourceId)?.writerTier).toBe(0.92);
    expect("writerTier" in (plainAdminSources.page.find((s) => s._id === sourceId) ?? {})).toBe(false);

    const ownerSource = await admin.query(api.brain.getBrainSource, { sourceId });
    const plainAdminSource = await plainAdmin.query(api.brain.getBrainSource, { sourceId });
    expect(ownerSource?.writerTier).toBe(0.92);
    expect("writerTier" in (plainAdminSource ?? {})).toBe(false);

    const ownerAudit = await admin.query(api.brain.listBrainAudit, {});
    const plainAdminAudit = await plainAdmin.query(api.brain.listBrainAudit, {});
    expect(ownerAudit?.some((a) => a.action === "reweight")).toBe(true);
    expect(plainAdminAudit?.some((a) => a.action === "reweight")).toBe(false);
  });

  it("applies role-based default weights with custom override precedence, re-tiers Brain copies, and auto-matches pre-entered staff", async () => {
    const { t, admin } = await setup();
    // Pre-enter a non-login current writer before any file is uploaded.
    const { writerId } = await admin.mutation(api.users.createPastWriter, {
      name: "Sam Okafor",
      initials: "SO",
      staffRole: "junior_technical_writer",
      isActive: true,
    });

    const pdId = await stageFile(
      t,
      "Cedarline Systems/2025 - Mar 31/To be submitted/01 CedarlineSystems 2025-03-31 T1.SO.PN ColdChain.docx"
    );
    const staged = await t.run((ctx) => ctx.db.get(pdId));
    expect(staged?.writerId).toBe(writerId);
    expect(staged?.writerName).toBe("Sam Okafor");

    // Junior technical writer defaults to 0.2 in the Brain.
    const brainId = await addToBrainForTest(t, admin, pdId);
    const sourceAfterJunior = await t.run((ctx) => ctx.db.get(brainId));
    expect(sourceAfterJunior?.writerTier).toBe(0.2);

    // Promoting staffRole to technical_manager re-tiers existing Brain copy to 0.8.
    await admin.mutation(api.users.setWriterStaffRole, { writerId, staffRole: "technical_manager" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const sourceAfterManager = await t.run((ctx) => ctx.db.get(brainId));
    expect(sourceAfterManager?.writerTier).toBe(0.8);

    // Explicit custom weight (0.95) overrides staffRole default.
    await admin.mutation(api.users.setWriterWeight, { writerId, weight: 0.95 });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await t.run((ctx) => ctx.db.get(brainId)))?.writerTier).toBe(0.95);

    // Changing staffRole while a custom weight exists keeps the custom override (0.95).
    await admin.mutation(api.users.updatePastWriter, { writerId, staffRole: "technical_writer", isActive: false });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await t.run((ctx) => ctx.db.get(brainId)))?.writerTier).toBe(0.95);

    // Clearing the custom weight falls back to technical_writer (0.5).
    await admin.mutation(api.users.setWriterWeight, { writerId, weight: null });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await t.run((ctx) => ctx.db.get(brainId)))?.writerTier).toBe(0.5);

    // Financial staff role falls back to global default (0.7).
    await admin.mutation(api.users.setWriterStaffRole, { writerId, staffRole: "financial" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await t.run((ctx) => ctx.db.get(brainId)))?.writerTier).toBe(0.7);
    expect(importSource).toBeDefined();
  });

  it("reassigns initials slots on an Import file, re-resolves writer/reviewer, and preserves manual slots on re-read", async () => {
    const { t, admin } = await setup();
    const path = "Cedarline Systems/2025 - Mar 31/To be submitted/04 CedarlineSystems 2025-03-31 T1.TL.pn.CK ColdChain.docx";
    const id = await stageFile(t, path);

    const before = (await t.run((ctx) => ctx.db.get(id)))!;
    expect(before.writerInitials).toBe("TL");
    expect(before.reviewerInitials).toBe("PN");
    expect(before.reviewerInProgress).toBe(true);
    expect(before.clientInitials).toBe("CK");

    // Reassign: PN becomes writer, TL becomes reviewer, CK stays client, FR becomes financial.
    const res = await admin.mutation(api.ingestion.reassignFileInitials, {
      id,
      writerInitials: "PN",
      reviewerInitials: "TL",
      clientInitials: "CK",
      financialInitials: "FR",
      reviewerInProgress: false,
    });
    expect(res.changed).toBe(true);

    const after = (await t.run((ctx) => ctx.db.get(id)))!;
    expect(after).toMatchObject({
      writerInitials: "PN",
      writerName: "Priya Nair",
      reviewerInitials: "TL",
      clientInitials: "CK",
      financialInitials: "FR",
    });
    expect(after.reviewerInProgress).toBeUndefined();
    expect(after.editedLabels).toContain("initialsSlots");

    const sheet = await admin.query(api.ingestion.sheetFiles, {
      tab: "review",
      companyKey: "cedarline systems",
      category: "final_pd",
      onlyToCheck: false,
      paginationOpts: { numItems: 10, cursor: null },
    });
    const sheetRow = sheet.page.find((row) => row._id === id);
    expect(sheetRow).toMatchObject({
      writerName: "Priya Nair",
      reviewerName: "Tracy Lindqvist",
      clientInitials: "CK",
      financialInitials: "FR",
    });
    expect(sheetRow?.reviewerInProgress).toBeUndefined();

    // Re-running upsertDiscoveredItem (e.g. from a sync re-read) preserves the manual slots.
    const meta = classify("Cedarline Systems/2025 - Mar 31/To be submitted", "04 CedarlineSystems 2025-03-31 T1.TL.pn.CK ColdChain.docx");
    await t.mutation(internal.ingestion.upsertDiscoveredItem, {
      driveItemId: `drive-${path}`,
      path,
      name: "04 CedarlineSystems 2025-03-31 T1.TL.pn.CK ColdChain.docx",
      clientName: meta.clientName,
      fiscalYearLabel: meta.fiscalYearLabel,
      fiscalYear: meta.fiscalYear,
      docKind: meta.docKind,
      size: 4096,
      lastModifiedAt: 1_700_000_001_000,
      contentHash: `bytes-${path}`,
      pairGroupKey: meta.pairGroupKey,
    });
    const afterSync = (await t.run((ctx) => ctx.db.get(id)))!;
    expect(afterSync.writerInitials).toBe("PN");
    expect(afterSync.reviewerInitials).toBe("TL");
    expect(afterSync.financialInitials).toBe("FR");
  });

  it("suggests close canonical clients without auto-merging, supports confirm distinct, and snaps a band to an existing client", async () => {
    const { t, admin, adminId } = await setup();
    const existingClientId = await t.run((ctx) =>
      ctx.db.insert("clients", {
        name: "Acme Robotics Inc.",
        nameKey: "acme robotics inc.",
        industry: "manufacturing",
        status: "active",
        createdBy: adminId,
        createdAt: 1,
        updatedAt: 1,
      })
    );

    const fileA = await stageFile(
      t,
      "Acme Robotics/2025 - Mar 31/To be submitted/01 AcmeRobotics 2025-03-31 T1.TL ActuatorControl.docx"
    );
    const fileB = await stageFile(
      t,
      "Acme Robotics/2025 - Mar 31/Drafts/02 AcmeRobotics 2025-03-31 R1.TL SensorFusion.docx"
    );

    const listBands = async () =>
      (await admin.query(api.ingestion.sheetCompanies, {
        tab: "review",
        onlyToCheck: false,
        paginationOpts: { numItems: 20, cursor: null },
      })).page;

    // Band stays new ("acme robotics"), never auto-merged, with "Acme Robotics Inc." suggested.
    const bandsBefore = await listBands();
    const acmeBand = bandsBefore.find((b) => b.companyKey === "acme robotics")!;
    expect(acmeBand.isNew).toBe(true);
    expect(acmeBand.confirmedDistinct).toBeUndefined();
    expect(acmeBand.suggestedCompanies).toEqual([
      { id: existingClientId, name: "Acme Robotics Inc.", companyKey: "acme robotics inc." },
    ]);

    // Admin can explicitly confirm it is a distinct company.
    await admin.mutation(api.ingestion.confirmNewCompanyDistinct, { companyKey: "acme robotics", distinct: true });
    const bandsDistinct = await listBands();
    expect(bandsDistinct.find((b) => b.companyKey === "acme robotics")?.confirmedDistinct).toBe(true);

    // And Admin can still snap the band's files to the canonical existing client.
    const snapped = await admin.mutation(api.ingestion.snapBandToCompany, {
      fromCompanyKey: "acme robotics",
      targetClientId: existingClientId,
    });
    expect(snapped).toEqual({ moved: 2, hasMore: false, targetName: "Acme Robotics Inc." });

    const [movedA, movedB] = await t.run(async (ctx) => [
      (await ctx.db.get(fileA))!,
      (await ctx.db.get(fileB))!,
    ]);
    expect(movedA.companyKey).toBe("acme robotics inc.");
    expect(movedB.companyKey).toBe("acme robotics inc.");
    expect(movedA.editedLabels).toContain("company");

    const bandsAfter = await listBands();
    expect(bandsAfter.find((b) => b.companyKey === "acme robotics")).toBeUndefined();
    expect(bandsAfter.find((b) => b.companyKey === "acme robotics inc.")?.total).toBe(2);
  });

  it("supports 5-6 filename initials groups, coWriterInitials, and extraClientInitials preserved across re-sync", async () => {
    const { t, admin } = await setup();
    const path =
      "Cedarline Systems/2025 - Mar 31/To be submitted/05 CedarlineSystems 2025-03-31 T1.TL.PN.BM.JT.FR SensorArray.docx";
    const id = await stageFile(t, path);

    const initial = await admin.query(api.ingestion.sheetFile, { id });
    expect(initial?.initialsGroups).toEqual(["TL", "PN", "BM", "JT", "FR"]);
    expect(initial?.writerInitials).toBe("TL");
    expect(initial?.reviewerInitials).toBe("PN");
    expect(initial?.clientInitials).toBe("BM");
    expect(initial?.financialInitials).toBe("JT");

    // Admin assigns co-writer AL, splits clients BM + JT, and puts FR into financial.
    await admin.mutation(api.ingestion.reassignFileInitials, {
      id,
      writerInitials: "TL",
      reviewerInitials: "PN",
      clientInitials: "BM",
      financialInitials: "FR",
      coWriterInitials: ["AL", "TL", "al"], // deduped & excludes primary TL
      extraClientInitials: ["JT", "BM"], // deduped & excludes primary BM
    });

    const updated = await admin.query(api.ingestion.sheetFile, { id });
    expect(updated).toMatchObject({
      writerInitials: "TL",
      writerName: "Tracy Lindqvist",
      reviewerInitials: "PN",
      reviewerName: "Priya Nair",
      clientInitials: "BM",
      financialInitials: "FR",
      coWriterInitials: ["AL"],
      extraClientInitials: ["JT"],
      initialsGroups: ["TL", "AL", "PN", "BM", "JT", "FR"],
    });

    // Re-syncing the same path preserves coWriterInitials, extraClientInitials, and initialsGroups.
    const meta = classify(
      "Cedarline Systems/2025 - Mar 31/To be submitted",
      "05 CedarlineSystems 2025-03-31 T1.TL.PN.BM.JT.FR SensorArray.docx"
    );
    await t.mutation(internal.ingestion.upsertDiscoveredItem, {
      driveItemId: `drive-${path}`,
      path,
      name: "05 CedarlineSystems 2025-03-31 T1.TL.PN.BM.JT.FR SensorArray.docx",
      clientName: meta.clientName,
      fiscalYearLabel: meta.fiscalYearLabel,
      fiscalYear: meta.fiscalYear,
      docKind: meta.docKind,
      size: 4096,
      lastModifiedAt: 1_700_000_002_000,
      contentHash: `bytes-${path}`,
      pairGroupKey: meta.pairGroupKey,
    });
    const afterSync = await admin.query(api.ingestion.sheetFile, { id });
    expect(afterSync?.coWriterInitials).toEqual(["AL"]);
    expect(afterSync?.extraClientInitials).toEqual(["JT"]);
    expect(afterSync?.initialsGroups).toEqual(["TL", "AL", "PN", "BM", "JT", "FR"]);
  });

  it("extracts, backfills, resets, and PII-scrubs CRA Section C client contact names", async () => {
    const { t, admin } = await setup();
    const sectionCText = [
      "Field of science or technology: 2.02.09",
      "Technical narrative discussing work with Samira Haddad and Bill Mercer on thermal drift.",
      "Section C - Additional project information",
      "254",
      "Name",
      "Dr. Samira Haddad, Ph.D.",
      "260",
      "Names",
      "261",
      "Qualifications/experience",
      'William "Bill" Mercer',
      "VP Engineering, 15 years industrial controls experience",
      "265",
      "Was any work performed outside Canada? No",
    ].join("\n");
    const path =
      "Cedarline Systems/2025 - Mar 31/To be submitted/06 CedarlineSystems 2025-03-31 T1.TL.PN.SH ColdChain.docx";
    const id = await stageFile(t, path, sectionCText);

    // Backfill populates documentClientNames on pre-existing PD rows (zero LLM).
    const backfill = await t.action(internal.ingestion.backfillDocumentClientNames, {});
    expect(backfill.recorded).toBe(1);

    const fileAfterBackfill = await admin.query(api.ingestion.sheetFile, { id });
    expect(fileAfterBackfill?.documentClientNames).toEqual([
      { name: "Samira Haddad", source: "section_c" },
      { name: 'William "Bill" Mercer', source: "section_c" },
    ]);

    // Previewing Brain copy scrubs Section C contacts (including nickname form).
    await admin.mutation(api.ingestion.setNewCompanyIndustry, {
      companyKey: "cedarline systems",
      industry: "manufacturing",
    });
    await admin.mutation(api.ingestion.approveFiles, { ids: [id] });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const preview = await admin.action(api.ingestion.previewBrainCopy, { itemId: id, alsoRemove: [] });
    expect(preview.ok).toBe(true);
    if (preview.ok) {
      expect(preview.content).not.toContain("Samira");
      expect(preview.content).not.toContain("Haddad");
      expect(preview.content).not.toContain("Mercer");
      expect(preview.content).not.toContain("Bill");
    }

    // Content change on a staged file resets documentClientNames.
    const path2 =
      "Cedarline Systems/2025 - Mar 31/To be submitted/07 CedarlineSystems 2025-03-31 T1.TL.PN.SH ResetCase.docx";
    const id2 = await stageFile(t, path2, sectionCText);
    await t.mutation(internal.ingestion.recordDocumentClientNames, {
      entries: [
        {
          itemId: id2,
          textStorageId: (await t.run((ctx) => ctx.db.get(id2)))!.textStorageId ?? null,
          contacts: [{ name: "Samira Haddad", source: "section_c" }],
        },
      ],
    });
    expect((await t.run((ctx) => ctx.db.get(id2)))?.documentClientNames).toHaveLength(1);
    const meta2 = classify(
      "Cedarline Systems/2025 - Mar 31/To be submitted",
      "07 CedarlineSystems 2025-03-31 T1.TL.PN.SH ResetCase.docx"
    );
    await t.mutation(internal.ingestion.upsertDiscoveredItem, {
      driveItemId: `drive-${path2}`,
      path: path2,
      name: "07 CedarlineSystems 2025-03-31 T1.TL.PN.SH ResetCase.docx",
      clientName: meta2.clientName,
      fiscalYearLabel: meta2.fiscalYearLabel,
      fiscalYear: meta2.fiscalYear,
      docKind: meta2.docKind,
      size: 4096,
      lastModifiedAt: 1_700_000_003_000,
      contentHash: "new-bytes-hash",
      pairGroupKey: meta2.pairGroupKey,
    });
    expect((await t.run((ctx) => ctx.db.get(id2)))?.documentClientNames).toBeUndefined();
  });

  it("preserves unassigned 5th/6th filename groups when editing another slot until assigned or explicitly dropped", async () => {
    const { t, admin } = await setup();
    const path =
      "Cedarline Systems/2025 - Mar 31/To be submitted/08 CedarlineSystems 2025-03-31 T1.TL.PN.BM.JT.FR KeepExtra.docx";
    const id = await stageFile(t, path);

    // Initial parse puts TL, PN, BM, JT in the 4 slots and leaves FR unassigned in initialsGroups.
    expect((await admin.query(api.ingestion.sheetFile, { id }))?.initialsGroups).toEqual([
      "TL",
      "PN",
      "BM",
      "JT",
      "FR",
    ]);

    // Editing only clientInitials preserves the unassigned FR group.
    await admin.mutation(api.ingestion.reassignFileInitials, {
      id,
      clientInitials: "XX",
    });
    expect((await admin.query(api.ingestion.sheetFile, { id }))?.initialsGroups).toEqual([
      "TL",
      "PN",
      "XX",
      "JT",
      "FR",
    ]);

    // Explicitly dropping FR removes it from initialsGroups.
    await admin.mutation(api.ingestion.reassignFileInitials, {
      id,
      dropUnassignedInitials: ["FR"],
    });
    expect((await admin.query(api.ingestion.sheetFile, { id }))?.initialsGroups).toEqual([
      "TL",
      "PN",
      "XX",
      "JT",
    ]);
  });

  it("leaves failed storage reads unpopulated during Section C backfill so a later run retries and succeeds", async () => {
    const { t, admin } = await setup();
    const sectionCText = [
      "Section C - Additional project information",
      "254",
      "Name",
      "Samira Haddad",
      "265",
      "No",
    ].join("\n");
    const path =
      "Cedarline Systems/2025 - Mar 31/To be submitted/09 CedarlineSystems 2025-03-31 T1.TL.PN.SH RetryRead.docx";
    const id = await stageFile(t, path, sectionCText);

    const originalText = Blob.prototype.text;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const textSpy = vi.spyOn(Blob.prototype, "text").mockRejectedValueOnce(new Error("transient storage failure"));
    try {
      const firstRun = await t.action(internal.ingestion.backfillDocumentClientNames, {});
      expect(firstRun.recorded).toBe(0);
      expect((await t.run((ctx) => ctx.db.get(id)))?.documentClientNames).toBeUndefined();
    } finally {
      textSpy.mockImplementation(originalText);
      textSpy.mockRestore();
      warnSpy.mockRestore();
    }

    // Retrying now reads the stored blob cleanly and populates Section C contacts.
    const secondRun = await t.action(internal.ingestion.backfillDocumentClientNames, {});
    expect(secondRun.recorded).toBe(1);
    expect((await admin.query(api.ingestion.sheetFile, { id }))?.documentClientNames).toEqual([
      { name: "Samira Haddad", source: "section_c" },
    ]);
  });
});
