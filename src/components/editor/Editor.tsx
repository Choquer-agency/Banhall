"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { getEditorExtensions } from "@/lib/tiptapConfig";
import { EditorToolbar } from "./EditorToolbar";
import { SlashCommandMenu } from "./SlashCommand";
import { BlockHandle } from "./BlockHandle";

interface EditorProps {
  content: string;
  onUpdate?: (json: string) => void;
  onComment?: () => void;
  editable?: boolean;
}

export function Editor({
  content,
  onUpdate,
  onComment,
  editable = true,
}: EditorProps) {
  const [slashMenu, setSlashMenu] = useState<{
    isOpen: boolean;
    position: { top: number; left: number };
  }>({ isOpen: false, position: { top: 0, left: 0 } });

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  const editor = useEditor({
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
          // Delay to let the "/" be typed first
          setTimeout(() => {
            const { from } = _view.state.selection;
            const coords = _view.coordsAtPos(from);
            setSlashMenu({
              isOpen: true,
              position: { top: coords.bottom + 4, left: coords.left },
            });
          }, 10);
        }

        // Close slash menu on escape
        if (event.key === "Escape" && slashMenu.isOpen) {
          setSlashMenu((s) => ({ ...s, isOpen: false }));
          return true;
        }

        return false;
      },
    },
    onUpdate: ({ editor: ed }) => {
      // Close slash menu if cursor moved away
      const { from } = ed.state.selection;
      const textBefore = ed.state.doc.textBetween(
        Math.max(0, from - 20),
        from,
        ""
      );
      if (!textBefore.includes("/")) {
        setSlashMenu((s) => (s.isOpen ? { ...s, isOpen: false } : s));
      }

      // Debounced auto-save
      if (onUpdate) {
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = setTimeout(() => {
          onUpdate(JSON.stringify(ed.getJSON()));
        }, 1000);
      }
    },
  });

  // Update content when it changes externally (e.g., after regeneration)
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

  // Cleanup
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

  const handleComment = useCallback(() => {
    if (onComment) onComment();
  }, [onComment]);

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

      {/* Character/word count */}
      {editable && editor && (
        <div className="mt-4 flex items-center gap-4 text-xs text-gray-400">
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
}

function parseContent(content: string) {
  try {
    return JSON.parse(content);
  } catch {
    // If it's not JSON, treat it as plain text
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
