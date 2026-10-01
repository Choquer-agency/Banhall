/**
 * Seed-step progress (boards F3, F5; decision 57): a seed batch is one
 * structured call with no progress signal, so the ring and the bar are a
 * time-based estimate from this run's own finished batches, held at 95%
 * until the ideas really show (open question 13).
 */
export type PendingSeedBatch = { status: "queued" | "running"; queuedAt: number; startedAt?: number } | null;

export type SeedProgress = {
  /** 0 to 95 while pending. */
  percent: number;
  /** Seconds left, rounded to 5; null when queued or over the estimate. */
  secondsLeft: number | null;
  /** "About 15 seconds left.", "Waiting to start." or "Almost ready." */
  phrase: string;
};

export function seedProgress(now: number, pending: PendingSeedBatch, expectedMs: number): SeedProgress {
  if (!pending || pending.status === "queued" || pending.startedAt === undefined) {
    return { percent: 0, secondsLeft: null, phrase: "Waiting to start." };
  }
  const elapsed = Math.max(0, now - pending.startedAt);
  const expected = expectedMs > 0 ? expectedMs : 20_000;
  const percent = Math.min(95, Math.round((elapsed / expected) * 100));
  const leftMs = expected - elapsed;
  if (leftMs <= 2_500) return { percent, secondsLeft: null, phrase: "Almost ready." };
  const secondsLeft = Math.max(5, Math.round(leftMs / 5_000) * 5);
  return { percent, secondsLeft, phrase: `About ${secondsLeft} seconds left.` };
}

/** The step pane's line: the first step reads the interview only. */
export function seedProgressLine(progress: SeedProgress, afterPicks: boolean): string {
  const lead = afterPicks
    ? "Writing ideas from the interview and your picks so far."
    : "Writing ideas from the interview.";
  return `${lead} ${progress.phrase}`;
}
