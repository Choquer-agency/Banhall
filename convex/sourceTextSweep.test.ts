/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { companyFileTextFacts, insertCompanyFileTextPieces } from "./lib/companyFileText";

const modules = import.meta.glob("./**/*.ts");

/**
 * B1, second part (2026-10-27): a company file's stored text versions stay
 * while the file exists or any draft row uses them, and go (version and
 * pieces) once neither holds. A project's versions go with the project.
 * Every name and passage here is fictional.
 */

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { authId: "sweep-admin", role: "admin" });
    const clientId = await ctx.db.insert("clients", {
      name: "Acme Seals", nameKey: "acme seals", status: "active", createdBy: userId, createdAt: now, updatedAt: now,
    });
    const projectId = await ctx.db.insert("projects", {
      title: "Seals", clientName: "Acme Seals", clientId, status: "draft", createdBy: userId, shareToken: "sweep", createdAt: now, updatedAt: now,
    });
    const generationId = await ctx.db.insert("generations", { projectId, status: "completed", startedAt: now });
    const text = "Acme Seals background: founded to make high-pressure seals.";
    const companyFileId = await ctx.db.insert("companyFiles", {
      clientId, fileName: "background.txt", fileType: "txt", ...(await companyFileTextFacts(text)),
      processingStatus: "ready", uploadedBy: userId, createdAt: now,
    });
    await insertCompanyFileTextPieces(ctx, companyFileId, text);
    const version = async (pieces: number) => {
      const versionId = await ctx.db.insert("sourceTextVersions", {
        companyFileId, clientId, textHash: `h${pieces}`, textLength: pieces, textBytes: pieces, createdAt: now,
      });
      for (let start = 0; start < pieces; start += 1) {
        await ctx.db.insert("sourceTextVersionPieces", { versionId, companyFileId, start, text: "x" });
      }
      return versionId;
    };
    const used = await version(3);
    // More pieces than one cleanup page.
    const unused = await version(150);
    await ctx.db.insert("generationSources", {
      generationId, projectId, kind: "company_file", companyFileId, clientId, label: "background:background.txt",
      textVersionId: used, textLength: 3, contentHash: "h3", truncated: false, originalLength: 3, capturedAt: now,
    });
    return { userId, clientId, projectId, generationId, companyFileId, used, unused };
  });
  const versions = () => t.run((ctx) => ctx.db.query("sourceTextVersions").collect());
  const pieces = (versionId: Id<"sourceTextVersions">) =>
    t.run(async (ctx) =>
      (await ctx.db.query("sourceTextVersionPieces").withIndex("by_versionId_and_start", (q) => q.eq("versionId", versionId)).collect()).length
    );
  return { t, ...ids, admin: t.withIdentity({ subject: "sweep-admin" }), versions, pieces };
}

describe("company file text versions (B1, second part)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("are all kept while the file exists", async () => {
    const s = await setup();
    await s.t.mutation(internal.sourceTextSweep.sweepCompanyTextVersions, {});
    await s.t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect((await s.versions()).map((row) => row._id).sort()).toEqual([s.used, s.unused].sort());
  });

  it("once the file is removed: a version a draft uses is kept, one no draft uses goes with all its pieces", async () => {
    const s = await setup();
    await s.admin.mutation(api.companyFiles.removeCompanyFile, { companyFileId: s.companyFileId });
    await s.t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect((await s.versions()).map((row) => row._id)).toEqual([s.used]);
    expect(await s.pieces(s.used)).toBe(3);
    expect(await s.pieces(s.unused)).toBe(0);
  });

  it("the daily sweep removes a version once the last draft using it is erased, and leaves other pieces alone", async () => {
    const s = await setup();
    await s.admin.mutation(api.companyFiles.removeCompanyFile, { companyFileId: s.companyFileId });
    await s.t.finishAllScheduledFunctions(() => vi.runAllTimers());
    // A project's own version with the same text is a different row.
    const projectVersion = await s.t.run(async (ctx) => {
      const versionId = await ctx.db.insert("sourceTextVersions", {
        projectId: s.projectId, textHash: "h3", textLength: 3, textBytes: 3, createdAt: 1,
      });
      await ctx.db.insert("sourceTextVersionPieces", { versionId, projectId: s.projectId, start: 0, text: "xyz" });
      return versionId;
    });
    // The draft goes (its project erased, rows deleted).
    await s.t.run(async (ctx) => {
      for (const row of await ctx.db.query("generationSources").collect()) await ctx.db.delete(row._id);
    });
    await s.t.mutation(internal.sourceTextSweep.sweepCompanyTextVersions, {});
    await s.t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect((await s.versions()).map((row) => row._id)).toEqual([projectVersion]);
    expect(await s.pieces(s.used)).toBe(0);
    expect(await s.pieces(projectVersion)).toBe(1);
  });

  it("goes page by page past one sweep page", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      for (let index = 0; index < 60; index += 1) {
        await ctx.db.insert("sourceTextVersions", {
          companyFileId: s.companyFileId, clientId: s.clientId, textHash: `many-${index}`, textLength: 1, textBytes: 1, createdAt: 1,
        });
      }
    });
    await s.admin.mutation(api.companyFiles.removeCompanyFile, { companyFileId: s.companyFileId });
    await s.t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect((await s.versions()).map((row) => row._id)).toEqual([s.used]);
  });
});
