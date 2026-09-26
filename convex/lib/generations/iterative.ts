/**
 * The section-approval (iterative) flow: one section run per T661 section,
 * drafted, reviewed and approved in order.
 *
 * Split out of convex/generations.ts (2026-09-25, phase 4). The Convex
 * functions stay registered in convex/generations.ts under their old names;
 * this module holds their handlers and helpers.
 */
import { v, type ObjectType } from "convex/values";
import type { QueryCtx, MutationCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { isProjectDeleting } from "../projectDeletion";
import { resolveGatedWorkflow, resolveSeedPhase } from "../gatedWorkflow";
import {
  sectionRunTypedFields,
  sectionRunMetrics,
  sectionRunQa,
} from "../sectionRunData";
import { appendGenerationProgress, readGenerationProgress } from "../generationProgress";
import { transitionGeneration } from "../generationTransitions";
import { refreshProjectGenerationActivity } from "../dashboardProjection";
import {
  getInternalProjectAccessOrNull,
  getCurrentUserOrNull,
  requireCurrentUser,
} from "../auth";
import {
  parseSectionMeter,
  createGeneratedReportArtifacts,
  terminalizeOrphanedCandidateRuns,
  terminalizeSignedOffSeedSections,
} from "./candidates";
import { userSafeStoredError, userSafeNarration } from "./projection";
import { SEED_INITIALIZATION_ERROR } from "./seedStage";
import { domainError, sha256 } from "../contracts";
import { requireReportEditAccess } from "../roleCapabilities";
import { deidentify } from "../deidentify";
import { internal } from "../../_generated/api";
import { buildTiptapDocument } from "../tiptapReport";
import { sectionMetrics } from "../lineLimits";
import { generationTranscriptIds } from "../transcripts";
import { provenanceForWriterApprovedReport } from "../editProvenance";
import { terminateSeedAttempts } from "../../seedRuns";
import { bypassSeedEpisodes } from "../seedDecisionWrites";
import { writeAgentOutputs } from "../generationOutputs";
import { restorableProjectStatus } from "./restoreStatus";

// ─── Iterative (section-by-section) generation lifecycle ─────────────────────
//
// One generationSectionRuns row per T661 section. The writer reviews, edits,
// and approves each drafted section before the next is generated with the
// approved text as canonical context. The generation row oscillates
// running (a section is drafting) ↔ awaiting_input (writer reviewing); a
// background "ghost" one-shot draft runs through the normal candidate
// pipeline for comparison only.

export const SECTION_ORDER = ["s242", "s244", "s246"] as const;

export type IterativeSection = (typeof SECTION_ORDER)[number];

export const sectionValidator = v.union(
  v.literal("s242"),
  v.literal("s244"),
  v.literal("s246")
);

export const SECTION_TITLES: Record<IterativeSection, string> = {
  s242: "Line 242 — Uncertainty",
  s244: "Line 244 — Work performed",
  s246: "Line 246 — Advancement",
};

export async function getSectionRun(
  ctx: { db: QueryCtx["db"] },
  generationId: Id<"generations">,
  section: IterativeSection
) {
  return await ctx.db
    .query("generationSectionRuns")
    .withIndex("by_generationId_and_section", (q) =>
      q.eq("generationId", generationId).eq("section", section)
    )
    .unique();
}

/** Argument validators of generations.saveIterativeArtifacts. */
export const saveIterativeArtifactsArgs = {
  generationId: v.id("generations"),
  analysis: v.string(),
  brainBlocks: v.string(),
};

/** Handler of generations.saveIterativeArtifacts. */
export async function saveIterativeArtifactsHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof saveIterativeArtifactsArgs>
) {
  const generation = await ctx.db.get(args.generationId);
  if (!generation || await isProjectDeleting(ctx, generation.projectId)) return;
  if (resolveGatedWorkflow(generation) === "seeds") {
    const project = await ctx.db.get(generation.projectId);
    if (generation.status !== "running" || project?.activeGenerationId !== generation._id) return;
  }
  for (const [kind, content] of [
    ["analysis", args.analysis],
    ["brain_blocks", args.brainBlocks],
  ] as const) {
    const existing = await ctx.db
      .query("generationArtifacts")
      .withIndex("by_generationId_and_kind", (q) =>
        q.eq("generationId", args.generationId).eq("kind", kind)
      )
      .unique();
    if (existing) {
      if (resolveGatedWorkflow(generation) === "seeds") continue;
      await ctx.db.patch(existing._id, { content });
    } else {
      await ctx.db.insert("generationArtifacts", {
        generationId: args.generationId,
        kind,
        content,
      });
    }
  }
}

/** Argument validators of generations.createSectionRuns. */
export const createSectionRunsArgs = {
  generationId: v.id("generations"),
  model: v.string(),
  label: v.string(),
};

/** Handler of generations.createSectionRuns. */
export async function createSectionRunsHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof createSectionRunsArgs>
) {
  const generation = await ctx.db.get(args.generationId);
  if (!generation || generation.status !== "running") return false;
  if (await isProjectDeleting(ctx, generation.projectId)) return false;
  const now = Date.now();
  for (const section of SECTION_ORDER) {
    const existing = await getSectionRun(ctx, args.generationId, section);
    if (existing) continue;
    await ctx.db.insert("generationSectionRuns", {
      generationId: generation._id,
      projectId: generation.projectId,
      section,
      status: section === "s242" ? "queued" : "pending",
      model: args.model,
      label: args.label,
      attempt: 1,
      queuedAt: now,
    });
  }
  return true;
}

/** Argument validators of generations.claimSectionRun. */
export const claimSectionRunArgs = { generationId: v.id("generations"), section: sectionValidator };

/** Handler of generations.claimSectionRun. */
export async function claimSectionRunHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof claimSectionRunArgs>
) {
  const run = await getSectionRun(ctx, args.generationId, args.section);
  if (!run || run.status !== "queued") return null;
  // Story 0 (AD-19): see claimCandidateRun.
  if (await isProjectDeleting(ctx, run.projectId)) {
    console.log("claimSectionRun: project is being deleted; run left unclaimed", {
      projectId: run.projectId,
      generationId: run.generationId,
      section: run.section,
    });
    return null;
  }
  const generation = await ctx.db.get(run.generationId);
  const project = await ctx.db.get(run.projectId);
  if (
    !generation ||
    generation.status !== "running" ||
    !project ||
    project.deletionStartedAt !== undefined ||
    project.activeGenerationId !== generation._id
  ) {
    return null;
  }
  await ctx.db.patch(run._id, { status: "running", startedAt: Date.now() });
  return {
    generationId: generation._id,
    projectId: run.projectId,
    model: run.model,
    label: run.label,
    attempt: run.attempt,
    guidance: run.guidance ?? null,
  };
}

/** Argument validators of generations.completeSectionRun. */
export const completeSectionRunArgs = {
  generationId: v.id("generations"),
  section: sectionValidator,
  draftText: v.string(),
  metrics: v.string(),
  qa: v.string(),
  // The claimed attempt (audit 2026-09-25 a3 P3). A regenerate reuses the
  // row with the next attempt, so a late result of an older attempt is
  // dropped. Optional only for an action that claimed before this field.
  attempt: v.optional(v.number()),
};

/** Handler of generations.completeSectionRun. */
export async function completeSectionRunHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof completeSectionRunArgs>
) {
  const run = await getSectionRun(ctx, args.generationId, args.section);
  if (!run || run.status !== "running") return;
  if (args.attempt !== undefined && run.attempt !== args.attempt) return;
  const generation = await ctx.db.get(run.generationId);
  const project = await ctx.db.get(run.projectId);
  if (
    !generation ||
    generation.status !== "running" ||
    !project ||
    project.deletionStartedAt !== undefined ||
    project.activeGenerationId !== generation._id
  ) {
    return;
  }
  await ctx.db.patch(run._id, {
    status: "awaiting_review",
    draftText: args.draftText,
    metrics: args.metrics,
    qa: args.qa,
    // Dual write (2026-09-25): typed copies next to the JSON strings. A
    // redraft replaces both, so a stale typed value never outlives them.
    metricsData: undefined,
    qaData: undefined,
    ...sectionRunTypedFields({ metrics: args.metrics, qa: args.qa }),
    error: undefined,
    completedAt: Date.now(),
  });
  await appendGenerationProgress(ctx, generation, [
    `✓ ${SECTION_TITLES[args.section]} draft ready for review.`,
  ]);
  await transitionGeneration(ctx, generation, "awaiting_input", {
    currentStep: `Review the ${SECTION_TITLES[args.section]} draft`,
  });
  await refreshProjectGenerationActivity(ctx, generation.projectId);
}

/** Argument validators of generations.failSectionRun. */
export const failSectionRunArgs = {
  generationId: v.id("generations"),
  section: sectionValidator,
  error: v.string(),
  // The claimed attempt, as for completeSectionRun.
  attempt: v.optional(v.number()),
};

/** Handler of generations.failSectionRun. */
export async function failSectionRunHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof failSectionRunArgs>
) {
  const run = await getSectionRun(ctx, args.generationId, args.section);
  if (!run || (run.status !== "running" && run.status !== "queued")) return;
  if (args.attempt !== undefined && run.attempt !== args.attempt) return;
  const generation = await ctx.db.get(run.generationId);
  if (!generation) return;
  if (await isProjectDeleting(ctx, generation.projectId)) return;
  await ctx.db.patch(run._id, {
    status: "failed",
    error: args.error.slice(0, 500),
    completedAt: Date.now(),
  });
  // The generation stays alive in awaiting_input: the writer regenerates
  // the failed section (or cancels) from the stepper.
  if (generation.status === "running") {
    await appendGenerationProgress(ctx, generation, [
      `✗ ${SECTION_TITLES[args.section]} draft failed: ${args.error.slice(0, 200)}.`,
    ]);
    await transitionGeneration(ctx, generation, "awaiting_input", {
      currentStep: `${SECTION_TITLES[args.section]} draft failed`,
    });
    await refreshProjectGenerationActivity(ctx, generation.projectId);
  }
}

/** Argument validators of generations.getIterativeSectionInput. */
export const getIterativeSectionInputArgs = { generationId: v.id("generations"), section: sectionValidator };

/** Handler of generations.getIterativeSectionInput. */
export async function getIterativeSectionInputHandler(
  ctx: QueryCtx,
  args: ObjectType<typeof getIterativeSectionInputArgs>
) {
  const generation = await ctx.db.get(args.generationId);
  if (!generation) return null;
  const project = await ctx.db.get(generation.projectId);
  if (!project || project.deletionStartedAt !== undefined || project.activeGenerationId !== generation._id) return null;
  const [analysisRow, brainRow] = await Promise.all([
    ctx.db
      .query("generationArtifacts")
      .withIndex("by_generationId_and_kind", (q) =>
        q.eq("generationId", generation._id).eq("kind", "analysis")
      )
      .unique(),
    ctx.db
      .query("generationArtifacts")
      .withIndex("by_generationId_and_kind", (q) =>
        q.eq("generationId", generation._id).eq("kind", "brain_blocks")
      )
      .unique(),
  ]);
  if (!analysisRow) return null;
  let brainBlock = "";
  let styleGuidance = "";
  let draftStyleDigestId: Id<"learningDigests"> | undefined;
  let styleOverrides: Record<string, boolean> | undefined;
  if (brainRow) {
    try {
      const parsed: unknown = JSON.parse(brainRow.content);
      if (parsed && typeof parsed === "object") {
        if (
          "blocks" in parsed &&
          parsed.blocks &&
          typeof parsed.blocks === "object" &&
          args.section in parsed.blocks
        ) {
          const block = (parsed.blocks as Record<string, unknown>)[args.section];
          if (typeof block === "string") brainBlock = block;
        }
        if (
          "styleGuidance" in parsed &&
          typeof parsed.styleGuidance === "string"
        ) {
          styleGuidance = parsed.styleGuidance;
        }
        if (
          "draftStyleDigestId" in parsed &&
          typeof parsed.draftStyleDigestId === "string"
        ) {
          draftStyleDigestId =
            ctx.db.normalizeId("learningDigests", parsed.draftStyleDigestId) ??
            undefined;
        }
        // PSOS-49: house-style waivers frozen at generation start (absent on
        // legacy artifacts → default enforcement).
        if (
          "styleOverrides" in parsed &&
          parsed.styleOverrides &&
          typeof parsed.styleOverrides === "object"
        ) {
          styleOverrides = parsed.styleOverrides as Record<string, boolean>;
        }
      }
    } catch {
      // Malformed artifact: draft without brain/style context.
    }
  }
  const priorSections: Array<{ section: IterativeSection; text: string }> = [];
  for (const section of SECTION_ORDER) {
    if (section === args.section) break;
    const run = await getSectionRun(ctx, generation._id, section);
    if (run?.status !== "approved" || !run.approvedText) return null;
    priorSections.push({ section, text: run.approvedText });
  }
  return {
    analysis: analysisRow.content,
    brainBlock,
    styleGuidance,
    draftStyleDigestId,
    styleOverrides,
    priorSections,
    lengthTarget: generation.lengthTarget ?? "standard",
    projectId: generation.projectId,
    requestedBy: generation.requestedBy,
  };
}

/** Argument validators of generations.getIterativeState. */
export const getIterativeStateArgs = { generationId: v.id("generations") };

/** Handler of generations.getIterativeState. */
export async function getIterativeStateHandler(
  ctx: QueryCtx,
  args: ObjectType<typeof getIterativeStateArgs>
) {
  const generation = await ctx.db.get(args.generationId);
  if (
    !generation ||
    !(await getInternalProjectAccessOrNull(ctx, generation.projectId))
  ) {
    return null;
  }
  if ((generation.candidateMode ?? "compare") !== "iterative") return null;

  const runs = await ctx.db
    .query("generationSectionRuns")
    .withIndex("by_generationId", (q) => q.eq("generationId", generation._id))
    .take(10);
  const sectionRuns = SECTION_ORDER.flatMap((section) => {
    const run = runs.find((row) => row.section === section);
    if (!run) return [];
    // Typed fields first, the JSON strings for rows without them;
    // legacy or malformed values stay null.
    const metrics = parseSectionMeter(sectionRunMetrics(run));
    const qa = sectionRunQa(run);
    return [
      {
        section,
        status: run.status,
        draftText: run.draftText ?? null,
        approvedText: run.approvedText ?? null,
        metrics,
        qa,
        attempt: run.attempt,
        guidance: run.guidance ?? null,
        error: userSafeStoredError(
          run.error,
          "The section draft did not complete. Regenerate to retry."
        ),
      },
    ];
  });

  // Background one-shot comparison draft (peek-only).
  const candidateRuns = await ctx.db
    .query("generationCandidateRuns")
    .withIndex("by_generationId", (q) => q.eq("generationId", generation._id))
    .take(10);
  const ghostRun = candidateRuns.find((run) => run.ghost);
  let ghost: {
    status: "queued" | "running" | "succeeded" | "failed";
    label: string;
    content: string | null;
  } | null = null;
  if (ghostRun) {
    let content: string | null = null;
    if (ghostRun.status === "succeeded" && ghostRun.candidateId) {
      content = (await ctx.db.get(ghostRun.candidateId))?.content ?? null;
    }
    ghost = { status: ghostRun.status, label: ghostRun.label, content };
  }

  const seedRow = resolveGatedWorkflow(generation) === "seeds"
    ? await ctx.db.query("seedSubsections").withIndex("by_generationId", q => q.eq("generationId", generation._id)).first()
    : null;
  const modelLabel = runs[0]?.label ?? null;
  return {
    status: generation.status,
    candidateMode: "iterative" as const,
    gatedWorkflow: resolveGatedWorkflow(generation),
    seedPhase: resolveSeedPhase(generation, seedRow !== null),
    seedStageError: generation.seedStageError ? SEED_INITIALIZATION_ERROR : undefined,
    modelLabel,
    error: userSafeStoredError(
      generation.error,
      "The generation did not complete. Try again."
    ),
    // Narrates the pre-fan-out wait (analyzer + Brain) in the stepper.
    progressLog: (await readGenerationProgress(ctx, generation)).map(userSafeNarration),
    currentStep: generation.currentStep ?? null,
    sectionRuns,
    ghost,
  };
}

/** Shared guards for the writer-facing iterative mutations. */
export async function requireIterativeGeneration(
  ctx: MutationCtx,
  generationId: Id<"generations">
) {
  const generation = await ctx.db.get(generationId);
  if (!generation) domainError("NOT_FOUND", "Generation not found");
  // Approve, redraft and cancel all change the report's draft: report.editProse.
  const { project, user } = await requireReportEditAccess(
    ctx,
    generation.projectId
  );
  if ((generation.candidateMode ?? "compare") !== "iterative") {
    domainError("INVALID_STATE", "This generation is not section-by-section");
  }
  if (project.activeGenerationId !== generation._id) {
    domainError("STALE_REVISION", "This generation is no longer active");
  }
  return { generation, project, user };
}

/** Argument validators of generations.approveSectionDraft. */
export const approveSectionDraftArgs = {
  generationId: v.id("generations"),
  section: sectionValidator,
  text: v.string(),
  // Fences the approval to the draft the writer was actually looking at: a
  // concurrent guided regeneration (other tab/user) bumps `attempt`, and an
  // approve carrying stale attempt-N text must not land on attempt N+1.
  attempt: v.optional(v.number()),
};

/** Handler of generations.approveSectionDraft. */
export async function approveSectionDraftHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof approveSectionDraftArgs>
) {
  const { generation, project } = await requireIterativeGeneration(
    ctx,
    args.generationId
  );

  if (resolveGatedWorkflow(generation) !== "sections") {
    domainError("INVALID_STATE", "Section operations are unavailable during seed preparation");
  }
  // report.editProse: approving a section writes report prose (and the
  // final approval assembles the report).
  await requireReportEditAccess(ctx, generation.projectId);
  if (generation.status !== "awaiting_input") {
    domainError("INVALID_STATE", "No section is awaiting review right now");
  }
  const run = await getSectionRun(ctx, generation._id, args.section);
  if (!run || run.status !== "awaiting_review") {
    domainError("INVALID_STATE", "This section is not awaiting review");
  }
  if (args.attempt !== undefined && run.attempt !== args.attempt) {
    domainError(
      "STALE_REVISION",
      "This section was redrafted since you loaded it — review the new draft"
    );
  }
  for (const section of SECTION_ORDER) {
    if (section === args.section) break;
    const prior = await getSectionRun(ctx, generation._id, section);
    if (prior?.status !== "approved") {
      domainError("INVALID_STATE", "Earlier sections must be approved first");
    }
  }
  const text = args.text.trim();
  if (!text) {
    domainError("INVALID_INPUT", "The approved section text cannot be empty");
  }

  const now = Date.now();
  await ctx.db.patch(run._id, {
    status: "approved",
    approvedText: text,
    completedAt: now,
  });

  // Edit-mining: record draft vs approved (learning loop input). Capped so
  // one section can't bloat the digest prompt; never blocks approval.
  if (run.draftText) {
    const cap = (s: string) => s.slice(0, 6000);
    const draftWords = run.draftText.split(/\s+/).filter(Boolean);
    const approvedWords = new Set(text.split(/\s+/).filter(Boolean));
    const kept = draftWords.filter((w) => approvedWords.has(w)).length;
    const editRatio =
      draftWords.length === 0
        ? 0
        : Math.min(1, Math.max(0, 1 - kept / draftWords.length));
    const caller = await getCurrentUserOrNull(ctx);
    // CAP-1: these rows feed the firm-wide draft-style distiller, so the
    // stored prose is de-identified. editRatio above is deliberately
    // computed on the raw text — scrubbing must not move the number.
    await ctx.db.insert("sectionEditEvents", {
      projectId: generation.projectId,
      generationId: generation._id,
      section: args.section,
      draftText: cap(deidentify(run.draftText, project)),
      approvedText: cap(deidentify(text, project)),
      editRatio,
      ...(caller ? { userId: caller._id } : {}),
      createdAt: now,
    });
  }

  const nextSection =
    SECTION_ORDER[SECTION_ORDER.indexOf(args.section) + 1] ?? null;
  if (nextSection) {
    const next = await getSectionRun(ctx, generation._id, nextSection);
    if (!next || next.status !== "pending") {
      domainError("INVALID_STATE", "The next section is not ready to draft");
    }
    await ctx.db.patch(next._id, { status: "queued", queuedAt: now });
    await appendGenerationProgress(ctx, generation, [
      `✓ ${SECTION_TITLES[args.section]} approved by the writer.`,
      `Drafting ${SECTION_TITLES[nextSection]}…`,
    ]);
    await transitionGeneration(ctx, generation, "running", {
      // startedAt marks the start of THIS drafting phase so the stale-run
      // reaper measures drafting time, not total writer review time.
      startedAt: now,
      currentStep: `Drafting ${SECTION_TITLES[nextSection]}…`,
    });
    await refreshProjectGenerationActivity(ctx, generation.projectId);
    await ctx.scheduler.runAfter(0, internal.ai.iterative.generateSection, {
      generationId: generation._id,
      section: nextSection,
    });
    return null;
  }

  // Final section approved → assemble the report from the approved texts.
  const approved: Record<IterativeSection, string> = {
    s242: "",
    s244: "",
    s246: text,
  };
  for (const section of ["s242", "s244"] as const) {
    const priorRun = await getSectionRun(ctx, generation._id, section);
    approved[section] = priorRun?.approvedText ?? "";
  }
  const content = JSON.stringify(
    buildTiptapDocument(
      project.title || "Untitled Report",
      approved.s242,
      approved.s244,
      approved.s246
    )
  );
  const agentOutputs = JSON.stringify({
    section242: approved.s242,
    section244: approved.s244,
    section246: approved.s246,
    metrics: {
      s242: sectionMetrics(approved.s242, "s242"),
      s244: sectionMetrics(approved.s244, "s244"),
      s246: sectionMetrics(approved.s246, "s246"),
      lengthTarget: generation.lengthTarget ?? "standard",
    },
    iterative: true,
  });
  const reportId = await createGeneratedReportArtifacts(ctx, generation, {
    projectId: generation.projectId,
    content,
    agentOutputs,
    // Writer-approved Sections carry no quotes: every paragraph is a claim
    // for a manager to review (amendment 2026-09-25, fifth).
    provenanceId: await provenanceForWriterApprovedReport(ctx, {
      projectId: generation.projectId,
      generation,
      content,
      now,
    }),
    label: `Iterative — ${run.label}`,
  });

  // The finished ghost draft is preserved as a version-history snapshot for
  // comparison (never the report). Inserted AFTER the report's own
  // "generated" baseline above so postEditDistance's `.first()` still finds
  // the real baseline.
  const candidateRuns = await ctx.db
    .query("generationCandidateRuns")
    .withIndex("by_generationId", (q) => q.eq("generationId", generation._id))
    .take(10);
  const ghostRun = candidateRuns.find((row) => row.ghost);
  if (ghostRun?.status === "succeeded" && ghostRun.candidateId) {
    const ghostCandidate = await ctx.db.get(ghostRun.candidateId);
    if (ghostCandidate) {
      await ctx.db.insert("reportSnapshots", {
        projectId: generation.projectId,
        reportId,
        generationId: generation._id,
        sourceTranscriptId: generation.transcriptId,
        sourceTranscriptIds: generationTranscriptIds(generation),
        provenanceId: ghostCandidate.provenanceId,
        sourceRevisionNumber: 0,
        contentHash: await sha256(ghostCandidate.content),
        content: ghostCandidate.content,
        reason: "generated",
        label: `One-shot ghost draft (comparison — ${ghostRun.label})`,
        createdByRole: "system",
        createdAt: Date.now(),
      });
    }
    // The run row stays for stats; drop the dangling candidate pointer.
    await ctx.db.patch(ghostRun._id, { candidateId: undefined });
    // Edit-mining: attach the ghost's take on each section to the edit
    // events, so the digest can contrast writer-approved vs one-shot text.
    if (ghostCandidate) {
      try {
        const outputs: unknown = JSON.parse(ghostCandidate.agentOutputs);
        if (outputs && typeof outputs === "object") {
          const ghostSections: Record<IterativeSection, string | undefined> = {
            s242: (outputs as Record<string, unknown>).section242 as string | undefined,
            s244: (outputs as Record<string, unknown>).section244 as string | undefined,
            s246: (outputs as Record<string, unknown>).section246 as string | undefined,
          };
          const events = await ctx.db
            .query("sectionEditEvents")
            .withIndex("by_generationId", (q) =>
              q.eq("generationId", generation._id)
            )
            .collect();
          for (const event of events) {
            const ghostText = ghostSections[event.section];
            if (typeof ghostText === "string" && ghostText.trim()) {
              // CAP-1: same firm-wide digest input as draftText/approvedText.
              await ctx.db.patch(event._id, {
                ghostText: deidentify(ghostText, project).slice(0, 6000),
              });
            }
          }
        }
      } catch {
        // Ghost outputs unparseable — events simply stay ghost-less.
      }
    }
  }
  // Candidate rows (the ghost's included) never outlive the generation.
  const candidates = await ctx.db
    .query("reportCandidates")
    .withIndex("by_generationId", (q) => q.eq("generationId", generation._id))
    .take(10);
  for (const row of candidates) await ctx.db.delete(row._id);

  // Mirror completeCandidateRun's single-mode bookkeeping exactly.
  const doneAt = Date.now();
  await ctx.db.patch(project._id, {
    activeGenerationId: undefined,
    status: "review",
    updatedAt: doneAt,
  });
  // Every mode ends with a scorecard: run QA + chronology over the
  // assembled sections in the background (feeds the learning loops). The
  // pass starts in the same write that completes the generation.
  await appendGenerationProgress(ctx, generation, [
    `✓ ${SECTION_TITLES.s246} approved by the writer.`,
    "✓ Report assembled from the approved sections.",
    "Running the QA scorecard and chronology in the background…",
  ]);
  await writeAgentOutputs(ctx, generation, agentOutputs);
  await transitionGeneration(ctx, generation, "completed", {
    currentStep: "Complete",
    completedAt: doneAt,
    postQaStatus: "running",
    postQaStartedAt: doneAt,
  });
  await refreshProjectGenerationActivity(ctx, generation.projectId);
  await ctx.scheduler.runAfter(0, internal.ai.postQa.runReportQa, {
    generationId: generation._id,
    attemptStartedAt: doneAt,
  });
  return reportId;
}

/** Argument validators of generations.regenerateSectionDraft. */
export const regenerateSectionDraftArgs = {
  generationId: v.id("generations"),
  section: sectionValidator,
  guidance: v.optional(v.string()),
};

/** Handler of generations.regenerateSectionDraft. */
export async function regenerateSectionDraftHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof regenerateSectionDraftArgs>
) {
  const { generation } = await requireIterativeGeneration(
    ctx,
    args.generationId
  );

  if (resolveGatedWorkflow(generation) !== "sections") {
    domainError("INVALID_STATE", "Section operations are unavailable during seed preparation");
  }
  if (generation.status !== "awaiting_input") {
    domainError("INVALID_STATE", "No section is awaiting review right now");
  }
  const run = await getSectionRun(ctx, generation._id, args.section);
  if (!run || (run.status !== "awaiting_review" && run.status !== "failed")) {
    domainError("INVALID_STATE", "This section cannot be regenerated right now");
  }
  const guidance = args.guidance?.trim();
  const now = Date.now();
  await ctx.db.patch(run._id, {
    status: "queued",
    attempt: run.attempt + 1,
    guidance: guidance || undefined,
    error: undefined,
    queuedAt: now,
    startedAt: undefined,
    completedAt: undefined,
  });
  await appendGenerationProgress(ctx, generation, [
    `Redrafting ${SECTION_TITLES[args.section]}${guidance ? " with writer guidance" : ""}…`,
  ]);
  await transitionGeneration(ctx, generation, "running", {
    startedAt: now,
    currentStep: `Redrafting ${SECTION_TITLES[args.section]}…`,
  });
  await refreshProjectGenerationActivity(ctx, generation.projectId);
  await ctx.scheduler.runAfter(0, internal.ai.iterative.generateSection, {
    generationId: generation._id,
    section: args.section,
  });
  return null;
}

/** Argument validators of generations.cancelIterativeGeneration. */
export const cancelIterativeGenerationArgs = { generationId: v.id("generations") };

/** Handler of generations.cancelIterativeGeneration. */
export async function cancelIterativeGenerationHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof cancelIterativeGenerationArgs>
) {
  const { generation, project } = await requireIterativeGeneration(
    ctx,
    args.generationId
  );
  if (
    generation.status !== "reserved" &&
    generation.status !== "running" &&
    generation.status !== "awaiting_input"
  ) {
    domainError("INVALID_STATE", "This generation is no longer active");
  }
  if (resolveGatedWorkflow(generation) === "seeds") {
    await requireReportEditAccess(ctx, generation.projectId);
    await terminateSeedAttempts(ctx, generation._id);
    await bypassSeedEpisodes(ctx, generation._id);
    await ctx.db.insert("seedDecisionEvents", {
      projectId: generation.projectId, generationId: generation._id,
      kind: "cancel", at: Date.now(), actorUserId: (await requireCurrentUser(ctx))._id,
    });
  }
  const now = Date.now();
  await transitionGeneration(ctx, generation, "failed", {
    currentStep: "Cancelled",
    error: "Cancelled by writer",
    completedAt: now,
  });
  const signedOffSeedDraft =
    resolveGatedWorkflow(generation) === "seeds" &&
    generation.summaryVersionId !== undefined;
  if (signedOffSeedDraft) {
    await terminalizeOrphanedCandidateRuns(
      ctx,
      generation._id,
      "The generation was cancelled before this draft completed."
    );
    await terminalizeSignedOffSeedSections(
      ctx,
      generation._id,
      "The generation was cancelled before this section draft completed."
    );
  }
  // Ghost/section jobs still scheduled become no-ops: their claim fences
  // require an active generation + project pointer. Candidate artifacts are
  // still removed by the existing cancellation contract.
  const candidates = await ctx.db
    .query("reportCandidates")
    .withIndex("by_generationId", (q) => q.eq("generationId", generation._id))
    .take(10);
  for (const row of candidates) await ctx.db.delete(row._id);
  await ctx.db.patch(project._id, {
    activeGenerationId: undefined,
    status: restorableProjectStatus(generation.previousProjectStatus),
    updatedAt: now,
  });
  await refreshProjectGenerationActivity(ctx, generation.projectId);
  return null;
}
