import { describe, expect, it } from "vitest";
import {
  CAP_TRUNCATION_MARKER,
  PROCESSING_DETAILS,
  PROCESSING_STATUSES,
  TRUNCATION_TAIL_WINDOW,
  deriveProcessingStatus,
  deriveStoredProcessing,
  getFileExtension,
  hasTruncationMarker,
  isImageFile,
  isSupportedFile,
  mboxOverflowMarker,
  pdfPageStopMarker,
  stripIngestPrefix,
  type ProcessingDetail,
  type ProcessingStatus,
} from "../../../shared/documentStatus";

const derive = deriveProcessingStatus;

describe("registry helpers", () => {
  it("reads extensions case-insensitively", () => {
    expect(getFileExtension("Report.PDF")).toBe("pdf");
    expect(getFileExtension("archive.tar.GZ")).toBe("gz");
    expect(getFileExtension("no-extension")).toBe("");
  });

  it("classifies support and images by extension", () => {
    expect(isSupportedFile("notes.DOCX")).toBe(true);
    expect(isSupportedFile("bundle.zip")).toBe(false);
    expect(isImageFile("diagram.JPEG")).toBe(true);
    expect(isImageFile("diagram.pdf")).toBe(false);
  });
});

describe("hasTruncationMarker", () => {
  it("detects each producer's marker at the tail", () => {
    expect(hasTruncationMarker("text" + CAP_TRUNCATION_MARKER)).toBe(true);
    expect(hasTruncationMarker("text" + pdfPageStopMarker(12))).toBe(true);
    expect(hasTruncationMarker("text" + mboxOverflowMarker(7))).toBe(true);
  });

  it("detects a marker sitting inside the tail window", () => {
    const content = "a".repeat(5_000) + CAP_TRUNCATION_MARKER + "b".repeat(200);
    expect(hasTruncationMarker(content)).toBe(true);
  });

  it("does not detect a marker beyond the tail window (documented contract)", () => {
    const content =
      "a".repeat(5_000) +
      CAP_TRUNCATION_MARKER +
      "b".repeat(TRUNCATION_TAIL_WINDOW + 50);
    expect(hasTruncationMarker(content)).toBe(false);
  });

  it("is false for ordinary content and empty content", () => {
    expect(hasTruncationMarker("a normal document about truncated budgets")).toBe(
      false
    );
    expect(hasTruncationMarker("")).toBe(false);
  });
});

describe("deriveProcessingStatus precedence", () => {
  it("rule 1 — pasted text with content is ready", () => {
    expect(
      derive({ fileName: "Previous-year note (FY 2024)", content: "we did work", intake: "pasted" })
    ).toEqual({ status: "ready", detail: "pasted_text" });
  });

  it("rule 2 — pasted text with no content could not be read", () => {
    expect(
      derive({ fileName: "Materials (pasted)", content: "   \n ", intake: "pasted" })
    ).toEqual({ status: "could_not_read", detail: "no_text_extracted" });
  });

  it("rule 3 — an image with no text is reference only, not a failure", () => {
    for (const name of ["a.png", "a.jpg", "a.jpeg", "a.webp", "a.gif"]) {
      expect(derive({ fileName: name, content: "" })).toEqual({
        status: "reference_only",
        detail: "image_reference",
      });
    }
  });

  it("rule 3 — an image beats the parse-failure rule", () => {
    expect(derive({ fileName: "photo.png", content: "", extractionFailed: true })).toEqual({
      status: "reference_only",
      detail: "image_reference",
    });
  });

  it("rule 4 — an image that did yield text is ready", () => {
    expect(derive({ fileName: "chart.png", content: "Q3 revenue" })).toEqual({
      status: "ready",
      detail: "text_extracted",
    });
    expect(
      derive({ fileName: "chart.png", content: "Q3 revenue" + CAP_TRUNCATION_MARKER })
    ).toEqual({ status: "ready_truncated", detail: "text_truncated" });
  });

  it("rule 5 — an unsupported type with no text is skipped", () => {
    expect(derive({ fileName: "bundle.zip", content: "" })).toEqual({
      status: "skipped_unsupported",
      detail: "unsupported_extension",
    });
  });

  it("rule 5 — a file with no extension is treated as unsupported", () => {
    expect(derive({ fileName: "Makefile", content: "" })).toEqual({
      status: "skipped_unsupported",
      detail: "unsupported_extension",
    });
  });

  it("rule 6 — an unsupported type that yielded text is ready, never skipped", () => {
    expect(derive({ fileName: "notes.rtf", content: "the trial run failed" })).toEqual({
      status: "ready",
      detail: "unsupported_extension",
    });
  });

  it("rule 6 — an unsupported truncated file reports truncation", () => {
    expect(
      derive({ fileName: "notes.rtf", content: "text" + CAP_TRUNCATION_MARKER })
    ).toEqual({ status: "ready_truncated", detail: "text_truncated" });
  });

  it("rule 7 — a supported file whose parser threw with nothing recovered", () => {
    expect(
      derive({ fileName: "corrupt.pdf", content: "", extractionFailed: true })
    ).toEqual({ status: "could_not_read", detail: "parse_failed" });
  });

  it("rule 7 — a parse that threw but recovered partial text is still ready", () => {
    expect(
      derive({ fileName: "partial.pdf", content: "page one text", extractionFailed: true })
    ).toEqual({ status: "ready", detail: "text_extracted" });
  });

  it("rule 8 — supported but empty (scanned PDF, empty .txt, image-only .docx)", () => {
    for (const name of ["scan.pdf", "empty.txt", "images-only.docx"]) {
      expect(derive({ fileName: name, content: "  \n\t " })).toEqual({
        status: "could_not_read",
        detail: "no_text_extracted",
      });
    }
  });

  it("rule 9 — each truncation marker derives ready_truncated", () => {
    for (const marker of [
      CAP_TRUNCATION_MARKER,
      pdfPageStopMarker(4),
      mboxOverflowMarker(12),
    ]) {
      expect(derive({ fileName: "big.pdf", content: "body" + marker })).toEqual({
        status: "ready_truncated",
        detail: "text_truncated",
      });
    }
  });

  it("rule 10 — a normal supported file is ready", () => {
    expect(derive({ fileName: "interview.docx", content: "we tried X" })).toEqual({
      status: "ready",
      detail: "text_extracted",
    });
  });

  it("matches extensions case-insensitively", () => {
    expect(derive({ fileName: "REPORT.PDF", content: "text" })).toEqual({
      status: "ready",
      detail: "text_extracted",
    });
    expect(derive({ fileName: "PHOTO.PNG", content: "" })).toEqual({
      status: "reference_only",
      detail: "image_reference",
    });
  });

  it("defaults intake to file when omitted", () => {
    expect(derive({ fileName: "Untitled note", content: "text" })).toEqual({
      status: "ready",
      detail: "unsupported_extension",
    });
  });
});

describe("legacy wizard boilerplate (stored rows only)", () => {
  const stored = deriveStoredProcessing;

  it("a prefix-only previous-year row reports that it could not be read", () => {
    expect(
      stored({
        fileName: "scan.pdf",
        content: "[Previous-year report — fiscal 2024]\n\n",
      })
    ).toEqual({ status: "could_not_read", detail: "no_text_extracted" });
  });

  it("strips any year the wizard could have written", () => {
    for (const year of ["1999", "-1", "2024.5"]) {
      expect(
        stored({
          fileName: "scan.pdf",
          content: `[Previous-year report — fiscal ${year}]\n\n`,
        }).status,
        year
      ).toBe("could_not_read");
    }
  });

  it("leaves a row with real extracted text alone", () => {
    expect(
      stored({
        fileName: "report.pdf",
        content: "[Previous-year report — fiscal 2024]\nThe actual report body",
      })
    ).toEqual({ status: "ready", detail: "text_extracted" });
  });

  it("keeps a row whose only text is the user's own note", () => {
    // Deliberate: the note is real user text and generation consumes it.
    expect(
      stored({
        fileName: "scan.pdf",
        content:
          "[Previous-year report — fiscal 2024]\nNote: called the client about this\n\n",
      }).status
    ).toBe("ready");
  });

  it("does not touch the standalone previous-year note document", () => {
    expect(
      stored({
        fileName: "Previous-year note (FY 2024)",
        content: "[Previous-year note — fiscal 2024]\n\nWhat we did last year",
      })
    ).toEqual({ status: "ready", detail: "pasted_text" });
  });

  it("does not strip other bracketed opening lines", () => {
    for (const content of [
      "[DRAFT]\nReal content",
      "[Previous-year report]\nReal content",
      "[Previous-year report - fiscal 2024]\nReal content",
    ]) {
      expect(stored({ fileName: "doc.pdf", content }).status, content).toBe("ready");
    }
  });

  it("requires the trailing newline the wizard always writes", () => {
    // A bare prefix with nothing after it cannot come from our writer, so it is
    // treated as ordinary content rather than widening the match.
    expect(
      stored({ fileName: "scan.pdf", content: "[Previous-year report — fiscal 2024]" })
        .status
    ).toBe("ready");
  });

  it("only matches at the very start, and only once", () => {
    const midway = "Real text\n[Previous-year report — fiscal 2024]\n";
    expect(stripIngestPrefix(midway)).toBe(midway);
    expect(
      stripIngestPrefix(
        "[Previous-year report — fiscal 2024]\n[Previous-year report — fiscal 2023]\nText"
      )
    ).toBe("[Previous-year report — fiscal 2023]\nText");
  });

  it("still sees a truncation marker after stripping", () => {
    expect(
      stored({
        fileName: "big.pdf",
        content: "[Previous-year report — fiscal 2024]\nbody" + CAP_TRUNCATION_MARKER,
      })
    ).toEqual({ status: "ready_truncated", detail: "text_truncated" });
  });

  it("leaves the live upload path untouched", () => {
    // Pins why the wizard must send empty content for an unreadable file: the
    // live path derives from raw content and would still call this ready.
    expect(
      deriveProcessingStatus({
        fileName: "scan.pdf",
        content: "[Previous-year report — fiscal 2024]\n\n",
      }).status
    ).toBe("ready");
  });
});

describe("invariants", () => {
  const cases: Array<Parameters<typeof derive>[0]> = [
    { fileName: "a.docx", content: "text" },
    { fileName: "a.docx", content: "text" + CAP_TRUNCATION_MARKER },
    { fileName: "a.png", content: "" },
    { fileName: "a.png", content: "text" },
    { fileName: "a.zip", content: "" },
    { fileName: "a.zip", content: "text" },
    { fileName: "a.pdf", content: "", extractionFailed: true },
    { fileName: "a.pdf", content: "" },
    { fileName: "note", content: "text", intake: "pasted" },
    { fileName: "note", content: "", intake: "pasted" },
  ];

  it("only ever returns declared statuses and details", () => {
    for (const facts of cases) {
      const { status, detail } = derive(facts);
      expect(PROCESSING_STATUSES).toContain(status);
      expect(PROCESSING_DETAILS).toContain(detail);
    }
  });

  it("pairs ready_truncated with text_truncated in both directions", () => {
    for (const facts of cases) {
      const { status, detail } = derive(facts);
      expect(status === "ready_truncated").toBe(detail === "text_truncated");
    }
  });

  it("never reports a ready status for content with no usable text", () => {
    for (const facts of cases.filter((f) => f.content.trim() === "")) {
      expect(derive(facts).status).not.toBe("ready");
      expect(derive(facts).status).not.toBe("ready_truncated");
    }
  });

  it("covers every declared status across the case matrix", () => {
    const seen = new Set<ProcessingStatus>(cases.map((f) => derive(f).status));
    expect([...seen].sort()).toEqual([...PROCESSING_STATUSES].sort());
  });

  it("covers every declared detail across the case matrix", () => {
    const seen = new Set<ProcessingDetail>(cases.map((f) => derive(f).detail));
    expect([...seen].sort()).toEqual([...PROCESSING_DETAILS].sort());
  });
});
