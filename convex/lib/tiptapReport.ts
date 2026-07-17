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
