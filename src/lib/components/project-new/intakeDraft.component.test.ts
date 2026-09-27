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
