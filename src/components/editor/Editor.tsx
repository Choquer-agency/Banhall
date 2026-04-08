"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import { useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react";
import { getEditorExtensions } from "@/lib/tiptapConfig";
import { EditorToolbar } from "./EditorToolbar";
import { SlashCommandMenu } from "./SlashCommand";
import { BlockHandle } from "./BlockHandle";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export interface CommentRange {
  id: string;
  from: number;
  to: number;
  active?: boolean;
}

interface EditorProps {
  content: string;
  onUpdate?: (json: string) => void;
  onComment?: (selection: { from: number; to: number; text: string }) => void;
  editable?: boolean;
  commentRanges?: CommentRange[];
  onHoverComment?: (commentId: string | null) => void;
}

export interface EditorHandle {
  scrollToPosition: (from: number, to: number) => void;
  getYForPos: (pos: number) => number | null;
  getEditorTop: () => number;
}

function buildDecorationSet(doc: Parameters<typeof DecorationSet.create>[0], ranges: CommentRange[]) {
  const decorations: Decoration[] = [];
  const docSize = doc.content.size;

  for (const range of ranges) {
    const from = Math.max(1, Math.min(range.from, docSize));
    const to = Math.max(from, Math.min(range.to, docSize));
    if (from >= to) continue;

    decorations.push(
      Decoration.inline(from, to, {
        class: range.active ? "comment-highlight comment-highlight--active" : "comment-highlight",
        "data-comment-id": range.id,
      })
    );
  }

  return DecorationSet.create(doc, decorations);
}

export const Editor = forwardRef<EditorHandle, EditorProps>(function Editor(
  {
    content,
    onUpdate,
    onComment,
    editable = true,
    commentRanges = [],
    onHoverComment,
  },
  ref
) {
  const [slashMenu, setSlashMenu] = useState<{
    isOpen: boolean;
    position: { top: number; left: number };
  }>({ isOpen: false, position: { top: 0, left: 0 } });

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: getEditorExtensions({ editable }),
    content: parseContent(content),
    editable,
    editorProps: {
      attributes: {
        class: "tiptap-editor outline-none",
      },
      handleKeyDown: (_view, event) => {
        // Slash command trigger
        if (event.key === "/" && !slashMenu.isOpen) {
          setTimeout(() => {
            const { from } = _view.state.selection;
            const coords = _view.coordsAtPos(from);
            setSlashMenu({
              isOpen: true,
              position: { top: coords.bottom + 4, left: coords.left },
            });
          }, 10);
        }

        if (event.key === "Escape" && slashMenu.isOpen) {
          setSlashMenu((s) => ({ ...s, isOpen: false }));
          return true;
        }

        return false;
      },
    },
    onUpdate: ({ editor: ed }) => {
      const { from } = ed.state.selection;
      const textBefore = ed.state.doc.textBetween(
        Math.max(0, from - 20),
        from,
        ""
      );
      if (!textBefore.includes("/")) {
        setSlashMenu((s) => (s.isOpen ? { ...s, isOpen: false } : s));
      }

      if (onUpdate) {
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = setTimeout(() => {
          onUpdate(JSON.stringify(ed.getJSON()));
        }, 1000);
      }
    },
  });

  useImperativeHandle(ref, () => ({
    scrollToPosition: (from: number, to: number) => {
      if (!editor) return;
      try {
        const docSize = editor.state.doc.content.size;
        const clampedFrom = Math.min(from, docSize);
        const clampedTo = Math.min(to, docSize);
        editor.chain().focus().setTextSelection({ from: clampedFrom, to: clampedTo }).run();
        const coords = editor.view.coordsAtPos(clampedFrom);
        const editorDom = editor.view.dom.closest('.overflow-y-auto');
        if (editorDom) {
          const containerRect = editorDom.getBoundingClientRect();
          const scrollTarget = coords.top - containerRect.top + editorDom.scrollTop - 100;
          editorDom.scrollTo({ top: scrollTarget, behavior: 'smooth' });
        }
      } catch { /* position out of range */ }
    },
    getYForPos: (pos: number) => {
      if (!editor) return null;
      try {
        const docSize = editor.state.doc.content.size;
        const clamped = Math.min(pos, docSize);
        const coords = editor.view.coordsAtPos(clamped);
        const editorRect = editor.view.dom.getBoundingClientRect();
        return coords.top - editorRect.top;
      } catch {
        return null;
      }
    },
    getEditorTop: () => {
      if (!editor) return 0;
      return editor.view.dom.getBoundingClientRect().top;
    },
  }), [editor]);

  // Handle comment action from toolbar
  const handleComment = useCallback(() => {
    if (!editor || !onComment) return;
    const { from, to } = editor.state.selection;
    if (from === to) return;
    const text = editor.state.doc.textBetween(from, to, " ");
    if (!text.trim()) return;
    onComment({
      from,
      to,
      text: text.trim().slice(0, 200),
    });
  }, [editor, onComment]);

  // Update content when it changes externally
  const lastContentRef = useRef(content);
  useEffect(() => {
    if (!editor) return;
    if (content !== lastContentRef.current) {
      lastContentRef.current = content;
      const parsed = parseContent(content);
      if (parsed) {
        editor.commands.setContent(parsed);
      }
    }
  }, [content, editor]);

  // Update comment highlight decorations when ranges change
  useEffect(() => {
    if (!editor) return;
    editor.view.setProps({
      decorations: (state) => {
        return buildDecorationSet(state.doc, commentRanges);
      },
    });
  }, [editor, commentRanges]);

  // Detect hover over comment highlights
  useEffect(() => {
    if (!editor || !onHoverComment) return;
    const dom = editor.view.dom;
    const handleMouseOver = (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest?.("[data-comment-id]");
      onHoverComment(el ? el.getAttribute("data-comment-id") : null);
    };
    const handleMouseOut = (e: MouseEvent) => {
      const related = e.relatedTarget as HTMLElement | null;
      if (!related?.closest?.("[data-comment-id]")) {
        onHoverComment(null);
      }
    };
    dom.addEventListener("mouseover", handleMouseOver);
    dom.addEventListener("mouseout", handleMouseOut);
    return () => {
      dom.removeEventListener("mouseover", handleMouseOver);
      dom.removeEventListener("mouseout", handleMouseOut);
    };
  }, [editor, onHoverComment]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

  if (!editor) return null;

  return (
    <div className="group/editor relative">
      {/* Block handles */}
      {editable && <BlockHandle editor={editor} />}

      {/* Floating toolbar on text selection */}
      {editable && (
        <EditorToolbar editor={editor} onComment={handleComment} />
      )}

      {/* Comment-only bubble for read-only mode */}
      {!editable && onComment && (
        <EditorToolbar
          editor={editor}
          onComment={handleComment}
          commentOnly
        />
      )}

      {/* Slash command menu */}
      {editable && (
        <SlashCommandMenu
          editor={editor}
          isOpen={slashMenu.isOpen}
          onClose={() => setSlashMenu((s) => ({ ...s, isOpen: false }))}
          position={slashMenu.position}
        />
      )}

      {/* The editor itself */}
      <EditorContent editor={editor} />

      {/* Line/word/character count */}
      {editable && editor && (
        <div className="mt-4 flex items-center gap-4 text-xs text-gray-400">
          <span>
            {editor.state.doc.content.childCount} lines
          </span>
          <span>
            {editor.storage.characterCount.words()} words
          </span>
          <span>
            {editor.storage.characterCount.characters()} characters
          </span>
        </div>
      )}
    </div>
  );
});

function parseContent(content: string) {
  try {
    const doc = JSON.parse(content);
    // Strip QA scorecard codeBlock from editor view (rendered by QAScorePanel instead)
    if (doc.content) {
      doc.content = doc.content.filter((node: { type: string; attrs?: { language?: string }; content?: Array<{ text?: string }> }) => {
        if (node.type === "codeBlock" && node.attrs?.language === "json") {
          const text = node.content?.[0]?.text ?? "";
          try {
            const parsed = JSON.parse(text);
            if ("overall_score" in parsed) return false;
          } catch { /* not JSON, keep it */ }
        }
        return true;
      });
      // Also strip the "QA Scorecard" heading and preceding hr if they exist
      doc.content = doc.content.filter((node: { type: string; content?: Array<{ text?: string }> }, i: number, arr: Array<{ type: string; content?: Array<{ text?: string }> }>) => {
        if (node.type === "heading" && node.content?.[0]?.text === "QA Scorecard") return false;
        if (node.type === "horizontalRule" && arr[i + 1]?.type === "heading" && arr[i + 1]?.content?.[0]?.text === "QA Scorecard") return false;
        return true;
      });
      // NOTE: We intentionally do NOT strip horizontal rules from the document
      // structure, as that shifts ProseMirror positions and breaks comment
      // highlight placement. Redundant HRs are hidden via CSS instead
      // (see globals.css: .tiptap-editor h1 + hr, .tiptap-editor hr + hr).
    }
    return doc;
  } catch {
    return {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: content ? [{ type: "text", text: content }] : [],
        },
      ],
    };
  }
}
