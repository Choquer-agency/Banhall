export type GenerationRunStatus = "queued" | "running" | "succeeded" | "failed";

export type GenerationRecoveryModel = {
  model: string;
  label: string;
  status: GenerationRunStatus;
};

export function recoveryHeading(done: number, failed: number) {
  if (failed <= 0) return done > 0 ? "Drafts ready" : "Generating drafts";
  if (done > 0) {
    return `${failed} draft${failed === 1 ? " needs" : "s need"} another try`;
  }
  return "Draft generation stopped";
}

export function recoveryExplanation(done: number, failed: number) {
  if (failed <= 0) return "All requested drafts completed.";
  if (done > 0) {
    return `${done} draft${done === 1 ? " is" : "s are"} ready to review. Retry only the ${failed} that did not complete, or continue with the ready work.`;
  }
  return "No draft completed. You can restart the same request without uploading the project files again.";
}

export function runStatusLabel(status: GenerationRunStatus) {
  switch (status) {
    case "queued":
      return "Queued";
    case "running":
      return "Generating";
    case "succeeded":
      return "Ready";
    case "failed":
      return "Needs retry";
  }
}

/** Mirrors the `generations.status` union in convex/schema.ts. */
export type GenerationStatus =
  | "reserved"
  | "running"
  | "awaiting_selection"
  | "awaiting_input"
  | "completed"
  | "failed"
  | "superseded";

export function safeGenerationActivity(status: GenerationStatus, currentStep?: string) {
  if (status === "reserved") return "Preparing the project inputs.";
  if (status === "running") return "Generating report drafts.";
  if (status === "awaiting_selection") return "Drafts are ready for review.";
  if (status === "awaiting_input") return "Waiting for your section review.";
  if (status === "completed") return "Generation completed.";
  // CAP-7: a partial generation whose failed drafts were retried into a linked
  // recovery generation; that recovery run is the one to watch.
  if (status === "superseded") {
    return "This attempt was replaced by a retry of its failed drafts.";
  }
  if (currentStep?.toLowerCase().includes("timed out")) {
    return "Generation took too long and stopped safely.";
  }
  return "Generation stopped before all requested drafts completed.";
}
