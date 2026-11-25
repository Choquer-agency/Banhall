/**
 * Formats raw extracted document text ("What AI read") into clean, structured
 * editorial blocks for the Import file preview sheet (Paper Files 7).
 *
 * Pure and deterministic: cleans PDF/Word extraction noise (hard line wraps,
 * stray page footers, markdown markers, redundant spacing) and recognizes
 * SR&ED metadata rows, missing science code callouts, section headings, bullet
 * lists, and body paragraphs without dropping real document content.
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
  | { kind: "list"; items: string[] };

export type AiReadDocument = {
  blocks: AiReadBlock[];
  hasScienceCodeField: boolean;
};

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

const SCIENCE_CODE_LABEL = /^(?:field\s+of\s+science(?:\s+or\s+technology)?(?:\s+code)?|science\s+code|line\s+206)$/i;
const MISSING_VALUE = /^(?:to\s+be\s+added|tbd|tba|missing|pending|unknown|none|n\/a|-+|_+|\?+)$/i;
const PAGE_MARKER = /^(?:page\s+\d+(?:\s+of\s+\d+)?|[-*]\s*\d+\s*[-*]|\d+\s*\/\s*\d+)$/i;
const MARKDOWN_TABLE_DIVIDER = /^\|?(?:\s*:?-{2,}:?\s*\|)+\s*:?-{2,}:?\s*\|?$/;
const INLINE_SECTION_LEAD =
  /^(Line\s+24[2468]|Uncertainty|Technological uncertainty|Work done|Work performed|Advancement|Technological advancement|Records kept|Supporting documentation)\s*(?::|-)\s+(.+)$/i;
const BULLET_LINE = /^(?:[-*•▪◦‣]|\d+[.)])\s+(.+)$/;
const MARKDOWN_HEADING = /^#{1,6}\s+(.+?)\s*#*$/;
const NUMBERED_HEADING = /^\d+(?:\.\d+)?[.)]\s+(.+)$/;

function normalizeSpaces(value: string): string {
  return value.replace(/[\u00A0\u200B\uFEFF]/g, " ").replace(/[ \t]+/g, " ").trim();
}

function stripInlineMarkdown(value: string): string {
  return value
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,;:])/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1");
}

function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/^(?:pd|project)\s*\d+[a-z]?\s*[-:.]?\s*/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isKnownMetadataKey(label: string): boolean {
  const clean = normalizeSpaces(label);
  return KNOWN_METADATA_KEYS.some((pattern) => pattern.test(clean));
}

function parseMetadataLine(rawLine: string): AiReadMetadataRow | null {
  // Markdown 2-column table row: | Key | Value |
  if (rawLine.startsWith("|") && rawLine.endsWith("|")) {
    const cells = rawLine
      .slice(1, -1)
      .split("|")
      .map((cell) => normalizeSpaces(stripInlineMarkdown(cell)));
    if (cells.length === 2 && cells[0].length > 0 && cells[0].length <= 56 && cells[1].length <= 160) {
      if (isKnownMetadataKey(cells[0]) || (cells[0].split(" ").length <= 5 && !/[.!?]$/.test(cells[0]))) {
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
      if (isKnownMetadataKey(parts[0]) || (parts[0].split(" ").length <= 5 && !/[.!?]$/.test(parts[0]))) {
        return { label: parts[0].replace(/:$/, ""), value: parts[1] };
      }
    }
    return null;
  }

  // Colon-separated key: value
  const colonIdx = rawLine.indexOf(":");
  if (colonIdx <= 0 || colonIdx > 56) return null;
  const label = normalizeSpaces(stripInlineMarkdown(rawLine.slice(0, colonIdx)));
  const value = normalizeSpaces(stripInlineMarkdown(rawLine.slice(colonIdx + 1)));
  if (!label || !value) return null;
  if (INLINE_SECTION_LEAD.test(rawLine)) return null;
  if (value.length > 140) return null;
  if (isKnownMetadataKey(label)) return { label, value };
  // Allow short non-sentence labels with short non-narrative values
  if (label.split(" ").length <= 4 && !/[.!?]/.test(label) && value.length <= 72 && !/[.!?]\s+[A-Z]/.test(value)) {
    return { label, value };
  }
  return null;
}

function parseHeadingLine(rawLine: string, nextLine: string | null): string | null {
  const md = rawLine.match(MARKDOWN_HEADING);
  if (md) return normalizeSpaces(stripInlineMarkdown(md[1])).replace(/:$/, "");

  const clean = normalizeSpaces(stripInlineMarkdown(rawLine));
  if (!clean || clean.length > 90) return null;

  const withoutTrailingColon = clean.replace(/:$/, "").trim();
  if (KNOWN_HEADINGS.has(withoutTrailingColon.toLowerCase())) {
    return withoutTrailingColon;
  }

  // CRA narrative line header: "Line 242 - What scientific..."
  if (/^Line\s+24[2468]\b/i.test(clean) && clean.length <= 120) {
    return withoutTrailingColon;
  }

  // Numbered short heading: "1. Uncertainty", "2. Work done"
  const numbered = clean.match(NUMBERED_HEADING);
  if (numbered) {
    const inner = numbered[1].replace(/:$/, "").trim();
    if (KNOWN_HEADINGS.has(inner.toLowerCase())) return inner;
    if (inner.length <= 56 && !/[.!?]$/.test(inner) && (nextLine === null || nextLine.length > inner.length)) {
      return inner;
    }
  }

  // Short standalone title line followed by a body paragraph (not a sentence, not a metadata pair)
  if (
    clean.length <= 56 &&
    clean.split(" ").length <= 7 &&
    !/[.!?;,]$/.test(clean) &&
    /^[A-Z]/.test(clean) &&
    nextLine !== null &&
    nextLine.length > 0 &&
    !parseMetadataLine(rawLine)
  ) {
    // Require either ALL CAPS or Title-style leading line followed by longer prose
    const isAllCaps = clean === clean.toUpperCase() && /[A-Z]{3}/.test(clean);
    if (isAllCaps) {
      return clean.charAt(0) + clean.slice(1).toLowerCase();
    }
    if (nextLine.length >= 45 && !BULLET_LINE.test(clean)) {
      return withoutTrailingColon;
    }
  }

  return null;
}

/**
 * Formats raw extracted text into clean editorial blocks for "What AI read".
 */
export function formatAiReadDocument(rawText: string, options?: { documentTitle?: string }): AiReadDocument {
  const normalized = rawText.replace(/\r\n?/g, "\n").replace(/\f/g, "\n\n").trim();
  if (!normalized) return { blocks: [], hasScienceCodeField: false };

  const rawLines = normalized.split("\n");
  const blocks: AiReadBlock[] = [];
  let hasScienceCodeField = false;

  const titleKey = options?.documentTitle ? normalizeForMatch(options.documentTitle) : "";
  let skippedLeadingTitle = false;

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

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return;
    const text = normalizeSpaces(paragraphLines.join(" "));
    paragraphLines = [];
    if (text) blocks.push({ kind: "paragraph", text });
  };

  const flushList = () => {
    if (listItems.length === 0) return;
    blocks.push({ kind: "list", items: listItems });
    listItems = [];
  };

  for (let i = 0; i < rawLines.length; i++) {
    const rawLine = rawLines[i];
    const trimmed = rawLine.trim();

    // Blank line ends current paragraph or list
    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    // Drop standalone page markers and markdown table divider rows
    if (PAGE_MARKER.test(trimmed) || MARKDOWN_TABLE_DIVIDER.test(trimmed)) {
      flushParagraph();
      flushList();
      continue;
    }

    // Skip a duplicate document title right at the very top of the text
    if (!skippedLeadingTitle && blocks.length === 0 && paragraphLines.length === 0 && titleKey) {
      const candidate = normalizeForMatch(stripInlineMarkdown(trimmed.replace(/^#{1,6}\s+/, "")));
      if (candidate && candidate === titleKey) {
        skippedLeadingTitle = true;
        continue;
      }
    }

    // Look ahead to the next non-empty line for heading heuristics
    let nextNonEmpty: string | null = null;
    for (let j = i + 1; j < rawLines.length; j++) {
      const candidate = rawLines[j].trim();
      if (candidate) {
        nextNonEmpty = candidate;
        break;
      }
    }

    // Inline "Line 242: ..." or "Uncertainty: ..." -> heading + paragraph
    const inlineLead = trimmed.match(INLINE_SECTION_LEAD);
    if (inlineLead && paragraphLines.length === 0) {
      flushList();
      blocks.push({ kind: "heading", text: normalizeSpaces(inlineLead[1]) });
      paragraphLines.push(stripInlineMarkdown(inlineLead[2]));
      continue;
    }

    // Key-value metadata row (only when not mid-paragraph)
    if (paragraphLines.length === 0 && listItems.length === 0) {
      const meta = parseMetadataLine(trimmed);
      if (meta) {
        pushMetadata(meta);
        continue;
      }
    }

    // Bullet item
    const bullet = trimmed.match(BULLET_LINE);
    if (bullet && !parseHeadingLine(trimmed, nextNonEmpty)) {
      flushParagraph();
      listItems.push(normalizeSpaces(stripInlineMarkdown(bullet[1])));
      continue;
    }

    // Section heading (when starting a new block)
    if (paragraphLines.length === 0) {
      const heading = parseHeadingLine(trimmed, nextNonEmpty);
      if (heading) {
        flushList();
        blocks.push({ kind: "heading", text: heading });
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
          : category === "company_info"
            ? "Company information."
            : "Document.";
  return company ? `${company}. ${descriptor}` : descriptor;
}

/**
 * Formats a file's path into a clean folder path with spaced slashes
 * (Paper Files 7: "Cedarline Systems / 2025 - Mar 31 / Submitted").
 */
export function formatFolderPath(path: string | null | undefined): string {
  if (!path) return "";
  const segments = path
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length <= 1) return path;
  const last = segments[segments.length - 1];
  const folderSegments = /\.[a-z0-9]{2,5}$/i.test(last) ? segments.slice(0, -1) : segments;
  return folderSegments.join(" / ");
}
