"use client";

import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { useEffect, useRef } from "react";

export function GenerationProgress({
  projectId,
}: {
  projectId: Id<"projects">;
}) {
  const generation = useQuery(api.generations.getLatestGeneration, {
    projectId,
  });
  const scrollRef = useRef<HTMLDivElement>(null);

  const log = generation?.progressLog ?? [];

  // Keep the terminal pinned to the newest line.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [log.length]);

  if (!generation) return null;

  const isRunning = generation.status === "running";
  const isFailed = generation.status === "failed";
  const isComplete = generation.status === "completed";

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-3">
        {isRunning && (
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-navy border-t-transparent" />
        )}
        {isComplete && (
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-green-100">
            <svg className="h-3 w-3 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
        )}
        {isFailed && (
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-red-100">
            <svg className="h-3 w-3 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
        )}
        <div>
          <h3 className="text-sm font-semibold text-gray-900">
            {isRunning ? "Generating report…" : isComplete ? "Report generated" : "Generation failed"}
          </h3>
          {isRunning && generation.currentStep && (
            <p className="text-xs text-gray-400">{generation.currentStep}</p>
          )}
        </div>
      </div>

      {/* Terminal-style thinking window */}
      <div
        ref={scrollRef}
        className="h-[200px] overflow-y-auto rounded-xl bg-navy px-4 py-3 font-mono text-[12px] leading-[1.7] text-white/85"
      >
        {log.length === 0 && isRunning && (
          <div className="text-white/50">› warming up…</div>
        )}
        {log.map((line, i) => {
          const isLast = i === log.length - 1;
          return (
            <div key={i} className="flex gap-2">
              <span className="select-none text-primary-light">›</span>
              <span className="flex-1">
                {line}
                {isLast && isRunning && (
                  <span className="ml-0.5 inline-block animate-pulse">▍</span>
                )}
              </span>
            </div>
          );
        })}
        {isComplete && (
          <div className="flex gap-2 text-green-400">
            <span className="select-none">✓</span>
            <span>Done.</span>
          </div>
        )}
      </div>

      {isFailed && generation.error && (
        <div className="mt-3 rounded-lg bg-red-50 px-3 py-2">
          <p className="text-sm text-red-700">{generation.error}</p>
        </div>
      )}
    </div>
  );
}
