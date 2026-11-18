/**
 * 2026-11-18 (a company holds all its files, review P2-1): the words a
 * company file's name is searched by. Convex full text search matches
 * whole words and the start of the last word, so a name with no spaces,
 * such as "AcmeFY2021T661.pdf", is one word to it and "2021" or "t661"
 * would never find it. The name is split at anything that is not a letter
 * or a digit, then each piece again where letters meet digits and at
 * capital letters inside a word ("AcmeFY" gives acme and fy, "PDFFile"
 * gives pdf and file). Each whole piece is kept too, so a search for the
 * start of a whole piece still finds it. Lowercase, each word once, in the
 * order first seen, joined by spaces (`companyFiles.fileNameTerms`).
 */

/** Letters and digits, any script; everything else splits a name. */
const PIECES = /[\p{L}\p{N}]+/gu;
/**
 * Inside one piece: a run of capitals before a capital and a lower case
 * letter (PDF in PDFFile), a word that may start with a capital, a run of
 * capitals, or a run of digits.
 */
const PARTS = /\p{Lu}+(?=\p{Lu}\p{Ll})|\p{Lu}?\p{Ll}+|\p{Lu}+|\p{L}+|\p{N}+/gu;

/** The search words of a name: whole pieces and their parts, lowercase, each once. */
export function fileNameWords(name: string): string[] {
  const words: string[] = [];
  const seen = new Set<string>();
  const add = (word: string) => {
    const lower = word.toLowerCase();
    if (lower && !seen.has(lower)) {
      seen.add(lower);
      words.push(lower);
    }
  };
  for (const piece of name.normalize("NFC").match(PIECES) ?? []) {
    add(piece);
    for (const part of piece.match(PARTS) ?? []) add(part);
  }
  return words;
}

/** The stored search field: `fileNameWords` joined by spaces. */
export function fileNameTerms(name: string): string {
  return fileNameWords(name).join(" ");
}

/**
 * The words a search for `query` asks the server for: only the parts, so
 * "fy2021" asks for fy and 2021. At most `limit` words, keeping the last
 * (Convex matches the last one as the start of a word).
 */
export function searchQueryWords(query: string, limit = 16): string[] {
  const parts: string[] = [];
  const seen = new Set<string>();
  for (const piece of query.normalize("NFC").match(PIECES) ?? []) {
    for (const part of piece.match(PARTS) ?? []) {
      const lower = part.toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        parts.push(lower);
      }
    }
  }
  return parts.slice(-limit);
}
