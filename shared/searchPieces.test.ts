/**
 * 2026-10-26 (Phase B4): search pieces cover a file's text exactly once,
 * near the target size, cut where the document's parts start.
 */
import { describe, expect, it } from "vitest";
import {
  checkedPageStarts,
  MAX_SEARCH_PIECES,
  SEARCH_PIECE_MAX_CHARS,
  SEARCH_PIECE_MIN_CHARS,
  searchTextOf,
  splitSearchPieces,
  type SearchPiece,
} from "./searchPieces";

function expectCovers(text: string, pieces: readonly SearchPiece[]) {
  expect(pieces[0]?.start ?? 0).toBe(0);
  expect(pieces.at(-1)?.end ?? 0).toBe(text.length);
  for (let i = 1; i < pieces.length; i++) expect(pieces[i]!.start).toBe(pieces[i - 1]!.end);
  for (const piece of pieces) {
    expect(piece.end).toBeGreaterThan(piece.start);
    expect(piece.end - piece.start).toBeLessThanOrEqual(SEARCH_PIECE_MAX_CHARS);
    // Never between the two halves of a surrogate pair.
    const before = text.charCodeAt(piece.end - 1);
    expect(before >= 0xd800 && before <= 0xdbff && piece.end < text.length).toBe(false);
  }
}

const paragraph = (n: number) =>
  `Trial ${n} ran the seal at a new pressure and recorded the leak rate each hour for the full shift. `.repeat(4).trim();

describe("splitSearchPieces", () => {
  it("returns nothing for empty text and one piece for short text", () => {
    expect(splitSearchPieces("")).toEqual([]);
    expect(splitSearchPieces("Short note.")).toEqual([{ start: 0, end: 11 }]);
  });

  it("covers a long text exactly, cutting at blank lines near the target", () => {
    const text = Array.from({ length: 60 }, (_, i) => paragraph(i)).join("\n\n");
    const pieces = splitSearchPieces(text);
    expectCovers(text, pieces);
    expect(pieces.length).toBeGreaterThanOrEqual(8);
    for (const piece of pieces.slice(0, -1)) {
      expect(piece.end - piece.start).toBeGreaterThanOrEqual(SEARCH_PIECE_MIN_CHARS);
      expect(text.slice(piece.end - 2, piece.end)).toBe("\n\n");
    }
  });

  it("cuts text with no breaks at the maximum, never inside a surrogate pair", () => {
    const text = "😀".repeat(5_000);
    const pieces = splitSearchPieces(text);
    expectCovers(text, pieces);
  });

  it("starts a piece at each PDF page and records the page", () => {
    const pages = Array.from({ length: 5 }, (_, i) => [0, 10, 20, 30].map((k) => paragraph(i + k)).join("\n\n"));
    const pageStarts: number[] = [];
    let text = "";
    for (const page of pages) {
      pageStarts.push(text.length);
      text += `${page}\n\n`;
    }
    text = text.trim();
    const pieces = splitSearchPieces(text, { kind: "pdf", pageStarts });
    expectCovers(text, pieces);
    expect(pieces.map((piece) => piece.page)).toEqual([1, 2, 3, 4, 5]);
    expect(pieces.map((piece) => piece.pageEnd)).toEqual([1, 2, 3, 4, 5]);
    expect(pieces.map((piece) => piece.start)).toEqual(pageStarts);
  });

  it("joins pages shorter than the minimum instead of making tiny pieces", () => {
    const pageStarts: number[] = [];
    let text = "";
    for (let i = 0; i < 20; i++) {
      pageStarts.push(text.length);
      text += `Page ${i + 1} has a short caption only.\n\n`;
    }
    const pieces = splitSearchPieces(text, { kind: "pdf", pageStarts });
    expectCovers(text, pieces);
    expect(pieces).toHaveLength(1);
    expect(pieces[0]).toMatchObject({ page: 1, pageEnd: 20 });
  });

  it("labels each sheet of a workbook", () => {
    const sheet = (name: string, rows: number) =>
      `## Sheet: ${name}\n${Array.from({ length: rows }, (_, i) => `R&D task ${i},${i * 3},hours`).join("\n")}`;
    const text = [sheet("Costs", 300), sheet("Hours", 300)].join("\n\n");
    const pieces = splitSearchPieces(text, { kind: "spreadsheet" });
    expectCovers(text, pieces);
    const hoursAt = text.indexOf("## Sheet: Hours");
    expect(pieces.some((piece) => piece.start === hoursAt)).toBe(true);
    expect(pieces[0]!.label).toBe("Sheet: Costs");
    expect(pieces.find((piece) => piece.start === hoursAt)!.label).toBe("Sheet: Hours");
    // A piece from the middle of a sheet is searched with the sheet's header row.
    const middle = pieces.find((piece) => piece.start > 0 && piece.start < hoursAt)!;
    expect(middle.header).toBe("R&D task 0,0,hours");
    const { searchText, prefixChars } = searchTextOf(text, middle);
    expect(searchText.startsWith("Sheet: Costs\nR&D task 0,0,hours\n")).toBe(true);
    expect(searchText.slice(prefixChars)).toBe(text.slice(middle.start, middle.end));
  });

  it("labels each message of a mailbox by its subject", () => {
    const message = (subject: string) =>
      `Subject: ${subject}\nFrom: Dana <dana@example.com>\n\n${paragraph(1)}\n\n${paragraph(2)}\n\n${paragraph(3)}`;
    // The separator the email readers write (shared/emailText.ts), quoted as data.
    const text = [message("Seal trial"), message("Second trial")].join("\n\n———\n\n");
    const pieces = splitSearchPieces(text, { kind: "email" });
    expectCovers(text, pieces);
    expect(pieces[0]!.label).toBe("Message 1: Seal trial");
    expect(pieces.some((piece) => piece.label === "Message 2: Second trial")).toBe(true);
  });

  it("starts a piece at a Word Markdown heading and labels it without its marks", () => {
    const intro = Array.from({ length: 3 }, (_, i) => paragraph(i)).join("\n\n");
    const body = Array.from({ length: 3 }, (_, i) => paragraph(i + 5)).join("\n\n");
    const text = `# Introduction\n\n${intro}\n\n## **Test** method\n\n${body}`;
    const pieces = splitSearchPieces(text, { kind: "markdown" });
    expectCovers(text, pieces);
    expect(pieces[0]!.label).toBe("Introduction");
    const method = pieces.find((piece) => piece.start === text.indexOf("## **Test** method"));
    expect(method?.label).toBe("Test method");
  });

  it("counts markers only in the kind of file that writes them", () => {
    const fake = `## Sheet: Fake\n${paragraph(1)}\n\n# Not a heading here\n\n${paragraph(2)}`;
    for (const piece of splitSearchPieces(fake, { kind: "text" })) expect(piece.label).toBeUndefined();
  });

  it("keeps a file under the piece cap by joining small parts", () => {
    const pageStarts: number[] = [];
    let text = "";
    for (let i = 0; i < 3_000; i++) {
      pageStarts.push(text.length);
      text += `${"x".repeat(820)}\n\n`;
    }
    const pieces = splitSearchPieces(text, { kind: "pdf", pageStarts });
    expectCovers(text, pieces);
    expect(pieces.length).toBeLessThanOrEqual(MAX_SEARCH_PIECES);
  });

  it("uses page starts only when they fit the text", () => {
    const text = "abc😀def";
    expect(checkedPageStarts(text, [0, 3])).toEqual([0, 3]);
    expect(checkedPageStarts(text, [0, 0, 3])).toEqual([0, 0, 3]);
    expect(checkedPageStarts(text, [0, 4])).toBeNull(); // inside the surrogate pair
    expect(checkedPageStarts(text, [3, 1])).toBeNull();
    expect(checkedPageStarts(text, [0, 99])).toBeNull();
    expect(checkedPageStarts(text, [0, 1.5])).toBeNull();
    expect(checkedPageStarts(text, "0,3")).toBeNull();
  });

  it("gives the same pieces every time", () => {
    const text = Array.from({ length: 30 }, (_, i) => paragraph(i)).join("\n");
    expect(splitSearchPieces(text)).toEqual(splitSearchPieces(text));
  });
});

describe("splitSearchPieces on random text", () => {
  /** A small deterministic generator, so a failure repeats. */
  function random(seed: number) {
    let state = seed;
    return () => {
      state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
      return state / 2_147_483_648;
    };
  }
  const alphabet = ["a", "b", " ", "\n", "\n\n", ".", "😀", "é", "\r\n", "## Sheet: X\n", "# H\n", "\n\n———\n\n", "\t"];

  it("always covers the text exactly, in bounds, never inside a surrogate pair, the same every time", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const next = random(seed);
      const length = Math.floor(next() * 12_000);
      let text = "";
      while (text.length < length) text += alphabet[Math.floor(next() * alphabet.length)];
      const kinds = ["pdf", "spreadsheet", "email", "markdown", "text"] as const;
      const kind = kinds[seed % kinds.length]!;
      const pageStarts = kind === "pdf" ? checkedPageStarts(text, [0, Math.floor(text.length / 3), Math.floor(text.length / 2)].map((at) => (/[\uDC00-\uDFFF]/.test(text[at] ?? "") ? at + 1 : at))) : null;
      const pieces = splitSearchPieces(text, { kind, ...(pageStarts ? { pageStarts } : {}) });
      expectCovers(text, pieces);
      expect(pieces.length).toBeLessThanOrEqual(MAX_SEARCH_PIECES);
      expect(splitSearchPieces(text, { kind, ...(pageStarts ? { pageStarts } : {}) })).toEqual(pieces);
    }
  });
});
