/**
 * Shared editor contract types (ported from src/components/editor/Editor.tsx).
 * ReadOnlyEditor implements the read-only slice of the handle (EditorHandle);
 * the full writer Editor implements WriterEditorHandle via exported functions
 * (parents `bind:this` the component instance and call them directly).
 */
export interface CommentRange {
  id: string;
  from: number;
  to: number;
  text?: string;
  active?: boolean;
  isClient?: boolean;
}

export interface EditorHandle {
  scrollToPosition: (from: number, to: number, text?: string) => void;
  getYForPos: (pos: number, text?: string) => number | null;
  getEditorTop: () => number;
}

/** BNH-30: one case-insensitive find/replace occurrence in the doc. */
export interface FindReplaceMatch {
  from: number;
  to: number;
  replaceWith: string;
  text: string;
}

/** Full writer editor handle (Editor.svelte's exported functions). */
export interface WriterEditorHandle extends EditorHandle {
  /** Flush the visible document through the autosave callback and await queued saves. */
  flushPendingSave: () => Promise<void>;
  /**
   * BNH-25: highlight every occurrence of the given passages, and scroll to
   * `scrollTo` (one of the passages) — or the first occurrence if omitted.
   */
  highlightText: (texts: string[], scrollTo?: string) => void;
  /** Locate a 1-based non-empty paragraph after the matching section heading. */
  locateSectionParagraph: (section: string, paragraph: number | null) => void;
  clearHighlight: () => void;
  // BNH-30: one-by-one replace stepping primitives.
  findReplaceMatches: (
    pairs: { find: string; replaceWith: string }[]
  ) => FindReplaceMatch[];
  replaceRange: (from: number, to: number, newText: string) => void;
  highlightRange: (from: number, to: number, text: string) => void;
}
