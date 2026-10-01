/**
 * Keyboard shortcut registry (round 2 boards I4 and I5). One list feeds the
 * Keyboard shortcuts settings page, the tooltips and menus that show a key
 * hint, and `ShortcutHost`, so every surface names the same keys. Keys are
 * OS-aware: a Mac shows the Mac symbols, Windows and anything we cannot
 * detect show Ctrl and Shift.
 *
 * Pure: no Svelte, no DOM beyond reading `navigator` and event targets.
 */

export type Platform = "mac" | "windows" | "other";

export type ShortcutId =
  | "search"
  | "newProject"
  | "collapseRail"
  | "goAdmin"
  | "approveContinue"
  | "viewAs"
  | "help";

/** One key in a chord. `mod` is Cmd on a Mac and Ctrl elsewhere. */
type KeyToken = "mod" | "shift" | "enter" | string;

export type Shortcut = {
  id: ShortcutId;
  label: string;
  /**
   * `chord`: keys pressed together. `sequence`: keys pressed one after the
   * other (G then A), within `SEQUENCE_TIMEOUT_MS`.
   */
  kind: "chord" | "sequence";
  keys: readonly KeyToken[];
};

export const SEQUENCE_TIMEOUT_MS = 1000;

export const SHORTCUTS: Record<ShortcutId, Shortcut> = {
  search: { id: "search", label: "Search", kind: "chord", keys: ["mod", "K"] },
  newProject: { id: "newProject", label: "New project", kind: "chord", keys: ["C"] },
  collapseRail: { id: "collapseRail", label: "Collapse the rail", kind: "chord", keys: ["mod", "\\"] },
  goAdmin: { id: "goAdmin", label: "Go to Admin", kind: "sequence", keys: ["G", "A"] },
  approveContinue: {
    id: "approveContinue",
    label: "Approve and continue",
    kind: "chord",
    keys: ["mod", "enter"],
  },
  viewAs: { id: "viewAs", label: "View as (developers)", kind: "chord", keys: ["shift", "V"] },
  help: { id: "help", label: "Keyboard shortcuts", kind: "chord", keys: ["?"] },
};

type NavigatorLike = {
  platform?: string;
  userAgentData?: { platform?: string } | null;
};

export function detectPlatform(
  nav: NavigatorLike | undefined = typeof navigator !== "undefined"
    ? (navigator as NavigatorLike)
    : undefined
): Platform {
  const raw = `${nav?.userAgentData?.platform ?? ""} ${nav?.platform ?? ""}`;
  if (/mac|iphone|ipad|ipod/i.test(raw)) return "mac";
  if (/win/i.test(raw)) return "windows";
  return "other";
}

const MAC_LABELS: Record<string, string> = { mod: "⌘", shift: "⇧", enter: "Enter" };
const WINDOWS_LABELS: Record<string, string> = { mod: "Ctrl", shift: "Shift", enter: "Enter" };

/** The key labels for one shortcut on a platform ("other" uses Windows keys). */
export function keysFor(id: ShortcutId, platform: Platform): string[] {
  const labels = platform === "mac" ? MAC_LABELS : WINDOWS_LABELS;
  return SHORTCUTS[id].keys.map((key) => labels[key] ?? key);
}

/**
 * One-line hint for tooltips and menus. Mac symbols sit together ("⌘K",
 * "⇧V"); word keys take a space ("Ctrl K", "Shift V"); sequences read
 * "G then A".
 */
export function shortcutHint(id: ShortcutId, platform: Platform): string {
  const keys = keysFor(id, platform);
  if (SHORTCUTS[id].kind === "sequence") return keys.join(" then ");
  if (platform === "mac") {
    return keys.reduce((hint, key, index) => {
      if (index === 0) return key;
      const previous = keys[index - 1];
      const glued = /^[⌘⇧]$/.test(previous) && key.length === 1;
      return glued ? `${hint}${key}` : `${hint} ${key}`;
    }, "");
  }
  return keys.join(" ");
}

type TargetLike = {
  closest?: (selector: string) => unknown;
  isContentEditable?: boolean;
  tagName?: string;
};

/**
 * True when a key press belongs to what the person is typing into (fields,
 * rich text including the Tiptap editor) or to an open dialog, so global
 * single-key shortcuts must not fire.
 */
export function isTypingTarget(event: { target: EventTarget | null }): boolean {
  const target = event.target as TargetLike | null;
  if (!target || typeof target !== "object") return false;
  if (target.isContentEditable) return true;
  const tag = typeof target.tagName === "string" ? target.tagName.toUpperCase() : "";
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (typeof target.closest === "function") {
    if (target.closest('[contenteditable=""], [contenteditable="true"], .ProseMirror')) return true;
    if (target.closest('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]'))
      return true;
  }
  return false;
}

/** Cmd Enter on a Mac, Ctrl Enter elsewhere (either modifier is accepted). */
export function isModEnter(event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}): boolean {
  return (
    event.key === "Enter" &&
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.shiftKey
  );
}

/**
 * Two-key sequence tracker (G then A). `press` returns true when the key
 * completes the sequence within the timeout. A wrong key resets it.
 */
export function createSequence(keys: readonly string[], timeoutMs = SEQUENCE_TIMEOUT_MS) {
  let index = 0;
  let startedAt = 0;
  return {
    press(key: string, now: number = Date.now()): boolean {
      const normalized = key.toUpperCase();
      if (index > 0 && now - startedAt > timeoutMs) index = 0;
      if (normalized === keys[index].toUpperCase()) {
        if (index === 0) startedAt = now;
        index += 1;
        if (index === keys.length) {
          index = 0;
          return true;
        }
        return false;
      }
      index = normalized === keys[0].toUpperCase() ? 1 : 0;
      if (index === 1) startedAt = now;
      return false;
    },
    reset() {
      index = 0;
    },
  };
}
