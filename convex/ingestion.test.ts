/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { classify, labelsForItemPath } from "./lib/ingestionClassify";
import { docKindForCategory } from "./lib/ingestionSheet";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// Writes that move a row between pair groups schedule pairing for the group
// it left; fake timers keep that from running on its own mid-test.
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

async function setup() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      authId: "ingestion-admin",
      role: "admin",
      firstName: "Admin",
    });
    await ctx.db.insert("users", {
      authId: "ingestion-writer",
      role: "writer",
      firstName: "Writer",
    });
  });
  return {
    t,
    admin: t.withIdentity({ subject: "ingestion-admin" }),
    writer: t.withIdentity({ subject: "ingestion-writer" }),
  };
}

async function insertPendingItem(t: ReturnType<typeof convexTest>) {
  return await t.run((ctx) =>
    ctx.db.insert("ingestionItems", {
      driveItemId: `drive-${crypto.randomUUID()}`,
      path: "Acme/2025 - Dec 31/WIP/Technical/Audio/interview.txt",
      name: "interview.txt",
      clientName: "Acme",
      fiscalYearLabel: "2025 - Dec 31",
      fiscalYear: 2025,
      docKind: "transcript",
      size: 1024,
      lastModifiedAt: Date.now(),
      contentHash: crypto.randomUUID(),
      text: "Interview transcript",
      status: "pending_review",
      pairGroupKey: "Acme::2025 - Dec 31",
      pairStatus: "missing_pd",
      updatedAt: Date.now(),
    })
  );
}

describe("OneDrive ingestion queue deletion", () => {
  it("soft-deletes a staged item and restores its exact queue state", async () => {
    const f = await setup();
    const itemId = await insertPendingItem(f.t);

    await expect(
      f.admin.mutation(api.ingestion.removeItem, { itemId })
    ).resolves.toBeNull();

    const deleted = await f.t.run((ctx) => ctx.db.get(itemId));
    expect(deleted).toMatchObject({
      status: "deleted",
      deletedFromStatus: "pending_review",
      deletedBy: expect.any(String),
      deletedAt: expect.any(Number),
    });
    expect(deleted?.pairStatus).toBeUndefined();
    await expect(
      f.admin.query(api.ingestion.listItems, { status: "deleted" })
    ).resolves.toHaveLength(1);

    await expect(
      f.admin.mutation(api.ingestion.restoreItem, { itemId })
    ).resolves.toBeNull();

    const restored = await f.t.run((ctx) => ctx.db.get(itemId));
    expect(restored).toMatchObject({
      status: "pending_review",
      pairStatus: "missing_pd",
    });
    expect(restored?.deletedAt).toBeUndefined();
    expect(restored?.deletedBy).toBeUndefined();
    expect(restored?.deletedFromStatus).toBeUndefined();
  });

  it("keeps deletion admin-only and refuses approved Brain sources", async () => {
    const f = await setup();
    const itemId = await insertPendingItem(f.t);

    await expect(
      f.writer.mutation(api.ingestion.removeItem, { itemId })
    ).rejects.toThrow(/admin only/i);

    await f.t.run((ctx) => ctx.db.patch(itemId, { status: "approved" }));
    await expect(
      f.admin.mutation(api.ingestion.removeItem, { itemId })
    ).rejects.toThrow("This file is already approved, so it cannot be rejected or deleted here.");
  });
});

const FY_FOLDER = "Cedarline Systems/2025 - Mar 31";
const PD_NAME = "04 CedarlineSystems 2025-03-31 T2.DW.PN ColdChainSensorDrift.docx";
const LABEL_KEYS = [
  "category",
  "companyKey",
  "fiscalYearEnd",
  "fiscalYearEndAssumed",
  "pdNumber",
  "versionCode",
  "versionNumber",
  "writerInitials",
  "reviewerInitials",
  "initialsGroups",
  "pdTitle",
] as const;

/** The upsert arguments a feeder sends for a file at `path`, as http.ts builds them. */
function discoveredArgs(
  path: string,
  extra: { driveItemId?: string; contentHash?: string } = {}
) {
  const segments = path.split("/");
  const name = segments.pop()!;
  const meta = classify(segments.join("/"), name);
  return {
    driveItemId: extra.driveItemId ?? `drive-${crypto.randomUUID()}`,
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

function labelsOf(item: Doc<"ingestionItems"> | null) {
  if (!item) throw new Error("item missing");
  return Object.fromEntries(LABEL_KEYS.map((key) => [key, item[key]]));
}

async function getItem(t: ReturnType<typeof convexTest>, id: Id<"ingestionItems">) {
  return await t.run((ctx) => ctx.db.get(id));
}

describe("Import sheet labels on ingestion items", () => {
  it("stores the labels when a file is first discovered", async () => {
    const t = convexTest(schema, modules);
    const id = await t.mutation(
      internal.ingestion.upsertDiscoveredItem,
      discoveredArgs(`${FY_FOLDER}/To be submitted/${PD_NAME}`)
    );
    const item = await getItem(t, id!);
    expect(item).toMatchObject({
      status: "discovered",
      docKind: "pd",
      category: "final_pd",
      companyKey: "cedarline systems",
      fiscalYearEnd: Date.UTC(2025, 2, 31),
      fiscalYearEndAssumed: false,
      pdNumber: "4",
      versionCode: "T",
      versionNumber: 2,
      writerInitials: "DW",
      reviewerInitials: "PN",
      pdTitle: "Cold Chain Sensor Drift",
    });
  });

  it("stores the labels from the batch upsert the Graph sync uses, leaving absent ones out", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.ingestion.upsertDiscoveredBatch, {
      items: [
        discoveredArgs("Halden Foods/glossary.docx", { driveItemId: "glossary" }),
        discoveredArgs("Northgate Labs/2024/In Review/notes.docx", { driveItemId: "notes" }),
      ],
    });
    const rows = await t.run((ctx) => ctx.db.query("ingestionItems").collect());
    const glossary = rows.find((row) => row.driveItemId === "glossary")!;
    // Since phase 2 docKind follows category: a company file is "supporting"
    // (classify alone still says "unknown" for a file at the client level).
    expect(glossary).toMatchObject({ category: "company_file", companyKey: "halden foods", docKind: "supporting" });
    expect("fiscalYearEnd" in glossary).toBe(false);
    expect("pdNumber" in glossary).toBe(false);
    const notes = rows.find((row) => row.driveItemId === "notes")!;
    expect(notes).toMatchObject({
      category: "review_copy",
      companyKey: "northgate labs",
      fiscalYearEnd: Date.UTC(2024, 11, 31),
      fiscalYearEndAssumed: true,
    });
  });

  it("stores the PD file name fields on a review copy whose name carries a version", async () => {
    const t = convexTest(schema, modules);
    const id = await t.mutation(
      internal.ingestion.upsertDiscoveredItem,
      discoveredArgs("Northgate Labs/2024/In Review/03 NorthgateLabs 2024-12-31 R2.PN.doc")
    );
    const item = await getItem(t, id!);
    expect(item).toMatchObject({
      docKind: "supporting",
      category: "review_copy",
      pdNumber: "3",
      versionCode: "R",
      versionNumber: 2,
      writerInitials: "PN",
      fiscalYearEnd: Date.UTC(2024, 11, 31),
      fiscalYearEndAssumed: true,
    });
    // The extension is not read as reviewer initials.
    expect("reviewerInitials" in item!).toBe(false);
  });

  it("refreshes the labels when a file moves, and keeps its review state", async () => {
    const t = convexTest(schema, modules);
    const args = discoveredArgs(`${FY_FOLDER}/To be submitted/${PD_NAME}`, { driveItemId: "moving" });
    const id = (await t.mutation(internal.ingestion.upsertDiscoveredItem, args))!;
    await t.run((ctx) => ctx.db.patch(id, { status: "pending_review", pairStatus: "missing_transcript" }));

    // Same bytes, new folder: a metadata-only change.
    const moved = discoveredArgs(`Cedarline Systems/2026 - Mar 31/Financials/${PD_NAME}`, {
      driveItemId: "moving",
    });
    await expect(t.mutation(internal.ingestion.upsertDiscoveredItem, moved)).resolves.toBeNull();
    const item = await getItem(t, id);
    expect(item).toMatchObject({
      path: moved.path,
      category: "supporting",
      companyKey: "cedarline systems",
      fiscalYearEnd: Date.UTC(2026, 2, 31),
      fiscalYearEndAssumed: false,
      // The review state stays as it was.
      status: "pending_review",
      // Since phase 2 the fields approval and pairing read follow the move
      // too (the phase 1 review's finding); the old group is recomputed.
      docKind: "supporting",
      fiscalYearLabel: "2026 - Mar 31",
      fiscalYear: 2026,
      pairGroupKey: "cedarline systems::2026",
    });
    // A lone supporting file in its new group carries no pair status.
    expect(item?.pairStatus).toBeUndefined();
    // A supporting file gets no PD file name fields, so the move clears them.
    for (const key of ["pdNumber", "versionCode", "versionNumber", "writerInitials", "reviewerInitials", "pdTitle"] as const) {
      expect(item?.[key]).toBeUndefined();
    }
    expect(labelsOf(item)).toEqual(labelsForItemPath(moved.path, moved.name));
  });

  it("refreshes the labels when the content changes at a new path", async () => {
    const t = convexTest(schema, modules);
    const id = (await t.mutation(
      internal.ingestion.upsertDiscoveredItem,
      discoveredArgs(`${FY_FOLDER}/Drafts/notes.docx`, { driveItemId: "changing" })
    ))!;
    await t.run((ctx) => ctx.db.patch(id, { status: "pending_review" }));
    const changed = discoveredArgs(`${FY_FOLDER}/To be submitted/${PD_NAME}`, {
      driveItemId: "changing",
      contentHash: "hash-2",
    });
    await expect(t.mutation(internal.ingestion.upsertDiscoveredItem, changed)).resolves.toBe(id);
    const item = await getItem(t, id);
    expect(item).toMatchObject({ status: "discovered", docKind: "pd", category: "final_pd", versionCode: "T" });
    expect(labelsOf(item)).toEqual(labelsForItemPath(changed.path, changed.name));
  });

  it("refreshes the labels when a failed file is retried", async () => {
    const t = convexTest(schema, modules);
    const id = (await t.mutation(
      internal.ingestion.upsertDiscoveredItem,
      discoveredArgs(`${FY_FOLDER}/Drafts/notes.docx`, { driveItemId: "retry" })
    ))!;
    await t.run((ctx) => ctx.db.patch(id, { status: "failed", error: "download failed" }));
    const retried = discoveredArgs(`${FY_FOLDER}/2. In Review/notes.docx`, { driveItemId: "retry" });
    await expect(t.mutation(internal.ingestion.upsertDiscoveredItem, retried)).resolves.toBe(id);
    expect(await getItem(t, id)).toMatchObject({ status: "discovered", category: "review_copy" });
  });

  it("leaves the labels of an approved file whose content changed, as its path is not rewritten", async () => {
    const t = convexTest(schema, modules);
    const args = discoveredArgs(`${FY_FOLDER}/To be submitted/${PD_NAME}`, { driveItemId: "approved" });
    const id = (await t.mutation(internal.ingestion.upsertDiscoveredItem, args))!;
    await t.run((ctx) => ctx.db.patch(id, { status: "approved" }));
    const before = labelsOf(await getItem(t, id));
    await t.mutation(
      internal.ingestion.upsertDiscoveredItem,
      discoveredArgs(`${FY_FOLDER}/Drafts/${PD_NAME}`, { driveItemId: "approved", contentHash: "hash-2" })
    );
    const item = await getItem(t, id);
    expect(item?.path).toBe(args.path);
    expect(labelsOf(item)).toEqual(before);
  });
});

/** A row as staged before the labels existed: no label fields at all. */
async function insertUnlabelled(t: ReturnType<typeof convexTest>, path: string) {
  const args = discoveredArgs(path);
  return await t.run((ctx) =>
    ctx.db.insert("ingestionItems", {
      ...args,
      status: "pending_review",
      updatedAt: 1_700_000_000_000,
    })
  );
}

describe("backfillIngestionLabels", () => {
  it("fills old rows page by page, rescheduling itself until the table is done", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema, modules);
      const paths = [
        `${FY_FOLDER}/To be submitted/${PD_NAME}`,
        `${FY_FOLDER}/Drafts/notes.docx`,
        `${FY_FOLDER}/WIP/Technical/Audio/interview.txt`,
        "Halden Foods/glossary.docx",
        "Northgate Labs/2024/In Review/notes.docx",
      ];
      const ids = [];
      for (const path of paths) ids.push(await insertUnlabelled(t, path));
      // One row carries labels that no longer match its path.
      const stale = await insertUnlabelled(t, `${FY_FOLDER}/Financials/budget.pdf`);
      await t.run((ctx) => ctx.db.patch(stale, { category: "final_pd", pdTitle: "Old title" }));
      ids.push(stale);
      const before = await t.run((ctx) => ctx.db.query("ingestionItems").collect());

      const first = await t.mutation(internal.ingestion.backfillIngestionLabels, { batchSize: 2 });
      expect(first).toEqual({ scanned: 2, updated: 2, done: false });
      await t.finishAllScheduledFunctions(vi.runAllTimers);

      for (const id of ids) {
        const item = await getItem(t, id);
        expect(item?.category).toBeDefined();
        expect(labelsOf(item)).toEqual(labelsForItemPath(item!.path, item!.name));
        // Review state, pairing key and updatedAt stay; docKind follows the
        // category (a company file at the client level becomes "supporting").
        const old = before.find((row) => row._id === id)!;
        expect(item).toMatchObject({
          status: old.status,
          docKind: docKindForCategory(item!.category!),
          pairGroupKey: old.pairGroupKey,
          updatedAt: old.updatedAt,
          sheetTab: "review",
          sortKey: expect.any(String),
          needsCheck: expect.any(Boolean),
          checkReasons: expect.any(Array),
        });
      }
      expect((await getItem(t, stale))?.pdTitle).toBeUndefined();

      const jobs = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
      const runs = jobs.filter((job) => job.name.includes("backfillIngestionLabels"));
      // Six rows at two a page: the first page ran directly, then two or
      // three more were scheduled, and every one finished.
      expect(runs.length).toBeGreaterThanOrEqual(2);
      expect(runs.length).toBeLessThanOrEqual(3);
      expect(runs.every((job) => job.state.kind === "success")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops when one page holds every row, and skips rows that already match", async () => {
    const t = convexTest(schema, modules);
    await insertUnlabelled(t, `${FY_FOLDER}/Drafts/notes.docx`);
    await insertUnlabelled(t, "Halden Foods/glossary.docx");

    await expect(t.mutation(internal.ingestion.backfillIngestionLabels, {})).resolves.toEqual({
      scanned: 2,
      updated: 2,
      done: true,
    });
    await expect(t.mutation(internal.ingestion.backfillIngestionLabels, {})).resolves.toEqual({
      scanned: 2,
      updated: 0,
      done: true,
    });
    const jobs = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(jobs.filter((job) => job.name.includes("backfillIngestionLabels"))).toHaveLength(0);
  });

  it("does nothing on an empty table", async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(internal.ingestion.backfillIngestionLabels, { cursor: null })).resolves.toEqual({
      scanned: 0,
      updated: 0,
      done: true,
    });
  });
});

describe("getUploaderConfig", () => {
  const validKey = "a".repeat(64);
  const siteUrl = "https://example-deployment.convex.site";

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the trimmed upload URL and ingest key for an active admin", async () => {
    const f = await setup();
    vi.stubEnv("INGEST_API_KEY", `  ${validKey}  `);
    vi.stubEnv("CONVEX_SITE_URL", `${siteUrl}/`);

    await expect(f.admin.action(api.ingestion.getUploaderConfig, {})).resolves.toEqual({
      url: siteUrl,
      key: validKey,
    });
  });

  it("refuses unauthenticated callers, non-admins, and anonymous admins", async () => {
    const f = await setup();
    vi.stubEnv("INGEST_API_KEY", validKey);
    vi.stubEnv("CONVEX_SITE_URL", siteUrl);
    await f.t.run(async (ctx) => {
      await ctx.db.insert("users", {
        authId: "anon-admin",
        role: "admin",
        isAnonymous: true,
        firstName: "Anon",
      });
    });
    const anonAdmin = f.t.withIdentity({ subject: "anon-admin" });

    await expect(f.t.action(api.ingestion.getUploaderConfig, {})).rejects.toThrow("Not authenticated");
    await expect(f.writer.action(api.ingestion.getUploaderConfig, {})).rejects.toThrow("Admin only");
    await expect(anonAdmin.action(api.ingestion.getUploaderConfig, {})).rejects.toThrow("Not authenticated");
  });

  it("refuses cleanly when INGEST_API_KEY is missing or shorter than 32 chars", async () => {
    const f = await setup();
    vi.stubEnv("CONVEX_SITE_URL", siteUrl);

    vi.stubEnv("INGEST_API_KEY", "");
    await expect(f.admin.action(api.ingestion.getUploaderConfig, {})).rejects.toThrow(/INGEST_API_KEY/);

    vi.stubEnv("INGEST_API_KEY", "short-key");
    await expect(f.admin.action(api.ingestion.getUploaderConfig, {})).rejects.toThrow(/INGEST_API_KEY/);
  });

  it("refuses cleanly when CONVEX_SITE_URL is missing or not https", async () => {
    const f = await setup();
    vi.stubEnv("INGEST_API_KEY", validKey);

    vi.stubEnv("CONVEX_SITE_URL", "");
    await expect(f.admin.action(api.ingestion.getUploaderConfig, {})).rejects.toThrow(/upload address/i);

    vi.stubEnv("CONVEX_SITE_URL", "http://insecure.example.com");
    await expect(f.admin.action(api.ingestion.getUploaderConfig, {})).rejects.toThrow(/upload address/i);
  });
});
