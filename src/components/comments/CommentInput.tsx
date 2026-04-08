"use client";

import { FormEvent, useRef, useState } from "react";

interface CommentInputProps {
  commenterName: string;
  onSubmit: (body: string, suggestedEdit?: string) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
  highlightText?: string;
}

export function CommentInput({
  commenterName,
  onSubmit,
  onCancel,
  autoFocus,
  highlightText,
}: CommentInputProps) {
  const [body, setBody] = useState("");
  const [suggestedEdit, setSuggestedEdit] = useState("");
  const [showSuggestEdit, setShowSuggestEdit] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    onSubmit(body.trim(), suggestedEdit.trim() || undefined);
    setBody("");
    setSuggestedEdit("");
    setShowSuggestEdit(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (body.trim()) {
        onSubmit(body.trim(), suggestedEdit.trim() || undefined);
        setBody("");
        setSuggestedEdit("");
        setShowSuggestEdit(false);
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

      {/* Suggest edit toggle */}
      {highlightText && !showSuggestEdit && (
        <button
          type="button"
          onClick={() => {
            setShowSuggestEdit(true);
            setSuggestedEdit(highlightText);
          }}
          className="mt-1 text-[10px] text-primary hover:text-primary-dark transition-colors"
        >
          + Suggest an edit
        </button>
      )}

      {showSuggestEdit && (
        <div className="mt-1.5">
          <label className="text-[10px] font-medium text-gray-500">Replace with:</label>
          <textarea
            value={suggestedEdit}
            onChange={(e) => setSuggestedEdit(e.target.value)}
            rows={2}
            className="mt-0.5 w-full resize-none rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            type="button"
            onClick={() => {
              setShowSuggestEdit(false);
              setSuggestedEdit("");
            }}
            className="mt-0.5 text-[10px] text-gray-400 hover:text-gray-600"
          >
            Remove suggestion
          </button>
        </div>
      )}

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
