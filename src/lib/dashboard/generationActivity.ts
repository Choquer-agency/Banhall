export type GenerationActivity = "generating" | "awaiting_selection" | "awaiting_input";

export const GENERATION_ACTIVITY_LABELS: Record<GenerationActivity, string> = {
  generating: "AI · Generating",
  awaiting_selection: "Action needed · Choose draft",
  awaiting_input: "Action needed · Review section",
};

export function generationActivityLabel(activity: GenerationActivity | null | undefined) {
  return activity ? GENERATION_ACTIVITY_LABELS[activity] : null;
}
