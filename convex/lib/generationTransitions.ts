import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  findGenerationStatusTransition,
  generationFlowOf,
  isPostQaTransitionAllowed,
  isRedraftTransitionAllowed,
  POST_QA_RUNNING_REQUIRES_STATUS,
  REDRAFT_REQUIRES,
  type GenerationStatus,
  type PostQaState,
  type RedraftState,
} from "../../shared/generationTransitions";
import { domainError } from "./contracts";

/** Every writable field of a generation row except `status`, which only
 * `transitionGeneration` sets, and the legacy fields that moved to child
 * rows on 2026-09-25 (progress lines, agent outputs and Brain provenance),
 * which are never written to the row again. */
export type GenerationPatch = Partial<
  Omit<
    Doc<"generations">,
    | "_id"
    | "_creationTime"
    | "status"
    | "progressLog"
    | "agentOutputs"
    | "brainProvenance"
    | "brainRetrievalBrief"
  >
>;

function postQaStateOf(value: Doc<"generations">["postQaStatus"]): PostQaState {
  return value ?? "none";
}

function redraftStateOf(value: Doc<"generations">["redraft"]): RedraftState {
  return value?.status ?? "none";
}

function refuse(
  machine: "status" | "postQa" | "redraft",
  generation: Doc<"generations">,
  from: string,
  to: string
): never {
  domainError(
    "INVALID_TRANSITION",
    `This generation cannot move from ${from} to ${to}`,
    {
      machine,
      from,
      to,
      flow: generationFlowOf(generation),
      generationId: generation._id,
    }
  );
}

/**
 * Check one write against the declared machines (shared/generationTransitions.ts):
 * the status move for the row's flow (the flow is read before the write, so
 * sign-off is a seed-stage move), and any post-QA or redraft sub-state the
 * write carries. Throws `INVALID_TRANSITION` and writes nothing on a refusal.
 */
export function assertGenerationWriteAllowed(
  generation: Doc<"generations">,
  to: GenerationStatus,
  patch: GenerationPatch
): void {
  const flow = generationFlowOf(generation);
  if (!findGenerationStatusTransition(flow, generation.status, to)) {
    refuse("status", generation, generation.status, to);
  }
  if ("postQaStatus" in patch) {
    const from = postQaStateOf(generation.postQaStatus);
    const next = postQaStateOf(patch.postQaStatus);
    if (!(from === "none" && next === "none")) {
      if (!isPostQaTransitionAllowed(from, next)) refuse("postQa", generation, from, next);
      if (next === "running" && to !== POST_QA_RUNNING_REQUIRES_STATUS) {
        refuse("postQa", generation, `${from} (status ${to})`, next);
      }
    }
  }
  if ("redraft" in patch) {
    const from = redraftStateOf(generation.redraft);
    const next = redraftStateOf(patch.redraft);
    if (!isRedraftTransitionAllowed(from, next)) refuse("redraft", generation, from, next);
    if (to !== REDRAFT_REQUIRES.status || flow !== REDRAFT_REQUIRES.flow) {
      refuse("redraft", generation, `${from} (${flow}, status ${to})`, next);
    }
  }
}

/**
 * The one writer of `generations.status`. Moves `generation` (as read in this
 * transaction) to `to` and applies `patch` in the same write, or refuses an
 * undeclared move with `INVALID_TRANSITION` and writes nothing.
 */
export async function transitionGeneration(
  ctx: MutationCtx,
  generation: Doc<"generations">,
  to: GenerationStatus,
  patch: GenerationPatch = {}
): Promise<void> {
  assertGenerationWriteAllowed(generation, to, patch);
  await ctx.db.patch(generation._id, { ...patch, status: to });
}

/**
 * Change only the post-QA sub-state (and the fields that go with it) of a
 * generation whose status stays as it is.
 */
export async function transitionPostQa(
  ctx: MutationCtx,
  generation: Doc<"generations">,
  to: Exclude<PostQaState, "none">,
  patch: Omit<GenerationPatch, "postQaStatus" | "redraft"> = {}
): Promise<void> {
  const from = postQaStateOf(generation.postQaStatus);
  if (!isPostQaTransitionAllowed(from, to)) refuse("postQa", generation, from, to);
  if (to === "running" && generation.status !== POST_QA_RUNNING_REQUIRES_STATUS) {
    refuse("postQa", generation, `${from} (status ${generation.status})`, to);
  }
  await ctx.db.patch(generation._id, { ...patch, postQaStatus: to });
}

/**
 * Change the "Draft the rest" sub-state of a completed, signed-off seed
 * generation. `patch` may also start a post-QA pass in the same write.
 */
export async function transitionRedraft(
  ctx: MutationCtx,
  generation: Doc<"generations">,
  redraft: NonNullable<Doc<"generations">["redraft"]>,
  patch: Omit<GenerationPatch, "redraft"> = {}
): Promise<void> {
  const flow = generationFlowOf(generation);
  const from = redraftStateOf(generation.redraft);
  if (!isRedraftTransitionAllowed(from, redraft.status)) {
    refuse("redraft", generation, from, redraft.status);
  }
  if (generation.status !== REDRAFT_REQUIRES.status || flow !== REDRAFT_REQUIRES.flow) {
    refuse("redraft", generation, `${from} (${flow}, status ${generation.status})`, redraft.status);
  }
  if ("postQaStatus" in patch) {
    const qaFrom = postQaStateOf(generation.postQaStatus);
    const qaTo = postQaStateOf(patch.postQaStatus);
    if (!(qaFrom === "none" && qaTo === "none") && !isPostQaTransitionAllowed(qaFrom, qaTo)) {
      refuse("postQa", generation, qaFrom, qaTo);
    }
  }
  await ctx.db.patch(generation._id, { ...patch, redraft });
}
