/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { sha256 } from "./lib/contracts";
import { FROZEN_TEXT_TOO_LARGE_MESSAGE, reserveGeneration } from "./lib/generations/reservation";
import { sourceRowText } from "./lib/sourceText";

const modules = import.meta.glob("./**/*.ts");

/**
 * B1, second part (2026-10-27): a draft's rows refer to their text. A
 * project file's or company file's text is stored once as a version and
 * reused by later drafts; a transcript row refers to its transcript; a draft
 * whose files would pass a transaction's writes is refused by name. Every
 * name and passage here is fictional.
 */

const TRANSCRIPT = "Priya Raman: We tuned the seal at 64 C.\nInterviewer: And then?\nPriya Raman: It held for six hours.";

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
  vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key");
});

/**
 * `transactionLimits`: Convex's own limits on every transaction, the
 * setup's included, so each large row is written in its own.
 */
async function setup(documents: string[], options: { transcripts?: string[]; transactionLimits?: boolean } = {}) {
  const t = convexTest({ schema, modules, transactionLimits: options.transactionLimits ?? false });
  rateLimiterTest.register(t);
  const now = Date.now() - 1_000;
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { authId: "writers-test", role: "writer" });
    const projectId = await ctx.db.insert("projects", {
      title: "Seals", clientName: "Quillmere", status: "draft", createdBy: userId, ownerId: userId,
      shareToken: "writers-test", createdAt: now, updatedAt: now,
    });
    return { userId, projectId };
  });
  const transcriptIds: Id<"transcripts">[] = [];
  for (const [index, content] of (options.transcripts ?? [TRANSCRIPT]).entries()) {
    transcriptIds.push(
      await t.run(async (ctx) =>
        ctx.db.insert("transcripts", {
          projectId: ids.projectId, content, contentHash: await sha256(content), label: `Interview ${index + 1}`, createdAt: now + index,
        })
      )
    );
  }
  for (const [index, content] of documents.entries()) {
    await t.run(async (ctx) => {
      await ctx.db.insert("projectDocuments", {
        projectId: ids.projectId, fileName: `doc-${index}.txt`, fileType: "txt", content, source: "upload", uploadedBy: ids.userId, createdAt: now + index,
      });
    });
  }
  const transcriptId = transcriptIds[0];
  const authed = t.withIdentity({ subject: "writers-test" });
  const rows = (generationId: Id<"generations">) =>
    t.run((ctx) => ctx.db.query("generationSources").withIndex("by_generationId", (q) => q.eq("generationId", generationId)).collect());
  const finish = (generationId: Id<"generations">) =>
    t.run(async (ctx) => {
      await ctx.db.patch(generationId, { status: "failed" });
      await ctx.db.patch(ids.projectId, { activeGenerationId: undefined, status: "draft" });
    });
  const counts = () =>
    t.run(async (ctx) => ({
      versions: (await ctx.db.query("sourceTextVersions").collect()).length,
      pieces: (await ctx.db.query("sourceTextVersionPieces").collect()).length,
    }));
  return { t, ...ids, transcriptId, authed, rows, finish, counts };
}

describe("drafts refer to their text (B1, second part)", () => {
  it("stores a file's text once and reuses it in the next draft; a transcript row refers to its transcript", async () => {
    const big = "A".repeat(70_000) + " middle " + "B".repeat(10_000);
    const s = await setup(["Seal test notes, run one.", big]);
    const first = await s.authed.mutation(api.generations.requestGeneration, { projectId: s.projectId });
    const firstRows = await s.rows(first);
    for (const row of firstRows) expect(row.content).toBeUndefined();
    const transcriptRow = firstRows.find((row) => row.kind === "transcript")!;
    expect(transcriptRow).toMatchObject({ transcriptId: s.transcriptId, textLength: TRANSCRIPT.length });
    expect(transcriptRow.textVersionId).toBeUndefined();
    const fileRows = firstRows.filter((row) => row.kind === "project_document");
    expect(fileRows.every((row) => row.textVersionId !== undefined)).toBe(true);
    const stored = await s.counts();
    expect(stored.versions).toBe(2);
    // The 80,000-character file in three pieces.
    expect(stored.pieces).toBe(4);
    // Each row reads back its exact text.
    const texts = await s.t.run(async (ctx) => Promise.all(firstRows.map((row) => sourceRowText(ctx, row))));
    expect(texts.sort()).toEqual([TRANSCRIPT, "Seal test notes, run one.", big].sort());

    await s.finish(first);
    const second = await s.authed.mutation(api.generations.requestGeneration, { projectId: s.projectId });
    expect(await s.counts()).toEqual(stored);
    const versionsOf = async (generationId: Id<"generations">) =>
      (await s.rows(generationId)).filter((row) => row.kind === "project_document").map((row) => row.textVersionId).sort();
    expect(await versionsOf(second)).toEqual(await versionsOf(first));
  });

  it("drafting reads the same text from the rows as it would from copies", async () => {
    const s = await setup(["Seal test notes, run one."]);
    const generationId = await s.authed.mutation(api.generations.requestGeneration, { projectId: s.projectId });
    const input = await s.t.query(internal.generations.getGenerationInput, { generationId });
    expect(input!.transcriptParts.map((part) => part.content)).toEqual([TRANSCRIPT]);
    expect(input!.contextDocs.map((document) => document.content)).toEqual(["Seal test notes, run one."]);
  });

  it("ten drafts of a project with unchanged files store each text once", async () => {
    const s = await setup(["Seal test notes, run one.", "Seal test notes, run two."]);
    let stored: { versions: number; pieces: number } | undefined;
    for (let draft = 0; draft < 10; draft += 1) {
      // Reserved directly: ten starts in a row would pass the hourly start limit.
      const generationId = await s.t.run(async (ctx) => {
        const project = (await ctx.db.get(s.projectId))!;
        return await reserveGeneration(
          ctx, project, s.userId, "standard", "single", undefined, undefined, undefined, undefined, 0,
          undefined, undefined, undefined, undefined, false
        );
      });
      stored ??= await s.counts();
      await s.finish(generationId);
    }
    expect(stored).toEqual({ versions: 2, pieces: 2 });
    expect(await s.counts()).toEqual(stored);
  });

  // Convex's transaction limits on (B1 review, 2026-10-27): the reservation
  // counts what it reads as well as what it writes.
  it("reserves the largest supported draft within a transaction's limits", async () => {
    const s = await setup(
      Array.from({ length: 50 }, (_, index) => `${index}`.padEnd(3, " ") + "a".repeat(199_997)),
      { transcripts: Array.from({ length: 4 }, (_, index) => `Speaker ${index}: ` + "b".repeat(500_000)), transactionLimits: true }
    );
    const generationId = await s.authed.mutation(api.generations.requestGeneration, { projectId: s.projectId });
    const rows = await s.rows(generationId);
    expect(rows.filter((row) => row.kind === "project_document")).toHaveLength(50);
    expect(rows.filter((row) => row.kind === "transcript").map((row) => row.textLength)).toEqual([500_000, 500_000, 500_000, 500_000]);
    expect((await s.counts()).versions).toBe(50);
  });

  it("refuses by name a draft whose files would pass a transaction's reads, before the limit, and writes nothing", async () => {
    // 50 files of 200,000 UTF-16 units of a 4-byte character: 20 MB.
    const s = await setup(
      Array.from({ length: 50 }, (_, index) => `${index}`.padEnd(2, " ") + "\u{1F600}".repeat(99_999)),
      { transactionLimits: true }
    );
    await expect(s.authed.mutation(api.generations.requestGeneration, { projectId: s.projectId })).rejects.toThrow(
      FROZEN_TEXT_TOO_LARGE_MESSAGE
    );
    expect(await s.counts()).toEqual({ versions: 0, pieces: 0 });
    expect(await s.t.run(async (ctx) => (await ctx.db.query("generationSources").collect()).length)).toBe(0);
    expect(await s.t.run(async (ctx) => (await ctx.db.query("generations").collect()).length)).toBe(0);
  });

  it("refuses by name a draft whose transcripts alone would pass a transaction's reads", async () => {
    // 20 transcripts of 500,000 two-byte characters: 20 MB.
    const s = await setup([], {
      transcripts: Array.from({ length: 20 }, (_, index) => `Speaker ${index}: ` + "\u00e9".repeat(499_980)),
      transactionLimits: true,
    });
    await expect(s.authed.mutation(api.generations.requestGeneration, { projectId: s.projectId })).rejects.toThrow(
      FROZEN_TEXT_TOO_LARGE_MESSAGE
    );
  });
});
