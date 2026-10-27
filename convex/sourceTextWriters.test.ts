/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { sha256 } from "./lib/contracts";
import { FROZEN_TEXT_TOO_LARGE_MESSAGE, RECOVERY_TOO_LARGE_MESSAGE, reserveGeneration } from "./lib/generations/reservation";
import { decisionFixture } from "./seedDecision.fixture";
import { copyRecoverySourceUses, RECOVERY_SOURCE_USE_COPIES } from "./lib/generations/sourceUse";
import { sourceRowText } from "./lib/sourceText";
import { TRANSCRIPT_FACTS_MODE_KEY } from "./appSettings";

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
async function setup(
  documents: string[],
  options: { transcripts?: string[]; transactionLimits?: boolean; fiscalYearEnd?: number; copiedFrom?: boolean; parserVersion?: string } = {}
) {
  const t = convexTest({ schema, modules, transactionLimits: options.transactionLimits ?? false });
  rateLimiterTest.register(t);
  const now = Date.now() - 1_000;
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { authId: "writers-test", role: "writer" });
    const projectId = await ctx.db.insert("projects", {
      title: "Seals", clientName: "Quillmere", status: "draft", createdBy: userId, ownerId: userId,
      shareToken: "writers-test", createdAt: now, updatedAt: now,
      ...(options.fiscalYearEnd !== undefined ? { fiscalYearEnd: options.fiscalYearEnd } : {}),
    });
    // Last year's project, whose transcripts this year's were copied from.
    const sourceProjectId = options.copiedFrom
      ? await ctx.db.insert("projects", {
          title: "Seals 2025", clientName: "Quillmere", status: "draft", createdBy: userId, ownerId: userId,
          shareToken: "writers-test-2025", createdAt: now, updatedAt: now, fiscalYearEnd: Date.UTC(2025, 11, 31),
        })
      : undefined;
    return { userId, projectId, sourceProjectId };
  });
  const transcriptIds: Id<"transcripts">[] = [];
  for (const [index, content] of (options.transcripts ?? [TRANSCRIPT]).entries()) {
    const copiedFromTranscriptId = ids.sourceProjectId
      ? await t.run(async (ctx) =>
          ctx.db.insert("transcripts", {
            projectId: ids.sourceProjectId!, content, contentHash: await sha256(content), label: `Interview ${index + 1}`, createdAt: now + index,
          })
        )
      : undefined;
    transcriptIds.push(
      await t.run(async (ctx) =>
        ctx.db.insert("transcripts", {
          projectId: ids.projectId, content, contentHash: await sha256(content), label: `Interview ${index + 1}`, createdAt: now + index,
          ...(copiedFromTranscriptId ? { copiedFromTranscriptId } : {}),
          ...(options.parserVersion ? { parserVersion: options.parserVersion } : {}),
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
  return { t, ...ids, transcriptId, transcriptIds, authed, rows, finish, counts };
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
  it("reserves the largest supported draft (files of one-byte characters) within a transaction's limits", async () => {
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

  it("leaving most transcripts out still reads them all, so the refusal is by name and says to remove some", async () => {
    // 20 transcripts of 500,000 two-byte characters, 18 of them left out.
    const s = await setup([], {
      transcripts: Array.from({ length: 20 }, (_, index) => `Speaker ${index}: ` + "\u00e9".repeat(499_980)),
      transactionLimits: true,
    });
    await expect(
      s.authed.mutation(api.generations.requestGeneration, { projectId: s.projectId, excludeTranscriptIds: s.transcriptIds.slice(2) })
    ).rejects.toThrow(FROZEN_TEXT_TOO_LARGE_MESSAGE);
    expect(FROZEN_TEXT_TOO_LARGE_MESSAGE).toContain("Remove files or transcripts");
  });

  it("counts the originals of copied transcripts, refusing by name before the limit", async () => {
    // 12 transcripts of 700,000 one-byte characters, each copied from last
    // year's project: this year's rows and their originals together pass 16 MiB.
    const s = await setup([], {
      transcripts: Array.from({ length: 12 }, (_, index) => `Speaker ${index}: ` + "c".repeat(699_980)),
      transactionLimits: true,
      fiscalYearEnd: Date.UTC(2026, 11, 31),
      copiedFrom: true,
    });
    await expect(s.authed.mutation(api.generations.requestGeneration, { projectId: s.projectId })).rejects.toThrow(
      FROZEN_TEXT_TOO_LARGE_MESSAGE
    );
  });

  it("starts stale transcripts' rebuilds in their own transactions, so reading them once is enough", async () => {
    // 9 transcripts of about 1 MB built by an older parser, with fact packs
    // for long transcripts: marking each row here would read it again.
    const s = await setup([], {
      transcripts: Array.from({ length: 9 }, (_, index) => `Speaker ${index}: ` + "\u00e9".repeat(499_980)),
      transactionLimits: true,
      parserVersion: "1",
    });
    await s.t.run(async (ctx) => {
      await ctx.db.insert("appSettings", { key: TRANSCRIPT_FACTS_MODE_KEY, value: "long", updatedBy: s.userId, updatedAt: 1 });
    });
    const generationId = await s.authed.mutation(api.generations.requestGeneration, { projectId: s.projectId });
    expect((await s.rows(generationId)).filter((row) => row.kind === "transcript")).toHaveLength(9);
    const starts = await s.t.run(async (ctx) =>
      (await ctx.db.system.query("_scheduled_functions").collect()).filter((job) => job.name.includes("rebuildStructureIfStale"))
    );
    expect(starts).toHaveLength(9);
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

describe("leave-out lists (B1 review, round 3)", () => {
  it("a new draft keeps an archived or later file's id, drops a deleted one, and refuses another project's", async () => {
    const s = await setup(Array.from({ length: 52 }, (_, index) => `Seal notes ${index}.`));
    const ids = await s.t.run(async (ctx) => {
      const files = await ctx.db.query("projectDocuments").withIndex("by_projectId", (q) => q.eq("projectId", s.projectId)).collect();
      await ctx.db.patch(files[1]!._id, { archived: true });
      const gone = files[2]!._id;
      await ctx.db.delete(gone);
      const otherProject = await ctx.db.insert("projects", {
        title: "Other", clientName: "Quillmere", status: "draft", createdBy: s.userId, shareToken: "other", createdAt: 1, updatedAt: 1,
      });
      const foreign = await ctx.db.insert("projectDocuments", {
        projectId: otherProject, fileName: "other.txt", fileType: "txt", content: "Other notes.", source: "upload", uploadedBy: s.userId, createdAt: 1,
      });
      // files[51] is past the 50 rows a draft reads.
      return { archived: files[1]!._id, gone, later: files[51]!._id, foreign, first: files[0]!._id };
    });
    await expect(
      s.authed.mutation(api.generations.requestGeneration, { projectId: s.projectId, excludeDocumentIds: [ids.first, ids.foreign] })
    ).rejects.toThrow("A left-out file belongs to another project");
    const generationId = await s.authed.mutation(api.generations.requestGeneration, {
      projectId: s.projectId,
      excludeDocumentIds: [ids.first, ids.archived, ids.gone, ids.later],
    });
    const stored = await s.t.run(async (ctx) => (await ctx.db.get(generationId))?.excludedSources);
    expect(stored?.documentIds).toEqual([ids.first, ids.archived, ids.later]);
  });

  it("a retry keeps its stored list as it was, even after a left-out file is deleted", async () => {
    const s = await setup(["Left out.", "Kept."], { transactionLimits: true });
    const leftOut = await s.t.run(async (ctx) => (await ctx.db.query("projectDocuments").first())!._id);
    const first = await s.authed.mutation(api.generations.requestGeneration, { projectId: s.projectId, excludeDocumentIds: [leftOut] });
    await s.finish(first);
    await s.t.run((ctx) => ctx.db.delete(leftOut));
    const retry = await s.authed.mutation(api.generations.retryGeneration, { generationId: first });
    const [before, after] = await s.t.run(async (ctx) => [await ctx.db.get(first), await ctx.db.get(retry)]);
    expect(after?.excludedSources).toEqual(before?.excludedSources);
  });

  it("a retry does not read its archived left-out transcripts again", async () => {
    const s = await setup([], { transactionLimits: true });
    const excluded: Id<"transcripts">[] = [];
    for (let index = 0; index < 10; index += 1) {
      excluded.push(
        await s.t.run((ctx) => ctx.db.insert("transcripts", { projectId: s.projectId, content: "x".repeat(900_000), createdAt: index, archivedAt: 1 }))
      );
    }
    const first = await s.authed.mutation(api.generations.requestGeneration, { projectId: s.projectId, excludeTranscriptIds: excluded });
    await s.finish(first);
    for (let index = 0; index < 9; index += 1) {
      await s.t.run((ctx) => ctx.db.insert("transcripts", { projectId: s.projectId, content: "x".repeat(900_000), createdAt: index + 10 }));
    }
    await expect(s.authed.mutation(api.generations.retryGeneration, { generationId: first })).resolves.toBeDefined();
  });
});

describe("Summary recovery of a draft whose rows hold their own copies (B1 review, round 3)", () => {
  async function failedSignedOffDraft(rows: number, text: string) {
    const s = await decisionFixture({ sourceRows: "copies", transactionLimits: true });
    await s.t.run(async (ctx) => {
      const summaryVersionId = await ctx.db.insert("summaryVersions", {
        projectId: s.projectId, generationId: s.generationId, originGenerationId: s.generationId,
        briefVersionId: s.briefId, version: 1, settingsHash: "x", skippedRoleIds: [], readiness: true,
        signedOffBy: s.userId, signedOffAt: 1,
      });
      await ctx.db.patch(s.generationId, { status: "failed", summaryVersionId });
      await ctx.db.patch(s.projectId, { activeGenerationId: undefined, status: "draft" });
    });
    for (let index = 0; index < rows; index += 1) {
      await s.t.run((ctx) =>
        ctx.db.insert("generationSources", {
          projectId: s.projectId, generationId: s.generationId, kind: "project_document", label: `other:legacy-${index}.txt`,
          content: text, contentHash: "hash", truncated: false, originalLength: text.length, capturedAt: 1,
        })
      );
    }
    return s;
  }

  it("reads the rows once and copies 45 files of 200,000 one-byte characters", async () => {
    const s = await failedSignedOffDraft(45, "a".repeat(200_000));
    const recoveryId = await s.writer.mutation(api.generations.retryFromSummary, { failedGenerationId: s.generationId });
    const copies = await s.t.run(async (ctx) =>
      (await ctx.db.query("generationSources").withIndex("by_generationId", (q) => q.eq("generationId", recoveryId)).collect()).length
    );
    expect(copies).toBe(46);
    // Round 4: a recovery of that recovery reads only the failed draft's
    // rows, so it fits too.
    await s.t.run(async (ctx) => {
      await ctx.db.patch(recoveryId, { status: "failed" });
      await ctx.db.patch(s.projectId, { activeGenerationId: undefined, status: "draft" });
    });
    const secondId = await s.writer.mutation(api.generations.retryFromSummary, { failedGenerationId: recoveryId });
    const second = await s.t.run(async (ctx) => ({
      rows: (await ctx.db.query("generationSources").withIndex("by_generationId", (q) => q.eq("generationId", secondId)).collect()).length,
      map: (await ctx.db.get(secondId))?.sourceIdMap?.length,
    }));
    expect(second).toEqual({ rows: 46, map: 46 });
  });

  it("leaves out step records that would not fit, and says so, instead of failing the recovery", async () => {
    // 16 older rows of 950,000 characters, then 2,500 records per step: the
    // room left runs out before the 4,000-record cap.
    const s = await failedSignedOffDraft(16, "a".repeat(950_000));
    const first = await s.writer.mutation(api.generations.retryFromSummary, { failedGenerationId: s.generationId });
    await s.t.run(async (ctx) => {
      await ctx.db.patch(first, { status: "failed" });
      await ctx.db.patch(s.projectId, { activeGenerationId: undefined, status: "draft" });
    });
    const sourceId = await s.t.run(async (ctx) => (await ctx.db.get(first))!.sourceIdMap![0]!.recoverySourceId);
    for (const step of ["analyzer", "brief", "seeds"] as const) {
      for (let batch = 0; batch < 25; batch += 1) {
        await s.t.run(async (ctx) => {
          for (let index = 0; index < 100; index += 1) {
            await ctx.db.insert("generationSourceUse", {
              generationId: first, projectId: s.projectId, sourceId, step, run: `run-${batch * 100 + index}-${"0".repeat(32)}`,
              contentHash: "sha256:" + "a".repeat(64), state: "whole", sent: 30, total: 30, unit: "chars", at: 1,
            });
          }
        });
      }
    }
    // Round 6: the first recovery had no records to leave out, so it is not
    // marked; the second leaves out only what did not fit.
    expect(await s.t.run(async (ctx) => (await ctx.db.get(first))?.sourceUseTruncated ?? false)).toBe(false);
    const second = await s.writer.mutation(api.generations.retryFromSummary, { failedGenerationId: first });
    const copied = await s.t.run(async (ctx) => ({
      truncated: (await ctx.db.get(second))?.sourceUseTruncated,
      records: (await ctx.db.query("generationSourceUse").withIndex("by_generationId_and_step_and_run", (q) => q.eq("generationId", second)).collect()).length,
    }));
    expect(copied.truncated).toBe(true);
    expect(copied.records).toBeGreaterThan(0);
    // Fewer than the 4,000-copy cap: the guard, not the cap, cut them.
    expect(copied.records).toBeLessThan(RECOVERY_SOURCE_USE_COPIES);
  });

  it("does not mark a large recovery incomplete when its steps have few records", async () => {
    const s = await failedSignedOffDraft(16, "a".repeat(900_000));
    const first = await s.writer.mutation(api.generations.retryFromSummary, { failedGenerationId: s.generationId });
    await s.t.run(async (ctx) => {
      await ctx.db.patch(first, { status: "failed" });
      await ctx.db.patch(s.projectId, { activeGenerationId: undefined, status: "draft" });
    });
    const sourceId = await s.t.run(async (ctx) => (await ctx.db.get(first))!.sourceIdMap![0]!.recoverySourceId);
    await s.t.run(async (ctx) => {
      for (const step of ["analyzer", "brief", "seeds"] as const) {
        for (let index = 0; index < 10; index += 1) {
          await ctx.db.insert("generationSourceUse", {
            generationId: first, projectId: s.projectId, sourceId, step, run: `run-${index}`,
            state: "whole", sent: 30, total: 30, unit: "chars", at: 1,
          });
        }
      }
    });
    const second = await s.writer.mutation(api.generations.retryFromSummary, { failedGenerationId: first });
    const copied = await s.t.run(async (ctx) => ({
      truncated: (await ctx.db.get(second))?.sourceUseTruncated,
      records: (await ctx.db.query("generationSourceUse").withIndex("by_generationId_and_step_and_run", (q) => q.eq("generationId", second)).collect()).length,
    }));
    expect(copied).toEqual({ truncated: undefined, records: 30 });
  });

  it("refuses by name a recovery whose rows are too large to read at once", async () => {
    // 45 files of 200,000 two-byte characters: 18 MB to read and write.
    const s = await failedSignedOffDraft(45, "\u00e9".repeat(200_000));
    await expect(s.writer.mutation(api.generations.retryFromSummary, { failedGenerationId: s.generationId })).rejects.toThrow(
      RECOVERY_TOO_LARGE_MESSAGE
    );
  });
});

describe("a recovery's step records at the edge of the room left (B1 review, round 7)", () => {
  async function stepRecords(rows: Array<{ step: "analyzer" | "brief" | "seeds"; run?: string; state: "whole" | "part" }>) {
    const t = convexTest(schema, modules);
    return await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { authId: "edge", role: "writer" });
      const projectId = await ctx.db.insert("projects", {
        title: "Seals", clientName: "Quillmere", status: "draft", createdBy: userId, shareToken: "edge", createdAt: 1, updatedAt: 1,
      });
      const from = await ctx.db.insert("generations", { projectId, status: "failed", startedAt: 1 });
      const to = await ctx.db.insert("generations", { projectId, status: "reserved", startedAt: 1 });
      const base = { projectId, kind: "transcript" as const, label: "Interview", content: "x", contentHash: "h", truncated: false, originalLength: 1, capturedAt: 1 };
      const sourceId = await ctx.db.insert("generationSources", { ...base, generationId: from });
      const copyId = await ctx.db.insert("generationSources", { ...base, generationId: to });
      for (const row of rows) {
        await ctx.db.insert("generationSourceUse", {
          generationId: from, projectId, sourceId, step: row.step, ...(row.run ? { run: row.run } : {}), state: row.state, sent: 1, total: 1, unit: "chars", at: 1,
        });
      }
      return { projectId, from, to, sourceId, copyId };
    }).then((ids) => ({ t, ...ids, copyOf: new Map([[ids.sourceId, ids.copyId]]) }));
  }
  /** A guard with room for `pages` read pages, then none. */
  function roomFor(pages: number) {
    let left = pages;
    return { read: () => undefined, hasRoom: async (kind: "read" | "write") => (kind === "write" ? true : left-- > 0) };
  }

  it("is not marked incomplete when the room runs out exactly as the records end", async () => {
    const s = await stepRecords(Array.from({ length: 100 }, (_, index) => ({ step: "analyzer" as const, run: `run-${String(index).padStart(3, "0")}`, state: "whole" as const })));
    const result = await s.t.run((ctx) => copyRecoverySourceUses(ctx, s.from, { _id: s.to, projectId: s.projectId }, s.copyOf, roomFor(1)));
    expect(result).toEqual({ truncated: false });
    expect(await s.t.run(async (ctx) => (await ctx.db.query("generationSourceUse").withIndex("by_generationId_and_step_and_run", (q) => q.eq("generationId", s.to)).collect()).length)).toBe(100);
  });

  it("keeps a cut Brief step's whole records, since the Brief records no run (round 8)", async () => {
    // 80 whole records, then 40 part records, cut after 100 (the empty
    // analyzer step takes the first page of room).
    const s = await stepRecords([
      ...Array.from({ length: 80 }, () => ({ step: "brief" as const, state: "whole" as const })),
      ...Array.from({ length: 40 }, () => ({ step: "brief" as const, state: "part" as const })),
    ]);
    const result = await s.t.run((ctx) => copyRecoverySourceUses(ctx, s.from, { _id: s.to, projectId: s.projectId }, s.copyOf, roomFor(2)));
    expect(result).toEqual({ truncated: true });
    const copied = await s.t.run((ctx) => ctx.db.query("generationSourceUse").withIndex("by_generationId_and_step_and_run", (q) => q.eq("generationId", s.to)).collect());
    // One source, so its best whole record is the one kept.
    expect(copied.map((row) => [row.step, row.state])).toEqual([["brief", "whole"]]);
  });

  it("leaves out a run cut part way rather than show it weaker than it was", async () => {
    // 99 runs, then run "zz" with a part record at 100 and its whole record at 101.
    const s = await stepRecords([
      ...Array.from({ length: 99 }, (_, index) => ({ step: "analyzer" as const, run: `run-${String(index).padStart(3, "0")}`, state: "whole" as const })),
      { step: "analyzer", run: "zz", state: "part" },
      { step: "analyzer", run: "zz", state: "whole" },
    ]);
    const result = await s.t.run((ctx) => copyRecoverySourceUses(ctx, s.from, { _id: s.to, projectId: s.projectId }, s.copyOf, roomFor(1)));
    expect(result).toEqual({ truncated: true });
    const copied = await s.t.run((ctx) => ctx.db.query("generationSourceUse").withIndex("by_generationId_and_step_and_run", (q) => q.eq("generationId", s.to)).collect());
    expect(copied).toHaveLength(99);
    expect(copied.some((row) => row.run === "zz")).toBe(false);
  });
});
