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
  type Block = { text: string; heading: boolean; richText?: boolean };
  function nodeText(node: unknown): string {
    if (!node || typeof node !== "object") return "";
    if ("text" in node && typeof node.text === "string") return node.text;
    if ("type" in node && node.type === "hardBreak") return "\n";
    if (!("content" in node) || !Array.isArray(node.content)) return "";
    const inline = "type" in node && ["paragraph", "heading"].includes(String(node.type));
    return node.content.map(nodeText).join(inline ? "" : "\n\n");
  }
  function sectionHeading(text: string, richText = false): Section | undefined {
    // Rich text supplies a heading node. Plaintext needs a conservative label
    // grammar so a heading-like body sentence cannot disappear from QA.
    const pattern = richText
      ? /^(?:#{1,6}\s*)?(?:Line|Section)\s+(242|244|246)(?:\s*[-—–:]\s*[^\n]*)?$/i
      : /^(?:#{1,6}\s*)?(?:Line|Section)\s+(242|244|246)(?:\s*[-—–:]\s*[^.!?]*)?$/i;
    const match = text.trim().match(pattern);
    return match ? match[1] === "244" ? "s244" : match[1] === "246" ? "s246" : "s242" : undefined;
  }
  let blocks: Block[] | undefined;
  try {
    const parsed: unknown = JSON.parse(content);
    if (parsed && typeof parsed === "object" && "type" in parsed && parsed.type === "doc") {
      blocks = [];
      if ("content" in parsed && Array.isArray(parsed.content)) {
        const extracted: Block[] = [];
        function visit(node: unknown): void {
          if (!node || typeof node !== "object") return;
          if ("type" in node && (node.type === "paragraph" || node.type === "heading")) {
            extracted.push({ text: nodeText(node), heading: node.type === "heading", richText: true });
          } else if ("content" in node && Array.isArray(node.content)) {
            node.content.forEach(visit);
          } else {
            const text = nodeText(node);
            if (text) extracted.push({ text, heading: false });
          }
        }
        parsed.content.forEach(visit);
        blocks = extracted;
      }
    }
  } catch { /* Plaintext is a supported legacy format. */ }
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
  // Only a recognized uncertainty heading proves where its preamble ends.
  // If that heading was renamed/deleted, retain preceding prose in section 242.
  const hasUncertaintyHeading = blocks.some(block => block.heading && sectionHeading(block.text, block.richText) === "s242");
  let section: Section | undefined = hasUncertaintyHeading ? undefined : "s242";
  for (const block of blocks) {
    const next = block.heading ? sectionHeading(block.text, block.richText) : undefined;
    if (next) section = next;
    else if (section && block.text.trim()) sections[section] += block.text.trim() + "\n\n";
  }
  return sections;
}
