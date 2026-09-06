/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const attemptKey = "11111111-1111-4111-8111-111111111111";

async function setup() {
  const t = convexTest(schema, modules);
  const { projectId, foreignProjectId } = await t.run(async (ctx) => {
    await ctx.db.insert("users", { authId: "storage-denied", email: "denied@test.com" });
    const owner = await ctx.db.insert("users", { authId: "storage-owner", email: "owner@test.com", role: "writer" });
    const outsider = await ctx.db.insert("users", { authId: "storage-outsider", email: "outsider@test.com", role: "writer" });
    const project = { title: "Storage", clientName: "Client", status: "draft", createdAt: 1, updatedAt: 1 } satisfies Pick<Doc<"projects">, "title" | "clientName" | "status" | "createdAt" | "updatedAt">;
    return {
      projectId: await ctx.db.insert("projects", { ...project, createdBy: owner, shareToken: "storage-owner" }),
      foreignProjectId: await ctx.db.insert("projects", { ...project, createdBy: outsider, shareToken: "storage-outsider" }),
    };
  });
  const writer = t.withIdentity({ subject: "storage-owner" });
  const store = (bytes: string) => t.run((ctx) => ctx.storage.store(new Blob([bytes])));
  const blob = (id: Id<"_storage">) => t.run(async (ctx) => ({
    bytes: await (await ctx.storage.get(id))?.text(),
    url: await ctx.storage.getUrl(id),
    metadata: await ctx.db.system.get(id),
  }));
  const upload = (fileName: string, storageId: Id<"_storage">) =>
    writer.mutation(api.documents.uploadDocument, { projectId, fileName, storageId, fileType: "txt", content: fileName });
  return { t, writer, projectId, foreignProjectId, store, blob, upload };
}

describe("reference-safe storage cleanup", () => {
  test("public A/S1, B/S2, duplicate A/S2 preserves both originals and resolves receipt", async () => {
    const { t, writer, projectId, store, blob, upload } = await setup();
    const s1 = await store("A bytes");
    const s2 = await store("B bytes");
    const a = await upload("A.txt", s1);
    const b = await upload("B.txt", s2);
    const before = await t.run(async (ctx) => [await ctx.db.get(a), await ctx.db.get(b)]);
    await writer.mutation(api.uploadAttempts.recordUploadAttempts, {
      projectId, attempts: [{ attemptKey, fileName: "A.txt", origin: "chat_upload" }],
    });
    expect(await writer.mutation(api.documents.uploadDocument, {
      projectId, fileName: "A.txt", fileType: "txt", content: "A.txt", storageId: s2, attemptKey,
    })).toBe(a);
    expect(await t.run(async (ctx) => [await ctx.db.get(a), await ctx.db.get(b)])).toEqual(before);
    expect(await writer.query(api.uploadAttempts.listUploadAttempts, { projectId })).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("documentUploadAttempts").unique())).toMatchObject({ status: "succeeded", documentId: a });
    expect(await blob(s1)).toMatchObject({ bytes: "A bytes", url: expect.any(String) });
    expect(await blob(s2)).toMatchObject({ bytes: "B bytes", url: expect.any(String), metadata: expect.any(Object) });
  });

  test("shared document deletion retains archived foreign reference until final deletion", async () => {
    const { t, writer, foreignProjectId, store, blob, upload } = await setup();
    const storageId = await store("shared bytes");
    const first = await upload("first.txt", storageId);
    const outsider = t.withIdentity({ subject: "storage-outsider" });
    const last = await outsider.mutation(api.documents.uploadDocument, {
      projectId: foreignProjectId, fileName: "last.txt", fileType: "txt", content: "last", storageId,
    });
    await outsider.mutation(api.documents.setDocumentArchived, { documentId: last, archived: true });
    await writer.mutation(api.documents.deleteDocument, { documentId: first });
    expect(await t.run((ctx) => ctx.db.get(first))).toBeNull();
    expect.soft(await blob(storageId)).toMatchObject({ bytes: "shared bytes", url: expect.any(String) });
    expect(await t.run((ctx) => ctx.db.get(last))).toMatchObject({ archived: true, storageId });
    await outsider.mutation(api.documents.deleteDocument, { documentId: last });
    expect(await t.run((ctx) => ctx.db.get(last))).toBeNull();
    expect(await blob(storageId)).toEqual({ bytes: undefined, url: null, metadata: null });
  });

  for (const cleanup of ["duplicate", "delete", "maintenance"]) {
    test.each(["archivedDocument", "revokedBrain", "ingestionOriginal", "ingestionText"])(
      cleanup + " preserves %s and its bytes",
      async (reference) => {
        const { t, writer, foreignProjectId, store, blob, upload } = await setup();
        const storageId = await store("protected bytes");
        const original = await upload("match.txt", await store("original bytes"));
        const referenceId = await t.run(async (ctx) => {
          if (reference === "archivedDocument") {
            return ctx.db.insert("projectDocuments", {
              projectId: foreignProjectId, fileName: "unrelated.txt", fileType: "txt", content: "foreign",
              storageId, archived: true, source: "chat_upload", uploadedBy: "foreign", createdAt: 1,
            });
          }
          if (reference === "revokedBrain") {
            return ctx.db.insert("brainSources", {
              kind: "pd_pair", status: "revoked", title: "Retained", industry: "test", writerTier: 1,
              docType: "pd", content: "retained", ragKey: "retained", sourceHash: "hash", storageId,
              sourceProjectId: foreignProjectId, createdBy: "foreign", createdAt: 1,
            });
          }
          return ctx.db.insert("ingestionItems", {
            driveItemId: "foreign", path: "/foreign", name: "foreign.txt", docKind: "supporting",
            size: 15, lastModifiedAt: 1, contentHash: "hash", status: "deleted",
            deletedFromStatus: "rejected", deletedAt: 2, deletedBy: "foreign",
            pairGroupKey: "foreign", updatedAt: 2,
            ...(reference === "ingestionOriginal" ? { storageId } : { textStorageId: storageId }),
          });
        });
        const before = await t.run((ctx) => ctx.db.get(referenceId));
        if (cleanup === "duplicate") {
          expect(await upload("match.txt", storageId)).toBe(original);
        } else {
          const discarded = await upload("discard.txt", storageId);
          if (cleanup === "delete") {
            await writer.mutation(api.documents.deleteDocument, { documentId: discarded });
          } else {
            await t.run((ctx) => ctx.db.patch(discarded, { fileName: "match.txt" }));
            expect(await t.mutation(internal.seed.tagAndDedupeDoc, { fileName: "match.txt", category: "background" }))
              .toEqual({ found: 2, kept: original, deleted: 1 });
          }
          expect(await t.run((ctx) => ctx.db.get(discarded))).toBeNull();
        }
        expect(await t.run((ctx) => ctx.db.get(referenceId))).toEqual(before);
        expect(await blob(storageId)).toMatchObject({ bytes: "protected bytes", url: expect.any(String), metadata: expect.any(Object) });
      },
    );
  }

  test("maintenance keeps shared survivor bytes and reclaims a distinct orphan across projects", async () => {
    const { t, foreignProjectId, store, blob, upload } = await setup();
    const shared = await store("shared bytes");
    const orphan = await store("orphan bytes");
    const kept = await upload("match.txt", shared);
    const second = await upload("second.txt", shared);
    const third = await upload("third.txt", orphan);
    const fourth = await upload("fourth.txt", orphan);
    await t.run(async (ctx) => {
      await ctx.db.patch(second, { fileName: "match.txt", projectId: foreignProjectId });
      await ctx.db.patch(third, { fileName: "match.txt" });
      await ctx.db.patch(fourth, { fileName: "match.txt" });
    });
    expect(await t.mutation(internal.seed.tagAndDedupeDoc, { fileName: "match.txt", category: "background" }))
      .toEqual({ found: 4, kept, deleted: 3 });
    expect(await t.run(async (ctx) => [await ctx.db.get(second), await ctx.db.get(third), await ctx.db.get(fourth)])).toEqual([null, null, null]);
    expect(await t.run((ctx) => ctx.db.get(kept))).toMatchObject({ storageId: shared, category: "background" });
    expect(await blob(orphan)).toEqual({ bytes: undefined, url: null, metadata: null });
    expect(await blob(shared)).toMatchObject({ bytes: "shared bytes", url: expect.any(String) });
  });

  test("unauthorized deletion leaves document and storage unchanged", async () => {
    const { t, store, blob, upload } = await setup();
    const storageId = await store("private bytes");
    const documentId = await upload("private.txt", storageId);
    const before = await t.run((ctx) => ctx.db.get(documentId));
    await expect(t.withIdentity({ subject: "storage-denied" }).mutation(api.documents.deleteDocument, { documentId }))
      .rejects.toMatchObject({ data: { code: "NOT_AUTHORIZED", message: "An active internal role is required" } });
    expect(await t.run((ctx) => ctx.db.get(documentId))).toEqual(before);
    expect(await blob(storageId)).toMatchObject({ bytes: "private bytes", url: expect.any(String) });
  });

  test("storage deletion failure rolls back removal of a document with missing bytes", async () => {
    const { t, writer, store, blob, upload } = await setup();
    const storageId = await store("previously lost bytes");
    const documentId = await upload("missing.txt", storageId);
    await t.run((ctx) => ctx.storage.delete(storageId));
    const before = await t.run((ctx) => ctx.db.get(documentId));
    await expect(writer.mutation(api.documents.deleteDocument, { documentId }))
      .rejects.toThrow("Delete on non-existent doc");
    expect(await t.run((ctx) => ctx.db.get(documentId))).toEqual(before);
    expect(await blob(storageId)).toEqual({ bytes: undefined, url: null, metadata: null });
  });

  test("invalid attempt rolls back duplicate orphan cleanup", async () => {
    const { writer, projectId, store, blob, upload } = await setup();
    await upload("match.txt", await store("original"));
    const orphan = await store("orphan");
    await expect(writer.mutation(api.documents.uploadDocument, {
      projectId, fileName: "match.txt", fileType: "txt", content: "match.txt",
      storageId: orphan, attemptKey: "invalid",
    })).rejects.toThrow();
    expect(await blob(orphan)).toMatchObject({ bytes: "orphan", url: expect.any(String) });
  });
});
