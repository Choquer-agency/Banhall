"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Editor } from "@tiptap/react";

interface SlashItem {
  title: string;
  description: string;
  icon: string;
  command: (editor: Editor) => void;
}

const SLASH_ITEMS: SlashItem[] = [
  {
    title: "Heading 1",
    description: "Large section heading",
    icon: "H1",
    command: (editor) =>
      editor.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    title: "Heading 2",
    description: "Medium section heading",
    icon: "H2",
    command: (editor) =>
      editor.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    title: "Heading 3",
    description: "Small section heading",
    icon: "H3",
    command: (editor) =>
      editor.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  {
    title: "Paragraph",
    description: "Plain text block",
    icon: "P",
    command: (editor) => editor.chain().focus().setParagraph().run(),
  },
  {
    title: "Divider",
    description: "Horizontal line separator",
    icon: "—",
    command: (editor) => editor.chain().focus().setHorizontalRule().run(),
  },
  {
    title: "Quote",
    description: "Block quote",
    icon: "\"",
    command: (editor) => editor.chain().focus().toggleBlockquote().run(),
  },
  {
    title: "Code Block",
    description: "Code block with syntax",
    icon: "<>",
    command: (editor) => editor.chain().focus().toggleCodeBlock().run(),
  },
  {
    title: "Bullet List",
    description: "Unordered list",
    icon: "•",
    command: (editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    title: "Numbered List",
    description: "Ordered list",
    icon: "1.",
    command: (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
];

export function SlashCommandMenu({
  editor,
  isOpen,
  onClose,
  position,
}: {
  editor: Editor;
  isOpen: boolean;
  onClose: () => void;
  position: { top: number; left: number };
}) {
  const [filter, setFilter] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);

  const filtered = SLASH_ITEMS.filter(
    (item) =>
      item.title.toLowerCase().includes(filter.toLowerCase()) ||
      item.description.toLowerCase().includes(filter.toLowerCase())
  );

  const executeCommand = useCallback(
    (item: SlashItem) => {
      // Delete the slash and any filter text
      const { from } = editor.state.selection;
      const textBefore = editor.state.doc.textBetween(
        Math.max(0, from - filter.length - 1),
        from,
        ""
      );
      const slashPos = textBefore.lastIndexOf("/");
      if (slashPos >= 0) {
        const deleteFrom = from - filter.length - 1;
        editor
          .chain()
          .focus()
          .deleteRange({ from: deleteFrom, to: from })
          .run();
      }
      item.command(editor);
      onClose();
    },
    [editor, filter, onClose]
  );

  useEffect(() => {
    if (!isOpen) {
      setFilter("");
      setSelectedIndex(0);
    }
  }, [isOpen]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [filter]);

  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (filtered[selectedIndex]) {
          executeCommand(filtered[selectedIndex]);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Backspace" && filter === "") {
        onClose();
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        setFilter((f) => f + e.key);
      } else if (e.key === "Backspace") {
        setFilter((f) => f.slice(0, -1));
      }
    }

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [isOpen, filter, filtered, selectedIndex, executeCommand, onClose]);

  if (!isOpen || filtered.length === 0) return null;

  return (
    <div
      ref={menuRef}
      className="fixed z-50 w-64 rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
      style={{ top: position.top, left: position.left }}
    >
      {filter && (
        <div className="px-3 py-1 text-xs text-gray-400">
          Filter: {filter}
        </div>
      )}
      {filtered.map((item, index) => (
        <button
          key={item.title}
          className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors ${
            index === selectedIndex
              ? "bg-gray-50 text-navy"
              : "text-gray-700 hover:bg-gray-50"
          }`}
          onClick={() => executeCommand(item)}
          onMouseEnter={() => setSelectedIndex(index)}
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 bg-white text-xs font-medium text-gray-500">
            {item.icon}
          </span>
          <div>
            <p className="text-sm font-medium">{item.title}</p>
            <p className="text-xs text-gray-400">{item.description}</p>
          </div>
        </button>
      ))}
    </div>
  );
}
