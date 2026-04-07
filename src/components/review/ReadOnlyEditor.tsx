"use client";

import { Editor } from "@/components/editor/Editor";

interface ReadOnlyEditorProps {
  content: string;
  onComment?: () => void;
}

/**
 * Read-only editor wrapper for client review.
 * Clients can select text and comment, but cannot edit the document.
 */
export function ReadOnlyEditor({ content, onComment }: ReadOnlyEditorProps) {
  return (
    <div className="read-only-editor">
      <Editor content={content} editable={false} onComment={onComment} />
    </div>
  );
}
