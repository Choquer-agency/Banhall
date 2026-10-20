import { v, type Infer } from "convex/values";
import { sectionNumberValidator } from "./orderedChain";

/**
 * Phase A of report chat parity (2026-10-19): the state a running chat turn
 * shows the writer, built by the server from turn state and fixed tool fields
 * only, never from model text. Shared by the `chatTurns` schema and the
 * internal mutations in `convex/chatV2.ts` that write it.
 */

/** What the reply is doing now. */
export const chatTurnPhaseValidator = v.union(
  v.literal("reading"),
  v.literal("thinking"),
  v.literal("tool"),
  v.literal("writing"),
  v.literal("retrying")
);

/**
 * `step` is the 1-based model request of the turn the phase belongs to (it
 * keeps counting across a recovery pass); 0 while the turn reads the report
 * before its first request. `since` is when the phase began (server time).
 * `tool` is set only for the "tool" phase and is always one of the chat's own
 * tool names; `section` is the Line that tool call names, when it names one.
 */
export const chatTurnProgressValidator = v.object({
  phase: chatTurnPhaseValidator,
  tool: v.optional(v.string()),
  section: v.optional(sectionNumberValidator),
  step: v.number(),
  since: v.number(),
});

export type ChatTurnProgress = Infer<typeof chatTurnProgressValidator>;
export type ChatTurnPhase = ChatTurnProgress["phase"];

/** Why a finished reply offers to continue. */
export const chatTurnContinuationReasonValidator = v.union(
  v.literal("lines_left"),
  v.literal("step_limit"),
  v.literal("cut_off")
);

/**
 * The structured Continue offer a turn ends with. `nextSection` is the first
 * Line, in build order, that still holds Deviations no proposal in this
 * conversation covers; `remaining` counts those Deviations across every Line.
 * Both are absent when the turn was not working through a deviation list.
 */
export const chatTurnContinuationValidator = v.object({
  reason: chatTurnContinuationReasonValidator,
  nextSection: v.optional(sectionNumberValidator),
  remaining: v.optional(v.number()),
});

export type ChatTurnContinuation = Infer<typeof chatTurnContinuationValidator>;
export type ChatTurnContinuationReason = ChatTurnContinuation["reason"];

/**
 * Phase B (2026-10-20), W2: a turn the server started to carry on a job on
 * its own (`chatV2.continueChain`). Absent on every turn a person sent.
 */
export const chatTurnOriginValidator = v.literal("auto_continue");

/**
 * Why a finished turn with a `continuation` did not continue on its own:
 * the project's daily chat budget is used up, the turn made no progress, or
 * an admin turned automatic continuing off (`ai.chatAutoContinue`).
 */
export const chatAutoContinueSkipValidator = v.union(
  v.literal("budget"),
  v.literal("no_progress"),
  v.literal("off")
);

export type ChatAutoContinueSkip = Infer<typeof chatAutoContinueSkipValidator>;

/**
 * The writer-role message an automatic link saves: the same text the
 * Continue button sends (`continueMessage` in src/lib/chat/turnParts.ts), so
 * the job and coverage logic (`isContinuePrompt`) treat it as a Continue.
 */
export function autoContinueMessage(continuation: ChatTurnContinuation): string {
  return continuation.nextSection ? `Continue with Line ${continuation.nextSection}.` : "Continue.";
}

/** Build order of the Lines, for "moved forward" (242, then 244, then 246). */
const LINE_RANK: Readonly<Record<string, number>> = { "242": 0, "244": 1, "246": 2 };

/**
 * Whether an automatic link that just finished moved the job on, compared
 * with every earlier turn of its chain (the links before it and the job's
 * own first turn, `earlier`). Review R1 P3-2: progress is fewer Deviations
 * left than the lowest count the chain has seen, or a next Line further on
 * in build order than any the chain has reached. A count or Line that
 * appears or disappears is not progress, so a chain can never loop by
 * flipping between offers (244 with 5 left, then no counts, then 244 with 5
 * left again), and two links with no counts at all stop it.
 */
export function chainLinkMadeProgress(
  earlier: ReadonlyArray<ChatTurnContinuation | undefined>,
  current: ChatTurnContinuation
): boolean {
  let lowest: number | undefined;
  let furthest: number | undefined;
  for (const offer of earlier) {
    if (offer?.remaining !== undefined) lowest = Math.min(lowest ?? offer.remaining, offer.remaining);
    const rank = offer?.nextSection !== undefined ? LINE_RANK[offer.nextSection] : undefined;
    if (rank !== undefined) furthest = Math.max(furthest ?? rank, rank);
  }
  if (current.remaining !== undefined && lowest !== undefined && current.remaining < lowest) return true;
  const rank = current.nextSection !== undefined ? LINE_RANK[current.nextSection] : undefined;
  return rank !== undefined && furthest !== undefined && rank > furthest;
}
