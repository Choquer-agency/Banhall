import { describe, expect, test } from "vitest";
import {
  canonicalizeExportPreflight,
  validateExport,
  type ExportPreflightInput,
} from "./exportValidation";

function tiptapDoc(sectionTexts: { s242: string; s244: string; s246: string }): string {
  const heading = (text: string) => ({
    type: "heading",
    attrs: { level: 2 },
    content: [{ type: "text", text }],
  });
  const paragraphs = (text: string) =>
    text
      .split(/\n\n+/)
      .filter(Boolean)
      .map((p) => ({ type: "paragraph", content: [{ type: "text", text: p }] }));
  return JSON.stringify({
    type: "doc",
    content: [
      heading("Line 242 — Scientific/Technological Uncertainty"),
      ...paragraphs(sectionTexts.s242),
      heading("Line 244 — Work Performed"),
      ...paragraphs(sectionTexts.s244),
      heading("Line 246 — Scientific/Technological Advancement"),
      ...paragraphs(sectionTexts.s246),
    ],
  });
}

function preflight(content: string): ExportPreflightInput {
  return {
    reportId: "r1",
    reportVersion: 1,
    revisionNumber: 1,
    contentHash: "hash",
    content,
    templateVersion: "v1",
    supportingDocumentCount: 3,
    project: {
      title: "Test project",
      clientName: "Acme Corp",
      fiscalYearEnd: Date.UTC(2025, 11, 31),
      scienceCode: "1.02.01",
    },
  };
}

describe("validateExport gap handling", () => {
  test("clean report has no errors", () => {
    const canonical = canonicalizeExportPreflight(
      preflight(tiptapDoc({ s242: "Alpha.", s244: "Beta.", s246: "Gamma." }))
    );
    const result = validateExport(canonical);
    expect(result.errors).toEqual([]);
  });

  test("UNRESOLVED_GAP is a warning, not an error", () => {
    const canonical = canonicalizeExportPreflight(
      preflight(
        tiptapDoc({
          s242: "Alpha [GAP: need failure metrics] omega.",
          s244: "Beta.",
          s246: "Gamma.",
        })
      )
    );
    const result = validateExport(canonical);
    expect(result.errors).toEqual([]);
    const gapWarnings = result.warnings.filter((w) =>
      w.message.includes("[GAP]")
    );
    expect(gapWarnings).toHaveLength(1);
    expect(gapWarnings[0].severity).toBe("warning");
    expect(gapWarnings[0].field).toBe("s242");
    expect(gapWarnings[0].message).toContain("exported highlighted");
  });

  test("gap-only line overflow is a warning, not an error", () => {
    // 50 lines of real content (exactly at the s242 limit), plus a gap that
    // pushes the raw count over.
    const word = "x".repeat(77);
    const atLimit = Array.from({ length: 50 }, () => word).join(" ");
    const canonical = canonicalizeExportPreflight(
      preflight(
        tiptapDoc({
          s242: atLimit + " [GAP: confirm the final throughput figures]",
          s244: "Beta.",
          s246: "Gamma.",
        })
      )
    );
    const result = validateExport(canonical);
    expect(result.errors).toEqual([]);
    const overflowWarnings = result.warnings.filter((w) =>
      w.message.includes("only because of unresolved [GAP]")
    );
    expect(overflowWarnings).toHaveLength(1);
    expect(overflowWarnings[0].field).toBe("s242");
  });

  test("genuine overflow stays a blocking error even with gaps present", () => {
    const word = "x".repeat(77);
    const over = Array.from({ length: 51 }, () => word).join(" ");
    const canonical = canonicalizeExportPreflight(
      preflight(
        tiptapDoc({
          s242: over + " [GAP: also missing dates]",
          s244: "Beta.",
          s246: "Gamma.",
        })
      )
    );
    const result = validateExport(canonical);
    expect(result.errors.some((e) => e.field === "s242")).toBe(true);
  });
});

// 2026-10-29 (owner): an [INFERRED: ...] marker is a claim the writer still
// checks. Export treats it like a gap: a warning, never a blocking error,
// and the dialog lists it beside the gaps with a jump to each.
describe("validateExport inference handling", () => {
  const MARK = "[INFERRED: the source asks for stability over time, not single-point checks]";

  test("UNCHECKED_INFERENCE is a warning, not an error", () => {
    const canonical = canonicalizeExportPreflight(
      preflight(
        tiptapDoc({
          s242: "Alpha.",
          s244: `Readiness was first judged from single readings. ${MARK}\n\nA second paragraph. ${MARK}`,
          s246: "Gamma.",
        })
      )
    );
    expect(canonical.body.diagnostics.map((d) => d.code)).toEqual(["UNCHECKED_INFERENCE", "UNCHECKED_INFERENCE"]);
    const result = validateExport(canonical);
    expect(result.errors).toEqual([]);
    const inferenceWarnings = result.warnings.filter((w) => w.message.includes("[INFERRED]"));
    // One message per Line; the dialog collapses the repeats.
    expect(new Set(inferenceWarnings.map((w) => w.message))).toEqual(
      new Set(["Line 244 has an inference to check (an [INFERRED] marker); it will be exported highlighted."])
    );
    expect(inferenceWarnings.every((w) => w.severity === "warning" && w.field === "s244")).toBe(true);
  });

  test("inference marker text never counts toward a limit, so it raises no with-gaps warning", () => {
    const word = "x".repeat(77);
    const atLimit = Array.from({ length: 50 }, () => word).join(" ");
    const result = validateExport(
      canonicalizeExportPreflight(preflight(tiptapDoc({ s242: `${atLimit} ${MARK} ${MARK}`, s244: "Beta.", s246: "Gamma." })))
    );
    expect(result.errors).toEqual([]);
    expect(result.warnings.some((w) => w.message.includes("only because of unresolved [GAP]"))).toBe(false);
  });

  test("notes lists every gap and inference in build order, each with its marker text", () => {
    const result = validateExport(
      canonicalizeExportPreflight(
        preflight(
          tiptapDoc({
            s242: "Alpha [GAP: need failure metrics] omega.",
            s244: `Readiness was first judged from single readings. ${MARK}`,
            s246: "Gamma [GAP: next year's plan].",
          })
        )
      )
    );
    expect(result.notes).toEqual([
      { section: "s242", kind: "gap", text: "[GAP: need failure metrics]", note: "need failure metrics" },
      { section: "s244", kind: "inferred", text: MARK, note: "the source asks for stability over time, not single-point checks" },
      { section: "s246", kind: "gap", text: "[GAP: next year's plan]", note: "next year's plan" },
    ]);
  });

  test("a clean report has no notes", () => {
    const result = validateExport(
      canonicalizeExportPreflight(preflight(tiptapDoc({ s242: "Alpha.", s244: "Beta.", s246: "Gamma." })))
    );
    expect(result.notes).toEqual([]);
  });
});
