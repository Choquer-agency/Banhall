/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import {
  MAX_TRANSCRIPT_CHARS,
  MAX_TRANSCRIPT_FILE_BYTES,
  MAX_TRANSCRIPTS_PER_PROJECT,
} from "./lib/transcripts";
import { deleteStorageIfUnreferenced } from "./lib/storage";

const modules = import.meta.glob("./**/*.ts");

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const FIRST = "Dana Whitfield: What did you build?\n\nPriya Shah: A predictive controller.";
const SECOND = "Dana Whitfield: What failed?\n\nPriya Shah: The forecast on cloudy days.";

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const writerId = await ctx.db.insert("users", { authId: "in-writer", role: "writer", firstName: "Wren" });
    await ctx.db.insert("users", { authId: "in-other", role: "writer", firstName: "Otto" });
    await ctx.db.insert("users", { authId: "in-roleless", firstName: "Nobody" });
    await ctx.db.insert("users", { authId: "in-anon", role: "writer", isAnonymous: true });
    const now = Date.now();
    const projectId = await ctx.db.insert("projects", {
      title: "Helios",
      clientName: "Verdant Grid",
      status: "draft",
      createdBy: writerId,
      shareToken: "in-token",
      createdAt: now,
      updatedAt: now,
      interviewer: "Dana Whitfield",
    });
    const firstId = await ctx.db.insert("transcripts", {
      projectId,
      content: FIRST,
      label: "first.docx",
      position: 0,
      createdAt: now,
    });
    return { writerId, projectId, firstId };
  });
  return {
    t,
    ...ids,
    writer: t.withIdentity({ subject: "in-writer" }),
    other: t.withIdentity({ subject: "in-other" }),
    roleless: t.withIdentity({ subject: "in-roleless" }),
    anonymous: t.withIdentity({ subject: "in-anon" }),
  };
}

describe("addTranscript", () => {
  it("adds a transcript at the end of the list with its format, and builds its turns on the server", async () => {
    const f = await setup();
    const id = await f.writer.mutation(api.transcripts.addTranscript, {
      projectId: f.projectId,
      content: SECOND,
      label: "second.vtt",
      sourceFormat: "vtt",
    });
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    const list = await f.writer.query(api.transcripts.listTranscripts, { projectId: f.projectId });
    expect(list.map((row) => [row.label, row.position, row.sourceFormat])).toEqual([
      ["first.docx", 0, undefined],
      ["second.vtt", 1, "vtt"],
    ]);
    expect(list[1].speakerStatus).toBe("needs_check");
    const turns = await f.t.run((ctx) =>
      ctx.db
        .query("transcriptTurns")
        .withIndex("by_transcriptId_and_index", (q) => q.eq("transcriptId", id))
        .collect()
    );
    expect(turns.map((turn) => turn.speakerLabel)).toEqual(["Dana Whitfield", "Priya Shah"]);
  });

  it("lets any internal user with project access add, and refuses outsiders", async () => {
    const f = await setup();
    await expect(
      f.other.mutation(api.transcripts.addTranscript, { projectId: f.projectId, content: SECOND })
    ).resolves.toBeDefined();
    for (const caller of [f.roleless, f.anonymous, f.t]) {
      await expect(
        caller.mutation(api.transcripts.addTranscript, { projectId: f.projectId, content: `${SECOND} again` })
      ).rejects.toThrow();
    }
  });

  it("refuses the same text twice as already added", async () => {
    const f = await setup();
    await expect(
      f.writer.mutation(api.transcripts.addTranscript, { projectId: f.projectId, content: FIRST })
    ).rejects.toThrow(/already added \(first.docx\)/);
  });

  it("enforces the per-transcript, row and combined caps", async () => {
    const f = await setup();
    await expect(
      f.writer.mutation(api.transcripts.addTranscript, {
        projectId: f.projectId,
        content: "x".repeat(MAX_TRANSCRIPT_CHARS + 1),
      })
    ).rejects.toThrow(/at most 500,000 characters/);
    await f.t.run(async (ctx) => {
      for (let i = 1; i < MAX_TRANSCRIPTS_PER_PROJECT; i += 1) {
        await ctx.db.insert("transcripts", {
          projectId: f.projectId,
          content: `Transcript body ${i}`,
          position: i,
          createdAt: i,
        });
      }
    });
    await expect(
      f.writer.mutation(api.transcripts.addTranscript, { projectId: f.projectId, content: SECOND })
    ).rejects.toThrow(/at most 20 transcripts/);
  });

  it("refuses the combined character cap", async () => {
    const f = await setup();
    await f.t.run(async (ctx) => {
      for (let i = 1; i <= 4; i += 1) {
        await ctx.db.insert("transcripts", {
          projectId: f.projectId,
          content: `${i}`.repeat(MAX_TRANSCRIPT_CHARS),
          position: i,
          createdAt: i,
        });
      }
    });
    await expect(
      f.writer.mutation(api.transcripts.addTranscript, { projectId: f.projectId, content: "y".repeat(100) })
    ).rejects.toThrow(/Combined transcript text is too large/);
  });

  it("is blocked while a generation is active", async () => {
    const f = await setup();
    await f.t.run(async (ctx) => {
      const generationId = await ctx.db.insert("generations", {
        projectId: f.projectId,
        status: "running",
        startedAt: Date.now(),
      });
      await ctx.db.patch(f.projectId, { activeGenerationId: generationId });
    });
    await expect(
      f.writer.mutation(api.transcripts.addTranscript, { projectId: f.projectId, content: SECOND })
    ).rejects.toThrow(/while a report is generating/);
    await expect(
      f.writer.mutation(api.transcripts.removeTranscript, { transcriptId: f.firstId })
    ).rejects.toThrow(/while a report is generating/);
  });

  it("keeps the uploaded original, refuses one over 25 MB, and storage cleanup keeps a referenced original", async () => {
    const f = await setup();
    const storageId = await f.t.run((ctx) => ctx.storage.store(new Blob(["WEBVTT original"])));
    const id = await f.writer.mutation(api.transcripts.addTranscript, {
      projectId: f.projectId,
      content: SECOND,
      originalStorageId: storageId,
    });
    expect((await f.t.run((ctx) => ctx.db.get(id)))?.originalStorageId).toBe(storageId);
    await f.t.run((ctx) => deleteStorageIfUnreferenced(ctx, storageId));
    expect(await f.t.run(async (ctx) => (await ctx.storage.get(storageId)) !== null)).toBe(true);

    const huge = await f.t.run((ctx) => ctx.storage.store(new Blob([new Uint8Array(MAX_TRANSCRIPT_FILE_BYTES + 1)])));
    await expect(
      f.writer.mutation(api.transcripts.addTranscript, {
        projectId: f.projectId,
        content: "Another transcript text.",
        originalStorageId: huge,
      })
    ).rejects.toThrow(/at most 25 MB/);
  });

  it("carries a consultant's roles over from the same text in another readable project", async () => {
    const f = await setup();
    await f.t.mutation(internal.transcripts.buildTranscriptStructure, { transcriptId: f.firstId });
    await f.t.run(async (ctx) => {
      const [row] = await ctx.db
        .query("transcriptSpeakers")
        .withIndex("by_transcriptId_and_label", (q) => q.eq("transcriptId", f.firstId).eq("label", "Priya Shah"))
        .collect();
      await ctx.db.patch(row._id, { role: "other", roleSource: "consultant" });
      await ctx.db.patch(f.firstId, { contentHash: await sha(FIRST) });
    });
    const otherProjectId = await f.t.run((ctx) =>
      ctx.db.insert("projects", {
        title: "Helios review",
        clientName: "Verdant Grid",
        status: "draft",
        createdBy: f.writerId,
        shareToken: "in-token-2",
        createdAt: 1,
        updatedAt: 1,
      })
    );
    const copyId = await f.writer.mutation(api.transcripts.addTranscript, {
      projectId: otherProjectId,
      content: FIRST,
    });
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    const speakers = await f.t.run((ctx) =>
      ctx.db
        .query("transcriptSpeakers")
        .withIndex("by_transcriptId_and_label", (q) => q.eq("transcriptId", copyId))
        .collect()
    );
    expect(speakers.find((row) => row.label === "Priya Shah")).toMatchObject({
      role: "other",
      roleSource: "consultant",
    });
  });
});

describe("replaceTranscript and removeTranscript", () => {
  it("replaces in place and archives the old row, leaving frozen generation sources untouched", async () => {
    const f = await setup();
    const sourceId = await f.t.run(async (ctx) => {
      const generationId = await ctx.db.insert("generations", {
        projectId: f.projectId,
        status: "completed",
        startedAt: 1,
      });
      return await ctx.db.insert("generationSources", {
        generationId,
        projectId: f.projectId,
        kind: "transcript",
        transcriptId: f.firstId,
        label: "first.docx",
        content: FIRST,
        contentHash: "h",
        truncated: false,
        originalLength: FIRST.length,
        capturedAt: 1,
      });
    });
    const replacementId = await f.writer.mutation(api.transcripts.replaceTranscript, {
      transcriptId: f.firstId,
      content: SECOND,
      label: "first-fixed.docx",
    });
    const list = await f.writer.query(api.transcripts.listTranscripts, { projectId: f.projectId });
    expect(list.map((row) => [row._id, row.label, row.position])).toEqual([
      [replacementId, "first-fixed.docx", 0],
    ]);
    const old = await f.t.run((ctx) => ctx.db.get(f.firstId));
    expect(old?.archivedAt).toBeTypeOf("number");
    expect(old?.supersededById).toBe(replacementId);
    expect(old?.content).toBe(FIRST);
    const frozen = await f.t.run((ctx) => ctx.db.get(sourceId));
    expect(frozen?.content).toBe(FIRST);
    await expect(
      f.writer.mutation(api.transcripts.replaceTranscript, { transcriptId: f.firstId, content: "Third." })
    ).rejects.toThrow(/already replaced or removed/);
  });

  it("refuses a replacement identical to another transcript", async () => {
    const f = await setup();
    await f.writer.mutation(api.transcripts.addTranscript, { projectId: f.projectId, content: SECOND });
    await expect(
      f.writer.mutation(api.transcripts.replaceTranscript, { transcriptId: f.firstId, content: SECOND })
    ).rejects.toThrow(/already added/);
  });

  it("removes by archiving, and refuses outsiders", async () => {
    const f = await setup();
    await expect(
      f.roleless.mutation(api.transcripts.removeTranscript, { transcriptId: f.firstId })
    ).rejects.toThrow();
    await f.writer.mutation(api.transcripts.removeTranscript, { transcriptId: f.firstId });
    expect(await f.writer.query(api.transcripts.listTranscripts, { projectId: f.projectId })).toEqual([]);
    expect((await f.t.run((ctx) => ctx.db.get(f.firstId)))?.archivedAt).toBeTypeOf("number");
  });
});

describe("createProject intake", () => {
  it("refuses the same text twice and text over the per-transcript cap", async () => {
    const f = await setup();
    const base = { title: "New", clientName: "Verdant Grid" };
    await expect(
      f.writer.mutation(api.projects.createProject, {
        ...base,
        transcripts: [
          { content: FIRST, label: "a.docx" },
          { content: FIRST, label: "b.docx" },
        ],
      })
    ).rejects.toThrow(/b.docx is already added/);
    await expect(
      f.writer.mutation(api.projects.createProject, {
        ...base,
        transcripts: [{ content: "z".repeat(MAX_TRANSCRIPT_CHARS + 1) }],
      })
    ).rejects.toThrow(/at most 500,000 characters/);
    const created = await f.writer.mutation(api.projects.createProject, {
      ...base,
      transcripts: [{ content: SECOND, label: "call.srt", sourceFormat: "srt" }],
    });
    const row = await f.t.run((ctx) => ctx.db.get(created.transcriptIds[0] as Id<"transcripts">));
    expect(row?.sourceFormat).toBe("srt");
  });
});

async function sha(text: string): Promise<string> {
  const { sha256 } = await import("./lib/contracts");
  return await sha256(text);
}
