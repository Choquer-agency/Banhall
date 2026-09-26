/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// Security wave 1 (audit 2026-09-25, a2 P3-3): a signed-in account with no
// internal role, or a stored anonymous record, is not an internal user. The
// changelog, writing-mode and tag reads refuse them, and the local admin
// checks never accept an anonymous record that carries role "admin".
// Project and dashboard reads are not changed here: D1 keeps them open to
// roleless signed-in users (the 2026-08-06 hardening was reverted as
// unapproved), so that needs an owner decision first.

async function setup() {
  const t = convexTest(schema, modules);
  const sourceId = await t.run(async (ctx) => {
    await ctx.db.insert("users", { authId: "rl-writer", role: "writer" });
    await ctx.db.insert("users", { authId: "rl-roleless" });
    await ctx.db.insert("users", { authId: "rl-anon-admin", role: "admin", isAnonymous: true });
    return await ctx.db.insert("brainSources", {
      kind: "pd_pair", status: "approved", title: "Source", industry: "test", writerTier: 1,
      docType: "pd", content: "text", ragKey: "rk", sourceHash: "hash", createdBy: "x", createdAt: 1,
    });
  });
  return {
    t,
    sourceId,
    writer: t.withIdentity({ subject: "rl-writer" }),
    roleless: t.withIdentity({ subject: "rl-roleless" }),
    anonAdmin: t.withIdentity({ subject: "rl-anon-admin" }),
  };
}

async function code(call: () => Promise<unknown>): Promise<string> {
  try {
    await call();
    return "NO_ERROR";
  } catch (error) {
    const data = (error as { data?: { code?: string } }).data;
    return data?.code ?? `UNTYPED: ${(error as Error).message}`;
  }
}

describe("non-project reads need an internal role", () => {
  const reads = [
    ["changelog.listEntries", (c: ReturnType<typeof convexTest>) => c.query(api.changelog.listEntries, {})],
    ["changelog.unseenCount", (c: ReturnType<typeof convexTest>) => c.query(api.changelog.unseenCount, {})],
    ["houseStyle.getModesForMe", (c: ReturnType<typeof convexTest>) => c.query(api.houseStyle.getModesForMe, {})],
  ] as const;

  it.each(reads)("%s refuses a roleless or anonymous account and serves a writer", async (_name, read) => {
    const f = await setup();
    expect(await code(() => read(f.roleless as never))).toBe("NOT_AUTHORIZED");
    expect(await code(() => read(f.anonAdmin as never))).toBe("NOT_AUTHENTICATED");
    expect(await code(() => read(f.writer as never))).toBe("NO_ERROR");
  });

  it("tags.listTags returns nothing to a roleless account", async () => {
    const f = await setup();
    await f.t.run((ctx) => ctx.db.insert("tags", { name: "Hardware", createdAt: 1 } as never));
    expect(await f.roleless.query(api.tags.listTags, {})).toEqual([]);
    expect(await f.writer.query(api.tags.listTags, {})).toHaveLength(1);
  });
});

describe("admin checks refuse an anonymous record with role admin", () => {
  it("tags, brain, invites and usage", async () => {
    const f = await setup();
    expect(await code(() => f.anonAdmin.mutation(api.tags.createTag, { name: "Nope" }))).toBe("NOT_AUTHENTICATED");
    expect(await code(() => f.anonAdmin.mutation(api.brain.revokeSource, { sourceId: f.sourceId })))
      .toBe("UNTYPED: Not authenticated");
    expect(await f.anonAdmin.query(api.invites.listInvites, {})).toEqual([]);
    expect(await f.anonAdmin.query(api.aiUsage.usageReportAccess, {})).toBe(false);
  });
});
