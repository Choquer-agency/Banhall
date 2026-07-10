import { describe, expect, test } from "bun:test";
import {
  diffWords,
  proposedTextChanges,
  type DiffPart,
} from "../src/lib/diff";

function reconstruct(parts: DiffPart[]) {
  return {
    before: parts
      .filter((part) => part.type !== "added")
      .map((part) => part.text)
      .join(""),
    after: parts
      .filter((part) => part.type !== "removed")
      .map((part) => part.text)
      .join(""),
  };
}

describe("diffWords", () => {
  test("returns exact word-level additions without changing equal text", () => {
    expect(diffWords("alpha beta", "alpha brave beta")).toEqual([
      { type: "equal", text: "alpha " },
      { type: "added", text: "brave " },
      { type: "equal", text: "beta" },
    ]);
  });

  test("keeps deletion-only edits visible", () => {
    expect(diffWords("delete this\n", "")).toEqual([
      { type: "removed", text: "delete this\n" },
    ]);
  });

  test("represents whitespace-only changes as removals and additions", () => {
    expect(diffWords(" ", "\t")).toEqual([
      { type: "removed", text: " " },
      { type: "added", text: "\t" },
    ]);
    expect(diffWords("alpha beta", "alpha  beta")).toEqual([
      { type: "equal", text: "alpha" },
      { type: "removed", text: " " },
      { type: "added", text: "  " },
      { type: "equal", text: "beta" },
    ]);
  });

  test.each([
    ["", ""],
    ["", "insert me"],
    ["delete me", ""],
    ["\tleading and trailing  \n", " leading\tand trailing\n\n"],
    ["first\r\nsecond", "first\nsecond"],
    ["word", "words"],
    ["same\n", "same\n"],
  ])("reconstructs both inputs character for character: %p → %p", (before, after) => {
    expect(reconstruct(diffWords(before, after))).toEqual({ before, after });
  });

  test("uses an exact whole-block fallback for pathological inputs", () => {
    const before = Array.from({ length: 650 }, (_, index) => `old-${index}`).join(" ");
    const after = Array.from({ length: 650 }, (_, index) => `new-${index}`).join(" ");
    const parts = diffWords(before, after);

    expect(parts).toEqual([
      { type: "removed", text: before },
      { type: "added", text: after },
    ]);
    expect(reconstruct(parts)).toEqual({ before, after });
  });
});

describe("proposedTextChanges", () => {
  test("normalizes single replacements and explicit deletions", () => {
    expect(proposedTextChanges("before", "after", undefined)).toEqual([
      { before: "before", after: "after" },
    ]);
    expect(proposedTextChanges("remove exactly\n", "", undefined)).toEqual([
      { before: "remove exactly\n", after: "" },
    ]);
    expect(proposedTextChanges("remove exactly", undefined, undefined)).toEqual([
      { before: "remove exactly", after: "" },
    ]);
  });

  test("normalizes every replacement-list entry, including deletions", () => {
    expect(
      proposedTextChanges("unused", "unused", [
        { find: "one ", replaceWith: "first\t" },
        { find: "delete\n", replaceWith: "" },
      ])
    ).toEqual([
      { before: "one ", after: "first\t" },
      { before: "delete\n", after: "" },
    ]);
  });

  test("returns no toggleable change without a target or replacement list", () => {
    expect(proposedTextChanges(undefined, "orphan text", undefined)).toEqual([]);
  });
});
