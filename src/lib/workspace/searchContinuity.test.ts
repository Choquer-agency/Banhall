import { describe, expect, it } from "vitest";
import {
  SEARCH_HANDOFF_TTL_MS,
  searchShortcutHint,
  stashWorkspaceSearch,
  stashWorkspaceSearchFocus,
  takeWorkspaceSearch,
  takeWorkspaceSearchFocus,
} from "./searchContinuity";

describe("searchShortcutHint", () => {
  it("names the Command key on Apple platforms", () => {
    expect(searchShortcutHint("MacIntel")).toBe("⌘K");
    expect(searchShortcutHint("iPhone")).toBe("⌘K");
    expect(searchShortcutHint("iPad")).toBe("⌘K");
  });

  it("names the Control key everywhere else, including unknown platforms", () => {
    expect(searchShortcutHint("Win32")).toBe("Ctrl K");
    expect(searchShortcutHint("Linux x86_64")).toBe("Ctrl K");
    expect(searchShortcutHint("")).toBe("Ctrl K");
  });
});

describe("workspace search handoff", () => {
  it("hands a fresh query across one remount, then clears", () => {
    stashWorkspaceSearch("solar", 1_000);
    expect(takeWorkspaceSearch(1_100)).toBe("solar");
    // One-shot: a second take gets nothing.
    expect(takeWorkspaceSearch(1_200)).toBe("");
  });

  it("discards stale stashes past the TTL", () => {
    stashWorkspaceSearch("solar", 1_000);
    expect(takeWorkspaceSearch(1_000 + SEARCH_HANDOFF_TTL_MS + 1)).toBe("");
  });

  it("treats an empty stash as no handoff", () => {
    stashWorkspaceSearch("solar", 1_000);
    stashWorkspaceSearch("", 1_001);
    expect(takeWorkspaceSearch(1_002)).toBe("");
  });
});

describe("workspace search focus handoff (chrome-less Home)", () => {
  it("hands the focus intent across one remount, then clears", () => {
    stashWorkspaceSearchFocus(1_000);
    expect(takeWorkspaceSearchFocus(1_100)).toBe(true);
    expect(takeWorkspaceSearchFocus(1_200)).toBe(false);
  });

  it("discards stale focus intents past the TTL", () => {
    stashWorkspaceSearchFocus(1_000);
    expect(takeWorkspaceSearchFocus(1_000 + SEARCH_HANDOFF_TTL_MS + 1)).toBe(false);
  });
});
