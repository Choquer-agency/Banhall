"use client";

import { FormEvent, useRef, useState } from "react";

interface CommentInputProps {
  commenterName: string;
  onSubmit: (body: string) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
}

export function CommentInput({
  commenterName,
  onSubmit,
  onCancel,
  autoFocus,
}: CommentInputProps) {
  const [body, setBody] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    onSubmit(body.trim());
    setBody("");
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (body.trim()) {
        onSubmit(body.trim());
        setBody("");
      }
    }
    if (e.key === "Escape") {
      onCancel?.();
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="text-xs font-medium text-gray-600">
          {commenterName}
        </span>
      </div>
      <textarea
        ref={textareaRef}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Add a comment..."
        rows={2}
        autoFocus={autoFocus}
        className="w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
      />
      <div className="mt-1.5 flex items-center justify-between">
        <p className="text-[10px] text-gray-300">Cmd+Enter to submit</p>
        <div className="flex items-center gap-1.5">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="rounded px-2 py-1 text-xs text-gray-400 hover:text-gray-600"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={!body.trim()}
            className="rounded-md bg-navy px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
          >
            Comment
          </button>
        </div>
      </div>
    </form>
  );
}
