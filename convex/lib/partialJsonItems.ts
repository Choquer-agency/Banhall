/**
 * Round 2 (F2, decision 57): the Step-by-step Brief streams its tool input,
 * and "Reading the interview" shows each entry as soon as the model has
 * written it. This scanner reads the growing JSON text of the tool input and
 * hands back every object that has just been completed inside one of the
 * watched top-level arrays (`storylineClaims`, `confidenceMap`,
 * `glossaryTerms`).
 *
 * It is a small tolerant state machine: each `push` scans only the new tail
 * (no `eval`, no re-parse of what was already read), tracks strings and
 * escapes, container depth, the current top-level key, and where the item
 * being written began. A completed item's text is parsed with `JSON.parse`;
 * one that does not parse is skipped. Shorter text than already read means
 * the stream restarted (a retried request), and the scanner starts over.
 */

export const WATCHED_ARRAYS = ["storylineClaims", "confidenceMap", "glossaryTerms"] as const;
export type WatchedArray = (typeof WATCHED_ARRAYS)[number];

export type PartialItem = { array: WatchedArray; index: number; value: unknown };

export class PartialJsonItems {
  #text = "";
  #pos = 0;
  #depth = 0;
  #inString = false;
  #escape = false;
  /** Text of the string being read at depth 1 (a top-level key). */
  #keyBuffer: string | null = null;
  #lastKey: string | null = null;
  #pendingKey: string | null = null;
  #array: WatchedArray | null = null;
  #itemStart = -1;
  #itemCounts: Record<WatchedArray, number> = { storylineClaims: 0, confidenceMap: 0, glossaryTerms: 0 };

  /** Reads the text so far; returns items completed since the last call. */
  push(snapshot: string): PartialItem[] {
    if (snapshot.length < this.#pos || !snapshot.startsWith(this.#text.slice(0, 16))) this.reset();
    this.#text = snapshot;
    const out: PartialItem[] = [];
    for (; this.#pos < snapshot.length; this.#pos += 1) {
      const ch = snapshot[this.#pos];
      if (this.#inString) {
        if (this.#escape) {
          this.#escape = false;
          if (this.#keyBuffer !== null) this.#keyBuffer += ch;
        } else if (ch === "\\") {
          this.#escape = true;
          if (this.#keyBuffer !== null) this.#keyBuffer += ch;
        } else if (ch === '"') {
          this.#inString = false;
          if (this.#keyBuffer !== null) {
            this.#lastKey = this.#keyBuffer;
            this.#keyBuffer = null;
          }
        } else if (this.#keyBuffer !== null) {
          this.#keyBuffer += ch;
        }
        continue;
      }
      switch (ch) {
        case '"':
          this.#inString = true;
          if (this.#depth === 1) this.#keyBuffer = "";
          break;
        case ":":
          if (this.#depth === 1) this.#pendingKey = this.#lastKey;
          break;
        case ",":
          if (this.#depth === 1) this.#pendingKey = null;
          break;
        case "{":
        case "[":
          if (this.#depth === 1 && ch === "[") {
            const key = this.#pendingKey;
            this.#array = key && (WATCHED_ARRAYS as readonly string[]).includes(key) ? (key as WatchedArray) : null;
          }
          if (this.#depth === 2 && this.#array && ch === "{") this.#itemStart = this.#pos;
          this.#depth += 1;
          break;
        case "}":
        case "]":
          this.#depth -= 1;
          if (this.#depth === 2 && this.#array && ch === "}" && this.#itemStart >= 0) {
            const raw = snapshot.slice(this.#itemStart, this.#pos + 1);
            this.#itemStart = -1;
            const index = this.#itemCounts[this.#array];
            this.#itemCounts[this.#array] = index + 1;
            try {
              out.push({ array: this.#array, index, value: JSON.parse(raw) });
            } catch {
              // A malformed item is skipped; the final answer is validated anyway.
            }
          }
          if (this.#depth === 1 && ch === "]") {
            this.#array = null;
            this.#pendingKey = null;
          }
          break;
        default:
          break;
      }
    }
    return out;
  }

  reset() {
    this.#text = "";
    this.#pos = 0;
    this.#depth = 0;
    this.#inString = false;
    this.#escape = false;
    this.#keyBuffer = null;
    this.#lastKey = null;
    this.#pendingKey = null;
    this.#array = null;
    this.#itemStart = -1;
    this.#itemCounts = { storylineClaims: 0, confidenceMap: 0, glossaryTerms: 0 };
  }
}
