import { checkBecauseClauses } from "../ai/qaChecks";

// Framework-free Tiptap report-document construction, shared by the node
// generation pipeline (convex/ai/pipeline.ts) and the default-runtime
// iterative-assembly mutations (convex/generations.ts). No "use node", no
// imports from node-only modules.

// Capturing variant of GAP_MARKER_RE (convex/lib/lineLimits.ts) — the shared
// constant has no capture group; keep the two in sync.
const GAP_CAPTURE_RE = /\[GAP:\s*([^\]]*)\]/g;

/** Split section prose into Tiptap paragraph nodes, highlighting [GAP: …]
 * markers so the editor renders them as fill-me-in prompts. */
export function textToParagraphs(text: string): Array<Record<string, unknown>> {
  return text
    .split(/\n[^\S\n]*\n+/)
    .filter((p) => p.trim())
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

/**
 * Build a Tiptap-compatible JSON document from the three section texts.
 * The exact heading strings are load-bearing: parseCanonicalReport
 * (src/lib/reportSections.ts) matches them to recover sections for export.
 */
export function buildTiptapDocument(
  title: string,
  section242: string,
  section244: string,
  section246: string
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
  content.push(...textToParagraphs(section242));

  // Section 244
  content.push({ type: "horizontalRule" });
  content.push({
    type: "heading",
    attrs: { level: 2 },
    content: [{ type: "text", text: "Line 244 — Work Performed" }],
  });
  content.push(...textToParagraphs(section244));

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
  content.push(...textToParagraphs(section246));

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
      if ("text" in current && typeof current.text === "string") {
        text.push(current.text);
      } else if ("type" in current && current.type === "hardBreak") {
        text.push("\n");
      } else if ("content" in current && Array.isArray(current.content)) {
        const inline = task.inlineContext || ("type" in current && ["paragraph", "heading", "codeBlock"].includes(String(current.type)));
        for (let index = current.content.length - 1; index >= 0; index--) {
          const child: unknown = current.content[index];
          const previous: unknown = current.content[index - 1];
          const isBlock = (value: unknown) => !!value && typeof value === "object" && "type" in value &&
            ["paragraph", "heading", "codeBlock", "blockquote", "listItem", "bulletList", "orderedList", "table", "tableRow", "tableCell", "tableHeader"].includes(String(value.type));
          pending.push({ kind: "node", node: child, inlineContext: inline });
          if (index > 0 && (!inline || isBlock(child) || isBlock(previous))) pending.push({ kind: "separator" });
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
