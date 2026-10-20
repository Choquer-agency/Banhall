import { describe, expect, test } from "vitest";
import {
  buildChatPath,
  onHistoryPath,
  SERVER_PROMPT_MARKERS,
  writerTextOf,
  excerptBlock,
  type PathTurn,
} from "./chatPath";

/**
 * Report chat parity, Phase C (2026-10-20), W2: the tree of turns and the
 * active path. Fictional data only.
 */

const turn = (promptMessageId: string, order: number, extra: Partial<PathTurn> = {}): PathTurn => ({
  promptMessageId,
  order,
  ...extra,
});
const ids = (turns: PathTurn[]) => turns.map((row) => row.promptMessageId);

describe("buildChatPath", () => {
  test("turns saved before alternatives read as one line, newest as the tip", () => {
    const path = buildChatPath([turn("a", 0), turn("b", 1), turn("c", 2)], undefined);
    expect(ids(path.path)).toEqual(["a", "b", "c"]);
    expect(path.tip?.promptMessageId).toBe("c");
    expect(path.linear).toBe(true);
    expect(path.onPathOrder(1)).toBe(true);
  });

  test("a regenerated turn replaces its sibling and everything after it", () => {
    const turns = [
      turn("a", 0),
      turn("b", 1),
      turn("c", 2),
      turn("b2", 3, { parentPromptMessageId: "a", alternativeOf: "b" }),
    ];
    const path = buildChatPath(turns, "b2");
    expect(ids(path.path)).toEqual(["a", "b2"]);
    expect(path.linear).toBe(false);
    expect(path.onPathPrompt("b")).toBe(false);
    expect(path.onPathPrompt("c")).toBe(false);
    expect(path.onPathPrompt("b2")).toBe(true);
    // Unknown (older than the turns read) and unanchored prompts count as on it.
    expect(path.onPathPrompt("older")).toBe(true);
    expect(path.onPathPrompt(undefined)).toBe(true);
    expect([0, 1, 2, 3].map((order) => path.onPathOrder(order))).toEqual([true, false, false, true]);
    // Messages older than the oldest turn read are on the path.
    expect(buildChatPath(turns.slice(1), "b2").onPathOrder(0)).toBe(true);
  });

  test("an edit of the first message is a root; its parent comes from its group", () => {
    const turns = [turn("a", 0), turn("b", 1), turn("a2", 2, { alternativeOf: "a" })];
    const path = buildChatPath(turns, "a2");
    expect(ids(path.path)).toEqual(["a2"]);
    expect(path.parentOf(turns[2]!)).toBeNull();
    expect(path.onPathOrder(0)).toBe(false);
    expect(path.onPathOrder(1)).toBe(false);
  });

  test("a turn appended after an alternative follows its explicit parent", () => {
    const turns = [
      turn("a", 0),
      turn("b", 1),
      turn("b2", 2, { parentPromptMessageId: "a", alternativeOf: "b" }),
      turn("c", 3, { parentPromptMessageId: "b2" }),
    ];
    expect(ids(buildChatPath(turns, "c").path)).toEqual(["a", "b2", "c"]);
    // Switching back to the first alternative shows its own line again.
    expect(ids(buildChatPath(turns, "b").path)).toEqual(["a", "b"]);
  });

  test("groups count every alternative, oldest first, with their neighbours", () => {
    const turns = [
      turn("a", 0),
      turn("b", 1),
      turn("b2", 2, { parentPromptMessageId: "a", alternativeOf: "b" }),
      turn("b3", 3, { parentPromptMessageId: "a", alternativeOf: "b" }),
    ];
    const path = buildChatPath(turns, "b2");
    expect(path.group(turns[0]!)).toBeUndefined();
    expect(path.group(turns[1]!)).toEqual({ index: 1, count: 3, nextPromptMessageId: "b2" });
    expect(path.group(turns[2]!)).toEqual({
      index: 2, count: 3, previousPromptMessageId: "b", nextPromptMessageId: "b3",
    });
    expect(path.group(turns[3]!)).toEqual({ index: 3, count: 3, previousPromptMessageId: "b2" });
    // The group's first turn is older than the turns read: it still counts.
    const partial = buildChatPath(turns.slice(2), "b2");
    expect(partial.group(turns[2]!)).toEqual({
      index: 2, count: 3, previousPromptMessageId: "b", nextPromptMessageId: "b3",
    });
  });

  test("the newest leaf under an alternative is where the switcher lands", () => {
    const turns = [
      turn("a", 0),
      turn("b", 1),
      turn("c", 2),
      turn("d", 3),
      turn("b2", 4, { parentPromptMessageId: "a", alternativeOf: "b" }),
      turn("e", 5, { parentPromptMessageId: "b2" }),
    ];
    const path = buildChatPath(turns, "e");
    expect(path.newestLeafUnder("b")?.promptMessageId).toBe("d");
    expect(path.newestLeafUnder("b2")?.promptMessageId).toBe("e");
    expect(path.newestLeafUnder("e")?.promptMessageId).toBe("e");
    expect(path.newestLeafUnder("missing")).toBeNull();
  });

  test("an unknown tip falls back to the newest turn", () => {
    expect(buildChatPath([turn("a", 0), turn("b", 1)], "gone").tip?.promptMessageId).toBe("b");
  });
});

describe("writerTextOf", () => {
  test("uses the stored length, or cuts an older prompt at its first server block", () => {
    const stored = `Tighten this.${excerptBlock("A passage.")}`;
    expect(writerTextOf(stored, 13)).toBe("Tighten this.");
    expect(writerTextOf(stored, undefined)).toBe("Tighten this.");
    expect(writerTextOf(`Refine it.${SERVER_PROMPT_MARKERS[1]}abc. Keep]`, undefined)).toBe("Refine it.");
    expect(writerTextOf("Plain message.", undefined)).toBe("Plain message.");
  });
});

describe("onHistoryPath", () => {
  test("keeps the prompt's order, the path's orders and everything older than the turns read", () => {
    const onPath = onHistoryPath({ orders: [3, 5, 9], belowOrder: 3 }, 9);
    expect([1, 2, 3, 4, 5, 6, 9].map(onPath)).toEqual([true, true, true, false, true, false, true]);
  });
});
