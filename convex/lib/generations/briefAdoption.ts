/**
 * Adopting a prepared Brief at the Step-by-step start (2026-09-26, owner
 * decision 65). The run's key is recomputed here, on the server, from the
 * run's own frozen sources and policy (convex/lib/briefPreparationKey.ts):
 *
 * - a ready preparation with that exact key is adopted: its entries are
 *   mapped to the run's `generationSources` through an explicit, verified
 *   source-by-source mapping, every entry is validated again (byte match
 *   and owner decision 25), and the result is published through the
 *   existing publication owner (`persistDerivedBriefHandler`) as a new
 *   generation-bound Brief. No model call and no usage row;
 * - a running preparation with that exact key gets a durable waiter; its
 *   completion, failure or lease expiry schedules the run's continuation
 *   (convex/briefPreparations.ts). Registration and completion are both
 *   mutations, so either order is handled;
 * - anything else is a miss, and the run derives its own Brief.
 *
 * A Brief the startup pin already chose (existing reuse, including a
 * writer's edited version) always wins over a preparation.
 */
import { internal } from "../../_generated/api";
import { v, type ObjectType } from "convex/values";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { domainError } from "../contracts";
import { requireSeedInitialization } from "./seedGuards";
import { MAX_BRIEF_ENTRY_ROWS, persistDerivedBriefHandler, readBriefSourceRows } from "./brief";
import { generationBriefKey } from "../briefPreparationKey";
import { briefPreparationEnabled } from "../../appSettings";
import {
  PREPARATION_READY_CONTENT_MS,
  QUEUED_ATTEMPT,
  QUEUED_WAITER_DEADLINE_MS,
  WAITER_DEADLINE_MS,
} from "../../briefPreparations";
import { validateCitation } from "../citations";
import { citationSpeakerReader } from "../citationSpeakers";
import { appendReadingFactsHandler, READING_FACTS_PER_WRITE, type ReadingFact } from "../readingFacts";
import { resolveGatedWorkflow } from "../gatedWorkflow";
import { isProjectDeleting } from "../projectDeletion";
import {
  initializeSeedStageHandler,
  recordSeedInitializationFailureHandler,
} from "./seedStage";

/** Display facts an adopted preparation hands to the run's Reading page. */
export const ADOPTED_FACTS = 200;

export const adoptPreparedBriefArgs = { generationId: v.id("generations"), inputsHash: v.string() };

export type PreparedBriefAdoption =
  | { kind: "adopted"; briefId: Id<"generationBriefs"> }
  | { kind: "attached" }
  | { kind: "miss" };

type Preparation = Doc<"briefPreparations">;

async function releaseAttachment(ctx: MutationCtx, generation: Doc<"generations">): Promise<void> {
  const attached = generation.briefPreparation;
  if (!attached || attached.state === "released") return;
  const now = Date.now();
  await ctx.db.patch(generation._id, { briefPreparation: { ...attached, state: "released", at: now } });
  const waiters = await ctx.db
    .query("briefPreparationWaiters")
    .withIndex("by_generationId", (q) => q.eq("generationId", generation._id))
    .take(10);
  for (const waiter of waiters) {
    if (waiter.status === "waiting") await ctx.db.patch(waiter._id, { status: "released", releasedAt: now });
  }
}

/**
 * The preparation's frozen rows mapped onto the run's, position by
 * position: same count, and each pair the same kind, the same transcript
 * or file, the same label, trust, cut and content hash. Equal text alone
 * never maps a row. Null when any pair disagrees.
 */
export function verifiedSourceMapping(
  preparationSources: readonly Doc<"briefPreparationSources">[],
  generationSources: readonly Doc<"generationSources">[]
): Map<Id<"briefPreparationSources">, Doc<"generationSources">> | null {
  if (preparationSources.length !== generationSources.length) return null;
  const mapping = new Map<Id<"briefPreparationSources">, Doc<"generationSources">>();
  for (let index = 0; index < preparationSources.length; index += 1) {
    const from = preparationSources[index];
    const to = generationSources[index];
    if (
      from.kind !== to.kind ||
      (from.transcriptId ?? null) !== (to.transcriptId ?? null) ||
      (from.projectDocumentId ?? null) !== (to.projectDocumentId ?? null) ||
      from.label !== to.label ||
      (from.uploaderRole ?? null) !== (to.uploaderRole ?? null) ||
      from.truncated !== to.truncated ||
      from.originalLength !== to.originalLength ||
      from.contentHash !== to.contentHash ||
      from.content !== to.content
    ) {
      return null;
    }
    mapping.set(from._id, to);
  }
  return mapping;
}

/** The newest preparation of this project with this key that is ready or running. */
async function preparationForKey(
  ctx: { db: QueryCtx["db"] },
  projectId: Id<"projects">,
  key: string
): Promise<Preparation | null> {
  const rows = await ctx.db
    .query("briefPreparations")
    .withIndex("by_projectId_and_key", (q) => q.eq("projectId", projectId).eq("key", key))
    .order("desc")
    .take(20);
  return rows.find((row) => row.status === "ready" || row.status === "running") ?? null;
}

/**
 * A project run started while the preparation confirmed for exactly its
 * files is still queued (2026-09-27, fourth, lead decision): its slot is
 * still being freed by the reading it replaced. The run waits on it as on a
 * running one, for at most QUEUED_WAITER_DEADLINE_MS before it dispatches;
 * once it runs, the usual wait applies, and its key is checked at adoption
 * as always. Null when there is no such preparation.
 */
async function attachToQueued(ctx: MutationCtx, generation: Doc<"generations">): Promise<PreparedBriefAdoption | null> {
  const now = Date.now();
  const sorted = (ids: readonly string[] | undefined) => JSON.stringify([...(ids ?? [])].sort());
  const queued = (
    await ctx.db
      .query("briefPreparations")
      .withIndex("by_projectId_and_status", (q) => q.eq("projectId", generation.projectId).eq("status", "queued"))
      .take(5)
  ).find(
    (row) =>
      row.confirmedAt !== undefined &&
      row.confirmedAt > now - QUEUED_WAITER_DEADLINE_MS &&
      sorted(row.excludedTranscriptIds) === sorted(generation.excludedSources?.transcriptIds) &&
      sorted(row.excludedDocumentIds) === sorted(generation.excludedSources?.documentIds)
  );
  if (!queued) return null;
  const deadlineAt = now + QUEUED_WAITER_DEADLINE_MS;
  const waiterId = await ctx.db.insert("briefPreparationWaiters", {
    preparationId: queued._id,
    projectId: generation.projectId,
    generationId: generation._id,
    attemptId: QUEUED_ATTEMPT,
    status: "waiting",
    registeredAt: now,
    deadlineAt,
  });
  await ctx.scheduler.runAfter(QUEUED_WAITER_DEADLINE_MS, internal.briefPreparations.checkBriefWaiter, { waiterId });
  await ctx.db.patch(generation._id, {
    briefPreparation: { preparationId: queued._id, attemptId: QUEUED_ATTEMPT, state: "attached", at: now },
  });
  return { kind: "attached" };
}

async function adopt(
  ctx: MutationCtx,
  generation: Doc<"generations">,
  preparation: Preparation,
  sources: Doc<"generationSources">[],
  args: ObjectType<typeof adoptPreparedBriefArgs>
): Promise<PreparedBriefAdoption> {
  const preparationSources = await ctx.db
    .query("briefPreparationSources")
    .withIndex("by_preparationId", (q) => q.eq("preparationId", preparation._id))
    .take(sources.length + 1);
  const mapping = verifiedSourceMapping(preparationSources, sources);
  if (!mapping || !preparation.attemptId || !preparation.key || !preparation.planningModel) return { kind: "miss" };
  const entries = await ctx.db
    .query("briefPreparationEntries")
    .withIndex("by_preparationId", (q) => q.eq("preparationId", preparation._id))
    .take(MAX_BRIEF_ENTRY_ROWS + 1);
  if (entries.length > MAX_BRIEF_ENTRY_ROWS) return { kind: "miss" };
  // Every entry again, on the run's own rows: the mapped row must hold the
  // cited bytes, and the span must still be evidence under decision 25.
  const speakerOf = citationSpeakerReader(ctx);
  let dropped = 0;
  const mapped = [];
  for (const entry of entries) {
    const target = mapping.get(entry.sourceId);
    if (
      !target ||
      target.contentHash !== entry.sourceContentHash ||
      !validateCitation(target, entry) ||
      (await speakerOf(target, entry.startOffset, entry.endOffset)) === "excluded"
    ) {
      dropped += 1;
      continue;
    }
    mapped.push({
      group: entry.group,
      text: entry.text,
      ...(entry.reason ? { reason: entry.reason } : {}),
      ...(entry.confidence ? { confidence: entry.confidence } : {}),
      sourceId: target._id,
      sourceContentHash: entry.sourceContentHash,
      startOffset: entry.startOffset,
      endOffset: entry.endOffset,
      exactExcerpt: entry.exactExcerpt,
    });
  }
  const briefId = await persistDerivedBriefHandler(ctx, {
    projectId: generation.projectId,
    generationId: generation._id,
    inputsHash: args.inputsHash,
    origin: "derived",
    seedStartup: true,
    storylineText: preparation.storylineText ?? "",
    entries: mapped,
    upstreamDroppedEntryCount: (preparation.droppedEntryCount ?? 0) + dropped,
    baselineBriefId: null,
    baselineRetained: [],
    baselineRemoved: [],
  });
  if (!briefId) return { kind: "miss" };
  const now = Date.now();
  await ctx.db.patch(briefId, {
    preparation: {
      preparationId: preparation._id,
      attemptId: preparation.attemptId,
      key: preparation.key,
      model: preparation.planningModel,
      preparedAt: preparation.completedAt ?? now,
    },
  });
  await ctx.db.patch(generation._id, {
    briefPreparation: { preparationId: preparation._id, attemptId: preparation.attemptId, state: "adopted", at: now },
  });
  await ctx.db.patch(preparation._id, {
    adoptedCount: (preparation.adoptedCount ?? 0) + 1,
    lastAdoptedAt: now,
    // A ready copy's content lives 7 days past its last adoption.
    ...(preparation.status === "ready" ? { contentExpiresAt: now + PREPARATION_READY_CONTENT_MS } : {}),
    updatedAt: now,
  });
  const waiters = await ctx.db
    .query("briefPreparationWaiters")
    .withIndex("by_generationId", (q) => q.eq("generationId", generation._id))
    .take(10);
  for (const waiter of waiters) {
    if (waiter.status === "waiting") await ctx.db.patch(waiter._id, { status: "released", releasedAt: now });
  }
  // The attempt's display facts become the run's at once: no replay.
  const facts = await ctx.db
    .query("briefPreparationFacts")
    .withIndex("by_preparationId_and_attemptId_and_seq", (q) =>
      q.eq("preparationId", preparation._id).eq("attemptId", preparation.attemptId!)
    )
    .take(ADOPTED_FACTS);
  const shown: ReadingFact[] = facts.map((fact) => ({
    chip: fact.chip,
    quote: fact.quote,
    sourceLabel: fact.sourceLabel,
    ...(fact.speaker ? { speaker: fact.speaker } : {}),
    ...(fact.line !== undefined ? { line: fact.line } : {}),
  }));
  for (let at = 0; at < shown.length; at += READING_FACTS_PER_WRITE) {
    await appendReadingFactsHandler(ctx, {
      generationId: generation._id,
      facts: shown.slice(at, at + READING_FACTS_PER_WRITE),
    });
  }
  return { kind: "adopted", briefId };
}

/** Handler of generations.adoptPreparedBrief. */
export async function adoptPreparedBriefHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof adoptPreparedBriefArgs>
): Promise<PreparedBriefAdoption> {
  const generation = await requireSeedInitialization(ctx, args.generationId);
  if (generation.seedBriefPin === undefined || generation.seedBriefInputsHash !== args.inputsHash) {
    domainError("INVALID_STATE", "Pin the startup Brief before adopting a preparation");
  }
  if (generation.briefId || generation.seedBriefPin !== null) return { kind: "miss" };
  if (generation.briefPreparation?.state === "adopted") return { kind: "miss" };
  // A run let go of its wait (the deadline, a failure) never waits again,
  // but may still adopt a ready preparation with its key instead of paying
  // for its own Brief.
  const released = generation.briefPreparation?.state === "released";
  const attached = released ? undefined : generation.briefPreparation;
  if (!(await briefPreparationEnabled(ctx))) {
    await releaseAttachment(ctx, generation);
    return { kind: "miss" };
  }
  // Every Step-by-step start comes here: with no ready or running
  // preparation for the project (one index read each), there is nothing to
  // compare and no key is computed (Opus review P3-4).
  if (!attached) {
    const candidate =
      (await ctx.db
        .query("briefPreparations")
        .withIndex("by_projectId_and_status", (q) => q.eq("projectId", generation.projectId).eq("status", "ready"))
        .first()) ??
      (released
        ? null
        : await ctx.db
            .query("briefPreparations")
            .withIndex("by_projectId_and_status", (q) => q.eq("projectId", generation.projectId).eq("status", "running"))
            .first());
    if (!candidate) return (released ? null : await attachToQueued(ctx, generation)) ?? { kind: "miss" };
  }
  const sources = await readBriefSourceRows(ctx, generation._id);
  const key = await generationBriefKey(ctx, generation, sources);
  const preparation = attached
    ? await ctx.db.get(attached.preparationId)
    : await preparationForKey(ctx, generation.projectId, key);
  if (
    !preparation ||
    preparation.projectId !== generation.projectId ||
    preparation.key !== key ||
    preparation.contentPurgedAt !== undefined ||
    (attached && preparation.attemptId !== attached.attemptId)
  ) {
    if (!attached && !released) {
      const waiting = await attachToQueued(ctx, generation);
      if (waiting) return waiting;
    }
    await releaseAttachment(ctx, generation);
    return { kind: "miss" };
  }
  if (preparation.status === "running") {
    if (released) return { kind: "miss" };
    if (attached) return { kind: "attached" };
    if (!preparation.attemptId || (preparation.leaseExpiresAt ?? 0) < Date.now()) return { kind: "miss" };
    const now = Date.now();
    // The wait is bounded (Opus review P2-1): checkBriefWaiter looks at the
    // attempt's action job every minute and lets the run go at the deadline.
    const deadlineAt = Math.max((preparation.dispatchedAt ?? now) + WAITER_DEADLINE_MS, now + 60_000);
    const waiterId = await ctx.db.insert("briefPreparationWaiters", {
      preparationId: preparation._id,
      projectId: generation.projectId,
      generationId: generation._id,
      attemptId: preparation.attemptId,
      status: "waiting",
      registeredAt: now,
      deadlineAt,
    });
    await ctx.scheduler.runAfter(Math.min(60_000, deadlineAt - now), internal.briefPreparations.checkBriefWaiter, { waiterId });
    await ctx.db.patch(generation._id, {
      briefPreparation: { preparationId: preparation._id, attemptId: preparation.attemptId, state: "attached", at: now },
    });
    return { kind: "attached" };
  }
  // An attached run adopts its own attempt even if a newer key has since
  // made it obsolete for everyone else: its evidence is frozen.
  const adoptable = preparation.status === "ready" || (attached !== undefined && preparation.status === "obsolete" && preparation.completedAt !== undefined);
  if (!adoptable) {
    await releaseAttachment(ctx, generation);
    return { kind: "miss" };
  }
  const result = await adopt(ctx, generation, preparation, sources, args);
  if (result.kind === "miss") await releaseAttachment(ctx, generation);
  return result;
}

export const openSeedStageAfterBriefArgs = {
  generationId: v.id("generations"),
  outcome: v.optional(v.union(v.literal("ready"), v.literal("failed"))),
};

/**
 * The join of the two halves of a Step-by-step start whose Brief came from
 * a preparation's continuation: the start action (after the writer style
 * is frozen; no `outcome`) and the continuation (with the Brief's
 * `outcome`). Whichever runs second opens the seed stage, or records the
 * retryable failure. Both are mutations, so the two orders are the only
 * cases.
 */
export async function openSeedStageAfterBriefHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof openSeedStageAfterBriefArgs>
): Promise<"opened" | "waiting" | "failed" | "inactive"> {
  const generation = await ctx.db.get(args.generationId);
  if (
    !generation ||
    resolveGatedWorkflow(generation) !== "seeds" ||
    generation.status !== "running" ||
    generation.summaryVersionId ||
    (await isProjectDeleting(ctx, generation.projectId))
  ) {
    return "inactive";
  }
  const project = await ctx.db.get(generation.projectId);
  if (project?.activeGenerationId !== generation._id) return "inactive";
  const styleFrozen =
    (await ctx.db
      .query("generationArtifacts")
      .withIndex("by_generationId_and_kind", (q) => q.eq("generationId", generation._id).eq("kind", "writer_style"))
      .first()) !== null ||
    (await ctx.db
      .query("generationArtifacts")
      .withIndex("by_generationId_and_kind", (q) => q.eq("generationId", generation._id).eq("kind", "brain_blocks"))
      .first()) !== null;
  const outcome = args.outcome ?? (generation.briefId ? "ready" : generation.seedBriefOutcome);
  if (args.outcome && !styleFrozen) {
    await ctx.db.patch(generation._id, { seedBriefOutcome: args.outcome });
    return "waiting";
  }
  if (!styleFrozen || outcome === undefined) return "waiting";
  if (outcome === "failed" || !generation.briefId) {
    await recordSeedInitializationFailureHandler(ctx, { generationId: generation._id });
    return "failed";
  }
  await initializeSeedStageHandler(ctx, { generationId: generation._id });
  return "opened";
}
