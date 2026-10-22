import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import { storeProjectFile, type StoreProjectFileDeps } from "./storeProjectFile";

const projectId = "project-1" as Id<"projects">;
const attemptKey = "11111111-1111-4111-8111-111111111111";

function operation(controller = new AbortController()) {
  return {
    signal: controller.signal,
    throwIfAborted: () => controller.signal.throwIfAborted(),
  };
}

function deps(overrides: Partial<StoreProjectFileDeps> = {}) {
  return {
    generateUploadUrl: vi.fn(async () => "https://upload.test/bytes"),
    uploadDocument: vi.fn(async () => "document-1" as Id<"projectDocuments">),
    parse: vi.fn(async (file: File) => ({ fileName: file.name, fileType: "txt" as const, content: await file.text() })),
    ...overrides,
  };
}

const notes = () => new File(["Measured at three sites."], "site-notes.txt", { type: "text/plain" });

beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ storageId: "stored-bytes" }));
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("storeProjectFile", () => {
  it("saves the text and the original bytes under the given source and category", async () => {
    const d = deps();
    const stored = await storeProjectFile(d, {
      projectId, file: notes(), attemptKey, source: "context_input", category: "writer_notes", operation: operation(),
    });
    expect(stored).toEqual({ documentId: "document-1", content: "Measured at three sites.", extractionFailed: false });
    expect(d.uploadDocument).toHaveBeenCalledWith({
      projectId,
      fileName: "site-notes.txt",
      fileType: "txt",
      content: "Measured at three sites.",
      source: "context_input",
      category: "writer_notes",
      extractionOutcome: "ok",
      attemptKey,
      storageId: "stored-bytes",
      mimeType: "text/plain",
    });
  });

  it("still saves a file it could not read, with no text and the failure as a code", async () => {
    const d = deps({ parse: vi.fn(async () => { throw new Error("parser exploded at line 3"); }) });
    const stored = await storeProjectFile(d, {
      projectId, file: new File(["%PDF"], "scan.pdf"), attemptKey, source: "context_input", operation: operation(),
    });
    expect(stored.extractionFailed).toBe(true);
    const [args] = vi.mocked(d.uploadDocument).mock.calls[0] as unknown as [Record<string, unknown>];
    expect(args).toMatchObject({ fileType: "pdf", content: "", extractionOutcome: "failed" });
    expect(JSON.stringify(args)).not.toContain("exploded");
    expect(args).not.toHaveProperty("category");
  });

  it("keeps the text when the original bytes could not be stored", async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));
    const d = deps();
    await storeProjectFile(d, { projectId, file: notes(), attemptKey, source: "context_input", operation: operation() });
    const [args] = vi.mocked(d.uploadDocument).mock.calls[0] as unknown as [Record<string, unknown>];
    expect(args.content).toBe("Measured at three sites.");
    expect(args).not.toHaveProperty("storageId");
  });

  it("stops before storing anything once its owner is gone", async () => {
    const controller = new AbortController();
    const d = deps({
      parse: vi.fn(async () => {
        controller.abort();
        throw new DOMException("Read canceled", "AbortError");
      }),
    });
    await expect(storeProjectFile(d, {
      projectId, file: notes(), attemptKey, source: "context_input", operation: operation(controller),
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(d.generateUploadUrl).not.toHaveBeenCalled();
    expect(d.uploadDocument).not.toHaveBeenCalled();
  });

  it("throws when the save itself is refused", async () => {
    const d = deps({ uploadDocument: vi.fn(async () => { throw new Error("Refused"); }) });
    await expect(storeProjectFile(d, {
      projectId, file: notes(), attemptKey, source: "context_input", operation: operation(),
    })).rejects.toThrow("Refused");
  });
});
