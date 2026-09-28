/**
 * Words in a text: runs of non-whitespace, counted in one pass without
 * splitting the text into an array (2026-09-27, fourth: listed file sizes).
 */
export function countTextWords(text: string): number {
  let words = 0;
  let inWord = false;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    const space =
      code === 32 || (code >= 9 && code <= 13) || code === 160 || code === 0x2028 || code === 0x2029 || code === 0xfeff ||
      (code >= 0x2000 && code <= 0x200a) || code === 0x1680 || code === 0x202f || code === 0x205f || code === 0x3000;
    if (space) inWord = false;
    else if (!inWord) {
      inWord = true;
      words += 1;
    }
  }
  return words;
}
