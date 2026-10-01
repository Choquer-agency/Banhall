import { checkBecauseClauses } from "../ai/qaChecks";

// Framework-free Tiptap report-document construction, shared by the node
// generation pipeline (convex/ai/pipeline.ts) and the default-runtime
// iterative-assembly mutations (convex/generations.ts). No "use node", no
// imports from node-only modules.

// Capturing variant of GAP_MARKER_RE (convex/lib/lineLimits.ts) — the shared
// constant has no capture group; keep the two in sync.
const GAP_CAPTURE_RE = /\[GAP:\s*([^\]]*)\]/g;

const REPORT_BLOCK_TYPES = new Set([
  "paragraph", "heading", "codeBlock", "blockquote", "listItem", "bulletList",
  "orderedList", "table", "tableRow", "tableCell", "tableHeader", "horizontalRule",
]);

/** Body of a section the chain never drafted (AD-24 stop): keeps AD-8's
 * three-heading contract while making the gap explicit to editor and export. */
export const NOT_GENERATED_PLACEHOLDER = "[NOT GENERATED]";

/** The one paragraph split shared by the editor document and Self-check
 * paragraph indices: blank-line separated, empty paragraphs dropped. */
export function sectionParagraphs(text: string): string[] {
  return text.split(/\n[^\S\n]*\n+/).filter((p) => p.trim());
}

/** Split section prose into Tiptap paragraph nodes, highlighting [GAP: …]
 * markers so the editor renders them as fill-me-in prompts. */
export function textToParagraphs(text: string): Array<Record<string, unknown>> {
  return sectionParagraphs(text)
    .map((p) => {
      const parts: Array<Record<string, unknown>> = [];
      let lastIndex = 0;
      let match;

      GAP_CAPTURE_RE.lastIndex = 0;
      while ((match = GAP_CAPTURE_RE.exec(p)) !== null) {
        if (match.index > lastIndex) {
          parts.push({
            type: "text",
            text: p.slice(lastIndex, match.index),
          });
        }
        parts.push({
          type: "text",
          text: match[0],
          marks: [{ type: "highlight", attrs: { color: "#FEF3C7" } }],
        });
        lastIndex = match.index + match[0].length;
      }

      if (lastIndex < p.length) {
        parts.push({ type: "text", text: p.slice(lastIndex) });
      }

      return { type: "paragraph", content: parts };
    });
}

function sectionBody(text: string | null | undefined): Array<Record<string, unknown>> {
  if (text === null || text === undefined) {
    return [
      {
        type: "paragraph",
        content: [{ type: "text", text: NOT_GENERATED_PLACEHOLDER }],
      },
    ];
  }
  return textToParagraphs(text);
}

type ReportNode = { type?: unknown; attrs?: unknown; content?: unknown; text?: unknown };
type SectionKey = "s242" | "s244" | "s246";

function inlineText(node: ReportNode): string {
  if (typeof node.text === "string") return node.text;
  if (!Array.isArray(node.content)) return "";
  return (node.content as ReportNode[]).map(inlineText).join("");
}

/** A top-level report heading that opens one of the three Sections. */
export function sectionOfHeading(node: ReportNode): SectionKey | null {
  if (node.type !== "heading") return null;
  const level =
    node.attrs && typeof node.attrs === "object" && "level" in node.attrs
      ? (node.attrs as { level?: unknown }).level
      : undefined;
  if (level !== 2) return null;
  const match = inlineText(node).trim().match(/^(?:Line|Section)\s+(242|244|246)\b/i);
  return match ? (`s${match[1]}` as SectionKey) : null;
}

function parseReportDoc(content: string): { type: "doc"; content: ReportNode[] } | null {
  try {
    const parsed: unknown = JSON.parse(content);
    if (
      parsed &&
      typeof parsed === "object" &&
      (parsed as ReportNode).type === "doc" &&
      Array.isArray((parsed as ReportNode).content)
    ) {
      return parsed as { type: "doc"; content: ReportNode[] };
    }
  } catch {
    /* Plaintext reports have no node structure to fill. */
  }
  return null;
}

/** Top-level [start, end) body range of each Section: the nodes after its
 * heading up to the next Section heading, minus a trailing divider. */
function sectionBodyRanges(nodes: ReportNode[]): Map<SectionKey, { start: number; end: number }> {
  const headings: Array<{ key: SectionKey; index: number }> = [];
  nodes.forEach((node, index) => {
    const key = sectionOfHeading(node);
    if (key) headings.push({ key, index });
  });
  const ranges = new Map<SectionKey, { start: number; end: number }>();
  headings.forEach((heading, position) => {
    // A Section heading that appears twice is ambiguous: refuse to fill it.
    if (headings.filter((other) => other.key === heading.key).length > 1) return;
    let end = headings[position + 1]?.index ?? nodes.length;
    while (end > heading.index + 1 && nodes[end - 1]?.type === "horizontalRule") end -= 1;
    ranges.set(heading.key, { start: heading.index + 1, end });
  });
  return ranges;
}

/** True when a Section body is still exactly the untouched "Not drafted"
 * placeholder: one paragraph reading `[NOT GENERATED]`, ignoring empty
 * paragraphs the editor may add around it. */
function isNotDraftedBody(nodes: ReportNode[]): boolean {
  const meaningful = nodes.filter(
    (node) => !(node.type === "paragraph" && !inlineText(node).trim())
  );
  return (
    meaningful.length === 1 &&
    meaningful[0].type === "paragraph" &&
    inlineText(meaningful[0]).trim() === NOT_GENERATED_PLACEHOLDER
  );
}

/** Sections whose body in `content` is still the untouched placeholder. */
export function notDraftedReportSections(content: string): SectionKey[] {
  const doc = parseReportDoc(content);
  if (!doc) return [];
  const ranges = sectionBodyRanges(doc.content);
  return (["s242", "s244", "s246"] as const).filter((key) => {
    const range = ranges.get(key);
    return range !== undefined && isNotDraftedBody(doc.content.slice(range.start, range.end));
  });
}

/**
 * Redraft after Stop (owner decision 20): replace the body of each Section
 * that is still exactly the `[NOT GENERATED]` placeholder with its drafted
 * paragraphs. Every other node, including every Section the writer edited or
 * filled by hand, is carried over unchanged. A Section whose placeholder is
 * gone (the writer typed there) is reported as skipped and left alone.
 */
export function fillNotDraftedSections(
  content: string,
  drafts: Partial<Record<SectionKey, string>>
): { content: string; filled: SectionKey[]; skipped: SectionKey[] } {
  const requested = (["s242", "s244", "s246"] as const).filter(
    (key) => drafts[key] !== undefined
  );
  const doc = parseReportDoc(content);
  if (!doc) return { content, filled: [], skipped: requested };
  const ranges = sectionBodyRanges(doc.content);
  const fillable = requested.filter((key) => {
    const range = ranges.get(key);
    const text = drafts[key] ?? "";
    return (
      range !== undefined &&
      text.trim().length > 0 &&
      isNotDraftedBody(doc.content.slice(range.start, range.end))
    );
  });
  if (fillable.length === 0) return { content, filled: [], skipped: requested };
  // Splice from the end so earlier ranges keep their indices.
  const ordered = [...fillable].sort(
    (left, right) => (ranges.get(right)?.start ?? 0) - (ranges.get(left)?.start ?? 0)
  );
  const nodes = [...doc.content];
  for (const key of ordered) {
    const range = ranges.get(key);
    if (!range) continue;
    nodes.splice(range.start, range.end - range.start, ...textToParagraphs(drafts[key] ?? ""));
  }
  return {
    content: JSON.stringify({ ...doc, content: nodes }),
    filled: fillable,
    skipped: requested.filter((key) => !fillable.includes(key)),
  };
}

/**
 * Build a Tiptap-compatible JSON document from the three section texts.
 * The exact heading strings are load-bearing: parseCanonicalReport
 * (src/lib/reportSections.ts) matches them to recover sections for export.
 * A null/undefined section (never drafted — a stopped ordered generation)
 * renders one `[NOT GENERATED]` paragraph under its heading.
 */
export function buildTiptapDocument(
  title: string,
  section242: string | null | undefined,
  section244: string | null | undefined,
  section246: string | null | undefined
) {
  const content: Array<Record<string, unknown>> = [];

  content.push({
    type: "heading",
    attrs: { level: 1 },
    content: [{ type: "text", text: title }],
  });

  // Section 242
  content.push({
    type: "heading",
    attrs: { level: 2 },
    content: [
      {
        type: "text",
        text: "Line 242 — Scientific/Technological Uncertainty",
      },
    ],
  });
  content.push(...sectionBody(section242));

  // Section 244
  content.push({ type: "horizontalRule" });
  content.push({
    type: "heading",
    attrs: { level: 2 },
    content: [{ type: "text", text: "Line 244 — Work Performed" }],
  });
  content.push(...sectionBody(section244));

  // Section 246
  content.push({ type: "horizontalRule" });
  content.push({
    type: "heading",
    attrs: { level: 2 },
    content: [
      {
        type: "text",
        text: "Line 246 — Scientific/Technological Advancement",
      },
    ],
  });
  content.push(...sectionBody(section246));

  return { type: "doc", content };
}

/** Recover current section prose while preserving the distinction between headings and body text. */
export function extractReportSections(content: string): { s242: string; s244: string; s246: string } {
  const sections = { s242: "", s244: "", s246: "" };
  type Section = keyof typeof sections;
  type Block = { text: string; heading: boolean; richText?: boolean; title?: boolean };
  function nodeText(node: unknown): string {
    type TextTask = { kind: "node"; node: unknown; inlineContext: boolean } | { kind: "separator" };
    const pending: TextTask[] = [{ kind: "node", node, inlineContext: false }];
    const text: string[] = [];
    // User-saved documents can be deeply nested. Keep traversal on the heap,
    // including nested inline content, while retaining each parent's separator.
    while (pending.length) {
      const task = pending.pop();
      if (!task) break;
      if (task.kind === "separator") {
        text.push("\n\n");
        continue;
      }
      const current = task.node;
      if (!current || typeof current !== "object") continue;
      // Boundaries belong to the block itself, even when inline wrappers hide
      // it from adjoining text. Queue its exit before visiting its children.
      if ("type" in current && typeof current.type === "string" && REPORT_BLOCK_TYPES.has(current.type)) {
        text.push("\n\n");
        pending.push({ kind: "separator" });
      }
      if ("text" in current && typeof current.text === "string") {
        text.push(current.text);
      } else if ("type" in current && current.type === "hardBreak") {
        text.push("\n");
      } else if ("content" in current && Array.isArray(current.content)) {
        const inline = task.inlineContext || ("type" in current && ["paragraph", "heading", "codeBlock"].includes(String(current.type)));
        for (let index = current.content.length - 1; index >= 0; index--) {
          pending.push({ kind: "node", node: current.content[index], inlineContext: inline });
          if (index > 0 && !inline) pending.push({ kind: "separator" });
        }
      }
    }
    return text.join("");
  }
  function sectionHeading(text: string, richText = false): Section | undefined {
    // A section label must never consume a statement recognized by the QA
    // detector, including labels with no terminal punctuation.
    if (checkBecauseClauses(text).uncertaintyCount > 0) return undefined;
    const pattern = /^(?:#{1,6}\s*)?(?:Line|Section)\s+(242|244|246)(?:\s*[-—–:]\s*([^\n]*))?$/i;
    const match = text.trim().match(pattern);
    if (!match) return undefined;
    // Plaintext has no node kind to distinguish a heading from a sentence.
    // Only established labels can disambiguate plaintext cross-references,
    // whether or not the sentence has terminal punctuation.
    const label = match[2] ?? "";
    if (!richText && label &&
      !/^(?:(?:Scientific\/)?Technological Uncertainty|Uncertainty|Work(?: Performed)?|(?:Scientific\/)?Technological Advancement|Advancement)[.!?]?$/i.test(label)) return undefined;
    return match[1] === "244" ? "s244" : match[1] === "246" ? "s246" : "s242";
  }
  let blocks: Block[] | undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch { /* Plaintext is a supported legacy format. */ }
  if (parsed && typeof parsed === "object" && "type" in parsed && parsed.type === "doc") {
    blocks = [];
    if ("content" in parsed && Array.isArray(parsed.content)) {
      const pending: unknown[] = [...parsed.content].reverse();
      while (pending.length) {
        const node = pending.pop();
        if (!node || typeof node !== "object") continue;
        if ("type" in node && (node.type === "paragraph" || node.type === "heading" || node.type === "codeBlock")) {
          const title = node.type === "heading" && "attrs" in node && node.attrs &&
            typeof node.attrs === "object" && "level" in node.attrs && node.attrs.level === 1;
          blocks.push({ text: nodeText(node), heading: node.type === "heading", richText: true, title: !!title });
        } else if ("content" in node && Array.isArray(node.content)) {
          for (let index = node.content.length - 1; index >= 0; index--) {
            pending.push(node.content[index]);
          }
        } else {
          const text = nodeText(node);
          if (text) blocks.push({ text, heading: false });
        }
      }
    }
  }
  if (!blocks) {
    blocks = [];
    let body: string[] = [];
    for (const line of content.replace(/\r\n?/g, "\n").replace(/\n[^\S\n]+(?=\n)/g, "\n").split("\n")) {
      if (sectionHeading(line)) {
        if (body.length) blocks.push({ text: body.join("\n"), heading: false });
        body = [];
        blocks.push({ text: line, heading: true });
      } else body.push(line);
    }
    if (body.length) blocks.push({ text: body.join("\n"), heading: false });
  }
  // Only an initial uncertainty section proves where its preamble ends.
  // A later appendix cannot hide prose before the first work/advancement section.
  const firstSection = blocks.find(block => block.heading && sectionHeading(block.text, block.richText));
  const startsWithUncertainty = firstSection && sectionHeading(firstSection.text, firstSection.richText) === "s242";
  // Generated titles remain preamble, but a later first 242 heading cannot
  // discard preceding prose containing an already recognized uncertainty.
  const firstSectionIndex = firstSection ? blocks.indexOf(firstSection) : blocks.length;
  const firstNonemptyIndex = blocks.findIndex(block => block.text.trim());
  const substantivePreamble = blocks.slice(0, firstSectionIndex)
    .some((block, index) => !(index === firstNonemptyIndex && block.title) && checkBecauseClauses(block.text).uncertaintyCount > 0);
  let section: Section | undefined = startsWithUncertainty && !substantivePreamble ? undefined : "s242";
  for (const [index, block] of blocks.entries()) {
    if (index === firstNonemptyIndex && block.title && firstSectionIndex > index && startsWithUncertainty) continue;
    const next = block.heading ? sectionHeading(block.text, block.richText) : undefined;
    if (next) section = next;
    else if (section && block.text.trim()) {
      // Hard breaks in rich text can encode the same blank paragraphs as
      // legacy text. Keep soft wraps, but normalize whitespace-only blank lines.
      sections[section] += block.text.replace(/\r\n?/g, "\n").replace(/\n[^\S\n]+(?=\n)/g, "\n").trim() + "\n\n";
    }
  }
  return sections;
}
