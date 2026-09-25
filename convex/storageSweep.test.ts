/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import schema from "./schema";
import crons from "./crons";
import { STORAGE_REFERENCE_FIELDS } from "./lib/storage";
import { STORAGE_SWEEP_PAGE_SIZE, UNREFERENCED_STORAGE_GRACE_MS } from "./transcripts";

const modules = import.meta.glob("./**/*.ts");

/**
 * The daily sweep of files no row holds (review 2026-09-25, p3d B5): a
 * transcript original whose save never ran is deleted once it is a day old,
 * and a file any row holds is never deleted.
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

async function sweep(t: ReturnType<typeof convexTest>) {
  const first = await t.mutation(internal.transcripts.sweepUnreferencedStorage, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  return first;
}

async function exists(t: ReturnType<typeof convexTest>, id: Id<"_storage">) {
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

  it("deletes a day-old file no row holds, and never a file a row holds through any storage field", async () => {
    const { t, projectId } = await setup();
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
    expect(result).toMatchObject({ checked: STORAGE_REFERENCE_FIELDS.length + 1, deleted: 1, isDone: true });
    expect(await exists(t, orphan)).toBe(false);
    expect(await exists(t, fresh)).toBe(true);
    for (const [field, storageId] of held) expect(await exists(t, storageId), field).toBe(true);
  });

  it("works through many files in bounded pages", async () => {
    const { t, projectId } = await setup();
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
    // Running again finds nothing more to do.
    expect(await sweep(t)).toMatchObject({ checked: 1, deleted: 0, isDone: true });
  });

  it("runs every day", () => {
    const jobs = (crons as unknown as { crons: Record<string, { name: string; schedule: { type: string; cron?: string } }> }).crons;
    const job = jobs["release unreferenced files"];
    expect(job?.name).toBe("transcripts:sweepUnreferencedStorage");
    expect(job?.schedule).toMatchObject({ type: "cron", cron: "30 9 * * *" });
  });
});
