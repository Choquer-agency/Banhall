/**
 * Formats raw extracted document text ("What AI read") into clean, structured
 * editorial blocks for the Import file preview sheet (Paper Files 7).
 *
 * Pure and deterministic: cleans PDF/Word extraction noise (hard line wraps,
 * stray page footers, markdown markers, redundant spacing) and recognizes
 * SR&ED metadata rows, missing science code callouts, section headings, bullet
 * and numbered lists, and body paragraphs without dropping real document
 * content. Non-PD categories (transcripts, supporting files, company files)
 * keep plain cleaned paragraphs and lists without applying SR&ED heuristics.
 */

export type AiReadMetadataRow = {
  label: string;
  value: string;
};

export type AiReadBlock =
  | { kind: "metadata"; rows: AiReadMetadataRow[] }
  | { kind: "callout"; label: string; value: string; tone: "amber" }
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: string[]; ordered?: boolean; start?: number };

export type AiReadDocument = {
  blocks: AiReadBlock[];
  hasScienceCodeField: boolean;
};

const PD_CATEGORIES = new Set(["final_pd", "draft", "review_copy"]);

const KNOWN_HEADINGS = new Set([
  "project description",
  "uncertainty",
  "technological uncertainty",
  "scientific or technological uncertainty",
  "scientific uncertainty",
  "work done",
  "work performed",
  "work",
  "advancement",
  "technological advancement",
  "scientific or technological advancement",
  "scientific advancement",
  "records kept",
  "supporting documentation",
  "supporting records",
  "contemporaneous documentation",
  "documentation",
  "key individuals",
  "key personnel",
  "project overview",
  "overview",
  "background",
  "objective",
  "objectives",
  "methodology",
  "approach",
  "results",
  "conclusion",
  "conclusions",
  "summary",
  "section b",
  "section c",
  "project details",
  "project information",
]);

const KNOWN_METADATA_KEYS = [
  /^project\s+start(?:\s+date)?$/i,
  /^project\s+end(?:\s+date)?$/i,
  /^start\s+date$/i,
  /^end\s+date$/i,
  /^completion\s+date$/i,
  /^sites?$/i,
  /^locations?$/i,
  /^field\s+of\s+science(?:\s+or\s+technology)?(?:\s+code)?$/i,
  /^science\s+code$/i,
  /^fiscal\s+year(?:\s+end)?$/i,
  /^tax\s+year$/i,
  /^project\s+(?:title|name|code|number|id)$/i,
  /^claimant(?:\s+name)?$/i,
  /^company(?:\s+name)?$/i,
  /^client(?:\s+name)?$/i,
  /^prepared\s+by$/i,
  /^author$/i,
  /^writer$/i,
  /^reviewer$/i,
  /^line\s+20[0246]$/i,
  /^line\s+240$/i,
];

const PRESERVED_ACRONYMS = new Set([
  "SR&ED",
  "CRA",
  "T661",
  "PD",
  "API",
  "APIS",
  "CNC",
  "CAD",
  "CAM",
  "AI",
  "ML",
  "NLP",
  "UI",
  "UX",
  "SQL",
  "HTTP",
  "HTTPS",
  "JSON",
  "PDF",
  "CSV",
  "QA",
  "R&D",
  "HVAC",
  "PLC",
  "ERP",
  "CRM",
  "SDK",
  "CLI",
  "GPU",
  "CPU",
  "IOT",
  "RFID",
  "OCR",
  "LED",
  "PCB",
  "2D",
  "3D",
]);

const SCIENCE_CODE_LABEL = /^(?:field\s+of\s+science(?:\s+or\s+technology)?(?:\s+code)?|science\s+code|line\s+206)$/i;
const MISSING_VALUE = /^(?:to\s+be\s+added|tbd|tba|missing|pending|unknown|none|n\/a|-+|_+|\?+)$/i;
const PAGE_WORD_MARKER = /^(?:(?:page|p\.)\s+\d+(?:\s*(?:of|\/)\s*\d+)?|[-*\u2013\u2014]\s*\d{1,3}\s*[-*\u2013\u2014])$/i;
const MARKDOWN_TABLE_DIVIDER = /^\|?(?:\s*:?-{2,}:?\s*\|)+\s*:?-{2,}:?\s*\|?$/;
const INLINE_SECTION_LEAD =
  /^(Line\s+24[2468]|Uncertainty|Technological uncertainty|Work done|Work performed|Advancement|Technological advancement|Records kept|Supporting documentation)\s*(?::|-|\u2013|\u2014)\s+(.+)$/i;
const UNORDERED_BULLET_LINE = /^[-*\u2022\u25AA\u25E6\u2023]\s+(.+)$/;
const ORDERED_ITEM_LINE = /^(\d+)[.)]\s+(.+)$/;
const MARKDOWN_HEADING = /^#{1,6}\s+(.+?)\s*#*$/;
const NUMBERED_HEADING = /^(\d+(?:\.\d+)?)[.)]\s+(.+)$/;
const TIMESTAMP_PREFIX = /^\d{1,2}:\d{2}(?::\d{2})?\b/;
const KNOWN_FILE_EXT =
  /\.(?:docx?|pdf|xlsx?|csv|msg|eml|txt|md|rtf|pptx?|png|jpe?g|gif|webp|zip|json|xml|html?)$/i;

function normalizeSpaces(value: string): string {
  return value.replace(/[\u00A0\u200B\uFEFF]/g, " ").replace(/[ \t]+/g, " ").trim();
}

function stripInlineMarkdown(value: string): string {
  return value
    .replace(/\*\*([^\s*](?:[^*]*[^\s*])?)\*\*/g, "$1")
    .replace(/(^|[\s(])__([^\s_][^_\n]*\s+[^_\n]*[^\s_])__(?=$|[\s).,;:])/g, "$1$2")
    .replace(/(^|[\s(])\*([^\s*\n](?:[^*\n]*[^\s*\n])?)\*(?=$|[\s).,;:])/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1");
}

function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/^(?:pd|project)\s*\d+[a-z]?\s*[-:.]?\s*/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function formatAllCapsHeading(value: string): string {
  const isAllCaps = value === value.toUpperCase() && /[A-Z]{2}/.test(value);
  if (!isAllCaps) return value;
  const words = value.split(/\s+/);
  return words
    .map((word, index) => {
      const stripped = word.replace(/^[^A-Z0-9&]+|[^A-Z0-9&]+$/g, "");
      if (stripped && PRESERVED_ACRONYMS.has(stripped)) return word;
      if (index === 0) return word.charAt(0) + word.slice(1).toLowerCase();
      return word.toLowerCase();
    })
    .join(" ");
}

function isPageMarker(trimmed: string): boolean {
  return PAGE_WORD_MARKER.test(trimmed);
}

function isKnownMetadataKey(label: string): boolean {
  const clean = normalizeSpaces(label);
  return KNOWN_METADATA_KEYS.some((pattern) => pattern.test(clean));
}

function parseMetadataLine(rawLine: string, allowLoose: boolean): AiReadMetadataRow | null {
  // Never treat timestamps ("00:01:15 Dana: ...") or URLs ("https://...") as metadata.
  if (TIMESTAMP_PREFIX.test(rawLine) || /https?:\/\//i.test(rawLine)) return null;

  // Markdown 2-column table row: | Key | Value |
  if (rawLine.startsWith("|") && rawLine.endsWith("|")) {
    const cells = rawLine
      .slice(1, -1)
      .split("|")
      .map((cell) => normalizeSpaces(stripInlineMarkdown(cell)));
    if (cells.length === 2 && cells[0].length > 0 && cells[0].length <= 56 && cells[1].length <= 160) {
      if (isKnownMetadataKey(cells[0]) || (allowLoose && cells[0].split(" ").length <= 5 && !/[.!?]$/.test(cells[0]))) {
        return { label: cells[0], value: cells[1] };
      }
    }
    return null;
  }

  // Tab-separated pair from Word tables (mammoth extractRawText)
  if (rawLine.includes("\t")) {
    const parts = rawLine
      .split(/\t+/)
      .map((part) => normalizeSpaces(stripInlineMarkdown(part)))
      .filter(Boolean);
    if (parts.length === 2 && parts[0].length <= 56 && parts[1].length <= 160) {
      const key = parts[0].replace(/:$/, "");
      if (isKnownMetadataKey(key) || (allowLoose && key.split(" ").length <= 5 && !/[.!?]$/.test(key))) {
        return { label: key, value: parts[1] };
      }
    }
    return null;
  }

  // Colon-separated key: value
  const colonIdx = rawLine.indexOf(":");
  if (colonIdx <= 0 || colonIdx > 56) return null;
  if (rawLine.slice(colonIdx, colonIdx + 3) === "://") return null;
  const label = normalizeSpaces(stripInlineMarkdown(rawLine.slice(0, colonIdx)));
  const value = normalizeSpaces(stripInlineMarkdown(rawLine.slice(colonIdx + 1)));
  if (!label || !value) return null;
  if (INLINE_SECTION_LEAD.test(rawLine)) return null;
  if (value.length > 140) return null;
  if (isKnownMetadataKey(label)) return { label, value };
  if (
    allowLoose &&
    label.split(" ").length <= 4 &&
    !/[.!?]/.test(label) &&
    !/^\d+$/.test(label) &&
    value.length <= 72 &&
    !/[.!?](?:\s|$)/.test(value)
  ) {
    return { label, value };
  }
  return null;
}

function nearestContentLine(rawLines: string[], index: number, dir: -1 | 1): string | null {
  for (let i = index + dir; i >= 0 && i < rawLines.length; i += dir) {
    const t = rawLines[i].trim();
    if (!t || isPageMarker(t)) continue;
    return t;
  }
  return null;
}

function isPartOfOrderedList(rawLines: string[], index: number): boolean {
  const current = rawLines[index]?.trim().match(ORDERED_ITEM_LINE);
  if (!current) return false;
  const currentNum = Number.parseInt(current[1], 10);
  const prevLine = nearestContentLine(rawLines, index, -1);
  const prev = prevLine?.match(ORDERED_ITEM_LINE);
  if (prev && Number.parseInt(prev[1], 10) === currentNum - 1) return true;
  const nextLine = nearestContentLine(rawLines, index, 1);
  const next = nextLine?.match(ORDERED_ITEM_LINE);
  if (next && Number.parseInt(next[1], 10) === currentNum + 1) return true;
  return false;
}

function parseHeadingLine(
  rawLine: string,
  nextLine: string | null,
  partOfOrderedList: boolean
): string | null {
  const md = rawLine.match(MARKDOWN_HEADING);
  if (md) return formatAllCapsHeading(normalizeSpaces(stripInlineMarkdown(md[1])).replace(/:$/, ""));

  const clean = normalizeSpaces(stripInlineMarkdown(rawLine));
  if (!clean) return null;

  const withoutTrailingColon = clean.replace(/:$/, "").trim();

  // CRA narrative line header: allow full CRA prompts (Line 244 is ~190 chars) before the 90-char cap,
  // while keeping ordinary prose sentences ("Line 242 was revised in May.") as paragraphs.
  if (
    /^Line\s+24[2468](?:$|[:\-\u2013\u2014]|\s+[:\-\u2013\u2014]|\s+What\b)/i.test(clean) &&
    (clean.length <= 90 || clean.endsWith("?")) &&
    clean.length <= 260
  ) {
    return withoutTrailingColon;
  }

  if (clean.length > 90) return null;

  if (KNOWN_HEADINGS.has(withoutTrailingColon.toLowerCase())) {
    return formatAllCapsHeading(withoutTrailingColon);
  }

  // Numbered short heading: "1. Uncertainty", "2. Work done" (never steal items from a numbered list)
  const numbered = clean.match(NUMBERED_HEADING);
  if (numbered) {
    const inner = numbered[2].replace(/:$/, "").trim();
    if (KNOWN_HEADINGS.has(inner.toLowerCase())) return formatAllCapsHeading(inner);
    if (
      !partOfOrderedList &&
      inner.length <= 56 &&
      !/[.!?]$/.test(inner) &&
      nextLine !== null &&
      !ORDERED_ITEM_LINE.test(nextLine) &&
      nextLine.length > inner.length
    ) {
      return formatAllCapsHeading(inner);
    }
    return null;
  }

  // Short standalone title line followed by a body paragraph (not a sentence, not a metadata pair)
  if (
    clean.length <= 56 &&
    clean.split(" ").length <= 7 &&
    !/[.!?;,]$/.test(clean) &&
    /^[A-Z]/.test(clean) &&
    nextLine !== null &&
    nextLine.length > 0 &&
    !parseMetadataLine(rawLine, false) &&
    !UNORDERED_BULLET_LINE.test(clean) &&
    !ORDERED_ITEM_LINE.test(clean)
  ) {
    const isAllCaps = clean === clean.toUpperCase() && /[A-Z]{3}/.test(clean);
    if (isAllCaps) return formatAllCapsHeading(clean);
    if (nextLine.length >= 45) return withoutTrailingColon;
  }

  return null;
}

/**
 * Formats raw extracted text into clean editorial blocks for "What AI read".
 */
export function formatAiReadDocument(
  rawText: string,
  options?: { documentTitle?: string; category?: string }
): AiReadDocument {
  const normalized = rawText.replace(/\r\n?/g, "\n").replace(/\f/g, "\n\n").trim();
  if (!normalized) return { blocks: [], hasScienceCodeField: false };

  // Default to SR&ED PD formatting when category is omitted; keep non-PD docs (transcripts,
  // supporting files, company files) as clean paragraphs and lists without SR&ED heuristics.
  const isPd = options?.category === undefined || PD_CATEGORIES.has(options.category);

  const rawLines = normalized.split("\n");
  const blocks: AiReadBlock[] = [];
  let hasScienceCodeField = false;

  const titleKey = options?.documentTitle ? normalizeForMatch(options.documentTitle) : "";
  let skippedLeadingTitle = false;
  let seenBodyContent = false;

  const pushMetadata = (row: AiReadMetadataRow) => {
    if (SCIENCE_CODE_LABEL.test(row.label)) {
      hasScienceCodeField = true;
      if (MISSING_VALUE.test(row.value)) {
        blocks.push({ kind: "callout", label: row.label, value: row.value, tone: "amber" });
        return;
      }
    }
    const prev = blocks[blocks.length - 1];
    if (prev && prev.kind === "metadata") {
      prev.rows.push(row);
    } else {
      blocks.push({ kind: "metadata", rows: [row] });
    }
  };

  let paragraphLines: string[] = [];
  let listItems: string[] = [];
  let listOrdered = false;
  let listStart: number | null = null;

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return;
    const text = normalizeSpaces(paragraphLines.join(" "));
    paragraphLines = [];
    if (text) {
      blocks.push({ kind: "paragraph", text });
      seenBodyContent = true;
    }
  };

  const flushList = () => {
    if (listItems.length === 0) return;
    if (listOrdered) {
      const start = listStart !== null && listStart > 1 ? listStart : undefined;
      blocks.push(start ? { kind: "list", items: listItems, ordered: true, start } : { kind: "list", items: listItems, ordered: true });
    } else {
      blocks.push({ kind: "list", items: listItems });
    }
    listItems = [];
    listOrdered = false;
    listStart = null;
    seenBodyContent = true;
  };

  const nextContinuesOrderedList = (index: number): boolean => {
    if (!listOrdered || listStart === null || listItems.length === 0) return false;
    const nextLine = nearestContentLine(rawLines, index, 1);
    const nextMatch = nextLine?.match(ORDERED_ITEM_LINE);
    return Boolean(nextMatch && Number.parseInt(nextMatch[1], 10) === listStart + listItems.length);
  };

  for (let i = 0; i < rawLines.length; i++) {
    const rawLine = rawLines[i];
    const trimmed = rawLine.trim();

    if (!trimmed) {
      flushParagraph();
      if (!nextContinuesOrderedList(i)) flushList();
      continue;
    }

    if (MARKDOWN_TABLE_DIVIDER.test(trimmed) || isPageMarker(trimmed)) {
      flushParagraph();
      if (!nextContinuesOrderedList(i)) flushList();
      continue;
    }

    if (!skippedLeadingTitle && blocks.length === 0 && paragraphLines.length === 0 && titleKey) {
      const candidate = normalizeForMatch(stripInlineMarkdown(trimmed.replace(/^#{1,6}\s+/, "")));
      if (candidate && candidate === titleKey) {
        skippedLeadingTitle = true;
        continue;
      }
    }

    let nextNonEmpty: string | null = null;
    for (let j = i + 1; j < rawLines.length; j++) {
      const candidate = rawLines[j].trim();
      if (candidate) {
        nextNonEmpty = candidate;
        break;
      }
    }

    if (isPd) {
      // Inline "Line 242: ..." or "Line 242 - What scientific...?"
      const inlineLead = trimmed.match(INLINE_SECTION_LEAD);
      if (inlineLead && paragraphLines.length === 0) {
        flushList();
        const leadLabel = normalizeSpaces(inlineLead[1]);
        const rest = normalizeSpaces(stripInlineMarkdown(inlineLead[2]));
        // If a CRA Line 242/244/246/248 line is the CRA question prompt itself, keep it
        // as a heading so the following answer paragraph is not merged onto the question.
        if (/^Line\s+24[2468]$/i.test(leadLabel) && rest.endsWith("?") && trimmed.length <= 260) {
          blocks.push({ kind: "heading", text: `${leadLabel} - ${rest}` });
        } else {
          blocks.push({ kind: "heading", text: formatAllCapsHeading(leadLabel) });
          paragraphLines.push(rest);
        }
        seenBodyContent = true;
        continue;
      }

      // Key-value metadata row (known keys anywhere at block start; loose pairs only before body text)
      if (paragraphLines.length === 0 && listItems.length === 0) {
        const meta = parseMetadataLine(trimmed, !seenBodyContent);
        if (meta) {
          pushMetadata(meta);
          continue;
        }
      }
    }

    // Unordered bullet item (always ends an active paragraph)
    const unordered = trimmed.match(UNORDERED_BULLET_LINE);
    if (unordered) {
      flushParagraph();
      if (listItems.length > 0 && listOrdered) flushList();
      listOrdered = false;
      listStart = null;
      listItems.push(normalizeSpaces(stripInlineMarkdown(unordered[1])));
      continue;
    }

    // Ordered numbered list item vs numbered section heading
    const ordered = trimmed.match(ORDERED_ITEM_LINE);
    if (ordered) {
      const itemNum = Number.parseInt(ordered[1], 10);
      const partOfList = listOrdered || isPartOfOrderedList(rawLines, i);
      const heading = isPd && !partOfList ? parseHeadingLine(trimmed, nextNonEmpty, false) : null;
      if (heading) {
        flushParagraph();
        flushList();
        blocks.push({ kind: "heading", text: heading });
        seenBodyContent = true;
        continue;
      }
      flushParagraph();
      if (listItems.length > 0 && !listOrdered) flushList();
      if (listItems.length > 0 && listOrdered && listStart !== null && itemNum !== listStart + listItems.length) {
        flushList();
      }
      if (listItems.length === 0) listStart = itemNum;
      listOrdered = true;
      listItems.push(normalizeSpaces(stripInlineMarkdown(ordered[2])));
      continue;
    }

    // Section heading (PD documents only, at block start)
    if (isPd && paragraphLines.length === 0) {
      const heading = parseHeadingLine(trimmed, nextNonEmpty, false);
      if (heading) {
        flushList();
        blocks.push({ kind: "heading", text: heading });
        seenBodyContent = true;
        continue;
      }
    }

    // Regular prose line: join into the active paragraph
    flushList();
    paragraphLines.push(stripInlineMarkdown(trimmed));
  }

  flushParagraph();
  flushList();

  return { blocks, hasScienceCodeField };
}

/**
 * Formats the document subtitle shown under the title inside the "What AI read"
 * paper sheet (Paper Files 7: "Cedarline Systems. SR&ED project description.").
 */
export function documentSheetSubtitle(category: string, clientName?: string | null): string {
  const company = clientName?.trim();
  const descriptor =
    category === "final_pd" || category === "draft" || category === "review_copy"
      ? "SR&ED project description."
      : category === "transcript"
        ? "Interview transcript."
        : category === "supporting"
          ? "Supporting document."
          : category === "company_file"
            ? "Company file."
            : "Document.";
  return company ? `${company}. ${descriptor}` : descriptor;
}

/**
 * Formats a file's folder path cleanly with spaced slashes
 * (Paper Files 7: "Cedarline Systems / 2025 - Mar 31 / Submitted").
 * Handles both forward and backslashes, leading slashes, and null/undefined
 * paths; drops the trailing segment when it matches `fileName` or ends with a
 * known document/media file extension (so folders like "Rev 2.10" are kept).
 */
export function formatFolderPath(path: string | null | undefined, fileName?: string | null): string {
  if (!path) return "";
  const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (!normalized) return "";
  const segments = normalized
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length === 0) return "";
  const last = segments[segments.length - 1];
  const isTrailingFile =
    (fileName ? last.toLowerCase() === fileName.trim().toLowerCase() : false) || KNOWN_FILE_EXT.test(last);
  const folderSegments = isTrailingFile ? segments.slice(0, -1) : segments;
  return folderSegments.join(" / ");
}
