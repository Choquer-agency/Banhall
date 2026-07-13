import { describe, expect, test } from "bun:test";
import {
  parseCanonicalReport,
  reportSectionMetrics,
} from "../src/lib/reportSections";

type InlineNode = {
  type: string;
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
};

function heading(text: string, level = 2) {
  return {
    type: "heading",
    attrs: { level },
    content: [{ type: "text", text }],
  };
}

function paragraph(...content: InlineNode[]) {
  return { type: "paragraph", content };
}

function documentJson(content: Array<Record<string, unknown>>): string {
  return JSON.stringify({ type: "doc", content });
}

describe("parseCanonicalReport", () => {
  test("parses the three Schedule 60 headings into ordered canonical paragraph blocks", () => {
    const parsed = parseCanonicalReport(
      documentJson([
        heading("FY2026 project", 1),
        heading("LINE 242 − SCIENTIFIC/TECHNOLOGICAL UNCERTAINTY"),
        paragraph({ type: "text", text: " First uncertainty. " }),
        paragraph(
          { type: "text", text: "Second" },
          { type: "hardBreak" },
          { type: "text", text: "uncertainty." }
        ),
        { type: "horizontalRule" },
        heading("Line 244 – Work Performed"),
        paragraph({ type: "text", text: "Experiment one." }),
        heading("Line 246 — Scientific/Technological Advancement"),
        paragraph({ type: "text", text: "Knowledge gained." }),
      ])
    );

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.sections).toEqual({
      s242: {
        key: "s242",
        line: "242",
        blocks: [
          { kind: "paragraph", text: "First uncertainty." },
          { kind: "paragraph", text: "Second\nuncertainty." },
        ],
        plainText: "First uncertainty.\n\nSecond\nuncertainty.",
      },
      s244: {
        key: "s244",
        line: "244",
        blocks: [{ kind: "paragraph", text: "Experiment one." }],
        plainText: "Experiment one.",
      },
      s246: {
        key: "s246",
        line: "246",
        blocks: [{ kind: "paragraph", text: "Knowledge gained." }],
        plainText: "Knowledge gained.",
      },
    });
  });

  test("preserves every leading, trailing, and repeated hard break for live metrics", () => {
    const content = documentJson([
      heading("Line 242 — Scientific/Technological Uncertainty"),
      paragraph(
        { type: "hardBreak" },
        { type: "text", text: "Uncertainty." },
        { type: "hardBreak" },
        { type: "hardBreak" }
      ),
      heading("Line 244 — Work Performed"),
      paragraph({ type: "text", text: "Work." }),
      heading("Line 246 — Scientific/Technological Advancement"),
      paragraph({ type: "text", text: "Advancement." }),
    ]);

    expect(parseCanonicalReport(content).sections.s242.plainText).toBe(
      "\nUncertainty.\n\n"
    );
    expect(reportSectionMetrics(content).s242).toMatchObject({
      lines: 4,
      words: 1,
      overLimit: false,
    });
  });

  test("rejects a highlighted unresolved GAP without dropping its export text", () => {
    const gap = "[GAP: identify the failed trial]";
    const parsed = parseCanonicalReport(
      documentJson([
        heading("Line 242 — Scientific/Technological Uncertainty"),
        paragraph({
          type: "text",
          text: `The evidence is incomplete. ${gap}`,
          marks: [{ type: "highlight", attrs: { color: "#FEF3C7" } }],
        }),
        heading("Line 244 — Work Performed"),
        paragraph({ type: "text", text: "A controlled trial was performed." }),
        heading("Line 246 — Scientific/Technological Advancement"),
        paragraph({ type: "text", text: "The trial established a limit." }),
      ])
    );

    expect(parsed.sections.s242.plainText).toBe(
      `The evidence is incomplete. ${gap}`
    );
    expect(parsed.diagnostics).toEqual([
      {
        code: "UNRESOLVED_GAP",
        section: "s242",
        message: "Line 242 contains an unresolved [GAP: ...] marker.",
      },
    ]);
  });

  test("reports noncanonical and missing section headings instead of silently reassigning prose", () => {
    const parsed = parseCanonicalReport(
      documentJson([
        heading("Line 242 — Scientific and Technological Uncertainty"),
        paragraph({ type: "text", text: "Unassigned prose." }),
        heading("Line 244 — Work Performed"),
        paragraph({ type: "text", text: "Work." }),
        heading("Line 246 — Scientific/Technological Advancement"),
        paragraph({ type: "text", text: "Advancement." }),
      ])
    );

    expect(parsed.sections.s242.plainText).toBe("");
    expect(parsed.sections.s244.plainText).toBe("Work.");
    expect(parsed.diagnostics.map(({ code, section }) => ({ code, section }))).toEqual([
      { code: "UNSUPPORTED_NODE", section: undefined },
      { code: "CONTENT_OUTSIDE_SECTION", section: undefined },
      { code: "MISSING_SECTION", section: "s242" },
    ]);
  });
});
