/**
 * The ordered, ungated section chain (story 2, AD-24): one fenced step per
 * section in Build Order, then finalize.
 *
 * Split out of convex/generations.ts (2026-09-25, phase 4). The Convex
 * functions stay registered in convex/generations.ts under their old names;
 * this module holds their handlers and helpers.
 */
import type { QueryCtx, MutationCtx } from "../../_generated/server";
import type { Id, Doc } from "../../_generated/dataModel";
import {
  type SectionNumber,
  sectionKeyOf,
  orderedPayloadValidator,
  sectionNumberValidator,
  type OrderedPayload,
} from "../orderedChain";
import { v, type Infer, type ObjectType } from "convex/values";
import { resolveGatedWorkflow } from "../gatedWorkflow";
import { appendGenerationProgress } from "../generationProgress";
import {
  persistOrderedPayload,
  resolveOrderedPayload,
  loadOrderedPayload,
  forwardOrderedPayload,
} from "../orderedPayloadStore";
import { internal } from "../../_generated/api";
import { loadBriefCheck } from "./brief";
import { domainError } from "../contracts";
import { assertFrozenSummaryRuntimeAdmission, loadFrozenSectionPlan } from "./seedStage";
import { complianceNoteDraftValidator, complianceNoteRow } from "../complianceNote";
import {
  sectionRunTypedFields,
  sectionRunJson,
  sectionRunSelfCheck,
} from "../sectionRunData";
import { ORDERED_SECTION_TITLES } from "../../ai/promptDefinitions";
import { settleCandidateRun } from "./candidates";
import { requireReportEditAccess } from "../roleCapabilities";
import { requireInternalProjectAccess, getInternalProjectAccessOrNull } from "../auth";

// ─── Story 2: ordered, ungated section chain (single/compare, AD-24) ─────────
//
// generateCandidate (non-ghost) → createOrderedSectionRuns → one scheduled
// ai/orderedGeneration.generateOrderedSection per section, fenced by
// claimOrderedSectionRun's CAS → completeOrderedSectionRun schedules the next
// section (or finalizeOrderedCandidate) atomically with its writes. No
// approval gate: iterative's approveSectionDraft is never in this path, and
// iterative generations never create these rows. A chain stalled between
// sections is recovered by the existing failStaleGenerations reaper, which
// ages the generation from lastProgressAt (DW-119) — stamped by the three
// chain mutations below — rather than from startedAt.

export async function orderedRunsForCandidate(
  ctx: { db: QueryCtx["db"] },
  candidateRunId: Id<"generationCandidateRuns">
) {
  const rows = await ctx.db
    .query("generationSectionRuns")
    .withIndex("by_candidateRunId_and_section", (q) =>
      q.eq("candidateRunId", candidateRunId)
    )
    .take(3);
  return rows.sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
}

export async function orderedRunForSection(
  ctx: { db: QueryCtx["db"] },
  candidateRunId: Id<"generationCandidateRuns">,
  section: SectionNumber
) {
  return await ctx.db
    .query("generationSectionRuns")
    .withIndex("by_candidateRunId_and_section", (q) =>
      q.eq("candidateRunId", candidateRunId).eq("section", sectionKeyOf(section))
    )
    .unique();
}

export function sectionNumberOfRow(row: Doc<"generationSectionRuns">): SectionNumber {
  return row.section.slice(1) as SectionNumber;
}

/** A Self-check summary's status and plan coverage, from the typed value or
 * its JSON string; null when neither carries a status. */
export function selfCheckResultOf(selfCheck: unknown): {
  status: string;
  planCoverage?: "complete" | "incomplete" | "unavailable";
} | null {
  let parsed: unknown = selfCheck;
  if (typeof selfCheck === "string") {
    try {
      parsed = JSON.parse(selfCheck);
    } catch {
      return null;
    }
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("status" in parsed) ||
    typeof parsed.status !== "string"
  ) {
    return null;
  }
  if (
    "planCoverage" in parsed &&
    parsed.planCoverage &&
    typeof parsed.planCoverage === "object" &&
    "status" in parsed.planCoverage &&
    (parsed.planCoverage.status === "complete" ||
      parsed.planCoverage.status === "incomplete" ||
      parsed.planCoverage.status === "unavailable")
  ) {
    return {
      status: parsed.status,
      planCoverage: parsed.planCoverage.status,
    };
  }
  return { status: parsed.status };
}

/** The CAS every chain write re-checks: a live non-ghost candidate run of a
 * running generation that still owns its project's active pointer. */
export async function orderedChainFence(
  ctx: MutationCtx,
  generationId: Id<"generations">,
  candidateRunId: Id<"generationCandidateRuns">
) {
  const run = await ctx.db.get(candidateRunId);
  if (!run || run.ghost || run.status !== "running" || run.generationId !== generationId) {
    return null;
  }
  const generation = await ctx.db.get(generationId);
  if (!generation || generation.status !== "running") return null;
  const project = await ctx.db.get(generation.projectId);
  if (!project || project.deletionStartedAt !== undefined || project.activeGenerationId !== generation._id) return null;
  return { run, generation, project };
}

/** Argument validators of generations.createOrderedSectionRuns. */
export const createOrderedSectionRunsArgs = {
  generationId: v.id("generations"),
  candidateRunId: v.id("generationCandidateRuns"),
  payload: orderedPayloadValidator,
};

/** Handler of generations.createOrderedSectionRuns. */
export async function createOrderedSectionRunsHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof createOrderedSectionRunsArgs>
): Promise<boolean> {
  const fence = await orderedChainFence(ctx, args.generationId, args.candidateRunId);
  if (!fence) return false;
  if ((fence.generation.candidateMode ?? "compare") === "iterative") {
    if (
      resolveGatedWorkflow(fence.generation) !== "seeds" ||
      !fence.generation.summaryVersionId ||
      args.payload.summaryVersionId !== fence.generation.summaryVersionId
    ) return false;
  }
  const order = args.payload.orderedContext.buildOrder;
  if (order.length === 0) return false;
  if ((await orderedRunsForCandidate(ctx, fence.run._id)).length > 0) return false;
  const now = Date.now();
  for (const [index, section] of order.entries()) {
    await ctx.db.insert("generationSectionRuns", {
      generationId: fence.generation._id,
      projectId: fence.generation.projectId,
      section: sectionKeyOf(section),
      status: index === 0 ? "queued" : "pending",
      model: fence.run.model,
      label: fence.run.label,
      attempt: 1,
      candidateRunId: fence.run._id,
      orderIndex: index,
      queuedAt: now,
    });
  }
  await appendGenerationProgress(ctx, fence.generation, [
    `${fence.run.label}: drafting ${order.join(" → ")} in order; each section is Self-checked before it is shown.`,
  ]);
  await ctx.db.patch(fence.generation._id, {
    lastProgressAt: now,
  });
  // The payload travels once, into this row; every scheduled step of the
  // chain receives its id (2026-09-25).
  const payloadId = await persistOrderedPayload(
    ctx,
    fence.generation._id,
    fence.run._id,
    args.payload
  );
  await ctx.scheduler.runAfter(0, internal.ai.orderedGeneration.generateOrderedSection, {
    generationId: args.generationId,
    candidateRunId: args.candidateRunId,
    section: order[0],
    payloadId,
  });
  return true;
}

/** Argument validators of generations.claimOrderedSectionRun. */
export const claimOrderedSectionRunArgs = {
  generationId: v.id("generations"),
  candidateRunId: v.id("generationCandidateRuns"),
  section: sectionNumberValidator,
  promptVersion: v.optional(v.string()),
  payload: v.optional(orderedPayloadValidator),
  payloadId: v.optional(v.id("generationArtifacts")),
};

/** Handler of generations.claimOrderedSectionRun. */
export async function claimOrderedSectionRunHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof claimOrderedSectionRunArgs>
) {
  const row = await orderedRunForSection(ctx, args.candidateRunId, args.section);
  if (!row || row.status !== "queued" || row.generationId !== args.generationId) {
    return null;
  }
  const fence = await orderedChainFence(ctx, args.generationId, args.candidateRunId);
  if (!fence) return null;
  let executionBrief:
    | Awaited<ReturnType<typeof loadBriefCheck>>
    | undefined;
  if (
    resolveGatedWorkflow(fence.generation) === "seeds" &&
    fence.generation.summaryVersionId !== undefined &&
    args.promptVersion &&
    fence.generation.promptVersion !== args.promptVersion
  ) {
    // Capacity belongs to the program that will execute the request. A
    // prior sign-off or recovery-start admission cannot authorize a newer
    // deployment. Any rejection rolls this claim back atomically.
    const payload = await resolveOrderedPayload(ctx, args.generationId, args);
    if (!payload) {
      domainError("INVALID_STATE", "Frozen Summary execution payload is unavailable");
    }
    executionBrief = await assertFrozenSummaryRuntimeAdmission(
      ctx,
      fence.generation,
      payload
    );
  }
  const orderIndex = row.orderIndex ?? 0;
  // Stopped between sections (AD-24): this section is never drafted and
  // the action finalizes what was. The first section is always drafted, so
  // a stopped generation still has something to assemble.
  if (fence.generation.stopRequestedAt !== undefined && orderIndex > 0) {
    await ctx.db.patch(row._id, { status: "pending" });
    return { stopped: true as const };
  }
  const now = Date.now();
  await ctx.db.patch(row._id, { status: "running", startedAt: now });
  // DW-119: the claim is chain progress — the reaper's window restarts here.
  await ctx.db.patch(fence.generation._id, {
    lastProgressAt: now,
    ...(resolveGatedWorkflow(fence.generation) === "seeds" &&
    fence.generation.summaryVersionId !== undefined &&
    args.promptVersion
      ? { promptVersion: args.promptVersion }
      : {}),
  });
  const priorSections = (await orderedRunsForCandidate(ctx, fence.run._id))
    .filter(
      (prior) =>
        prior.status === "drafted" &&
        (prior.orderIndex ?? 0) < orderIndex &&
        prior.draftText !== undefined
    )
    .map((prior) => ({
      section: sectionNumberOfRow(prior),
      text: prior.draftText ?? "",
    }));

  return await orderedSectionClaim(ctx, {
    generation: fence.generation,
    row,
    section: args.section,
    priorSections,
    executionBrief,
  });
}

/** The drafting input one claimed Section receives: shared by the ordered
 * chain's claim and the seed redraft's claim so both draft the same way. */
export async function orderedSectionClaim(
  ctx: MutationCtx,
  args: {
    generation: Doc<"generations">;
    row: Doc<"generationSectionRuns">;
    section: SectionNumber;
    priorSections: Array<{ section: SectionNumber; text: string }>;
    executionBrief?: Awaited<ReturnType<typeof loadBriefCheck>>;
  }
) {
  const orderIndex = args.row.orderIndex ?? 0;
  const [{ briefBlock, brief }, plan] = await Promise.all([
    args.executionBrief ?? loadBriefCheck(ctx, args.generation),
    loadFrozenSectionPlan(ctx, args.generation, args.section),
  ]);
  return {
    projectId: args.generation.projectId,
    model: args.row.model,
    label: args.row.label,
    requestedBy: args.generation.requestedBy,
    lengthTarget: args.generation.lengthTarget ?? "standard",
    orderIndex,
    isFirstInOrder: orderIndex === 0,
    priorSections: args.priorSections,
    briefBlock,
    brief,
    ...plan,
  };
}

export const storylineQuestionValidator = v.object({
  question: v.string(),
  sectionClaim: v.string(),
  storylineAlternative: v.string(),
  evidenceEntryId: v.id("generationBriefEntries"),
});

/** A drafted Section's Compliance Note rows and at most one Storyline
 * question, written for the chain and the seed redraft alike. */
export async function persistSectionNotes(
  ctx: MutationCtx,
  args: {
    generation: Doc<"generations">;
    run: Doc<"generationCandidateRuns">;
    section: SectionNumber;
    notes: Array<Infer<typeof complianceNoteDraftValidator>>;
    storylineQuestion?: Infer<typeof storylineQuestionValidator>;
    now: number;
  }
) {
  const owner = {
    projectId: args.generation.projectId,
    generationId: args.generation._id,
    candidateRunId: args.run._id,
  };
  for (const note of args.notes) {
    // A section's rows belong to that section only.
    if (note.section !== args.section) continue;
    await ctx.db.insert("complianceNotes", complianceNoteRow(note, owner));
  }
  // AD-23/AD-25: the chain's one write outside complianceNotes. The
  // question cites the Confidence Map entry the section's stronger evidence
  // rests on, so it carries a byte-validated citation like every entry.
  if (args.storylineQuestion && args.generation.briefId) {
    const evidence = await ctx.db.get(args.storylineQuestion.evidenceEntryId);
    if (
      evidence &&
      evidence.briefId === args.generation.briefId &&
      evidence.group === "confidenceMap"
    ) {
      await ctx.db.insert("generationBriefEntries", {
        briefId: evidence.briefId,
        projectId: evidence.projectId,
        group: "storylineQuestion",
        text: args.storylineQuestion.sectionClaim,
        sourceId: evidence.sourceId,
        sourceContentHash: evidence.sourceContentHash,
        startOffset: evidence.startOffset,
        endOffset: evidence.endOffset,
        exactExcerpt: evidence.exactExcerpt,
        question: {
          questionText: args.storylineQuestion.question,
          alternativeText: args.storylineQuestion.storylineAlternative,
        },
        generatedOutput: true,
        createdAt: args.now,
      });
    }
  }
}

/** A chain step must name its payload in one of the two forms. */
export function requireOrderedPayloadRef(args: {
  payload?: OrderedPayload;
  payloadId?: Id<"generationArtifacts">;
}): void {
  if (!args.payload && !args.payloadId) {
    domainError("INVALID_INPUT", "The ordered chain step names no payload");
  }
}

/** Argument validators of generations.getOrderedPayload. */
export const getOrderedPayloadArgs = {
  generationId: v.id("generations"),
  payloadId: v.id("generationArtifacts"),
};

/** Handler of generations.getOrderedPayload. */
export async function getOrderedPayloadHandler(
  ctx: QueryCtx,
  args: ObjectType<typeof getOrderedPayloadArgs>
) {
  return await loadOrderedPayload(ctx, args.generationId, args.payloadId);
}

/** A drafted Section's result columns: the JSON strings as the action sent
 * them, and their typed copies (dual write, 2026-09-25). Every typed field is
 * reset first so a redraft never keeps an earlier attempt's typed value. */
export function orderedSectionResultFields(args: {
  metrics: string;
  selfCheck: string;
  slotCounts: string;
}) {
  return {
    metrics: args.metrics,
    selfCheck: args.selfCheck,
    slotCounts: args.slotCounts,
    metricsData: undefined,
    selfCheckData: undefined,
    slotCountsData: undefined,
    ...sectionRunTypedFields(args),
  };
}

/** The progress-log label of a drafted Section's Self-check outcome. */
export function sectionCheckNarration(selfCheck: string): string {
  const result = selfCheckResultOf(selfCheck);
  const status = result?.status;
  // The intent's flag wording for a repair that did not clear the check.
  const checkLabel =
    status === "repair_failed"
      ? "Self-check repair failed"
      : `Self-check: ${status?.replace(/_/g, " ") ?? "recorded"}`;
  const coverageLabel = result?.planCoverage
    ? `; plan coverage ${result.planCoverage}`
    : "";
  return `${checkLabel}${coverageLabel}`;
}

/** Argument validators of generations.completeOrderedSectionRun. */
export const completeOrderedSectionRunArgs = {
  generationId: v.id("generations"),
  candidateRunId: v.id("generationCandidateRuns"),
  section: sectionNumberValidator,
  draftText: v.string(),
  metrics: v.string(),
  selfCheck: v.string(),
  slotCounts: v.string(),
  notes: v.array(complianceNoteDraftValidator),
  storylineQuestion: v.optional(storylineQuestionValidator),
  // The chain's payload row (2026-09-25); `payload` for chains scheduled
  // before it was stored. One of the two is required.
  payload: v.optional(orderedPayloadValidator),
  payloadId: v.optional(v.id("generationArtifacts")),
};

/** Handler of generations.completeOrderedSectionRun. */
export async function completeOrderedSectionRunHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof completeOrderedSectionRunArgs>
): Promise<boolean> {
  requireOrderedPayloadRef(args);
  const row = await orderedRunForSection(ctx, args.candidateRunId, args.section);
  if (!row || row.status !== "running" || row.generationId !== args.generationId) {
    return false;
  }
  const fence = await orderedChainFence(ctx, args.generationId, args.candidateRunId);
  if (!fence) return false;
  const now = Date.now();
  await ctx.db.patch(row._id, {
    status: "drafted",
    draftText: args.draftText,
    ...orderedSectionResultFields(args),
    error: undefined,
    completedAt: now,
  });
  await persistSectionNotes(ctx, {
    generation: fence.generation,
    run: fence.run,
    section: args.section,
    notes: args.notes,
    storylineQuestion: args.storylineQuestion,
    now,
  });
  await appendGenerationProgress(ctx, fence.generation, [
    `✓ ${fence.run.label}: ${ORDERED_SECTION_TITLES[args.section]} drafted (${sectionCheckNarration(args.selfCheck)}).`,
  ]);
  await ctx.db.patch(fence.generation._id, {
    // DW-119: a drafted section (and the next one scheduled below) is
    // chain progress; the reaper's window restarts here.
    lastProgressAt: now,
  });
  const next = (await orderedRunsForCandidate(ctx, fence.run._id)).find(
    (candidate) => (candidate.orderIndex ?? 0) === (row.orderIndex ?? 0) + 1
  );
  if (next && next.status === "pending" && fence.generation.stopRequestedAt === undefined) {
    await ctx.db.patch(next._id, { status: "queued", queuedAt: now });
    await ctx.scheduler.runAfter(0, internal.ai.orderedGeneration.generateOrderedSection, {
      generationId: args.generationId,
      candidateRunId: args.candidateRunId,
      section: sectionNumberOfRow(next),
      ...forwardOrderedPayload(args),
    });
  } else {
    await ctx.scheduler.runAfter(0, internal.ai.orderedGeneration.finalizeOrderedCandidate, {
      generationId: args.generationId,
      candidateRunId: args.candidateRunId,
      ...forwardOrderedPayload(args),
    });
  }
  return true;
}

/** Argument validators of generations.failOrderedSectionRun. */
export const failOrderedSectionRunArgs = {
  generationId: v.id("generations"),
  candidateRunId: v.id("generationCandidateRuns"),
  section: sectionNumberValidator,
  error: v.string(),
  // Present when the chain action can finalize: a stopped seed run then
  // keeps its drafted Sections instead of failing (FR-43). `payloadId` is
  // the chain's stored payload (2026-09-25); `payload` the older form.
  payload: v.optional(orderedPayloadValidator),
  payloadId: v.optional(v.id("generationArtifacts")),
};

/** Handler of generations.failOrderedSectionRun. */
export async function failOrderedSectionRunHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof failOrderedSectionRunArgs>
) {
  // Fenced like every other chain write: a stale call (the candidate run,
  // generation or project pointer already moved on) must not overwrite
  // rows a newer owner may be writing; the reaper covers recovery instead.
  const fence = await orderedChainFence(ctx, args.generationId, args.candidateRunId);
  if (!fence) return null;
  const now = Date.now();
  const rows = await orderedRunsForCandidate(ctx, fence.run._id);
  // A Section that fails after the writer stopped a signed-off seed run
  // does not throw away the Sections already drafted: it is marked not
  // drafted and the stopped draft is assembled from what exists.
  if (
    (args.payload || args.payloadId) &&
    fence.generation.stopRequestedAt !== undefined &&
    resolveGatedWorkflow(fence.generation) === "seeds" &&
    fence.generation.summaryVersionId !== undefined &&
    rows.some((row) => row.status === "drafted")
  ) {
    for (const row of rows) {
      if (row.generationId !== args.generationId) continue;
      if (row.section === sectionKeyOf(args.section) && row.status === "running") {
        await ctx.db.patch(row._id, {
          status: "failed",
          error: args.error.slice(0, 500),
          completedAt: now,
        });
      } else if (row.status === "queued") {
        await ctx.db.patch(row._id, { status: "pending" });
      }
    }
    await appendGenerationProgress(ctx, fence.generation, [
      `✗ ${fence.run.label}: ${ORDERED_SECTION_TITLES[args.section]} failed after the stop; the drafted Sections are kept.`,
    ]);
    await ctx.db.patch(fence.generation._id, {
      lastProgressAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.ai.orderedGeneration.finalizeOrderedCandidate, {
      generationId: args.generationId,
      candidateRunId: args.candidateRunId,
      ...forwardOrderedPayload(args),
    });
    return null;
  }
  for (const row of rows) {
    if (row.generationId !== args.generationId) continue;
    if (
      row.section === sectionKeyOf(args.section) &&
      (row.status === "running" || row.status === "queued")
    ) {
      await ctx.db.patch(row._id, {
        status: "failed",
        error: args.error.slice(0, 500),
        completedAt: now,
      });
    } else if (row.status === "pending" || row.status === "queued") {
      await ctx.db.patch(row._id, {
        status: "failed",
        error: "Not drafted: an earlier section failed.",
        completedAt: now,
      });
    }
  }
  await settleCandidateRun(ctx, {
    candidateRunId: args.candidateRunId,
    error: `Line ${args.section} draft failed: ${args.error}`,
  });
  return null;
}

/** Argument validators of generations.insertConsistencyNotes. */
export const insertConsistencyNotesArgs = {
  generationId: v.id("generations"),
  candidateRunId: v.id("generationCandidateRuns"),
  notes: v.array(complianceNoteDraftValidator),
};

/** Handler of generations.insertConsistencyNotes. */
export async function insertConsistencyNotesHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof insertConsistencyNotesArgs>
): Promise<boolean> {
  const fence = await orderedChainFence(ctx, args.generationId, args.candidateRunId);
  if (!fence || fence.run.consistencyCheckedAt !== undefined) return false;
  const owner = {
    projectId: fence.generation.projectId,
    generationId: fence.generation._id,
    candidateRunId: fence.run._id,
  };
  for (const note of args.notes) {
    await ctx.db.insert("complianceNotes", complianceNoteRow(note, owner));
  }
  const now = Date.now();
  await ctx.db.patch(fence.run._id, { consistencyCheckedAt: now });
  const findings = args.notes.filter((note) => note.source === "model").length;
  await appendGenerationProgress(ctx, fence.generation, [
    `✓ ${fence.run.label}: consistency pass over the assembled draft (${findings} finding(s)).`,
  ]);
  return true;
}

/** Argument validators of generations.getOrderedCandidateDrafts. */
export const getOrderedCandidateDraftsArgs = {
  generationId: v.id("generations"),
  candidateRunId: v.id("generationCandidateRuns"),
};

/** Handler of generations.getOrderedCandidateDrafts. */
export async function getOrderedCandidateDraftsHandler(
  ctx: QueryCtx,
  args: ObjectType<typeof getOrderedCandidateDraftsArgs>
) {
  const generation = await ctx.db.get(args.generationId);
  const run = await ctx.db.get(args.candidateRunId);
  if (!generation || !run || run.generationId !== generation._id) return null;
  const rows = await orderedRunsForCandidate(ctx, run._id);
  const { brief } = await loadBriefCheck(ctx, generation);
  return {
    model: run.model,
    label: run.label,
    runStatus: run.status,
    brief,
    stopRequested: generation.stopRequestedAt !== undefined,
    consistencyCheckedAt: run.consistencyCheckedAt ?? null,
    sections: rows.map((row) => ({
      section: sectionNumberOfRow(row),
      orderIndex: row.orderIndex ?? 0,
      status: row.status,
      draftText: row.draftText ?? null,
      // The finalizer still takes JSON strings: the stored string, or the
      // typed value serialized for a row that only has that.
      metrics: sectionRunJson(row, "metrics"),
      selfCheck: sectionRunJson(row, "selfCheck"),
      slotCounts: sectionRunJson(row, "slotCounts"),
    })),
  };
}

/** Argument validators of generations.stopOrderedGeneration. */
export const stopOrderedGenerationArgs = { generationId: v.id("generations") };

/** Handler of generations.stopOrderedGeneration. */
export async function stopOrderedGenerationHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof stopOrderedGenerationArgs>
) {
  const generation = await ctx.db.get(args.generationId);
  if (!generation) domainError("NOT_FOUND", "Generation not found");
  const signedOffSeedDraft =
    resolveGatedWorkflow(generation) === "seeds" &&
    generation.summaryVersionId !== undefined;
  let project: Doc<"projects">;
  let actorUserId: Id<"users"> | undefined;
  if (signedOffSeedDraft) {
    const access = await requireReportEditAccess(ctx, generation.projectId);
    project = access.project;
    actorUserId = access.user._id;
  } else {
    project = (await requireInternalProjectAccess(ctx, generation.projectId)).project;
    if ((generation.candidateMode ?? "compare") === "iterative") {
      domainError(
        "INVALID_STATE",
        "Section-by-section generations are cancelled, not stopped"
      );
    }
  }
  if (project.activeGenerationId !== generation._id) {
    domainError("STALE_REVISION", "This generation is no longer active");
  }
  if (generation.stopRequestedAt !== undefined) return null;
  if (generation.status !== "reserved" && generation.status !== "running") {
    domainError("INVALID_STATE", "This generation is no longer drafting");
  }
  const now = Date.now();
  if (signedOffSeedDraft) {
    const rows = (
      await ctx.db
        .query("generationSectionRuns")
        .withIndex("by_generationId", (q) => q.eq("generationId", generation._id))
        .take(10)
    ).filter((row) => row.candidateRunId !== undefined);
    if (rows.length > 0 && rows.every((row) => row.status === "drafted")) {
      domainError(
        "INVALID_STATE",
        "Every Section is already drafted; the report is being finished",
        { reason: "DRAFT_COMPLETE" }
      );
    }
    if (actorUserId) {
      await ctx.db.insert("seedDecisionEvents", {
        projectId: generation.projectId,
        generationId: generation._id,
        kind: "stop",
        at: now,
        actorUserId,
      });
    }
  }
  await appendGenerationProgress(ctx, generation, [
    "Stop requested: the section in progress finishes, then the draft is assembled.",
  ]);
  await ctx.db.patch(generation._id, {
    stopRequestedAt: now,
  });
  return null;
}

/** Argument validators of generations.getOrderedSectionDrafts. */
export const getOrderedSectionDraftsArgs = {
  generationId: v.id("generations"),
  candidateRunId: v.optional(v.id("generationCandidateRuns")),
};

/** Handler of generations.getOrderedSectionDrafts. */
export async function getOrderedSectionDraftsHandler(
  ctx: QueryCtx,
  args: ObjectType<typeof getOrderedSectionDraftsArgs>
) {
  const generation = await ctx.db.get(args.generationId);
  if (
    !generation ||
    !(await getInternalProjectAccessOrNull(ctx, generation.projectId))
  ) {
    return null;
  }
  if ((generation.candidateMode ?? "compare") === "iterative") return [];
  const candidateRunId = args.candidateRunId;
  let explicitCandidateRun: Doc<"generationCandidateRuns"> | undefined;
  if (candidateRunId !== undefined) {
    const candidateRun = await ctx.db.get(candidateRunId);
    if (!candidateRun || candidateRun.generationId !== generation._id) return [];
    explicitCandidateRun = candidateRun;
  }
  const rows = (
    candidateRunId === undefined
      ? await ctx.db
          .query("generationSectionRuns")
          .withIndex("by_generationId", (q) => q.eq("generationId", generation._id))
          .take(30)
      : await ctx.db
          .query("generationSectionRuns")
          .withIndex("by_candidateRunId_and_section", (q) =>
            q.eq("candidateRunId", candidateRunId)
          )
          .take(30)
  ).filter(
    (row) =>
      row.generationId === generation._id &&
      row.candidateRunId !== undefined &&
      (candidateRunId === undefined || row.candidateRunId === candidateRunId)
  );
  const lastIndex = new Map<string, number>();
  for (const row of rows) {
    const key = row.candidateRunId as string;
    lastIndex.set(key, Math.max(lastIndex.get(key) ?? -1, row.orderIndex ?? 0));
  }
  const checkedAt = new Map<string, number | undefined>();
  const runStatus = new Map<string, string | undefined>();
  for (const key of lastIndex.keys()) {
    const run =
      explicitCandidateRun?._id === key
        ? explicitCandidateRun
        : await ctx.db.get(key as Id<"generationCandidateRuns">);
    checkedAt.set(key, run?.consistencyCheckedAt);
    runStatus.set(key, run?.status);
  }
  return rows
    .filter((row) => row.status === "drafted" && row.draftText !== undefined)
    .filter((row) => {
      const key = row.candidateRunId as string;
      // A failed candidate's earlier drafted sections are not a valid
      // draft to show: the run never reached completion.
      return runStatus.get(key) !== "failed";
    })
    .filter((row) => {
      const key = row.candidateRunId as string;
      return (
        (row.orderIndex ?? 0) !== lastIndex.get(key) ||
        checkedAt.get(key) !== undefined
      );
    })
    .sort((a, b) =>
      a.candidateRunId === b.candidateRunId
        ? (a.orderIndex ?? 0) - (b.orderIndex ?? 0)
        : String(a.candidateRunId) < String(b.candidateRunId)
          ? -1
          : 1
    )
    .map((row) => ({
      candidateRunId: row.candidateRunId as Id<"generationCandidateRuns">,
      section: sectionNumberOfRow(row),
      orderIndex: row.orderIndex ?? 0,
      text: row.draftText ?? "",
      selfCheckStatus: selfCheckResultOf(sectionRunSelfCheck(row))?.status ?? null,
    }));
}
