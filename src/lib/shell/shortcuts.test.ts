import { describe, expect, it } from "vitest";
import {
  SEQUENCE_TIMEOUT_MS,
  SHORTCUTS,
  createSequence,
  detectPlatform,
  isModEnter,
  isTypingTarget,
  keysFor,
  shortcutHint,
} from "./shortcuts";

describe("detectPlatform", () => {
  it.each([
    [{ platform: "MacIntel" }, "mac"],
    [{ platform: "iPhone" }, "mac"],
    [{ platform: "iPad" }, "mac"],
    [{ platform: "iPod touch" }, "mac"],
    [{ platform: "", userAgentData: { platform: "macOS" } }, "mac"],
    [{ platform: "Win32" }, "windows"],
    [{ platform: "", userAgentData: { platform: "Windows" } }, "windows"],
    [{ platform: "Linux x86_64" }, "other"],
    [{ platform: "" }, "other"],
    [{}, "other"],
  ] as const)("%o is %s", (nav, expected) => {
    expect(detectPlatform(nav)).toBe(expected);
  });

  it("prefers userAgentData when both are present", () => {
    expect(detectPlatform({ platform: "Linux", userAgentData: { platform: "macOS" } })).toBe("mac");
  });
});

describe("keysFor and shortcutHint", () => {
  it("uses Mac symbols on a Mac (board I4)", () => {
    expect(keysFor("search", "mac")).toEqual(["⌘", "K"]);
    expect(keysFor("collapseRail", "mac")).toEqual(["⌘", "\\"]);
    expect(keysFor("approveContinue", "mac")).toEqual(["⌘", "Enter"]);
    expect(keysFor("viewAs", "mac")).toEqual(["⇧", "V"]);
    expect(shortcutHint("search", "mac")).toBe("⌘K");
    expect(shortcutHint("viewAs", "mac")).toBe("⇧V");
    expect(shortcutHint("approveContinue", "mac")).toBe("⌘ Enter");
  });

  it("uses Ctrl and Shift on Windows and on unknown platforms (board I5)", () => {
    for (const platform of ["windows", "other"] as const) {
      expect(keysFor("search", platform)).toEqual(["Ctrl", "K"]);
      expect(keysFor("viewAs", platform)).toEqual(["Shift", "V"]);
      expect(shortcutHint("search", platform)).toBe("Ctrl K");
      expect(shortcutHint("approveContinue", platform)).toBe("Ctrl Enter");
    }
  });

  it("reads a sequence as G then A", () => {
    expect(shortcutHint("goAdmin", "mac")).toBe("G then A");
    expect(shortcutHint("goAdmin", "windows")).toBe("G then A");
  });

  it("covers every shortcut named on the boards", () => {
    expect(Object.keys(SHORTCUTS).sort()).toEqual(
      ["approveContinue", "collapseRail", "goAdmin", "help", "newProject", "search", "viewAs"].sort()
    );
  });
});

describe("isTypingTarget", () => {
  // Unit tests run in node: a minimal element stand-in with `closest`.
  function el(tagName: string, ancestors: string[] = [], isContentEditable = false) {
    return {
      tagName,
      isContentEditable,
      closest: (selector: string) =>
        ancestors.some((ancestor) => selector.includes(ancestor)) ? {} : null,
    } as unknown as EventTarget;
  }

  it("is true for fields and rich text", () => {
    expect(isTypingTarget({ target: el("input") })).toBe(true);
    expect(isTypingTarget({ target: el("TEXTAREA") })).toBe(true);
    expect(isTypingTarget({ target: el("select") })).toBe(true);
    expect(isTypingTarget({ target: el("div", [], true) })).toBe(true);
    expect(isTypingTarget({ target: el("p", [".ProseMirror"]) })).toBe(true);
    expect(isTypingTarget({ target: el("p", ['[contenteditable="true"]']) })).toBe(true);
  });

  it("is true inside an open dialog", () => {
    expect(isTypingTarget({ target: el("button", ['[role="dialog"]']) })).toBe(true);
  });

  it("is false for the page and plain buttons", () => {
    expect(isTypingTarget({ target: el("body") })).toBe(false);
    expect(isTypingTarget({ target: el("button") })).toBe(false);
    expect(isTypingTarget({ target: null })).toBe(false);
  });
});

describe("isModEnter", () => {
  const base = { key: "Enter", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false };
  it("accepts Cmd or Ctrl with Enter", () => {
    expect(isModEnter({ ...base, metaKey: true })).toBe(true);
    expect(isModEnter({ ...base, ctrlKey: true })).toBe(true);
  });
  it("rejects plain Enter and other modifiers", () => {
    expect(isModEnter(base)).toBe(false);
    expect(isModEnter({ ...base, metaKey: true, shiftKey: true })).toBe(false);
    expect(isModEnter({ ...base, key: "K", metaKey: true })).toBe(false);
  });
});

describe("createSequence (G then A)", () => {
  it("fires when A follows G within the timeout", () => {
    const seq = createSequence(["G", "A"]);
    expect(seq.press("g", 0)).toBe(false);
    expect(seq.press("a", 500)).toBe(true);
  });

  it("does not fire after the timeout", () => {
    const seq = createSequence(["G", "A"]);
    seq.press("g", 0);
    expect(seq.press("a", SEQUENCE_TIMEOUT_MS + 1)).toBe(false);
  });

  it("resets on a wrong key, and restarts on G", () => {
    const seq = createSequence(["G", "A"]);
    seq.press("g", 0);
    expect(seq.press("x", 100)).toBe(false);
    expect(seq.press("a", 200)).toBe(false);
    seq.press("g", 300);
    expect(seq.press("g", 400)).toBe(false);
    expect(seq.press("a", 500)).toBe(true);
  });
});
