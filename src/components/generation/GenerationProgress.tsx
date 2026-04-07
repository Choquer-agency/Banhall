"use client";

import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";

const STEP_LABELS = [
  "Analyzing transcript...",
  "Drafting sections 242, 244, 246...",
  "Running quality check...",
  "Assembling report...",
  "Complete",
];

export function GenerationProgress({
  projectId,
}: {
  projectId: Id<"projects">;
}) {
  const generation = useQuery(api.generations.getLatestGeneration, {
    projectId,
  });

  if (!generation) return null;

  const isRunning = generation.status === "running";
  const isFailed = generation.status === "failed";
  const isComplete = generation.status === "completed";

  // Determine which step we're on
  const currentStepIndex = STEP_LABELS.findIndex(
    (label) => label === generation.currentStep
  );
  const activeStep = currentStepIndex >= 0 ? currentStepIndex : 0;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6">
      <div className="flex items-center gap-3 mb-4">
        {isRunning && (
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-navy border-t-transparent" />
        )}
        {isComplete && (
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-green-100">
            <svg
              className="h-3 w-3 text-green-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={3}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
        )}
        {isFailed && (
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-red-100">
            <svg
              className="h-3 w-3 text-red-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={3}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </div>
        )}
        <h3 className="text-sm font-semibold text-gray-900">
          {isRunning
            ? "Generating report..."
            : isComplete
              ? "Report generated"
              : "Generation failed"}
        </h3>
      </div>

      {/* Step indicators */}
      <div className="space-y-2">
        {STEP_LABELS.map((label, i) => {
          const isPast = isComplete || i < activeStep;
          const isCurrent = isRunning && i === activeStep;
          const isFuture = !isPast && !isCurrent;

          return (
            <div key={label} className="flex items-center gap-2.5">
              <div
                className={`h-2 w-2 rounded-full ${
                  isPast
                    ? "bg-green-500"
                    : isCurrent
                      ? "bg-navy animate-pulse"
                      : "bg-gray-200"
                }`}
              />
              <span
                className={`text-sm ${
                  isPast
                    ? "text-gray-500"
                    : isCurrent
                      ? "text-navy font-medium"
                      : isFuture
                        ? "text-gray-300"
                        : "text-gray-400"
                }`}
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>

      {isFailed && generation.error && (
        <div className="mt-4 rounded-lg bg-red-50 px-3 py-2">
          <p className="text-sm text-red-700">{generation.error}</p>
        </div>
      )}
    </div>
  );
}
