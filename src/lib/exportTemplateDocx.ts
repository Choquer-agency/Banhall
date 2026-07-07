import JSZip from "jszip";
import { saveAs } from "file-saver";

/**
 * BNH-46: export the report into the client's Schedule 60 Word template.
 *
 * The template (static/templates/schedule60.docx, from data/templates/) is the
 * real CRA T661 Part 2 form: sections 242/244/246 are table boxes with a
 * 78-character Courier ruler across the top and a line-number gutter. We open
 * the .docx (a zip), splice the section text into each box's content cell as
 * Courier New 12pt paragraphs (12pt Courier = exactly 78 chars across the
 * 11264-dxa cell, matching the ruler), and re-zip. A blank paragraph is
 * emitted between paragraphs — on the form every blank line costs a full line,
 * which is the client's counting convention.
 *
 * Not SSR-safe (file-saver) — import lazily from click handlers only.
 */

interface TiptapNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}

const TEMPLATE_URL = "/templates/schedule60.docx";

const RULER_78 =
  "123456789012345678901234567890123456789012345678901234567890123456789012345678";
// The 60-char ruler (project-title box). The "</w:t>" suffix keeps it from
// matching the first 60 chars of a 78-char section ruler.
const RULER_60_RUN =
  "123456789012345678901234567890123456789012345678901234567890</w:t>";

const SECTION_MARKERS: Record<"s242" | "s244" | "s246", string> = {
  s242: "242 What",
  s244: "244 What",
  s246: "246 What",
};

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const COURIER_RPR =
  '<w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:cs="Courier New"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr>';

function courierParagraph(text: string): string {
  return `<w:p><w:pPr><w:pStyle w:val="BodyText"/><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:cs="Courier New"/><w:sz w:val="24"/></w:rPr></w:pPr><w:r>${COURIER_RPR}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

const BLANK_PARAGRAPH =
  '<w:p><w:pPr><w:pStyle w:val="BodyText"/><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:cs="Courier New"/><w:sz w:val="24"/></w:rPr></w:pPr></w:p>';

/** Section text → form paragraphs with the blank-line-between convention. */
function sectionParagraphsXml(text: string): string {
  const paras = text
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n/g, " ").trim())
    .filter(Boolean);
  return paras.map(courierParagraph).join(BLANK_PARAGRAPH);
}

/**
 * Replace the empty paragraph in a section box's content cell. Layout per box:
 * question row → ruler row → [gutter cell | content cell (empty paragraph)].
 * The content cell is the second <w:tc> after the ruler.
 */
function fillSectionCell(xml: string, marker: string, text: string): string {
  const mi = xml.indexOf(marker);
  if (mi < 0) throw new Error(`Template: marker "${marker}" not found`);
  const ri = xml.indexOf(RULER_78, mi);
  if (ri < 0) throw new Error(`Template: ruler after "${marker}" not found`);
  const gutterTc = xml.indexOf("<w:tc>", ri);
  const contentTc = xml.indexOf("<w:tc>", gutterTc + 1);
  const tcEnd = xml.indexOf("</w:tc>", contentTc);
  const pStart = xml.indexOf("<w:p ", contentTc);
  if (gutterTc < 0 || contentTc < 0 || tcEnd < 0 || pStart < 0 || pStart > tcEnd) {
    throw new Error(`Template: content cell for "${marker}" not found`);
  }
  return xml.slice(0, pStart) + sectionParagraphsXml(text) + xml.slice(tcEnd);
}

/** Append a paragraph under the 60-char ruler in the line-200 title box. */
function fillTitleBox(xml: string, title: string): string {
  const ri = xml.indexOf(RULER_60_RUN);
  if (ri < 0) return xml; // non-fatal — the form still exports
  const tcEnd = xml.indexOf("</w:tc>", ri);
  if (tcEnd < 0) return xml;
  return (
    xml.slice(0, tcEnd) + courierParagraph(title.slice(0, 60)) + xml.slice(tcEnd)
  );
}

/** Write a value into the underlined fill-in cell after a header label. */
function fillHeaderField(xml: string, label: string, value: string): string {
  const li = xml.indexOf(label);
  if (li < 0) return xml;
  const tc = xml.indexOf("<w:tc>", li);
  const tcEnd = xml.indexOf("</w:tc>", tc);
  const pEnd = xml.indexOf("</w:p>", tc);
  if (tc < 0 || pEnd < 0 || pEnd > tcEnd) return xml;
  const run = `<w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">${escapeXml(value)}</w:t></w:r>`;
  return xml.slice(0, pEnd) + run + xml.slice(pEnd);
}

// ─── Tiptap → per-section plain text ─────────────────────────────────────────

function nodePlainText(node: TiptapNode): string {
  if (node.text) {
    // Drop unresolved [GAP] highlights — they must not reach the CRA form.
    if (node.marks?.some((m) => m.type === "highlight")) return "";
    return node.text;
  }
  return (node.content ?? []).map(nodePlainText).join("");
}

/** Split the report's Tiptap doc into the three T661 sections by heading. */
export function extractSections(content: string): {
  s242: string;
  s244: string;
  s246: string;
} {
  const doc = JSON.parse(content) as TiptapNode;
  const out = { s242: "", s244: "", s246: "" };
  let bucket: keyof typeof out | null = null;
  for (const node of doc.content ?? []) {
    if (node.type === "codeBlock") continue;
    if (node.type === "heading") {
      const t = nodePlainText(node);
      bucket = t.includes("242")
        ? "s242"
        : t.includes("244")
          ? "s244"
          : t.includes("246")
            ? "s246"
            : null;
      continue;
    }
    if (bucket && node.type === "paragraph") {
      const t = nodePlainText(node).trim();
      if (t) out[bucket] += (out[bucket] ? "\n\n" : "") + t;
    }
  }
  return out;
}

export async function exportToTemplateDocx(opts: {
  content: string; // report Tiptap JSON
  clientName: string;
  title: string; // SR&ED title preferred, internal title as fallback
  fiscalYearEnd?: number | null;
  filename: string; // without extension
}): Promise<void> {
  const sections = extractSections(opts.content);
  if (!sections.s242 && !sections.s244 && !sections.s246) {
    throw new Error("No section content found in the report");
  }

  const res = await fetch(TEMPLATE_URL);
  if (!res.ok) throw new Error(`Template fetch failed (${res.status})`);
  const zip = await JSZip.loadAsync(await res.arrayBuffer());
  const docFile = zip.file("word/document.xml");
  if (!docFile) throw new Error("Template is missing word/document.xml");
  let xml = await docFile.async("string");

  xml = fillSectionCell(xml, SECTION_MARKERS.s242, sections.s242 || " ");
  xml = fillSectionCell(xml, SECTION_MARKERS.s244, sections.s244 || " ");
  xml = fillSectionCell(xml, SECTION_MARKERS.s246, sections.s246 || " ");
  xml = fillTitleBox(xml, opts.title);
  xml = fillHeaderField(xml, "Name of Claimant:", ` ${opts.clientName}`);
  if (opts.fiscalYearEnd) {
    const d = new Date(opts.fiscalYearEnd);
    xml = fillHeaderField(
      xml,
      "Taxation Year Ending",
      ` ${d.toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" })}`
    );
  }

  zip.file("word/document.xml", xml);
  const blob = await zip.generateAsync({
    type: "blob",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  saveAs(blob, `${opts.filename}.docx`);
}
