"use client";

import { useState } from "react";

interface ProposedEditCardProps {
  newText: string;
  state: "pending" | "applied" | "rejected";
  onReplace: () => Promise<void> | void;
  onReject: () => Promise<void> | void;
}

export function ProposedEditCard({
  newText,
  state,
  onReplace,
  onReject,
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
      {/* The proposed text itself */}
      <div className="max-h-72 overflow-y-auto px-4 py-3.5">
        <p className="whitespace-pre-wrap font-serif text-[15px] leading-relaxed text-gray-900">
          {newText}
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 border-t border-gray-100 bg-gray-50 px-3 py-2.5">
        {state === "pending" ? (
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
      </div>

      {error && (
        <p className="border-t border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
