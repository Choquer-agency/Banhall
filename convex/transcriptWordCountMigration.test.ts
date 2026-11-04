/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { makeFunctionReference, type FunctionReference } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const backfill = makeFunctionReference("transcriptWordCountMigration:backfillWordCounts") as unknown as FunctionReference<
  "mutation", "internal", { cursor?: string },
  { scanned: number; updated: number; isDone: boolean }
>;

afterEach(() => vi.useRealTimers());

describe("transcript word count backfill", () => {
  it("fills missing counts across pages and is safe to rerun", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { authId: "word-count-writer", role: "writer" });
      const projectId = await ctx.db.insert("projects", {
        title: "Word count", clientName: "Client", status: "draft",
        createdBy: userId, shareToken: "word-count-token",
        createdAt: Date.now(), updatedAt: Date.now(),
      });
      const ids = [];
      for (let i = 0; i < 11; i += 1) {
        ids.push(await ctx.db.insert("transcripts", {
          projectId, content: i === 0 ? "" : "One two", createdAt: i,
          ...(i === 10 ? { wordCount: 2 } : {}),
        }));
      }
      return ids;
    });
    expect(await t.mutation(backfill, {})).toMatchObject({ scanned: 10, updated: 10, isDone: false });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const counts = await t.run(async (ctx) => Promise.all(ids.map(async (id) => (await ctx.db.get(id))?.wordCount)));
    expect(counts).toEqual([0, ...Array(10).fill(2)]);
    expect(await t.mutation(backfill, {})).toMatchObject({ updated: 0 });
  });
});
