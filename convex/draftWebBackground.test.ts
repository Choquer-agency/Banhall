/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import {
  draftWebBackgroundOutcome,
  draftWebBackgroundRefs,
  type DraftWebBackgroundDeps,
} from "./ai/draftWebBackgroundRun";
import { PUBLIC_BACKGROUND_LABEL } from "../shared/humanProse";
import { resetGenerationModelCache, resetGenerationPlaceholderCache } from "./ai/providers";

/**
 * 2026-11-02 (proposed): public background before drafting. The step never
 * throws and never fails a draft; names never reach the search; the same
 * sources reuse their searches. Fictional names only.
 */
const modules = import.meta.glob("./**/*.ts");

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-placeholder-key");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected HTTP transport"); }));
  resetGenerationModelCache();
  resetGenerationPlaceholderCache();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const SOURCES = "Interviewer: What did you build?\n\nTobin Vasquez-Hale: A Selenium crawler for Quillmere Analytics, fed by PostgreSQL CDC.";

async function setup(options: { requested?: boolean | "unset" } = {}) {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  const ids = await t.run(async (ctx) => {
    const writerId = await ctx.db.insert("users", { authId: "wb-writer", role: "writer", firstName: "Odalys", lastName: "Brennecke" });
    const projectId = await ctx.db.insert("projects", {
      title: "Shelfwatch Price Crawler",
      clientName: "Quillmere Analytics Inc.",
      writer: "Odalys Brennecke",
      interviewees: ["Tobin Vasquez-Hale"],
      status: "draft",
      createdBy: writerId,
      ownerId: writerId,
      shareToken: "wb-token",
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("transcripts", { projectId, content: SOURCES, createdAt: 1, position: 0 });
    const generationId = await ctx.db.insert("generations", {
      projectId,
      status: "running",
      startedAt: 1,
      requestedBy: writerId,
      placeholders: [{ token: "[CLIENT_1]", value: "Quillmere Analytics Inc." }],
      ...(options.requested === "unset" ? {} : { webBackgroundRequested: options.requested ?? true }),
    });
    return { writerId, projectId, generationId };
  });
  type Call = (ref: unknown, args: unknown) => Promise<unknown>;
  const ctx = {
    runQuery: ((ref: unknown, args: unknown) => (t.query as unknown as Call)(ref, args)) as never,
    runMutation: ((ref: unknown, args: unknown) => (t.mutation as unknown as Call)(ref, args)) as never,
  };
  return { t, ctx, ...ids };
}

function fakeDeps(overrides: Partial<DraftWebBackgroundDeps> = {}) {
  const searched: string[] = [];
  let written = 0;
  const deps: DraftWebBackgroundDeps = {
    writeQueries: async () => {
      written += 1;
      return [
        { query: "How does log-based change data capture work in PostgreSQL?", kind: "technology" },
        { query: "Quillmere Analytics crawler architecture", kind: "technology" },
        { query: "[CLIENT_1] Selenium setup", kind: "technology" },
        { query: "How does CRA define standard practice for SR&ED?", kind: "cra" },
      ];
    },
    search: async (query) => {
      searched.push(query);
      return {
        answer: `Background for ${query}. Log-based CDC tools such as Debezium read the write-ahead log.`,
        sources: [{ url: `https://docs.example.org/${searched.length}`, title: `Doc ${searched.length}`, domain: "docs.example.org" }],
      };
    },
    now: () => Date.now(),
    ...overrides,
  };
  return { deps, searched, writes: () => written };
}

async function run(f: Awaited<ReturnType<typeof setup>>, deps: DraftWebBackgroundDeps, deploymentOn = true) {
  return await draftWebBackgroundOutcome(f.ctx, {
    generationId: f.generationId as Id<"generations">,
    projectId: f.projectId as Id<"projects">,
    sources: SOURCES,
    deps,
    deploymentOn,
  });
}

describe("public background before drafting", () => {
  it("writes queries, drops every one with a name before anything is sent, searches the rest and builds the block", async () => {
    const f = await setup();
    const fake = fakeDeps();
    const outcome = await run(f, fake.deps);
    expect(outcome.record.status).toBe("used");
    expect(fake.searched).toEqual([
      "How does log-based change data capture work in PostgreSQL?",
      "How does CRA define standard practice for SR&ED?",
    ]);
    for (const query of fake.searched) {
      expect(query).not.toMatch(/Quillmere|Tobin|Vasquez|Brennecke|Shelfwatch|CLIENT_/i);
    }
    expect(outcome.record.droppedQueries).toBe(2);
    expect(outcome.record.droppedReasons).toEqual(["names", "placeholder"]);
    expect(outcome.record.queries.map((query) => query.status)).toEqual(["ok", "ok"]);
    expect(outcome.record.sources.map((source) => source.n)).toEqual([1, 2]);
    expect(outcome.block).toContain(PUBLIC_BACKGROUND_LABEL);
    expect(outcome.block).toContain("W1 Doc 1 (docs.example.org)");
    expect(outcome.answers).toContain("Debezium");
  });

  it("reuses the saved searches for the same sources, with no new model call or search", async () => {
    const f = await setup();
    const first = fakeDeps();
    const one = await run(f, first.deps);
    const second = fakeDeps();
    const two = await run(f, second.deps);
    expect(second.writes()).toBe(0);
    expect(second.searched).toEqual([]);
    expect(two.record.cached).toBe(true);
    expect(two.record.status).toBe("used");
    expect(two.block).toBe(one.block);
    expect(two.record.sources).toEqual(one.record.sources);
  });

  it("does nothing when the writer turned it off for this draft", async () => {
    const f = await setup({ requested: false });
    const fake = fakeDeps();
    const outcome = await run(f, fake.deps);
    expect(outcome).toEqual({
      block: "",
      answers: "",
      record: { status: "off_for_run", queries: [], sources: [], droppedQueries: 0, cached: false },
    });
    expect(fake.writes()).toBe(0);
    expect(fake.searched).toEqual([]);
  });

  it("does nothing for a draft started before public background (no choice recorded)", async () => {
    const f = await setup({ requested: "unset" });
    const fake = fakeDeps();
    const outcome = await run(f, fake.deps);
    expect(outcome.record.status).toBe("off_for_run");
    expect(fake.writes()).toBe(0);
    expect(fake.searched).toEqual([]);
  });

  it("does nothing when the deployment has it off", async () => {
    const f = await setup();
    const fake = fakeDeps();
    const outcome = await run(f, fake.deps, false);
    expect(outcome.record.status).toBe("off_for_deployment");
    expect(outcome.block).toBe("");
    expect(fake.writes()).toBe(0);
  });

  it("drafts without background when every query names something", async () => {
    const f = await setup();
    const fake = fakeDeps({
      writeQueries: async () => [{ query: "Quillmere Analytics crawler", kind: "technology" }],
    });
    const outcome = await run(f, fake.deps);
    expect(outcome.record).toMatchObject({ status: "no_queries", droppedQueries: 1 });
    expect(outcome.block).toBe("");
    expect(fake.searched).toEqual([]);
  });

  it("drafts without background, and saves nothing to the cache, when every search fails", async () => {
    const f = await setup();
    const failing = fakeDeps({ search: async () => null });
    const outcome = await run(f, failing.deps);
    expect(outcome.record.status).toBe("failed");
    expect(outcome.record.queries.every((query) => query.status === "failed")).toBe(true);
    expect(outcome.block).toBe("");
    const rows = await f.t.run((ctx) => ctx.db.query("draftWebBackgrounds").take(5));
    expect(rows).toEqual([]);
    // The next draft of the same sources tries again.
    const retry = fakeDeps();
    expect((await run(f, retry.deps)).record.status).toBe("used");
    expect(retry.searched.length).toBe(2);
  });

  it("never throws: a query call that throws, or a search that throws, leaves the draft without background", async () => {
    const f = await setup();
    const broken = fakeDeps({
      writeQueries: async () => {
        throw new Error("provider down");
      },
    });
    expect((await run(f, broken.deps)).record).toMatchObject({ status: "failed", reason: "The searches could not be written." });
    const throwing = fakeDeps({
      search: async () => {
        throw new Error("network");
      },
    });
    expect((await run(f, throwing.deps)).record.status).toBe("failed");
  });

  it("stops at its time budget and drafts without background", async () => {
    const f = await setup();
    const slow = fakeDeps({ writeQueries: () => new Promise(() => undefined), budgetMs: 50 });
    const started = Date.now();
    const outcome = await run(f, slow.deps);
    expect(outcome.record.status).toBe("timed_out");
    expect(outcome.block).toBe("");
    expect(Date.now() - started).toBeLessThan(2_000);
    const hanging = fakeDeps({ search: () => new Promise(() => undefined), budgetMs: 200 });
    const late = await run(f, hanging.deps);
    expect(late.record.status).toBe("failed");
    expect(late.block).toBe("");
  });

  it("records what it did on the generation, and the writer reads the queries and sources", async () => {
    const f = await setup();
    const outcome = await run(f, fakeDeps().deps);
    await f.t.mutation(draftWebBackgroundRefs.recordWebBackground, {
      generationId: f.generationId,
      record: outcome.record,
    });
    const writer = f.t.withIdentity({ subject: "wb-writer" });
    const shown = await writer.query(api.generations.getWebBackground, { generationId: f.generationId });
    expect(shown).toEqual(outcome.record);
    // Never the answers.
    expect(JSON.stringify(shown)).not.toContain("write-ahead log");
    const stranger = f.t.withIdentity({ subject: "nobody" });
    expect(await stranger.query(api.generations.getWebBackground, { generationId: f.generationId })).toBeNull();
  });

  it("erases its cache with the project's other rows (registry entry)", async () => {
    const { PROJECT_SCOPED_TABLES } = await import("./lib/projectScopedTables");
    expect(PROJECT_SCOPED_TABLES.find((entry) => entry.table === "draftWebBackgrounds")).toMatchObject({
      disposition: "delete",
    });
  });
});

describe("the start dialog's choice", () => {
  it("is stored on the generation when the writer unticks it", async () => {
    vi.useFakeTimers();
    const f = await setup();
    await f.t.run((ctx) => ctx.db.delete(f.generationId));
    const writer = f.t.withIdentity({ subject: "wb-writer" });
    const off = await writer.mutation(api.generations.requestGeneration, {
      projectId: f.projectId,
      candidateMode: "single",
      webBackground: false,
    });
    expect((await f.t.run((ctx) => ctx.db.get(off)))?.webBackgroundRequested).toBe(false);
  });

  it("is on when an older browser sends nothing", async () => {
    vi.useFakeTimers();
    const f = await setup();
    await f.t.run((ctx) => ctx.db.delete(f.generationId));
    const writer = f.t.withIdentity({ subject: "wb-writer" });
    const on = await writer.mutation(api.generations.requestGeneration, { projectId: f.projectId, candidateMode: "single" });
    expect((await f.t.run((ctx) => ctx.db.get(on)))?.webBackgroundRequested).toBe(true);
  });
});
