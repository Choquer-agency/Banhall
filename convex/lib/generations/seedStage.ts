/**
 * The Step-by-step seed stage: initialization, the frozen drafting inputs,
 * Summary sign-off and Summary recovery, and the frozen Summary plan the
 * chain drafts from.
 *
 * Split out of convex/generations.ts (2026-09-25, phase 4). The Convex
 * functions stay registered in convex/generations.ts under their old names;
 * this module holds their handlers and helpers.
 */
import { makeFunctionReference } from "convex/server";
import type { Id, Doc } from "../../_generated/dataModel";
import { type SectionNumber, type OrderedPayload, sectionKeyOf } from "../orderedChain";
import { v, type ObjectType } from "convex/values";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { requireSeedInitialization } from "./seedGuards";
import { requireDraftingInputsReady, startDraftingInputsHandler } from "./draftingInputs";
import { domainError } from "../contracts";
import {
  briefWithoutExcludedQuotes,
  reusableBriefForGeneration,
  readBriefEntryRowsBounded,
  MAX_BRIEF_ENTRY_ROWS,
  BRIEF_CONSUMER_READ_BYTES,
  loadBriefCheck,
} from "./brief";
import { PD_SUBSECTIONS, type PdSubsectionRoleId } from "../../../shared/pdSubsections";
import {
  emptyContextRevision,
  emptySelectionRevision,
  SeedContextLimitError,
  projectSummaryOrdinaryChecks,
  orderShownSet,
  sha256Text,
  materializeFinalWording,
  buildFrozenSummaryPlan,
  summarySelfCheckWorstCaseResponse,
  stableSerialize,
  resolveFrozenSourceId,
  MAX_SEED_SNAPSHOT_ROWS,
} from "../seedRevisions";
import { transitionGeneration } from "../generationTransitions";
import { refreshProjectGenerationActivity } from "../dashboardProjection";
import { MODEL, seedModelById } from "../../../shared/generationModels";
import { generationModelFreeze, entryFromFrozen } from "../modelRoles";
import { persistOrderedPayload } from "../orderedPayloadStore";
import { requireReportEditAccess } from "../roleCapabilities";
import { limitGenerationStart } from "../aiRateLimits";
import { resolveGatedWorkflow } from "../gatedWorkflow";
import { readSeedReadiness } from "../seedReadiness";
import { matchesSeedExclusion } from "../seedApproval";
import { terminateSeedAttempts } from "../../seedRuns";
import { bypassSeedEpisodes } from "../seedDecisionWrites";
import { appendGenerationProgress } from "../generationProgress";
import { isProjectDeleting } from "../projectDeletion";
import { internal } from "../../_generated/api";
import { SEED_DECISION_COLLECTION_ROWS } from "../seedDecisionState";
import { editedTermsOf, MAX_EDITED_TERMS_PER_LINE } from "../editedTerms";
import {
  feedbackForLine,
  glossaryTermsSetAside,
  type GlossarySetAside,
  type WriterFeedback,
} from "../writerPrecedence";

export const generateOrderedSectionRef = makeFunctionReference<
  "action",
  {
    generationId: Id<"generations">;
    candidateRunId: Id<"generationCandidateRuns">;
    section: SectionNumber;
    payload?: OrderedPayload;
    payloadId?: Id<"generationArtifacts">;
  },
  null
>("ai/orderedGeneration:generateOrderedSection");

/** Decision 65: the server starts the first Seed Batch (convex/seedRuns.ts). */
const startFirstSeedBatchRef = makeFunctionReference<
  "mutation",
  { generationId: Id<"generations"> },
  unknown
>("seedRuns:startFirstBatch");

export const startSummaryRecoveryRef = makeFunctionReference<
  "action",
  { generationId: Id<"generations"> },
  null
>("ai/orderedGeneration:startSummaryRecovery");

/** Argument validators of generations.pinSeedBrief. */
export const pinSeedBriefArgs = { generationId: v.id("generations"), inputsHash: v.string() };

/** Handler of generations.pinSeedBrief. */
export async function pinSeedBriefHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof pinSeedBriefArgs>
) {
  const generation = await requireSeedInitialization(ctx, args.generationId);
  if (generation.seedBriefPin !== undefined) {
    if (generation.seedBriefInputsHash !== args.inputsHash) {
      domainError("INVALID_STATE", "Frozen Brief inputs changed");
    }
    return generation.briefId ?? generation.seedBriefPin;
  }
  const reusable = generation.briefId
    ? null
    : await reusableBriefForGeneration(ctx, generation, args.inputsHash);
  // A reused Brief drops entries backed only by the interviewer's or another
  // speaker's words first (owner decision 25, review 2026-09-25).
  const candidate = generation.briefId
    ? await ctx.db.get(generation.briefId)
    : reusable
      ? await briefWithoutExcludedQuotes(ctx, reusable)
      : null;
  if (candidate && (candidate.projectId !== generation.projectId || candidate.inputsHash !== args.inputsHash)) {
    domainError("INVALID_STATE", "Frozen Brief inputs do not match");
  }
  const pin = candidate?._id ?? null;
  await ctx.db.patch(generation._id, {
    seedBriefPin: pin,
    seedBriefInputsHash: args.inputsHash,
    ...(pin ? { briefId: pin } : {}),
  });
  return pin;
}

export const SEED_INITIALIZATION_ERROR = "Seed preparation did not complete. Retry initialization.";

export async function bumpSeedStageVersion(ctx: MutationCtx, generationId: Id<"generations">): Promise<void> {
  const generation = await ctx.db.get(generationId);
  if (generation) await ctx.db.patch(generationId, { seedStageVersion: (generation.seedStageVersion ?? 0) + 1 });
}

export async function adjustSeedRequestsReserved(ctx: MutationCtx, generationId: Id<"generations">, delta: number): Promise<void> {
  const generation = await ctx.db.get(generationId);
  if (!generation) return;
  const next = (generation.seedRequestsReserved ?? 0) + delta;
  if (!Number.isInteger(next) || next < 0) domainError("INVALID_STATE", "Invalid seed request reservation");
  await ctx.db.patch(generationId, { seedRequestsReserved: next });
}

/**
 * What the seed stage needs before it opens: the frozen writer settings and
 * the frozen writer style Seeds read. Owner decision 32 (2026-09-25): the
 * style is its own `writer_style` artifact, frozen before the analysis and
 * Brain retrieval, which run in the background and are sign-off
 * preconditions instead. A generation started before the reorder carries
 * the style inside `brain_blocks`.
 */
export async function requireFrozenSeedArtifacts(ctx: MutationCtx, generation: Doc<"generations">) {
  if (!generation.writerSettings) domainError("INVALID_STATE", "Frozen writer settings are unavailable");
  for (const kind of ["writer_style", "brain_blocks"] as const) {
    const artifact = await ctx.db.query("generationArtifacts")
      .withIndex("by_generationId_and_kind", q => q.eq("generationId", generation._id).eq("kind", kind)).first();
    if (artifact) return;
  }
  domainError("INVALID_STATE", "Frozen initialization artifacts are unavailable");
}

/** Argument validators of generations.initializeSeedStage. */
export const initializeSeedStageArgs = { generationId: v.id("generations") };

/** Handler of generations.initializeSeedStage. */
export async function initializeSeedStageHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof initializeSeedStageArgs>
) {
  const generation = await requireSeedInitialization(ctx, args.generationId);
  const existing = await ctx.db.query("seedSubsections")
    .withIndex("by_generationId", q => q.eq("generationId", generation._id)).take(14);
  if (existing.length) {
    if (existing.length !== 13 || PD_SUBSECTIONS.some(role => !existing.some(row => row.roleId === role.roleId))) {
      domainError("INVALID_STATE", "Seed initialization is incomplete");
    }
    return null;
  }
  await requireFrozenSeedArtifacts(ctx, generation);
  if (!generation.briefId || generation.seedBriefPin === undefined) {
    domainError("INVALID_STATE", "Frozen Brief is unavailable");
  }
  const brief = await ctx.db.get(generation.briefId);
  if (!brief || brief.projectId !== generation.projectId || brief.inputsHash !== generation.seedBriefInputsHash) {
    domainError("INVALID_STATE", "Frozen Brief is unavailable");
  }
  // Owner decision 32: an open seed stage always has its drafting inputs
  // under way. Startup starts them before this; a retry after a startup that
  // died before that starts them here, and a generation that froze both
  // inputs the old way is ready at once.
  if (generation.draftingInputs === undefined) {
    await startDraftingInputsHandler(ctx, { generationId: generation._id });
  }
  const currentContextRevision = await emptyContextRevision();
  const selectionRevision = await emptySelectionRevision();
  for (const role of PD_SUBSECTIONS) {
    await ctx.db.insert("seedSubsections", {
      projectId: generation.projectId, generationId: generation._id,
      roleId: role.roleId, kind: role.kind, state: "untouched",
      currentContextRevision, selectionRevision, consecutiveFailures: 0,
    });
  }
  await transitionGeneration(ctx, generation, "awaiting_input", {
    briefVersionId: brief._id,
    seedStageVersion: 0, seedRequestsReserved: 0, seedStageError: undefined,
    lengthTarget: generation.lengthTarget ?? "standard", currentStep: "Seeds ready",
  });
  await ctx.db.insert("seedDecisionEvents", {
    projectId: generation.projectId, generationId: generation._id,
    kind: "initialized", at: Date.now(), actorSystem: true,
  });
  // Owner decision 65: the first step's Batch starts now, not when a browser
  // mounts the Seed workspace; the browser's open reuses it. Scheduled, so a
  // refused dispatch never undoes the stage opening.
  await ctx.scheduler.runAfter(0, startFirstSeedBatchRef, { generationId: generation._id });
  await refreshProjectGenerationActivity(ctx, generation.projectId);
  return null;
}

export type FrozenBrainArtifact = {
  blocks: OrderedPayload["brainExemplars"];
  styleGuidance: string;
  orderedContext: OrderedPayload["orderedContext"];
  qaCalibration?: string;
  draftStyle?: string;
  qaCalibrationDigestId?: Id<"learningDigests">;
  draftStyleDigestId?: Id<"learningDigests">;
  writerFlavor?: string;
  styleOverrides?: OrderedPayload["styleOverrides"];
};

export function parseFrozenBrainArtifact(content: string): FrozenBrainArtifact {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    domainError("INVALID_STATE", "Frozen drafting artifacts are malformed");
  }
  if (!value || typeof value !== "object") {
    domainError("INVALID_STATE", "Frozen drafting artifacts are malformed");
  }
  const artifact = value as Partial<FrozenBrainArtifact>;
  const blocks = artifact.blocks;
  if (
    !blocks ||
    typeof blocks.analyzer !== "string" ||
    typeof blocks.s242 !== "string" ||
    typeof blocks.s244 !== "string" ||
    typeof blocks.s246 !== "string" ||
    typeof artifact.styleGuidance !== "string" ||
    !artifact.orderedContext
  ) {
    domainError("INVALID_STATE", "Frozen drafting artifacts are incomplete");
  }
  return artifact as FrozenBrainArtifact;
}

export async function frozenOrderedPayload(
  ctx: MutationCtx,
  generation: Doc<"generations">,
  summaryVersionId: Id<"summaryVersions">
): Promise<OrderedPayload> {
  const [analysis, brain] = await Promise.all([
    ctx.db.query("generationArtifacts")
      .withIndex("by_generationId_and_kind", (q) =>
        q.eq("generationId", generation._id).eq("kind", "analysis"))
      .unique(),
    ctx.db.query("generationArtifacts")
      .withIndex("by_generationId_and_kind", (q) =>
        q.eq("generationId", generation._id).eq("kind", "brain_blocks"))
      .unique(),
  ]);
  if (!analysis || !brain) {
    domainError("INVALID_STATE", "Frozen drafting artifacts are unavailable");
  }
  const artifact = parseFrozenBrainArtifact(brain.content);
  return {
    analysis: analysis.content,
    brainExemplars: artifact.blocks,
    ...(artifact.qaCalibration ? { qaCalibration: artifact.qaCalibration } : {}),
    ...(artifact.draftStyle ? { draftStyle: artifact.draftStyle } : {}),
    ...(artifact.qaCalibrationDigestId
      ? { qaCalibrationDigestId: artifact.qaCalibrationDigestId }
      : {}),
    ...(artifact.draftStyleDigestId
      ? { draftStyleDigestId: artifact.draftStyleDigestId }
      : {}),
    ...(artifact.writerFlavor ? { writerFlavor: artifact.writerFlavor } : {}),
    ...(artifact.styleOverrides ? { styleOverrides: artifact.styleOverrides } : {}),
    orderedContext: artifact.orderedContext,
    frozenStyleGuidance: artifact.styleGuidance,
    summaryVersionId,
  };
}

export async function createFrozenOrderedChain(
  ctx: MutationCtx,
  generation: Doc<"generations">,
  summaryVersionId: Id<"summaryVersions">,
  payload: OrderedPayload
): Promise<{
  candidateRunId: Id<"generationCandidateRuns">;
  scheduledJobId: Id<"_scheduled_functions">;
}> {
  const model = generation.singleModelId ?? MODEL;
  const frozen = generationModelFreeze(generation).entries.find((entry) => entry.id === model);
  const candidate = frozen ? entryFromFrozen(frozen) : seedModelById(model);
  if (!candidate) domainError("INVALID_STATE", "Frozen generation model is unavailable");
  const now = Date.now();
  const candidateRunId = await ctx.db.insert("generationCandidateRuns", {
    generationId: generation._id,
    projectId: generation.projectId,
    model: candidate.id,
    label: candidate.label,
    status: "running",
    queuedAt: now,
    startedAt: now,
  });
  const order = payload.orderedContext.buildOrder;
  if (order.length !== 3) domainError("INVALID_STATE", "Frozen Build Order is invalid");
  for (const [index, section] of order.entries()) {
    await ctx.db.insert("generationSectionRuns", {
      generationId: generation._id,
      projectId: generation.projectId,
      section: sectionKeyOf(section),
      status: index === 0 ? "queued" : "pending",
      model: candidate.id,
      label: candidate.label,
      attempt: 1,
      candidateRunId,
      orderIndex: index,
      queuedAt: now,
    });
  }
  // Persisted once; the chain's actions receive its id (2026-09-25).
  const payloadId = await persistOrderedPayload(ctx, generation._id, candidateRunId, {
    ...payload,
    summaryVersionId,
  });
  const scheduledJobId = await ctx.scheduler.runAfter(
    0,
    generateOrderedSectionRef,
    {
      generationId: generation._id,
      candidateRunId,
      section: order[0],
      payloadId,
    }
  );
  await ctx.db.patch(candidateRunId, { scheduledJobId });
  return { candidateRunId, scheduledJobId };
}

export function refuseSummaryCapacity(error: unknown): never {
  if (error instanceof SeedContextLimitError) {
    domainError("INVALID_INPUT", error.message, {
      reason: "SUMMARY_CAPACITY_EXCEEDED",
      limit: error.limit,
    });
  }
  throw error;
}

export function summaryOrdinaryAdmission(args: {
  section: SectionNumber;
  storylineText: string;
  briefEntries: ReadonlyArray<{
    group: string;
    text: string;
    change?: string;
  }>;
  payload: OrderedPayload;
}) {
  const activeEntries = args.briefEntries.filter((entry) => entry.change !== "removed");
  return projectSummaryOrdinaryChecks({
    storylineText: args.storylineText,
    confidenceMap: activeEntries
      .filter((entry) => entry.group === "confidenceMap")
      .map((entry) => ({ text: entry.text })),
    glossaryTerms: activeEntries
      .filter((entry) => entry.group === "glossaryTerm")
      .map((entry) => entry.text),
    writerFlavor: args.payload.writerFlavor,
    rules: args.payload.orderedContext.selfCheckRules.filter(
      (rule) =>
        (rule.section === undefined || rule.section === args.section) &&
        rule.maxWords === undefined &&
        rule.maxLines === undefined
    ),
  });
}

/** Argument validators of generations.signOffSeedStage. */
export const signOffSeedStageArgs = {
  generationId: v.id("generations"),
  expectedSeedStageVersion: v.number(),
};

/** Handler of generations.signOffSeedStage. */
export async function signOffSeedStageHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof signOffSeedStageArgs>
) {
  const generation = await ctx.db.get(args.generationId);
  if (!generation) domainError("NOT_FOUND", "Generation not found");
  const { user, project } = await requireReportEditAccess(ctx, generation.projectId);
  if (
    resolveGatedWorkflow(generation) !== "seeds" ||
    generation.status !== "awaiting_input" ||
    generation.summaryVersionId ||
    project.activeGenerationId !== generation._id
  ) {
    domainError("INVALID_STATE", "The seed stage is closed", {
      reason: "SEED_STAGE_CLOSED",
    });
  }
  if (
    !Number.isSafeInteger(args.expectedSeedStageVersion) ||
    args.expectedSeedStageVersion !== (generation.seedStageVersion ?? 0)
  ) {
    domainError("STALE_REVISION", "Seed decisions changed; refresh and retry");
  }
  const readiness = await readSeedReadiness(ctx, {
    generationId: generation._id,
    includeState: true,
  });
  if (!readiness.complete || !readiness.ready) {
    domainError("INVALID_STATE", "Every required seed decision must be ready before sign-off");
  }
  const state = readiness.state;
  if (!state) domainError("INVALID_STATE", "Seed readiness state is unavailable");
  // Owner decision 32: the analysis and Brain retrieval run in the
  // background during the seed stage; drafting needs both.
  requireDraftingInputsReady(generation);
  if (!generation.briefVersionId || !generation.writerSettings) {
    domainError("INVALID_STATE", "Frozen Brief and settings are required for sign-off");
  }
  const activeSelectionRows = state.selectionRows.filter((row) => row.selected);
  const selectedIds = new Set(activeSelectionRows.map((row) => row.seedId));
  const selectedSeeds = orderShownSet({
    seeds: state.seeds,
    batches: state.batches,
  }).filter((seed) => selectedIds.has(seed._id));
  const skippedRoleIds = PD_SUBSECTIONS.filter((role) =>
    state.subsections.some(
      (row) => row.roleId === role.roleId && row.state === "skipped"
    )
  ).map((role) => role.roleId);
  const briefRead = await readBriefEntryRowsBounded(
    ctx,
    generation.briefVersionId,
    "immutable_input"
  );
  if (briefRead.kind === "row_limit") {
    domainError("INVALID_INPUT", "Frozen Brief exceeds the runtime row budget", {
      reason: "SUMMARY_BRIEF_ROWS_EXCEEDED",
      limit: String(MAX_BRIEF_ENTRY_ROWS),
    });
  }
  if (briefRead.kind === "byte_limit") {
    domainError("INVALID_INPUT", "Frozen Brief exceeds the runtime byte budget", {
      reason: "SUMMARY_BRIEF_BYTES_EXCEEDED",
      limit: String(BRIEF_CONSUMER_READ_BYTES),
    });
  }
  const briefEntries = briefRead.rows;
  const briefDoc = await ctx.db.get(generation.briefVersionId);
  if (!briefDoc || briefDoc.projectId !== generation.projectId) {
    domainError("INVALID_STATE", "Frozen Brief is unavailable");
  }
  const claimExclusions = briefEntries.filter(
    (entry) => entry.group === "claimExclusion" && entry.change !== "removed"
  );
  const settingsHash = await sha256Text(JSON.stringify({
    writerSettings: generation.writerSettings,
    lengthTarget: generation.lengthTarget,
  }));
  const now = Date.now();
  const summaryVersionId = await ctx.db.insert("summaryVersions", {
    projectId: generation.projectId,
    generationId: generation._id,
    version: 1,
    originGenerationId: generation._id,
    briefVersionId: generation.briefVersionId,
    reportTitle: project.title,
    settingsHash,
    skippedRoleIds,
    readiness: true,
    signedOffBy: user._id,
    signedOffAt: now,
  });
  const frozenItems: Array<{
    _id: Id<"summaryItems">;
    itemId: Id<"summaryItems">;
    roleId: (typeof PD_SUBSECTIONS)[number]["roleId"];
    kind: "standard" | "optional" | "multiple";
    bullets: string[];
    support: "source_supported" | "writer_asserted";
    uncertaintySeedId?: Id<"seeds">;
    experimentSeedIds?: Id<"seeds">[];
    confirmedExclusion?: boolean;
    seedId: Id<"seeds">;
  }> = [];
  for (const [order, seed] of selectedSeeds.entries()) {
    const selection = activeSelectionRows.find((row) => row.seedId === seed._id);
    if (!selection) domainError("INVALID_STATE", "Summary selection is unavailable");
    const subsection = state.subsections.find((row) => row.roleId === seed.roleId);
    const bullets = materializeFinalWording(seed, selection);
    const confirmedExclusion = Boolean(
      subsection?.exclusionAcknowledgedAt &&
      claimExclusions.some((entry) =>
        matchesSeedExclusion(bullets, entry.text, entry.exactExcerpt)
      )
    );
    const itemId = await ctx.db.insert("summaryItems", {
      projectId: generation.projectId,
      generationId: generation._id,
      summaryVersionId,
      roleId: seed.roleId,
      kind: subsection?.kind ?? "standard",
      order,
      seedId: seed._id,
      bullets,
      support: selection.editedBullets ? "writer_asserted" : seed.support,
      tags: seed.tags,
      edited: selection.editedBullets !== undefined,
      ...(seed.uncertaintySeedId ? { uncertaintySeedId: seed.uncertaintySeedId } : {}),
      ...(seed.experimentSeedIds ? { experimentSeedIds: seed.experimentSeedIds } : {}),
      ...(confirmedExclusion ? { confirmedExclusion: true } : {}),
    });
    frozenItems.push({
      _id: itemId,
      itemId,
      roleId: seed.roleId,
      kind: subsection?.kind ?? "standard",
      bullets,
      support: selection.editedBullets ? "writer_asserted" : seed.support,
      ...(seed.uncertaintySeedId ? { uncertaintySeedId: seed.uncertaintySeedId } : {}),
      ...(seed.experimentSeedIds ? { experimentSeedIds: seed.experimentSeedIds } : {}),
      ...(confirmedExclusion ? { confirmedExclusion: true } : {}),
      seedId: seed._id,
    });
  }
  const referencesBySeedId = new Map(
    frozenItems.map((item) => [item.seedId, item.bullets] as const)
  );
  const { sourceRefsByItemId } = await loadSummarySourceRefs(ctx, generation, frozenItems);
  const payload = await frozenOrderedPayload(ctx, generation, summaryVersionId);
  try {
    for (const section of ["242", "244", "246"] as const) {
      const plan = buildFrozenSummaryPlan({
        section: `s${section}`,
        items: frozenItems,
        skippedRoleIds,
        referencesBySeedId,
        sourceRefsByItemId,
      });
      const ordinaryChecks = summaryOrdinaryAdmission({
        section,
        storylineText: briefDoc.storylineText,
        briefEntries,
        payload,
      });
      summarySelfCheckWorstCaseResponse({
        ordinaryChecks,
        planChecks: plan.checks,
        includeStorylineQuestion:
          briefDoc.storylineText.trim().length > 0 &&
          briefEntries.some(
            (entry) => entry.group === "confidenceMap" && entry.change !== "removed"
          ),
      });
    }
  } catch (error) {
    refuseSummaryCapacity(error);
  }
  await terminateSeedAttempts(ctx, generation._id);
  await bypassSeedEpisodes(ctx, generation._id);
  await ctx.db.insert("seedDecisionEvents", {
    projectId: generation.projectId,
    generationId: generation._id,
    kind: "signOff",
    at: now,
    actorUserId: user._id,
    snapshot: {
      items: await Promise.all(frozenItems.map(async (item) => {
        const selection = activeSelectionRows.find((row) => row.seedId === item.seedId)!;
        return {
          seedId: item.seedId,
          wordingHash: await sha256Text(stableSerialize(item.bullets)),
          selectionVersion: selection.version,
        };
      })),
    },
  });
  await appendGenerationProgress(ctx, generation, [
    `Summary signed off. Drafting ${payload.orderedContext.buildOrder.join(" → ")} in Build Order.`,
  ]);
  await transitionGeneration(ctx, generation, "running", {
    summaryVersionId,
    currentStep: `Drafting ${payload.orderedContext.buildOrder[0]}…`,
    totalCandidates: 1,
    candidatesDone: 0,
    candidatesFailed: 0,
    productionOrder: payload.orderedContext.buildOrder,
    lastProgressAt: now,
  });
  const chain = await createFrozenOrderedChain(
    ctx,
    generation,
    summaryVersionId,
    payload
  );
  await refreshProjectGenerationActivity(ctx, generation.projectId);
  return { summaryVersionId, candidateRunId: chain.candidateRunId };
}

/** Argument validators of generations.beginSummaryRecovery. */
export const beginSummaryRecoveryArgs = {
  generationId: v.id("generations"),
  promptVersion: v.string(),
};

/** Handler of generations.beginSummaryRecovery. */
export async function beginSummaryRecoveryHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof beginSummaryRecoveryArgs>
): Promise<boolean> {
  const generation = await ctx.db.get(args.generationId);
  if (
    !generation ||
    generation.status !== "reserved" ||
    resolveGatedWorkflow(generation) !== "seeds" ||
    !generation.summaryVersionId ||
    !generation.retryOfGenerationId
  ) return false;
  const project = await ctx.db.get(generation.projectId);
  if (!project || project.activeGenerationId !== generation._id) return false;
  if (!generation.sourceIdMap) {
    domainError("INVALID_STATE", "Frozen recovery source map is unavailable");
  }
  const payload = await frozenOrderedPayload(
    ctx,
    generation,
    generation.summaryVersionId
  );
  await assertFrozenSummaryRuntimeAdmission(ctx, generation, payload);
  const now = Date.now();
  await appendGenerationProgress(ctx, generation, [
    `Drafting frozen Summary in ${payload.orderedContext.buildOrder.join(" → ")} Build Order.`,
  ]);
  await transitionGeneration(ctx, generation, "running", {
    promptVersion: args.promptVersion,
    currentStep: `Drafting ${payload.orderedContext.buildOrder[0]}…`,
    productionOrder: payload.orderedContext.buildOrder,
    lastProgressAt: now,
  });
  await createFrozenOrderedChain(
    ctx,
    generation,
    generation.summaryVersionId,
    payload
  );
  await refreshProjectGenerationActivity(ctx, generation.projectId);
  return true;
}

/** Argument validators of generations.recordSeedInitializationFailure. */
export const recordSeedInitializationFailureArgs = { generationId: v.id("generations") };

/** Handler of generations.recordSeedInitializationFailure. */
export async function recordSeedInitializationFailureHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof recordSeedInitializationFailureArgs>
) {
  const generation = await ctx.db.get(args.generationId);
  if (!generation || resolveGatedWorkflow(generation) !== "seeds" ||
      generation.status !== "running" || generation.summaryVersionId ||
      await isProjectDeleting(ctx, generation.projectId)) return null;
  const project = await ctx.db.get(generation.projectId);
  if (project?.activeGenerationId !== generation._id) return null;
  // Decision 65: a run that failed while attached to a Brief preparation
  // lets it go, so the Reading page never keeps showing that attempt's
  // facts beside the retry.
  const attachment = generation.briefPreparation;
  const now = Date.now();
  await ctx.db.patch(generation._id, {
    seedStageError: SEED_INITIALIZATION_ERROR,
    currentStep: "Seed preparation needs a retry",
    ...(attachment?.state === "attached" ? { briefPreparation: { ...attachment, state: "released" as const, at: now } } : {}),
  });
  if (attachment?.state === "attached") {
    const waiters = await ctx.db
      .query("briefPreparationWaiters")
      .withIndex("by_generationId", (q) => q.eq("generationId", generation._id))
      .take(10);
    for (const waiter of waiters) {
      if (waiter.status === "waiting") await ctx.db.patch(waiter._id, { status: "released", releasedAt: now });
    }
  }
  return null;
}

/** Argument validators of generations.retryInitializeSeedStage. */
export const retryInitializeSeedStageArgs = { generationId: v.id("generations") };

/** Handler of generations.retryInitializeSeedStage. */
export async function retryInitializeSeedStageHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof retryInitializeSeedStageArgs>
) {
  const existing = await ctx.db.get(args.generationId);
  if (!existing) domainError("NOT_FOUND", "Generation not found");
  const { user } = await requireReportEditAccess(ctx, existing.projectId);
  const generation = await requireSeedInitialization(ctx, args.generationId);
  if (generation.status !== "running" || !generation.seedStageError) {
    domainError("INVALID_STATE", "Seed initialization is not waiting for a retry");
  }
  await requireFrozenSeedArtifacts(ctx, generation);
  // Audit wave 2: a retry counts as a generation start.
  await limitGenerationStart(ctx, user._id, existing.projectId);
  await ctx.db.patch(generation._id, { seedStageError: undefined, currentStep: "Preparing seeds" });
  await ctx.scheduler.runAfter(0, internal.ai.iterative.resumeSeedInitialization, args);
  return null;
}

/**
 * CAP-13 rule 5 (2026-09-29, second): the active Feedback of the run that
 * signed the Summary off, in the order it was given. Nothing changes it
 * after sign-off.
 */
async function activeFeedbackRows(
  ctx: { db: QueryCtx["db"] },
  generation: Doc<"generations">,
  originGenerationId: Id<"generations">
) {
  const rows = await ctx.db
    .query("seedFeedbackRequests")
    .withIndex("by_generationId_and_status_and_roleId", (q) =>
      q.eq("generationId", originGenerationId).eq("status", "active"))
    .take(MAX_SEED_SNAPSHOT_ROWS + 1);
  if (rows.length > MAX_SEED_SNAPSHOT_ROWS) {
    domainError("INVALID_INPUT", "Frozen Summary Feedback exceeds the drafting budget");
  }
  return rows
    .filter((row) => row.projectId === generation.projectId)
    .sort((a, b) => a._creationTime - b._creationTime);
}

/**
 * 2026-09-29 (second): for the assembled-draft consistency pass, which Lines
 * carry an idea the writer kept despite each Claim Exclusion, and which
 * Lines set each Glossary Term aside (the same rules as the drafting plan,
 * without reading the plan's evidence). Null without a signed-off Summary.
 */
export async function loadWriterPrecedenceByLine(
  ctx: { db: QueryCtx["db"] },
  generation: Doc<"generations">,
  brief: { claimExclusions: ReadonlyArray<{ text: string; exactExcerpt?: string }>; glossaryTerms: readonly string[] } | null
): Promise<{
  keptExclusions: Array<{ text: string; sections: SectionNumber[] }>;
  glossarySetAside: Array<{ term: string; sections: SectionNumber[] }>;
} | null> {
  if (!generation.summaryVersionId || !brief) return null;
  const summary = await ctx.db.get(generation.summaryVersionId);
  if (!summary || summary.projectId !== generation.projectId) return null;
  const originGenerationId = generation.originGenerationId ?? generation._id;
  const items = await ctx.db.query("summaryItems")
    .withIndex("by_summaryVersionId_and_order", (q) =>
      q.eq("summaryVersionId", summary._id))
    .take(SEED_DECISION_COLLECTION_ROWS + 1);
  if (items.length > SEED_DECISION_COLLECTION_ROWS) return null;
  const skipped = new Set(summary.skippedRoleIds);
  const feedbackRows = await activeFeedbackRows(ctx, generation, originGenerationId);
  const keptExclusions: Array<{ text: string; sections: SectionNumber[] }> = [];
  const glossarySetAside: Array<{ term: string; sections: SectionNumber[] }> = [];
  const push = <T extends { sections: SectionNumber[] }>(
    list: T[],
    find: (entry: T) => boolean,
    make: () => T,
    section: SectionNumber
  ) => {
    const entry = list.find(find) ?? (list.push(make()), list[list.length - 1]!);
    if (!entry.sections.includes(section)) entry.sections.push(section);
  };
  for (const section of ["242", "244", "246"] as const) {
    const key = `s${section}`;
    const roleIds = new Set(PD_SUBSECTIONS.filter((role) => role.section === key).map((role) => role.roleId));
    const lineItems = items.filter((item) => roleIds.has(item.roleId) && !skipped.has(item.roleId));
    for (const item of lineItems) {
      if (!item.confirmedExclusion) continue;
      for (const exclusion of brief.claimExclusions) {
        if (matchesSeedExclusion(item.bullets, exclusion.text, exclusion.exactExcerpt)) {
          push(keptExclusions, (entry) => entry.text === exclusion.text, () => ({ text: exclusion.text, sections: [] }), section);
        }
      }
    }
    const editedItems: Array<{ original: string[]; edited: string[] }> = [];
    for (const item of lineItems) {
      if (item.edited === false) continue;
      const seed = await ctx.db.get(item.seedId);
      if (!seed || seed.projectId !== generation.projectId) continue;
      if (stableSerialize(item.bullets) === stableSerialize(seed.bullets)) continue;
      editedItems.push({ original: seed.bullets, edited: item.bullets });
    }
    const aside = glossaryTermsSetAside({
      glossaryTerms: brief.glossaryTerms,
      feedback: feedbackForLine(section, feedbackRows, summary.skippedRoleIds),
      editedItems,
    });
    for (const entry of aside) {
      push(glossarySetAside, (known) => known.term === entry.term, () => ({ term: entry.term, sections: [] }), section);
    }
  }
  return { keptExclusions, glossarySetAside };
}

export async function loadFrozenSectionPlan(
  ctx: { db: QueryCtx["db"] },
  generation: Doc<"generations">,
  section: SectionNumber,
  /**
   * 2026-09-29 (second): the frozen Brief's Glossary Terms, so the plan can
   * say which ones the writer's own wording sets aside in this Line.
   */
  options: { glossaryTerms?: readonly string[] } = {}
): Promise<{
  planBlock: string;
  planChecksBlock: string;
  planChecks: Array<{
    itemId?: Id<"summaryItems">;
    skippedRoleId?: PdSubsectionRoleId;
    roleId: PdSubsectionRoleId;
    mergedItemIds: Id<"summaryItems">[];
    instruction: "cover" | "skip";
    confirmedExclusion: boolean;
    support?: "source_supported" | "writer_asserted";
    wording: string[];
    relationshipReferences: Array<{
      seedId: Id<"seeds">;
      wording: string[];
    }>;
    sourceReferences: Array<{
      originatingItemId: Id<"summaryItems">;
      sourceId: string;
      exactExcerpt: string;
    }>;
    /** Quotes marked for a check that were left out of this item's evidence. */
    quotesLeftOut?: number;
  }>;
  /**
   * 2026-09-28 (second, edited terms): the writer's edited terms in this
   * Line's COVER items (conflicts aside), kept word for word by drafting,
   * compression and the repair.
   */
  editedTerms: string[];
  /**
   * 2026-09-29 (second, CAP-13 rule 5): the active Feedback that reaches
   * this Line (its steps and every earlier step), which outranks the Brief.
   * Withdrawn Feedback, and Feedback a Skip suspended, never does.
   */
  writerFeedback: WriterFeedback[];
  /** The Glossary Terms the writer's own wording governs in this Line. */
  glossarySetAside: GlossarySetAside[];
}> {
  if (!generation.summaryVersionId) {
    return {
      planBlock: "",
      planChecksBlock: "",
      planChecks: [],
      editedTerms: [],
      writerFeedback: [],
      glossarySetAside: [],
    };
  }
  const summary = await ctx.db.get(generation.summaryVersionId);
  if (!summary || summary.projectId !== generation.projectId) {
    domainError("INVALID_STATE", "Frozen Summary is unavailable");
  }
  const originGenerationId = generation.originGenerationId ?? generation._id;
  if (summary.originGenerationId !== originGenerationId) {
    domainError("INVALID_STATE", "Frozen Summary lineage does not match the generation");
  }
  const items = await ctx.db.query("summaryItems")
    .withIndex("by_summaryVersionId_and_order", (q) =>
      q.eq("summaryVersionId", summary._id))
    .take(SEED_DECISION_COLLECTION_ROWS + 1);
  if (items.length > SEED_DECISION_COLLECTION_ROWS) {
    domainError("INVALID_INPUT", "Frozen Summary exceeds the drafting budget");
  }
  const referencesBySeedId = new Map(
    items.map((item) => [item.seedId, item.bullets] as const)
  );
  const { sourceRefsByItemId, quotesLeftOut } = await loadSummarySourceRefs(ctx, generation, items);
  const pdSection = section === "242" ? "s242" : section === "244" ? "s244" : "s246";
  const plan = buildFrozenSummaryPlan({
    section: pdSection,
    items: items.map((item) => ({
      itemId: item._id,
      roleId: item.roleId,
      kind: item.kind,
      bullets: item.bullets,
      support: item.support,
      ...(item.uncertaintySeedId
        ? { uncertaintySeedId: item.uncertaintySeedId }
        : {}),
      ...(item.experimentSeedIds
        ? { experimentSeedIds: item.experimentSeedIds }
        : {}),
      ...(item.confirmedExclusion ? { confirmedExclusion: true } : {}),
    })),
    skippedRoleIds: summary.skippedRoleIds,
    referencesBySeedId,
    sourceRefsByItemId,
  });
  // An edited item's terms: what the writer changed or added compared with
  // the model's original Seed (immutable). Items frozen before 2026-09-24
  // lack the flag and compare wording, as the Summary reader does.
  // Since 2026-09-29 (second) an idea the writer kept despite a Claim
  // Exclusion is drafted like any other (CAP-13 rule 4), so its edited terms
  // count too.
  const itemsById = new Map(items.map((item) => [item._id, item] as const));
  const editedTerms: string[] = [];
  const editedItems: Array<{ original: string[]; edited: string[] }> = [];
  const seenItems = new Set<string>();
  for (const check of plan.checks) {
    if (check.instruction !== "cover") continue;
    for (const itemId of check.mergedItemIds) {
      if (seenItems.has(itemId)) continue;
      seenItems.add(itemId);
      const item = itemsById.get(itemId);
      if (!item || item.edited === false) continue;
      const seed = await ctx.db.get(item.seedId);
      if (!seed || seed.projectId !== generation.projectId) continue;
      if (item.edited === undefined && stableSerialize(item.bullets) === stableSerialize(seed.bullets)) {
        continue;
      }
      editedItems.push({ original: seed.bullets, edited: item.bullets });
      for (const term of editedTermsOf(seed.bullets, item.bullets)) {
        if (!editedTerms.some((known) => known.toLowerCase() === term.toLowerCase())) {
          editedTerms.push(term);
        }
      }
    }
  }
  const writerFeedback = feedbackForLine(
    section,
    await activeFeedbackRows(ctx, generation, originGenerationId),
    summary.skippedRoleIds
  );
  const glossarySetAside = glossaryTermsSetAside({
    glossaryTerms: options.glossaryTerms ?? [],
    feedback: writerFeedback,
    editedItems,
  });
  return {
    writerFeedback,
    glossarySetAside,
    editedTerms: editedTerms.slice(0, MAX_EDITED_TERMS_PER_LINE),
    planBlock: `\n\n${plan.block}`,
    planChecksBlock: plan.checksBlock,
    planChecks: plan.checks.map((check) => ({
      ...(check.itemId ? { itemId: check.itemId } : {}),
      ...(check.skippedRoleId ? { skippedRoleId: check.skippedRoleId } : {}),
      roleId: check.roleId,
      mergedItemIds: check.mergedItemIds,
      instruction: check.instruction,
      confirmedExclusion: check.confirmedExclusion,
      ...(check.support ? { support: check.support } : {}),
      wording: check.wording,
      relationshipReferences: check.relationshipReferences,
      sourceReferences: check.sourceReferences,
      // Not part of the plan the model reads; the Compliance Note uses it.
      ...(check.itemId && quotesLeftOut.has(check.itemId)
        ? { quotesLeftOut: quotesLeftOut.get(check.itemId) }
        : {}),
    })),
  };
}

/**
 * Recovery admission for the deployment that will execute the frozen
 * Summary. Both provider-input and complete-output capacity are checked for
 * every Section before the chain is created or any provider can run.
 */
export async function assertFrozenSummaryRuntimeAdmission(
  ctx: MutationCtx,
  generation: Doc<"generations">,
  payload: OrderedPayload
): Promise<Awaited<ReturnType<typeof loadBriefCheck>>> {
  const loadedBrief = await loadBriefCheck(ctx, generation);
  if (!loadedBrief.briefDoc || !loadedBrief.brief) {
    domainError("INVALID_STATE", "Frozen Summary Brief is unavailable", {
      reason: "SUMMARY_BRIEF_UNREADABLE",
    });
  }
  try {
    for (const section of ["242", "244", "246"] as const) {
      const plan = await loadFrozenSectionPlan(ctx, generation, section);
      const ordinaryChecks = summaryOrdinaryAdmission({
        section,
        storylineText: loadedBrief.briefDoc.storylineText,
        briefEntries: loadedBrief.briefEntries,
        payload,
      });
      summarySelfCheckWorstCaseResponse({
        ordinaryChecks,
        planChecks: plan.planChecks,
        includeStorylineQuestion:
          loadedBrief.briefDoc.storylineText.trim().length > 0 &&
          loadedBrief.briefEntries.some(
            (entry) =>
              entry.group === "confidenceMap" && entry.change !== "removed"
          ),
      });
    }
  } catch (error) {
    refuseSummaryCapacity(error);
  }
  return loadedBrief;
}

export async function loadSummarySourceRefs(
  ctx: { db: QueryCtx["db"] },
  generation: Doc<"generations">,
  items: ReadonlyArray<{
    _id: Id<"summaryItems">;
    seedId: Id<"seeds">;
  }>
) {
  const result = new Map<
    Id<"summaryItems">,
    Array<{ sourceId: string; exactExcerpt: string }>
  >();
  // 2026-09-27 (third): a quote marked for a check may not back its item,
  // so it is never drafting evidence; the item's wording still is.
  const quotesLeftOut = new Map<Id<"summaryItems">, number>();
  for (const item of items) {
    const rows = await ctx.db.query("seedProvenance")
      .withIndex("by_seedId", (q) => q.eq("seedId", item.seedId))
      .take(129);
    if (rows.length > 128) {
      domainError("INVALID_INPUT", "Seed provenance exceeds the drafting budget");
    }
    const marked = rows.filter((row) => row.needsQuoteCheck === true).length;
    if (marked > 0) quotesLeftOut.set(item._id, marked);
    result.set(item._id, rows.filter((row) => row.needsQuoteCheck !== true).map((row) => {
      if (row.projectId !== generation.projectId) {
        domainError("INVALID_STATE", "Seed provenance belongs to another project");
      }
      resolveFrozenSourceId(row.sourceId, generation.sourceIdMap);
      return {
        // Keep the immutable origin id in provider bytes. The resolver above
        // validates its current attempt row without making retries differ.
        sourceId: row.sourceId,
        exactExcerpt: row.exactExcerpt,
      };
    }));
  }
  return { sourceRefsByItemId: result, quotesLeftOut };
}
