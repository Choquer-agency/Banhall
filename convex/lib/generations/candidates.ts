/**
 * Candidate drafts: candidate runs, their fan-in into the generation
 * (settleCandidateRun), report creation from a candidate, and selection.
 *
 * Split out of convex/generations.ts (2026-09-25, phase 4). The Convex
 * functions stay registered in convex/generations.ts under their old names;
 * this module holds their handlers and helpers.
 */
import { v, type Infer, type ObjectType } from "convex/values";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { isProjectDeleting } from "../projectDeletion";
import type { Doc, Id } from "../../_generated/dataModel";
import { sha256, domainError } from "../contracts";
import { generationTranscriptIds } from "../transcripts";
import { persistDeterministicFindings, persistMethodologyFindings } from "../qaFindings";
import { recordReportEditDistance } from "../editDistance";
import {
  sectionNumberValidator,
  type SectionNumber,
  isSectionNumber,
} from "../orderedChain";
import { isTerminalGenerationStatus } from "../../../shared/generationTransitions";
import { appendGenerationProgress } from "../generationProgress";
import { resolveGatedWorkflow } from "../gatedWorkflow";
import { transitionGeneration } from "../generationTransitions";
import { refreshProjectGenerationActivity } from "../dashboardProjection";
import { internal } from "../../_generated/api";
import { getInternalProjectAccessOrNull, requireCurrentUser } from "../auth";
import { requireReportEditAccess } from "../roleCapabilities";
import { writeAgentOutputs } from "../generationOutputs";
import { restorableProjectStatus } from "./restoreStatus";

/** Argument validators of generations.createCandidateRun. */
export const createCandidateRunArgs = {
  generationId: v.id("generations"),
  model: v.string(),
  label: v.string(),
  // Iterative mode's background one-shot comparison draft (peek-only).
  ghost: v.optional(v.boolean()),
};

/** Handler of generations.createCandidateRun. */
export async function createCandidateRunHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof createCandidateRunArgs>
) {
  const generation = await ctx.db.get(args.generationId);
  if (!generation || generation.status !== "running") return null;
  if (await isProjectDeleting(ctx, generation.projectId)) return null;
  const existing = await ctx.db
    .query("generationCandidateRuns")
    .withIndex("by_generationId_and_model", (q) =>
      q.eq("generationId", args.generationId).eq("model", args.model)
    )
    .unique();
  if (existing) return existing._id;
  return await ctx.db.insert("generationCandidateRuns", {
    generationId: generation._id,
    projectId: generation.projectId,
    model: args.model,
    label: args.label,
    status: "queued",
    ...(args.ghost ? { ghost: true } : {}),
    queuedAt: Date.now(),
  });
}

/** Argument validators of generations.setCandidateRunJob. */
export const setCandidateRunJobArgs = {
  candidateRunId: v.id("generationCandidateRuns"),
  scheduledJobId: v.id("_scheduled_functions"),
};

/** Handler of generations.setCandidateRunJob. */
export async function setCandidateRunJobHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof setCandidateRunJobArgs>
) {
  const run = await ctx.db.get(args.candidateRunId);
  if (run?.status === "queued") {
    await ctx.db.patch(run._id, { scheduledJobId: args.scheduledJobId });
  }
}

/** Argument validators of generations.claimCandidateRun. */
export const claimCandidateRunArgs = { candidateRunId: v.id("generationCandidateRuns") };

/** Handler of generations.claimCandidateRun. */
export async function claimCandidateRunHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof claimCandidateRunArgs>
) {
  const run = await ctx.db.get(args.candidateRunId);
  if (!run || run.status !== "queued") return null;
  // Story 0 (AD-19): a claim scheduled before the project entered deletion
  // must not repopulate it. Narrate and return without writing.
  if (await isProjectDeleting(ctx, run.projectId)) {
    console.log("claimCandidateRun: project is being deleted; run left unclaimed", {
      projectId: run.projectId,
      candidateRunId: run._id,
    });
    return null;
  }
  const generation = await ctx.db.get(run.generationId);
  const project = await ctx.db.get(run.projectId);
  // Ghost runs draft in parallel with the iterative section flow, whose
  // generation oscillates running ↔ awaiting_input while the writer reviews.
  const activeStatuses: string[] = run.ghost
    ? ["running", "awaiting_input"]
    : ["running"];
  if (
    !generation ||
    !activeStatuses.includes(generation.status) ||
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
    // Story 2: non-ghost runs start the ordered chain; ghosts stay one-shot.
    ghost: run.ghost ?? false,
  };
}

export async function createGeneratedReportArtifacts(
  ctx: MutationCtx,
  generation: Doc<"generations">,
  candidate: Pick<
    Doc<"reportCandidates">,
    "projectId" | "content" | "agentOutputs" | "provenanceId" | "label"
  >
) {
  const existingReport = await ctx.db
    .query("reports")
    .withIndex("by_generationId", (q) =>
      q.eq("generationId", generation._id)
    )
    .unique();
  if (existingReport) return existingReport._id;

  const now = Date.now();
  const latest = await ctx.db
    .query("reports")
    .withIndex("by_projectId", (q) => q.eq("projectId", candidate.projectId))
    .order("desc")
    .first();
  const contentHash = await sha256(candidate.content);
  const reportId = await ctx.db.insert("reports", {
    projectId: candidate.projectId,
    generationId: generation._id,
    sourceTranscriptId: generation.transcriptId,
    sourceTranscriptIds: generationTranscriptIds(generation),
    provenanceId: candidate.provenanceId,
    content: candidate.content,
    contentHash,
    revisionNumber: 0,
    version: (latest?.version ?? 0) + 1,
    generatedAt: now,
    updatedAt: now,
  });
  await persistDeterministicFindings(ctx, reportId, candidate.agentOutputs);
  const createdReport = await ctx.db.get(reportId);
  if (createdReport) {
    let outputs: unknown;
    try { outputs = JSON.parse(candidate.agentOutputs ?? "{}"); }
    catch { /* Malformed initial QA is not compliance evidence. */ }
    if (outputs && typeof outputs === "object" && "qa" in outputs) {
      await persistMethodologyFindings(ctx, createdReport, outputs.qa);
    }
  }
  await ctx.db.insert("reportSnapshots", {
    projectId: candidate.projectId,
    reportId,
    generationId: generation._id,
    sourceTranscriptId: generation.transcriptId,
    sourceTranscriptIds: generationTranscriptIds(generation),
    provenanceId: candidate.provenanceId,
    sourceRevisionNumber: 0,
    contentHash,
    content: candidate.content,
    reason: "generated",
    label: `AI draft (${candidate.label})`,
    createdByRole: "system",
    createdAt: now,
  });
  // BNH-10 / CAP-2: freeze the (zero) post-edit distance at candidate
  // selection. This is the single choke point for every "generated" baseline
  // that belongs to a report, so all three candidate paths are covered here.
  const report = await ctx.db.get(reportId);
  if (report) await recordReportEditDistance(ctx, report, "candidate_selection");
  return reportId;
}

export const completeCandidateRunArgs = v.object({
  candidateRunId: v.id("generationCandidateRuns"),
  content: v.optional(v.string()),
  agentOutputs: v.optional(v.string()),
  qaScore: v.optional(v.number()),
  provenanceId: v.optional(v.id("reportProvenance")),
  error: v.optional(v.string()),
  // Story 2 (AD-24): the Build Order the ordered chain ran, and the section
  // it stopped after when the writer stopped before the last section.
  productionOrder: v.optional(v.array(sectionNumberValidator)),
  stoppedAfterSection: v.optional(sectionNumberValidator),
});

/** Handler of generations.completeCandidateRun. */
export async function completeCandidateRunHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof completeCandidateRunArgs.fields>
) {
  await settleCandidateRun(ctx, args);
}

/** completeCandidateRun's body, shared with the ordered chain's failure path
 * (failOrderedSectionRun) so a failed section fails its candidate the same
 * way a failed one-shot run does. */
export async function settleCandidateRun(
  ctx: MutationCtx,
  args: Infer<typeof completeCandidateRunArgs>
) {
    const run = await ctx.db.get(args.candidateRunId);
    if (!run || run.status !== "running") return;
    if (await isProjectDeleting(ctx, run.projectId)) return;
    const generation = await ctx.db.get(run.generationId);
    const project = await ctx.db.get(run.projectId);
    const succeeded = Boolean(args.content && args.agentOutputs && !args.error);

    // A ghost finishing AFTER its iterative generation went terminal (writer
    // approved the last section, or cancelled) must still terminalize its own
    // run row — otherwise it reads "running" forever and skews run stats. If
    // the generation completed, the comparison draft still becomes the
    // promised version-history snapshot; on cancel/failure it is discarded.
    if (run.ghost && generation && isTerminalGenerationStatus(generation.status)) {
      await ctx.db.patch(run._id, {
        status: succeeded ? "succeeded" : "failed",
        qaScore: args.qaScore,
        error: args.error?.slice(0, 500),
        completedAt: Date.now(),
      });
      if (succeeded && args.content && generation.status === "completed") {
        const report = await ctx.db
          .query("reports")
          .withIndex("by_generationId", (q) =>
            q.eq("generationId", generation._id)
          )
          .first();
        if (report) {
          await ctx.db.insert("reportSnapshots", {
            projectId: generation.projectId,
            reportId: report._id,
            generationId: generation._id,
            sourceTranscriptId: generation.transcriptId,
            sourceTranscriptIds: generationTranscriptIds(generation),
            provenanceId: args.provenanceId,
            sourceRevisionNumber: 0,
            contentHash: await sha256(args.content),
            content: args.content,
            reason: "generated",
            label: `One-shot ghost draft (comparison — ${run.label})`,
            createdByRole: "system",
            createdAt: Date.now(),
          });
        }
      }
      return;
    }

    const activeStatuses: string[] = run.ghost
      ? ["running", "awaiting_input"]
      : ["running"];
    if (
      !generation ||
      !activeStatuses.includes(generation.status) ||
      !project ||
      project._id !== generation.projectId ||
      project.activeGenerationId !== generation._id
    ) {
      return;
    }
    let candidateId: Id<"reportCandidates"> | undefined;
    if (succeeded && args.content && args.agentOutputs) {
      candidateId = await ctx.db.insert("reportCandidates", {
        generationId: run.generationId,
        projectId: run.projectId,
        model: run.model,
        label: run.label,
        content: args.content,
        agentOutputs: args.agentOutputs,
        provenanceId: args.provenanceId,
        createdAt: Date.now(),
      });
    }
    await ctx.db.patch(run._id, {
      status: succeeded ? "succeeded" : "failed",
      candidateId,
      qaScore: args.qaScore,
      error: args.error?.slice(0, 500),
      completedAt: Date.now(),
    });

    // Ghost run (iterative mode): the candidate row is a peek-only comparison
    // draft. It never advances the generation lifecycle — section approvals
    // drive that — so log and stop here.
    if (run.ghost) {
      await appendGenerationProgress(ctx, generation, [
        succeeded
          ? `✓ One-shot comparison draft ready (${run.label}).`
          : `✗ One-shot comparison draft failed: ${args.error ?? "provider error"}.`,
      ]);
      return;
    }

    // Story 2 (AD-24): stamp the production order (shared by every compare
    // candidate, one Build Order per generation) and, for a stopped single
    // chain, the section it stopped after. Compare candidates stop
    // independently, so there the selected candidate's value is copied on
    // selectReportCandidate instead.
    // A signed-off seed run is one chain too (FR-43): its stop is stamped here.
    const isSeedOrdered =
      generation.candidateMode === "iterative" &&
      resolveGatedWorkflow(generation) === "seeds" &&
      generation.summaryVersionId !== undefined;
    const stampStop =
      args.stoppedAfterSection !== undefined &&
      (generation.candidateMode === "single" || isSeedOrdered);
    if (args.productionOrder || stampStop) {
      await ctx.db.patch(generation._id, {
        ...(args.productionOrder ? { productionOrder: args.productionOrder } : {}),
        ...(stampStop ? { stoppedAfterSection: args.stoppedAfterSection } : {}),
      });
    }

    const runs = await ctx.db
      .query("generationCandidateRuns")
      .withIndex("by_generationId", (q) => q.eq("generationId", run.generationId))
      .take(10);
    const terminal = runs.filter(
      (candidateRun) =>
        candidateRun._id === run._id ||
        candidateRun.status === "succeeded" ||
        candidateRun.status === "failed"
    );
    const done = terminal.filter(
      (candidateRun) =>
        candidateRun._id === run._id ? succeeded : candidateRun.status === "succeeded"
    ).length;
    const failed = terminal.length - done;
    const runLine = succeeded
      ? `✓ ${run.label} draft ready (QA ${args.qaScore ?? "—"}/100).`
      : `✗ ${run.label} failed: ${args.error ?? "provider error"}.`;
    if (terminal.length < (generation.totalCandidates ?? runs.length)) {
      await appendGenerationProgress(ctx, generation, [runLine]);
      await ctx.db.patch(generation._id, {
        candidatesDone: done,
        candidatesFailed: failed,
      });
      return;
    }
    if (done > 0) {
      // CAP-18: the seed report exists before QA, which then runs in the
      // background. A stopped seed draft runs no QA (FR-43).
      const seedStopped = isSeedOrdered && args.stoppedAfterSection !== undefined;
      const scheduleSeedQa = isSeedOrdered && !seedStopped;
      if (generation.candidateMode !== "single" && !isSeedOrdered) {
        await appendGenerationProgress(ctx, generation, [runLine]);
        await transitionGeneration(ctx, generation, "awaiting_selection", {
          candidatesDone: done,
          candidatesFailed: failed,
          currentStep: "Choose your preferred draft",
        });
        await refreshProjectGenerationActivity(ctx, generation.projectId);
        return;
      }

      const candidate = candidateId ? await ctx.db.get(candidateId) : null;
      if (!candidate) return;
      await createGeneratedReportArtifacts(ctx, generation, candidate);
      if (seedStopped) {
        // FR-43: the Sections the stop left undrafted are explicitly "Not
        // drafted" rather than pending forever; redraftMissingSections
        // re-queues exactly these rows.
        await terminalizeSignedOffSeedSections(
          ctx,
          generation._id,
          NOT_DRAFTED_AFTER_STOP
        );
      }
      const now = Date.now();
      await ctx.db.patch(project._id, {
        activeGenerationId: undefined,
        status: "review",
        updatedAt: now,
      });
      await appendGenerationProgress(ctx, generation, [
        runLine,
        ...(scheduleSeedQa
          ? ["Running the QA scorecard and chronology in the background…"]
          : seedStopped
            ? [
                `Stopped after Line ${args.stoppedAfterSection}: the drafted Sections are in the report, the rest are marked Not drafted, and QA does not run on a stopped draft.`,
              ]
            : []),
      ]);
      await writeAgentOutputs(ctx, generation, candidate.agentOutputs);
      await transitionGeneration(ctx, generation, "completed", {
        candidatesDone: done,
        candidatesFailed: failed,
        currentStep: "Complete",
        completedAt: now,
        ...(scheduleSeedQa
          ? { postQaStatus: "running" as const, postQaStartedAt: now }
          : {}),
      });
      await refreshProjectGenerationActivity(ctx, generation.projectId);
      const candidates = await ctx.db
        .query("reportCandidates")
        .withIndex("by_generationId", (q) =>
          q.eq("generationId", generation._id)
        )
        .take(10);
      for (const row of candidates) await ctx.db.delete(row._id);
      if (scheduleSeedQa) {
        await ctx.scheduler.runAfter(0, internal.ai.postQa.runReportQa, {
          generationId: generation._id,
          attemptStartedAt: now,
        });
      }
      return;
    }

    await appendGenerationProgress(ctx, generation, [runLine]);
    await transitionGeneration(ctx, generation, "failed", {
      candidatesDone: 0,
      candidatesFailed: failed,
      currentStep: "Failed",
      error: "All candidate models failed to generate.",
      completedAt: Date.now(),
    });
    await ctx.db.patch(project._id, {
      activeGenerationId: undefined,
      status: restorableProjectStatus(generation.previousProjectStatus),
      updatedAt: Date.now(),
    });
    await refreshProjectGenerationActivity(ctx, generation.projectId);
}

/**
 * A generation going terminal must settle its in-flight candidate runs too:
 * a run left "running" after a whole-generation failure never gets another
 * completeCandidateRun (the action is dead or its CAS fence refuses), so it
 * skews run stats forever and hides from retryFailedCandidates, which only
 * counts status "failed". Mirrors the ghost-run treatment in
 * completeCandidateRun. Status-CAS: only queued/running rows are touched.
 */
export async function terminalizeOrphanedCandidateRuns(
  ctx: MutationCtx,
  generationId: Id<"generations">,
  error: string
) {
  const runs = await ctx.db
    .query("generationCandidateRuns")
    .withIndex("by_generationId", (q) => q.eq("generationId", generationId))
    .take(10);
  for (const run of runs) {
    if (run.status !== "queued" && run.status !== "running") continue;
    await ctx.db.patch(run._id, {
      status: "failed",
      error,
      completedAt: Date.now(),
    });
  }
}

/** Row error for a Section a writer's stop left undrafted (FR-43). */
export const NOT_DRAFTED_AFTER_STOP = "Not drafted: the writer stopped before this Section.";

/** Terminalize only the ordered section rows owned by a signed-off seed
 * chain. Legacy iterative rows keep their existing per-section recovery
 * behavior and never call this helper. */
export async function terminalizeSignedOffSeedSections(
  ctx: MutationCtx,
  generationId: Id<"generations">,
  error: string
) {
  const rows = await ctx.db
    .query("generationSectionRuns")
    .withIndex("by_generationId", (q) => q.eq("generationId", generationId))
    .take(10);
  const now = Date.now();
  for (const row of rows) {
    if (
      row.status !== "pending" &&
      row.status !== "queued" &&
      row.status !== "running"
    ) {
      continue;
    }
    await ctx.db.patch(row._id, {
      status: "failed",
      error,
      completedAt: now,
    });
  }
}

export type CandidateSectionMeter = {
  lines: number;
  words: number;
  limit: number;
  wordCap: number;
  overLimit: boolean;
  // Gap-aware fields (convex/lib/lineLimits.ts). Optional: legacy persisted
  // candidate metrics predate them and must still parse.
  rawLines?: number;
  rawWords?: number;
  overLimitWithGaps?: boolean;
};

export function parseSectionMeter(value: unknown): CandidateSectionMeter | null {
  if (typeof value !== "object" || value === null) return null;
  if (
    !("lines" in value) || typeof value.lines !== "number" ||
    !("words" in value) || typeof value.words !== "number" ||
    !("limit" in value) || typeof value.limit !== "number" ||
    !("wordCap" in value) || typeof value.wordCap !== "number" ||
    !("overLimit" in value) || typeof value.overLimit !== "boolean"
  ) return null;
  return {
    lines: value.lines,
    words: value.words,
    limit: value.limit,
    wordCap: value.wordCap,
    overLimit: value.overLimit,
    ...("rawLines" in value && typeof value.rawLines === "number"
      ? { rawLines: value.rawLines }
      : {}),
    ...("rawWords" in value && typeof value.rawWords === "number"
      ? { rawWords: value.rawWords }
      : {}),
    ...("overLimitWithGaps" in value && typeof value.overLimitWithGaps === "boolean"
      ? { overLimitWithGaps: value.overLimitWithGaps }
      : {}),
  };
}

export function parseCandidateMetrics(value: unknown) {
  if (typeof value !== "object" || value === null) return null;
  const s242 = "s242" in value ? parseSectionMeter(value.s242) : null;
  const s244 = "s244" in value ? parseSectionMeter(value.s244) : null;
  const s246 = "s246" in value ? parseSectionMeter(value.s246) : null;
  if (!s242 || !s244 || !s246) return null;
  return {
    s242,
    s244,
    s246,
    ...("lengthTarget" in value && typeof value.lengthTarget === "string"
      ? { lengthTarget: value.lengthTarget }
      : {}),
  };
}

/** Argument validators of generations.getCandidates. */
export const getCandidatesArgs = { generationId: v.id("generations") };

/** Handler of generations.getCandidates. */
export async function getCandidatesHandler(
  ctx: QueryCtx,
  args: ObjectType<typeof getCandidatesArgs>
) {
  const generation = await ctx.db.get(args.generationId);
  if (!generation) return [];
  const access = await getInternalProjectAccessOrNull(ctx, generation.projectId);
  if (!access) return [];
  // Ghost candidates (iterative mode's background comparison draft) are
  // peek-only — never listed for selection.
  const runs = await ctx.db
    .query("generationCandidateRuns")
    .withIndex("by_generationId", (q) => q.eq("generationId", generation._id))
    .take(10);
  const ghostCandidateIds = new Set(
    runs
      .filter((run) => run.ghost && run.candidateId)
      .map((run) => run.candidateId)
  );
  const candidates = (
    await ctx.db
      .query("reportCandidates")
      .withIndex("by_generationId", (q) => q.eq("generationId", generation._id))
      .take(10)
  ).filter((candidate) => !ghostCandidateIds.has(candidate._id));
  return candidates.map((candidate) => {
    let qaScore: number | null = null;
    let metrics: ReturnType<typeof parseCandidateMetrics> = null;
    let qa: unknown = null;
    try {
      const parsed: unknown = JSON.parse(candidate.agentOutputs);
      if (parsed && typeof parsed === "object") {
        if ("metrics" in parsed) metrics = parseCandidateMetrics(parsed.metrics);
        if ("qa" in parsed) {
          qa = parsed.qa;
          if (
            parsed.qa &&
            typeof parsed.qa === "object" &&
            "overall_score" in parsed.qa &&
            typeof parsed.qa.overall_score === "number"
          ) {
            qaScore = parsed.qa.overall_score;
          }
        }
      }
    } catch {
      // A legacy candidate may not have structured agent outputs.
    }
    return {
      _id: candidate._id,
      content: candidate.content,
      qaScore,
      metrics,
      qa,
      model: candidate.model,
      label: candidate.label,
    };
  });
}

/** The section an ordered candidate stopped after, from its agentOutputs. */
export function stoppedAfterSectionOf(agentOutputs: string): SectionNumber | undefined {
  try {
    const value = (JSON.parse(agentOutputs) as { stoppedAfterSection?: unknown })
      ?.stoppedAfterSection;
    return typeof value === "string" && isSectionNumber(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Argument validators of generations.selectReportCandidate. */
export const selectReportCandidateArgs = {
  generationId: v.id("generations"),
  candidateId: v.id("reportCandidates"),
};

/** Handler of generations.selectReportCandidate. */
export async function selectReportCandidateHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof selectReportCandidateArgs>
) {
  await requireCurrentUser(ctx);
  const candidate = await ctx.db.get(args.candidateId);
  const generation = await ctx.db.get(args.generationId);
  if (
    !candidate ||
    !generation ||
    candidate.generationId !== generation._id ||
    candidate.projectId !== generation.projectId
  ) {
    domainError("NOT_AUTHORIZED", "Candidate does not belong to this generation");
  }
  // report.editProse: selecting a candidate creates the project's report.
  const { project, user } = await requireReportEditAccess(
    ctx,
    candidate.projectId
  );
  if ((generation.candidateMode ?? "compare") === "iterative") {
    domainError(
      "INVALID_STATE",
      "Section-by-section drafts are approved per section, not selected"
    );
  }
  // Generations created before the run-guard deploy never had
  // activeGenerationId stamped on the project; an unset pointer is safe to
  // accept because the run guard forbids a second active generation while
  // any awaiting_selection row exists.
  if (
    generation.status !== "awaiting_selection" ||
    (project.activeGenerationId !== undefined &&
      project.activeGenerationId !== generation._id)
  ) {
    domainError("STALE_REVISION", "This generation is no longer awaiting selection");
  }

  const reportId = await createGeneratedReportArtifacts(
    ctx,
    generation,
    candidate
  );
  const now = Date.now();
  await ctx.db.patch(project._id, {
    activeGenerationId: undefined,
    status: "review",
    updatedAt: now,
  });
  await writeAgentOutputs(ctx, generation, candidate.agentOutputs);
  await transitionGeneration(ctx, generation, "completed", {
    currentStep: "Complete",
    // Story 2 (AD-24): the selected candidate's own stop, if it stopped.
    stoppedAfterSection: stoppedAfterSectionOf(candidate.agentOutputs),
    completedAt: now,
  });
  await refreshProjectGenerationActivity(ctx, generation.projectId);
  await ctx.db.insert("modelSelections", {
    projectId: candidate.projectId,
    generationId: generation._id,
    userId: user._id,
    candidateId: candidate._id,
    model: candidate.model,
    label: candidate.label,
    createdAt: now,
  });
  const all = await ctx.db
    .query("reportCandidates")
    .withIndex("by_generationId", (q) => q.eq("generationId", generation._id))
    .take(10);
  for (const row of all) await ctx.db.delete(row._id);
  return reportId;
}
