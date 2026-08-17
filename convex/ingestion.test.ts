/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

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
    ).rejects.toThrow(/brain admin page/i);
  });
});
