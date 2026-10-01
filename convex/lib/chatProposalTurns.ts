/**
 * 2026-10-01 (first), alerts triage: which chat turn a proposal saved without
 * its `promptMessageId` belongs to.
 *
 * A thread runs one turn at a time (security wave 1, a4 #17), so a proposal
 * belongs to the one turn of its thread whose run window holds the proposal's
 * `createdAt`: `startedAt <= createdAt <= endedAt`. A turn without both ends
 * (never started, or still running) holds nothing. Two turns that both hold
 * the time (possible only for turns from before the one-turn rule) make the
 * answer ambiguous, and the caller leaves the proposal alone.
 *
 * Pure, so the backfill (`chatV2.backfillProposalPromptMessageIds`) and the
 * defensive read in `chatV2.listProposals` judge a row the same way.
 */

export type TurnWindow = {
  promptMessageId: string;
  startedAt?: number;
  endedAt?: number;
};

export type ProposalTurnMatch<T extends TurnWindow> =
  | { kind: "match"; turn: T }
  | { kind: "none" }
  | { kind: "ambiguous" };

export function turnHolds(turn: TurnWindow, createdAt: number): boolean {
  return (
    turn.startedAt !== undefined &&
    turn.endedAt !== undefined &&
    turn.startedAt <= createdAt &&
    createdAt <= turn.endedAt
  );
}

export function matchProposalTurn<T extends TurnWindow>(
  createdAt: number,
  turns: ReadonlyArray<T>
): ProposalTurnMatch<T> {
  const holding = turns.filter((turn) => turnHolds(turn, createdAt));
  if (holding.length === 0) return { kind: "none" };
  // Two rows of one turn (a duplicate prompt id) are still one answer.
  const prompts = new Set(holding.map((turn) => turn.promptMessageId));
  if (prompts.size > 1) return { kind: "ambiguous" };
  return { kind: "match", turn: holding[0]! };
}
