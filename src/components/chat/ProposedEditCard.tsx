"use client";

import { useState } from "react";

interface ProposedEditCardProps {
  newText?: string;
  replacements?: { find: string; replaceWith: string }[];
  state: "pending" | "applied" | "rejected";
  onReplace: () => Promise<void> | void;
  onReject: () => Promise<void> | void;
  onShowInDoc?: () => void;
  onReviewOneByOne?: () => void;
  reviewing?: boolean;
}

export function ProposedEditCard({
  newText,
  replacements,
  state,
  onReplace,
  onReject,
  onShowInDoc,
  onReviewOneByOne,
  reviewing,
}: ProposedEditCardProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handle(action: () => Promise<void> | void) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Something went wrong applying this edit."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      {/* The proposed change: a multi-instance find/replace list, or the new text */}
      <div className="max-h-72 overflow-y-auto px-4 py-3.5">
        {replacements && replacements.length > 0 ? (
          <div className="flex flex-col gap-2">
            <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
              {replacements.length} replacement{replacements.length === 1 ? "" : "s"} — applied to every occurrence
            </p>
            {replacements.map((r, i) => (
              <div key={i} className="flex items-center gap-2 text-[14px]">
                <span className="rounded bg-red-50 px-1.5 py-0.5 font-serif text-red-700 line-through decoration-red-300">
                  {r.find}
                </span>
                <svg className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
                <span className="rounded bg-green-50 px-1.5 py-0.5 font-serif text-green-700">
                  {r.replaceWith}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="whitespace-pre-wrap font-serif text-[15px] leading-relaxed text-gray-900">
            {newText}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 border-t border-gray-100 bg-gray-50 px-3 py-2.5">
        {state === "pending" && reviewing ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-navy">
            <div className="h-3 w-3 animate-spin rounded-full border-2 border-navy/30 border-t-navy" />
            Stepping through in the document…
          </span>
        ) : state === "pending" ? (
          <>
            {/* BNH-30: multi-instance edits — step through (green), bulk (orange),
                or reject (red). */}
            {onReviewOneByOne ? (
              <>
                <button
                  onClick={onReviewOneByOne}
                  disabled={busy}
                  className="inline-flex items-center gap-1 rounded-lg bg-green-500 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-green-600 disabled:opacity-50"
                >
                  Replace One By One
                </button>
                <button
                  onClick={() => handle(onReplace)}
                  disabled={busy}
                  className="rounded-lg bg-orange-500 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-orange-600 disabled:opacity-50"
                >
                  {busy ? "Replacing…" : "Replace All"}
                </button>
                <button
                  onClick={() => handle(onReject)}
                  disabled={busy}
                  className="rounded-lg bg-red-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-red-600 disabled:opacity-50"
                >
                  Reject
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => handle(onReplace)}
                  disabled={busy}
                  className="rounded-lg bg-primary px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-primary-dark disabled:opacity-50"
                >
                  {busy ? "Replacing…" : "Replace"}
                </button>
                <button
                  onClick={() => handle(onReject)}
                  disabled={busy}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50"
                >
                  Reject
                </button>
              </>
            )}
          </>
        ) : state === "applied" ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600">
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            Replaced in report
          </span>
        ) : (
          <span className="text-xs text-gray-400">Rejected</span>
        )}

        {onShowInDoc && (
          <button
            onClick={onShowInDoc}
            title="Scroll to and highlight this in the document"
            className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-gray-400 transition-colors hover:bg-gray-100 hover:text-navy"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            Show in document
          </button>
        )}
      </div>

      {error && (
        <p className="border-t border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
