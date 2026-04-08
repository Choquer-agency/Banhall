"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Editor } from "@tiptap/react";

interface EditorToolbarProps {
  editor: Editor;
  onComment?: () => void;
  commentOnly?: boolean;
}

export function EditorToolbar({
  editor,
  onComment,
  commentOnly = false,
}: EditorToolbarProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const mouseRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const mouseDownInEditorRef = useRef(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(
    null
  );

  // Track actual mouse position + whether mouse is down inside the editor
  useEffect(() => {
    const editorDom = editor.view.dom;

    const handleMouseMove = (e: MouseEvent) => {
      mouseRef.current = { x: e.clientX, y: e.clientY };
    };
    const handleMouseDown = () => {
      mouseDownInEditorRef.current = true;
    };
    const handleMouseUp = () => {
      // Small delay so selectionUpdate fires first
      setTimeout(() => { mouseDownInEditorRef.current = false; }, 50);
    };

    document.addEventListener("mousemove", handleMouseMove);
    editorDom.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      editorDom.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [editor]);

  const updatePosition = useCallback(() => {
    const { from, to } = editor.state.selection;
    if (from === to) {
      setCoords(null);
      return;
    }

    // Only show toolbar for user-initiated selections (mouse drag in editor),
    // not for programmatic selections (e.g., clicking a comment card)
    if (!mouseDownInEditorRef.current) {
      return;
    }

    const editorRect = editor.view.dom.getBoundingClientRect();
    const mouse = mouseRef.current;

    const mouseY = Math.max(editorRect.top, Math.min(mouse.y, editorRect.bottom));
    const mouseX = Math.max(editorRect.left, Math.min(mouse.x, editorRect.right));

    setCoords({
      top: mouseY - editorRect.top - 45,
      left: mouseX - editorRect.left,
    });
  }, [editor]);

  const handleBlur = useCallback(({ event }: { event: FocusEvent }) => {
    const relatedTarget = event.relatedTarget as Node | null;
    if (menuRef.current && relatedTarget && menuRef.current.contains(relatedTarget)) {
      return;
    }
    setCoords(null);
  }, []);

  useEffect(() => {
    editor.on("selectionUpdate", updatePosition);
    editor.on("blur", handleBlur);

    return () => {
      editor.off("selectionUpdate", updatePosition);
      editor.off("blur", handleBlur);
    };
  }, [editor, updatePosition, handleBlur]);

  if (!coords) return null;

  return (
    <div
      ref={menuRef}
      className="absolute z-50 flex items-center gap-0.5 rounded-lg border border-gray-200 bg-white px-1 py-1 shadow-lg"
      style={{
        top: coords.top,
        left: coords.left,
        transform: "translateX(-50%)",
      }}
      onMouseDown={(e) => {
        // Prevent toolbar clicks from stealing focus from the editor
        e.preventDefault();
      }}
    >
      {!commentOnly && (
        <>
          <ToolbarButton
            active={editor.isActive("bold")}
            onClick={() => editor.chain().focus().toggleBold().run()}
            title="Bold (Cmd+B)"
          >
            <span className="font-bold">B</span>
          </ToolbarButton>

          <ToolbarButton
            active={editor.isActive("italic")}
            onClick={() => editor.chain().focus().toggleItalic().run()}
            title="Italic (Cmd+I)"
          >
            <span className="italic">I</span>
          </ToolbarButton>

          <ToolbarButton
            active={editor.isActive("underline")}
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            title="Underline (Cmd+U)"
          >
            <span className="underline">U</span>
          </ToolbarButton>

          <ToolbarButton
            active={editor.isActive("strike")}
            onClick={() => editor.chain().focus().toggleStrike().run()}
            title="Strikethrough"
          >
            <span className="line-through">S</span>
          </ToolbarButton>
        </>
      )}

      {onComment && (
        <>
          {!commentOnly && <div className="mx-0.5 h-5 w-px bg-gray-200" />}
          <ToolbarButton active={false} onClick={onComment} title="Comment">
            <svg
              className="h-3.5 w-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"
              />
            </svg>
          </ToolbarButton>
        </>
      )}
    </div>
  );
}

function ToolbarButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`flex h-7 w-7 items-center justify-center rounded text-xs transition-colors ${
        active
          ? "bg-navy text-white"
          : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
      }`}
    >
      {children}
    </button>
  );
}
