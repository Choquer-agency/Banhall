/**
 * Read models over generation rows: the project page, history and recovery
 * views, and the user-safe projection of stored errors and narration.
 *
 * Split out of convex/generations.ts (2026-09-25, phase 4). The Convex
 * functions stay registered in convex/generations.ts under their old names;
 * this module holds their handlers and helpers.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";
import { v, type ObjectType } from "convex/values";
import { getInternalProjectAccessOrNull } from "../auth";
import { resolveGatedWorkflow, resolveSeedPhase } from "../gatedWorkflow";
import { SEED_INITIALIZATION_ERROR } from "./seedStage";
import { getReportEditAccessOrNull } from "../roleCapabilities";
import { readGenerationProgress } from "../generationProgress";
import { seedModelById } from "../../../shared/generationModels";

// ─── Generation status helpers ───────────────────────────────────────────────
// ACTIVE_GENERATION_STATUSES (the project stays fenced on the generation and
// the dashboard shows activity for it) and isTerminalGenerationStatus (nothing
// may resurrect the row; stranded candidate runs are settled by the reaper)
// come from the declared state machine in shared/generationTransitions.ts.
// Every status write goes through transitionGeneration.

/** A generation the project page, history list, and dashboard may surface.
 * `superseded` rows are attempt history only — the recovery generation that
 * replaced them (its `retryOfGenerationId` points back here) is the one that
 * continues, so they are never the latest, active, completed, or failed run. */
export type VisibleGeneration = Doc<"generations"> & {
  status: Exclude<Doc<"generations">["status"], "superseded">;
};

export function isVisibleGeneration(
  generation: Doc<"generations">
): generation is VisibleGeneration {
  return generation.status !== "superseded";
}

export const GENERATION_HISTORY_LIMIT = 50;

/** Newest-first visible generations for a project. The scan stops at `limit`
 * visible rows; every superseded row it skips is paired with a newer recovery
 * row, so the extra reads are bounded by the project's retry count. */
export async function visibleGenerations(
  ctx: QueryCtx,
  projectId: Id<"projects">,
  limit: number
): Promise<VisibleGeneration[]> {
  const visible: VisibleGeneration[] = [];
  for await (const generation of ctx.db
    .query("generations")
    .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
    .order("desc")) {
    if (!isVisibleGeneration(generation)) continue;
    visible.push(generation);
    if (visible.length >= limit) break;
  }
  return visible;
}

/** Argument validators of generations.getLatestGeneration. */
export const getLatestGenerationArgs = { projectId: v.id("projects") };

/** Handler of generations.getLatestGeneration. */
export async function getLatestGenerationHandler(
  ctx: QueryCtx,
  args: ObjectType<typeof getLatestGenerationArgs>
) {
  const access = await getInternalProjectAccessOrNull(ctx, args.projectId);
  if (!access) return null;

  // Newest non-superseded row: after a partial retry the linked recovery
  // generation is the latest, never the superseded original (CAP-7).
  const [generation] = await visibleGenerations(ctx, args.projectId, 1);
  if (!generation) return null;
  // Which model's draft the writer chose — visible to everyone (the blind
  // A/B test is over; model identity is shown to all users).
  const selection = await ctx.db
    .query("modelSelections")
    .withIndex("by_projectId_and_generationId", (q) =>
      q.eq("projectId", args.projectId).eq("generationId", generation._id)
    )
    .first();
  const selectedModelLabel: string | null = selection?.label ?? null;
  // Iterative runs draft with one model — surface its label for the page bar.
  let iterativeModelLabel: string | null = null;
  if ((generation.candidateMode ?? "compare") === "iterative") {
    const firstRun = await ctx.db
      .query("generationSectionRuns")
      .withIndex("by_generationId_and_section", (q) =>
        q.eq("generationId", generation._id).eq("section", "s242")
      )
      .unique();
    iterativeModelLabel = firstRun?.label ?? null;
  }
  const gatedWorkflow = resolveGatedWorkflow(generation);
  const seedRow = gatedWorkflow === "seeds"
    ? await ctx.db
        .query("seedSubsections")
        .withIndex("by_generationId", (q) =>
          q.eq("generationId", generation._id)
        )
        .first()
    : null;
  const seedPhase = resolveSeedPhase(generation, seedRow !== null);
  return {
    selectedModelLabel,
    iterativeModelLabel,
    postQaStatus: generation.postQaStatus,
    // Step-by-step writing and QA (CAP-17, CAP-18): the writer's stop, the
    // last Section drafted before it when Sections remain Not drafted, and
    // when the latest QA pass settled.
    stopRequestedAt: generation.stopRequestedAt,
    stoppedAfterSection: generation.stoppedAfterSection,
    postQaCompletedAt: generation.postQaCompletedAt,
    _id: generation._id,
    projectId: generation.projectId,
    transcriptId: generation.transcriptId,
    status: generation.status,
    candidateMode: generation.candidateMode ?? "compare",
    gatedWorkflow,
    seedPhase,
    seedStageError: generation.seedStageError ? SEED_INITIALIZATION_ERROR : undefined,
    seedStageVersion: generation.seedStageVersion ?? 0,
    summaryVersionId: generation.summaryVersionId ?? null,
    briefVersionId: generation.briefVersionId ?? null,
    originGenerationId: generation.originGenerationId ?? null,
    lengthTarget: generation.lengthTarget ?? null,
    seedCanEdit:
      gatedWorkflow === "seeds" &&
      (await getReportEditAccessOrNull(ctx, generation.projectId)) !== null,
    currentStep: generation.currentStep,
    // Same boundary contract as getIterativeState: raw provider text stays
    // on the row for ops; only typed copy and authored narration cross.
    // The newest PROGRESS_READ_LIMIT lines (child rows, legacy array first
    // for rows from before 2026-09-25).
    progressLog: (await readGenerationProgress(ctx, generation)).map(userSafeNarration),
    estimatedMs: generation.estimatedMs,
    totalCandidates: generation.totalCandidates,
    candidatesDone: generation.candidatesDone,
    candidatesFailed: generation.candidatesFailed,
    requestedAt: generation.requestedAt,
    startedAt: generation.startedAt,
    completedAt: generation.completedAt,
    error: userSafeStoredError(
      generation.error,
      "The generation did not complete. Try again."
    ),
    agentOutputs: generation.agentOutputs,
  };
}

/** Argument validators of generations.getGenerationSeedView. */
export const getGenerationSeedViewArgs = { generationId: v.id("generations") };

/** Handler of generations.getGenerationSeedView. */
export async function getGenerationSeedViewHandler(
  ctx: QueryCtx,
  args: ObjectType<typeof getGenerationSeedViewArgs>
) {
  const generation = await ctx.db.get(args.generationId);
  if (
    !generation ||
    !(await getInternalProjectAccessOrNull(ctx, generation.projectId))
  ) return null;
  const gatedWorkflow = resolveGatedWorkflow(generation);
  const seedRow = gatedWorkflow === "seeds"
    ? await ctx.db
        .query("seedSubsections")
        .withIndex("by_generationId", (q) =>
          q.eq("generationId", generation._id)
        )
        .first()
    : null;
  return {
    _id: generation._id,
    gatedWorkflow,
    seedPhase: resolveSeedPhase(generation, seedRow !== null),
    summaryVersionId: generation.summaryVersionId ?? null,
    seedCanEdit:
      gatedWorkflow === "seeds" &&
      (await getReportEditAccessOrNull(ctx, generation.projectId)) !== null,
  };
}

/** Argument validators of generations.getGeneration. */
export const getGenerationArgs = { generationId: v.id("generations") };

/** Handler of generations.getGeneration. */
export async function getGenerationHandler(
  ctx: QueryCtx,
  args: ObjectType<typeof getGenerationArgs>
) {
  const generation = await ctx.db.get(args.generationId);
  if (
    !generation ||
    !(await getInternalProjectAccessOrNull(ctx, generation.projectId))
  ) {
    return null;
  }
  // D-4: a non-empty promptVersion is the sole "tracked" marker. Legacy rows
  // and reservations not yet stamped by beginGeneration read as untracked and
  // return null for all three provenance fields — never 0, which would be
  // indistinguishable from a tracked generation that has cost nothing yet.
  // promptVersion is hoisted so the check narrows it to `string`, keeping the
  // returned type `string | null` with no impossible `undefined` for callers.
  const promptVersion = generation.promptVersion;
  const tracked = typeof promptVersion === "string" && promptVersion.length > 0;
  // Every aiUsage row keyed to this generation, un-truncated: rows from calls
  // that later failed, timed out, or were retried all count, and rows keep
  // landing while the generation is in flight. Bounded by the pipeline's
  // generation-owned provider calls (low hundreds at worst), so a single
  // collect() stays well inside query read limits; truncating would
  // silently under-report.
  const usage = tracked
    ? await ctx.db
        .query("aiUsage")
        .withIndex("by_generationId", (q) =>
          q.eq("generationId", generation._id)
        )
        .collect()
    : null;
  return {
    _id: generation._id,
    projectId: generation.projectId,
    transcriptId: generation.transcriptId,
    status: generation.status,
    candidateMode: generation.candidateMode ?? "compare",
    currentStep: generation.currentStep,
    estimatedMs: generation.estimatedMs,
    totalCandidates: generation.totalCandidates,
    candidatesDone: generation.candidatesDone,
    candidatesFailed: generation.candidatesFailed,
    requestedAt: generation.requestedAt,
    startedAt: generation.startedAt,
    completedAt: generation.completedAt,
    agentOutputs: generation.agentOutputs,
    /** Deployment-level prompt program hash, or null for untracked rows. */
    promptVersion: tracked ? promptVersion : null,
    /** Learned-guidance ids recorded so far, or null for untracked rows. */
    learningDigestIds: tracked ? (generation.learningDigestIds ?? []) : null,
    /** Recorded attributable cost in US dollars: the sum of `costUsd` over
     * the `aiUsage` rows recorded against this generation. Individual rows
     * may themselves be estimated from token counts (`logUsage` falls back to
     * `estimateCostUsd` when the provider reports no cost), so this is
     * recorded attributable cost, not exact total provider spend, and makes
     * no claim of invoice completeness — unrecorded or unattributed calls are
     * simply absent. `null` means the generation is untracked, not that it
     * cost nothing. The tracked marker, not the emptiness of the usage read,
     * is what decides null-vs-0. */
    cost: tracked
      ? (usage ?? []).reduce((total, row) => total + row.costUsd, 0)
      : null,
  };
}

/** Argument validators of generations.getGenerationRecovery. */
export const getGenerationRecoveryArgs = { generationId: v.id("generations") };

/** Handler of generations.getGenerationRecovery. */
export async function getGenerationRecoveryHandler(
  ctx: QueryCtx,
  args: ObjectType<typeof getGenerationRecoveryArgs>
) {
  const generation = await ctx.db.get(args.generationId);
  if (!generation) return null;
  if (!(await getInternalProjectAccessOrNull(ctx, generation.projectId))) return null;
  const runs = await ctx.db
    .query("generationCandidateRuns")
    .withIndex("by_generationId", (q) => q.eq("generationId", generation._id))
    .take(10);
  // Recovery retries insert carried-over run rows directly (bypassing the
  // per-model uniqueness guard in createCandidateRun), so the same
  // model+status pair can appear twice — the UI keys its list on that pair
  // (each_key_duplicate class, Aug 18 audit).
  const seenModelStatus = new Set<string>();
  const models = runs
    .filter((run) => !run.ghost)
    .filter((run) => {
      const key = `${run.model}-${run.status}`;
      if (seenModelStatus.has(key)) return false;
      seenModelStatus.add(key);
      return true;
    })
    .map((run) => ({
      model: run.model,
      label: seedModelById(run.model)?.label ?? run.label ?? "Draft model",
      status: run.status,
    }));
  return {
    generationId: generation._id,
    status: generation.status,
    retryOfGenerationId: generation.retryOfGenerationId ?? null,
    candidatesDone:
      generation.candidatesDone ?? models.filter((run) => run.status === "succeeded").length,
    candidatesFailed:
      generation.candidatesFailed ?? models.filter((run) => run.status === "failed").length,
    models,
  };
}

/** Argument validators of generations.listGenerations. */
export const listGenerationsArgs = { projectId: v.id("projects") };

/** Handler of generations.listGenerations. */
export async function listGenerationsHandler(
  ctx: QueryCtx,
  args: ObjectType<typeof listGenerationsArgs>
) {
  if (!(await getInternalProjectAccessOrNull(ctx, args.projectId))) return [];

  // History excludes superseded rows (CAP-7): they are neither completed
  // nor failed attempts, just the pre-retry half of a recovery generation.
  const generations = await visibleGenerations(
    ctx,
    args.projectId,
    GENERATION_HISTORY_LIMIT
  );
  return generations.map((generation) => ({
    _id: generation._id,
    status: generation.status,
    currentStep: generation.currentStep,
    requestedAt: generation.requestedAt,
    startedAt: generation.startedAt,
    completedAt: generation.completedAt,
    error: generation.error,
  }));
}

// ─── User-safe error projection for the iterative stepper ────────────────────
// Stored run/generation errors are "<code>: <message>" from
// normalizeProviderError; the "unknown" branch embeds raw provider text, which
// is ops material, not end-user copy (docs/product-domain.md: failure states
// use typed, user-safe errors). Raw strings stay on the rows for ops — they
// are mapped at this query boundary only. Strings without a known code prefix
// were written by our own mutations (timeouts, cancels, frozen-input) and are
// already safe copy, except that unrecognized colon-prefixed strings fall back
// to the generic line to be safe.
export const STORED_ERROR_COPY: Record<string, string> = {
  billing:
    "The AI provider account cannot accept this request because billing or credits need attention.",
  rate_limited:
    "The AI provider is rate-limiting requests. Try again after the limit resets.",
  authentication: "The AI provider credentials were rejected by the provider.",
  model_access:
    "The configured account does not have access to a required model.",
  output_limit:
    "The model ran out of output budget before finishing this step. Retry, or use a different model for this draft.",
  network: "The AI provider could not be reached from this deployment.",
} as const;

export function userSafeStoredError(
  error: string | undefined,
  fallback: string
): string | null {
  if (!error) return null;
  const separator = error.indexOf(":");
  if (separator <= 0) return error; // our own copy — no provider code prefix
  const code = error.slice(0, separator);
  return STORED_ERROR_COPY[code] ?? fallback;
}

/** Progress narration appends failure details verbatim ("… failed: <error>.").
 * Strip everything after the failure marker so raw provider text never rides
 * along; every other narration line is authored copy and passes through. */
export function userSafeNarration(line: string): string {
  return line.replace(/ failed: .*$/s, " failed.");
}
