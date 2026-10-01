/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { MAX_UPLOAD_BYTES } from "./lib/storage";

const modules = import.meta.glob("./**/*.ts");

// Security wave 1 (audit 2026-09-25, a2 P3-5, P3-3, a4 #23): the byte limit
// is enforced when a save attaches a file, and only internal users get an
// upload URL.

async function setup() {
  const t = convexTest(schema, modules);
  const projectId = await t.run(async (ctx) => {
    const writerId = await ctx.db.insert("users", { authId: "ul-writer", role: "writer" });
    await ctx.db.insert("users", { authId: "ul-roleless" });
    return await ctx.db.insert("projects", {
      title: "Uploads",
      clientName: "Acme",
      status: "draft",
      createdBy: writerId,
      ownerId: writerId,
      shareToken: "ul-token",
      createdAt: 1,
      updatedAt: 1,
    });
  });
  return {
    t,
    projectId,
    writer: t.withIdentity({ subject: "ul-writer" }),
    roleless: t.withIdentity({ subject: "ul-roleless" }),
  };
}

describe("upload limits", () => {
  it("refuses to attach a file over the byte limit", async () => {
    const f = await setup();
    const big = await f.t.run((ctx) => ctx.storage.store(new Blob([new Uint8Array(MAX_UPLOAD_BYTES + 1)])));
    await expect(
      f.writer.mutation(api.documents.uploadDocument, {
        projectId: f.projectId,
        fileName: "big.pdf",
        fileType: "pdf",
        content: "text",
        storageId: big,
      })
    ).rejects.toThrow(/at most 50 MB/);
    await expect(f.writer.mutation(api.documents.claimUpload, { storageId: big })).rejects.toThrow(/at most 50 MB/);
    const small = await f.t.run((ctx) => ctx.storage.store(new Blob(["ok"])));
    await expect(
      f.writer.mutation(api.documents.uploadDocument, {
        projectId: f.projectId,
        fileName: "small.txt",
        fileType: "txt",
        content: "ok",
        storageId: small,
      })
    ).resolves.toBeDefined();
  });

  it("gives upload URLs to internal users only", async () => {
    const f = await setup();
    await expect(f.writer.mutation(api.documents.generateUploadUrl, {})).resolves.toEqual(expect.any(String));
    await expect(f.roleless.mutation(api.documents.generateUploadUrl, {})).rejects.toThrow(/internal role/);
    await expect(f.t.mutation(api.documents.generateUploadUrl, {})).rejects.toThrow(/Authentication/);
  });
});
