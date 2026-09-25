/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import schema from "./schema";
import crons from "./crons";
import { STORAGE_REFERENCE_FIELDS } from "./lib/storage";
import {
  STORAGE_SWEEP_PAGE_SIZE,
  STORAGE_SWEEP_RUNS_KEPT,
  STORAGE_SWEEP_SAMPLE_SIZE,
  UNREFERENCED_STORAGE_GRACE_MS,
} from "./transcripts";

const modules = import.meta.glob("./**/*.ts");
type T = ReturnType<typeof convexTest<typeof schema.tables>>;

/**
 * The daily sweep of files no row holds (review 2026-09-25, p3d B5). It
 * ships in "report" mode: it counts what it would delete and deletes
 * nothing until an admin switches `storage.sweepUnreferenced` to "delete".
 * A file any row holds is never counted or deleted.
 */
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

type ValidatorJson =
  | { type: "id"; tableName: string }
  | { type: "object"; value: Record<string, { fieldType: ValidatorJson }> }
  | { type: "union"; value: ValidatorJson[] }
  | { type: "array"; value: ValidatorJson }
  | { type: "record"; values: { fieldType: ValidatorJson } }
  | { type: string };

function storageFields(json: ValidatorJson, path: string, out: Set<string>) {
  switch (json.type) {
    case "id":
      if ((json as { tableName: string }).tableName === "_storage") out.add(path);
      return;
    case "object":
      for (const [name, field] of Object.entries((json as { value: Record<string, { fieldType: ValidatorJson }> }).value)) {
        storageFields(field.fieldType, path ? `${path}.${name}` : name, out);
      }
      return;
    case "union":
      for (const member of (json as { value: ValidatorJson[] }).value) storageFields(member, path, out);
      return;
    case "array":
      storageFields((json as { value: ValidatorJson }).value, `${path}[]`, out);
      return;
    case "record":
      storageFields((json as { values: { fieldType: ValidatorJson } }).values.fieldType, `${path}[*]`, out);
      return;
    default:
      return;
  }
}

const DAY = UNREFERENCED_STORAGE_GRACE_MS;

async function sweep(t: T) {
  const first = await t.mutation(internal.transcripts.sweepUnreferencedStorage, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  return first;
}

async function setMode(t: T, mode: "off" | "report" | "delete") {
  const adminId = await t.run(async (ctx) => {
    const existing = await ctx.db.query("users").withIndex("by_authId", (q) => q.eq("authId", "sweep-admin")).unique();
    return existing?._id ?? (await ctx.db.insert("users", { authId: "sweep-admin", role: "admin" }));
  });
  await t.mutation(internal.appSettings.setStorageSweepModeInternal, { adminId, mode });
}

async function runs(t: T) {
  return await t.run((ctx) => ctx.db.query("storageSweepRuns").withIndex("by_startedAt").collect());
}

async function sweepNotices(t: T) {
  return (await t.run((ctx) => ctx.db.query("errorReports").collect())).filter((row) => row.source === "storage-sweep");
}

async function exists(t: T, id: Id<"_storage">) {
  return await t.run(async (ctx) => (await ctx.db.system.get("_storage", id)) !== null);
}

/** A row holding `storageId` through one storage field, as `table.field`. */
const holders: Record<(typeof STORAGE_REFERENCE_FIELDS)[number], (ctx: MutationCtx, storageId: Id<"_storage">, refs: { projectId: Id<"projects"> }) => Promise<unknown>> = {
  "projectDocuments.storageId": (ctx, storageId, { projectId }) =>
    ctx.db.insert("projectDocuments", {
      projectId,
      fileName: "notes.docx",
      fileType: "docx",
      content: "Notes",
      storageId,
      source: "upload",
      uploadedBy: "sweep-writer",
      createdAt: 1,
    }),
  "brainSources.storageId": (ctx, storageId) =>
    ctx.db.insert("brainSources", {
      kind: "pd_pair",
      status: "pending",
      title: "Pair",
      industry: "energy",
      writerTier: 1,
      docType: "pd",
      content: "PD text",
      ragKey: "rag-1",
      sourceHash: "hash-1",
      createdBy: "sweep-writer",
      createdAt: 1,
      storageId,
    }),
  "ingestionItems.storageId": (ctx, storageId) => ctx.db.insert("ingestionItems", ingestionItem({ storageId })),
  "ingestionItems.textStorageId": (ctx, storageId) =>
    ctx.db.insert("ingestionItems", ingestionItem({ textStorageId: storageId })),
  "transcripts.originalStorageId": (ctx, storageId, { projectId }) =>
    ctx.db.insert("transcripts", { projectId, content: "Dana: Hi.", createdAt: 1, originalStorageId: storageId }),
};

function ingestionItem(files: { storageId?: Id<"_storage">; textStorageId?: Id<"_storage"> }) {
  return {
    driveItemId: `drive-${Math.random()}`,
    path: "Client/2025/call.docx",
    name: "call.docx",
    docKind: "transcript" as const,
    size: 10,
    lastModifiedAt: 1,
    contentHash: `hash-${Math.random()}`,
    status: "fetched" as const,
    pairGroupKey: "Client::2025",
    updatedAt: 1,
    ...files,
  };
}

async function setup() {
  const t = convexTest(schema, modules);
  const projectId = await t.run(async (ctx) => {
    const writerId = await ctx.db.insert("users", { authId: "sweep-writer", role: "writer" });
    return await ctx.db.insert("projects", {
      title: "Helios",
      clientName: "Verdant Grid",
      status: "draft",
      createdBy: writerId,
      shareToken: "sweep-token",
      createdAt: 1,
      updatedAt: 1,
    });
  });
  return { t, projectId };
}

/**
 * Every module that creates a stored file, and the storage field its id
 * lands in. The sweep counts (and in "delete" mode deletes) any file older
 * than a day that none of STORAGE_REFERENCE_FIELDS holds, so a new writer
 * must put its id in one of them, or `isStorageReferenced` must learn
 * where it goes, before it is added here.
 */
const KNOWN_SERVER_STORAGE_WRITERS: Record<string, string> = {
  "./http.ts": "ingestionItems.storageId (ingestion.attachUpload)",
  "./ingestionSync.ts": "ingestionItems.storageId and textStorageId (ingestion.markItemProcessed)",
  "./ingestionPort.ts": "projectDocuments.storageId (the copied original)",
  "./projectDuplication.ts": "projectDocuments.storageId and transcripts.originalStorageId (projects.finishProjectContentCopy)",
  "./documents.ts": "generateUploadUrl: the browser uploads, then saves the id (below)",
};

/** Browser code that uploads through `documents.generateUploadUrl`, and where the id is saved. */
const KNOWN_CLIENT_UPLOADERS: Record<string, string> = {
  "../src/lib/transcriptUpload.ts": "transcripts.originalStorageId (the caller's save)",
  "../src/lib/uploads/originalUpload.ts": "projectDocuments.storageId (the caller's uploadDocument)",
  "../src/lib/components/review-pd/PdReviewStart.svelte": "projectDocuments.storageId (uploadDocument)",
  "../src/lib/components/chat/AgentChatPanel.svelte": "projectDocuments.storageId (uploadDocument)",
  "../src/lib/components/project/PreviewProjectPage.svelte": "transcripts.originalStorageId (add or replace)",
  "../src/lib/components/editor/FilesPanel.svelte": "projectDocuments.storageId (uploadDocument)",
  "../src/routes/project/new/+page.svelte": "projectDocuments.storageId and transcripts.originalStorageId",
};

const convexSources = import.meta.glob(["./**/*.ts", "!./_generated/**", "!./**/*.test.ts"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;
const browserSources = import.meta.glob(["../src/**/*.ts", "../src/**/*.svelte", "!../src/**/*.test.ts"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("where stored files come from", () => {
  it("knows every server module that creates a stored file", () => {
    const writers = Object.entries(convexSources)
      .filter(([, source]) => /\bstorage\.(store|generateUploadUrl)\(/.test(source))
      .map(([path]) => path)
      .sort();
    expect(writers).toEqual(Object.keys(KNOWN_SERVER_STORAGE_WRITERS).sort());
  });

  it("knows every browser module that uploads through an upload URL", () => {
    const uploaders = Object.entries(browserSources)
      .filter(([, source]) => /generateUploadUrl/.test(source))
      .map(([path]) => path)
      .sort();
    expect(uploaders).toEqual(Object.keys(KNOWN_CLIENT_UPLOADERS).sort());
  });

  it("never stores files through the chat agent component, whose file table the sweep cannot see", () => {
    // @convex-dev/agent keeps app storage ids as strings in its own `files`
    // table: through storeFile, and on its own for image or file message
    // parts over 64 KB. The app only ever sends it text.
    const agentFiles = Object.entries(convexSources)
      .filter(([, source]) =>
        /\bstoreFile\(|components\.agent\.files|type:\s*"(image|file)"/.test(source)
      )
      .map(([path]) => path);
    expect(agentFiles).toEqual([]);
  });
});

describe("sweepUnreferencedStorage", () => {
  it("knows every storage field in the schema", () => {
    const found = new Set<string>();
    for (const [table, def] of Object.entries(schema.tables as unknown as Record<string, { validator: { json: ValidatorJson } }>)) {
      const fields = new Set<string>();
      storageFields(def.validator.json, "", fields);
      for (const field of fields) found.add(`${table}.${field}`);
    }
    expect([...found].sort()).toEqual([...STORAGE_REFERENCE_FIELDS].sort());
    expect(Object.keys(holders).sort()).toEqual([...STORAGE_REFERENCE_FIELDS].sort());
  });

  it("in delete mode, deletes a day-old file no row holds, and never a file a row holds through any storage field", async () => {
    const { t, projectId } = await setup();
    await setMode(t, "delete");
    const held = new Map<string, Id<"_storage">>();
    for (const field of STORAGE_REFERENCE_FIELDS) {
      const storageId = await t.run((ctx) => ctx.storage.store(new Blob([`held by ${field}`])));
      await t.run((ctx) => holders[field](ctx, storageId, { projectId }));
      held.set(field, storageId);
    }
    const orphan = await t.run((ctx) => ctx.storage.store(new Blob(["interview text nobody saved"])));
    vi.setSystemTime(Date.now() + DAY + 60_000);
    // Uploaded a minute ago: its save may still be on its way.
    const fresh = await t.run((ctx) => ctx.storage.store(new Blob(["upload in flight"])));

    const result = await sweep(t);
    expect(result).toMatchObject({
      mode: "delete",
      checked: STORAGE_REFERENCE_FIELDS.length + 1,
      unreferenced: 1,
      deleted: 1,
      isDone: true,
    });
    expect(await exists(t, orphan)).toBe(false);
    expect(await exists(t, fresh)).toBe(true);
    for (const [field, storageId] of held) expect(await exists(t, storageId), field).toBe(true);
  });

  it("in delete mode, works through many files in bounded pages", async () => {
    const { t, projectId } = await setup();
    await setMode(t, "delete");
    const total = STORAGE_SWEEP_PAGE_SIZE * 2 + 17;
    const orphans: Id<"_storage">[] = [];
    for (let i = 0; i < total; i += 1) {
      orphans.push(await t.run((ctx) => ctx.storage.store(new Blob([`orphan ${i}`]))));
    }
    const kept = await t.run((ctx) => ctx.storage.store(new Blob(["kept"])));
    await t.run((ctx) => holders["transcripts.originalStorageId"](ctx, kept, { projectId }));
    vi.setSystemTime(Date.now() + DAY + 60_000);

    const first = await t.mutation(internal.transcripts.sweepUnreferencedStorage, {});
    expect(first).toMatchObject({ checked: STORAGE_SWEEP_PAGE_SIZE, isDone: false });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    for (const id of orphans) expect(await exists(t, id)).toBe(false);
    expect(await exists(t, kept)).toBe(true);
    const [run] = await runs(t);
    expect(run).toMatchObject({ mode: "delete", checked: total + 1, unreferenced: total, deleted: total });
    expect(run.finishedAt).toBeTypeOf("number");
    // Running again finds nothing more to do.
    expect(await sweep(t)).toMatchObject({ checked: 1, deleted: 0, isDone: true });
  });

  it("by default reports what it would delete, deletes nothing, and raises one notice per change", async () => {
    const { t, projectId } = await setup();
    const kept = await t.run((ctx) => ctx.storage.store(new Blob(["kept"])));
    await t.run((ctx) => holders["projectDocuments.storageId"](ctx, kept, { projectId }));
    const orphans: Id<"_storage">[] = [];
    for (const text of ["a".repeat(100), "b".repeat(200), "c".repeat(300)]) {
      orphans.push(await t.run((ctx) => ctx.storage.store(new Blob([text]))));
      vi.setSystemTime(Date.now() + 60_000);
    }
    const created = await t.run(async (ctx) =>
      Promise.all(orphans.map(async (id) => (await ctx.db.system.get("_storage", id))!._creationTime))
    );
    vi.setSystemTime(Date.now() + DAY + 60_000);

    expect(await sweep(t)).toMatchObject({ mode: "report", unreferenced: 3, deleted: 0, isDone: true });
    for (const id of [...orphans, kept]) expect(await exists(t, id)).toBe(true);
    const [run] = await runs(t);
    expect(run).toMatchObject({
      mode: "report",
      checked: 4,
      unreferenced: 3,
      unreferencedBytes: 600,
      oldestCreatedAt: created[0],
      newestCreatedAt: created[2],
      sampleFileIds: orphans,
      deleted: 0,
    });
    const notices = await sweepNotices(t);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ kind: "auto", status: "open", url: "/alerts" });
    expect(notices[0].message).toContain("3 stored files are more than a day old and held by no row (600 bytes");
    expect(notices[0].message).toContain("Nothing was deleted.");
    // Anyone signed in can read the alerts board: the file ids stay on the
    // admin-only run row, never in the notice.
    for (const id of orphans) expect(notices[0].message).not.toContain(id);

    // The next day finds the same files: a new run row, no new notice.
    vi.setSystemTime(Date.now() + DAY);
    await sweep(t);
    expect(await runs(t)).toHaveLength(2);
    expect(await sweepNotices(t)).toHaveLength(1);
    // One more orphan changes the count: a new notice.
    await t.run((ctx) => ctx.storage.store(new Blob(["d"])));
    vi.setSystemTime(Date.now() + DAY + 60_000);
    await sweep(t);
    expect(await sweepNotices(t)).toHaveLength(2);
    for (const id of orphans) expect(await exists(t, id)).toBe(true);
  });

  it("pages through files held by heavy rows inside the read limit", async () => {
    // Each held file costs one full row read in isStorageReferenced; rows of
    // about 900 KB (a long transcript or document) must never push a page
    // past the 16 MiB a transaction may read.
    const t = convexTest({ schema, modules, transactionLimits: true }) as T;
    const projectId = await t.run(async (ctx) => {
      const writerId = await ctx.db.insert("users", { authId: "sweep-heavy", role: "writer" });
      return await ctx.db.insert("projects", {
        title: "Heavy",
        clientName: "Client",
        status: "draft",
        createdBy: writerId,
        shareToken: "sweep-heavy-token",
        createdAt: 1,
        updatedAt: 1,
      });
    });
    const heavy = "x".repeat(900_000);
    const held: Id<"_storage">[] = [];
    for (let i = 0; i < 24; i += 1) {
      const storageId = await t.run((ctx) => ctx.storage.store(new Blob([`held ${i}`])));
      await t.run(async (ctx): Promise<unknown> =>
        i % 2 === 0
          ? await ctx.db.insert("transcripts", { projectId, content: `${i}${heavy}`, createdAt: 1, originalStorageId: storageId })
          : await ctx.db.insert("projectDocuments", {
              projectId,
              fileName: `doc-${i}.txt`,
              fileType: "txt",
              content: `${i}${heavy}`,
              storageId,
              source: "upload",
              uploadedBy: "sweep-heavy",
              createdAt: 1,
            })
      );
      held.push(storageId);
    }
    vi.setSystemTime(Date.now() + DAY + 60_000);
    await setMode(t, "delete");
    await sweep(t);
    const [run] = await runs(t);
    expect(run).toMatchObject({ checked: held.length, unreferenced: 0, deleted: 0 });
    expect(run.finishedAt).toBeTypeOf("number");
    for (const id of held) expect(await exists(t, id)).toBe(true);
  });

  it("keeps a capped sample of file ids", async () => {
    const { t } = await setup();
    for (let i = 0; i < STORAGE_SWEEP_SAMPLE_SIZE + 5; i += 1) {
      await t.run((ctx) => ctx.storage.store(new Blob([`orphan ${i}`])));
    }
    vi.setSystemTime(Date.now() + DAY + 60_000);
    await sweep(t);
    const [run] = await runs(t);
    expect(run.unreferenced).toBe(STORAGE_SWEEP_SAMPLE_SIZE + 5);
    expect(run.sampleFileIds).toHaveLength(STORAGE_SWEEP_SAMPLE_SIZE);
  });

  it("does nothing when switched off", async () => {
    const { t } = await setup();
    await setMode(t, "off");
    const orphan = await t.run((ctx) => ctx.storage.store(new Blob(["orphan"])));
    vi.setSystemTime(Date.now() + DAY + 60_000);
    expect(await sweep(t)).toBeNull();
    expect(await exists(t, orphan)).toBe(true);
    expect(await runs(t)).toEqual([]);
    expect(await sweepNotices(t)).toEqual([]);
  });

  it("stops deleting as soon as an admin switches away from delete mid-run", async () => {
    const { t } = await setup();
    await setMode(t, "delete");
    const total = STORAGE_SWEEP_PAGE_SIZE * 2 + 5;
    const orphans: Id<"_storage">[] = [];
    for (let i = 0; i < total; i += 1) orphans.push(await t.run((ctx) => ctx.storage.store(new Blob([`o${i}`]))));
    vi.setSystemTime(Date.now() + DAY + 60_000);
    await t.mutation(internal.transcripts.sweepUnreferencedStorage, {});
    await setMode(t, "report");
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const [run] = await runs(t);
    expect(run).toMatchObject({ mode: "delete", deleted: STORAGE_SWEEP_PAGE_SIZE, unreferenced: total });
    expect(await exists(t, orphans[STORAGE_SWEEP_PAGE_SIZE])).toBe(true);
    expect(await exists(t, orphans[total - 1])).toBe(true);
    // Switching off ends a run where it stands.
    await setMode(t, "delete");
    await t.mutation(internal.transcripts.sweepUnreferencedStorage, {});
    await setMode(t, "off");
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const latest = (await runs(t)).at(-1)!;
    expect(latest.finishedAt).toBeTypeOf("number");
    expect(latest.deleted).toBe(STORAGE_SWEEP_PAGE_SIZE);
  });

  it("keeps the latest runs only", async () => {
    const { t } = await setup();
    for (let i = 0; i < STORAGE_SWEEP_RUNS_KEPT + 3; i += 1) {
      await sweep(t);
      vi.setSystemTime(Date.now() + 60_000);
    }
    expect(await runs(t)).toHaveLength(STORAGE_SWEEP_RUNS_KEPT);
  });

  it("lets only an admin change the mode or read the status", async () => {
    const { t } = await setup();
    const ids = await t.run(async (ctx) => ({
      admin: await ctx.db.insert("users", { authId: "sweep-admin-2", role: "admin" }),
      writer: await ctx.db.insert("users", { authId: "sweep-writer-2", role: "writer" }),
    }));
    const writer = t.withIdentity({ subject: "sweep-writer-2" });
    const admin = t.withIdentity({ subject: "sweep-admin-2" });
    await expect(writer.mutation(api.appSettings.setStorageSweepMode, { mode: "delete" })).rejects.toThrow();
    await expect(writer.query(api.transcripts.getStorageSweepStatus, {})).rejects.toThrow();
    await expect(
      t.mutation(internal.appSettings.setStorageSweepModeInternal, { adminId: ids.writer, mode: "delete" })
    ).rejects.toThrow(/administrator/);
    expect((await admin.query(api.transcripts.getStorageSweepStatus, {})).mode).toBe("report");
    await admin.mutation(api.appSettings.setStorageSweepMode, { mode: "delete" });
    expect((await admin.query(api.transcripts.getStorageSweepStatus, {})).mode).toBe("delete");
  });

  it("runs every day", () => {
    const jobs = (crons as unknown as { crons: Record<string, { name: string; schedule: { type: string; cron?: string } }> }).crons;
    const job = jobs["release unreferenced files"];
    expect(job?.name).toBe("transcripts:sweepUnreferencedStorage");
    expect(job?.schedule).toMatchObject({ type: "cron", cron: "30 9 * * *" });
  });
});
