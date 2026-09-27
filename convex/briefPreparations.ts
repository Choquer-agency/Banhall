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
  type FrozenEvidence,
  type FrozenSourceFields,
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
import type { CitationSpeaker } from "./lib/citationSpeakers";
import {
  INTAKE_DEBOUNCE_MS,
  draftPlaceholderMap,
  namesSettleAt,
  preparationSpeakerReader,
  selectDraftEvidence,
  userMayCreateProject,
} from "./lib/intakeDrafts";
import type { PlaceholderEntry } from "./lib/deidentify";
import { citationSpeakerValidator } from "./lib/generations/brief";
import { validateCitation } from "./lib/citations";
import { domainError } from "./lib/contracts";
import { boundQuote, readingFactValidator, READING_FACTS_PER_WRITE } from "./lib/readingFacts";
import {
  briefCandidateEntryValidator,
  MAX_CITATION_SPEAKER_SPANS,
  MAX_BRIEF_ENTRY_ROWS,
} from "./lib/generations/brief";
import { PREPARATION_DEBOUNCE_MS, preparationStageAllows } from "./lib/briefPreparationTrigger";

/** How long one attempt may run: the action limit plus room to write. */
export const PREPARATION_LEASE_MS = 11 * 60 * 1000;
/** How long a ready preparation keeps its content after it finished or was last adopted. */
export const PREPARATION_READY_CONTENT_MS = 7 * 24 * 60 * 60 * 1000;
/** How long a run waits on a running preparation, from its dispatch. */
export const WAITER_DEADLINE_MS = 4 * 60 * 1000;
/** How often a waiting run checks the preparation's call is still alive. */
const WAITER_CHECK_MS = 60 * 1000;
/** How long a failed, obsolete or cancelled preparation keeps its content. */
export const PREPARATION_RETENTION_MS = 24 * 60 * 60 * 1000;
/** Rows one purge transaction deletes. */
export const PREPARATION_PURGE_ROWS = 200;
/** Recently touched uploads a start waits for (a batch still arriving). */
const UPLOAD_SETTLE_MS = 2 * 60 * 1000;
/** How long after a transcript is added its model speaker roles may still land. */
const SPEAKER_SETTLE_MS = 2 * 60 * 1000;
/** How often a start waiting for a transcript's turn build looks again. */
const STRUCTURE_RECHECK_MS = 2 * 60 * 1000;
/** How long a project waits after a billing, auth or provider-configuration failure. */
export const PREPARATION_COOLDOWN_MS = 30 * 60 * 1000;
/** Wait before trying again when the user or project already has one running. */
const SLOT_RETRY_MS = 30_000;
/** Times a queued preparation is pushed back before it is cancelled. */
const MAX_DEFERRALS = 10;
/**
 * Times a start waits for uploads still arriving (every
 * PREPARATION_DEBOUNCE_MS, so about 3 minutes). A backstop only: an upload
 * not touched for UPLOAD_SETTLE_MS no longer counts as arriving.
 */
const MAX_UPLOAD_WAITS = 36;
/** Frozen rows one preparation may hold (the generation bound, MAX_BRIEF_SOURCE_ROWS). */
const MAX_PREPARATION_SOURCES = 200;

type Preparation = Doc<"briefPreparations">;

/**
 * Whose evidence a preparation reads: a project, or (stage 2) a private
 * New project intake draft. A promoted draft's preparation belongs to its
 * project.
 */
export type PreparationScope = { projectId: Id<"projects"> } | { intakeDraftId: Id<"intakeDrafts"> };

export function scopeOf(row: Pick<Preparation, "projectId" | "intakeDraftId">): PreparationScope {
  if (row.projectId) return { projectId: row.projectId };
  if (row.intakeDraftId) return { intakeDraftId: row.intakeDraftId };
  throw new Error("A Brief preparation has no scope");
}

/** A scope's preparations with one status, newest last unless `order` says otherwise. */
async function scopeRows(
  ctx: { db: QueryCtx["db"] },
  scope: PreparationScope,
  status: Preparation["status"],
  limit: number,
  order: "asc" | "desc" = "asc"
): Promise<Preparation[]> {
  return "projectId" in scope
    ? await ctx.db
        .query("briefPreparations")
        .withIndex("by_projectId_and_status", (q) => q.eq("projectId", scope.projectId).eq("status", status))
        .order(order)
        .take(limit)
    : await ctx.db
        .query("briefPreparations")
        .withIndex("by_intakeDraftId_and_status", (q) => q.eq("intakeDraftId", scope.intakeDraftId).eq("status", status))
        .order(order)
        .take(limit);
}

/** A scope's preparations with one key, newest first. */
async function scopeKeyRows(ctx: { db: QueryCtx["db"] }, scope: PreparationScope, key: string): Promise<Preparation[]> {
  return "projectId" in scope
    ? await ctx.db
        .query("briefPreparations")
        .withIndex("by_projectId_and_key", (q) => q.eq("projectId", scope.projectId).eq("key", key))
        .order("desc")
        .take(20)
    : await ctx.db
        .query("briefPreparations")
        .withIndex("by_intakeDraftId_and_key", (q) => q.eq("intakeDraftId", scope.intakeDraftId).eq("key", key))
        .order("desc")
        .take(20);
}

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
export async function endPreparation(
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

/**
 * Pushes a queued preparation back, or cancels it after MAX_DEFERRALS
 * (upload waits count separately, up to MAX_UPLOAD_WAITS, so a batch of
 * files still arriving never uses up the other waits). A start that already
 * read the evidence (`evidenceRead`) and ends here drops older ready copies
 * first, as a cancelled start does.
 */
async function deferPreparation(
  ctx: MutationCtx,
  preparation: Preparation,
  waitingFor: "slot" | "uploads" | "structure" | "speakers" | "names",
  delayMs: number,
  options: { evidenceRead: boolean }
): Promise<void> {
  const uploads = waitingFor === "uploads";
  const deferrals = (preparation.deferrals ?? 0) + (uploads ? 0 : 1);
  const uploadWaits = (preparation.uploadWaits ?? 0) + (uploads ? 1 : 0);
  if (deferrals > MAX_DEFERRALS || uploadWaits > MAX_UPLOAD_WAITS) {
    if (options.evidenceRead) await obsoleteReady(ctx, scopeOf(preparation));
    await endPreparation(
      ctx,
      preparation,
      "cancelled",
      {
        slot: "busy",
        uploads: "uploads_unsettled",
        structure: "structure_unsettled",
        speakers: "speakers_unsettled",
        names: "names_unsettled",
      }[waitingFor]
    );
    return;
  }
  const revision = preparation.revision + 1;
  const scheduledJobId = await ctx.scheduler.runAfter(delayMs, internal.briefPreparations.startBriefPreparation, {
    preparationId: preparation._id,
    revision,
  });
  await ctx.db.patch(preparation._id, {
    revision,
    deferrals,
    uploadWaits,
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

/** Marks a scope's ready rows obsolete, except the ones with `keepKey`. */
async function obsoleteReady(ctx: MutationCtx, scope: PreparationScope, keepKey?: string): Promise<void> {
  const ready = await scopeRows(ctx, scope, "ready", 20);
  for (const row of ready) {
    if (keepKey !== undefined && row.key === keepKey) continue;
    await endPreparation(ctx, row, "obsolete", "superseded");
  }
}

/** Whether an attempt dispatched a call that has not ended yet. */
export function callStillRunning(row: Preparation, now: number): boolean {
  return (
    row.dispatchedAt !== undefined &&
    row.attemptEndedAt === undefined &&
    row.completedAt === undefined &&
    row.failureCode === undefined &&
    (row.leaseExpiresAt ?? 0) > now
  );
}

/**
 * Whether the project (or the user) has a call in flight: a running row,
 * or an obsolete one whose call has not ended (P2-3 of the 2026-09-26
 * review: a superseded attempt still pays for its call).
 */
async function callInFlight(
  ctx: MutationCtx,
  scope: PreparationScope | { userId: Id<"users"> },
  now: number
): Promise<boolean> {
  for (const status of ["running", "obsolete"] as const) {
    const rows =
      "userId" in scope
        ? await ctx.db
            .query("briefPreparations")
            .withIndex("by_triggeredBy_and_status", (q) => q.eq("triggeredBy", scope.userId).eq("status", status))
            .order("desc")
            .take(20)
        : await scopeRows(ctx, scope, status, 20, "desc");
    if (rows.some((row) => (status === "running" ? true : callStillRunning(row, now)))) return true;
  }
  return false;
}

/** Failure codes after which a project waits PREPARATION_COOLDOWN_MS. */
export const COOLDOWN_FAILURE_CODES: ReadonlySet<string> = new Set([
  "billing",
  "authentication",
  "model_access",
  "provider_config",
]);

async function inCooldown(ctx: MutationCtx, scope: PreparationScope, now: number): Promise<boolean> {
  const failed = await scopeRows(ctx, scope, "failed", 5, "desc");
  return failed.some(
    (row) =>
      row.failureCode !== undefined &&
      COOLDOWN_FAILURE_CODES.has(row.failureCode) &&
      (row.endedAt ?? 0) > now - PREPARATION_COOLDOWN_MS
  );
}

/**
 * A project a historical PD was ported into. The ingestion item's project
 * marker (`ingestionItems.portedProjectId`) holds whatever became of the
 * ported file (archived, or past the first document rows); a ported file
 * among the frozen documents is checked too.
 */
async function isIngestionPort(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  evidence: FrozenEvidence
): Promise<boolean> {
  const item = await ctx.db
    .query("ingestionItems")
    .withIndex("by_portedProjectId", (q) => q.eq("portedProjectId", projectId))
    .first();
  if (item) return true;
  return evidence.frozenDocuments.some(({ document }) => document.source === "ingestion_port");
}

/** Whether the configured transport can reach the planning model at all. */
function providerReady(gateway: "anthropic" | "openrouter"): boolean {
  return gateway === "openrouter"
    ? openRouterConfiguration().state === "configured"
    : anthropicConfiguration("generation").state === "configured";
}

/** What a scope's own checks hand the shared claim, once they read the evidence. */
type ReadEvidence = {
  scope: PreparationScope;
  fields: FrozenSourceFields[];
  inputMode: "full" | "digest";
  transcriptFacts: boolean;
  placeholders: () => Promise<PlaceholderEntry[]>;
};

/**
 * A project's eligibility and evidence (stage 1). Null when the start ended
 * or was pushed back here.
 */
async function readProjectEvidence(
  ctx: MutationCtx,
  preparation: Preparation,
  projectId: Id<"projects">,
  now: number
): Promise<ReadEvidence | null> {
  const project = await ctx.db.get(projectId);
  if (!project || project.deletionStartedAt !== undefined) {
    await endPreparation(ctx, preparation, "cancelled", "project_gone");
    return null;
  }
  if (effectiveProjectType(project) !== "writing") {
    await endPreparation(ctx, preparation, "cancelled", "not_writing");
    return null;
  }
  if (!preparationStageAllows(project)) {
    await endPreparation(ctx, preparation, "cancelled", "stage");
    return null;
  }
  // Authority is the triggering editor's, checked again now.
  if (!(await userMayEditReport(ctx, await ctx.db.get(preparation.triggeredBy), project))) {
    await endPreparation(ctx, preparation, "cancelled", "not_authorized");
    return null;
  }
  const scope = { projectId: project._id };
  // After a billing, authentication or provider-configuration failure the
  // project waits PREPARATION_COOLDOWN_MS before it pays again.
  if (await inCooldown(ctx, scope, now)) {
    await endPreparation(ctx, preparation, "cancelled", "cooldown");
    return null;
  }

  // A run already going derives or adopts its own Brief. Checked before
  // the evidence is read, as is a batch of files still arriving: waiting
  // for the rest of it reads no text (the start runs again after the
  // batch's last change, or every PREPARATION_DEBOUNCE_MS).
  if (await findActiveGeneration(ctx, project, ACTIVE_GENERATION_STATUSES)) {
    await endPreparation(ctx, preparation, "cancelled", "generation_active");
    return null;
  }
  const uploads = await ctx.db
    .query("documentUploadAttempts")
    .withIndex("by_projectId", (q) => q.eq("projectId", project._id))
    .order("desc")
    .take(50);
  if (uploads.some((row) => row.status === "in_progress" && row.updatedAt > now - UPLOAD_SETTLE_MS)) {
    await deferPreparation(ctx, preparation, "uploads", PREPARATION_DEBOUNCE_MS, { evidenceRead: false });
    return null;
  }

  // From here on the start has read the evidence: however it ends, a
  // ready copy made from older evidence is not kept (it may hold text the
  // project no longer has).
  const evidence = await selectFrozenEvidence(ctx, project._id);
  const cancel = async (reason: string) => {
    await obsoleteReady(ctx, scope);
    await endPreparation(ctx, preparation, "cancelled", reason);
    return null;
  };
  // Historical ports from ingestion are never prepared.
  if (await isIngestionPort(ctx, project._id, evidence)) return await cancel("ingestion_port");
  const readable = evidence.transcripts.filter((row) => row.content.trim() !== "");
  const current = (await currentYearTranscripts(ctx, project, evidence.transcripts)).filter(
    (row) => row.content.trim() !== ""
  );
  if (current.length === 0) return await cancel("no_transcript");
  // Speaker evidence must be settled: wait for the turn build, rechecking
  // every STRUCTURE_RECHECK_MS (an intake build also asks when it ends).
  const unsettled = readable.filter(
    (row) => row.parserVersion !== TRANSCRIPT_PARSER_VERSION || row.structureBuildId !== undefined
  );
  if (unsettled.length > 0) {
    for (const row of unsettled) await scheduleStructureRebuildIfStale(ctx, row);
    await deferPreparation(ctx, preparation, "structure", STRUCTURE_RECHECK_MS, { evidenceRead: true });
    return null;
  }
  // A new transcript's uncertain speakers go to the model right after its
  // turns are built, and the answer changes the key: wait for it (bounded;
  // recordModelSpeakerRoles asks again), rather than pay twice.
  if ((preparation.deferrals ?? 0) < MAX_DEFERRALS && (await speakersPending(ctx, readable, now))) {
    await deferPreparation(ctx, preparation, "speakers", PREPARATION_DEBOUNCE_MS, { evidenceRead: true });
    return null;
  }
  const inputMode = decideInputMode(frozenTranscriptChars(evidence));
  const factsMode = await transcriptFactsMode(ctx);
  return {
    scope,
    fields: await frozenSourceFields(evidence),
    inputMode,
    transcriptFacts:
      evidence.transcripts.length > 0 && (factsMode === "all" || (factsMode === "long" && inputMode === "digest")),
    placeholders: async () => await frozenPlaceholders(ctx, project, evidence),
  };
}

/**
 * A private intake draft's eligibility and evidence (stage 2, the tenth
 * amendment): the owner's draft, still open, with the client name the
 * placeholder map needs, and every transcript's speakers settled. Null
 * when the start ended or was pushed back here.
 */
async function readDraftEvidence(
  ctx: MutationCtx,
  preparation: Preparation,
  draftId: Id<"intakeDrafts">,
  now: number
): Promise<ReadEvidence | null> {
  const draft = await ctx.db.get(draftId);
  if (!draft || draft.status !== "open" || draft.expiresAt <= now) {
    await endPreparation(ctx, preparation, "cancelled", "draft_closed");
    return null;
  }
  // Authority is the owner's, checked again now: an active internal role
  // that may create projects.
  if (draft.ownerId !== preparation.triggeredBy || !userMayCreateProject(await ctx.db.get(draft.ownerId))) {
    await endPreparation(ctx, preparation, "cancelled", "not_authorized");
    return null;
  }
  const scope = { intakeDraftId: draft._id };
  if (await inCooldown(ctx, scope, now)) {
    await endPreparation(ctx, preparation, "cancelled", "cooldown");
    return null;
  }
  // No paid call before the client name the placeholders hide exists, nor
  // before the names have stayed unchanged for NAMES_SETTLE_MS (a half-typed
  // client name is never the map).
  if (!draft.clientName?.trim()) {
    await endPreparation(ctx, preparation, "cancelled", "masking_context");
    return null;
  }
  if (now < namesSettleAt(draft)) {
    await deferPreparation(ctx, preparation, "names", namesSettleAt(draft) - now, { evidenceRead: false });
    return null;
  }
  const evidence = await selectDraftEvidence(ctx, draft);
  const cancel = async (reason: string) => {
    await obsoleteReady(ctx, scope);
    await endPreparation(ctx, preparation, "cancelled", reason);
    return null;
  };
  if (evidence.readTranscripts.length === 0) return await cancel("no_transcript");
  // Every transcript's speakers feed the placeholder map, left-out ones too.
  if (evidence.transcripts.some((row) => row.parserVersion !== TRANSCRIPT_PARSER_VERSION)) {
    await deferPreparation(ctx, preparation, "structure", INTAKE_DEBOUNCE_MS, { evidenceRead: true });
    return null;
  }
  if (
    (preparation.deferrals ?? 0) < MAX_DEFERRALS &&
    evidence.transcripts.some((row) => row.speakerModel === "needed" || row.speakerModel === "pending")
  ) {
    await deferPreparation(ctx, preparation, "speakers", INTAKE_DEBOUNCE_MS, { evidenceRead: true });
    return null;
  }
  const inputMode = decideInputMode(
    evidence.fields.reduce((total, field) => total + (field.kind === "transcript" ? field.content.length : 0), 0)
  );
  const factsMode = await transcriptFactsMode(ctx);
  return {
    scope,
    fields: evidence.fields,
    inputMode,
    transcriptFacts:
      evidence.readTranscripts.length > 0 && (factsMode === "all" || (factsMode === "long" && inputMode === "digest")),
    placeholders: async () =>
      await draftPlaceholderMap(
        ctx,
        draft,
        evidence.transcripts,
        evidence.fields.map((field) => field.content)
      ),
  };
}

/**
 * The debounced start: every eligibility rule and limit, then the claim.
 * Freezes the evidence, the placeholder map and the planning model, and
 * reserves the spend, in one transaction with the claim. A project's and a
 * draft's own checks differ; the key, the limits and the claim are shared.
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
    const read = preparation.projectId
      ? await readProjectEvidence(ctx, preparation, preparation.projectId, now)
      : preparation.intakeDraftId
        ? await readDraftEvidence(ctx, preparation, preparation.intakeDraftId, now)
        : null;
    if (!read) return null;
    const { scope, fields, inputMode } = read;
    const cancel = async (reason: string) => {
      await obsoleteReady(ctx, scope);
      await endPreparation(ctx, preparation, "cancelled", reason);
      return null;
    };
    // Stage 1 and 2 prepare the full-text representation only: digests and
    // fact packs are later work, and such a run derives its own Brief.
    if (inputMode !== "full" || read.transcriptFacts) return await cancel("representation");

    // The planning role (decision 43), frozen for this preparation only.
    const modelFreeze = await freezeModelsForGeneration(ctx, [await defaultModelId(ctx)], now);
    const route = resolveGenerationStep({ freeze: modelFreeze, step: "brief", writerModel: MODEL });
    const entry = modelFreeze.entries.find((item) => item.id === route.model);
    if (!entry || !providerReady(entry.gateway)) return await cancel("provider_unavailable");
    const pricing = await preparationPricing(ctx, route.model);
    if (!pricing) return await cancel("pricing_unknown");

    const placeholders = await read.placeholders();
    if (fields.length > MAX_PREPARATION_SOURCES) return await cancel("too_many_sources");
    const key = await briefPreparationKey(ctx, {
      scope,
      sources: fields,
      placeholders,
      inputMode,
      transcriptFacts: false,
      freeze: modelFreeze,
      writerModel: MODEL,
    });
    // The same key already prepared or preparing: nothing to buy.
    const same = await scopeKeyRows(ctx, scope, key);
    if (same.some((row) => row.status === "ready" || row.status === "running")) {
      await obsoleteReady(ctx, scope, key);
      await endPreparation(ctx, preparation, "cancelled", "duplicate");
      return null;
    }
    // Older keys are obsolete now. One a run is waiting on keeps running for
    // that run (its dependency is immutable); no new run can adopt it.
    await obsoleteReady(ctx, scope, key);
    for (const row of await scopeRows(ctx, scope, "running", 20)) {
      if (row._id === preparation._id || (await hasWaiters(ctx, row._id))) continue;
      await endPreparation(ctx, row, "obsolete", "superseded");
    }
    // One call in flight per project (or draft) and per user, an obsolete
    // attempt's call included until it ends.
    if ((await callInFlight(ctx, scope, now)) || (await callInFlight(ctx, { userId: preparation.triggeredBy }, now))) {
      await deferPreparation(ctx, preparation, "slot", SLOT_RETRY_MS, { evidenceRead: true });
      return null;
    }
    // At most 20 paid starts per user per firm day; spend reserved before
    // the call against $0.50 per project (or draft) and $5 per user per
    // firm day.
    const firmDay = firmDayNumber(now);
    const reservedUsd = reservePreparationUsd(pricing, route.model, buildBriefUserMessage(fields).length);
    const refusal = preparationLimitRefusal(
      await preparationDay(ctx, { userId: preparation.triggeredBy, scope, firmDay }),
      reservedUsd
    );
    if (refusal) {
      await endPreparation(ctx, preparation, "cancelled", refusal);
      return null;
    }

    for (const field of fields) {
      await ctx.db.insert("briefPreparationSources", {
        preparationId: preparation._id,
        ...scope,
        ...field,
        capturedAt: now,
      });
    }
    const attemptId = crypto.randomUUID();
    const actionJobId = await ctx.scheduler.runAfter(0, internal.ai.brief.runBriefPreparation, {
      preparationId: preparation._id,
      attemptId,
    });
    await ctx.db.patch(preparation._id, {
      status: "running",
      attemptId,
      actionJobId,
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
    await ctx.scheduler.runAfter(PREPARATION_LEASE_MS, internal.briefPreparations.expirePreparationLease, {
      preparationId: preparation._id,
      attemptId,
    });
    return null;
  },
});

/** The scope fields a preparation's content rows carry. */
function scopeFields(preparation: Preparation): { projectId?: Id<"projects">; intakeDraftId?: Id<"intakeDrafts"> } {
  return {
    ...(preparation.projectId ? { projectId: preparation.projectId } : {}),
    ...(preparation.intakeDraftId ? { intakeDraftId: preparation.intakeDraftId } : {}),
  };
}

/**
 * Whether the user who asked may still keep the result: report-edit
 * authority on the project, or, for a draft not yet promoted, its owner
 * still allowed to create projects.
 */
async function triggererMayKeep(ctx: MutationCtx, preparation: Preparation): Promise<boolean> {
  const user = await ctx.db.get(preparation.triggeredBy);
  if (preparation.projectId) {
    const project = await ctx.db.get(preparation.projectId);
    return project !== null && (await userMayEditReport(ctx, user, project));
  }
  if (!preparation.intakeDraftId) return false;
  const draft = await ctx.db.get(preparation.intakeDraftId);
  return draft !== null && draft.ownerId === preparation.triggeredBy && userMayCreateProject(user);
}

/** The live attempt, or null: the fence every write after the claim uses. */
async function liveAttempt(
  ctx: { db: QueryCtx["db"] },
  preparationId: Id<"briefPreparations">,
  attemptId: string
): Promise<Preparation | null> {
  const preparation = await ctx.db.get(preparationId);
  if (!preparation || preparation.status !== "running" || preparation.attemptId !== attemptId) return null;
  if ((preparation.leaseExpiresAt ?? 0) < Date.now()) return null;
  if (!(await scopeLive(ctx, preparation))) return null;
  return preparation;
}

/**
 * Whether the preparation's scope still takes writes: a project not being
 * deleted, or an intake draft still open (or being promoted). A discarded
 * or expired draft fences every late write.
 */
async function scopeLive(ctx: { db: QueryCtx["db"] }, preparation: Preparation): Promise<boolean> {
  if (preparation.projectId) {
    const project = await ctx.db.get(preparation.projectId);
    return project !== null && project.deletionStartedAt === undefined;
  }
  if (!preparation.intakeDraftId) return false;
  const draft = await ctx.db.get(preparation.intakeDraftId);
  return draft !== null && (draft.status === "open" || draft.status === "promoting");
}

async function preparationSources(ctx: { db: QueryCtx["db"] }, preparationId: Id<"briefPreparations">) {
  return await ctx.db
    .query("briefPreparationSources")
    .withIndex("by_preparationId", (q) => q.eq("preparationId", preparationId))
    .take(MAX_PREPARATION_SOURCES);
}

/**
 * What the attempt's action needs, or null once the attempt is not live.
 * `disabled`: an Admin switched preparation off after the claim; the action
 * sends nothing and ends the attempt as cancelled.
 */
export const getPreparationRun = internalQuery({
  args: { preparationId: v.id("briefPreparations"), attemptId: v.string() },
  handler: async (ctx, args) => {
    const preparation = await liveAttempt(ctx, args.preparationId, args.attemptId);
    if (!preparation?.modelFreeze || !preparation.planningModel) return null;
    if (!(await briefPreparationEnabled(ctx))) return { disabled: true as const };
    return {
      disabled: false as const,
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
    const speakerOf = preparationSpeakerReader(ctx);
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
        ...scopeFields(preparation),
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
 * An attempt's call has ended, whatever became of the row. A row made
 * obsolete while its call was in flight stops holding the running slot.
 */
async function settleAttemptEnd(
  ctx: MutationCtx,
  preparationId: Id<"briefPreparations">,
  attemptId: string
): Promise<Preparation | null> {
  const preparation = await ctx.db.get(preparationId);
  if (!preparation || preparation.attemptId !== attemptId || preparation.attemptEndedAt !== undefined) {
    return preparation;
  }
  await ctx.db.patch(preparationId, { attemptEndedAt: Date.now(), leaseExpiresAt: undefined });
  return (await ctx.db.get(preparationId))!;
}

/**
 * The attempt's action found nothing to run (the row was made obsolete
 * before the action started, or the project is being deleted): no call
 * will be made, so the attempt ends now and frees the running slot at
 * once instead of at the lease.
 */
export const settleUnrunAttempt = internalMutation({
  args: { preparationId: v.id("briefPreparations"), attemptId: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await settleAttemptEnd(ctx, args.preparationId, args.attemptId);
    return null;
  },
});

/** The action stopped before its call (switched off, say): cancelled. */
export const cancelPreparationAttempt = internalMutation({
  args: { preparationId: v.id("briefPreparations"), attemptId: v.string(), reason: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const preparation = await settleAttemptEnd(ctx, args.preparationId, args.attemptId);
    if (!preparation || preparation.status !== "running" || preparation.attemptId !== args.attemptId) return null;
    await endPreparation(ctx, preparation, "cancelled", args.reason.slice(0, 40));
    return null;
  },
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
    await settleAttemptEnd(ctx, args.preparationId, args.attemptId);
    if (!preparation) return null;
    // Authority again before anything is kept: an editor who lost it (or a
    // deactivated account, or a draft owner who may no longer create
    // projects) publishes nothing. The spend stays recorded.
    if (!(await triggererMayKeep(ctx, preparation))) {
      await endPreparation(ctx, preparation, "cancelled", "not_authorized");
      return null;
    }
    if (args.entries.length > MAX_BRIEF_ENTRY_ROWS) {
      await endPreparation(ctx, preparation, "failed", "too_many_entries");
      return null;
    }
    const speakerOf = preparationSpeakerReader(ctx);
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
        ...scopeFields(preparation),
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
      contentExpiresAt: now + PREPARATION_READY_CONTENT_MS,
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
    const preparation = await settleAttemptEnd(ctx, args.preparationId, args.attemptId);
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
    const preparation = await settleAttemptEnd(ctx, args.preparationId, args.attemptId);
    if (!preparation || preparation.status !== "running" || preparation.attemptId !== args.attemptId) return null;
    await endPreparation(ctx, preparation, "failed", "timed_out");
    return null;
  },
});

/**
 * A run's wait on a running preparation (Opus review P2-1): every
 * WAITER_CHECK_MS until its deadline. When the attempt's action job failed
 * or was cancelled, the attempt fails and every waiter is released; at the
 * deadline this run stops waiting and derives its own Brief (the attempt
 * runs on for anyone else). Either way the run's continuation is scheduled.
 */
export const checkBriefWaiter = internalMutation({
  args: { waiterId: v.id("briefPreparationWaiters") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const waiter = await ctx.db.get(args.waiterId);
    if (!waiter || waiter.status !== "waiting") return null;
    const now = Date.now();
    const preparation = await ctx.db.get(waiter.preparationId);
    const job = preparation?.actionJobId ? await ctx.db.system.get(preparation.actionJobId) : null;
    const jobDead = job !== null && (job.state.kind === "failed" || job.state.kind === "canceled");
    if (preparation && preparation.status === "running" && preparation.attemptId === waiter.attemptId && jobDead) {
      await settleAttemptEnd(ctx, preparation._id, waiter.attemptId);
      await endPreparation(ctx, preparation, "failed", "action_failed");
      return null;
    }
    const alive =
      preparation !== null && preparation.status === "running" && preparation.attemptId === waiter.attemptId;
    const deadline = waiter.deadlineAt ?? now;
    if (alive && now < deadline) {
      await ctx.scheduler.runAfter(Math.min(WAITER_CHECK_MS, deadline - now), internal.briefPreparations.checkBriefWaiter, {
        waiterId: waiter._id,
      });
      return null;
    }
    // Past the deadline (or the attempt is gone): this run derives its own.
    await ctx.db.patch(waiter._id, { status: "released", releasedAt: now });
    const generation = await ctx.db.get(waiter.generationId);
    if (generation?.briefPreparation && generation.briefPreparation.state === "attached") {
      await ctx.db.patch(generation._id, {
        briefPreparation: { ...generation.briefPreparation, state: "released", at: now },
      });
    }
    await ctx.scheduler.runAfter(0, internal.ai.iterative.continueAfterBriefPreparation, {
      generationId: waiter.generationId,
    });
    return null;
  },
});

/**
 * Hourly: a failed, obsolete or cancelled preparation's content (frozen
 * text, entries, display facts, placeholder map, Storyline) is deleted 24
 * hours after it ended; a ready one's 7 days after it finished or was last
 * adopted; and every ready one's at once while preparation is switched
 * off. In bounded batches; the row stays, content-free, for the spend
 * limits and usage reporting.
 */
export const purgeStalePreparations = internalMutation({
  args: {},
  returns: v.object({ purged: v.number(), more: v.boolean() }),
  handler: async (ctx): Promise<{ purged: number; more: boolean }> => {
    const now = Date.now();
    const cutoff = now - PREPARATION_RETENTION_MS;
    let budget = PREPARATION_PURGE_ROWS;
    let purged = 0;
    let more = false;
    const purgeAll = async (rows: Preparation[]) => {
      for (const preparation of rows) {
        if (budget <= 0) {
          more = true;
          return;
        }
        const done = await purgePreparationContent(ctx, preparation, budget);
        budget -= done.deleted;
        if (!done.complete) {
          more = true;
          return;
        }
        purged += 1;
      }
    };
    // Switched off: no ready copy is kept; each expires now.
    if (!(await briefPreparationEnabled(ctx))) {
      const ready = await ctx.db
        .query("briefPreparations")
        .withIndex("by_status_and_contentExpiresAt", (q) => q.eq("status", "ready"))
        .take(10);
      for (const row of ready) await ctx.db.patch(row._id, { contentExpiresAt: now });
      if (ready.length === 10) more = true;
    }
    // Ready content past its limit becomes obsolete (no run can adopt it
    // any more) and is deleted, as is any leftover of an earlier pass.
    for (const status of ["ready", "obsolete"] as const) {
      const expired = await ctx.db
        .query("briefPreparations")
        .withIndex("by_status_and_contentExpiresAt", (q) =>
          q.eq("status", status).gt("contentExpiresAt", 0).lte("contentExpiresAt", now)
        )
        .take(10);
      for (const row of expired) {
        if (row.status === "ready") await endPreparation(ctx, row, "obsolete", "expired");
      }
      await purgeAll(expired);
      if (expired.length === 10) more = true;
    }
    for (const status of ["failed", "obsolete", "cancelled"] as const) {
      const stale = await ctx.db
        .query("briefPreparations")
        .withIndex("by_status_and_contentPurgedAt_and_endedAt", (q) =>
          q.eq("status", status).eq("contentPurgedAt", undefined).lt("endedAt", cutoff)
        )
        .take(10);
      await purgeAll(stale);
      if (stale.length === 10) more = true;
    }
    if (more) await ctx.scheduler.runAfter(0, internal.briefPreparations.purgeStalePreparations, {});
    return { purged, more };
  },
});

/** Deletes up to `budget` content rows of one preparation; clears it when none remain. */
export async function purgePreparationContent(
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
    contentExpiresAt: undefined,
    storylineText: undefined,
    placeholders: undefined,
  });
  return { deleted, complete: true };
}
