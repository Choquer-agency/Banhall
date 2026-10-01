import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { OrderedPayload } from "./orderedChain";

/**
 * The ordered chain's frozen payload (analysis, Brain blocks, style inputs,
 * the Writer Profile context and, for a signed-off seed run, the Summary
 * version), persisted once per candidate chain as a `generationArtifacts` row
 * of kind `ordered_payload` (2026-09-25). The chain's scheduled actions
 * receive the row's id (`payloadId`) and load the payload, instead of every
 * scheduled call carrying the whole payload in its arguments.
 *
 * Compatibility: chains scheduled before this change still carry `payload`
 * in their arguments; every function that took a payload keeps accepting it,
 * prefers it when present, and forwards whichever form it received.
 */

/** Candidate chains per generation are bounded (compare runs two, plus a
 * ghost); this is slack so the read is bounded and provably complete. */
const MAX_PAYLOAD_ROWS = 20;

export type OrderedPayloadRef =
  | { payloadId: Id<"generationArtifacts"> }
  | { payload: OrderedPayload };

async function payloadRows(
  ctx: { db: QueryCtx["db"] },
  generationId: Id<"generations">
) {
  return await ctx.db
    .query("generationArtifacts")
    .withIndex("by_generationId_and_kind", (q) =>
      q.eq("generationId", generationId).eq("kind", "ordered_payload")
    )
    .take(MAX_PAYLOAD_ROWS);
}

/** The payload row already stored for one candidate chain, if any. */
export async function findOrderedPayloadId(
  ctx: { db: QueryCtx["db"] },
  generationId: Id<"generations">,
  candidateRunId: Id<"generationCandidateRuns">
): Promise<Id<"generationArtifacts"> | null> {
  const row = (await payloadRows(ctx, generationId)).find(
    (candidate) => candidate.candidateRunId === candidateRunId
  );
  return row?._id ?? null;
}

/** Store a chain's payload once and return its id (an existing row for the
 * same candidate chain is reused). */
export async function persistOrderedPayload(
  ctx: MutationCtx,
  generationId: Id<"generations">,
  candidateRunId: Id<"generationCandidateRuns">,
  payload: OrderedPayload
): Promise<Id<"generationArtifacts">> {
  const existing = await findOrderedPayloadId(ctx, generationId, candidateRunId);
  if (existing) return existing;
  return await ctx.db.insert("generationArtifacts", {
    generationId,
    kind: "ordered_payload",
    content: "",
    candidateRunId,
    orderedPayload: payload,
  });
}

/** Load a stored payload, or null when the id is not this generation's
 * ordered payload. */
export async function loadOrderedPayload(
  ctx: { db: QueryCtx["db"] },
  generationId: Id<"generations">,
  payloadId: Id<"generationArtifacts">
): Promise<OrderedPayload | null> {
  const row = await ctx.db.get(payloadId);
  if (
    !row ||
    row.generationId !== generationId ||
    row.kind !== "ordered_payload" ||
    !row.orderedPayload
  ) {
    return null;
  }
  return row.orderedPayload;
}

/** The payload a function received, in either form. */
export async function resolveOrderedPayload(
  ctx: { db: QueryCtx["db"] },
  generationId: Id<"generations">,
  args: { payload?: OrderedPayload; payloadId?: Id<"generationArtifacts"> }
): Promise<OrderedPayload | null> {
  if (args.payload) return args.payload;
  if (args.payloadId) return await loadOrderedPayload(ctx, generationId, args.payloadId);
  return null;
}

/** The argument form to forward to the next scheduled step: the id when the
 * chain has one, else the payload it was given (a chain scheduled before the
 * payload was stored). */
export function forwardOrderedPayload(args: {
  payload?: OrderedPayload;
  payloadId?: Id<"generationArtifacts">;
}): { payloadId: Id<"generationArtifacts"> } | { payload: OrderedPayload } | Record<string, never> {
  if (args.payloadId) return { payloadId: args.payloadId };
  if (args.payload) return { payload: args.payload };
  return {};
}
