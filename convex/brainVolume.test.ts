/// <reference types="vite/client" />
// The Brain at volume (2026-11-17): the paged admin list and the stored
// counts never read a source's text, the counts always equal a recount,
// re-embedding runs as a chain of pages, and dedup respects a source's status.
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import schema from "./schema";
import {
  CARD_BACKFILL_PAGE_SIZE,
  RECOUNT_PAGE_SIZE,
  REQUEUE_PAGE_SIZE,
  brainStats,
  listBrainSources,
  requeueAllApprovedEmbeds,
  revokedMatchMessage,
} from "./brain";
import { insertBrainSource, patchBrainSource } from "./ai/brain/rag";
import { classify } from "./lib/ingestionClassify";
import workpoolSchema from "../node_modules/@convex-dev/workpool/src/component/schema.js";

const modules = import.meta.glob("./**/*.ts");
const workpoolModules = import.meta.glob("../node_modules/@convex-dev/workpool/src/component/**/*.ts");
type T = ReturnType<typeof convexTest<typeof schema.tables>>;
type Status = Doc<"brainSources">["status"];

beforeEach(() => {
  // Approving queues an embed; fake timers keep it (and every other
  // scheduled job) waiting, so each test runs only what it means to.
  vi.useFakeTimers();
  vi.stubEnv("VOYAGE_API_KEY", "test-voyage-key");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function setup() {
  const t = convexTest(schema, modules);
  t.registerComponent("embedPool", workpoolSchema, workpoolModules);
  await t.run(async (ctx) => {
    await ctx.db.insert("users", { authId: "volume-admin", role: "admin", name: "Admin" });
    await ctx.db.insert("users", { authId: "volume-writer", role: "writer", name: "Writer" });
  });
  return {
    t,
    admin: t.withIdentity({ subject: "volume-admin" }),
    writer: t.withIdentity({ subject: "volume-writer" }),
  };
}

/** About 80 KB of text per source: 240 of them are well over the 16 MiB a read may take. */
const BIG_TEXT = "The prototype sensor drifted under repeated cold cycles. ".repeat(1400);

function sourceFields(i: number, status: Status, industry: string, extra: Partial<Doc<"brainSources">> = {}) {
  return {
    kind: "pd_pair" as const,
    status,
    title: `Fixture PD ${i}`,
    industry,
    writerTier: 0.7,
    docType: "pd",
    content: `${i} ${extra.content ?? BIG_TEXT}`,
    ragKey: `pd_pair:fixture-${i}`,
    sourceHash: `fixture-${i}`,
    createdBy: "volume-admin",
    createdAt: 1_700_000_000_000 + i,
    ...extra,
  };
}

/** Seed sources through the one write path, as every live write does. */
async function seedSources(
  t: T,
  specs: Array<{ status: Status; industry: string; ragEntryId?: string }>,
  options: { content?: string } = {}
) {
  const ids: Id<"brainSources">[] = [];
  for (let start = 0; start < specs.length; start += 40) {
    const batch = specs.slice(start, start + 40);
    ids.push(
      ...(await t.run(async (ctx) => {
        const out: Id<"brainSources">[] = [];
        for (const [offset, spec] of batch.entries()) {
          const i = start + offset;
          out.push(
            await insertBrainSource(
              ctx,
              sourceFields(i, spec.status, spec.industry, {
                ...(spec.ragEntryId ? { ragEntryId: spec.ragEntryId } : {}),
                ...(options.content ? { content: options.content } : {}),
              })
            )
          );
        }
        return out;
      }))
    );
  }
  return ids;
}

/** Counts worked out by hand from every source row. */
async function recount(t: T) {
  return await t.run(async (ctx) => {
    const status: Record<string, number> = { approved: 0, pending: 0, revoked: 0 };
    const byIndustry: Record<string, number> = {};
    for await (const row of ctx.db.query("brainSources")) {
      status[row.status] += 1;
      if (row.status === "approved") byIndustry[row.industry] = (byIndustry[row.industry] ?? 0) + 1;
    }
    return { approved: status.approved, pending: status.pending, revoked: status.revoked, byIndustry };
  });
}

/** Every card matches its source, and every source has exactly one card. */
async function expectCardsInStep(t: T) {
  await t.run(async (ctx) => {
    const sources = await ctx.db.query("brainSources").collect();
    const cards = await ctx.db.query("brainSourceCards").collect();
    expect(cards).toHaveLength(sources.length);
    for (const source of sources) {
      const card = cards.find((c) => c.sourceId === source._id);
      expect(card).toMatchObject({
        status: source.status,
        title: source.title,
        industry: source.industry,
        writerTier: source.writerTier,
        createdAt: source.createdAt,
      });
      expect(card?.ragEntryId).toBe(source.ragEntryId);
      expect(card?.scienceCode).toBe(source.scienceCode);
    }
  });
}

/**
 * A ctx whose db records every table queried and every source row fetched,
 * so a test can show a read never touched `brainSources` (or its text).
 */
function spyOn<C extends QueryCtx | MutationCtx>(ctx: C) {
  const tables: string[] = [];
  const sourceRowsRead: string[] = [];
  const db = new Proxy(ctx.db, {
    get(target, prop, receiver) {
      if (prop === "query") {
        return (table: string) => {
          tables.push(table);
          return (target.query as (name: string) => unknown)(table);
        };
      }
      if (prop === "get") {
        return async (...args: unknown[]) => {
          const doc = await (target.get as (...a: unknown[]) => Promise<{ _id: string } | null>)(...args);
          if (doc && ctx.db.normalizeId("brainSources", doc._id)) sourceRowsRead.push(doc._id);
          return doc;
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { ctx: { ...ctx, db } as C, tables, sourceRowsRead };
}

type Handler<A, R> = { _handler: (ctx: unknown, args: A) => Promise<R> };
const handlerOf = <A, R>(fn: unknown) => (fn as Handler<A, R>)._handler;

/** Run the card backfill to its last page directly, as the owner does after deploy. */
async function backfillToEnd(t: T) {
  let cursor: string | null = null;
  let synced = 0;
  for (;;) {
    const page: { done: boolean; continueCursor: string; total: number } = await t.mutation(
      internal.brain.backfillBrainSourceCards,
      { cursor, synced }
    );
    if (page.done) return page;
    cursor = page.continueCursor;
    synced = page.total;
  }
}

/** Run every pending scheduled job of `name` (by calling it with its arguments) until none is left. */
async function drive(t: T, name: string, fn: unknown) {
  const done = new Set<string>();
  const results: unknown[] = [];
  for (;;) {
    const jobs = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    const next = jobs.find((job) => job.name.endsWith(`:${name}`) && job.state.kind === "pending" && !done.has(job._id));
    if (!next) return results;
    done.add(next._id);
    const run = t.mutation as (f: unknown, args: unknown) => Promise<unknown>;
    results.push(await run(fn, next.args[0]));
  }
}

async function scheduledCount(t: T, name: string) {
  const jobs = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
  return jobs.filter((job) => job.name.endsWith(`:${name}`)).length;
}

describe("the admin list and stats at volume", () => {
  test("240 sources with large text: a list page and the stats read no source row", async () => {
    const { t } = await setup();
    const specs = Array.from({ length: 240 }, (_, i) => ({
      status: (i % 3 === 0 ? "pending" : i % 3 === 1 ? "approved" : "revoked") as Status,
      industry: i % 2 === 0 ? "software" : "manufacturing",
    }));
    await seedSources(t, specs);
    const totalText = await t.run(async (ctx) => {
      let chars = 0;
      for await (const row of ctx.db.query("brainSources")) chars += row.content.length;
      return chars;
    });
    expect(totalText).toBeGreaterThan(16 * 1024 * 1024);

    const admin = t.withIdentity({ subject: "volume-admin" });
    await admin.run(async (ctx) => {
      // Control: the spy sees a read of the sources, by query and by id.
      const control = spyOn(ctx);
      const [one] = await control.ctx.db.query("brainSources").take(1);
      await control.ctx.db.get(one._id);
      expect(control.tables).toContain("brainSources");
      expect(control.sourceRowsRead).toEqual([one._id]);

      const list = spyOn(ctx);
      const page = await handlerOf<unknown, { page: Array<{ _id: string }>; isDone: boolean }>(listBrainSources)(
        list.ctx,
        { status: "approved", paginationOpts: { numItems: 50, cursor: null } }
      );
      expect(page.page).toHaveLength(50);
      expect(page.isDone).toBe(false);
      expect(list.tables).not.toContain("brainSources");
      expect(list.sourceRowsRead).toEqual([]);

      const stats = spyOn(ctx);
      const counts = await handlerOf<unknown, unknown>(brainStats)(stats.ctx, {});
      expect(counts).toEqual({
        approved: 80,
        pending: 80,
        revoked: 80,
        byIndustry: { software: 40, manufacturing: 40 },
      });
      expect(stats.tables).not.toContain("brainSources");
      expect(stats.sourceRowsRead).toEqual([]);
    });
    expect(await admin.query(api.brain.brainStats, {})).toEqual(await recount(t));
  });

  test("pages cover every row of a status once, newest first, and keep the row shape", async () => {
    const { t, admin } = await setup();
    const specs = Array.from({ length: 130 }, (_, i) => ({
      status: (i % 5 === 0 ? "revoked" : "approved") as Status,
      industry: "software",
      ...(i === 7 ? { ragEntryId: "entry-7" } : {}),
    }));
    await seedSources(t, specs);

    const seen: Array<{ _id: string; createdAt: number; status: string; hasEntry: boolean; title: string }> = [];
    let cursor: string | null = null;
    let pages = 0;
    for (;;) {
      const result: { page: typeof seen; isDone: boolean; continueCursor: string } = await admin.query(
        api.brain.listBrainSources,
        { status: "approved", paginationOpts: { numItems: 40, cursor } }
      );
      seen.push(...result.page);
      pages += 1;
      if (result.isDone) break;
      cursor = result.continueCursor;
    }
    expect(pages).toBe(3);
    expect(seen).toHaveLength(104);
    expect(new Set(seen.map((r) => r._id)).size).toBe(104);
    expect(seen.every((r) => r.status === "approved")).toBe(true);
    const times = seen.map((r) => r.createdAt);
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(seen.find((r) => r.title === "Fixture PD 7")?.hasEntry).toBe(true);
    expect(seen.find((r) => r.title === "Fixture PD 8")?.hasEntry).toBe(false);
    expect(Object.keys(seen[0]).sort()).toEqual(
      ["_id", "craOutcome", "createdAt", "docType", "hasEntry", "industry", "kind", "scienceCode",
        "status", "title", "writerName", "writerTier"].sort()
    );

    // No status: every row, newest first.
    const all = await admin.query(api.brain.listBrainSources, { paginationOpts: { numItems: 200, cursor: null } });
    expect(all.page).toHaveLength(130);
    expect(all.page[0].title).toBe("Fixture PD 129");
  });

  test("a non-admin gets an empty last page and null stats", async () => {
    const { t, writer } = await setup();
    await seedSources(t, [{ status: "approved", industry: "software" }]);
    expect(
      await writer.query(api.brain.listBrainSources, { paginationOpts: { numItems: 10, cursor: null } })
    ).toEqual({ page: [], isDone: true, continueCursor: "" });
    expect(await writer.query(api.brain.brainStats, {})).toBeNull();
    expect(await t.query(api.brain.brainStats, {})).toBeNull();
  });
});

describe("stored counts", () => {
  test("stay equal to a hand recount through import, approve, reweight, embed, revoke and delete", async () => {
    const { t, admin } = await setup();
    const base = { writerTier: 0.4, docType: "pd" };
    const a = await admin.mutation(api.brain.importPdPair, { ...base, title: "Alpha", industry: "software", content: "Alpha text", approve: true });
    const b = await admin.mutation(api.brain.importPdPair, { ...base, title: "Bravo", industry: "software", content: "Bravo text" });
    const c = await admin.mutation(api.brain.importPdPair, { ...base, title: "Charlie", industry: "biotech", content: "Charlie text", approve: true });
    const d = await admin.mutation(api.brain.importPdPair, { ...base, title: "Delta", industry: "biotech", content: "Delta text" });
    expect(await admin.query(api.brain.brainStats, {})).toEqual(await recount(t));
    expect(await admin.query(api.brain.brainStats, {})).toMatchObject({ approved: 2, pending: 2, byIndustry: { software: 1, biotech: 1 } });

    await admin.mutation(api.brain.approveSource, { sourceId: b });
    await admin.mutation(api.brain.reweightSource, { sourceId: b, writerTier: 0.9 });
    // An embed finishing writes the entry id through the same path.
    await t.run(async (ctx) => {
      const row = await ctx.db.get(c);
      await patchBrainSource(ctx, row!, { ragEntryId: "entry-c" });
    });
    expect(await admin.query(api.brain.brainStats, {})).toEqual(await recount(t));
    await expectCardsInStep(t);

    await admin.mutation(api.brain.revokeSource, { sourceId: c });
    await t.mutation(internal.brain.recordUnlearnConfirmed, { ragEntryId: "entry-c", sourceId: c });
    await admin.mutation(api.brain.revokeSource, { sourceId: a });
    await t.mutation(internal.brain.removeSourcePermanently, { sourceId: d });
    await t.mutation(internal.brain.removeSourcePermanently, { sourceId: a });

    const stats = await admin.query(api.brain.brainStats, {});
    expect(stats).toEqual(await recount(t));
    expect(stats).toEqual({ approved: 1, pending: 0, revoked: 1, byIndustry: { software: 1 } });
    await expectCardsInStep(t);
    const cards = await t.run((ctx) => ctx.db.query("brainSourceCards").collect());
    expect(cards.find((card) => card.sourceId === c)?.ragEntryId).toBeUndefined();
    // A count that reached 0 is removed, so no stale row lingers.
    const counts = await t.run((ctx) => ctx.db.query("brainSourceCounts").collect());
    expect(counts.every((row) => row.count > 0)).toBe(true);
    expect(counts.some((row) => row.scope === "industry" && row.key === "biotech")).toBe(false);
  });

  test("the backfill builds cards and counts for older rows, page by page, and never double counts", async () => {
    const { t, admin } = await setup();
    // Rows written before the cards existed: straight into the table.
    const ids = await t.run(async (ctx) => {
      const out: Id<"brainSources">[] = [];
      for (let i = 0; i < 37; i++) {
        const status: Status = i % 4 === 0 ? "pending" : i % 4 === 3 ? "revoked" : "approved";
        out.push(await ctx.db.insert("brainSources", sourceFields(i, status, i % 3 === 0 ? "agritech" : "software")));
      }
      return out;
    });
    expect(await admin.query(api.brain.brainStats, {})).toEqual({ approved: 0, pending: 0, revoked: 0, byIndustry: {} });

    const first = await t.mutation(internal.brain.backfillBrainSourceCards, {});
    expect(first).toMatchObject({ synced: CARD_BACKFILL_PAGE_SIZE, done: false });
    // An Admin approves a not yet backfilled pending row mid-run.
    await admin.mutation(api.brain.approveSource, { sourceId: ids[36] });
    const rest = (await drive(t, "backfillBrainSourceCards", internal.brain.backfillBrainSourceCards)) as Array<{ synced: number; done: boolean }>;
    expect(rest.at(-1)?.done).toBe(true);
    expect(first.synced + rest.reduce((n, r) => n + r.synced, 0)).toBe(37);
    // The last page carries the running total and writes the "cards ready" marker.
    expect(rest.at(-1)).toMatchObject({ total: 37 });
    const marker = await t.run((ctx) =>
      ctx.db.query("brainSourceCounts").withIndex("by_scope_and_key", (q) => q.eq("scope", "meta").eq("key", "cards_ready")).unique()
    );
    expect(marker?.count).toBe(37);
    expect(await admin.query(api.brain.brainStats, {})).toEqual(await recount(t));
    await expectCardsInStep(t);

    // Running it again changes nothing.
    expect(await backfillToEnd(t)).toMatchObject({ total: 37 });
    expect(await admin.query(api.brain.brainStats, {})).toEqual(await recount(t));
    await expectCardsInStep(t);
  });

  test("the recount repairs broken counts, page by page, and a missing row is logged", async () => {
    const { t, admin } = await setup();
    const specs = Array.from({ length: RECOUNT_PAGE_SIZE + 20 }, (_, i) => ({
      status: (i % 4 === 0 ? "pending" : i % 4 === 3 ? "revoked" : "approved") as Status,
      industry: i % 2 === 0 ? "agritech" : "software",
    }));
    const ids = await seedSources(t, specs, { content: "short text" });
    const good = await recount(t);
    expect(await admin.query(api.brain.brainStats, {})).toEqual(good);

    // Break the counts three ways: a wrong number, a missing row, a stray row.
    await t.run(async (ctx) => {
      const rows = await ctx.db.query("brainSourceCounts").collect();
      const approved = rows.find((r) => r.scope === "status" && r.key === "approved")!;
      await ctx.db.patch(approved._id, { count: 9999 });
      await ctx.db.delete(rows.find((r) => r.scope === "status" && r.key === "pending")!._id);
      await ctx.db.insert("brainSourceCounts", { scope: "industry", key: "made-up industry", count: 4 });
    });
    // Rejecting a pending source now takes from a missing row: logged, not thrown.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await admin.mutation(api.brain.revokeSource, { sourceId: ids[0] });
    expect(warn.mock.calls.some(([line]) => String(line).includes("no status:pending row"))).toBe(true);
    warn.mockRestore();
    expect(await admin.query(api.brain.brainStats, {})).not.toEqual(await recount(t));

    const first = await t.mutation(internal.brain.recountBrainSourceCounts, {});
    expect(first).toEqual({ done: false, changed: 0 });
    const rest = (await drive(t, "recountBrainSourceCounts", internal.brain.recountBrainSourceCounts)) as Array<{ done: boolean; changed: number }>;
    expect(rest.at(-1)?.done).toBe(true);
    expect(rest.at(-1)?.changed).toBeGreaterThanOrEqual(3);
    expect(await admin.query(api.brain.brainStats, {})).toEqual(await recount(t));
  });
});

describe("requeueAllApprovedEmbeds", () => {
  test("refuses to start before the card backfill has finished", async () => {
    const { t } = await setup();
    await seedSources(t, [{ status: "approved", industry: "software" }], { content: "short text" });
    await expect(t.mutation(internal.brain.requeueAllApprovedEmbeds, {})).rejects.toThrow(
      /backfillBrainSourceCards to the end first/
    );
    expect(await scheduledCount(t, "requeueAllApprovedEmbeds")).toBe(0);
    await backfillToEnd(t);
    expect(await t.mutation(internal.brain.requeueAllApprovedEmbeds, {})).toEqual({ requeued: 1, done: true });
  });

  test("re-queues every approved source in a chain of pages, without reading source rows", async () => {
    const { t } = await setup();
    // 108 approved: two full pages and a short last one.
    const specs = Array.from({ length: 130 }, (_, i) => ({
      status: (i % 6 === 0 ? "pending" : "approved") as Status,
      industry: "software",
      ...(i % 10 === 1 ? { ragEntryId: `entry-${i}` } : {}),
    }));
    await seedSources(t, specs, { content: "short text" });
    await backfillToEnd(t);
    const approved = specs.filter((s) => s.status === "approved").length;
    const withEntry = specs.filter((s) => s.status === "approved" && s.ragEntryId).length;

    const spy = await t.run(async (ctx) => {
      const s = spyOn(ctx);
      const first = await handlerOf<unknown, { requeued: number; done: boolean }>(requeueAllApprovedEmbeds)(s.ctx, {});
      return { first, tables: s.tables, sourceRowsRead: s.sourceRowsRead };
    });
    expect(spy.first).toEqual({ requeued: REQUEUE_PAGE_SIZE, done: false });
    expect(spy.tables).not.toContain("brainSources");
    expect(spy.sourceRowsRead).toEqual([]);

    const rest = (await drive(t, "requeueAllApprovedEmbeds", internal.brain.requeueAllApprovedEmbeds)) as Array<{ requeued: number; done: boolean }>;
    expect(rest.map((r) => r.done)).toEqual([false, true]);
    expect(spy.first.requeued + rest.reduce((n, r) => n + r.requeued, 0)).toBe(approved);
    expect(await scheduledCount(t, "unlearnSource")).toBe(withEntry);
  });
});

/** Stage an import file and read it, so it waits in review (as the old page sees it). */
async function stageItem(t: T, name: string, contentHash: string) {
  const path = `Northwind Kelp/2024 - Dec 31/${name}`;
  const segments = path.split("/");
  const file = segments.pop()!;
  const meta = classify(segments.join("/"), file);
  const id = await t.mutation(internal.ingestion.upsertDiscoveredItem, {
    driveItemId: `drive-${name}`,
    path,
    name: file,
    clientName: meta.clientName,
    fiscalYearLabel: meta.fiscalYearLabel,
    fiscalYear: meta.fiscalYear,
    docKind: meta.docKind,
    size: 2048,
    lastModifiedAt: 1_700_000_000_000,
    contentHash,
    pairGroupKey: meta.pairGroupKey,
  });
  const itemId = id ?? (await t.run(async (ctx) =>
    (await ctx.db.query("ingestionItems").withIndex("by_driveItemId", (q) => q.eq("driveItemId", `drive-${name}`)).unique())!._id
  ));
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["bytes"])));
  await t.mutation(internal.ingestion.markItemProcessed, { itemId, storageId, text: "Extracted text" });
  return itemId;
}

async function approveItem(
  admin: ReturnType<T["withIdentity"]>,
  itemId: Id<"ingestionItems">,
  content: string
) {
  return await admin.mutation(internal.ingestion.finalizeApproval, {
    itemId,
    content,
    industry: "Aquaculture",
    writerTier: 0.5,
  });
}

function refusal(err: unknown) {
  return err instanceof ConvexError ? (err.data as { code: string; message: string }) : null;
}

describe("dedup that respects status", () => {
  const base = { writerTier: 0.4, docType: "pd", industry: "software" };

  test("a pending match is reused and approved when the caller approves", async () => {
    const { t, admin } = await setup();
    const first = await admin.mutation(api.brain.importPdPair, { ...base, title: "Kelp PD", content: "Same text" });
    const again = await admin.mutation(api.brain.importPdPair, { ...base, title: "Kelp PD again", content: "Same text", approve: true });
    expect(again).toBe(first);
    const rows = await t.run((ctx) => ctx.db.query("brainSources").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("approved");
    const audit = await t.run((ctx) => ctx.db.query("brainAuditLog").collect());
    expect(audit.filter((row) => row.action === "approve" && row.sourceId === first)).toHaveLength(1);
    expect(await admin.query(api.brain.brainStats, {})).toEqual(await recount(t));
  });

  test("a pending match stays pending when the caller does not approve", async () => {
    const { t, admin } = await setup();
    const first = await admin.mutation(api.brain.importPdPair, { ...base, title: "Kelp PD", content: "Same text" });
    expect(await admin.mutation(api.brain.importPdPair, { ...base, title: "Kelp PD", content: "Same text" })).toBe(first);
    const rows = await t.run((ctx) => ctx.db.query("brainSources").collect());
    expect(rows.map((row) => row.status)).toEqual(["pending"]);
  });

  test("an approved match is reused with no new row or audit", async () => {
    const { t, admin } = await setup();
    const first = await admin.mutation(api.brain.importPdPair, { ...base, title: "Kelp PD", content: "Same text", approve: true });
    const auditBefore = await t.run((ctx) => ctx.db.query("brainAuditLog").collect());
    expect(await admin.mutation(api.brain.importPdPair, { ...base, title: "Kelp PD", content: "Same text", approve: true })).toBe(first);
    expect(await t.run((ctx) => ctx.db.query("brainSources").collect())).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.query("brainAuditLog").collect())).toHaveLength(auditBefore.length);
  });

  test("a revoked match is refused in plain words and nothing is approved or added", async () => {
    const { t, admin } = await setup();
    const first = await admin.mutation(api.brain.importPdPair, { ...base, title: "Kelp PD", content: "Same text", approve: true });
    await admin.mutation(api.brain.revokeSource, { sourceId: first });
    const statsBefore = await admin.query(api.brain.brainStats, {});

    const err = await admin
      .mutation(api.brain.importPdPair, { ...base, title: "Kelp PD", content: "Same text", approve: true })
      .catch((e: unknown) => e);
    expect(refusal(err)).toMatchObject({
      code: "BRAIN_SOURCE_REVOKED",
      message: "This PD matches a Brain source an Admin removed from the Brain, so it cannot be approved here.",
    });
    const rows = await t.run((ctx) => ctx.db.query("brainSources").collect());
    expect(rows.map((row) => row.status)).toEqual(["revoked"]);
    expect(await admin.query(api.brain.brainStats, {})).toEqual(statsBefore);

    // The CLI seed path refuses the same way, and a nomination is a no-op.
    const seedErr = await t
      .mutation(internal.brain.seedPdPair, { ...base, title: "Kelp PD", content: "Same text", approve: true })
      .catch((e: unknown) => e);
    expect(refusal(seedErr)?.code).toBe("BRAIN_SOURCE_REVOKED");
    expect(await t.run((ctx) => ctx.db.query("brainSources").collect())).toHaveLength(1);
  });

  test("the old import approve links the file, matches by its content hash, and refuses a revoked match", async () => {
    const { t, admin } = await setup();
    const one = await stageItem(t, "04 NorthwindKelp 2024-12-31 T2.DW.PN KelpDryer.docx", "bytes-a");
    const sourceId = await approveItem(admin, one, "Kelp dryer text");
    const source = await t.run((ctx) => ctx.db.get(sourceId));
    expect(source).toMatchObject({ status: "approved", importItemId: one, importContentHash: "bytes-a" });
    const byItem = await t.run((ctx) =>
      ctx.db.query("brainSources").withIndex("by_importItemId", (q) => q.eq("importItemId", one)).collect()
    );
    expect(byItem.map((row) => row._id)).toEqual([sourceId]);

    // The same file staged again, read with different text: matched by bytes.
    const two = await stageItem(t, "04 NorthwindKelp 2024-12-31 T2.DW.PN KelpDryer copy.docx", "bytes-a");
    expect(await approveItem(admin, two, "Kelp dryer text, read again")).toBe(sourceId);
    expect(await t.run((ctx) => ctx.db.get(two))).toMatchObject({ status: "approved", brainSourceId: sourceId });
    expect(await t.run((ctx) => ctx.db.query("brainSources").collect())).toHaveLength(1);

    // Revoked: a third copy of the same bytes is refused and stays in review.
    await admin.mutation(api.brain.revokeSource, { sourceId });
    const three = await stageItem(t, "04 NorthwindKelp 2024-12-31 T2.DW.PN KelpDryer final.docx", "bytes-a");
    const err = await approveItem(admin, three, "Different text entirely").catch((e: unknown) => e);
    // The classifier reads these test files as supporting files, so the words say "file".
    expect(refusal(err)).toMatchObject({
      code: "BRAIN_SOURCE_REVOKED",
      message: "This file matches a Brain source an Admin removed from the Brain, so it cannot be approved here.",
    });
    const item = await t.run((ctx) => ctx.db.get(three));
    expect(item?.status).toBe("pending_review");
    expect(item?.brainSourceId).toBeUndefined();
    expect(await t.run((ctx) => ctx.db.query("brainSources").collect())).toHaveLength(1);
    expect(await admin.query(api.brain.brainStats, {})).toEqual(await recount(t));
  });

  test("a file matched by text gains the content hash, and a pending match from a file is approved", async () => {
    const { t, admin } = await setup();
    const pending = await admin.mutation(api.brain.importPdPair, { ...base, title: "Kelp PD", content: "Shared kelp text" });
    const item = await stageItem(t, "04 NorthwindKelp 2024-12-31 T2.DW.PN KelpPress.docx", "bytes-b");
    expect(await approveItem(admin, item, "Shared kelp text")).toBe(pending);
    expect(await t.run((ctx) => ctx.db.get(pending))).toMatchObject({
      status: "approved",
      importItemId: item,
      importContentHash: "bytes-b",
    });
    await expectCardsInStep(t);
  });

  test("a rejected nomination is refused as rejected; an older revoke with no reason says either", async () => {
    const { t, admin } = await setup();
    const pending = await admin.mutation(api.brain.importPdPair, { ...base, title: "Kelp PD", content: "Rejected text" });
    // "Reject" on the queue is a revoke of a pending source.
    await admin.mutation(api.brain.revokeSource, { sourceId: pending });
    expect(await t.run((ctx) => ctx.db.get(pending))).toMatchObject({ status: "revoked", revokedFromStatus: "pending" });
    const err = await admin
      .mutation(api.brain.importPdPair, { ...base, title: "Kelp PD", content: "Rejected text", approve: true })
      .catch((e: unknown) => e);
    expect(refusal(err)?.message).toBe(
      "This PD matches a Brain source an Admin rejected, so it cannot be approved here."
    );

    // A row revoked before the reason was stored, matched by a transcript.
    const old = await admin.mutation(api.brain.importPdPair, { ...base, docType: "transcript", title: "Call", content: "Old call text" });
    await t.run(async (ctx) => {
      await patchBrainSource(ctx, (await ctx.db.get(old))!, { status: "revoked" });
    });
    const transcriptErr = await admin
      .mutation(api.brain.importPdPair, { ...base, docType: "transcript", title: "Call", content: "Old call text", approve: true })
      .catch((e: unknown) => e);
    expect(refusal(transcriptErr)?.message).toBe(
      "This transcript matches a Brain source that was rejected or removed, so it cannot be approved here."
    );
    expect(revokedMatchMessage("supporting_doc", "approved")).toBe(
      "This file matches a Brain source an Admin removed from the Brain, so it cannot be approved here."
    );
    expect(await admin.query(api.brain.brainStats, {})).toEqual(await recount(t));
  });

  test("approving a pending match takes the approver's industry, tier, writer and title", async () => {
    const { t, admin } = await setup();
    const pending = await admin.mutation(api.brain.importPdPair, {
      ...base,
      industry: "general",
      writerTier: 0.4,
      writerName: "Pat Example",
      title: "Nominated draft",
      content: "Press line text",
    });
    const item = await stageItem(t, "04 NorthwindKelp 2024-12-31 T2.DW.PN PressLine.docx", "bytes-c");
    expect(
      await admin.mutation(internal.ingestion.finalizeApproval, {
        itemId: item,
        content: "Press line text",
        industry: "manufacturing",
        writerName: "Robin Sample",
        writerTier: 0.9,
      })
    ).toBe(pending);
    const row = await t.run((ctx) => ctx.db.get(pending));
    expect(row).toMatchObject({ status: "approved", industry: "manufacturing", writerTier: 0.9, writerName: "Robin Sample" });
    expect(row?.title).toContain("PressLine");
    const stats = await admin.query(api.brain.brainStats, {});
    expect(stats).toEqual(await recount(t));
    expect(stats?.byIndustry).toEqual({ manufacturing: 1 });
    await expectCardsInStep(t);
  });
});

describe("one write path", () => {
  // Only the table-name forms can be caught: an id-only `ctx.db.patch(id, ...)`
  // or `ctx.db.delete(id)` names no table, so review must catch those.
  test("no module outside convex/ai/brain/rag.ts writes a brainSources row by table name", async () => {
    const sources = import.meta.glob(["./**/*.ts", "!./**/*.test.ts", "!./_generated/**"], {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>;
    const writers = Object.entries(sources)
      .filter(([, text]) => /db\.(insert|patch|replace|delete)\(\s*"brainSources"/.test(text))
      .map(([path]) => path);
    expect(writers).toEqual(["./ai/brain/rag.ts"]);
  });
});
