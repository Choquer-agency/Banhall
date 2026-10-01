import { v, type Infer } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/**
 * A generation's heavy outputs, kept off the live-subscribed generation row
 * (2026-09-25): the agent outputs JSON (`agentOutputs`), the Brain exemplar
 * provenance (`brainProvenance`) and the retrieval brief
 * (`brainRetrievalBrief`). Each is one `generationArtifacts` row keyed by
 * (generationId, kind): `agent_outputs` and `brain_retrieval_brief` carry the
 * JSON text in `content`; `brain_provenance` carries the typed array.
 *
 * `generations.outputsInArtifactsAt` says where a row's outputs live. New
 * generations set it at reservation; an older row gets it from
 * `generations.backfillGenerationOutputs`, or from its first write after this
 * change, which copies the row's legacy values into artifact rows first. With
 * it set, readers use the artifact rows only; without it, the legacy fields on
 * the row (dual read). The legacy fields are never written again for a
 * migrated row and never cleared.
 */

export const brainProvenanceEntryValidator = v.object({
  entryId: v.string(),
  score: v.number(),
  title: v.optional(v.string()),
  writerName: v.optional(v.string()),
  section: v.optional(v.string()),
  sourceId: v.optional(v.string()),
  searchScore: v.optional(v.number()),
  rerankScore: v.optional(v.number()),
});
export type BrainProvenanceEntry = Infer<typeof brainProvenanceEntryValidator>;

type OutputKind = "agent_outputs" | "brain_retrieval_brief" | "brain_provenance";

type OutputFields = Pick<
  Doc<"generations">,
  "_id" | "agentOutputs" | "brainProvenance" | "brainRetrievalBrief" | "outputsInArtifactsAt"
>;

export function outputsInArtifacts(generation: Pick<Doc<"generations">, "outputsInArtifactsAt">) {
  return generation.outputsInArtifactsAt !== undefined;
}

/** The one artifact row of a kind (the first, should a race ever write two). */
export async function outputArtifact(
  ctx: { db: QueryCtx["db"] },
  generationId: Id<"generations">,
  kind: OutputKind
): Promise<Doc<"generationArtifacts"> | null> {
  return await ctx.db
    .query("generationArtifacts")
    .withIndex("by_generationId_and_kind", (q) =>
      q.eq("generationId", generationId).eq("kind", kind)
    )
    .first();
}

// ─── Reads (dual read) ───────────────────────────────────────────────────────

/** The generation's agent outputs JSON, or undefined when it has none yet. */
export async function readAgentOutputs(
  ctx: { db: QueryCtx["db"] },
  generation: OutputFields
): Promise<string | undefined> {
  if (!outputsInArtifacts(generation)) return generation.agentOutputs;
  return (await outputArtifact(ctx, generation._id, "agent_outputs"))?.content;
}

export async function readBrainProvenance(
  ctx: { db: QueryCtx["db"] },
  generation: OutputFields
): Promise<BrainProvenanceEntry[] | undefined> {
  if (!outputsInArtifacts(generation)) return generation.brainProvenance;
  return (await outputArtifact(ctx, generation._id, "brain_provenance"))?.brainProvenance;
}

export async function readBrainRetrievalBrief(
  ctx: { db: QueryCtx["db"] },
  generation: OutputFields
): Promise<string | undefined> {
  if (!outputsInArtifacts(generation)) return generation.brainRetrievalBrief;
  return (await outputArtifact(ctx, generation._id, "brain_retrieval_brief"))?.content;
}

// ─── Writes ──────────────────────────────────────────────────────────────────

async function upsertOutput(
  ctx: MutationCtx,
  generationId: Id<"generations">,
  kind: OutputKind,
  fields: { content: string; brainProvenance?: BrainProvenanceEntry[] }
) {
  const existing = await outputArtifact(ctx, generationId, kind);
  if (existing) {
    await ctx.db.patch(existing._id, fields);
    return;
  }
  await ctx.db.insert("generationArtifacts", { generationId, kind, ...fields });
}

/**
 * Move a row's outputs to artifact rows if they are not there yet: copy each
 * legacy value that exists (and has no artifact row) and stamp
 * `outputsInArtifactsAt`. The legacy fields are kept. Idempotent.
 * Returns whether the row was moved by this call.
 */
export async function moveOutputsToArtifacts(
  ctx: MutationCtx,
  generation: OutputFields,
  now: number = Date.now()
): Promise<boolean> {
  if (outputsInArtifacts(generation)) return false;
  if (
    generation.agentOutputs !== undefined &&
    !(await outputArtifact(ctx, generation._id, "agent_outputs"))
  ) {
    await ctx.db.insert("generationArtifacts", {
      generationId: generation._id,
      kind: "agent_outputs",
      content: generation.agentOutputs,
    });
  }
  if (
    generation.brainProvenance !== undefined &&
    !(await outputArtifact(ctx, generation._id, "brain_provenance"))
  ) {
    await ctx.db.insert("generationArtifacts", {
      generationId: generation._id,
      kind: "brain_provenance",
      content: "",
      brainProvenance: generation.brainProvenance,
    });
  }
  if (
    generation.brainRetrievalBrief !== undefined &&
    !(await outputArtifact(ctx, generation._id, "brain_retrieval_brief"))
  ) {
    await ctx.db.insert("generationArtifacts", {
      generationId: generation._id,
      kind: "brain_retrieval_brief",
      content: generation.brainRetrievalBrief,
    });
  }
  await ctx.db.patch(generation._id, { outputsInArtifactsAt: now });
  return true;
}

/** Store the generation's agent outputs JSON (replacing any earlier value). */
export async function writeAgentOutputs(
  ctx: MutationCtx,
  generation: OutputFields,
  agentOutputs: string
): Promise<void> {
  await moveOutputsToArtifacts(ctx, generation);
  await upsertOutput(ctx, generation._id, "agent_outputs", { content: agentOutputs });
}

/**
 * Store the Brain exemplars that fed the generation and the retrieval brief
 * behind them. A missing brief clears an earlier one, as the row field did.
 */
export async function writeBrainProvenance(
  ctx: MutationCtx,
  generation: OutputFields,
  exemplars: BrainProvenanceEntry[],
  brief: string | undefined
): Promise<void> {
  await moveOutputsToArtifacts(ctx, generation);
  await upsertOutput(ctx, generation._id, "brain_provenance", {
    content: "",
    brainProvenance: exemplars,
  });
  if (brief !== undefined) {
    await upsertOutput(ctx, generation._id, "brain_retrieval_brief", { content: brief });
    return;
  }
  const existing = await outputArtifact(ctx, generation._id, "brain_retrieval_brief");
  if (existing) await ctx.db.delete(existing._id);
}

/** A generation's agent outputs by id (dual read), for tests and ops tools. */
export async function agentOutputsOf(
  ctx: { db: QueryCtx["db"] },
  generationId: Id<"generations">
): Promise<string | undefined> {
  const generation = await ctx.db.get(generationId);
  return generation ? await readAgentOutputs(ctx, generation) : undefined;
}
