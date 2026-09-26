/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const JOINED = Date.parse("2026-09-20T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

async function setup(user: { createdAt?: number }) {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("users", { authId: "cl-writer", role: "writer", ...user });
    // 48 entries from before the account existed, 2 after (fidelity #8).
    for (let i = 0; i < 48; i++) {
      await ctx.db.insert("changelogEntries", {
        title: `Old ${i}`, body: "b", kind: "fix", publishedAt: JOINED - (i + 1) * DAY,
      });
    }
    for (let i = 0; i < 2; i++) {
      await ctx.db.insert("changelogEntries", {
        title: `New ${i}`, body: "b", kind: "feature", publishedAt: JOINED + (i + 1) * 60_000,
      });
    }
  });
  return { t, writer: t.withIdentity({ subject: "cl-writer" }) };
}

describe("changelog.unseenCount", () => {
  it("counts only entries published after a new account was created", async () => {
    const { writer } = await setup({ createdAt: JOINED });
    expect(await writer.query(api.changelog.unseenCount, {})).toBe(2);
  });

  it("falls back to the document's creation time when createdAt is missing", async () => {
    const { writer } = await setup({});
    // The user doc is created now, after every seeded entry.
    expect(await writer.query(api.changelog.unseenCount, {})).toBe(0);
  });

  it("uses the read watermark once the person has opened What's new", async () => {
    const { t, writer } = await setup({ createdAt: JOINED });
    await t.run(async (ctx) => {
      const user = (await ctx.db.query("users").first())!;
      await ctx.db.insert("changelogReads", { userId: user._id, lastSeenAt: JOINED - 3.5 * DAY });
    });
    expect(await writer.query(api.changelog.unseenCount, {})).toBe(5);
  });
});
