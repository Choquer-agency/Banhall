/// <reference types="vite/client" />
import { readFileSync } from "node:fs";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { sha256 } from "./lib/contracts";
import { getReportBody, getPendingReportProvenance } from "./lib/reportBodies";
import { buildTiptapDocument } from "./lib/tiptapReport";

const modules = import.meta.glob("./**/*.ts");
const migration = makeFunctionReference<"mutation">("reportBodiesMigration:copyLegacyBodies");
const fixed = "It was uncertain whether the alloy would resist fatigue because its response was unknown.";
const failing = "It was uncertain whether the alloy would resist fatigue.";
const document = (s242: string, s244 = "The team tested the alloy.") =>
  JSON.stringify(buildTiptapDocument("Alloy", s242, s244, "The team learned the response."));

async function setup(content = document(fixed)) {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { authId: "body-manager", role: "manager" });
    const projectId = await ctx.db.insert("projects", {
      title: "Alloy", clientName: "Client", createdBy: userId, ownerId: userId,
      status: "review", shareToken: "body-test", createdAt: 1, updatedAt: 1,
    });
    const reportId = await ctx.db.insert("reports", {
      projectId, content, revisionNumber: 0, contentHash: await sha256(content),
      version: 1, generatedAt: 1, updatedAt: 1,
    });
    return { userId, projectId, reportId };
  });
  return { t, actor: t.withIdentity({ subject: "body-manager" }), ...ids };
}

describe("report body split", () => {
  test("legacy text reads and a save changes the body without changing report details", async () => {
    const f = await setup();
    expect(await f.actor.query(api.reports.getLatestReport, { projectId: f.projectId }))
      .toMatchObject({ _id: f.reportId, content: document(fixed), revisionNumber: 0 });
    expect(await f.t.run((ctx) => getReportBody(ctx, f.reportId))).toBeNull();
    const detailsBefore = await f.t.run((ctx) => ctx.db.get(f.reportId));
    const next = document(fixed, "The team tested two alloy samples.");
    expect(await f.actor.mutation(api.reports.updateReportContent, {
      reportId: f.reportId, content: next, expectedRevisionNumber: 0,
    })).toBe(1);
    expect(await f.t.run((ctx) => ctx.db.get(f.reportId))).toEqual(detailsBefore);
    expect(await f.t.run((ctx) => getReportBody(ctx, f.reportId)))
      .toMatchObject({ content: next, revisionNumber: 1, contentHash: await sha256(next) });
    expect(await f.actor.query(api.reports.getLatestReport, { projectId: f.projectId }))
      .toMatchObject({ _id: f.reportId, content: next, revisionNumber: 1, contentHash: await sha256(next) });
  });

  test("a stale follow-up cannot write findings for superseded text", async () => {
    const f = await setup();
    const latestText = document(fixed, "The robust solution was tested.");
    await f.actor.mutation(api.reports.updateReportContent, {
      reportId: f.reportId, content: document(failing), expectedRevisionNumber: 0,
    });
    await f.actor.mutation(api.reports.updateReportContent, {
      reportId: f.reportId, content: latestText, expectedRevisionNumber: 1,
    });
    const pendingJobs = await f.t.run(async (ctx) =>
      (await ctx.db.system.query("_scheduled_functions").collect()).filter(
        (job) => job.name.includes("finishReportSave") && job.state.kind === "pending"
      )
    );
    expect(pendingJobs).toHaveLength(1);
    const findings = () => f.t.run((ctx) => ctx.db.query("qaFindings").collect());
    expect(await findings()).toEqual([]);
    await f.t.mutation(internal.reports.finishReportSave, { reportId: f.reportId, revisionNumber: 1 });
    expect(await findings()).toEqual([]);
    await f.t.mutation(internal.reports.finishReportSave, { reportId: f.reportId, revisionNumber: 2 });
    const latestHash = await sha256(latestText);
    expect((await findings()).every((row) => row.revisionNumber === 2 && row.contentHash === latestHash)).toBe(true);
    const rows = await findings();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((row) => row.check === "because_clause" && row.blocking)).toBe(false);
  });

  test("a save carries reviewed claims but cannot grant approval", async () => {
    const f = await setup();
    const claim = fixed;
    const provenanceId = await f.t.run(async (ctx) => ctx.db.insert("reportProvenance", {
      projectId: f.projectId, contentHash: await sha256(document(fixed)), status: "approved",
      claims: [{ claimId: "c1", section: "242", material: true, claimText: claim,
        claimTextHash: await sha256(claim), state: "approved", sources: [] }], createdAt: 1,
    }));
    await f.t.run((ctx) => ctx.db.patch(f.reportId, { provenanceId }));
    await f.actor.mutation(api.reports.updateReportContent, {
      reportId: f.reportId, content: document(fixed, "The team tested a second alloy."), expectedRevisionNumber: 0,
    });
    const pending = await f.t.run((ctx) => getPendingReportProvenance(ctx, f.reportId));
    expect(pending?.status).toBe("needs_review");
    expect(pending?.claims.find((row) => row.claimId === "c1")?.state).toBe("approved");
    expect(pending?.claims.some((row) => row.state === "needs_review")).toBe(true);
    await f.actor.mutation(api.reports.updateReportContent, {
      reportId: f.reportId, content: document(fixed), expectedRevisionNumber: 1,
    });
    const again = await f.t.run((ctx) => getPendingReportProvenance(ctx, f.reportId));
    expect(again?.status).toBe("needs_review");
    expect(again?.claims.find((row) => row.claimId === "c1")?.state).toBe("approved");
    expect((await f.actor.query(api.reports.getProvenance, { reportId: f.reportId }))?.status).toBe("needs_review");
  });

  test("legacy migration resumes by cursor and is idempotent", async () => {
    const f = await setup();
    const ids = await f.t.run(async (ctx) => {
      const out = [f.reportId];
      for (let i = 0; i < 4; i += 1) out.push(await ctx.db.insert("reports", {
        projectId: f.projectId, content: `Legacy ${i}`, version: i + 2, generatedAt: i + 2, updatedAt: i + 2,
      }));
      return out;
    });
    const first = await f.t.mutation(migration, { cursor: null });
    expect(first).toMatchObject({ done: false, processed: 4 });
    expect(await f.t.run(async (ctx) =>
      (await ctx.db.system.query("_scheduled_functions").collect()).filter((job) =>
        job.name.includes("reportBodiesMigration:copyLegacyBodies") && job.state.kind === "pending"
      )
    )).toHaveLength(1);
    expect(await f.t.run((ctx) => getReportBody(ctx, ids[4]))).toBeNull();
    const second = await f.t.mutation(migration, { cursor: first.nextCursor });
    expect(second.done).toBe(true);
    const bodies = await f.t.run(async (ctx) => Promise.all(ids.map((id) => getReportBody(ctx, id))));
    expect(bodies.every(Boolean)).toBe(true);
    const details = await f.t.run(async (ctx) => Promise.all(ids.map((id) => ctx.db.get(id))));
    expect(details.every((row) => row?.content === undefined)).toBe(true);
    await f.t.mutation(migration, { cursor: null });
    await f.t.mutation(migration, { cursor: first.nextCursor });
    expect(await f.t.run(async (ctx) => Promise.all(ids.map((id) => getReportBody(ctx, id))))).toEqual(bodies);
  });

  test("migration keeps a newer save when a legacy row still has old text", async () => {
    const f = await setup();
    const next = document(fixed, "The team tested the new sample.");
    await f.actor.mutation(api.reports.updateReportContent, {
      reportId: f.reportId, content: next, expectedRevisionNumber: 0,
    });
    await f.t.mutation(migration, { cursor: null });
    expect(await f.t.run((ctx) => getReportBody(ctx, f.reportId)))
      .toMatchObject({ content: next, revisionNumber: 1 });
    expect((await f.t.run((ctx) => ctx.db.get(f.reportId)))?.content).toBeUndefined();
  });

  test("detail queries keep their read boundary", () => {
    for (const [file, name] of [
      ["comments.ts", "listComments"], ["chatV2.ts", "listThreads"],
      ["chatV2.ts", "listProposals"], ["research.ts", "listSessions"],
      ["myWork.ts", "getContinueWorking"], ["reportViews.ts", "listViews"],
    ]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      const start = source.indexOf(`export const ${name} = query({`);
      expect(start, `${file}:${name}`).toBeGreaterThanOrEqual(0);
      const next = source.indexOf("\nexport const ", start + 1);
      const handler = source.slice(start, next < 0 ? undefined : next);
      expect(handler, `${file}:${name}`).not.toMatch(/reportBodies|reportWithBody|readReportContent/);
    }
  });
});
