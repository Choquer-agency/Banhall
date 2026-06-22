"use client";

import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { useEffect, useRef, useState } from "react";

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

/** Human-readable "time remaining" copy (BNH-21 acceptance criteria). */
function remainingLabel(remainingMs: number, estimatedMs: number): string {
  if (estimatedMs <= 0) return "Estimating time…";
  if (remainingMs <= 15_000) return "Almost done…";
  if (remainingMs < 60_000) return "Less than a minute remaining";
  const mins = Math.round(remainingMs / 60_000);
  return `About ${mins} minute${mins === 1 ? "" : "s"} remaining`;
}

export function GenerationProgress({
  projectId,
}: {
  projectId: Id<"projects">;
}) {
  const generation = useQuery(api.generations.getLatestGeneration, {
    projectId,
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showLog, setShowLog] = useState(false);
  const [now, setNow] = useState(0);

  const log = generation?.progressLog ?? [];

  // Tick once per second to animate the bar + countdown. setTimeout(…, 0) is
  // async (not a synchronous setState in the effect body) so it paints quickly.
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const t0 = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => {
      clearTimeout(t0);
      clearInterval(id);
    };
  }, []);

  // Keep the (collapsed) terminal pinned to the newest line when open.
  useEffect(() => {
    if (showLog && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [log.length, showLog]);

  if (!generation) return null;

  const isRunning = generation.status === "running";
  const isFailed = generation.status === "failed";
  const isComplete = generation.status === "completed";

  const estimatedMs = generation.estimatedMs ?? 0;
  const totalCandidates = generation.totalCandidates ?? 0;
  const candidatesDone = generation.candidatesDone ?? 0;
  const elapsed = now > 0 ? Math.max(0, now - generation.startedAt) : 0;
  const remainingMs = Math.max(0, estimatedMs - elapsed);

  // Progress = the larger of elapsed-vs-estimate and completed-drafts, capped
  // below 100% until the run actually finishes so the bar never lies.
  const timeFraction = estimatedMs > 0 ? clamp(elapsed / estimatedMs, 0, 0.95) : 0;
  const milestoneFraction =
    totalCandidates > 0 ? candidatesDone / totalCandidates : 0;
  const progress = isRunning
    ? clamp(Math.max(timeFraction, milestoneFraction * 0.95), 0.02, 0.97)
    : isFailed
      ? Math.max(timeFraction, milestoneFraction)
      : 1;

  const currentLine =
    log.length > 0 ? log[log.length - 1] : generation.currentStep ?? "Warming up…";

  const totalMins = Math.round(estimatedMs / 60_000);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      {/* Heading */}
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-gray-900">
          {isRunning
            ? "Generating your report"
            : isComplete
              ? "Report generated"
              : "Generation failed"}
        </h3>
        {isRunning && (
          <span className="text-xs font-medium text-gray-400">
            {now > 0 ? remainingLabel(remainingMs, estimatedMs) : "Estimating time…"}
          </span>
        )}
      </div>

      {/* Progress bar */}
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-chrome">
        <div
          className={`h-full rounded-full transition-[width] duration-700 ease-out ${
            isFailed ? "bg-red-400" : isComplete ? "bg-green-500" : "bg-primary"
          }`}
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>

      {/* Subtle status line under the bar */}
      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="min-w-0 flex-1 truncate text-xs text-gray-500">
          {isRunning ? currentLine : isComplete ? "Done." : generation.error}
        </p>
        <div className="flex flex-shrink-0 items-center gap-2 text-xs text-gray-400">
          {isRunning && totalCandidates > 0 && (
            <span>
              Draft {Math.min(candidatesDone + 1, totalCandidates)} of{" "}
              {totalCandidates}
            </span>
          )}
        </div>
      </div>

      {/* Friendly up-front estimate (set the expectation, per the transcript) */}
      {isRunning && estimatedMs > 0 && (
        <p className="mt-2 text-xs text-gray-400">
          Estimated ~{totalMins < 1 ? "1" : totalMins} minute
          {totalMins === 1 ? "" : "s"} total
          {totalMins >= 3 ? " — grab a coffee ☕" : ""}.
        </p>
      )}

      {/* Low-emphasis activity log (kept, but no longer the focal point) */}
      {(isRunning || isComplete) && (
        <button
          onClick={() => setShowLog((v) => !v)}
          className="mt-3 inline-flex items-center gap-1 text-xs text-gray-400 transition-colors hover:text-gray-600"
        >
          <svg
            className={`h-3 w-3 transition-transform ${showLog ? "rotate-90" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          {showLog ? "Hide activity" : "Show activity"}
        </button>
      )}

      {showLog && (
        <div
          ref={scrollRef}
          className="mt-2 h-[180px] overflow-y-auto rounded-xl bg-navy px-4 py-3 font-mono text-[12px] leading-[1.7] text-white/85"
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
      )}

      {isFailed && generation.error && (
        <div className="mt-3 rounded-lg bg-red-50 px-3 py-2">
          <p className="text-sm text-red-700">{generation.error}</p>
        </div>
      )}
    </div>
  );
}
