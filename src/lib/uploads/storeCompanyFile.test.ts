import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  CompanyFileTooLargeError,
  MAX_COMPANY_FILE_BYTES,
  prepareCompanyFile,
  progressFetch,
  storeCompanyFile,
  type CompanyFileProgress,
  type StoreCompanyFileDeps,
} from "./storeCompanyFile";

const clientId = "client-1" as Id<"clients">;
const attemptKey = "22222222-2222-4222-8222-222222222222";

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
      attemptKey,
    });
    expect(stored).toEqual({ companyFileId: "company-file-1", extractionFailed: false });
    expect(d.addCompanyFile).toHaveBeenCalledWith({
      clientId,
      fileName: "history.txt",
      fileType: "txt",
      content: "Acme seals pumps.",
      extractionOutcome: "ok",
      attemptKey,
      storageId: "stored-bytes",
      mimeType: "text/plain",
    });
  });

  it("keeps a Word file's Markdown flag", async () => {
    const d = deps({
      parse: vi.fn(async () => ({ fileName: "plan.docx", fileType: "docx" as const, content: "# Plan", textFormat: "markdown" as const })),
    });
    await storeCompanyFile(d, { clientId, file: new File(["PK"], "plan.docx"), attemptKey });
    expect(vi.mocked(d.addCompanyFile).mock.calls[0]?.[0]).toMatchObject({ fileType: "docx", textFormat: "markdown" });
  });

  it("still saves a file it could not read, with no text and the failure as a code", async () => {
    const d = deps({ parse: vi.fn(async () => { throw new Error("parser exploded at line 3"); }) });
    const stored = await storeCompanyFile(d, { clientId, file: new File(["%PDF"], "scan.pdf"), attemptKey });
    expect(stored.extractionFailed).toBe(true);
    const [args] = vi.mocked(d.addCompanyFile).mock.calls[0] as unknown as [Record<string, unknown>];
    expect(args).toMatchObject({ fileType: "pdf", content: "", extractionOutcome: "failed", storageId: "stored-bytes" });
    expect(JSON.stringify(args)).not.toContain("exploded");
  });

  it("saves the text when the original could not be stored", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(async () => new Response("no", { status: 500 }));
    const d = deps();
    await storeCompanyFile(d, { clientId, file: new File(["Text."], "a.txt"), attemptKey });
    const [args] = vi.mocked(d.addCompanyFile).mock.calls[0] as unknown as [Record<string, unknown>];
    expect(args.content).toBe("Text.");
    expect(args).not.toHaveProperty("storageId");
  });

  it("refuses a file over 50 MB before reading or sending anything (2026-11-04)", async () => {
    const d = deps();
    const big = new File(["x"], "drawings.pdf");
    Object.defineProperty(big, "size", { value: MAX_COMPANY_FILE_BYTES + 1 });
    await expect(storeCompanyFile(d, { clientId, file: big, attemptKey })).rejects.toBeInstanceOf(CompanyFileTooLargeError);
    await expect(storeCompanyFile(d, { clientId, file: big, attemptKey })).rejects.toThrow("Too large, up to 50 MB");
    expect(d.parse).not.toHaveBeenCalled();
    expect(d.generateUploadUrl).not.toHaveBeenCalled();
    expect(d.addCompanyFile).not.toHaveBeenCalled();
    // Exactly 50 MB is allowed.
    const edge = new File(["x"], "edge.txt");
    Object.defineProperty(edge, "size", { value: MAX_COMPANY_FILE_BYTES });
    await storeCompanyFile(d, { clientId, file: edge, attemptKey });
    expect(d.addCompanyFile).toHaveBeenCalledTimes(1);
  });

  it("reports reading, uploading and saving, in order", async () => {
    const steps: CompanyFileProgress[] = [];
    const d = deps({
      fetch: vi.fn(async () => Response.json({ storageId: "stored-bytes" })) as unknown as typeof fetch,
    });
    await storeCompanyFile(d, { clientId, file: new File(["Text."], "a.txt"), attemptKey, onProgress: (step) => steps.push(step) });
    expect(steps.map((step) => step.phase)).toEqual(["reading", "uploading", "saving"]);
  });

  it("prepares a replacement's text and original without saving a row", async () => {
    const d = deps();
    const prepared = await prepareCompanyFile(d, { file: new File(["New text."], "v2.txt", { type: "text/plain" }) });
    expect(prepared).toEqual({
      fileName: "v2.txt",
      fileType: "txt",
      content: "New text.",
      extractionFailed: false,
      storageId: "stored-bytes",
      mimeType: "text/plain",
    });
    expect(d.addCompanyFile).not.toHaveBeenCalled();
  });
});

describe("progressFetch", () => {
  class FakeXhr {
    static last: FakeXhr | null = null;
    upload: { onprogress: ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    status = 0;
    responseText = "";
    headers: Record<string, string> = {};
    method = "";
    url = "";
    sent: unknown = null;
    constructor() {
      FakeXhr.last = this;
    }
    open(method: string, url: string) {
      this.method = method;
      this.url = url;
    }
    setRequestHeader(key: string, value: string) {
      this.headers[key] = value;
    }
    send(body: unknown) {
      this.sent = body;
    }
    abort() {
      this.onabort?.();
    }
  }

  beforeEach(() => {
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts the body and reports the share sent, then answers with the response", async () => {
    const fractions: number[] = [];
    const body = new Blob(["bytes"], { type: "text/plain" });
    const pending = progressFetch((fraction) => fractions.push(fraction))("https://upload.test/bytes", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body,
    });
    const xhr = FakeXhr.last!;
    expect(xhr.method).toBe("POST");
    expect(xhr.url).toBe("https://upload.test/bytes");
    expect(xhr.headers["content-type"]).toBe("text/plain");
    expect(xhr.sent).toBe(body);
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 32, total: 100 });
    xhr.status = 200;
    xhr.responseText = JSON.stringify({ storageId: "stored-bytes" });
    xhr.onload?.();
    const response = await pending;
    expect(response.ok).toBe(true);
    expect(await response.json()).toEqual({ storageId: "stored-bytes" });
    expect(fractions).toEqual([0.32, 1]);
  });

  it("aborts the request when its signal does", async () => {
    const controller = new AbortController();
    const pending = progressFetch(() => {})("https://upload.test/bytes", {
      method: "POST",
      body: new Blob(["bytes"]),
      signal: controller.signal,
    });
    controller.abort(new DOMException("stop", "AbortError"));
    await expect(pending).rejects.toThrow("stop");
  });
});
