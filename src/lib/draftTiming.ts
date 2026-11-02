/**
 * Plain wording for how long a finished draft took (2026-11-02). The server
 * reads the times from stored stamps (convex/lib/generations/draftTiming.ts);
 * this only words them. Nothing to say gives "", and the caller shows nothing.
 */
export type DraftTimingView = {
  draftMs: number | null;
  stepByStepMs: number | null;
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "under 1 min", "12 min", "1 h 5 min", "2 h", "1 day 3 h", "2 days". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  if (ms < MINUTE) return "under 1 min";
  const minutes = Math.round(ms / MINUTE);
  if (minutes < 60) return `${minutes} min`;
  if (ms < DAY) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
  }
  const totalHours = Math.round(ms / HOUR);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  const dayLabel = `${days} ${days === 1 ? "day" : "days"}`;
  return hours === 0 ? dayLabel : `${dayLabel} ${hours} h`;
}

/**
 * "Drafted in 12 min", or for Step by step "Step by step took 1 h 5 min,
 * then 9 min to draft". Either part alone when only that part is known.
 */
export function draftTimingText(timing: DraftTimingView | null | undefined): string {
  if (!timing) return "";
  const draft = timing.draftMs === null ? "" : formatDuration(timing.draftMs);
  const steps = timing.stepByStepMs === null ? "" : formatDuration(timing.stepByStepMs);
  if (steps && draft) return `Step by step took ${steps}, then ${draft} to draft`;
  if (steps) return `Step by step took ${steps}`;
  if (draft) return `Drafted in ${draft}`;
  return "";
}
