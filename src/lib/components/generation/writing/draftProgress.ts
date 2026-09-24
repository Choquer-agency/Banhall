import type { SeedDraftProgress, SeedDraftSection } from "./types";

/** Clamp a reported percent to a whole number between 0 and 100. */
export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

/**
 * The pill only moves forward (ui-design-final.md section 6 and acceptance):
 * a regressed value from the server keeps the highest percent already shown.
 */
export function forwardPercent(previous: number, next: number): number {
  return Math.max(clampPercent(previous), clampPercent(next));
}

/**
 * Honest time text. Null estimate: no time text at all.
 * Under a minute: "less than a minute left". Otherwise whole minutes.
 */
export function remainingTimeText(estimatedRemainingMs: number | null | undefined): string | null {
  if (estimatedRemainingMs == null || !Number.isFinite(estimatedRemainingMs)) return null;
  if (estimatedRemainingMs < 60_000) return "less than a minute left";
  const minutes = Math.round(estimatedRemainingMs / 60_000);
  return minutes === 1 ? "about 1 minute left" : `about ${minutes} minutes left`;
}

/** "55%, about 1 minute left" or "55%" when there is no estimate. */
export function progressText(percent: number, estimatedRemainingMs: number | null | undefined): string {
  const time = remainingTimeText(estimatedRemainingMs);
  return time ? `${clampPercent(percent)}%, ${time}` : `${clampPercent(percent)}%`;
}

export function sectionByKey(
  progress: Pick<SeedDraftProgress, "sections">,
  key: string | null | undefined
): SeedDraftSection | null {
  if (!key) return null;
  return progress.sections.find((section) => section.key === key) ?? null;
}

/** Headline of the status pill for the live phases, null when no pill shows. */
export function pillHeadline(progress: SeedDraftProgress): string | null {
  if (progress.phase === "drafting") {
    const current =
      sectionByKey(progress, progress.currentSectionKey) ??
      progress.sections.find((section) => section.status === "writing") ??
      null;
    return current ? `Writing section ${current.number}` : "Starting the draft";
  }
  if (progress.phase === "stopping") {
    const after =
      sectionByKey(progress, progress.stoppedAfterSectionKey) ??
      sectionByKey(progress, progress.currentSectionKey);
    return after ? `Stopping after section ${after.number}` : "Stopping";
  }
  return null;
}

/** Sections in report order. */
export function orderedSections(sections: readonly SeedDraftSection[]): SeedDraftSection[] {
  return [...sections].sort((a, b) => a.orderIndex - b.orderIndex);
}

/** "section 246", "sections 244 and 246", "sections 242, 244 and 246". */
export function sectionListText(numbers: readonly string[]): string {
  if (numbers.length === 0) return "";
  if (numbers.length === 1) return `section ${numbers[0]}`;
  const head = numbers.slice(0, -1).join(", ");
  return `sections ${head} and ${numbers[numbers.length - 1]}`;
}

/** Stagger for revealed paragraphs: 60ms apart, capped after the fifth. */
export function revealDelayMs(index: number): number {
  return Math.min(Math.max(0, index), 4) * 60;
}

/**
 * The latest "Draft the rest" attempt, as `getSeedDraftProgress` reports it
 * in its optional `redraft` field: its terminal status and a sanitized error.
 * Read defensively, so a progress read without the field (or with an
 * unexpected shape) means "no attempt known" rather than a crash.
 */
export type SeedRedraftAttempt = {
  status: "running" | "failed" | "done";
  error: string | null;
  attemptId: string;
};

export function seedRedraftAttempt(progress: unknown): SeedRedraftAttempt | null {
  if (!progress || typeof progress !== "object") return null;
  const redraft = (progress as { redraft?: unknown }).redraft;
  if (!redraft || typeof redraft !== "object") return null;
  const { status, error, attemptId } = redraft as Record<string, unknown>;
  if (status !== "running" && status !== "failed" && status !== "done") return null;
  if (typeof attemptId !== "string" && typeof attemptId !== "number") return null;
  const message = typeof error === "string" && error.trim() ? error.trim() : null;
  return { status, error: message, attemptId: String(attemptId) };
}
