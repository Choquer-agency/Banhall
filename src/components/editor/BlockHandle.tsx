"use client";

import { Editor } from "@tiptap/react";
import { useState, useCallback, useEffect, useRef } from "react";

interface BlockPosition {
  top: number;
  pos: number;
}

export function BlockHandle({ editor }: { editor: Editor }) {
  const [hoveredBlock, setHoveredBlock] = useState<BlockPosition | null>(null);
  const [dragging, setDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (dragging) return;

      const editorElement = document.querySelector(".tiptap-editor");
      if (!editorElement) return;

      // Find the block element under the cursor
      const target = document.elementFromPoint(e.clientX, e.clientY);
      if (!target) return;

      // Walk up to find a direct child of the editor
      let blockEl: HTMLElement | null = target as HTMLElement;
      while (
        blockEl &&
        blockEl.parentElement !== editorElement
      ) {
        blockEl = blockEl.parentElement;
      }

      if (!blockEl || blockEl === editorElement) {
        setHoveredBlock(null);
        return;
      }

      const rect = blockEl.getBoundingClientRect();
      const editorRect = editorElement.getBoundingClientRect();

      // Get the ProseMirror position for this DOM node
      const pos = editor.view.posAtDOM(blockEl, 0);

      setHoveredBlock({
        top: rect.top - editorRect.top,
        pos,
      });
    },
    [editor, dragging]
  );

  useEffect(() => {
    const editorElement = document.querySelector(".tiptap-editor");
    if (!editorElement) return;

    const parent = editorElement.parentElement;
    if (!parent) return;

    parent.addEventListener("mousemove", handleMouseMove);
    parent.addEventListener("mouseleave", () => setHoveredBlock(null));

    return () => {
      parent.removeEventListener("mousemove", handleMouseMove);
      parent.removeEventListener("mouseleave", () => setHoveredBlock(null));
    };
  }, [handleMouseMove]);

  const handleAddBlock = useCallback(() => {
    if (!hoveredBlock) return;
    // Insert a new paragraph after the current block
    const resolvedPos = editor.state.doc.resolve(hoveredBlock.pos);
    const endOfBlock = resolvedPos.end(1);
    editor
      .chain()
      .focus()
      .insertContentAt(endOfBlock + 1, { type: "paragraph" })
      .run();
  }, [editor, hoveredBlock]);

  if (!hoveredBlock) return null;

  return (
    <div
      ref={containerRef}
      className="absolute -left-10 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/editor:opacity-100"
      style={{ top: hoveredBlock.top }}
    >
      <button
        type="button"
        onClick={handleAddBlock}
        className="flex h-6 w-6 items-center justify-center rounded text-gray-300 hover:bg-gray-100 hover:text-gray-500"
        title="Add block"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
      </button>
      <button
        type="button"
        className="flex h-6 w-6 cursor-grab items-center justify-center rounded text-gray-300 hover:bg-gray-100 hover:text-gray-500"
        title="Drag to reorder"
        onMouseDown={() => setDragging(true)}
        onMouseUp={() => setDragging(false)}
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="9" cy="6" r="1.5" />
          <circle cx="15" cy="6" r="1.5" />
          <circle cx="9" cy="12" r="1.5" />
          <circle cx="15" cy="12" r="1.5" />
          <circle cx="9" cy="18" r="1.5" />
          <circle cx="15" cy="18" r="1.5" />
        </svg>
      </button>
    </div>
  );
}
