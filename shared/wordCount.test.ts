import { describe, expect, it } from "vitest";
import { countTextWords } from "./wordCount";

describe("countTextWords", () => {
  it("counts runs of non-whitespace as a split on whitespace would", () => {
    for (const text of ["", "   ", "one", " two  words ", "tab\tand\nnew line", "a\u00a0b\u3000c", "Cold soak log: 400 cycles."]) {
      const expected = text.trim() ? text.trim().split(/\s+/).length : 0;
      expect(countTextWords(text)).toBe(expected);
    }
  });
});
