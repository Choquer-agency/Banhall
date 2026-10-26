/**
 * Word files as Markdown (owner, 2026-10-26: "should be properly markdown so
 * we can see italic, bolds and headings"). mammoth turns a .docx into simple
 * HTML (headings, paragraphs, bold, italic, lists, tables, links, pictures);
 * this turns that HTML into Markdown the same way in the browser and on the
 * server, so a file reads the same wherever it is read. Bold is `**`,
 * italic `*`, headings `#`, lists `-` and `1.`, tables `|`.
 *
 * The document's own text is escaped wherever Markdown would read it as
 * syntax (a `*`, `_`, `[`, backtick, `~`, `|` or `\`, an HTML-like `<`, an
 * entity, a list or heading sign at a line start), so nothing the document
 * says is shown as formatting or hidden. `quotableWordText` removes the
 * marks and undoes every escape: the AI's quotes are checked against that
 * view, which is the document's own words with headings, lists and tables
 * kept.
 */

import type mammothModule from "mammoth";

/** Bumped with any change to the Markdown this produces. */
export const WORD_MARKDOWN_VERSION = 2;

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

const isWordChar = (char: string | undefined) => char !== undefined && /[\p{L}\p{N}]/u.test(char);

/**
 * A document's own text, escaped wherever Markdown would read it as inline
 * syntax. Also for plain text joined to Word Markdown (the note before a
 * prior-year report), so `quotableWordText` gives it back unchanged.
 */
export function escapeMarks(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    const next = text[i + 1];
    let escape = false;
    if (char === "\\" || char === "*" || char === "`" || char === "[" || char === "~" || char === "|") escape = true;
    // An underscore inside a word is never emphasis.
    else if (char === "_") escape = !(isWordChar(text[i - 1]) && isWordChar(next));
    // An HTML tag, comment or autolink would be hidden or turned into a link.
    else if (char === "<") escape = next !== undefined && /[A-Za-z/!?]/.test(next);
    // An entity would be shown as the character it names.
    else if (char === "&") escape = /^&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/i.test(text.slice(i));
    out += escape ? `\\${char}` : char;
  }
  return out;
}

/**
 * A line of the document's own text, with a sign Markdown would read as a
 * heading, quote, list item, rule or code block at its start escaped.
 */
function escapeLineStarts(text: string): string {
  return text
    .split("\n")
    .map((line) =>
      line
        .replace(/^([ \t]*)([#>+=-])/, "$1\\$2")
        .replace(/^([ \t]*\d+)([.)])/, "$1\\$2")
        // Four leading spaces would make a code block.
        .replace(/^[ \t]+/, "")
    )
    .join("\n");
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

const EDGE = /[\s!"#$%&'()+,\-./:;<=>?@[\]^_`{|}~]/;

/**
 * Wraps `inner` in `mark`, with spaces and punctuation at its edges moved
 * outside the marks: Markdown does not close `**Note:**Text`, but does
 * close `**Note**:Text`, which reads the same. An escaped character stays
 * inside.
 */
function wrap(inner: string, mark: string): string {
  let body = inner;
  let before = "";
  let after = "";
  while (body.length > 0 && EDGE.test(body[0]!)) {
    before += body[0];
    body = body.slice(1);
  }
  while (body.length > 0 && EDGE.test(body[body.length - 1]!) && body[body.length - 2] !== "\\") {
    after = body[body.length - 1] + after;
    body = body.slice(0, -1);
  }
  return body ? `${before}${mark}${body}${mark}${after}` : inner;
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
 * tables) are separated by a blank line, as the plain-text reader separated
 * paragraphs. Inside a table cell everything stays in the cell: paragraphs
 * joined by a space, list items by "; ", a table in a cell row by row.
 */
export function wordHtmlToMarkdown(html: string): string {
  const blocks: string[] = [];
  const stack: Frame[] = [{ name: "root", parts: [] }];
  let listDepth = 0;
  const top = () => stack[stack.length - 1]!;
  const tableDepth = () => stack.filter((frame) => frame.name === "table").length;
  const inTable = () => tableDepth() > 0;

  const emitBlock = (text: string) => {
    // Trailing spaces go; a list item's leading indent stays.
    const line = text.replace(/[ \t]+$/gm, "").replace(/^\n+|\n+$/g, "");
    if (line.trim()) blocks.push(line);
  };
  /** Text added to a cell, after a separator when the cell already holds some. */
  const addToCell = (frame: Frame, text: string, separator: string) => {
    const trimmed = text.replace(/\s+/g, " ").trim();
    if (!trimmed) return;
    frame.parts.push(frame.parts.join("").trim() ? `${separator}${trimmed}` : trimmed);
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
        if (!inTable() && item.name === "li" && !item.emitted) {
          emitBlock(`${item.prefix ?? "- "}${escapeLineStarts(item.parts.join("").trim())}`);
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
        if (inTable()) addToCell(parent, inner, " ");
        else emitBlock(`${"#".repeat(Number(name[1]))} ${escapeLineStarts(inner.replace(/\s*\n\s*/g, " ").trim())}`);
        break;
      case "p":
        if (inTable() || parent.name === "li") addToCell(parent, inner, " ");
        else emitBlock(escapeLineStarts(inner));
        break;
      case "li":
        if (inTable()) addToCell(parent, inner, "; ");
        else if (!frame.emitted) emitBlock(`${frame.prefix ?? "- "}${escapeLineStarts(inner.trim())}`);
        else if (inner.trim()) emitBlock(`${" ".repeat((frame.prefix ?? "- ").length)}${escapeLineStarts(inner.trim())}`);
        break;
      case "ul":
      case "ol":
        listDepth -= 1;
        // In a cell, the list's items join the cell's text.
        if (inTable()) addToCell(parent, inner, " ");
        break;
      case "td":
      case "th":
        parent.row?.push(inner.replace(/\s+/g, " ").trim());
        break;
      case "tr":
        if (frame.row && frame.row.length > 0) parent.rows?.push(frame.row);
        break;
      case "table": {
        const rows = frame.rows ?? [];
        if (rows.length === 0) break;
        if (inTable()) {
          // A table inside a cell stays in that cell, row by row.
          addToCell(parent, rows.map((row) => row.filter(Boolean).join(", ")).join("; "), " ");
          break;
        }
        const width = Math.max(...rows.map((row) => row.length));
        const line = (row: string[]) => `| ${Array.from({ length: width }, (_, i) => row[i] ?? "").join(" | ")} |`;
        emitBlock([line(rows[0]!), `|${" --- |".repeat(width)}`, ...rows.slice(1).map(line)].join("\n"));
        break;
      }
      default:
        // Links, superscript and anything else: their text only.
        parent.parts.push(inner);
    }
  }
  const rest = stack[0]!.parts.join("");
  if (rest.trim()) emitBlock(escapeLineStarts(rest));
  return blocks.join("\n\n");
}

/**
 * The text the AI reads from a file: Word Markdown without its bold and
 * italic marks (`quotableWordText`), any other text as it is. Drafts freeze
 * it, chat, research and PD reviews read it, and quotes are checked
 * against it, so no AI ever sees or copies a mark.
 */
export function quotableFileText(text: string, textFormat: "markdown" | undefined): string {
  return textFormat === "markdown" ? quotableWordText(text) : text;
}

/**
 * The words of Word Markdown without its bold and italic marks: the view a
 * draft's frozen evidence holds and quotes are checked against. Headings,
 * list markers and tables stay; every escape is undone, so the document's
 * own characters read as written. (Every `\` the document contains is
 * escaped, so a `\` here always starts an escape.)
 */
export function quotableWordText(markdown: string): string {
  let out = "";
  for (let i = 0; i < markdown.length; i++) {
    const char = markdown[i]!;
    if (char === "\\" && i + 1 < markdown.length) {
      out += markdown[i + 1];
      i += 1;
      continue;
    }
    if (char === "*") continue;
    out += char;
  }
  return out;
}
