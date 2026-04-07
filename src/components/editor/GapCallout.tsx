"use client";

/**
 * Renders [GAP: ...] placeholders as visually distinct callout blocks.
 * Used in the QA scorecard and as a reference — in the editor itself,
 * GAP markers are rendered via Tiptap highlight marks with amber styling.
 */
export function GapCallout({ text }: { text: string }) {
  // Extract the description from [GAP: description]
  const match = text.match(/\[GAP:\s*(.+?)\]/);
  const description = match ? match[1] : text;

  return (
    <div className="my-3 flex items-start gap-2.5 rounded-lg border border-amber-200 bg-gap-bg px-4 py-3">
      <svg
        className="mt-0.5 h-4 w-4 flex-shrink-0 text-gap-text"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z"
        />
      </svg>
      <div>
        <p className="text-xs font-semibold text-gap-text">
          Information needed
        </p>
        <p className="mt-0.5 text-sm text-gap-text">{description}</p>
      </div>
    </div>
  );
}
