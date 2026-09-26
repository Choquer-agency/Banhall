/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import {
  MAX_TRANSCRIPT_CHARS,
  MAX_TRANSCRIPT_FILE_BYTES,
  MAX_TRANSCRIPT_HISTORY_ROWS,
  MAX_TRANSCRIPTS_PER_PROJECT,
} from "./lib/transcripts";
import { deleteStorageIfUnreferenced } from "./lib/storage";

const modules = import.meta.glob("./**/*.ts");

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const FIRST = "Dana Whitfield: What did you build?\n\nPriya Shah: A predictive controller.";
const SECOND = "Dana Whitfield: What failed?\n\nPriya Shah: The forecast on cloudy days.";

async function setup(options: { limits?: boolean } = {}) {
  // `limits` makes convex-test enforce Convex's per-transaction read and
  // write limits (16 MiB read), as the deployment does.
  const t = options.limits
    ? convexTest({ schema, modules, transactionLimits: true })
    : convexTest(schema, modules);
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
      ownerId: writerId,
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

  it("lets the project's editors add, and refuses other writers and outsiders", async () => {
    const f = await setup();
    await expect(
      f.writer.mutation(api.transcripts.addTranscript, { projectId: f.projectId, content: SECOND })
    ).resolves.toBeDefined();
    // Security wave 1 (a2 P2-3): transcripts are what the next draft reads,
    // so another Consultant with no assignment on the project is refused.
    await expect(
      f.other.mutation(api.transcripts.addTranscript, { projectId: f.projectId, content: `${SECOND} too` })
    ).rejects.toThrow(/Only the project owner/);
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
        ownerId: f.writerId,
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

  it("replaces a transcript with its own text, carrying its roles over", async () => {
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
    const replacementId = await f.writer.mutation(api.transcripts.replaceTranscript, {
      transcriptId: f.firstId,
      content: FIRST,
      label: "first-with-original.docx",
    });
    const list = await f.writer.query(api.transcripts.listTranscripts, { projectId: f.projectId });
    expect(list.map((row) => [row._id, row.label, row.position])).toEqual([[replacementId, "first-with-original.docx", 0]]);
    const speakers = await f.t.run((ctx) =>
      ctx.db
        .query("transcriptSpeakers")
        .withIndex("by_transcriptId_and_label", (q) => q.eq("transcriptId", replacementId))
        .collect()
    );
    expect(speakers.find((row) => row.label === "Priya Shah")).toMatchObject({ role: "other", roleSource: "consultant" });
  });

  it("refuses to replace a row that was already replaced or removed", async () => {
    const f = await setup();
    await f.writer.mutation(api.transcripts.removeTranscript, { transcriptId: f.firstId });
    await expect(
      f.writer.mutation(api.transcripts.replaceTranscript, { transcriptId: f.firstId, content: SECOND })
    ).rejects.toThrow(/already replaced or removed/);
  });

  it("gives callers outside the team the same answer whether or not the transcript exists", async () => {
    const f = await setup();
    const missing = await f.t.run(async (ctx) => {
      const id = await ctx.db.insert("transcripts", { projectId: f.projectId, content: "gone", createdAt: 1 });
      await ctx.db.delete(id);
      return id;
    });
    for (const [caller, error] of [
      [f.roleless, /An active internal role is required/],
      [f.anonymous, /Authentication required/],
      [f.t, /Authentication required/],
    ] as const) {
      for (const transcriptId of [f.firstId, missing]) {
        await expect(caller.mutation(api.transcripts.removeTranscript, { transcriptId })).rejects.toThrow(error);
        await expect(
          caller.mutation(api.transcripts.replaceTranscript, { transcriptId, content: SECOND })
        ).rejects.toThrow(error);
      }
    }
    // A team member is told the row is missing.
    await expect(
      f.writer.mutation(api.transcripts.removeTranscript, { transcriptId: missing })
    ).rejects.toThrow(/Transcript not found/);
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

/** Distinct text at the per-transcript cap. */
function bigTranscript(tag: number): string {
  return `Dana Whitfield: Transcript ${tag} line. `.repeat(20_000).slice(0, MAX_TRANSCRIPT_CHARS);
}

describe("archived transcript history", () => {
  it("keeps project reads and changes working after many replacements of large transcripts", async () => {
    const f = await setup({ limits: true });
    // Four active transcripts at the per-transcript cap: the project sits at
    // the 2,000,000-character combined cap.
    const active: Id<"transcripts">[] = [f.firstId];
    await f.t.run(async (ctx) => {
      await ctx.db.patch(f.firstId, { content: bigTranscript(0) });
    });
    for (let i = 1; i < 4; i += 1) {
      active.push(
        await f.t.run((ctx) =>
          ctx.db.insert("transcripts", {
            projectId: f.projectId,
            content: bigTranscript(i),
            position: i,
            createdAt: i,
          })
        )
      );
    }
    // Thirty replacements archive thirty rows of 500,000 characters each:
    // about 15 MB of archived text, more than one transaction may read.
    let current = active[0];
    for (let i = 0; i < 30; i += 1) {
      current = await f.writer.mutation(api.transcripts.replaceTranscript, {
        transcriptId: current,
        content: bigTranscript(100 + i),
      });
    }
    const list = await f.writer.query(api.transcripts.listTranscripts, { projectId: f.projectId });
    expect(list.map((row) => row._id)).toEqual([current, ...active.slice(1)]);
    expect(list.map((row) => row.position)).toEqual([0, 1, 2, 3]);

    // Remove, Add and Replace still work, and the Sources list follows.
    await f.writer.mutation(api.transcripts.removeTranscript, { transcriptId: active[3] });
    const added = await f.writer.mutation(api.transcripts.addTranscript, {
      projectId: f.projectId,
      content: bigTranscript(999),
    });
    const replaced = await f.writer.mutation(api.transcripts.replaceTranscript, {
      transcriptId: added,
      content: SECOND,
    });
    const after = await f.writer.query(api.transcripts.listTranscripts, { projectId: f.projectId });
    expect(after.map((row) => row._id)).toEqual([current, active[1], active[2], replaced]);
    expect((await f.t.run((ctx) => ctx.db.get(f.projectId)))?.archivedTranscriptCount).toBe(32);
  });

  it("counts archived rows on the project and refuses Add and Replace at the history cap", async () => {
    const f = await setup();
    const second = await f.writer.mutation(api.transcripts.addTranscript, { projectId: f.projectId, content: SECOND });
    const third = await f.writer.mutation(api.transcripts.replaceTranscript, {
      transcriptId: second,
      content: "Dana Whitfield: A third interview.",
    });
    await f.writer.mutation(api.transcripts.removeTranscript, { transcriptId: third });
    // Removing a row that is already archived counts nothing.
    await f.writer.mutation(api.transcripts.removeTranscript, { transcriptId: third });
    expect((await f.t.run((ctx) => ctx.db.get(f.projectId)))?.archivedTranscriptCount).toBe(2);

    // One active row and 199 archived ones: one more row would pass the cap.
    await f.t.run((ctx) => ctx.db.patch(f.projectId, { archivedTranscriptCount: MAX_TRANSCRIPT_HISTORY_ROWS - 1 }));
    await expect(
      f.writer.mutation(api.transcripts.addTranscript, { projectId: f.projectId, content: SECOND })
    ).rejects.toThrow(/transcript history limit/);
    await expect(
      f.writer.mutation(api.transcripts.replaceTranscript, { transcriptId: f.firstId, content: SECOND })
    ).rejects.toThrow(/transcript history limit/);
    // Remove writes no row, so it still works at the cap.
    await f.writer.mutation(api.transcripts.removeTranscript, { transcriptId: f.firstId });
    expect(await f.writer.query(api.transcripts.listTranscripts, { projectId: f.projectId })).toEqual([]);
  });
});

describe("stored originals", () => {
  it("refuses a file uploaded more than an hour ago", async () => {
    const f = await setup();
    const stale = await f.t.run((ctx) => ctx.storage.store(new Blob(["old upload"])));
    vi.setSystemTime(Date.now() + 2 * 60 * 60 * 1000);
    await expect(
      f.writer.mutation(api.transcripts.addTranscript, { projectId: f.projectId, content: SECOND, originalStorageId: stale })
    ).rejects.toThrow(/no longer available/);
    await expect(
      f.writer.mutation(api.projects.createProject, {
        title: "New",
        clientName: "Verdant Grid",
        transcripts: [{ content: SECOND, label: "b.vtt", originalStorageId: stale }],
      })
    ).rejects.toThrow(/no longer available/);
  });

  it("refuses a file another row already holds", async () => {
    const f = await setup();
    const { documentFile, transcriptFile } = await f.t.run(async (ctx) => {
      const otherProject = await ctx.db.insert("projects", {
        title: "Other",
        clientName: "Other client",
        status: "draft",
        createdBy: f.writerId,
        ownerId: f.writerId,
        shareToken: "in-token-other",
        createdAt: 1,
        updatedAt: 1,
      });
      const documentFile = await ctx.storage.store(new Blob(["other project's document"]));
      await ctx.db.insert("projectDocuments", {
        projectId: otherProject,
        fileName: "notes.docx",
        fileType: "docx",
        content: "Notes",
        storageId: documentFile,
        source: "upload",
        uploadedBy: "in-writer",
        createdAt: 1,
      });
      const transcriptFile = await ctx.storage.store(new Blob(["WEBVTT"]));
      return { documentFile, transcriptFile };
    });
    await expect(
      f.writer.mutation(api.transcripts.addTranscript, {
        projectId: f.projectId,
        content: SECOND,
        originalStorageId: documentFile,
      })
    ).rejects.toThrow(/already in use/);
    await f.writer.mutation(api.transcripts.addTranscript, {
      projectId: f.projectId,
      content: SECOND,
      originalStorageId: transcriptFile,
    });
    await expect(
      f.writer.mutation(api.transcripts.addTranscript, {
        projectId: f.projectId,
        content: "Dana Whitfield: A third interview.",
        originalStorageId: transcriptFile,
      })
    ).rejects.toThrow(/already in use/);
    const fresh = await f.t.run((ctx) => ctx.storage.store(new Blob(["WEBVTT 2"])));
    await expect(
      f.writer.mutation(api.projects.createProject, {
        title: "New",
        clientName: "Verdant Grid",
        transcripts: [
          { content: FIRST, label: "a.vtt", originalStorageId: fresh },
          { content: SECOND, label: "b.vtt", originalStorageId: fresh },
        ],
      })
    ).rejects.toThrow(/already in use/);
    await expect(
      f.writer.mutation(api.projects.createProject, {
        title: "New",
        clientName: "Verdant Grid",
        transcripts: [{ content: FIRST, label: "a.vtt", originalStorageId: documentFile }],
      })
    ).rejects.toThrow(/already in use/);
  });
});

describe("discardTranscriptOriginals", () => {
  async function exists(f: Awaited<ReturnType<typeof setup>>, id: Id<"_storage">) {
    return await f.t.run(async (ctx) => (await ctx.storage.get(id)) !== null);
  }

  it("releases the original of a refused Add, and never a file a row holds", async () => {
    const f = await setup();
    const refused = await f.t.run((ctx) => ctx.storage.store(new Blob(["same text again"])));
    expect(await f.writer.mutation(api.documents.claimUpload, { storageId: refused })).toBe(true);
    await expect(
      f.writer.mutation(api.transcripts.addTranscript, {
        projectId: f.projectId,
        content: FIRST,
        originalStorageId: refused,
      })
    ).rejects.toThrow(/already added/);
    const kept = await f.t.run((ctx) => ctx.storage.store(new Blob(["kept"])));
    expect(await f.writer.mutation(api.documents.claimUpload, { storageId: kept })).toBe(true);
    await f.writer.mutation(api.transcripts.addTranscript, {
      projectId: f.projectId,
      content: SECOND,
      originalStorageId: kept,
    });
    await f.writer.mutation(api.transcripts.discardTranscriptOriginals, { storageIds: [refused, kept] });
    expect(await exists(f, refused)).toBe(false);
    expect(await exists(f, kept)).toBe(true);
  });

  it("leaves files older than an hour alone and refuses callers outside the team", async () => {
    const f = await setup();
    const old = await f.t.run((ctx) => ctx.storage.store(new Blob(["old upload"])));
    await f.writer.mutation(api.documents.claimUpload, { storageId: old });
    vi.setSystemTime(Date.now() + 2 * 60 * 60 * 1000);
    await f.writer.mutation(api.transcripts.discardTranscriptOriginals, { storageIds: [old] });
    expect(await exists(f, old)).toBe(true);
    const fresh = await f.t.run((ctx) => ctx.storage.store(new Blob(["fresh upload"])));
    for (const caller of [f.roleless, f.anonymous, f.t]) {
      await expect(
        caller.mutation(api.transcripts.discardTranscriptOriginals, { storageIds: [fresh] })
      ).rejects.toThrow();
    }
    expect(await exists(f, fresh)).toBe(true);
  });

  // Security wave 1 (a2 P2-8): Convex does not record who uploaded a file,
  // so the browser claims each original; only the claimant can release it.
  it("releases only files the caller claimed, never another user's upload", async () => {
    const f = await setup();
    const mine = await f.t.run((ctx) => ctx.storage.store(new Blob(["mine"])));
    const theirs = await f.t.run((ctx) => ctx.storage.store(new Blob(["theirs"])));
    const unclaimed = await f.t.run((ctx) => ctx.storage.store(new Blob(["unclaimed"])));
    expect(await f.writer.mutation(api.documents.claimUpload, { storageId: mine })).toBe(true);
    expect(await f.other.mutation(api.documents.claimUpload, { storageId: theirs })).toBe(true);
    // The first claim wins.
    expect(await f.writer.mutation(api.documents.claimUpload, { storageId: theirs })).toBe(false);
    await f.writer.mutation(api.transcripts.discardTranscriptOriginals, {
      storageIds: [mine, theirs, unclaimed],
    });
    expect(await exists(f, mine)).toBe(false);
    expect(await exists(f, theirs)).toBe(true);
    expect(await exists(f, unclaimed)).toBe(true);
  });

  it("refuses to attach another user's claimed upload", async () => {
    const f = await setup();
    const theirs = await f.t.run((ctx) => ctx.storage.store(new Blob(["theirs"])));
    await f.other.mutation(api.documents.claimUpload, { storageId: theirs });
    await expect(
      f.writer.mutation(api.transcripts.addTranscript, {
        projectId: f.projectId,
        content: SECOND,
        originalStorageId: theirs,
      })
    ).rejects.toThrow(/already in use/);
  });
});

describe("list order on projects older than positions", () => {
  async function legacyProject() {
    const f = await setup();
    // Rows written before transcripts carried a position, oldest first.
    const ids = await f.t.run(async (ctx) => {
      await ctx.db.patch(f.firstId, { position: undefined, createdAt: 10 });
      const second = await ctx.db.insert("transcripts", {
        projectId: f.projectId,
        content: "Dana Whitfield: Legacy second interview.",
        createdAt: 20,
      });
      return [f.firstId, second];
    });
    return { f, ids };
  }

  it("adds a transcript after the older rows", async () => {
    const { f, ids } = await legacyProject();
    const added = await f.writer.mutation(api.transcripts.addTranscript, { projectId: f.projectId, content: SECOND });
    const list = await f.writer.query(api.transcripts.listTranscripts, { projectId: f.projectId });
    expect(list.map((row) => [row._id, row.position])).toEqual([
      [ids[0], 0],
      [ids[1], 1],
      [added, 2],
    ]);
  });

  it("replaces an older row in its place", async () => {
    const { f, ids } = await legacyProject();
    const replaced = await f.writer.mutation(api.transcripts.replaceTranscript, {
      transcriptId: ids[0],
      content: SECOND,
    });
    const list = await f.writer.query(api.transcripts.listTranscripts, { projectId: f.projectId });
    expect(list.map((row) => [row._id, row.position])).toEqual([
      [replaced, 0],
      [ids[1], 1],
    ]);
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
