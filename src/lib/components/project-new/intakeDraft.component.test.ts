import { describe, expect, it, vi } from "vitest";
import { ConvexError } from "convex/values";
import { IntakeDraftSync, INTAKE_DRAFT_STORAGE_KEY, textHash, type IntakeCalls } from "./intakeDraft.svelte";
import type { IntakeSourceDesc } from "./intakePlan";

/**
 * Decision 65, stage 2 review fixes (Opus 5.5): the browser side of the
 * private intake draft. Replacing a file never attaches the old file's
 * upload; a draft the server no longer has ends quietly; a draft still
 * being made when the writer leaves is discarded when it returns.
 */
type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

function fakeCalls(overrides: Partial<Record<keyof IntakeCalls, ReturnType<typeof vi.fn>>> = {}) {
  const calls = {
    createIntakeDraft: vi.fn(async () => "draft-1"),
    saveIntakeSource: vi.fn(async () => null),
    removeIntakeSource: vi.fn(async () => null),
    attachIntakeOriginal: vi.fn(async () => true),
    updateIntakeContext: vi.fn(async () => null),
    setIntakeSelection: vi.fn(async () => null),
    reportIntakePendingReads: vi.fn(async () => null),
    discardIntakeDraft: vi.fn(async () => null),
    promoteIntakeDraft: vi.fn(async () => ({ projectId: "project-1", complete: true, sources: [] })),
    ...overrides,
  };
  return calls;
}

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    values,
  };
}

const doc = (content: string, file: File): IntakeSourceDesc => ({
  sourceKey: "document-key-1",
  kind: "document",
  position: 1000,
  label: file.name,
  content,
  fileType: "txt",
  category: "other",
  intake: "file",
  extractionOutcome: "ok",
  file,
});

describe("IntakeDraftSync", () => {
  it("Replace file: the old file's upload is released, never attached; the new one carries its own text hash", async () => {
    const calls = fakeCalls();
    const uploads = new Map<string, Deferred<string>>();
    const released: string[] = [];
    const sync = new IntakeDraftSync({
      calls: calls as unknown as IntakeCalls,
      uploadOriginal: (file) => {
        const next = deferred<string>();
        uploads.set(file.name, next);
        return next.promise as never;
      },
      releaseUpload: async (storageId) => void released.push(storageId),
      delayMs: 1,
    });
    const first = new File(["old"], "notes-v1.txt", { type: "text/plain" });
    const second = new File(["new"], "notes-v2.txt", { type: "text/plain" });
    sync.reconcile([doc("Old notes.", first)]);
    await expect.poll(() => uploads.has("notes-v1.txt")).toBe(true);
    // Replaced while the first file is still uploading.
    sync.reconcile([doc("New notes.", second)]);
    await expect.poll(() => uploads.has("notes-v2.txt")).toBe(true);
    uploads.get("notes-v1.txt")!.resolve("storage-old");
    uploads.get("notes-v2.txt")!.resolve("storage-new");
    await expect.poll(() => calls.attachIntakeOriginal.mock.calls.length).toBe(1);
    await expect.poll(() => released).toEqual(["storage-old"]);
    expect(calls.attachIntakeOriginal.mock.calls[0][0]).toMatchObject({
      storageId: "storage-new",
      contentHash: await textHash("New notes."),
    });
  });

  it("reports files still being read or saved, less unticked ones, keeps a count above zero fresh, and stops at promotion", async () => {
    const calls = fakeCalls();
    const sync = new IntakeDraftSync({
      calls: calls as unknown as IntakeCalls,
      uploadOriginal: async () => undefined,
      delayMs: 1,
      refreshMs: 40,
    });
    const sent = () => calls.reportIntakePendingReads.mock.calls.map(([args]) => (args as { count: number }).count);
    // Nothing is sent before a draft exists.
    sync.setReading({ keys: ["document-key-2"], unkeyed: 1 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls.reportIntakePendingReads).not.toHaveBeenCalled();
    // The first saved file makes the draft: a document still being read and
    // a transcript file still being parsed count.
    sync.reconcile([doc("Notes.", new File(["x"], "notes.txt"))]);
    await expect.poll(() => sent().at(-1)).toBe(2);
    expect(calls.reportIntakePendingReads.mock.calls.at(-1)![0]).toEqual({ draftId: "draft-1", count: 2 });
    // Kept fresh while above zero.
    const before = calls.reportIntakePendingReads.mock.calls.length;
    await expect.poll(() => calls.reportIntakePendingReads.mock.calls.length).toBeGreaterThan(before + 1);
    // Unticked in the start dialog: that file does not count.
    sync.setSelection(["document-key-2"]);
    await expect.poll(() => sent().at(-1)).toBe(1);
    sync.setReading({ keys: ["document-key-2"], unkeyed: 0 });
    await expect.poll(() => sent().at(-1)).toBe(0);
    // At zero nothing more is sent.
    const settled = calls.reportIntakePendingReads.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(calls.reportIntakePendingReads.mock.calls.length).toBe(settled);
    // Promotion stops the count; the server clears it.
    sync.setSelection([]);
    await expect.poll(() => sent().at(-1)).toBe(1);
    await sync.promote({ commandId: "command-1", sourceKeys: ["document-key-1"], project: { title: "Cold seal" } as never });
    const promoted = calls.reportIntakePendingReads.mock.calls.length;
    sync.setReading({ keys: [], unkeyed: 3 });
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(calls.reportIntakePendingReads.mock.calls.length).toBe(promoted);
  });

  it("a read reporting progress every 50 ms still sends its count within about 400 ms (P2-1)", async () => {
    const calls = fakeCalls();
    const sync = new IntakeDraftSync({
      calls: calls as unknown as IntakeCalls,
      uploadOriginal: async () => undefined,
    });
    sync.reconcile([doc("Notes.", new File(["x"], "notes.txt"))]);
    await expect.poll(() => calls.saveIntakeSource.mock.calls.length).toBe(1);
    await expect.poll(() => sync.draftId).toBe("draft-1");
    // A PDF read replaces its card once a page: the page hands the same
    // reading file over again and again.
    const startedAt = Date.now();
    const progress = setInterval(() => sync.setReading({ keys: ["document-key-2"], unkeyed: 0 }), 50);
    try {
      sync.setReading({ keys: ["document-key-2"], unkeyed: 0 });
      await expect
        .poll(() => calls.reportIntakePendingReads.mock.calls.length, { timeout: 2_000, interval: 10 })
        .toBeGreaterThan(0);
      expect(Date.now() - startedAt).toBeLessThan(450);
      expect(calls.reportIntakePendingReads.mock.calls[0][0]).toEqual({ draftId: "draft-1", count: 1 });
    } finally {
      clearInterval(progress);
      sync.dispose();
    }
  });

  it("a failed report of zero is sent again by the refresh (P3-2)", async () => {
    let failNext = false;
    const calls = fakeCalls({
      reportIntakePendingReads: vi.fn(async () => {
        if (failNext) {
          failNext = false;
          throw new Error("offline");
        }
        return null;
      }),
    });
    const sync = new IntakeDraftSync({
      calls: calls as unknown as IntakeCalls,
      uploadOriginal: async () => undefined,
      delayMs: 1,
      refreshMs: 30,
    });
    const sent = () => calls.reportIntakePendingReads.mock.calls.map(([args]) => (args as { count: number }).count);
    sync.setReading({ keys: ["document-key-2"], unkeyed: 0 });
    sync.reconcile([doc("Notes.", new File(["x"], "notes.txt"))]);
    await expect.poll(() => sent().at(-1)).toBe(1);
    failNext = true;
    sync.setReading({ keys: [], unkeyed: 0 });
    // The first report of zero fails; the refresh sends it again, then stops.
    await expect.poll(() => sent().filter((count) => count === 0).length).toBe(2);
    const settled = calls.reportIntakePendingReads.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(calls.reportIntakePendingReads.mock.calls.length).toBe(settled);
    sync.dispose();
  });

  it("no timer survives the page: nothing is sent after dispose, even by a report on its way (P3-3)", async () => {
    let answer!: () => void;
    const calls = fakeCalls({
      reportIntakePendingReads: vi.fn(() => new Promise<null>((resolve) => (answer = () => resolve(null)))),
    });
    const sync = new IntakeDraftSync({
      calls: calls as unknown as IntakeCalls,
      uploadOriginal: async () => undefined,
      delayMs: 1,
      refreshMs: 20,
    });
    sync.setReading({ keys: ["document-key-2"], unkeyed: 1 });
    sync.reconcile([doc("Notes.", new File(["x"], "notes.txt"))]);
    await expect.poll(() => calls.reportIntakePendingReads.mock.calls.length).toBe(1);
    // The page goes while the report is on its way; its answer starts nothing.
    sync.dispose();
    answer();
    sync.setReading({ keys: [], unkeyed: 4 });
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(calls.reportIntakePendingReads).toHaveBeenCalledTimes(1);
  });

  it("a draft the server no longer has ends: no more saves, no receipts, no stored id", async () => {
    const storage = memoryStorage();
    const calls = fakeCalls({
      saveIntakeSource: vi.fn(async () => {
        throw new ConvexError({ code: "INTAKE_DRAFT_GONE", message: "This setup is no longer available" });
      }),
    });
    const sync = new IntakeDraftSync({
      calls: calls as unknown as IntakeCalls,
      uploadOriginal: async () => undefined,
      storage,
      delayMs: 1,
    });
    sync.reconcile([doc("Notes.", new File(["x"], "notes.txt"))]);
    await expect.poll(() => sync.closed).toBe(true);
    expect(sync.draftId).toBeNull();
    expect(sync.receipts.size).toBe(0);
    expect(storage.values.has(INTAKE_DRAFT_STORAGE_KEY)).toBe(false);
    sync.reconcile([doc("More notes.", new File(["y"], "more.txt"))]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls.saveIntakeSource).toHaveBeenCalledTimes(1);
  });

  it("a draft still being made when the writer leaves is discarded when it returns, and its id is never stored", async () => {
    const storage = memoryStorage();
    const made = deferred<string>();
    const calls = fakeCalls({ createIntakeDraft: vi.fn(() => made.promise) });
    const sync = new IntakeDraftSync({
      calls: calls as unknown as IntakeCalls,
      uploadOriginal: async () => undefined,
      storage,
      delayMs: 1,
    });
    sync.reconcile([doc("Notes.", new File(["x"], "notes.txt"))]);
    await expect.poll(() => calls.createIntakeDraft.mock.calls.length).toBe(1);
    expect(sync.started).toBe(true);
    sync.discard();
    made.resolve("draft-late");
    await expect.poll(() => calls.discardIntakeDraft.mock.calls).toEqual([[{ draftId: "draft-late" }]]);
    expect(storage.values.has(INTAKE_DRAFT_STORAGE_KEY)).toBe(false);
    expect(calls.saveIntakeSource).not.toHaveBeenCalled();
  });

  it("a later promotion step that fails is polled again; the project stays the one the first step made", async () => {
    const results: Array<unknown> = [
      { projectId: "project-1", complete: false, sources: [] },
      new Error("network"),
      { projectId: "project-1", complete: false, sources: [] },
      { projectId: "project-1", complete: true, sources: [{ sourceKey: "k", kind: "transcript", transcriptId: "t-1" }] },
    ];
    const calls = fakeCalls({
      promoteIntakeDraft: vi.fn(async () => {
        const next = results.shift();
        if (next instanceof Error) throw next;
        return next;
      }),
    });
    const sync = new IntakeDraftSync({ calls: calls as unknown as IntakeCalls, uploadOriginal: async () => undefined, delayMs: 1 });
    sync.reconcile([doc("Notes.", new File(["x"], "notes.txt"))]);
    await expect.poll(() => sync.draftId).toBe("draft-1");
    const outcome = await sync.promote({ commandId: "c", sourceKeys: ["k"], project: { title: "T", clientName: "C" } });
    expect(outcome).toMatchObject({ kind: "complete", receipt: { projectId: "project-1", complete: true } });
    expect(calls.promoteIntakeDraft).toHaveBeenCalledTimes(4);
  }, 10_000);

  it("a leave-out choice still waiting when the writer confirms is never sent after the promotion (live test 2026-09-26)", async () => {
    const promoted = deferred<{ projectId: string; complete: boolean; sources: never[] }>();
    const calls = fakeCalls({
      promoteIntakeDraft: vi.fn(() => promoted.promise),
      setIntakeSelection: vi.fn(async () => {
        throw new ConvexError({ code: "INTAKE_DRAFT_GONE", message: "This setup is no longer available" });
      }),
    });
    const sync = new IntakeDraftSync({ calls: calls as unknown as IntakeCalls, uploadOriginal: async () => undefined, delayMs: 30 });
    sync.reconcile([doc("Notes.", new File(["x"], "notes.txt"))]);
    await expect.poll(() => sync.receipts.get("document-key-1")).toBe("saved");
    // The start dialog's choice is on its short delay when Confirm is pressed.
    sync.setSelection(["document-key-1"]);
    await sync.flush();
    const outcome = sync.promote({ commandId: "c", sourceKeys: [], project: { title: "T", clientName: "C" } });
    // A choice made while the promotion runs is not sent either.
    sync.setSelection([]);
    await new Promise((resolve) => setTimeout(resolve, 80));
    promoted.resolve({ projectId: "project-1", complete: true, sources: [] });
    await expect(outcome).resolves.toMatchObject({ kind: "complete" });
    expect(calls.setIntakeSelection).not.toHaveBeenCalled();
    // The draft was not ended by a late save, so a pending promotion could still be followed.
    expect(sync.draftId).toBe("draft-1");
  });

  it("an original is hashed from the text saved last, so a note edit during its upload never refuses it (P3-2)", async () => {
    const calls = fakeCalls();
    const upload = deferred<string>();
    const sync = new IntakeDraftSync({
      calls: calls as unknown as IntakeCalls,
      uploadOriginal: () => upload.promise as never,
      delayMs: 1,
    });
    const file = new File(["report"], "report.pdf");
    sync.reconcile([doc("[Previous-year report] Note: old note.", file)]);
    await expect.poll(() => calls.saveIntakeSource.mock.calls.length).toBe(1);
    // The year's note changes while the original uploads: same file, new text.
    sync.reconcile([doc("[Previous-year report] Note: new note.", file)]);
    await expect.poll(() => calls.saveIntakeSource.mock.calls.length).toBe(2);
    upload.resolve("storage-report");
    await expect.poll(() => calls.attachIntakeOriginal.mock.calls.length).toBe(1);
    expect(calls.attachIntakeOriginal.mock.calls[0][0]).toMatchObject({
      storageId: "storage-report",
      contentHash: await textHash("[Previous-year report] Note: new note."),
    });
  });
});

describe("a reload picks the draft up again (2026-09-27, fourth)", () => {
  const transcript: IntakeSourceDesc = {
    sourceKey: "transcript-key-1",
    kind: "transcript",
    position: 0,
    label: "Interview",
    content: "Interviewer: Hi.",
    sourceFormat: "txt",
    file: null,
  };

  it("the page that gets the lock picks it up and sends nothing again for what the draft holds", async () => {
    const calls = fakeCalls();
    const storage = memoryStorage();
    storage.setItem(INTAKE_DRAFT_STORAGE_KEY, "draft-left");
    const held: string[] = [];
    const sync = new IntakeDraftSync({
      calls: calls as unknown as IntakeCalls,
      uploadOriginal: async () => undefined,
      storage,
      delayMs: 1,
      holdLock: async (name) => {
        held.push(name);
        return () => undefined;
      },
    });
    const draftId = await sync.claimLeftover();
    expect(draftId).toBe("draft-left");
    expect(held).toEqual(["banhall:intake-draft:draft-left"]);
    sync.adopt({
      draftId: draftId!,
      sources: [transcript],
      context: { clientName: "Acme Seals", interviewees: ["Priya Raman"] },
      selection: ["document-key-9"],
    });
    sync.reconcile([{ ...transcript }]);
    sync.setContext({ clientName: "Acme Seals", interviewees: ["Priya Raman"] });
    sync.setSelection(["document-key-9"]);
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(calls.saveIntakeSource).not.toHaveBeenCalled();
    expect(calls.updateIntakeContext).not.toHaveBeenCalled();
    expect(calls.setIntakeSelection).not.toHaveBeenCalled();
    expect(calls.createIntakeDraft).not.toHaveBeenCalled();
    expect(sync.receipts.get("transcript-key-1")).toBe("saved");
    // A change after the pick-up is saved to the same draft.
    sync.reconcile([{ ...transcript, label: "Morning interview" }]);
    await expect.poll(() => calls.saveIntakeSource.mock.calls.length).toBe(1);
    expect(calls.saveIntakeSource.mock.calls[0][0]).toMatchObject({ draftId: "draft-left", label: "Morning interview" });
  });

  it("a second tab finds the lock held: it forgets the id, discards nothing and makes its own draft", async () => {
    const calls = fakeCalls({ createIntakeDraft: vi.fn(async () => "draft-own") });
    const storage = memoryStorage();
    storage.setItem(INTAKE_DRAFT_STORAGE_KEY, "draft-other-tab");
    const sync = new IntakeDraftSync({
      calls: calls as unknown as IntakeCalls,
      uploadOriginal: async () => undefined,
      storage,
      delayMs: 1,
      holdLock: async (name) => (name.endsWith("draft-other-tab") ? null : () => undefined),
    });
    expect(await sync.claimLeftover()).toBeNull();
    expect(storage.getItem(INTAKE_DRAFT_STORAGE_KEY)).toBeNull();
    sync.reconcile([transcript]);
    await expect.poll(() => calls.saveIntakeSource.mock.calls.length).toBe(1);
    expect(calls.saveIntakeSource.mock.calls[0][0]).toMatchObject({ draftId: "draft-own" });
    expect(calls.discardIntakeDraft).not.toHaveBeenCalled();
    expect(storage.getItem(INTAKE_DRAFT_STORAGE_KEY)).toBe("draft-own");
  });

  it("a new draft waits for a pick-up still on its way instead of making a second one", async () => {
    const calls = fakeCalls();
    const storage = memoryStorage();
    storage.setItem(INTAKE_DRAFT_STORAGE_KEY, "draft-left");
    const sync = new IntakeDraftSync({
      calls: calls as unknown as IntakeCalls,
      uploadOriginal: async () => undefined,
      storage,
      delayMs: 1,
      holdLock: async () => () => undefined,
    });
    const loading = deferred<void>();
    sync.holdUntil(
      (async () => {
        const draftId = await sync.claimLeftover();
        await loading.promise;
        sync.adopt({ draftId: draftId!, sources: [], context: { clientName: "", interviewees: [] }, selection: [] });
      })()
    );
    sync.reconcile([transcript]);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(calls.saveIntakeSource).not.toHaveBeenCalled();
    loading.resolve();
    await expect.poll(() => calls.saveIntakeSource.mock.calls.length).toBe(1);
    expect(calls.saveIntakeSource.mock.calls[0][0]).toMatchObject({ draftId: "draft-left" });
    expect(calls.createIntakeDraft).not.toHaveBeenCalled();
  });

  it("a Step-by-step confirm sends the final file choice with confirm just before the promotion", async () => {
    const order: string[] = [];
    const calls = fakeCalls({
      setIntakeSelection: vi.fn(async () => void order.push("selection")),
      promoteIntakeDraft: vi.fn(async () => {
        order.push("promote");
        return { projectId: "project-1", complete: true, sources: [] };
      }),
    });
    const sync = new IntakeDraftSync({ calls: calls as unknown as IntakeCalls, uploadOriginal: async () => undefined, delayMs: 1 });
    sync.reconcile([transcript]);
    await expect.poll(() => sync.draftId).toBe("draft-1");
    sync.setSelection(["document-key-2"]);
    // Pressed within the quiet period: the waiting change is not sent late.
    await sync.promote(
      { commandId: "c-1", sourceKeys: ["transcript-key-1"], project: { title: "Cold seal", clientName: "Acme Seals" } },
      { confirmSelection: ["document-key-2"] }
    );
    expect(order).toEqual(["selection", "promote"]);
    expect(calls.setIntakeSelection.mock.calls).toEqual([
      [{ draftId: "draft-1", excludedSourceKeys: ["document-key-2"], confirm: true }],
    ]);
  });
});
