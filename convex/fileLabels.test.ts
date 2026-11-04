/// <reference types="vite/client" />
/**
 * 2026-10-26 (Phase B4): when a file is labelled, what a label call reads,
 * and that labels never become evidence.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { documentTextHash, insertDocumentWithText, writeDocumentText } from "./lib/documentText";
import { FILE_LABELS_PROMPT_VERSION, labelSamples } from "./lib/fileLabels";
import { frozenSourceFields, selectFrozenEvidence } from "./lib/briefEvidence";

const modules = import.meta.glob("./**/*.ts");

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const LABEL_ONLY = "Summary words found only in the label";

async function setup() {
  const t = convexTest(schema, modules);
  const projectId = await t.run(async (ctx) => {
    const writerId = await ctx.db.insert("users", { authId: "labels-writer", role: "writer" });
    return await ctx.db.insert("projects", {
      title: "Seal", clientName: "Client", status: "draft", createdBy: writerId, ownerId: writerId,
      shareToken: "labels-tests", createdAt: Date.now(), updatedAt: Date.now(),
    });
  });
  const addFile = (fileName: string, text: string) =>
    t.run(async (ctx) =>
      insertDocumentWithText(ctx, { projectId, fileName, fileType: "txt", source: "chat_upload", uploadedBy: "writer", createdAt: Date.now() }, text)
    );
  const labelled = async (documentId: Id<"projectDocuments">) => {
    const hash = await t.run(async (ctx) => documentTextHash((await ctx.db.get(documentId))!));
    const doc = (await t.run(async (ctx) => ctx.db.get(documentId)))!;
    return await t.mutation(internal.fileLabels.saveFileLabels, {
      documentId,
      textHash: hash,
      fileName: doc.fileName,
      model: "claude-haiku-5-5",
      promptVersion: FILE_LABELS_PROMPT_VERSION,
      labels: { documentType: "technical report", fiscalYear: 2025, title: "Seal log", summary: LABEL_ONLY },
    });
  };
  return { t, projectId, addFile, labelled };
}

describe("label samples", () => {
  test("a short file is read whole; a long one by its opening, middle and end, cut between words", () => {
    expect(labelSamples("Short file.")).toEqual({ opening: "Short file." });
    const long = Array.from({ length: 4_000 }, (_, i) => `word${i}`).join(" ");
    const samples = labelSamples(long);
    expect(samples.opening.length).toBeGreaterThanOrEqual(12_000);
    expect(samples.middle).toBeDefined();
    expect(samples.end!.endsWith("word3999")).toBe(true);
    for (const part of [samples.opening, samples.middle!, samples.end!]) {
      expect(long.includes(part)).toBe(true);
      expect(/^word|^\S/.test(part)).toBe(true);
    }
  });
});

describe("when a file is labelled", () => {
  test("cutting a file's search pieces marks its labels due; current labels are not made again", async () => {
    const s = await setup();
    const documentId = await s.addFile("log.txt", "The seal held at 4.2 bar.");
    await s.t.mutation(internal.searchPieces.sweepDueSearchPieces, {});
    await s.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await s.t.run(async (ctx) => ctx.db.get(documentId)))?.labelsDue).toBe(true);
    expect(await s.labelled(documentId)).toBe("kept");
    const doc = (await s.t.run(async (ctx) => ctx.db.get(documentId)))!;
    expect(doc.labels).toMatchObject({ title: "Seal log", promptVersion: FILE_LABELS_PROMPT_VERSION });
    expect(doc.labelsDue).toBeUndefined();
    expect(await s.t.query(internal.fileLabels.labelInput, { documentId })).toBeNull();
  });

  test("labels for a file whose text or name changed meanwhile are not kept", async () => {
    const s = await setup();
    const documentId = await s.addFile("log.txt", "The seal held.");
    const hash = await s.t.run(async (ctx) => documentTextHash((await ctx.db.get(documentId))!));
    await s.t.run(async (ctx) => {
      const doc = (await ctx.db.get(documentId))!;
      await ctx.db.patch(documentId, await writeDocumentText(ctx, doc, "The seal failed."));
    });
    const save = (fileName: string, textHash: string) =>
      s.t.mutation(internal.fileLabels.saveFileLabels, {
        documentId, textHash, fileName, model: "m", promptVersion: FILE_LABELS_PROMPT_VERSION,
        labels: { documentType: "other", fiscalYear: null, title: "t", summary: "s" },
      });
    expect(await save("log.txt", hash)).toBe("changed");
    const now = await s.t.run(async (ctx) => documentTextHash((await ctx.db.get(documentId))!));
    expect(await save("renamed.txt", now)).toBe("changed");
    expect((await s.t.run(async (ctx) => ctx.db.get(documentId)))?.labels).toBeUndefined();
  });

  test("the sweep claims a due file once and waits out a retry", async () => {
    const s = await setup();
    const documentId = await s.addFile("log.txt", "The seal held.");
    await s.t.run(async (ctx) => ctx.db.patch(documentId, { labelsDue: true, labelsNextAt: Date.now() + 60_000 }));
    expect(await s.t.mutation(internal.fileLabels.sweepDueFileLabels, {})).toBe(0);
    vi.setSystemTime(Date.now() + 61_000);
    expect(await s.t.mutation(internal.fileLabels.sweepDueFileLabels, {})).toBe(1);
    expect(await s.t.mutation(internal.fileLabels.sweepDueFileLabels, {})).toBe(0);
  });

  test("archived, empty or already labelled files leave the queue instead of holding a place (review, 2026-10-26)", async () => {
    const s = await setup();
    const archived: Id<"projectDocuments">[] = [];
    for (let i = 0; i < 25; i++) archived.push(await s.addFile(`old${i}.txt`, `Archived file ${i}.`));
    const active = await s.addFile("active.txt", "The seal held.");
    await s.t.run(async (ctx) => {
      for (const id of archived) await ctx.db.patch(id, { archived: true, labelsDue: true, labelsNextAt: 0 });
      await ctx.db.patch(active, { labelsDue: true, labelsNextAt: 1 });
    });
    // The first sweep reads 20 archived files and retires them; the next reaches the active one.
    expect(await s.t.mutation(internal.fileLabels.sweepDueFileLabels, {})).toBe(0);
    expect(await s.t.mutation(internal.fileLabels.sweepDueFileLabels, {})).toBe(1);
    const left = await s.t.run(async (ctx) => Promise.all(archived.map((id) => ctx.db.get(id))));
    expect(left.every((doc) => doc?.labelsDue === undefined)).toBe(true);
  });

  test("restoring an archived file without current labels puts it back in the queue", async () => {
    const s = await setup();
    const writer = s.t.withIdentity({ subject: "labels-writer" });
    const documentId = await s.addFile("log.txt", "The seal held.");
    await s.t.run(async (ctx) => ctx.db.patch(documentId, { archived: true }));
    await writer.mutation(api.documents.setDocumentArchived, { documentId, archived: false });
    expect(await s.t.run(async (ctx) => ctx.db.get(documentId))).toMatchObject({ labelsDue: true, labelsNextAt: 0 });
  });

  test("the backfill marks files with text and missing or stale labels", async () => {
    const s = await setup();
    const current = await s.addFile("current.txt", "Labelled already.");
    await s.labelled(current);
    await s.addFile("bare.txt", "No labels yet.");
    await s.addFile("empty.txt", "   ");
    expect(await s.t.mutation(internal.fileLabels.markFileLabelsDue, { dryRun: true })).toEqual({ marked: 1, isDone: true });
    expect(await s.t.mutation(internal.fileLabels.markFileLabelsDue, {})).toEqual({ marked: 1, isDone: true });
  });
});

describe("labels are never evidence", () => {
  test("a draft's frozen evidence and a search never carry a file's labels", async () => {
    const s = await setup();
    const documentId = await s.addFile("log.txt", "The seal held at 4.2 bar in trial 3.");
    await s.labelled(documentId);
    const fields = await s.t.run(async (ctx) => frozenSourceFields(await selectFrozenEvidence(ctx, s.projectId)));
    expect(JSON.stringify(fields)).not.toContain(LABEL_ONLY);
    await s.t.mutation(internal.searchPieces.sweepDueSearchPieces, {});
    await s.t.finishAllScheduledFunctions(vi.runAllTimers);
    const search = await s.t.query(internal.searchPieces.searchProject, { projectId: s.projectId, query: "summary label seal" });
    expect(JSON.stringify(search)).not.toContain(LABEL_ONLY);
  });
});
