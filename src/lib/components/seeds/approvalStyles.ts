/**
 * Step approval buttons (ui-design-final.md section 3, boards 3.1, 3.6, 3.7):
 * full width, 36px in the Outline footer and 44px with a 10px radius in the
 * phone bottom bar. A disabled approval is a quiet gray-50 fill with faint
 * ink, not a faded primary.
 */
export function approvalButtonClass(layout: "outline" | "bar") {
  const size = layout === "bar" ? "h-11 rounded-[10px]" : "h-9";
  return `w-full ${size} disabled:bg-gray-50! disabled:text-ink-faint! disabled:opacity-100!`;
}
