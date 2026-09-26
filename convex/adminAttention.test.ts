/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { round2Api } from "./lib/round2Api";
import { ATTENTION_INGESTION_FAILED_CAP } from "./adminAttention";

const modules = import.meta.glob("./**/*.ts");

type Status = "discovered" | "fetched" | "pending_review" | "approved" | "rejected" | "failed" | "deleted";

async function setup() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("users", { authId: "att-admin", role: "admin" });
    await ctx.db.insert("users", { authId: "att-manager", role: "manager" });
    await ctx.db.insert("users", { authId: "att-writer", role: "writer" });
    await ctx.db.insert("users", { authId: "att-roleless" });
    await ctx.db.insert("users", { authId: "att-anon", role: "admin", isAnonymous: true });
  });
  return {
    t,
    admin: t.withIdentity({ subject: "att-admin" }),
    manager: t.withIdentity({ subject: "att-manager" }),
    consultant: t.withIdentity({ subject: "att-writer" }),
    roleless: t.withIdentity({ subject: "att-roleless" }),
    anonymous: t.withIdentity({ subject: "att-anon" }),
  };
}
type Fixture = Awaited<ReturnType<typeof setup>>;

async function addItems(f: Fixture, status: Status, count: number) {
  await f.t.run(async (ctx) => {
    for (let i = 0; i < count; i += 1) {
      await ctx.db.insert("ingestionItems", {
        driveItemId: `${status}-${i}-${Math.random()}`,
        path: "Client/2025/call.docx",
        name: "call.docx",
        docKind: "transcript",
        size: 10,
        lastModifiedAt: 1,
        contentHash: `hash-${i}`,
        status,
        pairGroupKey: "Client::2025",
        updatedAt: 1,
      });
    }
  });
}

const zeros = { total: 0, ingestionFailed: 0 };

describe("adminAttention.getAttention", () => {
  it("gives an Admin the failed OneDrive import count and one page needing a look", async () => {
    const f = await setup();
    expect(await f.admin.query(round2Api.adminAttention.getAttention, {})).toEqual(zeros);
    await addItems(f, "approved", 3);
    await addItems(f, "pending_review", 2);
    expect(await f.admin.query(round2Api.adminAttention.getAttention, {})).toEqual(zeros);
    await addItems(f, "failed", 4);
    expect(await f.admin.query(round2Api.adminAttention.getAttention, {})).toEqual({ total: 1, ingestionFailed: 4 });
  });

  it("gives Managers, Consultants and everyone else zeros without throwing", async () => {
    const f = await setup();
    await addItems(f, "failed", 2);
    for (const viewer of [f.manager, f.consultant, f.roleless, f.anonymous, f.t]) {
      expect(await viewer.query(round2Api.adminAttention.getAttention, {})).toEqual(zeros);
    }
  });

  it("caps the failed count at 100", async () => {
    const f = await setup();
    await addItems(f, "failed", ATTENTION_INGESTION_FAILED_CAP + 5);
    expect(await f.admin.query(round2Api.adminAttention.getAttention, {})).toEqual({
      total: 1,
      ingestionFailed: ATTENTION_INGESTION_FAILED_CAP,
    });
  });
});
