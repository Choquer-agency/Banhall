import { z } from "zod";
import {
  GAP_MARKER_RE,
  INFERRED_MARKER_RE,
  findReportNotes,
  stripNoteMarkers,
  sectionMetrics,
  type SectionMetrics,
} from "../../convex/lib/lineLimits";
import { NOT_GENERATED_PLACEHOLDER } from "../../convex/lib/tiptapReport";

// Non-global copies: the marker regexes are /g and .test() on them would be stateful.
const HAS_GAP_RE = new RegExp(GAP_MARKER_RE.source, "i");
const HAS_INFERRED_RE = new RegExp(INFERRED_MARKER_RE.source, "i");
/** A note's opening with no closing bracket, once every whole marker is taken out. */
const UNCLOSED_NOTE_RE = /\[(?:GAP|INFERRED):/i;

export interface TiptapNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}

const markSchema = z.object({
  type: z.string(),
  attrs: z.record(z.string(), z.unknown()).optional(),
});

const tiptapNodeSchema: z.ZodType<TiptapNode> = z.lazy(() =>
  z.object({
    type: z.string(),
    attrs: z.record(z.string(), z.unknown()).optional(),
    content: z.array(tiptapNodeSchema).optional(),
    text: z.string().optional(),
    marks: z.array(markSchema).optional(),
  })
);

export type ReportSectionKey = "s242" | "s244" | "s246";

export interface ExportParagraphBlock {
  kind: "paragraph";
  text: string;
}

export interface CanonicalReportSection {
  key: ReportSectionKey;
  line: "242" | "244" | "246";
  blocks: ExportParagraphBlock[];
  plainText: string;
}

export interface ReportParseDiagnostic {
  code:
    | "MALFORMED_DOCUMENT"
    | "MISSING_SECTION"
    | "DUPLICATE_SECTION"
    | "OUT_OF_ORDER_SECTION"
    | "UNSUPPORTED_NODE"
    | "CONTENT_OUTSIDE_SECTION"
    | "UNRESOLVED_GAP"
    | "UNCHECKED_INFERENCE"
    | "UNCLOSED_NOTE"
    | "NOT_DRAFTED";
  message: string;
  section?: ReportSectionKey;
  nodeType?: string;
}

/**
 * Diagnostics that warn and never block export. A gap or an inference stays
 * in the text and is exported highlighted, so whoever reads the file sees
 * exactly what is still open: gaps since before 2026-10-29, [INFERRED: ...]
 * markers following them (owner, 2026-10-29). A note opened and never closed
 * (review round 1, P2-5) counts as report text and exports plain, so the
 * writer is told. Every other diagnostic blocks.
 */
export const NON_BLOCKING_DIAGNOSTICS: ReadonlySet<ReportParseDiagnostic["code"]> = new Set([
  "UNRESOLVED_GAP",
  "UNCHECKED_INFERENCE",
  "UNCLOSED_NOTE",
]);

/** One [GAP: ...] or [INFERRED: ...] note in a Line, for the lists that show them. */
export interface ReportNote {
  section: ReportSectionKey;
  kind: "gap" | "inferred";
  /** The whole marker as written: what the editor finds to jump to it. */
  text: string;
  /** What the marker says after its colon. */
  note: string;
  /**
   * Review round 1 (P2-4): how many markers with exactly this text come
   * before it in the same Line, so a jump finds this one, not the first.
   */
  occurrence: number;
}

export interface CanonicalReportBody {
  sections: Record<ReportSectionKey, CanonicalReportSection>;
  diagnostics: ReportParseDiagnostic[];
}

const SECTION_ORDER: ReportSectionKey[] = ["s242", "s244", "s246"];

function emptySection(key: ReportSectionKey): CanonicalReportSection {
  return {
    key,
    line: key.slice(1) as "242" | "244" | "246",
    blocks: [],
    plainText: "",
  };
}

function inlineText(node: TiptapNode): {
  text: string;
  unsupportedNode?: string;
} {
  if (node.type === "text") return { text: node.text ?? "" };
  if (node.type === "hardBreak") return { text: "\n" };
  if (!node.content) return { text: "", unsupportedNode: node.type };
  let text = "";
  for (const child of node.content) {
    const result = inlineText(child);
    if (result.unsupportedNode) return result;
    text += result.text;
  }
  return { text };
}

export function reportSectionKeyForHeading(node: TiptapNode): ReportSectionKey | null {
  if (node.type !== "heading") return null;
  const text = inlineText(node).text
    .replace(/[—–−]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (
    /^line 242\s*-\s*scientific(?:\/| or )technological uncertainty$/.test(text)
  ) {
    return "s242";
  }
  if (/^line 244\s*-\s*work performed$/.test(text)) return "s244";
  if (/^line 246\s*-\s*scientific\/technological advancement$/.test(text)) {
    return "s246";
  }
  return null;
}

/**
 * Parse one Tiptap report revision into the exact ordered blocks used by both
 * validation and DOCX construction. The parser never drops content silently.
 */
export function parseCanonicalReport(content: string): CanonicalReportBody {
  const sections: Record<ReportSectionKey, CanonicalReportSection> = {
    s242: emptySection("s242"),
    s244: emptySection("s244"),
    s246: emptySection("s246"),
  };
  const diagnostics: ReportParseDiagnostic[] = [];
  let document: TiptapNode;
  try {
    document = tiptapNodeSchema.parse(JSON.parse(content));
  } catch {
    diagnostics.push({
      code: "MALFORMED_DOCUMENT",
      message: "The report is not valid Tiptap editor JSON.",
    });
    return { sections, diagnostics };
  }
  if (document.type !== "doc" || !document.content) {
    diagnostics.push({
      code: "MALFORMED_DOCUMENT",
      message: "The report root must be a Tiptap doc with content.",
    });
    return { sections, diagnostics };
  }

  let current: ReportSectionKey | null = null;
  let highestSectionIndex = -1;
  const seen = new Set<ReportSectionKey>();
  for (const node of document.content) {
    const heading = reportSectionKeyForHeading(node);
    if (heading) {
      const index = SECTION_ORDER.indexOf(heading);
      if (seen.has(heading)) {
        diagnostics.push({
          code: "DUPLICATE_SECTION",
          section: heading,
          message: `Line ${heading.slice(1)} appears more than once.`,
        });
      }
      if (index < highestSectionIndex) {
        diagnostics.push({
          code: "OUT_OF_ORDER_SECTION",
          section: heading,
          message: "Report sections must appear in Line 242, 244, 246 order.",
        });
      }
      seen.add(heading);
      highestSectionIndex = Math.max(highestSectionIndex, index);
      current = heading;
      continue;
    }
    // Reports generated before QA moved into the side rail stored a trailing
    // QA Scorecard heading + code block in the editor document. It is metadata,
    // not Schedule 60 prose, so ignore the entire legacy tail during export.
    if (
      current === "s246" &&
      node.type === "heading" &&
      /^qa scorecard$/i.test(inlineText(node).text.trim())
    ) {
      current = null;
      break;
    }
    if (node.type === "heading") {
      const level = node.attrs?.level;
      if (level === 1 && current === null) continue;
      diagnostics.push({
        code: "UNSUPPORTED_NODE",
        nodeType: node.type,
        section: current ?? undefined,
        message: "Only the exact Line 242, 244, and 246 section headings are supported.",
      });
      continue;
    }
    if (node.type === "horizontalRule") continue;
    if (node.type !== "paragraph") {
      diagnostics.push({
        code: "UNSUPPORTED_NODE",
        nodeType: node.type,
        section: current ?? undefined,
        message: `The ${node.type} block cannot be represented faithfully in Schedule 60.`,
      });
      continue;
    }
    const result = inlineText(node);
    if (result.unsupportedNode) {
      diagnostics.push({
        code: "UNSUPPORTED_NODE",
        nodeType: result.unsupportedNode,
        section: current ?? undefined,
        message: `The ${result.unsupportedNode} inline node cannot be exported faithfully.`,
      });
      continue;
    }
    // Trim horizontal padding without erasing leading/trailing hardBreak nodes:
    // every explicit break consumes a CRA form line.
    const text = result.text.replace(/^[^\S\n]+|[^\S\n]+$/g, "");
    if (!text) continue;
    if (!current) {
      if (text.trim()) {
        diagnostics.push({
          code: "CONTENT_OUTSIDE_SECTION",
          message: "Report prose appears outside Lines 242, 244, or 246.",
        });
      }
      continue;
    }
    if (HAS_GAP_RE.test(text)) {
      diagnostics.push({
        code: "UNRESOLVED_GAP",
        section: current,
        message: `Line ${current.slice(1)} contains an unresolved [GAP: ...] marker.`,
      });
    }
    if (HAS_INFERRED_RE.test(text)) {
      diagnostics.push({
        code: "UNCHECKED_INFERENCE",
        section: current,
        message: `Line ${current.slice(1)} contains an unchecked [INFERRED: ...] marker.`,
      });
    }
    if (UNCLOSED_NOTE_RE.test(stripNoteMarkers(text))) {
      diagnostics.push({
        code: "UNCLOSED_NOTE",
        section: current,
        message: `Line ${current.slice(1)} has a [GAP or [INFERRED note with no closing bracket.`,
      });
    }
    // A stopped Step-by-step draft leaves "[NOT GENERATED]" under each
    // Section it never reached. It is not report text, so it blocks export
    // until the Section is drafted or written by hand.
    if (text.includes(NOT_GENERATED_PLACEHOLDER)) {
      diagnostics.push({
        code: "NOT_DRAFTED",
        section: current,
        message: `Line ${current.slice(1)} still has the ${NOT_GENERATED_PLACEHOLDER} placeholder. Draft this section, or replace the placeholder with your own text.`,
      });
    }
    sections[current].blocks.push({ kind: "paragraph", text });
  }

  for (const key of SECTION_ORDER) {
    if (!seen.has(key) || !sections[key].blocks.some((block) => block.text.trim())) {
      diagnostics.push({
        code: "MISSING_SECTION",
        section: key,
        message: `Line ${key.slice(1)} is missing or empty.`,
      });
    }
    sections[key].plainText = sections[key].blocks
      .map((block) => block.text)
      .join("\n\n");
  }
  return { sections, diagnostics };
}

/** Every gap and inference note of the three Lines, in build order and text order. */
export function reportNotes(body: CanonicalReportBody): ReportNote[] {
  return SECTION_ORDER.flatMap((section) => {
    const seen = new Map<string, number>();
    // Paragraph by paragraph (review round 2): a note never spans two. The
    // blocks are joined by a blank line, where NOTE_BODY stops anyway, so this
    // finds what plainText would; it keeps the bound explicit (review round 3).
    return body.sections[section].blocks.flatMap((block) =>
      findReportNotes(block.text).map(({ kind, text, note }) => {
        const occurrence = seen.get(text) ?? 0;
        seen.set(text, occurrence + 1);
        return { section, kind, text, note, occurrence };
      })
    );
  });
}

export type ReportSectionMetricMap = Record<ReportSectionKey, SectionMetrics>;

/** Canonical live/export metrics: one parser and one shared CRA line model. */
export function reportSectionMetrics(content: string): ReportSectionMetricMap {
  const report = parseCanonicalReport(content);
  return {
    s242: sectionMetrics(report.sections.s242.plainText, "s242"),
    s244: sectionMetrics(report.sections.s244.plainText, "s244"),
    s246: sectionMetrics(report.sections.s246.plainText, "s246"),
  };
}
