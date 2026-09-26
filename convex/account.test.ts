/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { round2Api } from "./lib/round2Api";
import { PROFILE_PHOTO_MAX_BYTES } from "./account";
import { FRESH_UPLOAD_MS } from "./lib/storage";

const modules = import.meta.glob("./**/*.ts");

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => ({
    writerId: await ctx.db.insert("users", { authId: "photo-writer", role: "writer", firstName: "Wren" }),
    otherId: await ctx.db.insert("users", { authId: "photo-other", role: "manager", firstName: "Otto" }),
    rolelessId: await ctx.db.insert("users", { authId: "photo-roleless", firstName: "Rae" }),
    anonymousId: await ctx.db.insert("users", { authId: "photo-anon", role: "writer", isAnonymous: true }),
  }));
  return {
    t,
    ...ids,
    writer: t.withIdentity({ subject: "photo-writer" }),
    other: t.withIdentity({ subject: "photo-other" }),
    roleless: t.withIdentity({ subject: "photo-roleless" }),
    anonymous: t.withIdentity({ subject: "photo-anon" }),
  };
}
type Fixture = Awaited<ReturnType<typeof setup>>;

/**
 * Stores a file like a browser upload would. convex-test does not record the
 * upload's Content-Type, so the test sets it on the `_storage` row the way
 * the real backend does.
 */
async function upload(f: Fixture, options: { type?: string; size?: number } = {}) {
  const size = options.size ?? 64;
  return await f.t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob([new Uint8Array(size)]));
    if (options.type !== undefined) {
      await ctx.db.patch(storageId as unknown as Id<"users">, { contentType: options.type } as never);
    }
    return storageId;
  });
}

async function claimedUpload(
  f: Fixture,
  who: "writer" | "other" = "writer",
  options: { type?: string; size?: number } = { type: "image/png" }
) {
  const storageId = await upload(f, options);
  expect(await f[who].mutation(api.documents.claimUpload, { storageId })).toBe(true);
  return storageId;
}

const blobExists = (f: Fixture, id: Id<"_storage">) =>
  f.t.run(async (ctx) => (await ctx.db.system.get("_storage", id)) !== null);
const userRow = (f: Fixture, id: Id<"users">) => f.t.run((ctx) => ctx.db.get(id));
const claims = (f: Fixture, storageId: Id<"_storage">) =>
  f.t.run((ctx) => ctx.db.query("uploadClaims").withIndex("by_storageId", (q) => q.eq("storageId", storageId)).take(5));

describe("account.setMyPhoto", () => {
  it("records the upload's content type on the test storage row", async () => {
    const f = await setup();
    const storageId = await upload(f, { type: "image/png" });
    const meta = await f.t.run((ctx) => ctx.db.system.get("_storage", storageId));
    expect(meta?.contentType).toBe("image/png");
  });

  it("saves a claimed PNG or JPG, consumes the claim and exposes imageUrl", async () => {
    const f = await setup();
    expect((await f.writer.query(api.users.getCurrentUser, {}))?.imageUrl).toBeNull();
    const png = await claimedUpload(f);
    await f.writer.mutation(round2Api.account.setMyPhoto, { storageId: png });
    expect((await userRow(f, f.writerId))?.imageStorageId).toBe(png);
    expect(await claims(f, png)).toEqual([]);
    const me = await f.writer.query(api.users.getCurrentUser, {});
    expect(me).toMatchObject({ _id: f.writerId, firstName: "Wren", role: "writer" });
    expect(typeof me?.imageUrl).toBe("string");

    const jpg = await claimedUpload(f, "writer", { type: "image/jpeg" });
    await f.writer.mutation(round2Api.account.setMyPhoto, { storageId: jpg });
    expect((await userRow(f, f.writerId))?.imageStorageId).toBe(jpg);
  });

  it.each([
    ["a PDF", "application/pdf"],
    ["a GIF", "image/gif"],
    ["an SVG", "image/svg+xml"],
    ["no content type", undefined],
  ])("refuses %s with the type copy and changes nothing", async (_label, type) => {
    const f = await setup();
    const storageId = await claimedUpload(f, "writer", { type });
    await expect(
      f.writer.mutation(round2Api.account.setMyPhoto, { storageId })
    ).rejects.toThrow("Use a PNG or JPG file.");
    expect((await userRow(f, f.writerId))?.imageStorageId).toBeUndefined();
  });

  it("accepts exactly 5 MB and refuses one byte more with the size copy", async () => {
    const f = await setup();
    const tooBig = await claimedUpload(f, "writer", { type: "image/jpeg", size: PROFILE_PHOTO_MAX_BYTES + 1 });
    await expect(
      f.writer.mutation(round2Api.account.setMyPhoto, { storageId: tooBig })
    ).rejects.toThrow("That photo is over 5 MB.");
    expect((await userRow(f, f.writerId))?.imageStorageId).toBeUndefined();

    const atCap = await claimedUpload(f, "writer", { type: "image/jpeg", size: PROFILE_PHOTO_MAX_BYTES });
    await f.writer.mutation(round2Api.account.setMyPhoto, { storageId: atCap });
    expect((await userRow(f, f.writerId))?.imageStorageId).toBe(atCap);
  });

  it("refuses a file the caller never claimed and a file someone else claimed", async () => {
    const f = await setup();
    const unclaimed = await upload(f, { type: "image/png" });
    await expect(
      f.writer.mutation(round2Api.account.setMyPhoto, { storageId: unclaimed })
    ).rejects.toThrow(/Upload it again/);

    const othersUpload = await claimedUpload(f, "other");
    await expect(
      f.writer.mutation(round2Api.account.setMyPhoto, { storageId: othersUpload })
    ).rejects.toThrow(/Upload it again/);
    expect((await userRow(f, f.writerId))?.imageStorageId).toBeUndefined();
    // The other person's upload and claim are untouched.
    expect(await blobExists(f, othersUpload)).toBe(true);
    expect(await claims(f, othersUpload)).toHaveLength(1);
  });

  it("refuses a claim older than an hour", async () => {
    const f = await setup();
    const storageId = await claimedUpload(f);
    vi.advanceTimersByTime(FRESH_UPLOAD_MS + 1);
    await expect(
      f.writer.mutation(round2Api.account.setMyPhoto, { storageId })
    ).rejects.toThrow(/Upload it again/);
  });

  it("refuses a claimed file a row already holds", async () => {
    const f = await setup();
    const storageId = await claimedUpload(f);
    await f.t.run(async (ctx) => {
      const projectId = await ctx.db.insert("projects", {
        title: "Held", clientName: "C", status: "draft", createdBy: f.writerId, shareToken: "held", createdAt: 1, updatedAt: 1,
      });
      await ctx.db.insert("projectDocuments", {
        projectId, fileName: "a.png", fileType: "image", content: "", storageId, source: "upload", uploadedBy: "u", createdAt: 1,
      });
    });
    await expect(
      f.writer.mutation(round2Api.account.setMyPhoto, { storageId })
    ).rejects.toThrow(/already in use/);
  });

  it("replacing the photo releases the old file", async () => {
    const f = await setup();
    const first = await claimedUpload(f);
    await f.writer.mutation(round2Api.account.setMyPhoto, { storageId: first });
    const second = await claimedUpload(f, "writer", { type: "image/jpeg" });
    await f.writer.mutation(round2Api.account.setMyPhoto, { storageId: second });
    expect((await userRow(f, f.writerId))?.imageStorageId).toBe(second);
    expect(await blobExists(f, first)).toBe(false);
    expect(await blobExists(f, second)).toBe(true);
  });

  it("setting the current photo again is a no-op", async () => {
    const f = await setup();
    const storageId = await claimedUpload(f);
    await f.writer.mutation(round2Api.account.setMyPhoto, { storageId });
    await f.writer.mutation(round2Api.account.setMyPhoto, { storageId });
    expect((await userRow(f, f.writerId))?.imageStorageId).toBe(storageId);
    expect(await blobExists(f, storageId)).toBe(true);
  });

  it("refuses signed-out, anonymous and roleless callers", async () => {
    const f = await setup();
    const storageId = await upload(f, { type: "image/png" });
    await expect(f.t.mutation(round2Api.account.setMyPhoto, { storageId })).rejects.toThrow(/Authentication required/);
    await expect(f.anonymous.mutation(round2Api.account.setMyPhoto, { storageId })).rejects.toThrow(/Authentication required/);
    await expect(f.roleless.mutation(round2Api.account.setMyPhoto, { storageId })).rejects.toThrow(/active internal role/);
  });
});

describe("account.removeMyPhoto", () => {
  it("clears the photo and deletes the file", async () => {
    const f = await setup();
    const storageId = await claimedUpload(f);
    await f.writer.mutation(round2Api.account.setMyPhoto, { storageId });
    await f.writer.mutation(round2Api.account.removeMyPhoto, {});
    expect((await userRow(f, f.writerId))?.imageStorageId).toBeUndefined();
    expect(await blobExists(f, storageId)).toBe(false);
    expect((await f.writer.query(api.users.getCurrentUser, {}))?.imageUrl).toBeNull();
    // Removing again is harmless.
    await f.writer.mutation(round2Api.account.removeMyPhoto, {});
  });

  it("refuses signed-out, anonymous and roleless callers", async () => {
    const f = await setup();
    await expect(f.t.mutation(round2Api.account.removeMyPhoto, {})).rejects.toThrow(/Authentication required/);
    await expect(f.anonymous.mutation(round2Api.account.removeMyPhoto, {})).rejects.toThrow(/Authentication required/);
    await expect(f.roleless.mutation(round2Api.account.removeMyPhoto, {})).rejects.toThrow(/active internal role/);
  });
});
