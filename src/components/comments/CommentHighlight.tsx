"use client";

/**
 * CSS-based comment highlight decoration.
 * Used to add colored underlines in the editor for commented text regions.
 *
 * This component is not rendered directly — instead the comment highlights
 * are applied via Tiptap decorations or CSS classes on the editor content.
 * This file exports the helper to generate decoration styles.
 */

export function getCommentHighlightStyle(color: string, resolved: boolean) {
  if (resolved) {
    return {
      borderBottom: `2px solid ${color}40`,
      backgroundColor: "transparent",
      opacity: 0.5,
    };
  }
  return {
    borderBottom: `2px solid ${color}`,
    backgroundColor: `${color}15`,
    borderRadius: "2px",
    cursor: "pointer",
  };
}

export const COMMENT_HIGHLIGHT_CLASS = "comment-highlight";
