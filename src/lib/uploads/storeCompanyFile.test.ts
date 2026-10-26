import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import { storeCompanyFile, type StoreCompanyFileDeps } from "./storeCompanyFile";

const clientId = "client-1" as Id<"clients">;

function deps(overrides: Partial<StoreCompanyFileDeps> = {}) {
  return {
    generateUploadUrl: vi.fn(async () => "https://upload.test/bytes"),
    addCompanyFile: vi.fn(async () => "company-file-1" as Id<"companyFiles">),
    parse: vi.fn(async (file: File) => ({ fileName: file.name, fileType: "txt" as const, content: await file.text() })),
    ...overrides,
  };
}

beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ storageId: "stored-bytes" }));
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("storeCompanyFile", () => {
  it("saves the text and the original bytes on the company", async () => {
    const d = deps();
    const stored = await storeCompanyFile(d, {
      clientId,
      file: new File(["Acme seals pumps."], "history.txt", { type: "text/plain" }),
    });
    expect(stored).toEqual({ companyFileId: "company-file-1", extractionFailed: false });
    expect(d.addCompanyFile).toHaveBeenCalledWith({
      clientId,
      fileName: "history.txt",
      fileType: "txt",
      content: "Acme seals pumps.",
      extractionOutcome: "ok",
      storageId: "stored-bytes",
      mimeType: "text/plain",
    });
  });

  it("keeps a Word file's Markdown flag", async () => {
    const d = deps({
      parse: vi.fn(async () => ({ fileName: "plan.docx", fileType: "docx" as const, content: "# Plan", textFormat: "markdown" as const })),
    });
    await storeCompanyFile(d, { clientId, file: new File(["PK"], "plan.docx") });
    expect(vi.mocked(d.addCompanyFile).mock.calls[0]?.[0]).toMatchObject({ fileType: "docx", textFormat: "markdown" });
  });

  it("still saves a file it could not read, with no text and the failure as a code", async () => {
    const d = deps({ parse: vi.fn(async () => { throw new Error("parser exploded at line 3"); }) });
    const stored = await storeCompanyFile(d, { clientId, file: new File(["%PDF"], "scan.pdf") });
    expect(stored.extractionFailed).toBe(true);
    const [args] = vi.mocked(d.addCompanyFile).mock.calls[0] as unknown as [Record<string, unknown>];
    expect(args).toMatchObject({ fileType: "pdf", content: "", extractionOutcome: "failed", storageId: "stored-bytes" });
    expect(JSON.stringify(args)).not.toContain("exploded");
  });

  it("saves the text when the original could not be stored", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(async () => new Response("no", { status: 500 }));
    const d = deps();
    await storeCompanyFile(d, { clientId, file: new File(["Text."], "a.txt") });
    const [args] = vi.mocked(d.addCompanyFile).mock.calls[0] as unknown as [Record<string, unknown>];
    expect(args.content).toBe("Text.");
    expect(args).not.toHaveProperty("storageId");
  });
});
