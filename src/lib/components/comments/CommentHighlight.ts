/**
 * CSS-based comment highlight decoration (port of src/components/comments/CommentHighlight.tsx).
 * Used to add colored underlines in the editor for commented text regions.
 *
 * This module is not a component — comment highlights are applied via Tiptap
 * decorations or CSS classes on the editor content (see ReadOnlyEditor's
 * decoration set + the `.comment-highlight` styles in layout.css).
 * It exports the helper to generate decoration styles. Note the returned
 * object uses camelCase CSS property names (React CSSProperties shape kept
 * for contract parity); convert to a style string before binding in Svelte.
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
