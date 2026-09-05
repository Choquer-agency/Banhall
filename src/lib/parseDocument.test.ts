import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import {
  capContent,
  normalizeExtractedText,
  getFileExtension,
  isImageFile,
  isSupportedFile,
  parseFileToText,
  SUPPORTED_ACCEPT,
  SUPPORTED_EXTENSIONS,
} from "./parseDocument";
import {
  deriveProcessingStatus,
  hasTruncationMarker,
  pdfPageStopMarker,
} from "../../shared/documentStatus";

const pdfjs = vi.hoisted(() => ({ getDocument: vi.fn() }));
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: pdfjs.getDocument,
}));

describe("supported file registry", () => {
  it("accept attribute covers every supported extension", () => {
    const accepted = SUPPORTED_ACCEPT.split(",").map((s) => s.replace(".", ""));
    for (const ext of SUPPORTED_EXTENSIONS) {
      if (ext === "markdown") continue; // .markdown intentionally listed as .markdown
      expect(accepted, `missing .${ext} in SUPPORTED_ACCEPT`).toContain(ext);
    }
  });

  it("classifies spreadsheets, images, and unknowns", () => {
    expect(isSupportedFile("costs.XLSX")).toBe(true);
    expect(isSupportedFile("data.csv")).toBe(true);
    expect(isSupportedFile("drawing.png")).toBe(true);
    expect(isSupportedFile("archive.zip")).toBe(false);
    expect(isImageFile("photo.JPG")).toBe(true);
    expect(isImageFile("report.pdf")).toBe(false);
    expect(getFileExtension("a.b.tar.gz")).toBe("gz");
    expect(getFileExtension("noext")).toBe("");
  });
});

describe("parseFileToText", () => {
  it("parses xlsx workbooks to per-sheet CSV, skipping empty sheets", async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["Task", "Hours"],
        ["R&D prototyping", 120],
        ["Field trials", 45],
      ]),
      "Costs"
    );
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[]]), "Empty");
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const file = new File([buf], "workbook.xlsx");

    const parsed = await parseFileToText(file);
    expect(parsed.fileType).toBe("xlsx");
    expect(parsed.content).toContain("## Sheet: Costs");
    expect(parsed.content).toContain("R&D prototyping,120");
    expect(parsed.content).not.toContain("Empty");
  });

  it("passes csv through as text", async () => {
    const file = new File(["col1,col2\na,b\n"], "data.csv");
    const parsed = await parseFileToText(file);
    expect(parsed.fileType).toBe("xlsx");
    expect(parsed.content).toContain("col1,col2");
  });

  it("stores images as reference-only with empty content", async () => {
    const file = new File([new Uint8Array([137, 80, 78, 71])], "drawing.png");
    const parsed = await parseFileToText(file);
    expect(parsed.fileType).toBe("image");
    expect(parsed.content).toBe("");
  });

  it("truncates oversized text at the content cap", async () => {
    const file = new File(["x".repeat(500_000)], "big.txt");
    const parsed = await parseFileToText(file);
    expect(parsed.content.length).toBeLessThan(500_000);
    expect(parsed.content).toContain("[Document truncated");
  });
});

/**
 * PSOS-04 regression: every size-limited path must leave a marker the status
 * derivation can still see at the tail. No parser behaviour changes here —
 * these tests pin the behaviour the receipt depends on.
 */
describe("truncation is detectable by status derivation", () => {
  it("a size-truncated workbook keeps a marker at the tail and derives ready_truncated", async () => {
    const wb = XLSX.utils.book_new();
    // Three sheets, each large enough that the joined content blows the cap:
    // the loop pushes a sheet BEFORE checking the size, so capContent still
    // appends the generic marker and later sheets are silently dropped.
    // Few, wide rows rather than many narrow ones: the cap is measured in
    // characters, and per-cell work is what makes this fixture slow.
    for (const sheet of ["One", "Two", "Three"]) {
      const rows = Array.from({ length: 400 }, (_, i) => [
        `${sheet} row ${i}`,
        "y".repeat(500),
      ]);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheet);
    }
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;

    const parsed = await parseFileToText(new File([buf], "huge.xlsx"));
    expect(hasTruncationMarker(parsed.content)).toBe(true);
    expect(deriveProcessingStatus(parsed).status).toBe("ready_truncated");
  });

  it("an over-cap PDF keeps the generic marker after capContent replaces the page marker", () => {
    // The PDF path appends its page-stop marker and then caps: over the cap,
    // the specific marker is cut and the generic one takes its place.
    const content = capContent("p".repeat(500_000) + pdfPageStopMarker(38));
    expect(content).not.toContain("Stopped reading at page");
    expect(hasTruncationMarker(content)).toBe(true);
    expect(
      deriveProcessingStatus({ fileName: "drawings.pdf", content }).status
    ).toBe("ready_truncated");
  });

  it("an under-cap PDF keeps its page-specific marker and still derives ready_truncated", () => {
    const content = capContent("page text" + pdfPageStopMarker(4));
    expect(content).toContain("Stopped reading at page 4");
    expect(
      deriveProcessingStatus({ fileName: "drawings.pdf", content }).status
    ).toBe("ready_truncated");
  });
});

describe("normalizeExtractedText", () => {
  it("collapses Word-export whitespace: CRLF, trailing spaces, newline runs", () => {
    const raw = "Section A \r\n\r\n\r\n\r\n200   \n\nProject title\t\n\n\n\n\nBody text";
    expect(normalizeExtractedText(raw)).toBe(
      "Section A\n\n200\n\nProject title\n\nBody text"
    );
  });

  it("replaces non-breaking spaces and trims the ends", () => {
    expect(normalizeExtractedText("\n\n a\u00A0b \n\n")).toBe("a b");
  });

  it("is idempotent", () => {
    const once = normalizeExtractedText("a\n\n\n\nb  \nc");
    expect(normalizeExtractedText(once)).toBe(once);
  });

  it("capContent normalizes every ingestion path", () => {
    expect(capContent("a\r\n\r\n\r\nb   ")).toBe("a\n\nb");
  });
});

/**
 * PERF-1: the whole-file PDF deadline. `withDeadline` races the real work
 * against one absolute deadline shared by the document load and every page
 * call, so the timer it allocates has to be released when the work settles —
 * otherwise a successful N-page parse leaves 2N+1 callbacks alive for up to a
 * minute after the upload is done. `pdfjs-dist` is the only boundary mocked;
 * the parser itself runs for real.
 */
describe("PDF parse deadline", () => {
  const pdfFile = () => new File([new Uint8Array([37, 80, 68, 70])], "report.pdf");
  /** Resolves at `ms` on the fake clock. The timer it uses is always advanced
   * past before a test asserts the parser's own timer count. */
  const after = <T,>(ms: number, value: T) =>
    new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));
  const never = () => new Promise<never>(() => {});

  type PageSpec = {
    text?: string;
    getPage?: Promise<never>;
    /** Called when the parser asks the page for its text, so a test can observe when. */
    textContent?: () => Promise<{ items: { str: string }[] }>;
  };

  let destroyCalls = 0;

  /** Install a fake pdfjs document. `load` is the loadingTask promise. */
  function installPdf(load: Promise<unknown> | "immediate", pages: PageSpec[] = []) {
    destroyCalls = 0;
    const pdf = {
      numPages: pages.length,
      getPage: vi.fn((i: number) => {
        const spec = pages[i - 1];
        return spec.getPage ?? Promise.resolve({
          getTextContent: () =>
            spec.textContent?.() ??
            Promise.resolve({ items: (spec.text ?? "").split(" ").map((str) => ({ str })) }),
        });
      }),
    };
    pdfjs.getDocument.mockReturnValue({
      promise: load === "immediate" ? Promise.resolve(pdf) : load.then(() => pdf),
      destroy: () => {
        destroyCalls++;
        return Promise.resolve();
      },
    });
    return pdf;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    pdfjs.getDocument.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("leaves no pending timers after a successful multi-page parse", async () => {
    installPdf("immediate", [{ text: "Page one" }, { text: "Page two" }, { text: "Page three" }]);

    const parsed = await parseFileToText(pdfFile());

    expect(parsed).toEqual({
      fileName: "report.pdf",
      fileType: "pdf",
      content: "Page one\n\nPage two\n\nPage three",
    });
    expect(destroyCalls).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps one cumulative 60s budget across the load and every page", async () => {
    const page1TextContent = vi.fn(() => after(20_000, { items: [{ str: "Page" }, { str: "one" }] }));
    const page2TextContent = vi.fn(never);
    const pdf = installPdf(after(20_000, null), [
      { textContent: page1TextContent },
      { textContent: page2TextContent },
    ]);

    let settled = false;
    const pending = parseFileToText(pdfFile()).then((r) => {
      settled = true;
      return r;
    });

    // t=20s: the load resolves and the parser asks page 1 for its text. Page 2
    // has not been reached, so its work has not started consuming the budget.
    await vi.advanceTimersByTimeAsync(20_000);
    expect(pdf.getPage.mock.calls).toEqual([[1]]);
    expect(page1TextContent).toHaveBeenCalledTimes(1);
    expect(page2TextContent).not.toHaveBeenCalled();

    // t=40s: page 1's text resolves and only then is page 2 asked for its text.
    await vi.advanceTimersByTimeAsync(20_000);
    expect(pdf.getPage.mock.calls).toEqual([[1], [2]]);
    expect(page2TextContent).toHaveBeenCalledTimes(1);

    // A per-call 60s timeout would restart the clock on page 2 at t=40s and
    // still be waiting here — and at t=60s.
    await vi.advanceTimersByTimeAsync(19_999);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    const parsed = await pending;
    expect(parsed.content).toBe(`Page one\n${pdfPageStopMarker(2)}`);
    expect(destroyCalls).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("returns empty text with no page marker when the document never loads", async () => {
    installPdf(never());

    const pending = parseFileToText(pdfFile());
    await vi.advanceTimersByTimeAsync(60_000);
    const parsed = await pending;

    expect(parsed.content).toBe("");
    expect(parsed.content).not.toContain("Stopped reading at page");
    expect(destroyCalls).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ["the document load rejects", (boom: Error) => installPdf(Promise.reject(boom))],
    [
      "getPage rejects",
      (boom: Error) => installPdf("immediate", [{ getPage: Promise.reject(boom) }]),
    ],
    [
      "a later page's getTextContent rejects",
      (boom: Error) =>
        installPdf("immediate", [
          { text: "Page one" },
          { textContent: () => Promise.reject(boom) },
        ]),
    ],
  ])("propagates the original error and cleans up when %s", async (_name, install) => {
    const boom = new Error("pdfjs exploded");
    install(boom);

    await expect(parseFileToText(pdfFile())).rejects.toBe(boom);

    expect(destroyCalls).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
