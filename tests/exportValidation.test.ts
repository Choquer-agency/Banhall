import { describe, expect, test } from "bun:test";
import {
  canonicalizeExportPreflight,
  isSameExportRevision,
  validateExport,
  type ExportPreflightInput,
} from "../src/lib/exportValidation";
import { exportToTemplateDocx } from "../src/lib/exportTemplateDocx";
import type { SectionKey } from "../convex/lib/lineLimits";

const headings: Record<SectionKey, string> = {
  s242: "Line 242 — Scientific/Technological Uncertainty",
  s244: "Line 244 — Work Performed",
  s246: "Line 246 — Scientific/Technological Advancement",
};

function textNode(text: string, highlighted = false) {
  return {
    type: "text",
    text,
    ...(highlighted
      ? { marks: [{ type: "highlight", attrs: { color: "#FEF3C7" } }] }
      : {}),
  };
}
function inlineContent(text: string, highlighted = false) {
  return text.split("\n").flatMap((line, index) => [
    ...(index > 0 ? [{ type: "hardBreak" }] : []),
    textNode(line, highlighted),
  ]);
}


function reportContent(
  sections: Record<SectionKey, string>,
  highlightedSection?: SectionKey
): string {
  const content: Array<Record<string, unknown>> = [];
  for (const section of ["s242", "s244", "s246"] as const) {
    content.push({
      type: "heading",
      attrs: { level: 2 },
      content: [textNode(headings[section])],
    });
    for (const paragraph of sections[section].split(/\n\n+/)) {
      content.push({
        type: "paragraph",
        content: inlineContent(paragraph, highlightedSection === section),
      });
    }
  }
  return JSON.stringify({ type: "doc", content });
}

function preflightInput(
  overrides: Partial<ExportPreflightInput> = {},
  sections: Partial<Record<SectionKey, string>> = {}
): ExportPreflightInput {
  return {
    reportId: "report-1",
    reportVersion: 4,
    revisionNumber: 7,
    contentHash: "sha256-content",
    templateVersion: "schedule-60-v1",
    supportingDocumentCount: 2,
    content: reportContent({
      s242: sections.s242 ?? "A technological uncertainty remained.",
      s244: sections.s244 ?? "A controlled experiment was performed.",
      s246: sections.s246 ?? "The experiment produced new knowledge.",
    }),
    project: {
      title: "Control system research",
      clientName: "Example Claimant Inc.",
      fiscalYearEnd: Date.UTC(2026, 11, 31),
      scienceCode: "2.02.01",
    },
    ...overrides,
  };
}

function oneWordPerLine(count: number): string {
  return Array.from({ length: count }, (_, index) =>
    String.fromCharCode(97 + (index % 26)).repeat(78)
  ).join(" ");
}

function words(count: number): string {
  return Array.from({ length: count }, () => "x").join(" ");
}

const sectionCaps: Array<{
  section: SectionKey;
  lineLimit: number;
  wordCap: number;
  nearLimit: number;
}> = [
  { section: "s242", lineLimit: 50, wordCap: 350, nearLimit: 47 },
  { section: "s244", lineLimit: 100, wordCap: 700, nearLimit: 95 },
  { section: "s246", lineLimit: 50, wordCap: 350, nearLimit: 47 },
];

describe("canonicalizeExportPreflight", () => {
  test("creates a detached, recursively immutable export snapshot with canonical metadata", () => {
    const input = preflightInput({
      project: {
        title: "  Trimmed project  ",
        clientName: "  Trimmed claimant  ",
        fiscalYearEnd: Date.UTC(2026, 11, 31),
        scienceCode: "  2.02.01  ",
      },
    });
    const canonical = canonicalizeExportPreflight(input);

    input.project.title = "Changed after authorization";
    input.revisionNumber = 8;
    input.contentHash = "changed-content";
    expect(canonical.title).toBe("Trimmed project");
    expect(canonical.clientName).toBe("Trimmed claimant");
    expect(canonical.scienceCode).toBe("2.02.01");
    expect(canonical.revisionNumber).toBe(7);
    expect(canonical.contentHash).toBe("sha256-content");
    expect(Reflect.set(canonical, "title", "Mutated")).toBe(false);
    expect(
      Reflect.set(canonical.body.sections.s242.blocks[0], "text", "Mutated")
    ).toBe(false);
    expect(Reflect.set(canonical.body.sections, "s242", {})).toBe(false);
    expect(canonical.title).toBe("Trimmed project");
    expect(canonical.body.sections.s242.plainText).toBe(
      "A technological uncertainty remained."
    );
  });
  test("keeps invalid-report diagnostics immutable after canonicalization", () => {
    const canonical = canonicalizeExportPreflight(preflightInput({ content: "{not valid JSON" }));
    const diagnostic = canonical.body.diagnostics[0];

    expect(diagnostic).toEqual({
      code: "MALFORMED_DOCUMENT",
      message: "The report is not valid Tiptap editor JSON.",
    });
    expect(Reflect.set(diagnostic, "message", "Suppressed")).toBe(false);
    expect(diagnostic.message).toBe("The report is not valid Tiptap editor JSON.");
  });

  test("distinguishes an authorization for a stale revision or content hash", () => {
    const canonical = canonicalizeExportPreflight(preflightInput());

    expect(
      isSameExportRevision(canonical, {
        reportId: canonical.reportId,
        revisionNumber: canonical.revisionNumber,
        contentHash: canonical.contentHash,
      })
    ).toBe(true);
    expect(
      isSameExportRevision(canonical, {
        reportId: canonical.reportId,
        revisionNumber: canonical.revisionNumber + 1,
        contentHash: canonical.contentHash,
      })
    ).toBe(false);
    expect(
      isSameExportRevision(canonical, {
        reportId: canonical.reportId,
        revisionNumber: canonical.revisionNumber,
        contentHash: "different-content",
      })
    ).toBe(false);
  });
});

describe("exportToTemplateDocx", () => {
  test("rejects an invalid science code before loading the DOCX template", async () => {
    const report = canonicalizeExportPreflight(
      preflightInput({
        project: {
          title: "Control system research",
          clientName: "Example Claimant Inc.",
          fiscalYearEnd: Date.UTC(2026, 11, 31),
          scienceCode: "9.99.99",
        },
      })
    );

    await expect(exportToTemplateDocx(report)).rejects.toThrow(
      "A valid CRA field of science or technology code is required"
    );
  });
});

describe("validateExport", () => {
  test("accepts a 60-character title and rejects the first character beyond the Schedule 60 title box", () => {
    const atLimit = canonicalizeExportPreflight(preflightInput({
      project: {
        title: "t".repeat(60),
        clientName: "Example Claimant Inc.",
        fiscalYearEnd: Date.UTC(2026, 11, 31),
        scienceCode: "2.02.01",
      },
    }));
    const overLimit = canonicalizeExportPreflight(preflightInput({
      project: {
        title: "t".repeat(61),
        clientName: "Example Claimant Inc.",
        fiscalYearEnd: Date.UTC(2026, 11, 31),
        scienceCode: "2.02.01",
      },
    }));

    expect(validateExport(atLimit).errors).toEqual([]);
    expect(validateExport(overLimit).errors).toContainEqual({
      severity: "error",
      field: "title",
      label: "Project title",
      message:
        "Project title is 61 characters; the Schedule 60 title box allows 60.",
      actual: 61,
      limit: 60,
    });
  });

  test("rejects a blank title, absent fiscal year, and whitespace-only science code", () => {
    const report = canonicalizeExportPreflight(preflightInput({
      project: {
        title: "   ",
        clientName: "Example Claimant Inc.",
        fiscalYearEnd: undefined,
        scienceCode: "   ",
      },
    }));

    expect(validateExport(report).errors.map((issue) => issue.field)).toEqual([
      "title",
      "fiscalYearEnd",
      "scienceCode",
    ]);
  });

  test("rejects a non-catalogue science code after trimming metadata", () => {
    const report = canonicalizeExportPreflight(
      preflightInput({
        project: {
          title: "Control system research",
          clientName: "Example Claimant Inc.",
          fiscalYearEnd: Date.UTC(2026, 11, 31),
          scienceCode: " 9.99.99 ",
        },
      })
    );

    expect(validateExport(report).errors).toContainEqual({
      severity: "error",
      field: "scienceCode",
      label: "Field of science or technology",
      message:
        '"9.99.99" is not a recognized CRA line 206 field-of-science code.',
    });
  });

  test("shows the empty-supporting-document warning alongside hard errors", () => {
    const report = canonicalizeExportPreflight(
      preflightInput({
        supportingDocumentCount: 0,
        project: {
          title: "",
          clientName: "Example Claimant Inc.",
          fiscalYearEnd: Date.UTC(2026, 11, 31),
          scienceCode: "2.02.01",
        },
      })
    );
    const result = validateExport(report);

    expect(result.errors.some((issue) => issue.field === "title")).toBe(true);
    expect(result.warnings).toContainEqual({
      severity: "warning",
      field: "supportingDocuments",
      label: "Supporting documents",
      message:
        "No supporting documents are attached to this project. Proceed only if the report can be substantiated without additional source files.",
    });
  });

  test("surfaces a highlighted unresolved GAP as a blocking section error", () => {
    const input = preflightInput();
    input.content = reportContent(
      {
        s242: "Evidence remains [GAP: provide the failed trial].",
        s244: "A controlled experiment was performed.",
        s246: "The experiment produced new knowledge.",
      },
      "s242"
    );
    const result = validateExport(canonicalizeExportPreflight(input));

    expect(result.errors).toContainEqual({
      severity: "error",
      field: "s242",
      label: "Line 242 — uncertainties",
      message: "Line 242 contains an unresolved [GAP: ...] marker.",
    });
  });

  test("counts explicit hard-break nodes toward the fixed form line cap", () => {
    const hardBroken = Array.from(
      { length: 51 },
      (_, index) => `physical line ${index + 1}`
    ).join("\n");
    const result = validateExport(
      canonicalizeExportPreflight(
        preflightInput({}, { s242: hardBroken })
      )
    );

    expect(result.errors).toContainEqual(
      expect.objectContaining({
        severity: "error",
        field: "s242",
        actual: 51,
        limit: 50,
      })
    );
  });

  test.each(sectionCaps)(
    "$section maps line and word overflow to exact Schedule 60 blocking errors",
    ({ section, lineLimit, wordCap }) => {
      const lineOverflow = validateExport(
        canonicalizeExportPreflight(preflightInput({}, { [section]: oneWordPerLine(lineLimit + 1) }))
      );
      const wordOverflow = validateExport(
        canonicalizeExportPreflight(preflightInput({}, { [section]: words(wordCap + 1) }))
      );

      expect(lineOverflow.errors).toContainEqual(
        expect.objectContaining({
          severity: "error",
          field: section,
          actual: lineLimit + 1,
          limit: lineLimit,
        })
      );
      expect(wordOverflow.errors).toContainEqual(
        expect.objectContaining({
          severity: "error",
          field: section,
          actual: wordCap + 1,
          limit: wordCap,
        })
      );
    }
  );

  test.each(sectionCaps)(
    "$section warns at the first line within 5% of the cap but not one line earlier",
    ({ section, lineLimit, nearLimit }) => {
      const beforeThreshold = validateExport(
        canonicalizeExportPreflight(preflightInput({}, { [section]: oneWordPerLine(nearLimit - 1) }))
      );
      const atThreshold = validateExport(
        canonicalizeExportPreflight(preflightInput({}, { [section]: oneWordPerLine(nearLimit) }))
      );

      expect(beforeThreshold.warnings.some((issue) => issue.field === section)).toBe(
        false
      );
      expect(atThreshold.warnings).toContainEqual({
        severity: "warning",
        field: section,
        label:
          section === "s242"
            ? "Line 242 — uncertainties"
            : section === "s244"
              ? "Line 244 — work performed"
              : "Line 246 — advancements",
        message: `${
          section === "s242"
            ? "Line 242 — uncertainties"
            : section === "s244"
              ? "Line 244 — work performed"
              : "Line 246 — advancements"
        } is within 5% of the template line limit; inspect the generated DOCX for wrapping.`,
        actual: nearLimit,
        limit: lineLimit,
      });
    }
  );
});
