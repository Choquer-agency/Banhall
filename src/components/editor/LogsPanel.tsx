"use client";

import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { useState } from "react";

type LogEntry = {
  _id: Id<"chatMessages">;
  role: "writer" | "assistant";
  content: string;
  createdAt: number;
  highlight: string | null;
  proposedEdit: { newText: string; state: "pending" | "applied" | "rejected" } | null;
};

/**
 * Quiet, text-only dropdown of the project's full chat log (every question +
 * answer). Intentionally low-emphasis — no card/background — since it's for
 * data review and the Brain, not a primary surface.
 */
export function LogsPanel({ projectId }: { projectId: Id<"projects"> }) {
  const [isOpen, setIsOpen] = useState(false);
  const log = useQuery(api.chat.listProjectLog, { projectId }) as
    | LogEntry[]
    | undefined;

  const count = log?.length ?? 0;

  return (
    <div className="mt-6">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 text-xs font-medium text-gray-400 transition-colors hover:text-gray-600"
      >
        <svg
          className={`h-3 w-3 transition-transform ${isOpen ? "rotate-90" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        Logs
        <span className="text-gray-300">·</span>
        <span className="text-gray-300">{count} entr{count === 1 ? "y" : "ies"}</span>
      </button>

      {isOpen && (
        <div className="mt-3 space-y-3 border-l border-gray-100 pl-4">
          {count === 0 ? (
            <p className="text-xs text-gray-400">
              No chat activity yet. Every question and answer in the assistant is
              recorded here.
            </p>
          ) : (
            log!.map((entry) => (
              <div key={entry._id} className="text-xs leading-relaxed">
                <div className="mb-0.5 flex items-center gap-2">
                  <span
                    className={`font-semibold uppercase tracking-wide ${
                      entry.role === "writer" ? "text-gray-500" : "text-primary-dark"
                    }`}
                  >
                    {entry.role === "writer" ? "Question" : "Answer"}
                  </span>
                  <span className="text-gray-300">{formatTime(entry.createdAt)}</span>
                </div>
                {entry.highlight && (
                  <p className="mb-0.5 italic text-gray-400">
                    re: &ldquo;{truncate(entry.highlight, 120)}&rdquo;
                  </p>
                )}
                <p className="whitespace-pre-wrap text-gray-600">{entry.content}</p>
                {entry.proposedEdit && (
                  <p className="mt-0.5 text-gray-400">
                    → proposed edit{" "}
                    <span
                      className={
                        entry.proposedEdit.state === "applied"
                          ? "text-green-600"
                          : entry.proposedEdit.state === "rejected"
                            ? "text-red-500"
                            : "text-gray-400"
                      }
                    >
                      ({entry.proposedEdit.state})
                    </span>
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
