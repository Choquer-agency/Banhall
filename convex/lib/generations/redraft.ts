/**
 * Step-by-step writing progress, Stop and "Draft the rest" (CAP-17, CAP-18,
 * owner decision 20).
 *
 * Split out of convex/generations.ts (2026-09-25, phase 4). The Convex
 * functions stay registered in convex/generations.ts under their old names;
 * this module holds their handlers and helpers.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import { resolveGatedWorkflow } from "../gatedWorkflow";
import type { QueryCtx, MutationCtx } from "../../_generated/server";
import {
  type SectionNumber,
  sectionKeyOf,
  sectionNumberValidator,
  orderedPayloadValidator,
} from "../orderedChain";
import {
  extractReportSections,
  fillNotDraftedSections,
  notDraftedReportSections,
  sectionParagraphs,
  NOT_GENERATED_PLACEHOLDER,
} from "../tiptapReport";
import { v, type ObjectType } from "convex/values";
import { getInternalProjectAccessOrNull } from "../auth";
import {
  sectionNumberOfRow,
  orderedRunForSection,
  orderedRunsForCandidate,
  orderedSectionClaim,
  storylineQuestionValidator,
  requireOrderedPayloadRef,
  orderedSectionResultFields,
  persistSectionNotes,
  sectionCheckNarration,
} from "./chain";
import { PD_SECTION_HEADINGS } from "../../../shared/pdSubsections";
import { NOT_DRAFTED_AFTER_STOP } from "./candidates";
import { isProjectDeleting } from "../projectDeletion";
import { domainError, sha256 } from "../contracts";
import { requireReportEditAccess } from "../roleCapabilities";
import { findActiveGeneration } from "../activeGeneration";
import { ACTIVE_GENERATION_STATUSES } from "../../../shared/generationTransitions";
import { frozenOrderedPayload, assertFrozenSummaryRuntimeAdmission } from "./seedStage";
import { appendGenerationProgress } from "../generationProgress";
import { transitionRedraft } from "../generationTransitions";
import {
  persistOrderedPayload,
  resolveOrderedPayload,
  forwardOrderedPayload,
} from "../orderedPayloadStore";
import { internal } from "../../_generated/api";
import { loadBriefCheck } from "./brief";
import { complianceNoteDraftValidator, complianceNoteRow } from "../complianceNote";
import { ORDERED_SECTION_TITLES } from "../../ai/promptDefinitions";
import { writePreEditSnapshot } from "../snapshots";
import { persistDeterministicFindings } from "../qaFindings";
import { readAgentOutputs, writeAgentOutputs } from "../generationOutputs";

// ─── Step-by-step writing progress, Stop and redraft (CAP-17, CAP-18) ───────
//
// A signed-off seed generation drafts its three Sections through the ordered
// chain above. The writing view reads getSeedDraftProgress; Stop is
// stopOrderedGeneration; "Draft the rest" is redraftMissingSections, which
// drafts only the Sections a stop left "Not drafted" and writes them into the
// SAME report (owner decision 20).
//
// Redraft write rule (AGENTS.md "agents propose, humans apply"): the redraft
// is not an AI tool editing prose. It is the writer's own "Draft the rest"
// action finishing the report-creation path their Stop interrupted, and it
// may only replace a Section body that is still exactly the untouched
// `[NOT GENERATED]` placeholder. The merge runs inside one mutation against
// the report's latest saved content and bumps its revision, so no saved edit
// can be overwritten: every other node is carried over byte for byte, a
// Section the writer has started typing in is left alone, and a pre-edit
// snapshot makes the write restorable.

/** A finished Section with no measured duration yet: a draft, compression,
 * Self-check and possible repair. */
export const DEFAULT_SECTION_DRAFT_MS = 90_000;

/** The assembled-draft consistency pass before the last Section is shown. */
export const DEFAULT_CONSISTENCY_PASS_MS = 20_000;

/** Floor for a measured estimate, so an implausibly fast Section never
 * makes the next one's share jump straight to the cap. */
export const MIN_SECTION_ESTIMATE_MS = 10_000;

/** The share of a Section the pill may show before it is done. */
export const SECTION_PROGRESS_CAP = 0.95;

/** A redraft that made no progress for this long is treated as dead: the
 * writing view shows the draft as stopped again and a new "Draft the rest"
 * starts a fresh attempt (older actions are fenced by attemptStartedAt). */
export const REDRAFT_STALE_MS = 15 * 60 * 1000;

/** Error code the scheduled expiry records on a redraft that went quiet. */
export const REDRAFT_TIMEOUT_CODE = "timeout";

export function isSignedOffSeedGeneration(generation: Doc<"generations">): boolean {
  return (
    resolveGatedWorkflow(generation) === "seeds" &&
    generation.summaryVersionId !== undefined
  );
}

/** The seed chain's candidate run and its Section rows in production order.
 * A signed-off seed generation owns one chain (recovery is a new
 * generation); the newest run wins if an older row ever remains. */
export async function seedChainRows(
  ctx: { db: QueryCtx["db"] },
  generationId: Id<"generations">
): Promise<{
  run: Doc<"generationCandidateRuns"> | null;
  rows: Doc<"generationSectionRuns">[];
}> {
  const all = (
    await ctx.db
      .query("generationSectionRuns")
      .withIndex("by_generationId", (q) => q.eq("generationId", generationId))
      .take(10)
  ).filter((row) => row.candidateRunId !== undefined);
  if (all.length === 0) return { run: null, rows: [] };
  const newest = all.reduce((latest, row) =>
    row._creationTime > latest._creationTime ? row : latest
  );
  const runId = newest.candidateRunId as Id<"generationCandidateRuns">;
  const run = await ctx.db.get(runId);
  const rows = all
    .filter((row) => row.candidateRunId === runId)
    .sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
  return { run, rows };
}

/** Whether a redraft attempt still counts as running when a writer asks to
 * start one. The scheduled expiry (expireStaleRedraft) settles a dead
 * attempt; this time check is only the fallback for an expiry that never
 * ran, so a request after the stale window always starts a fresh attempt. */
export function isRedraftLive(
  redraft: Doc<"generations">["redraft"],
  now: number
): boolean {
  return (
    redraft !== undefined &&
    redraft.status === "running" &&
    now - redraft.lastProgressAt < REDRAFT_STALE_MS
  );
}

export type SeedRedraftSummary = {
  status: "running" | "failed" | "done";
  /** Plain words for the writer; never the provider's raw message. */
  error: string | null;
  /** The attempt's `attemptStartedAt`: a new "Draft the rest" is a new id. */
  attemptId: number;
  /** Section numbers this attempt drafts or writes into the report. */
  sections: SectionNumber[];
  /** Section numbers this attempt wrote into the report (settled only). */
  filledSections: SectionNumber[];
};

/** The stored redraft error is `<code>: <provider message>`; the page gets
 * a fixed sentence for its code instead, so no provider detail leaks. */
export function redraftUserError(stored: string | undefined): string {
  const code = stored?.split(":", 1)[0]?.trim() ?? "";
  switch (code) {
    case REDRAFT_TIMEOUT_CODE:
      return "Drafting stopped responding, so the missing sections were not drafted. Try again.";
    case "rate_limited":
      return "The AI service is busy right now. Try again in a few minutes.";
    case "network":
      return "The AI service could not be reached. Try again.";
    case "output_limit":
      return "A section ran past its length limit and was not drafted. Try again.";
    case "billing":
    case "authentication":
    case "model_access":
      return "The AI service refused the request. Ask an administrator to check the AI settings.";
    default:
      return "The missing sections could not be drafted. Try again.";
  }
}

export function seedRedraftSummary(
  redraft: Doc<"generations">["redraft"]
): SeedRedraftSummary | null {
  if (!redraft) return null;
  return {
    status:
      redraft.status === "running" ? "running" : redraft.status === "failed" ? "failed" : "done",
    error: redraft.status === "failed" ? redraftUserError(redraft.error) : null,
    attemptId: redraft.attemptStartedAt,
    sections: [...redraft.sections],
    filledSections: [...(redraft.filledSections ?? [])],
  };
}

/** The attempt's drafted Sections as the report would take them: a draft
 * fills only a body that is still the untouched placeholder, so wherever
 * the writer typed, their text wins over the draft. Returns the resulting
 * Section text, or null without a report. */
export function prospectiveRedraftSections(
  reportContent: string | null,
  rows: Doc<"generationSectionRuns">[],
  redrafting: Set<string>
): ReturnType<typeof extractReportSections> | null {
  if (reportContent === null) return null;
  const drafts: Partial<Record<"s242" | "s244" | "s246", string>> = {};
  for (const row of rows) {
    if (redrafting.has(row.section) && row.status === "drafted" && row.draftText) {
      drafts[row.section] = row.draftText;
    }
  }
  return extractReportSections(fillNotDraftedSections(reportContent, drafts).content);
}

export type SeedProgressPhase = "drafting" | "stopping" | "completed" | "stopped" | "failed";

export type SeedProgressStatus = "queued" | "writing" | "done" | "not_drafted";

/** Argument validators of generations.getSeedDraftProgress. */
export const getSeedDraftProgressArgs = { generationId: v.id("generations") };

/** Handler of generations.getSeedDraftProgress. */
export async function getSeedDraftProgressHandler(
  ctx: QueryCtx,
  args: ObjectType<typeof getSeedDraftProgressArgs>
) {
  const generation = await ctx.db.get(args.generationId);
  if (!generation || !isSignedOffSeedGeneration(generation)) return null;
  if (!(await getInternalProjectAccessOrNull(ctx, generation.projectId))) return null;
  const now = Date.now();
  const { run, rows } = await seedChainRows(ctx, generation._id);
  const redraft = generation.redraft;
  // Live means running. The scheduled expiry (expireStaleRedraft) moves a
  // dead attempt to `failed`, so this read sees it end without the clock.
  const redraftLive = generation.status === "completed" && redraft?.status === "running";
  const redraftSections = new Set<string>(
    redraftLive && redraft ? redraft.sections.map((section) => sectionKeyOf(section)) : []
  );
  // A completed run is judged by the report the writer sees: a Section they
  // filled by hand is present, and a draft the report never took is not.
  const report =
    generation.status === "completed" ? await reportForGeneration(ctx, generation._id) : null;
  const reportSections = report ? extractReportSections(report.content) : null;
  const placeholderSections = new Set<string>(
    report ? notDraftedReportSections(report.content) : []
  );
  const handText = (row: Doc<"generationSectionRuns">): string | null =>
    report && row.status !== "drafted"
      ? presentReportSection(reportSections, sectionNumberOfRow(row))
      : null;

  let phase: SeedProgressPhase;
  if (generation.status === "reserved" || generation.status === "running") {
    phase = generation.stopRequestedAt !== undefined ? "stopping" : "drafting";
  } else if (generation.status === "completed") {
    phase = redraftLive
      ? "drafting"
      : (report
            ? placeholderSections.size > 0
            : rows.some((row) => row.status !== "drafted"))
        ? "stopped"
        : "completed";
  } else {
    phase = "failed";
  }

  const lastIndex = rows.reduce((max, row) => Math.max(max, row.orderIndex ?? 0), -1);
  const lastRedraftIndex = rows
    .filter((row) => redraftSections.has(row.section))
    .reduce((max, row) => Math.max(max, row.orderIndex ?? 0), -1);
  const chainLive = phase === "drafting" || phase === "stopping";
  const awaitingCheck = (row: Doc<"generationSectionRuns">): boolean => {
    if (row.status !== "drafted") return false;
    if (redraftLive) {
      return redraftSections.has(row.section) && (row.orderIndex ?? 0) === lastRedraftIndex;
    }
    return (
      chainLive &&
      (row.orderIndex ?? 0) === lastIndex &&
      run?.consistencyCheckedAt === undefined
    );
  };
  const statusOf = (row: Doc<"generationSectionRuns">): SeedProgressStatus => {
    if (row.status === "drafted") {
      if (!redraftLive && placeholderSections.has(row.section)) return "not_drafted";
      return awaitingCheck(row) ? "writing" : "done";
    }
    // Filled by hand: the Section has text, so it is not missing.
    if (handText(row) !== null) return "done";
    if (redraftLive) {
      if (!redraftSections.has(row.section)) return "not_drafted";
      return row.status === "running" ? "writing" : "queued";
    }
    if (phase === "drafting") {
      if (row.status === "running") return "writing";
      return row.status === "failed" ? "not_drafted" : "queued";
    }
    if (phase === "stopping") {
      if (row.status === "running") return "writing";
      // After a stop only a first Section that has not started is still
      // drafted; every later one will not be.
      return row.status === "queued" && (row.orderIndex ?? 0) === 0
        ? "queued"
        : "not_drafted";
    }
    return "not_drafted";
  };

  const durations = rows
    .filter(
      (row) =>
        row.status === "drafted" &&
        row.startedAt !== undefined &&
        row.completedAt !== undefined &&
        row.completedAt >= row.startedAt &&
        !(redraftLive && redraftSections.has(row.section) && awaitingCheck(row))
    )
    .map((row) => (row.completedAt as number) - (row.startedAt as number));
  const sectionEstimate = durations.length
    ? Math.max(
        MIN_SECTION_ESTIMATE_MS,
        durations.reduce((sum, value) => sum + value, 0) / durations.length
      )
    : DEFAULT_SECTION_DRAFT_MS;

  const order: SectionNumber[] = rows.length
    ? rows.map(sectionNumberOfRow)
    : (generation.productionOrder ?? ["242", "244", "246"]);
  const sections = order.map((section, index) => {
    const row = rows.find((candidate) => candidate.section === sectionKeyOf(section));
    const status: SeedProgressStatus = row
      ? statusOf(row)
      : phase === "drafting"
        ? "queued"
        : "not_drafted";
    const heading = PD_SECTION_HEADINGS[sectionKeyOf(section)];
    const drafted = row?.status === "drafted";
    const handFilled = row && status === "done" && !drafted ? handText(row) : null;
    const doneAt =
      row && status === "done" && drafted
        ? !redraftLive &&
          (row.orderIndex ?? 0) === lastIndex &&
          run?.consistencyCheckedAt !== undefined
          ? Math.max(row.completedAt ?? 0, run.consistencyCheckedAt)
          : (row.completedAt ?? null)
        : null;
    return {
      key: section as string,
      number: heading.number as string,
      title: heading.title as string,
      question: heading.question as string,
      orderIndex: row?.orderIndex ?? index,
      status,
      paragraphs:
        status !== "done"
          ? []
          : drafted && row?.draftText
            ? sectionParagraphs(row.draftText)
            : handFilled
              ? sectionParagraphs(handFilled)
              : [],
      startedAt:
        row && (status === "writing" || (status === "done" && drafted))
          ? (row.startedAt ?? null)
          : null,
      completedAt: doneAt,
      row,
    };
  });

  const total = Math.max(sections.length, 1);
  const doneCount = sections.filter((section) => section.status === "done").length;
  let partial = 0;
  let remaining = 0;
  let consistencyPending = false;
  for (const section of sections) {
    const row = section.row;
    if (section.status === "writing" && row) {
      if (row.status === "drafted") {
        // Drafted, waiting for the consistency check.
        partial += SECTION_PROGRESS_CAP;
        consistencyPending = true;
        const waited = now - (row.completedAt ?? now);
        remaining += Math.max(0, DEFAULT_CONSISTENCY_PASS_MS - waited);
      } else {
        const elapsed = Math.max(0, now - (row.startedAt ?? now));
        partial += Math.min(SECTION_PROGRESS_CAP, elapsed / sectionEstimate);
        remaining += Math.max(0, sectionEstimate - elapsed);
      }
    } else if (section.status === "queued") {
      remaining += sectionEstimate;
    } else if (
      phase === "stopped" &&
      section.status === "not_drafted" &&
      row?.status === "failed" &&
      row.startedAt !== undefined &&
      row.completedAt !== undefined &&
      row.error !== NOT_DRAFTED_AFTER_STOP
    ) {
      // A Section that failed after the stop keeps the share the pill
      // already showed, so the stopped reading never goes backwards.
      partial += Math.min(
        SECTION_PROGRESS_CAP,
        Math.max(0, row.completedAt - row.startedAt) / sectionEstimate
      );
    }
  }
  // The consistency pass runs once every Section is drafted: still ahead
  // while the chain is drafting (not stopping) or a redraft will complete
  // the report.
  const willCheck =
    !consistencyPending &&
    ((phase === "drafting" && !redraftLive && run?.consistencyCheckedAt === undefined) ||
      (redraftLive && sections.every((section) => section.status !== "not_drafted")));
  if (willCheck) remaining += DEFAULT_CONSISTENCY_PASS_MS;

  const percent =
    phase === "completed"
      ? 100
      : Math.min(99, Math.floor(((doneCount + partial) / total) * 100));
  const current = sections.find((section) => section.status === "writing") ?? null;
  const lastDone = [...sections].reverse().find((section) => section.status === "done") ?? null;
  return {
    phase,
    percent,
    estimatedRemainingMs: chainLive ? Math.round(remaining) : null,
    currentSectionKey: current?.key ?? null,
    stoppedAfterSectionKey:
      generation.stoppedAfterSection ??
      (phase === "stopping" ? (current?.key ?? lastDone?.key ?? null) : null),
    sections: sections.map(({ row: _row, ...section }) => section),
    // The latest "Draft the rest" attempt, so the page can show an
    // attempt-scoped failure with a retry; null before the first one.
    redraft: seedRedraftSummary(redraft),
  };
}

/** The fence every redraft write re-checks: the generation is still the
 * completed signed-off seed run, the redraft attempt is the live one, and the
 * project is not being deleted. */
export async function redraftFence(
  ctx: MutationCtx,
  generationId: Id<"generations">,
  candidateRunId: Id<"generationCandidateRuns">,
  attemptStartedAt: number
) {
  const generation = await ctx.db.get(generationId);
  if (
    !generation ||
    generation.status !== "completed" ||
    !isSignedOffSeedGeneration(generation)
  ) {
    return null;
  }
  const redraft = generation.redraft;
  if (
    !redraft ||
    redraft.status !== "running" ||
    redraft.attemptStartedAt !== attemptStartedAt
  ) {
    return null;
  }
  if (await isProjectDeleting(ctx, generation.projectId)) return null;
  const run = await ctx.db.get(candidateRunId);
  if (!run || run.generationId !== generation._id || run.ghost) return null;
  return { generation, redraft, run };
}

export async function reportForGeneration(
  ctx: { db: QueryCtx["db"] },
  generationId: Id<"generations">
) {
  return await ctx.db
    .query("reports")
    .withIndex("by_generationId", (q) => q.eq("generationId", generationId))
    .unique();
}

/** Current report text of a Section, or null when it is empty or still the
 * untouched "Not drafted" placeholder. */
export function presentReportSection(
  sections: ReturnType<typeof extractReportSections> | null,
  section: SectionNumber
): string | null {
  const text = sections?.[sectionKeyOf(section)]?.trim() ?? "";
  return text && text !== NOT_GENERATED_PLACEHOLDER ? text : null;
}

/** Argument validators of generations.redraftMissingSections. */
export const redraftMissingSectionsArgs = { generationId: v.id("generations") };

/** Handler of generations.redraftMissingSections. */
export async function redraftMissingSectionsHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof redraftMissingSectionsArgs>
): Promise<{
    status: "started" | "running" | "nothing_to_draft";
    sections: SectionNumber[];
  }> {
  const generation = await ctx.db.get(args.generationId);
  if (!generation) domainError("NOT_FOUND", "Generation not found");
  const { user, project } = await requireReportEditAccess(ctx, generation.projectId);
  if (!isSignedOffSeedGeneration(generation) || generation.status !== "completed") {
    domainError("INVALID_STATE", "Only a stopped Step-by-step draft can be redrafted", {
      reason: "NOT_STOPPED",
    });
  }
  if (await isProjectDeleting(ctx, project._id)) {
    domainError("INVALID_STATE", "This project is being deleted");
  }
  const now = Date.now();
  const previous = generation.redraft;
  if (previous && isRedraftLive(previous, now)) {
    return { status: "running", sections: previous.sections };
  }
  if (await findActiveGeneration(ctx, project, ACTIVE_GENERATION_STATUSES)) {
    domainError("GENERATION_ACTIVE", "A generation is already active for this project");
  }
  const report = await reportForGeneration(ctx, generation._id);
  if (!report) domainError("INVALID_STATE", "This generation has no report to fill");
  const { run, rows } = await seedChainRows(ctx, generation._id);
  if (!run || rows.length === 0) {
    domainError("INVALID_STATE", "This generation has no Section runs to redraft");
  }
  const placeholders = new Set<string>(notDraftedReportSections(report.content));
  const missing = rows.filter(
    (row) => row.status !== "drafted" && placeholders.has(row.section)
  );
  // Drafted by an earlier attempt that died before writing them: carried
  // into this attempt unchanged, still only into a placeholder body.
  const carried = rows.filter(
    (row) =>
      row.status === "drafted" &&
      (row.draftText ?? "").trim().length > 0 &&
      placeholders.has(row.section)
  );
  if (missing.length === 0 && carried.length === 0) {
    return { status: "nothing_to_draft", sections: [] };
  }
  const summaryVersionId = generation.summaryVersionId as Id<"summaryVersions">;
  const payload = await frozenOrderedPayload(ctx, generation, summaryVersionId);
  const carriedKeys = new Set<string>(carried.map((row) => row.section));
  const sections = rows
    .filter((row) => carriedKeys.has(row.section) || missing.includes(row))
    .map(sectionNumberOfRow);
  const attemptStartedAt = Math.max(now, (previous?.attemptStartedAt ?? 0) + 1);
  for (const [index, row] of missing.entries()) {
    await ctx.db.patch(row._id, {
      status: index === 0 ? "queued" : "pending",
      attempt: row.attempt + 1,
      queuedAt: now,
      draftText: undefined,
      metrics: undefined,
      selfCheck: undefined,
      slotCounts: undefined,
      metricsData: undefined,
      selfCheckData: undefined,
      slotCountsData: undefined,
      error: undefined,
      startedAt: undefined,
      completedAt: undefined,
    });
  }
  await appendGenerationProgress(ctx, generation, [
    `Drafting the Not drafted Sections (${sections.join(", ")}) from the signed-off Summary into the same report.`,
  ]);
  await transitionRedraft(ctx, generation, {
    status: "running",
    attemptStartedAt,
    requestedBy: user._id,
    sections,
    lastProgressAt: now,
  });
  const attempt = { generationId: generation._id, candidateRunId: run._id, attemptStartedAt };
  if (missing.length > 0) {
    // The chain's stored payload (the same frozen inputs), or stored now
    // for a chain signed off before payloads were stored (2026-09-25).
    const payloadId = await persistOrderedPayload(ctx, generation._id, run._id, {
      ...payload,
      summaryVersionId,
    });
    await ctx.scheduler.runAfter(0, internal.ai.orderedGeneration.redraftSeedSection, {
      ...attempt,
      section: sectionNumberOfRow(missing[0]),
      payloadId,
    });
  } else {
    // Every missing Section is already drafted: only the write is left.
    await ctx.scheduler.runAfter(0, internal.ai.orderedGeneration.finalizeSeedRedraft, attempt);
  }
  await ctx.scheduler.runAfter(REDRAFT_STALE_MS, internal.generations.expireStaleRedraft, attempt);
  return { status: "started", sections };
}

/** Argument validators of generations.claimRedraftSection. */
export const claimRedraftSectionArgs = {
  generationId: v.id("generations"),
  candidateRunId: v.id("generationCandidateRuns"),
  attemptStartedAt: v.number(),
  section: sectionNumberValidator,
  promptVersion: v.optional(v.string()),
  payload: v.optional(orderedPayloadValidator),
  payloadId: v.optional(v.id("generationArtifacts")),
};

/** Handler of generations.claimRedraftSection. */
export async function claimRedraftSectionHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof claimRedraftSectionArgs>
) {
  const fence = await redraftFence(
    ctx,
    args.generationId,
    args.candidateRunId,
    args.attemptStartedAt
  );
  if (!fence) return null;
  const row = await orderedRunForSection(ctx, args.candidateRunId, args.section);
  if (!row || row.status !== "queued" || row.generationId !== args.generationId) {
    return null;
  }
  let executionBrief: Awaited<ReturnType<typeof loadBriefCheck>> | undefined;
  if (args.promptVersion && fence.generation.promptVersion !== args.promptVersion) {
    // Capacity belongs to the program that executes the request, exactly as
    // for the chain's own claim. A rejection rolls this claim back.
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
  const now = Date.now();
  await ctx.db.patch(row._id, { status: "running", startedAt: now });
  await transitionRedraft(ctx, fence.generation, { ...fence.redraft, lastProgressAt: now });
  const report = await reportForGeneration(ctx, fence.generation._id);
  const redrafting = new Set<string>(fence.redraft.sections.map(sectionKeyOf));
  const orderIndex = row.orderIndex ?? 0;
  const chainRows = await orderedRunsForCandidate(ctx, fence.run._id);
  // The report as this attempt would leave it, so a Section the writer
  // typed into mid-redraft is read as their text, not the discarded draft.
  const current = prospectiveRedraftSections(report?.content ?? null, chainRows, redrafting);
  const priorSections = chainRows
    .filter((prior) => (prior.orderIndex ?? 0) < orderIndex)
    .flatMap((prior) => {
      const section = sectionNumberOfRow(prior);
      const text =
        presentReportSection(current, section) ??
        (prior.status === "drafted" ? (prior.draftText ?? null) : null);
      return text ? [{ section, text }] : [];
    });
  return await orderedSectionClaim(ctx, {
    generation: fence.generation,
    row,
    section: args.section,
    priorSections,
    executionBrief,
  });
}

/** Argument validators of generations.completeRedraftSection. */
export const completeRedraftSectionArgs = {
  generationId: v.id("generations"),
  candidateRunId: v.id("generationCandidateRuns"),
  attemptStartedAt: v.number(),
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

/** Handler of generations.completeRedraftSection. */
export async function completeRedraftSectionHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof completeRedraftSectionArgs>
): Promise<boolean> {
  requireOrderedPayloadRef(args);
  const fence = await redraftFence(
    ctx,
    args.generationId,
    args.candidateRunId,
    args.attemptStartedAt
  );
  if (!fence) return false;
  const row = await orderedRunForSection(ctx, args.candidateRunId, args.section);
  if (!row || row.status !== "running" || row.generationId !== args.generationId) {
    return false;
  }
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
    `✓ ${fence.run.label}: ${ORDERED_SECTION_TITLES[args.section]} redrafted (${sectionCheckNarration(args.selfCheck)}).`,
  ]);
  await transitionRedraft(ctx, fence.generation, { ...fence.redraft, lastProgressAt: now });
  // The next Section still to draft; a carried Section is already drafted.
  const position = fence.redraft.sections.indexOf(args.section);
  let nextSection: SectionNumber | undefined;
  let next: Doc<"generationSectionRuns"> | null = null;
  for (const candidate of fence.redraft.sections.slice(position + 1)) {
    const candidateRow = await orderedRunForSection(ctx, args.candidateRunId, candidate);
    if (candidateRow?.status === "pending") {
      nextSection = candidate;
      next = candidateRow;
      break;
    }
  }
  if (nextSection && next) {
    await ctx.db.patch(next._id, { status: "queued", queuedAt: now });
    await ctx.scheduler.runAfter(0, internal.ai.orderedGeneration.redraftSeedSection, {
      generationId: args.generationId,
      candidateRunId: args.candidateRunId,
      attemptStartedAt: args.attemptStartedAt,
      section: nextSection,
      ...forwardOrderedPayload(args),
    });
  } else {
    await ctx.scheduler.runAfter(0, internal.ai.orderedGeneration.finalizeSeedRedraft, {
      generationId: args.generationId,
      candidateRunId: args.candidateRunId,
      attemptStartedAt: args.attemptStartedAt,
    });
  }
  return true;
}

/**
 * Write this attempt's redrafted Sections into the report and settle the
 * attempt. The merge reads the report's latest saved content in this same
 * transaction and replaces only bodies that are still the untouched
 * placeholder, so a writer's saved edits are never overwritten.
 */
export async function settleSeedRedraft(
  ctx: MutationCtx,
  fence: NonNullable<Awaited<ReturnType<typeof redraftFence>>>,
  outcome: { failed: false } | { failed: true; error: string }
) {
  const now = Date.now();
  const { generation, redraft, run } = fence;
  const rows = await orderedRunsForCandidate(ctx, run._id);
  const drafts: Partial<Record<"s242" | "s244" | "s246", string>> = {};
  for (const row of rows) {
    if (
      redraft.sections.includes(sectionNumberOfRow(row)) &&
      row.status === "drafted" &&
      row.draftText
    ) {
      drafts[row.section] = row.draftText;
    }
  }
  const report = await reportForGeneration(ctx, generation._id);
  let filled: SectionNumber[] = [];
  let skipped: SectionNumber[] = [];
  let resultingContent = report?.content ?? null;
  if (report && Object.keys(drafts).length > 0) {
    const merged = fillNotDraftedSections(report.content, drafts);
    resultingContent = merged.content;
    filled = merged.filled.map((key) => key.slice(1) as SectionNumber);
    skipped = merged.skipped.map((key) => key.slice(1) as SectionNumber);
    if (merged.filled.length > 0) {
      await writePreEditSnapshot(ctx, report, "pre_chat_edit", { createdAt: now });
      await ctx.db.patch(report._id, {
        content: merged.content,
        contentHash: await sha256(merged.content),
        revisionNumber: (report.revisionNumber ?? 0) + 1,
        // Like any change to the prose, the new revision needs its own
        // provenance review.
        provenanceId: undefined,
        updatedAt: now,
      });
      await persistDeterministicFindings(ctx, report._id);
    }
  }
  // Completion is the report's, not the run rows': a Section the writer
  // filled by hand counts as present, and the rows stay generation history.
  const lastDrafted = [...rows].reverse().find((row) => row.status === "drafted");
  const complete =
    resultingContent !== null
      ? notDraftedReportSections(resultingContent).length === 0
      : rows.every((row) => row.status === "drafted");
  let outputs: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse((await readAgentOutputs(ctx, generation)) ?? "{}");
    if (parsed && typeof parsed === "object") outputs = parsed as Record<string, unknown>;
  } catch {
    /* Rebuild from the Section keys below. */
  }
  for (const section of filled) outputs[`section${section}`] = drafts[sectionKeyOf(section)];
  if (complete) delete outputs.stoppedAfterSection;
  else if (lastDrafted) outputs.stoppedAfterSection = sectionNumberOfRow(lastDrafted);
  // CAP-18: once no Section is Not drafted, QA runs once in the background.
  const scheduleQa = complete && generation.postQaStatus !== "running";
  const postQaStartedAt = Math.max(now, (generation.postQaStartedAt ?? 0) + 1);
  const lines = (sections: SectionNumber[]) =>
    `${sections.length === 1 ? "Line" : "Lines"} ${sections.join(", ")}`;
  const narration = outcome.failed
    ? `✗ The redraft did not finish. ${filled.length ? `${lines(filled)} went into the report; ` : ""}the other Sections stay Not drafted.`
    : `✓ Redrafted ${filled.length ? lines(filled) : "no Section"} into the report${skipped.length ? `. ${lines(skipped)} kept the writer's own text` : ""}.`;
  await appendGenerationProgress(ctx, generation, [
    narration,
    ...(scheduleQa ? ["Running the QA scorecard and chronology in the background…"] : []),
  ]);
  await writeAgentOutputs(ctx, generation, JSON.stringify(outputs));
  await transitionRedraft(ctx, generation, {
    ...redraft,
    status: outcome.failed ? "failed" : "completed",
    lastProgressAt: now,
    completedAt: now,
    filledSections: filled,
    ...(outcome.failed ? { error: outcome.error.slice(0, 500) } : {}),
  }, {
    // stoppedAfterSection is present only while Sections remain Not drafted.
    stoppedAfterSection: complete
      ? undefined
      : lastDrafted
        ? sectionNumberOfRow(lastDrafted)
        : generation.stoppedAfterSection,
    ...(scheduleQa ? { postQaStatus: "running" as const, postQaStartedAt } : {}),
  });
  if (scheduleQa) {
    // CAP-18: the report is complete now, so QA follows in the background.
    await ctx.scheduler.runAfter(0, internal.ai.postQa.runReportQa, {
      generationId: generation._id,
      attemptStartedAt: postQaStartedAt,
    });
  }
  return { filled, skipped };
}

/** Argument validators of generations.failRedraftSection. */
export const failRedraftSectionArgs = {
  generationId: v.id("generations"),
  candidateRunId: v.id("generationCandidateRuns"),
  attemptStartedAt: v.number(),
  section: sectionNumberValidator,
  error: v.string(),
};

/** Handler of generations.failRedraftSection. */
export async function failRedraftSectionHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof failRedraftSectionArgs>
) {
  const fence = await redraftFence(
    ctx,
    args.generationId,
    args.candidateRunId,
    args.attemptStartedAt
  );
  if (!fence) return null;
  await failOpenRedraftRows(ctx, fence, (row) =>
    row.section === sectionKeyOf(args.section)
      ? args.error.slice(0, 500)
      : "Not drafted: an earlier Section failed during the redraft."
  );
  await settleSeedRedraft(ctx, fence, { failed: true, error: args.error });
  return null;
}

/** Mark the attempt's Sections that are not drafted yet as failed. */
export async function failOpenRedraftRows(
  ctx: MutationCtx,
  fence: NonNullable<Awaited<ReturnType<typeof redraftFence>>>,
  errorFor: (row: Doc<"generationSectionRuns">) => string
) {
  const now = Date.now();
  for (const row of await orderedRunsForCandidate(ctx, fence.run._id)) {
    if (!fence.redraft.sections.includes(sectionNumberOfRow(row))) continue;
    if (row.status === "running" || row.status === "queued" || row.status === "pending") {
      await ctx.db.patch(row._id, { status: "failed", error: errorFor(row), completedAt: now });
    }
  }
}

/** Argument validators of generations.expireStaleRedraft. */
export const expireStaleRedraftArgs = {
  generationId: v.id("generations"),
  candidateRunId: v.id("generationCandidateRuns"),
  attemptStartedAt: v.number(),
};

/** Handler of generations.expireStaleRedraft. */
export async function expireStaleRedraftHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof expireStaleRedraftArgs>
) {
  const fence = await redraftFence(
    ctx,
    args.generationId,
    args.candidateRunId,
    args.attemptStartedAt
  );
  if (!fence) return null;
  const idle = Date.now() - fence.redraft.lastProgressAt;
  if (idle < REDRAFT_STALE_MS) {
    await ctx.scheduler.runAfter(
      REDRAFT_STALE_MS - idle,
      internal.generations.expireStaleRedraft,
      args
    );
    return null;
  }
  const error = `${REDRAFT_TIMEOUT_CODE}: the redraft made no progress for ${REDRAFT_STALE_MS / 60_000} minutes.`;
  await failOpenRedraftRows(ctx, fence, () =>
    "Not drafted: the redraft stopped responding."
  );
  await settleSeedRedraft(ctx, fence, { failed: true, error });
  return null;
}

/** The Section text a redraft's consistency pass checks: the document the
 * write will produce, that is the writer's text wherever they typed and this
 * attempt's drafts only where a placeholder remains. applySeedRedraft
 * recomputes it to tell whether the report changed while the pass ran. */
export async function redraftCheckedSections(
  ctx: { db: QueryCtx["db"] },
  generationId: Id<"generations">,
  redraft: NonNullable<Doc<"generations">["redraft"]>,
  candidateRunId: Id<"generationCandidateRuns">
): Promise<Array<{ section: SectionNumber; text: string | null }>> {
  const rows = await orderedRunsForCandidate(ctx, candidateRunId);
  const report = await reportForGeneration(ctx, generationId);
  const redrafting = new Set<string>(redraft.sections.map(sectionKeyOf));
  const current = prospectiveRedraftSections(report?.content ?? null, rows, redrafting);
  return rows.map((row) => {
    const section = sectionNumberOfRow(row);
    return {
      section,
      text: current
        ? presentReportSection(current, section)
        : redrafting.has(row.section) && row.status === "drafted"
          ? (row.draftText ?? null)
          : null,
    };
  });
}

/** Argument validators of generations.getSeedRedraftInput. */
export const getSeedRedraftInputArgs = {
  generationId: v.id("generations"),
  candidateRunId: v.id("generationCandidateRuns"),
  attemptStartedAt: v.number(),
};

/** Handler of generations.getSeedRedraftInput. */
export async function getSeedRedraftInputHandler(
  ctx: QueryCtx,
  args: ObjectType<typeof getSeedRedraftInputArgs>
) {
  const generation = await ctx.db.get(args.generationId);
  const run = await ctx.db.get(args.candidateRunId);
  if (
    !generation ||
    !run ||
    run.generationId !== generation._id ||
    generation.redraft?.status !== "running" ||
    generation.redraft.attemptStartedAt !== args.attemptStartedAt
  ) {
    return null;
  }
  const { brief } = await loadBriefCheck(ctx, generation);
  return {
    model: run.model,
    projectId: generation.projectId,
    requestedBy: generation.requestedBy,
    brief,
    sections: await redraftCheckedSections(ctx, generation._id, generation.redraft, run._id),
  };
}

/** Argument validators of generations.applySeedRedraft. */
export const applySeedRedraftArgs = {
  generationId: v.id("generations"),
  candidateRunId: v.id("generationCandidateRuns"),
  attemptStartedAt: v.number(),
  notes: v.array(complianceNoteDraftValidator),
  checked: v.optional(
    v.array(
      v.object({ section: sectionNumberValidator, text: v.union(v.string(), v.null()) })
    )
  ),
};

/** Handler of generations.applySeedRedraft. */
export async function applySeedRedraftHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof applySeedRedraftArgs>
): Promise<"applied" | "fenced" | "report_changed"> {
  const fence = await redraftFence(
    ctx,
    args.generationId,
    args.candidateRunId,
    args.attemptStartedAt
  );
  if (!fence) return "fenced";
  const checked = args.checked;
  if (checked) {
    const latest = await redraftCheckedSections(
      ctx,
      fence.generation._id,
      fence.redraft,
      fence.run._id
    );
    const unchanged =
      latest.length === checked.length &&
      latest.every(
        (row, index) =>
          row.section === checked[index].section && row.text === checked[index].text
      );
    if (!unchanged) {
      await transitionRedraft(ctx, fence.generation, {
        ...fence.redraft,
        lastProgressAt: Date.now(),
      });
      return "report_changed";
    }
  }
  const owner = {
    projectId: fence.generation.projectId,
    generationId: fence.generation._id,
    candidateRunId: fence.run._id,
  };
  for (const note of args.notes) {
    await ctx.db.insert("complianceNotes", complianceNoteRow(note, owner));
  }
  if (args.notes.length > 0) {
    await ctx.db.patch(fence.run._id, { consistencyCheckedAt: Date.now() });
  }
  await settleSeedRedraft(ctx, fence, { failed: false });
  return "applied";
}
