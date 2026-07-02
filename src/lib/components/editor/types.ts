/**
 * Shared editor contract types (ported from src/components/editor/Editor.tsx).
 * ReadOnlyEditor implements the read-only slice of the handle; the full writer
 * Editor port will implement the rest (highlightText, findReplaceMatches, …).
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
