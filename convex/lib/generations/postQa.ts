/**
 * The post-assembly QA pass: its inputs, results, the writer retrigger and
 * the stale-pass reaper.
 *
 * Split out of convex/generations.ts (2026-09-25, phase 4). The Convex
 * functions stay registered in convex/generations.ts under their old names;
 * this module holds their handlers and helpers.
 */
import { v, type ObjectType } from "convex/values";
import type { QueryCtx, MutationCtx } from "../../_generated/server";
import { isProjectDeleting } from "../projectDeletion";
import {
  reportQaRef,
  persistDeterministicFindings,
  persistMethodologyFindings,
} from "../qaFindings";
import { extractReportSections } from "../tiptapReport";
import type { Id } from "../../_generated/dataModel";
import { resolveGatedWorkflow } from "../gatedWorkflow";
import type { FrozenBrainArtifact } from "./seedStage";
import { type IterativeSection, SECTION_ORDER, getSectionRun } from "./iterative";
import { transitionPostQa } from "../generationTransitions";
import { appendGenerationProgress } from "../generationProgress";
import { domainError } from "../contracts";
import { getInternalProjectAccessOrNull } from "../auth";
import { requireReportEditAccess } from "../roleCapabilities";
import { internal } from "../../_generated/api";
import { readAgentOutputs, writeAgentOutputs } from "../generationOutputs";
import { latestQaResult, qaResultIsCurrent, recordQaResult } from "../qaResults";

/** Argument validators of generations.getPostQaAttempt. */
export const getPostQaAttemptArgs = { generationId: v.id("generations") };

/** Handler of generations.getPostQaAttempt. */
export async function getPostQaAttemptHandler(
  ctx: QueryCtx,
  args: ObjectType<typeof getPostQaAttemptArgs>
) {
  const generation = await ctx.db.get(args.generationId);
  if (generation?.postQaStatus !== "running") return null;
  return {
    startedAt: generation.postQaStartedAt ?? null,
    // Story 0 (AD-19): the post-QA action's entry reads this and returns
    // without writing when the project entered deletion.
    projectDeleting: await isProjectDeleting(ctx, generation.projectId),
  };
}

/** Argument validators of generations.getPostQaInput. */
export const getPostQaInputArgs = { generationId: v.id("generations") };

/** Handler of generations.getPostQaInput. */
export async function getPostQaInputHandler(
  ctx: QueryCtx,
  args: ObjectType<typeof getPostQaInputArgs>
) {
  const generation = await ctx.db.get(args.generationId);
  if (!generation) return null;
  const report = await ctx.db.query("reports")
    .withIndex("by_generationId", q => q.eq("generationId", generation._id)).first();
  if (!report) return null;
  const capturedRef = await reportQaRef(report);
  const currentSections = extractReportSections(report.content);
  if (!Object.values(currentSections).some(text => text.trim())) return null;
  if ((generation.candidateMode ?? "compare") === "iterative") {
    const [analysisRow, brainRow] = await Promise.all([
      ctx.db
        .query("generationArtifacts")
        .withIndex("by_generationId_and_kind", (q) =>
          q.eq("generationId", args.generationId).eq("kind", "analysis")
        )
        .unique(),
      ctx.db
        .query("generationArtifacts")
        .withIndex("by_generationId_and_kind", (q) =>
          q.eq("generationId", args.generationId).eq("kind", "brain_blocks")
        )
        .unique(),
    ]);
    if (!analysisRow) return null;
    // PSOS-49: QA must score under the SAME waivers the sections were
    // drafted with — the ones frozen into the brain_blocks artifact at
    // generation start, not the writer's live profile.
    let styleOverrides: Record<string, boolean> | undefined;
    // CAP-18: a signed-off seed run scores in the background under the
    // same frozen calibration and first-person intent its inline QA used
    // to read from the ordered payload (both frozen into brain_blocks at
    // generation start). Other iterative runs keep the live calibration.
    let frozenQaInputs:
      | {
          qaCalibration: string | null;
          qaCalibrationDigestId: Id<"learningDigests"> | null;
          writerFlavor: string | null;
        }
      | undefined;
    const seedOrdered =
      resolveGatedWorkflow(generation) === "seeds" &&
      generation.summaryVersionId !== undefined;
    if (seedOrdered) {
      frozenQaInputs = { qaCalibration: null, qaCalibrationDigestId: null, writerFlavor: null };
    }
    if (brainRow) {
      try {
        const parsed: unknown = JSON.parse(brainRow.content);
        if (
          parsed &&
          typeof parsed === "object" &&
          "styleOverrides" in parsed &&
          parsed.styleOverrides &&
          typeof parsed.styleOverrides === "object"
        ) {
          styleOverrides = parsed.styleOverrides as Record<string, boolean>;
        }
        if (seedOrdered && parsed && typeof parsed === "object") {
          const artifact = parsed as Partial<FrozenBrainArtifact>;
          frozenQaInputs = {
            qaCalibration:
              typeof artifact.qaCalibration === "string" ? artifact.qaCalibration : null,
            qaCalibrationDigestId:
              typeof artifact.qaCalibrationDigestId === "string"
                ? artifact.qaCalibrationDigestId
                : null,
            writerFlavor:
              typeof artifact.writerFlavor === "string" ? artifact.writerFlavor : null,
          };
        }
      } catch {
        // Malformed artifact: score under default enforcement.
      }
    }
    const sections: Record<IterativeSection, { text: string; model: string }> = {
      s242: { text: "", model: "" },
      s244: { text: "", model: "" },
      s246: { text: "", model: "" },
    };
    for (const section of SECTION_ORDER) {
      const run = await getSectionRun(ctx, args.generationId, section);
      sections[section] = {
        text: run?.approvedText ?? "",
        model: run?.model ?? "",
      };
    }
    if (!currentSections.s242.trim() && !currentSections.s244.trim() && !currentSections.s246.trim()) {
      return null;
    }
    return {
      projectId: generation.projectId,
      requestedBy: generation.requestedBy,
      analysis: analysisRow.content,
      section242: currentSections.s242,
      capturedRef,
      section244: currentSections.s244,
      section246: currentSections.s246,
      model: sections.s242.model || undefined,
      styleOverrides,
      ...(frozenQaInputs ? { frozenQaInputs } : {}),
    };
  }
  // One-shot / compare generations (Jul 17: "regenerate QA panel"): the
  // analyzer output and section texts were persisted inside agentOutputs at
  // generation time — rebuild the QA input from there.
  const agentOutputs = await readAgentOutputs(ctx, generation);
  if (!agentOutputs) return null;
  try {
    const outputs = JSON.parse(agentOutputs) as {
      analyzer?: unknown;
      section242?: string;
      section244?: string;
      section246?: string;
      styleOverrides?: Record<string, boolean>;
    };
    if (
      !outputs.analyzer
    ) {
      return null;
    }
    const selection = await ctx.db
      .query("modelSelections")
      .withIndex("by_projectId_and_generationId", (q) =>
        q.eq("projectId", generation.projectId).eq("generationId", generation._id)
      )
      .first();
    return {
      projectId: generation.projectId,
      requestedBy: generation.requestedBy,
      analysis: JSON.stringify(outputs.analyzer),
      section242: currentSections.s242,
      capturedRef,
      section244: currentSections.s244,
      section246: currentSections.s246,
      model: selection?.model ?? undefined,
      // PSOS-50: waivers frozen into agentOutputs at generation time.
      // Absent only on legacy generations, where postQa falls back to the
      // writer's live profile.
      styleOverrides:
        outputs.styleOverrides && typeof outputs.styleOverrides === "object"
          ? outputs.styleOverrides
          : undefined,
    };
  } catch {
    return null;
  }
}

/** Argument validators of generations.saveReportQa. */
export const saveReportQaArgs = {
  generationId: v.id("generations"),
  attemptStartedAt: v.optional(v.union(v.number(), v.null())),
  capturedRef: v.optional(v.object({ reportId: v.id("reports"), revisionNumber: v.number(), contentHash: v.string() })),
  qa: v.optional(v.string()),
  chronology: v.optional(v.string()),
  qaScore: v.optional(v.number()),
  failed: v.optional(v.boolean()),
};

/** Handler of generations.saveReportQa. */
export async function saveReportQaHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof saveReportQaArgs>
) {
  const generation = await ctx.db.get(args.generationId);
  if (!generation) return;
  // Story 0 (AD-19): a pass that started before the project entered
  // deletion persists nothing — no findings, no status flip. The barrier
  // fences the persistence side as well as the action's entry.
  if (await isProjectDeleting(ctx, generation.projectId)) {
    console.log("saveReportQa: project is being deleted; results discarded", {
      projectId: generation.projectId,
      generationId: generation._id,
    });
    return;
  }
  // A delayed completion must not settle a replacement attempt or overwrite
  // results that have already completed, even when the report is unchanged.
  if (args.attemptStartedAt !== undefined &&
    (generation.postQaStatus !== "running" ||
      (generation.postQaStartedAt ?? null) !== args.attemptStartedAt)) return;
  const report = await ctx.db.query("reports")
    .withIndex("by_generationId", q => q.eq("generationId", generation._id)).first();
  if (args.capturedRef) {
    const current = report ? await reportQaRef(report) : null;
    if (!current || current.reportId !== args.capturedRef.reportId || current.revisionNumber !== args.capturedRef.revisionNumber || current.contentHash !== args.capturedRef.contentHash) {
      // Only an identified active attempt may release the retry lock. Its
      // stale scorecard and chronology never become current evidence.
      if (args.attemptStartedAt !== undefined) {
        await transitionPostQa(ctx, generation, "failed", {
          postQaCompletedAt: Date.now(),
        });
      }
      return;
    }
  }
  if (report) {
    await persistDeterministicFindings(ctx, report._id);
    // Legacy calls have no proof of what content the model evaluated.
    if (args.capturedRef && args.qa) {
      let qa: unknown;
      try { qa = JSON.parse(args.qa); }
      catch { /* Malformed QA cannot establish a methodology failure. */ }
      await persistMethodologyFindings(ctx, report, qa);
    }
  }
  let outputs: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse((await readAgentOutputs(ctx, generation)) ?? "{}");
    if (parsed && typeof parsed === "object") {
      outputs = parsed as Record<string, unknown>;
    }
  } catch {
    // Corrupt/missing agentOutputs — rebuild with just the QA keys.
  }
  if (args.qa) {
    try {
      outputs.qa = JSON.parse(args.qa);
    } catch {
      /* skip unparseable */
    }
  }
  if (args.chronology) {
    try {
      outputs.chronology = JSON.parse(args.chronology);
    } catch {
      /* skip unparseable */
    }
  }
  // A failed pass still persists whatever DID succeed (e.g. the chronology
  // when only the scorecard was malformed) instead of discarding it.
  if (args.failed) {
    await appendGenerationProgress(ctx, generation, [
      "Post-assembly QA pass failed — the report is unaffected.",
    ]);
    const completedAt = Date.now();
    await writeAgentOutputs(ctx, generation, JSON.stringify(outputs));
    await recordQaResult(ctx, generation, args, "failed", completedAt);
    await transitionPostQa(ctx, generation, "failed", {
      postQaCompletedAt: completedAt,
    });
    return;
  }
  await appendGenerationProgress(ctx, generation, [
    `✓ QA scorecard ready${args.qaScore !== undefined ? ` (${args.qaScore}/100)` : ""}.`,
  ]);
  const completedAt = Date.now();
  await writeAgentOutputs(ctx, generation, JSON.stringify(outputs));
  await recordQaResult(ctx, generation, args, "done", completedAt);
  await transitionPostQa(ctx, generation, "done", {
    postQaCompletedAt: completedAt,
    ...(args.qaScore !== undefined ? { qaScore: args.qaScore } : {}),
  });
}

/** Argument validators of generations.requestReportQa. */
export const requestReportQaArgs = { generationId: v.id("generations") };

/** Handler of generations.requestReportQa. */
export async function requestReportQaHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof requestReportQaArgs>
) {
  const generation = await ctx.db.get(args.generationId);
  if (!generation) domainError("NOT_FOUND", "Generation not found");
  await requireReportEditAccess(ctx, generation.projectId);
  // CAP-7: QA scores a report. A generation without one — a superseded
  // partial, a failed run, or a legacy row whose report was deleted — has
  // nothing to review, so refuse before any write or schedule.
  const report = await ctx.db
    .query("reports")
    .withIndex("by_generationId", (q) => q.eq("generationId", generation._id))
    .first();
  if (!report) {
    domainError("INVALID_STATE", "This generation has no report to review");
  }
  // Jul 17 meeting: any completed generation can (re)run its QA scorecard —
  // some projects lost the panel to an error or predate the feature.
  if (generation.status !== "completed") {
    domainError("INVALID_INPUT", "The report must be completed before QA can run");
  }
  // Idempotent: a pass already in flight keeps running across panel
  // close/reopen — never double-spend the API call.
  if (generation.postQaStatus === "running") return null;
  const attemptStartedAt = Math.max(Date.now(), (generation.postQaStartedAt ?? 0) + 1);
  await transitionPostQa(ctx, generation, "running", {
    postQaStartedAt: attemptStartedAt,
  });
  await ctx.scheduler.runAfter(0, internal.ai.postQa.runReportQa, {
    generationId: generation._id,
    attemptStartedAt,
  });
  return null;
}

/** Argument validators of generations.failStalePostQa. */
export const failStalePostQaArgs = { olderThanMinutes: v.optional(v.number()) };

/** Handler of generations.failStalePostQa. */
export async function failStalePostQaHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof failStalePostQaArgs>
) {
  const cutoff = Date.now() - (args.olderThanMinutes ?? 15) * 60 * 1000;
  const running = await ctx.db
    .query("generations")
    .withIndex("by_postQaStatus", (q) => q.eq("postQaStatus", "running"))
    .take(100);
  let failed = 0;
  for (const generation of running) {
    if ((generation.postQaStartedAt ?? 0) >= cutoff) continue;
    await appendGenerationProgress(ctx, generation, [
      "Post-assembly QA pass timed out — the report is unaffected. Run it again from the QA panel.",
    ]);
    await transitionPostQa(ctx, generation, "failed", {
      postQaCompletedAt: Date.now(),
    });
    failed += 1;
  }
  return { failed };
}

/** Argument validators of generations.getGenerationQaResult. */
export const getGenerationQaResultArgs = { generationId: v.id("generations") };

/**
 * Handler of generations.getGenerationQaResult: the newest recorded QA result
 * of a generation, the report revision it scored, and whether the report is
 * still at that revision with the same bytes (`current`). Null for an
 * outsider, a missing generation, or a generation with no recorded result
 * (older passes, and legacy settles, recorded none).
 */
export async function getGenerationQaResultHandler(
  ctx: QueryCtx,
  args: ObjectType<typeof getGenerationQaResultArgs>
) {
  const generation = await ctx.db.get(args.generationId);
  if (!generation) return null;
  if (!(await getInternalProjectAccessOrNull(ctx, generation.projectId))) return null;
  const result = await latestQaResult(ctx, generation._id);
  if (!result) return null;
  const report = await ctx.db.get(result.reportId);
  return {
    status: result.status,
    reportId: result.reportId,
    revisionNumber: result.revisionNumber,
    contentHash: result.contentHash,
    qaScore: result.qaScore ?? null,
    completedAt: result.completedAt,
    current: await qaResultIsCurrent(result, report),
  };
}
