/**
 * Finds the three CRA project-description Sections (Lines 242, 244 and 246)
 * in text extracted from a written PD: a previous-year report on New project
 * (E1 card meta, E3 "What we found") and the PD a review reads (E4).
 *
 * Pure and framework-free. The text comes from the browser parsers, so a PDF
 * page arrives as one run of words (pdf.js joins a page's items with spaces)
 * while Word and text files keep their line breaks. A heading is therefore
 * found by what it says, not only by where it sits on a line:
 *
 * - "Line 242", "Section 244", "Box 246", or the bare number, followed by the
 *   Section's CRA heading or question ("242 Technological uncertainty",
 *   "| 244 | Work performed |" in a table);
 * - "Line 242" (or "Section 242") ending a line or followed by a colon;
 * - the CRA question on its own ("What work did you perform ...");
 * - a bare "242", "242." or "242:" alone on its line.
 *
 * A number in prose ("242 samples were tested", "as Line 242 explains") is not
 * a heading unless nothing better exists for that Section. Sections are read
 * in form order, so each heading is looked for after the one before it.
 */

export type PdSectionKey = "s242" | "s244" | "s246";

export type DetectedPdSection = {
  section: PdSectionKey;
  number: "242" | "244" | "246";
  title: string;
  /** Offset of the heading. */
  start: number;
  /** Offset where the Section's own text starts (after the heading). */
  bodyStart: number;
  /** Offset where the next Section's heading starts, or the text's end. */
  end: number;
  /** 1-based pages, when page offsets were given. */
  pageStart?: number;
  pageEnd?: number;
};

const SECTIONS: ReadonlyArray<{
  section: PdSectionKey;
  number: "242" | "244" | "246";
  title: string;
  heading: string;
  question: string;
}> = [
  {
    section: "s242",
    number: "242",
    title: "Technological uncertainty",
    heading: "(?:scientific\\s+or\\s+)?technological\\s+uncertaint(?:y|ies)",
    question:
      "what\\s+scientific\\s+or\\s+technological\\s+uncertaint(?:y|ies)\\s+did\\s+you\\s+attempt\\s+to\\s+overcome",
  },
  {
    section: "s244",
    number: "244",
    title: "Work performed",
    heading: "(?:work\\s+performed|work\\s+done)",
    question: "what\\s+work\\s+did\\s+you\\s+perform",
  },
  {
    section: "s246",
    number: "246",
    title: "Technological advancement",
    heading: "(?:scientific\\s+or\\s+)?technological\\s+advancements?",
    question:
      "what\\s+scientific\\s+or\\s+technological\\s+advancements?\\s+did\\s+you\\s+achieve",
  },
];

type Candidate = { start: number; bodyStart: number; score: number };

/** Separators allowed between a number and its heading words, table cells included. */
const SEP = "[\\s:.)\\]\\-|]*";

function candidatesFor(text: string, spec: (typeof SECTIONS)[number]): Candidate[] {
  const out: Candidate[] = [];
  const push = (re: RegExp, score: number, bodyAtEnd = true) => {
    for (const match of text.matchAll(re)) {
      const start = match.index ?? 0;
      out.push({
        start,
        bodyStart: bodyAtEnd ? start + match[0].length : start,
        score,
      });
    }
  };
  const n = spec.number;
  // Number (with or without "Line") then the heading or the question.
  push(
    new RegExp(
      `(?:\\b(?:line|section|box)\\s*)?\\b${n}\\b${SEP}(?:${spec.question}\\s*\\??|${spec.heading})${SEP}`,
      "gi"
    ),
    4
  );
  // "Line 242" closing its line or followed by a colon.
  push(new RegExp(`\\b(?:line|section|box)\\s*${n}\\b\\s*(?::|$)[ \\t]*`, "gim"), 3);
  // The question on its own.
  push(new RegExp(`${spec.question}\\s*\\??`, "gi"), 3);
  // A bare number alone on its line.
  push(new RegExp(`^[ \\t|]*${n}[ \\t]*[.:)]?[ \\t|]*$`, "gm"), 2);
  // "Line 242" anywhere: a heading only when nothing better exists.
  push(new RegExp(`\\b(?:line|section|box)\\s*${n}\\b${SEP}`, "gi"), 1);
  return out;
}

/** Page (1-based) that holds `offset`, from each page's start offset. */
export function pageForOffset(offset: number, pageOffsets: readonly number[]): number {
  let page = 1;
  for (let index = 0; index < pageOffsets.length; index += 1) {
    if (pageOffsets[index] <= offset) page = index + 1;
    else break;
  }
  return page;
}

/** "Page 2" or "Pages 4 to 9". */
export function pageRangeLabel(pageStart: number, pageEnd: number): string {
  return pageStart === pageEnd ? `Page ${pageStart}` : `Pages ${pageStart} to ${pageEnd}`;
}

export function detectPdSections(
  text: string,
  pageOffsets?: readonly number[]
): DetectedPdSection[] {
  const found: Array<Omit<DetectedPdSection, "end">> = [];
  let floor = 0;
  for (const spec of SECTIONS) {
    const candidates = candidatesFor(text, spec).filter((c) => c.start >= floor);
    if (candidates.length === 0) continue;
    const best = Math.max(...candidates.map((c) => c.score));
    const pick = candidates
      .filter((c) => c.score === best)
      .sort((a, b) => a.start - b.start)[0];
    found.push({
      section: spec.section,
      number: spec.number,
      title: spec.title,
      start: pick.start,
      bodyStart: Math.min(pick.bodyStart, text.length),
    });
    floor = pick.bodyStart;
  }
  return found.map((section, index) => {
    const end = found[index + 1]?.start ?? text.length;
    const withEnd: DetectedPdSection = { ...section, end };
    if (pageOffsets && pageOffsets.length > 0) {
      withEnd.pageStart = pageForOffset(section.start, pageOffsets);
      withEnd.pageEnd = pageForOffset(Math.max(section.start, end - 1), pageOffsets);
    }
    return withEnd;
  });
}

/** The Section's own text, without its heading. */
export function detectedSectionText(text: string, section: DetectedPdSection): string {
  return text.slice(section.bodyStart, section.end).trim();
}

/** "3 sections found", "1 section found", or null when none was found. */
export function sectionsFoundLabel(count: number): string | null {
  if (count === 0) return null;
  return `${count} section${count === 1 ? "" : "s"} found`;
}
