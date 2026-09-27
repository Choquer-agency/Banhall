/**
 * Brief preparation, stage 1 (2026-09-26, owner decision 65; lead defaults
 * recorded in docs/product-domain.md, "2026-09-26 (seventh)").
 *
 * A writing project's Brief is prepared ahead of Generate from its current
 * evidence, so a Step-by-step run whose own frozen evidence and policy give
 * the same key (convex/lib/briefPreparationKey.ts) adopts it without a
 * Brief call (convex/lib/generations/briefAdoption.ts), or waits on the
 * running attempt instead of starting its own.
 *
 * Lifecycle, one attempt per row:
 *   queued -> running -> ready | failed
 *   queued | running | ready -> obsolete (a newer key replaced it)
 *   queued -> cancelled (not eligible, over a limit, or switched off)
 * Every write after the claim checks the attempt id and the lease, so a
 * late or replaced attempt writes nothing. Preparation is technical work:
 * it never writes a project's creator, owner, workflow stage or status,
 * report prose, seed choices or Summary sign-off, and never creates a
 * generation.
 */
import { v } from "convex/values";
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { briefPreparationEnabled, defaultModelId, transcriptFactsMode } from "./appSettings";
import { effectiveProjectType } from "../shared/projectTypes";
import { userMayEditReport } from "./lib/roleCapabilities";
import { findActiveGeneration } from "./lib/activeGeneration";
import { ACTIVE_GENERATION_STATUSES } from "../shared/generationTransitions";
import {
  currentYearTranscripts,
  decideInputMode,
  frozenPlaceholders,
  frozenSourceFields,
  frozenTranscriptChars,
  selectFrozenEvidence,
} from "./lib/briefEvidence";
import { TRANSCRIPT_PARSER_VERSION } from "../shared/transcriptParse";
import { scheduleStructureRebuildIfStale } from "./lib/transcripts";
import { listSpeakerRows } from "./lib/transcriptStructure";
import { needsModelRole } from "./lib/transcriptSpeakers";
import { freezeModelsForGeneration } from "./lib/modelRoles";
import { resolveGenerationStep } from "./lib/generationSteps";
import { MODEL } from "../shared/generationModels";
import { anthropicConfiguration, openRouterConfiguration } from "./lib/providerConfig";
import { briefPreparationKey } from "./lib/briefPreparationKey";
import { buildBriefUserMessage } from "./lib/briefRequest";
import {
  preparationDay,
  preparationLimitRefusal,
  preparationPricing,
  reservePreparationUsd,
} from "./lib/briefPreparationBudget";
import { firmDayNumber } from "../shared/firmTime";
import { citationSpeakerReader, type CitationSpeaker } from "./lib/citationSpeakers";
import { citationSpeakerValidator } from "./lib/generations/brief";
import { validateCitation } from "./lib/citations";
import { domainError } from "./lib/contracts";
import { boundQuote, readingFactValidator, READING_FACTS_PER_WRITE } from "./lib/readingFacts";
import {
  briefCandidateEntryValidator,
  MAX_CITATION_SPEAKER_SPANS,
  MAX_BRIEF_ENTRY_ROWS,
} from "./lib/generations/brief";
import { purgeStalePreparationsRef, startBriefPreparationRef, expirePreparationLeaseRef } from "./lib/briefPreparationRefs";
import { PREPARATION_DEBOUNCE_MS } from "./lib/briefPreparationTrigger";

/** How long one attempt may run: the action limit plus room to write. */
export const PREPARATION_LEASE_MS = 11 * 60 * 1000;
/** How long a failed, obsolete or cancelled preparation keeps its content. */
export const PREPARATION_RETENTION_MS = 24 * 60 * 60 * 1000;
/** Rows one purge transaction deletes. */
export const PREPARATION_PURGE_ROWS = 200;
/** Recently touched uploads a start waits for (a batch still arriving). */
const UPLOAD_SETTLE_MS = 2 * 60 * 1000;
/** How long after a transcript is added its model speaker roles may still land. */
const SPEAKER_SETTLE_MS = 2 * 60 * 1000;
/** Wait before trying again when the user or project already has one running. */
const SLOT_RETRY_MS = 30_000;
/** Times a queued preparation is pushed back before it is cancelled. */
const MAX_DEFERRALS = 10;
/** Frozen rows one preparation may hold (the generation bound, MAX_BRIEF_SOURCE_ROWS). */
const MAX_PREPARATION_SOURCES = 200;

type Preparation = Doc<"briefPreparations">;

/**
 * Releases every generation waiting on this preparation and schedules its
 * continuation, which adopts the result or derives its own Brief once.
 */
async function releaseWaiters(ctx: MutationCtx, preparation: Preparation): Promise<void> {
  const waiters = await ctx.db
    .query("briefPreparationWaiters")
    .withIndex("by_preparationId_and_status", (q) =>
      q.eq("preparationId", preparation._id).eq("status", "waiting")
    )
    .take(50);
  const now = Date.now();
  for (const waiter of waiters) {
    await ctx.db.patch(waiter._id, { status: "released", releasedAt: now });
    await ctx.scheduler.runAfter(0, internal.ai.iterative.continueAfterBriefPreparation, {
      generationId: waiter.generationId,
    });
  }
}

async function hasWaiters(ctx: MutationCtx, preparationId: Id<"briefPreparations">): Promise<boolean> {
  return (
    (await ctx.db
      .query("briefPreparationWaiters")
      .withIndex("by_preparationId_and_status", (q) => q.eq("preparationId", preparationId).eq("status", "waiting"))
      .first()) !== null
  );
}

/** Ends a preparation that will not (or no longer may) finish. */
async function endPreparation(
  ctx: MutationCtx,
  preparation: Preparation,
  status: "cancelled" | "obsolete" | "failed",
  reason: string
): Promise<void> {
  const now = Date.now();
  await ctx.db.patch(preparation._id, {
    status,
    ...(status === "failed" ? { failureCode: reason } : { endedReason: reason }),
    endedAt: now,
    updatedAt: now,
    waitingFor: undefined,
  });
  await releaseWaiters(ctx, preparation);
}

/** Pushes a queued preparation back, or cancels it after MAX_DEFERRALS. */
async function deferPreparation(
  ctx: MutationCtx,
  preparation: Preparation,
  waitingFor: "slot" | "uploads" | "structure",
  delayMs: number
): Promise<void> {
  const deferrals = (preparation.deferrals ?? 0) + 1;
  if (deferrals > MAX_DEFERRALS) {
    await endPreparation(
      ctx,
      preparation,
      "cancelled",
      waitingFor === "slot" ? "busy" : waitingFor === "uploads" ? "uploads_unsettled" : "speakers_unsettled"
    );
    return;
  }
  const revision = preparation.revision + 1;
  const scheduledJobId = await ctx.scheduler.runAfter(delayMs, startBriefPreparationRef, {
    preparationId: preparation._id,
    revision,
  });
  await ctx.db.patch(preparation._id, {
    revision,
    deferrals,
    waitingFor,
    runAt: Date.now() + delayMs,
    scheduledJobId,
    updatedAt: Date.now(),
  });
}

/**
 * Whether a transcript added in the last SPEAKER_SETTLE_MS still has a
 * rule-based speaker below the model threshold: its model classification
 * (ai/condense.ts classifySpeakerRoles) is probably still to land.
 */
async function speakersPending(
  ctx: MutationCtx,
  transcripts: readonly Doc<"transcripts">[],
  now: number
): Promise<boolean> {
  for (const transcript of transcripts) {
    if (transcript.createdAt < now - SPEAKER_SETTLE_MS) continue;
    const rows = await listSpeakerRows(ctx, transcript._id);
    if (rows.some((row) => row.roleSource === "heuristic" && needsModelRole(row))) return true;
  }
  return false;
}

/** Whether the configured transport can reach the planning model at all. */
function providerReady(gateway: "anthropic" | "openrouter"): boolean {
  return gateway === "openrouter"
    ? openRouterConfiguration().state === "configured"
    : anthropicConfiguration("generation").state === "configured";
}

/**
 * The debounced start: every eligibility rule and limit, then the claim.
 * Freezes the evidence, the placeholder map and the planning model, and
 * reserves the spend, in one transaction with the claim.
 */
export const startBriefPreparation = internalMutation({
  args: { preparationId: v.id("briefPreparations"), revision: v.number() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const preparation = await ctx.db.get(args.preparationId);
    if (!preparation || preparation.status !== "queued" || preparation.revision !== args.revision) return null;
    const now = Date.now();
    if (!(await briefPreparationEnabled(ctx))) {
      await endPreparation(ctx, preparation, "cancelled", "disabled");
      return null;
    }
    const project = await ctx.db.get(preparation.projectId);
    if (!project || project.deletionStartedAt !== undefined) {
      await endPreparation(ctx, preparation, "cancelled", "project_gone");
      return null;
    }
    if (effectiveProjectType(project) !== "writing") {
      await endPreparation(ctx, preparation, "cancelled", "not_writing");
      return null;
    }
    // Authority is the triggering editor's, checked again now.
    if (!(await userMayEditReport(ctx, await ctx.db.get(preparation.triggeredBy), project))) {
      await endPreparation(ctx, preparation, "cancelled", "not_authorized");
      return null;
    }
    // A run already going derives or adopts its own Brief.
    if (await findActiveGeneration(ctx, project, ACTIVE_GENERATION_STATUSES)) {
      await endPreparation(ctx, preparation, "cancelled", "generation_active");
      return null;
    }

    const evidence = await selectFrozenEvidence(ctx, project._id);
    // Historical ports from ingestion are never prepared.
    if (evidence.frozenDocuments.some(({ document }) => document.source === "ingestion_port")) {
      await endPreparation(ctx, preparation, "cancelled", "ingestion_port");
      return null;
    }
    const readable = evidence.transcripts.filter((row) => row.content.trim() !== "");
    const current = (await currentYearTranscripts(ctx, project, evidence.transcripts)).filter(
      (row) => row.content.trim() !== ""
    );
    if (current.length === 0) {
      await endPreparation(ctx, preparation, "cancelled", "no_transcript");
      return null;
    }
    // Speaker evidence must be settled: wait for the turn build, which asks
    // again when it finishes (transcripts.buildTranscriptStructure).
    const unsettled = readable.filter(
      (row) => row.parserVersion !== TRANSCRIPT_PARSER_VERSION || row.structureBuildId !== undefined
    );
    if (unsettled.length > 0) {
      for (const row of unsettled) await scheduleStructureRebuildIfStale(ctx, row);
      await ctx.db.patch(preparation._id, { waitingFor: "structure", updatedAt: now });
      return null;
    }
    // A new transcript's uncertain speakers go to the model right after its
    // turns are built, and the answer changes the key: wait for it (bounded;
    // recordModelSpeakerRoles asks again), rather than pay twice.
    if ((preparation.deferrals ?? 0) < MAX_DEFERRALS && (await speakersPending(ctx, readable, now))) {
      await deferPreparation(ctx, preparation, "structure", PREPARATION_DEBOUNCE_MS);
      return null;
    }
    // A batch of files still arriving: wait for it rather than prepare
    // without the rest of it.
    const uploads = await ctx.db
      .query("documentUploadAttempts")
      .withIndex("by_projectId", (q) => q.eq("projectId", project._id))
      .order("desc")
      .take(50);
    if (uploads.some((row) => row.status === "in_progress" && row.updatedAt > now - UPLOAD_SETTLE_MS)) {
      await deferPreparation(ctx, preparation, "uploads", PREPARATION_DEBOUNCE_MS);
      return null;
    }
    // Stage 1 prepares the full-text representation only: digests and fact
    // packs are later work, and such a run derives its own Brief.
    const inputMode = decideInputMode(frozenTranscriptChars(evidence));
    const factsMode = await transcriptFactsMode(ctx);
    const transcriptFacts =
      evidence.transcripts.length > 0 && (factsMode === "all" || (factsMode === "long" && inputMode === "digest"));
    if (inputMode !== "full" || transcriptFacts) {
      await endPreparation(ctx, preparation, "cancelled", "representation");
      return null;
    }

    // The planning role (decision 43), frozen for this preparation only.
    const modelFreeze = await freezeModelsForGeneration(ctx, [await defaultModelId(ctx)], now);
    const route = resolveGenerationStep({ freeze: modelFreeze, step: "brief", writerModel: MODEL });
    const entry = modelFreeze.entries.find((item) => item.id === route.model);
    if (!entry || !providerReady(entry.gateway)) {
      await endPreparation(ctx, preparation, "cancelled", "provider_unavailable");
      return null;
    }
    const pricing = await preparationPricing(ctx, route.model);
    if (!pricing) {
      await endPreparation(ctx, preparation, "cancelled", "pricing_unknown");
      return null;
    }

    const placeholders = await frozenPlaceholders(ctx, project, evidence);
    const fields = await frozenSourceFields(evidence);
    if (fields.length > MAX_PREPARATION_SOURCES) {
      await endPreparation(ctx, preparation, "cancelled", "too_many_sources");
      return null;
    }
    const key = await briefPreparationKey(ctx, {
      projectId: project._id,
      sources: fields,
      placeholders,
      inputMode,
      transcriptFacts: false,
      freeze: modelFreeze,
      writerModel: MODEL,
    });
    // The same key already prepared or preparing: nothing to buy.
    const same = await ctx.db
      .query("briefPreparations")
      .withIndex("by_projectId_and_key", (q) => q.eq("projectId", project._id).eq("key", key))
      .order("desc")
      .take(20);
    if (same.some((row) => row.status === "ready" || row.status === "running")) {
      await endPreparation(ctx, preparation, "cancelled", "duplicate");
      return null;
    }
    // Older keys are obsolete now. One a run is waiting on keeps running for
    // that run (its dependency is immutable); no new run can adopt it.
    for (const status of ["running", "ready"] as const) {
      const older = await ctx.db
        .query("briefPreparations")
        .withIndex("by_projectId_and_status", (q) => q.eq("projectId", project._id).eq("status", status))
        .take(20);
      for (const row of older) {
        if (row._id === preparation._id) continue;
        if (status === "running" && (await hasWaiters(ctx, row._id))) continue;
        await endPreparation(ctx, row, "obsolete", "superseded");
      }
    }
    // One running per project and per user.
    const projectRunning = await ctx.db
      .query("briefPreparations")
      .withIndex("by_projectId_and_status", (q) => q.eq("projectId", project._id).eq("status", "running"))
      .first();
    const userRunning = await ctx.db
      .query("briefPreparations")
      .withIndex("by_triggeredBy_and_status", (q) => q.eq("triggeredBy", preparation.triggeredBy).eq("status", "running"))
      .first();
    if (projectRunning || userRunning) {
      await deferPreparation(ctx, preparation, "slot", SLOT_RETRY_MS);
      return null;
    }
    // At most 20 paid starts per user per firm day; spend reserved before
    // the call against $0.50 per project and $5 per user per firm day.
    const firmDay = firmDayNumber(now);
    const reservedUsd = reservePreparationUsd(pricing, route.model, buildBriefUserMessage(fields).length);
    const refusal = preparationLimitRefusal(
      await preparationDay(ctx, { userId: preparation.triggeredBy, projectId: project._id, firmDay }),
      reservedUsd
    );
    if (refusal) {
      await endPreparation(ctx, preparation, "cancelled", refusal);
      return null;
    }

    for (const field of fields) {
      await ctx.db.insert("briefPreparationSources", {
        preparationId: preparation._id,
        projectId: project._id,
        ...field,
        capturedAt: now,
      });
    }
    const attemptId = crypto.randomUUID();
    await ctx.db.patch(preparation._id, {
      status: "running",
      attemptId,
      leaseExpiresAt: now + PREPARATION_LEASE_MS,
      key,
      modelFreeze,
      planningModel: route.model,
      placeholders,
      dispatchedAt: now,
      firmDay,
      reservedUsd,
      waitingFor: undefined,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.ai.brief.runBriefPreparation, {
      preparationId: preparation._id,
      attemptId,
    });
    await ctx.scheduler.runAfter(PREPARATION_LEASE_MS, expirePreparationLeaseRef, {
      preparationId: preparation._id,
      attemptId,
    });
    return null;
  },
});

/** The live attempt, or null: the fence every write after the claim uses. */
async function liveAttempt(
  ctx: { db: QueryCtx["db"] },
  preparationId: Id<"briefPreparations">,
  attemptId: string
): Promise<Preparation | null> {
  const preparation = await ctx.db.get(preparationId);
  if (!preparation || preparation.status !== "running" || preparation.attemptId !== attemptId) return null;
  if ((preparation.leaseExpiresAt ?? 0) < Date.now()) return null;
  const project = await ctx.db.get(preparation.projectId);
  if (!project || project.deletionStartedAt !== undefined) return null;
  return preparation;
}

async function preparationSources(ctx: { db: QueryCtx["db"] }, preparationId: Id<"briefPreparations">) {
  return await ctx.db
    .query("briefPreparationSources")
    .withIndex("by_preparationId", (q) => q.eq("preparationId", preparationId))
    .take(MAX_PREPARATION_SOURCES);
}

/** What the attempt's action needs, or null once the attempt is not live. */
export const getPreparationRun = internalQuery({
  args: { preparationId: v.id("briefPreparations"), attemptId: v.string() },
  handler: async (ctx, args) => {
    const preparation = await liveAttempt(ctx, args.preparationId, args.attemptId);
    if (!preparation?.modelFreeze || !preparation.planningModel) return null;
    return {
      projectId: preparation.projectId,
      triggeredBy: preparation.triggeredBy,
      modelFreeze: preparation.modelFreeze,
      planningModel: preparation.planningModel,
      placeholders: preparation.placeholders ?? [],
      sources: await preparationSources(ctx, preparation._id),
    };
  },
});

/** Owner decision 25 verdicts for spans on this preparation's frozen rows. */
export const getPreparationCitationSpeakers = internalQuery({
  args: {
    preparationId: v.id("briefPreparations"),
    spans: v.array(
      v.object({
        sourceId: v.id("briefPreparationSources"),
        startOffset: v.number(),
        endOffset: v.number(),
        movedFrom: v.optional(v.object({ startOffset: v.number(), endOffset: v.number() })),
      })
    ),
  },
  returns: v.array(citationSpeakerValidator),
  handler: async (ctx, args): Promise<CitationSpeaker[]> => {
    if (args.spans.length > MAX_CITATION_SPEAKER_SPANS) {
      return domainError("INVALID_INPUT", `At most ${MAX_CITATION_SPEAKER_SPANS} citation spans can be checked at once`);
    }
    const speakerOf = citationSpeakerReader(ctx);
    const verdicts: CitationSpeaker[] = [];
    for (const span of args.spans) {
      const source = await ctx.db.get(span.sourceId);
      verdicts.push(
        source && source.preparationId === args.preparationId
          ? await speakerOf(source, span.startOffset, span.endOffset, span.movedFrom)
          : "unchecked"
      );
    }
    return verdicts;
  },
});

/** Display facts of the live attempt only; a replaced attempt's are dropped. */
export const appendPreparationFacts = internalMutation({
  args: {
    preparationId: v.id("briefPreparations"),
    attemptId: v.string(),
    facts: v.array(readingFactValidator),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const preparation = await liveAttempt(ctx, args.preparationId, args.attemptId);
    if (!preparation) return null;
    const last = await ctx.db
      .query("briefPreparationFacts")
      .withIndex("by_preparationId_and_attemptId_and_seq", (q) =>
        q.eq("preparationId", preparation._id).eq("attemptId", args.attemptId)
      )
      .order("desc")
      .first();
    let seq = (last?.seq ?? 0) + 1;
    const createdAt = Date.now();
    for (const fact of args.facts.slice(0, READING_FACTS_PER_WRITE)) {
      await ctx.db.insert("briefPreparationFacts", {
        preparationId: preparation._id,
        projectId: preparation.projectId,
        attemptId: args.attemptId,
        seq,
        chip: fact.chip.slice(0, 40),
        quote: boundQuote(fact.quote),
        sourceLabel: fact.sourceLabel.slice(0, 200),
        ...(fact.speaker ? { speaker: fact.speaker.slice(0, 120) } : {}),
        ...(fact.line !== undefined ? { line: fact.line } : {}),
        createdAt,
      });
      seq += 1;
    }
    return null;
  },
});

const preparationEntryValidator = v.object({
  ...briefCandidateEntryValidator.fields,
  sourceId: v.id("briefPreparationSources"),
});

/**
 * The attempt's validated entries: every one checked again against the
 * preparation's own frozen rows (byte match and owner decision 25), then
 * the preparation is ready and its waiters are released.
 */
export const completePreparation = internalMutation({
  args: {
    preparationId: v.id("briefPreparations"),
    attemptId: v.string(),
    storylineText: v.string(),
    entries: v.array(preparationEntryValidator),
    upstreamDroppedEntryCount: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const preparation = await liveAttempt(ctx, args.preparationId, args.attemptId);
    if (!preparation) return null;
    if (args.entries.length > MAX_BRIEF_ENTRY_ROWS) {
      await endPreparation(ctx, preparation, "failed", "too_many_entries");
      return null;
    }
    const speakerOf = citationSpeakerReader(ctx);
    const sources = new Map<string, Doc<"briefPreparationSources"> | null>();
    let droppedEntryCount = args.upstreamDroppedEntryCount;
    const kept: typeof args.entries = [];
    for (const entry of args.entries) {
      if (!sources.has(entry.sourceId)) sources.set(entry.sourceId, await ctx.db.get(entry.sourceId));
      const source = sources.get(entry.sourceId);
      if (
        !source ||
        source.preparationId !== preparation._id ||
        !validateCitation(source, entry) ||
        (await speakerOf(source, entry.startOffset, entry.endOffset)) === "excluded"
      ) {
        droppedEntryCount += 1;
        continue;
      }
      kept.push(entry);
    }
    for (const entry of kept) {
      await ctx.db.insert("briefPreparationEntries", {
        preparationId: preparation._id,
        projectId: preparation.projectId,
        group: entry.group,
        text: entry.text,
        ...(entry.reason ? { reason: entry.reason } : {}),
        ...(entry.confidence ? { confidence: entry.confidence } : {}),
        sourceId: entry.sourceId,
        sourceContentHash: entry.sourceContentHash,
        startOffset: entry.startOffset,
        endOffset: entry.endOffset,
        exactExcerpt: entry.exactExcerpt,
      });
    }
    const now = Date.now();
    await ctx.db.patch(preparation._id, {
      status: "ready",
      storylineText: args.storylineText,
      droppedEntryCount,
      completedAt: now,
      leaseExpiresAt: undefined,
      updatedAt: now,
    });
    await releaseWaiters(ctx, preparation);
    return null;
  },
});

/** A failed attempt: a normalized code only, never provider or model text. */
export const failPreparation = internalMutation({
  args: { preparationId: v.id("briefPreparations"), attemptId: v.string(), code: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const preparation = await ctx.db.get(args.preparationId);
    if (!preparation || preparation.status !== "running" || preparation.attemptId !== args.attemptId) return null;
    await endPreparation(ctx, preparation, "failed", args.code.slice(0, 40));
    return null;
  },
});

/** An attempt still running past its lease failed (the action died). */
export const expirePreparationLease = internalMutation({
  args: { preparationId: v.id("briefPreparations"), attemptId: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const preparation = await ctx.db.get(args.preparationId);
    if (!preparation || preparation.status !== "running" || preparation.attemptId !== args.attemptId) return null;
    await endPreparation(ctx, preparation, "failed", "timed_out");
    return null;
  },
});

/**
 * Hourly: a failed, obsolete or cancelled preparation's content (frozen
 * text, entries, display facts, placeholder map, Storyline) is deleted 24
 * hours after it ended, in bounded batches. The row stays, content-free,
 * for the spend limits and usage reporting.
 */
export const purgeStalePreparations = internalMutation({
  args: {},
  returns: v.object({ purged: v.number(), more: v.boolean() }),
  handler: async (ctx): Promise<{ purged: number; more: boolean }> => {
    const cutoff = Date.now() - PREPARATION_RETENTION_MS;
    let budget = PREPARATION_PURGE_ROWS;
    let purged = 0;
    let more = false;
    for (const status of ["failed", "obsolete", "cancelled"] as const) {
      const stale = await ctx.db
        .query("briefPreparations")
        .withIndex("by_status_and_contentPurgedAt_and_endedAt", (q) =>
          q.eq("status", status).eq("contentPurgedAt", undefined).lt("endedAt", cutoff)
        )
        .take(10);
      for (const preparation of stale) {
        if (budget <= 0) {
          more = true;
          break;
        }
        const done = await purgePreparationContent(ctx, preparation, budget);
        budget -= done.deleted;
        if (!done.complete) {
          more = true;
          break;
        }
        purged += 1;
      }
      if (stale.length === 10) more = true;
    }
    if (more) await ctx.scheduler.runAfter(0, purgeStalePreparationsRef, {});
    return { purged, more };
  },
});

/** Deletes up to `budget` content rows of one preparation; clears it when none remain. */
async function purgePreparationContent(
  ctx: MutationCtx,
  preparation: Preparation,
  budget: number
): Promise<{ deleted: number; complete: boolean }> {
  let deleted = 0;
  const facts = await ctx.db
    .query("briefPreparationFacts")
    .withIndex("by_preparationId_and_attemptId_and_seq", (q) => q.eq("preparationId", preparation._id))
    .take(budget);
  for (const row of facts) await ctx.db.delete(row._id);
  deleted += facts.length;
  if (deleted >= budget) return { deleted, complete: false };
  const entries = await ctx.db
    .query("briefPreparationEntries")
    .withIndex("by_preparationId", (q) => q.eq("preparationId", preparation._id))
    .take(budget - deleted);
  for (const row of entries) await ctx.db.delete(row._id);
  deleted += entries.length;
  if (deleted >= budget) return { deleted, complete: false };
  const sources = await ctx.db
    .query("briefPreparationSources")
    .withIndex("by_preparationId", (q) => q.eq("preparationId", preparation._id))
    .take(budget - deleted);
  for (const row of sources) await ctx.db.delete(row._id);
  deleted += sources.length;
  if (deleted >= budget) return { deleted, complete: false };
  await ctx.db.patch(preparation._id, {
    contentPurgedAt: Date.now(),
    storylineText: undefined,
    placeholders: undefined,
  });
  return { deleted, complete: true };
}
