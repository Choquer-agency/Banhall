/**
 * Word files as Markdown (owner, 2026-10-26: "should be properly markdown so
 * we can see italic, bolds and headings"). mammoth turns a .docx into simple
 * HTML (headings, paragraphs, bold, italic, lists, tables, links, pictures);
 * this turns that HTML into Markdown the same way in the browser and on the
 * server, so a file reads the same wherever it is read. Bold is `**`,
 * italic `*`. A literal `*` or `\` in the document is escaped (`\*`, `\\`),
 * and so is a `|` inside a table cell, so `quotableWordText` can remove the
 * marks exactly: the AI's quotes are checked against that view, which is
 * the document's own words with headings and tables kept.
 */

import type mammothModule from "mammoth";

/** Bumped with any change to the Markdown this produces. */
export const WORD_MARKDOWN_VERSION = 1;

/**
 * A Word file's text as Markdown. Each reader passes its own mammoth (the
 * browser loads it on demand, the server imports it). Pictures are skipped
 * without reading their bytes.
 */
export async function wordToMarkdown(
  mammoth: Pick<typeof mammothModule, "convertToHtml" | "images">,
  input: Parameters<typeof mammothModule.convertToHtml>[0]
): Promise<string> {
  const { value } = await mammoth.convertToHtml(input, {
    convertImage: mammoth.images.imgElement(async () => ({ src: "" })),
  });
  return wordHtmlToMarkdown(value);
}

type Token = { kind: "open" | "close" | "self"; name: string; attrs: string } | { kind: "text"; text: string };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/**
 * A document's own `\` and `*`, escaped so they are never read as marks.
 * Also for plain text joined to Word Markdown (a note before a prior-year
 * report), so `quotableWordText` gives it back unchanged.
 */
export function escapeMarks(text: string): string {
  return text.replace(/[\\*]/g, (char) => `\\${char}`);
}

function tokenize(html: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*?)(\/?)>|([^<]+)/g;
  for (const match of html.matchAll(pattern)) {
    if (match[5] !== undefined) {
      tokens.push({ kind: "text", text: escapeMarks(decodeEntities(match[5])) });
      continue;
    }
    const name = match[2]!.toLowerCase();
    const kind = match[1] ? "close" : match[4] || name === "br" || name === "img" ? "self" : "open";
    tokens.push({ kind, name, attrs: match[3] ?? "" });
  }
  return tokens;
}

/** Wraps `inner` in `mark`, keeping the spaces outside the marks. */
function wrap(inner: string, mark: string): string {
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner)!;
  return match[2] ? `${match[1]}${mark}${match[2]}${mark}${match[3]}` : inner;
}

type Frame = {
  name: string;
  parts: string[];
  ordered?: boolean;
  index?: number;
  depth?: number;
  rows?: string[][];
  row?: string[];
  /** A list item's marker with its indent, and whether its text was already written. */
  prefix?: string;
  emitted?: boolean;
};

/**
 * Markdown from mammoth's HTML. Blocks (headings, paragraphs, list items,
 * table rows) are separated by a blank line, as the plain-text reader
 * separated paragraphs.
 */
export function wordHtmlToMarkdown(html: string): string {
  const blocks: string[] = [];
  const stack: Frame[] = [{ name: "root", parts: [] }];
  let listDepth = 0;
  const top = () => stack[stack.length - 1]!;
  const inTable = () => stack.some((frame) => frame.name === "table");

  const emitBlock = (text: string) => {
    // Trailing spaces go; a list item's leading indent stays.
    const line = text.replace(/[ \t]+$/gm, "").replace(/^\n+|\n+$/g, "");
    if (line.trim()) blocks.push(line);
  };

  for (const token of tokenize(html)) {
    if (token.kind === "text") {
      top().parts.push(token.text);
      continue;
    }
    const { name } = token;
    if (token.kind === "self") {
      if (name === "br") top().parts.push(inTable() ? " " : "\n");
      // Pictures carry no text here (no OCR for Word pictures).
      continue;
    }
    if (token.kind === "open") {
      if (name === "ul" || name === "ol") {
        // A list inside an item: the item's own text comes first.
        const item = top();
        if (item.name === "li" && !item.emitted) {
          emitBlock(`${item.prefix ?? "- "}${item.parts.join("").trim()}`);
          item.parts = [];
          item.emitted = true;
        }
        listDepth += 1;
        stack.push({ name, parts: [], ordered: name === "ol", index: 0, depth: listDepth });
      } else if (name === "li") {
        const list = top();
        list.index = (list.index ?? 0) + 1;
        const marker = list.ordered ? `${list.index}.` : "-";
        stack.push({ name, parts: [], prefix: `${"  ".repeat(Math.max(0, (list.depth ?? 1) - 1))}${marker} ` });
      } else if (name === "table") {
        stack.push({ name, parts: [], rows: [] });
      } else if (name === "tr") {
        stack.push({ name, parts: [], row: [] });
      } else {
        stack.push({ name, parts: [] });
      }
      continue;
    }
    // A close tag: pop to the matching open frame.
    let at = stack.length - 1;
    while (at > 0 && stack[at]!.name !== name) at -= 1;
    if (at === 0) continue;
    while (stack.length - 1 > at) {
      const stray = stack.pop()!;
      top().parts.push(stray.parts.join(""));
    }
    const frame = stack.pop()!;
    const inner = frame.parts.join("");
    const parent = top();
    switch (name) {
      case "strong":
      case "b":
        parent.parts.push(wrap(inner, "**"));
        break;
      case "em":
      case "i":
        parent.parts.push(wrap(inner, "*"));
        break;
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6":
        if (inTable()) parent.parts.push(inner);
        else emitBlock(`${"#".repeat(Number(name[1]))} ${inner.replace(/\s*\n\s*/g, " ").trim()}`);
        break;
      case "p":
        if (inTable() || parent.name === "li") parent.parts.push(parent.parts.length ? ` ${inner}` : inner);
        else emitBlock(inner);
        break;
      case "li":
        if (!frame.emitted) emitBlock(`${frame.prefix ?? "- "}${inner.trim()}`);
        else if (inner.trim()) emitBlock(`${" ".repeat((frame.prefix ?? "- ").length)}${inner.trim()}`);
        break;
      case "ul":
      case "ol":
        listDepth -= 1;
        break;
      case "td":
      case "th":
        parent.row?.push(inner.replace(/\s+/g, " ").trim().replace(/\|/g, "\\|"));
        break;
      case "tr": {
        const table = parent;
        if (frame.row && frame.row.length > 0) table.rows?.push(frame.row);
        break;
      }
      case "table": {
        const rows = frame.rows ?? [];
        if (rows.length === 0) break;
        const width = Math.max(...rows.map((row) => row.length));
        const line = (row: string[]) => `| ${Array.from({ length: width }, (_, i) => row[i] ?? "").join(" | ")} |`;
        const lines = [line(rows[0]!), `|${" --- |".repeat(width)}`, ...rows.slice(1).map(line)];
        emitBlock(lines.join("\n"));
        break;
      }
      default:
        // Links, superscript and anything else: their text only.
        parent.parts.push(inner);
    }
  }
  const rest = stack[0]!.parts.join("");
  if (rest.trim()) emitBlock(rest);
  return blocks.join("\n\n");
}

/**
 * The words of Word Markdown without its bold and italic marks: the view a
 * draft's frozen evidence holds and quotes are checked against. Headings,
 * list markers and tables stay; escapes are undone, so a literal `*`, `\`
 * or `|` reads as written.
 */
export function quotableWordText(markdown: string): string {
  let out = "";
  for (let i = 0; i < markdown.length; i++) {
    const char = markdown[i]!;
    if (char === "\\") {
      const next = markdown[i + 1];
      if (next === "*" || next === "\\" || next === "|") {
        out += next;
        i += 1;
        continue;
      }
    }
    if (char === "*") continue;
    out += char;
  }
  return out;
}
