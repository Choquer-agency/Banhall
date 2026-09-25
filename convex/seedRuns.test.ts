/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import {
  makeFunctionReference,
  type FunctionArgs,
  type FunctionReference,
  type FunctionReturnType,
  type RegisteredMutation,
} from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type {
  claimAttempt,
  completeAttempt,
  dispatch,
  failAttempt,
  settleAttempt,
} from "./seedRuns";
import { PD_SUBSECTIONS, type PdSubsectionRoleId } from "../shared/pdSubsections";
import { emptyContextRevision, emptySelectionRevision } from "./lib/seedRevisions";
import { loadSeedDispatchSnapshot } from "./lib/seedSnapshotLoader";

const modules = import.meta.glob("./**/*.ts");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-18T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

type FunctionReferenceFromExport<Export> =
  Export extends RegisteredMutation<infer Visibility, infer Args, infer ReturnValue>
    ? FunctionReference<"mutation", Visibility, Args, Awaited<ReturnValue>>
    : never;

function mutationRef<Export>(name: string) {
  type Ref = FunctionReferenceFromExport<Export>;
  return makeFunctionReference<
    "mutation",
    FunctionArgs<Ref>,
    FunctionReturnType<Ref>
  >(name);
}

const dispatchRef = mutationRef<typeof dispatch>("seedRuns:dispatch");
const claimRef = mutationRef<typeof claimAttempt>("seedRuns:claimAttempt");
const completeRef = mutationRef<typeof completeAttempt>("seedRuns:completeAttempt");
const failRef = mutationRef<typeof failAttempt>("seedRuns:failAttempt");
const settleRef = mutationRef<typeof settleAttempt>("seedRuns:settleAttempt");

async function fixture() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      authId: "seed-run-writer",
      role: "writer",
    });
    const projectId = await ctx.db.insert("projects", {
      title: "Seed run",
      clientName: "Client",
      ownerId: userId,
      createdBy: userId,
      shareToken: crypto.randomUUID(),
      status: "generating",
      createdAt: 1,
      updatedAt: 1,
    });
    const generationId = await ctx.db.insert("generations", {
      projectId,
      status: "awaiting_input",
      candidateMode: "iterative",
      gatedWorkflow: "seeds",
      startedAt: 1,
      previousProjectStatus: "draft",
      seedStageVersion: 0,
      seedRequestsReserved: 0,
      promptVersion: `sha256:${"a".repeat(64)}`,
      writerSettings: {
        profileState: "missing",
        source: "none",
        matchesProfile: false,
        savedProfileSuperseded: false,
        waiverAnalysis: "none",
        truncated: false,
      },
    });
    await ctx.db.patch(projectId, { activeGenerationId: generationId });
    await ctx.db.insert("generationArtifacts", {
      generationId,
      kind: "analysis",
      content: "{}",
    });
    await ctx.db.insert("generationArtifacts", {
      generationId,
      kind: "brain_blocks",
      content: JSON.stringify({
        blocks: {},
        styleGuidance: "Use direct language.",
        styleOverrides: {},
      }),
    });
    const sourceContent = "Evidence alpha supports the work.";
    const sourceId = await ctx.db.insert("generationSources", {
      generationId,
      projectId,
      kind: "transcript",
      label: "Interview",
      content: sourceContent,
      contentHash: "source-hash",
      truncated: false,
      originalLength: sourceContent.length,
      capturedAt: 1,
    });
    const briefId = await ctx.db.insert("generationBriefs", {
      projectId,
      generationId,
      inputsHash: "brief-inputs",
      version: 1,
      origin: "derived",
      storylineText: "The team investigated a technical uncertainty.",
      createdAt: 1,
    });
    await ctx.db.patch(generationId, { briefId, briefVersionId: briefId });
    const currentContextRevision = await emptyContextRevision();
    const selectionRevision = await emptySelectionRevision();
    const subsectionIds: Partial<
      Record<PdSubsectionRoleId, Id<"seedSubsections">>
    > = {};
    for (const role of PD_SUBSECTIONS) {
      subsectionIds[role.roleId] = await ctx.db.insert("seedSubsections", {
          projectId,
          generationId,
          roleId: role.roleId,
          kind: role.kind,
          state: "untouched",
          currentContextRevision,
          selectionRevision,
          consecutiveFailures: 0,
        });
    }
    return { userId, projectId, generationId, briefId, sourceId, subsectionIds };
  });
  return {
    t,
    ...ids,
    writer: t.withIdentity({ subject: "seed-run-writer" }),
  };
}

const validBatch = [
  {
    bullets: ["The team can test one conservative implementation."],
    tags: ["conservative" as const],
    provenance: [],
  },
  {
    bullets: ["A technical alternative can expose the governing constraint."],
    tags: ["technical" as const],
    provenance: [],
  },
  {
    bullets: ["A detailed trial can compare the competing configurations."],
    tags: ["detailed" as const],
    provenance: [],
  },
];

async function openRole(
  s: Awaited<ReturnType<typeof fixture>>,
  roleId: PdSubsectionRoleId,
  commandId: string = crypto.randomUUID()
) {
  return await s.t.mutation(dispatchRef, {
    generationId: s.generationId,
    roleId,
    operation: "open",
    commandId,
    actorUserId: s.userId,
  });
}

describe("seed attempt transactions", () => {
  it("shares initial identity across prefetch and open", async () => {
    const s = await fixture();
    const prefetched = await s.t.mutation(dispatchRef, {
      generationId: s.generationId,
      roleId: "company_context",
      operation: "prefetch",
      commandId: "prefetch-command",
    });
    const opened = await openRole(s, "company_context", "open-command");
    expect(prefetched.kind).toBe("dispatched");
    if (prefetched.kind !== "dispatched") throw new Error("prefetch was not dispatched");
    expect(opened).toEqual({ kind: "reused", batchId: prefetched.batchId });
    const state = await s.t.run(async (ctx) => ({
      batches: await ctx.db.query("seedBatches").take(2),
      generation: await ctx.db.get(s.generationId),
      events: await ctx.db.query("seedDecisionEvents").take(2),
    }));
    expect(state.batches).toHaveLength(1);
    expect(state.batches[0].roleOpen).toBe(false);
    expect(state.generation?.seedRequestsReserved).toBe(2);
    expect(state.events).toHaveLength(1);
  });

  it("claim returns dispatch-time decision bytes after a later edit", async () => {
    const s = await fixture();
    const selectionId = await s.t.run(async (ctx) => {
      const batchId = await ctx.db.insert("seedBatches", {
        projectId: s.projectId,
        generationId: s.generationId,
        roleId: "company_context",
        operation: "open",
        dedupeKey: "prior",
        commandId: "prior",
        attemptId: "prior",
        consumedContextRevision: await emptyContextRevision(),
        briefVersionId: s.briefId,
        settingsHash: "settings",
        status: "shown",
        queuedAt: 1,
        leaseExpiresAt: 2,
        completedAt: 2,
        model: "model",
        slot: "generation:seeds:company_context",
        promptVersion: "prompt",
        requestsReserved: 2,
        requestsMade: 1,
        settledAt: 2,
      });
      const seedId = await ctx.db.insert("seeds", {
        projectId: s.projectId,
        generationId: s.generationId,
        batchId,
        roleId: "company_context",
        order: 0,
        bullets: ["Original frozen wording."],
        tags: ["technical"],
        support: "writer_asserted",
        originalSupport: "writer_asserted",
      });
      return await ctx.db.insert("seedSelections", {
        projectId: s.projectId,
        generationId: s.generationId,
        seedId,
        roleId: "company_context",
        selected: true,
        selectedAt: 1,
        version: 1,
      });
    });
    const revision = await s.t.run(async (ctx) =>
      (await loadSeedDispatchSnapshot(ctx, {
        generationId: s.generationId,
        roleId: "goal_problem",
      })).contextRevision
    );
    await s.t.run((ctx) =>
      ctx.db.patch(s.subsectionIds.goal_problem!, {
        currentContextRevision: revision,
      })
    );
    const dispatched = await openRole(s, "goal_problem");
    if (dispatched.kind !== "dispatched") throw new Error("attempt was not dispatched");
    await s.t.run((ctx) =>
      ctx.db.patch(selectionId, {
        editedBullets: ["Changed after dispatch."],
        version: 2,
      })
    );
    const claim = await s.t.mutation(claimRef, { batchId: dispatched.batchId });
    expect(claim.kind).toBe("claimed");
    if (claim.kind !== "claimed") return;
    expect(claim.context.items).toContainEqual({
      kind: "selection",
      roleId: "company_context",
      seedId: expect.any(String),
      bullets: ["Original frozen wording."],
    });
  });

  it("completes validated output and settles the unused reservation once", async () => {
    const s = await fixture();
    const dispatched = await openRole(s, "company_context");
    if (dispatched.kind !== "dispatched") throw new Error("attempt was not dispatched");
    const claim = await s.t.mutation(claimRef, { batchId: dispatched.batchId });
    if (claim.kind !== "claimed") throw new Error("attempt was not claimed");
    expect(
      await s.t.mutation(completeRef, {
        batchId: dispatched.batchId,
        attemptId: claim.batch.attemptId,
        requestsMade: 1,
        seeds: validBatch,
        seedsDropped: 0,
      })
    ).toMatchObject({ kind: "completed", seeds: 3 });
    const state = await s.t.run(async (ctx) => ({
      batch: await ctx.db.get(dispatched.batchId),
      generation: await ctx.db.get(s.generationId),
      row: await ctx.db.get(s.subsectionIds.company_context!),
      seeds: await ctx.db
        .query("seeds")
        .withIndex("by_batchId", (q) => q.eq("batchId", dispatched.batchId))
        .take(6),
      events: await ctx.db.query("seedDecisionEvents").take(5),
    }));
    expect(state.batch).toMatchObject({ status: "shown", requestsMade: 1 });
    expect(state.batch?.settledAt).toEqual(expect.any(Number));
    expect(state.generation?.seedRequestsReserved).toBe(1);
    expect(state.row).toMatchObject({
      state: "in_progress",
      shownBatchId: dispatched.batchId,
      consecutiveFailures: 0,
    });
    expect(state.row?.pendingBatchId).toBeUndefined();
    expect(state.seeds).toHaveLength(3);
    expect(JSON.stringify(state.events)).not.toMatch(/bullets|instruction|wording/i);
    expect(
      await s.t.mutation(completeRef, {
        batchId: dispatched.batchId,
        attemptId: claim.batch.attemptId,
        requestsMade: 2,
        seeds: validBatch,
      })
    ).toMatchObject({ kind: "late" });
    const afterLate = await s.t.run((ctx) => ctx.db.get(dispatched.batchId));
    expect(afterLate).toMatchObject({ status: "shown", requestsMade: 1 });
    expect(afterLate?.deliveredLateAt).toEqual(expect.any(Number));
    expect(await openRole(s, "company_context", "reopen-shown")).toEqual({
      kind: "reused",
      batchId: dispatched.batchId,
    });
    expect(await s.t.run((ctx) => ctx.db.query("seedBatches").take(3))).toHaveLength(1);
  });

  it("reads a digested transcript through its digest only, in the transcript's place (cost phase 1)", async () => {
    const s = await fixture();
    const full = "Full transcript text. ".repeat(20);
    const digest = "Condensed transcript.";
    const ids = await s.t.run(async (ctx) => {
      const transcriptId = await ctx.db.insert("transcripts", {
        projectId: s.projectId,
        content: full,
        createdAt: 1,
      });
      const base = {
        generationId: s.generationId,
        projectId: s.projectId,
        truncated: false,
        capturedAt: 1,
      };
      const fullId = await ctx.db.insert("generationSources", {
        ...base, kind: "transcript", label: "Long interview", transcriptId,
        content: full, contentHash: "full-hash", originalLength: full.length,
      });
      const documentId = await ctx.db.insert("generationSources", {
        ...base, kind: "project_document", label: "other:notes.md",
        content: "Notes.", contentHash: "notes-hash", originalLength: 6,
      });
      // Condensing runs after reservation, so the digest row comes last.
      const digestId = await ctx.db.insert("generationSources", {
        ...base, kind: "transcript_digest", label: "Long interview", transcriptId,
        content: digest, contentHash: "digest-hash", originalLength: digest.length,
      });
      return { fullId, documentId, digestId };
    });
    const dispatched = await openRole(s, "company_context");
    if (dispatched.kind !== "dispatched") throw new Error("attempt was not dispatched");
    const claim = await s.t.mutation(claimRef, { batchId: dispatched.batchId });
    if (claim.kind !== "claimed") throw new Error("attempt was not claimed");
    expect(claim.input.sources.map((source) => source._id)).toEqual([
      s.sourceId,
      ids.digestId,
      ids.documentId,
    ]);
    expect(claim.input.sources.some((source) => source.content === full)).toBe(false);
  });

  it("stamps speaker and line on transcript citations from the frozen source", async () => {
    const s = await fixture();
    const transcript = [
      "Interviewer (Dana): What did you build?",
      "",
      "Priya: We run four sites, all refrigerated.",
      "The coastal site failed twice.",
    ].join("\r\n");
    const document = "Scoping notes\nThe pump failed twice.";
    const { transcriptId, documentId } = await s.t.run(async (ctx) => ({
      transcriptId: await ctx.db.insert("generationSources", {
        generationId: s.generationId,
        projectId: s.projectId,
        kind: "transcript",
        label: "Site interview",
        content: transcript,
        contentHash: "transcript-hash",
        truncated: false,
        originalLength: transcript.length,
        capturedAt: 1,
      }),
      documentId: await ctx.db.insert("generationSources", {
        generationId: s.generationId,
        projectId: s.projectId,
        kind: "project_document",
        label: "scoping:notes.docx",
        content: document,
        contentHash: "document-hash",
        truncated: false,
        originalLength: document.length,
        capturedAt: 1,
      }),
    }));
    const citation = (
      sourceId: Id<"generationSources">,
      content: string,
      exactExcerpt: string
    ) => {
      const startOffset = content.indexOf(exactExcerpt);
      return { sourceId, startOffset, endOffset: startOffset + exactExcerpt.length, exactExcerpt };
    };
    const dispatched = await openRole(s, "company_context");
    if (dispatched.kind !== "dispatched") throw new Error("attempt was not dispatched");
    const claim = await s.t.mutation(claimRef, { batchId: dispatched.batchId });
    if (claim.kind !== "claimed") throw new Error("attempt was not claimed");
    const [first, ...rest] = validBatch;
    expect(
      await s.t.mutation(completeRef, {
        batchId: dispatched.batchId,
        attemptId: claim.batch.attemptId,
        requestsMade: 1,
        seeds: [
          {
            ...first,
            provenance: [
              citation(transcriptId, transcript, "The coastal site failed twice."),
              citation(transcriptId, transcript, "What did you build?"),
              citation(documentId, document, "The pump failed twice."),
              citation(s.sourceId, "Evidence alpha supports the work.", "Evidence alpha"),
            ],
          },
          ...rest,
        ],
      })
    ).toMatchObject({ kind: "completed", seeds: 3 });
    const rows = await s.t.run((ctx) => ctx.db.query("seedProvenance").take(10));
    const byExcerpt = new Map(rows.map((row) => [row.exactExcerpt, row]));
    expect(byExcerpt.get("The coastal site failed twice.")).toMatchObject({
      speaker: "Priya",
      line: 4,
    });
    expect(byExcerpt.get("What did you build?")).toMatchObject({ speaker: "Dana", line: 1 });
    // A transcript without speaker labels still gives the line.
    expect(byExcerpt.get("Evidence alpha")).toMatchObject({ line: 1 });
    expect(byExcerpt.get("Evidence alpha")?.speaker).toBeUndefined();
    // Documents carry neither: their extracted lines are not what a reader sees.
    const documentRow = byExcerpt.get("The pump failed twice.");
    expect(documentRow).toBeDefined();
    expect(documentRow?.speaker).toBeUndefined();
    expect(documentRow?.line).toBeUndefined();
  });

  it("deduplicates a command before the changed context and preserves terminal history", async () => {
    const s = await fixture();
    const commandId = "stable-regenerate-command";
    const dispatched = await s.t.mutation(dispatchRef, {
      generationId: s.generationId,
      roleId: "company_context",
      operation: "regenerate",
      commandId,
      actorUserId: s.userId,
    });
    if (dispatched.kind !== "dispatched") throw new Error("attempt was not dispatched");
    const batch = await s.t.run((ctx) => ctx.db.get(dispatched.batchId));
    await s.t.mutation(failRef, {
      batchId: dispatched.batchId,
      attemptId: batch!.attemptId,
      requestsMade: 1,
      errorCode: "PROVIDER_FAILED",
    });
    await s.t.run((ctx) =>
      ctx.db.patch(s.subsectionIds.company_context!, {
        currentContextRevision: "revision-after-command",
      })
    );
    expect(
      await s.t.mutation(dispatchRef, {
        generationId: s.generationId,
        roleId: "company_context",
        operation: "regenerate",
        commandId,
        actorUserId: s.userId,
      })
    ).toEqual({ kind: "reused", batchId: dispatched.batchId });
    await expect(
      s.t.mutation(dispatchRef, {
        generationId: s.generationId,
        roleId: "company_context",
        operation: "feedback",
        commandId,
        actorUserId: s.userId,
      })
    ).rejects.toThrow(/different seed work|INVALID_INPUT/i);
    expect((await s.t.run((ctx) => ctx.db.get(dispatched.batchId)))?.status).toBe("failed");
  });

  it("reuses the newest pending retry even when an older batch has the same initial key", async () => {
    const s = await fixture();
    const initial = await openRole(s, "company_context");
    if (initial.kind !== "dispatched") throw new Error("attempt was not dispatched");
    const firstBatch = await s.t.run((ctx) => ctx.db.get(initial.batchId));
    await s.t.mutation(failRef, {
      batchId: initial.batchId,
      attemptId: firstBatch!.attemptId,
      requestsMade: 1,
      errorCode: "PROVIDER_FAILED",
    });
    const retry = await s.t.mutation(dispatchRef, {
      generationId: s.generationId,
      roleId: "company_context",
      operation: "retry",
      commandId: "retry-first-delivery",
      actorUserId: s.userId,
    });
    if (retry.kind !== "dispatched") throw new Error("retry was not dispatched");
    expect(
      await s.t.mutation(dispatchRef, {
        generationId: s.generationId,
        roleId: "company_context",
        operation: "retry",
        commandId: "retry-redelivery",
        actorUserId: s.userId,
      })
    ).toEqual({ kind: "reused", batchId: retry.batchId });
  });

  it("feedback completion keeps the shown batch and selections while linking to the frozen target", async () => {
    const s = await fixture();
    const setup = await s.t.run(async (ctx) => {
      const shownBatchId = await ctx.db.insert("seedBatches", {
        projectId: s.projectId,
        generationId: s.generationId,
        roleId: "company_context",
        operation: "open",
        dedupeKey: "shown",
        commandId: "shown",
        attemptId: "shown",
        consumedContextRevision: await emptyContextRevision(),
        briefVersionId: s.briefId,
        settingsHash: "settings",
        status: "shown",
        queuedAt: 1,
        leaseExpiresAt: 2,
        completedAt: 2,
        model: "model",
        slot: "generation:seeds:company_context",
        promptVersion: "prompt",
        requestsReserved: 2,
        requestsMade: 1,
        settledAt: 2,
      });
      const targetSeedId = await ctx.db.insert("seeds", {
        projectId: s.projectId,
        generationId: s.generationId,
        batchId: shownBatchId,
        roleId: "company_context",
        order: 0,
        bullets: ["Frozen target wording."],
        tags: ["technical"],
        support: "writer_asserted",
        originalSupport: "writer_asserted",
      });
      const laterTargetSeedId = await ctx.db.insert("seeds", {
        projectId: s.projectId,
        generationId: s.generationId,
        batchId: shownBatchId,
        roleId: "company_context",
        order: 1,
        bullets: ["Different live target."],
        tags: ["detailed"],
        support: "writer_asserted",
        originalSupport: "writer_asserted",
      });
      const selectionId = await ctx.db.insert("seedSelections", {
        projectId: s.projectId,
        generationId: s.generationId,
        seedId: targetSeedId,
        roleId: "company_context",
        selected: true,
        selectedAt: 2,
        version: 1,
      });
      const feedbackRequestId = await ctx.db.insert("seedFeedbackRequests", {
        projectId: s.projectId,
        generationId: s.generationId,
        roleId: "company_context",
        targetSeedId,
        targetWording: ["Frozen target wording."],
        instruction: "Make the distinction clearer.",
        status: "active",
      });
      await ctx.db.patch(s.subsectionIds.company_context!, {
        state: "in_progress",
        shownBatchId,
      });
      return { shownBatchId, targetSeedId, laterTargetSeedId, selectionId, feedbackRequestId };
    });
    const revision = await s.t.run(async (ctx) =>
      (await loadSeedDispatchSnapshot(ctx, {
        generationId: s.generationId,
        roleId: "company_context",
        feedbackRequestId: setup.feedbackRequestId,
      })).contextRevision
    );
    await s.t.run((ctx) =>
      ctx.db.patch(s.subsectionIds.company_context!, { currentContextRevision: revision })
    );
    const dispatched = await s.t.mutation(dispatchRef, {
      generationId: s.generationId,
      roleId: "company_context",
      operation: "feedback",
      commandId: "feedback-command",
      feedbackRequestId: setup.feedbackRequestId,
      actorUserId: s.userId,
    });
    if (dispatched.kind !== "dispatched") throw new Error("feedback was not dispatched");
    const claim = await s.t.mutation(claimRef, { batchId: dispatched.batchId });
    if (claim.kind !== "claimed") throw new Error("feedback was not claimed");
    await s.t.run((ctx) =>
      ctx.db.patch(setup.feedbackRequestId, { targetSeedId: setup.laterTargetSeedId })
    );
    await s.t.mutation(completeRef, {
      batchId: dispatched.batchId,
      attemptId: claim.batch.attemptId,
      requestsMade: 1,
      seeds: [validBatch[0]],
    });
    const state = await s.t.run(async (ctx) => ({
      row: await ctx.db.get(s.subsectionIds.company_context!),
      selection: await ctx.db.get(setup.selectionId),
      revisions: await ctx.db
        .query("seeds")
        .withIndex("by_batchId", (q) => q.eq("batchId", dispatched.batchId))
        .take(4),
    }));
    expect(state.row?.shownBatchId).toBe(setup.shownBatchId);
    expect(state.selection).toMatchObject({ selected: true, seedId: setup.targetSeedId });
    expect(state.revisions).toHaveLength(1);
    expect(state.revisions[0]).toMatchObject({
      revisionOfSeedId: setup.targetSeedId,
      feedbackRequestId: setup.feedbackRequestId,
    });
  });

  it("keeps retry available after three failures and meters each known request", async () => {
    const s = await fixture();
    let batchId: Id<"seedBatches"> | undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result =
        attempt === 0
          ? await openRole(s, "company_context")
          : await s.t.mutation(dispatchRef, {
              generationId: s.generationId,
              roleId: "company_context",
              operation: "retry",
              commandId: `retry-${attempt}`,
              actorUserId: s.userId,
            });
      if (result.kind !== "dispatched") throw new Error("retry was not dispatched");
      batchId = result.batchId;
      const batch = await s.t.run((ctx) => ctx.db.get(result.batchId));
      await s.t.mutation(failRef, {
        batchId: result.batchId,
        attemptId: batch!.attemptId,
        requestsMade: 1,
        errorCode: "PROVIDER_FAILED",
      });
    }
    const failedState = await s.t.run(async (ctx) => ({
      row: await ctx.db.get(s.subsectionIds.company_context!),
      generation: await ctx.db.get(s.generationId),
      batch: batchId ? await ctx.db.get(batchId) : null,
    }));
    expect(failedState.row).toMatchObject({ state: "failed", consecutiveFailures: 3 });
    expect(failedState.generation?.seedRequestsReserved).toBe(3);
    expect(failedState.batch).toMatchObject({ requestsMade: 1, status: "failed" });
    const unlimited = await s.t.mutation(dispatchRef, {
      generationId: s.generationId,
      roleId: "company_context",
      operation: "retry",
      commandId: "retry-unlimited",
      actorUserId: s.userId,
    });
    expect(unlimited.kind).toBe("dispatched");
  });

  it("cancellation terminalizes the pending attempt before clearing ownership", async () => {
    const s = await fixture();
    const dispatched = await openRole(s, "company_context");
    if (dispatched.kind !== "dispatched") throw new Error("attempt was not dispatched");
    await s.writer.mutation(api.generations.cancelIterativeGeneration, {
      generationId: s.generationId,
    });
    const state = await s.t.run(async (ctx) => ({
      batch: await ctx.db.get(dispatched.batchId),
      row: await ctx.db.get(s.subsectionIds.company_context!),
      generation: await ctx.db.get(s.generationId),
      project: await ctx.db.get(s.projectId),
    }));
    expect(state.batch).toMatchObject({
      status: "failed",
      error: "GENERATION_TERMINATED",
      requestsMade: 2,
    });
    expect(state.row?.pendingBatchId).toBeUndefined();
    expect(state.generation?.status).toBe("failed");
    expect(state.project?.activeGenerationId).toBeUndefined();
  });

  it("project deletion raises the barrier and terminalizes an active attempt before purge", async () => {
    const s = await fixture();
    const dispatched = await openRole(s, "company_context");
    if (dispatched.kind !== "dispatched") throw new Error("attempt was not dispatched");
    await s.writer.mutation(api.projects.deleteProject, { projectId: s.projectId });
    const state = await s.t.run(async (ctx) => ({
      batch: await ctx.db.get(dispatched.batchId),
      row: await ctx.db.get(s.subsectionIds.company_context!),
      project: await ctx.db.get(s.projectId),
    }));
    expect(state.project?.deletionStartedAt).toEqual(expect.any(Number));
    expect(state.batch).toMatchObject({ status: "failed", requestsMade: 2 });
    expect(state.row?.pendingBatchId).toBeUndefined();
  });

  it("reaps expired queued attempts in bounded pages with conservative settlement", async () => {
    const s = await fixture();
    const batchIds: Id<"seedBatches">[] = [];
    for (const roleId of ["company_context", "goal_problem", "passive_limitations"] as const) {
      const dispatched = await openRole(s, roleId);
      if (dispatched.kind !== "dispatched") throw new Error("attempt was not dispatched");
      batchIds.push(dispatched.batchId);
      await s.t.run((ctx) => ctx.db.patch(dispatched.batchId, { leaseExpiresAt: 1 }));
    }
    await s.t.mutation(internal.generations.reapSeedBatchPage, {
      status: "queued",
      cutoff: 2,
      pageSize: 2,
    });
    const first = await s.t.run(async (ctx) => ({
      batches: await Promise.all(batchIds.map((id) => ctx.db.get(id))),
      jobs: await ctx.db.system.query("_scheduled_functions").take(20),
    }));
    expect(first.batches.filter((batch) => batch?.status === "failed")).toHaveLength(2);
    expect(first.batches.filter((batch) => batch?.status === "queued")).toHaveLength(1);
    expect(first.jobs.some((job) => job.name.includes("reapSeedBatchPage"))).toBe(true);
    await s.t.mutation(internal.generations.reapSeedBatchPage, {
      status: "queued",
      cutoff: 2,
      pageSize: 2,
    });
    const final = await s.t.run(async (ctx) => ({
      batches: await Promise.all(batchIds.map((id) => ctx.db.get(id))),
      generation: await ctx.db.get(s.generationId),
    }));
    expect(final.batches.every((batch) => batch?.status === "failed")).toBe(true);
    expect(final.batches.every((batch) => batch?.requestsMade === 2)).toBe(true);
    expect(final.generation).toMatchObject({
      status: "awaiting_input",
      seedRequestsReserved: 6,
    });
  });

  it("keeps conservative running-lease settlement when a late actual count arrives", async () => {
    const s = await fixture();
    const dispatched = await openRole(s, "company_context");
    if (dispatched.kind !== "dispatched") throw new Error("attempt was not dispatched");
    const claim = await s.t.mutation(claimRef, { batchId: dispatched.batchId });
    if (claim.kind !== "claimed") throw new Error("attempt was not claimed");
    await s.t.run((ctx) => ctx.db.patch(dispatched.batchId, { leaseExpiresAt: 1 }));
    await s.t.mutation(internal.generations.reapSeedBatchPage, {
      status: "running",
      cutoff: 2,
      pageSize: 1,
    });
    await s.t.mutation(completeRef, {
      batchId: dispatched.batchId,
      attemptId: claim.batch.attemptId,
      requestsMade: 1,
      seeds: validBatch,
    });
    await s.t.mutation(completeRef, {
      batchId: dispatched.batchId,
      attemptId: claim.batch.attemptId,
      requestsMade: 1,
      seeds: validBatch,
    });
    await s.t.mutation(failRef, {
      batchId: dispatched.batchId,
      attemptId: claim.batch.attemptId,
      requestsMade: 1,
      errorCode: "PROVIDER_FAILED",
    });
    const state = await s.t.run(async (ctx) => ({
      batch: await ctx.db.get(dispatched.batchId),
      generation: await ctx.db.get(s.generationId),
      seeds: await ctx.db
        .query("seeds")
        .withIndex("by_batchId", (q) => q.eq("batchId", dispatched.batchId))
        .take(2),
      lateEvents: (await ctx.db.query("seedDecisionEvents").take(20)).filter(
        (event) => event.kind === "batchLate" && event.batchId === dispatched.batchId
      ),
    }));
    expect(state.batch).toMatchObject({
      status: "failed",
      requestsMade: 2,
      error: "LEASE_EXPIRED",
    });
    expect(state.batch?.deliveredLateAt).toEqual(expect.any(Number));
    expect(state.generation?.seedRequestsReserved).toBe(2);
    expect(state.seeds).toEqual([]);
    expect(state.lateEvents).toHaveLength(1);
  });

  it("refuses oversized assembled fixed context before any attempt write", async () => {
    const s = await fixture();
    await s.t.run((ctx) =>
      ctx.db.patch(s.briefId, { storylineText: "x".repeat(610_000) })
    );
    await expect(openRole(s, "company_context", "oversized-context")).rejects.toThrow(
      /prompt limit|INVALID_INPUT/i
    );
    const state = await s.t.run(async (ctx) => ({
      batches: await ctx.db.query("seedBatches").take(1),
      generation: await ctx.db.get(s.generationId),
      jobs: await ctx.db.system.query("_scheduled_functions").take(2),
      row: await ctx.db.get(s.subsectionIds.company_context!),
    }));
    expect(state.batches).toEqual([]);
    expect(state.generation?.seedRequestsReserved).toBe(0);
    expect(state.jobs).toEqual([]);
    expect(state.row).toMatchObject({ state: "untouched" });
    expect(state.row?.pendingBatchId).toBeUndefined();
  });

  it("does not recreate rows when a callback arrives after project purge", async () => {
    const s = await fixture();
    const dispatched = await openRole(s, "company_context");
    if (dispatched.kind !== "dispatched") throw new Error("attempt was not dispatched");
    const batch = await s.t.run((ctx) => ctx.db.get(dispatched.batchId));
    await s.writer.mutation(api.projects.deleteProject, { projectId: s.projectId });
    await s.t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect(await s.t.run((ctx) => ctx.db.get(s.projectId))).toBeNull();
    expect(
      await s.t.mutation(completeRef, {
        batchId: dispatched.batchId,
        attemptId: batch!.attemptId,
        requestsMade: 1,
        seeds: validBatch,
      })
    ).toEqual({ kind: "missing" });
    const rows = await s.t.run(async (ctx) => ({
      batches: await ctx.db
        .query("seedBatches")
        .withIndex("by_projectId", (q) => q.eq("projectId", s.projectId))
        .take(1),
      seeds: await ctx.db
        .query("seeds")
        .withIndex("by_projectId", (q) => q.eq("projectId", s.projectId))
        .take(1),
      events: await ctx.db
        .query("seedDecisionEvents")
        .withIndex("by_projectId", (q) => q.eq("projectId", s.projectId))
        .take(1),
    }));
    expect(rows).toEqual({ batches: [], seeds: [], events: [] });
  });
  it("omits removed Brief guidance and review questions from the frozen claim", async () => {
    const s = await fixture();
    await s.t.run(async ctx => {
      for (const entry of [
        { group: "storyline" as const, text: "Current guidance", change: "unchanged" as const },
        { group: "claimExclusion" as const, text: "Removed guidance", change: "removed" as const },
        { group: "storylineQuestion" as const, text: "Review question", change: "added" as const },
      ]) {
        await ctx.db.insert("generationBriefEntries", {
          ...entry, briefId: s.briefId, projectId: s.projectId,
          sourceId: s.sourceId, sourceContentHash: "source-hash",
          startOffset: 0, endOffset: 8, exactExcerpt: "Evidence", createdAt: 1,
        });
      }
    });
    const dispatched = await openRole(s, "company_context");
    if (dispatched.kind !== "dispatched") throw new Error("not dispatched");
    const claim = await s.t.mutation(claimRef, { batchId: dispatched.batchId });
    if (claim.kind !== "claimed") throw new Error("not claimed");
    expect(claim.input.briefEntries.map(entry => entry.text)).toEqual(["Current guidance"]);
  });

  it("preserves an already settled count when a running attempt completes", async () => {
    const s = await fixture();
    const dispatched = await openRole(s, "company_context");
    if (dispatched.kind !== "dispatched") throw new Error("not dispatched");
    const claim = await s.t.mutation(claimRef, { batchId: dispatched.batchId });
    if (claim.kind !== "claimed") throw new Error("not claimed");
    const identity = { batchId: dispatched.batchId, attemptId: claim.batch.attemptId };
    await s.t.mutation(settleRef, { ...identity, requestsMade: 2 });
    const settledAt = (await s.t.run(ctx => ctx.db.get(dispatched.batchId)))?.settledAt;
    expect(await s.t.mutation(completeRef, { ...identity, requestsMade: 1, seeds: validBatch })).toMatchObject({ kind: "completed" });
    expect(await s.t.run(ctx => ctx.db.get(dispatched.batchId))).toMatchObject({ status: "shown", requestsMade: 2, settledAt });
    expect((await s.t.run(ctx => ctx.db.get(s.generationId)))?.seedRequestsReserved).toBe(2);
  });

  it("refuses a queued claim at its exact lease boundary before the reaper runs", async () => {
    const s = await fixture();
    const dispatched = await openRole(s, "company_context");
    if (dispatched.kind !== "dispatched") throw new Error("not dispatched");
    await s.t.run(ctx => ctx.db.patch(dispatched.batchId, { leaseExpiresAt: Date.now() }));
    expect(await s.t.mutation(claimRef, { batchId: dispatched.batchId })).toEqual({ kind: "not_claimed", reason: "lease_expired" });
    expect(await s.t.run(ctx => ctx.db.get(dispatched.batchId))).toMatchObject({ status: "failed", error: "LEASE_EXPIRED", requestsMade: 2 });
    expect((await s.t.run(ctx => ctx.db.get(s.subsectionIds.company_context!)))?.pendingBatchId).toBeUndefined();
  });

  it.each([0, -1])("records completion at/past expiry (%dms) as late and retains prior shown content", async offset => {
    const s = await fixture();
    const original = await openRole(s, "company_context");
    if (original.kind !== "dispatched") throw new Error("not dispatched");
    const first = await s.t.mutation(claimRef, { batchId: original.batchId });
    if (first.kind !== "claimed") throw new Error("not claimed");
    await s.t.mutation(completeRef, { batchId: original.batchId, attemptId: first.batch.attemptId, requestsMade: 1, seeds: validBatch });
    const dispatched = await s.t.mutation(dispatchRef, {
      generationId: s.generationId, roleId: "company_context", operation: "regenerate", commandId: "lease-regeneration",
    });
    if (dispatched.kind !== "dispatched") throw new Error("not dispatched");
    const claim = await s.t.mutation(claimRef, { batchId: dispatched.batchId });
    if (claim.kind !== "claimed") throw new Error("not claimed");
    await s.t.run(ctx => ctx.db.patch(dispatched.batchId, { leaseExpiresAt: Date.now() + offset }));
    const completion = { batchId: dispatched.batchId, attemptId: claim.batch.attemptId, requestsMade: 1, seeds: validBatch };
    expect(await s.t.mutation(completeRef, completion)).toEqual({ kind: "late" });
    expect(await s.t.mutation(completeRef, completion)).toEqual({ kind: "late" });
    expect(await s.t.run(ctx => ctx.db.get(dispatched.batchId))).toMatchObject({ status: "failed", error: "LEASE_EXPIRED", requestsMade: 1, deliveredLateAt: expect.any(Number) });
    const seeds = await s.t.run(ctx => ctx.db.query("seeds").collect());
    expect(seeds).toHaveLength(3);
    expect(seeds.every(seed => seed.batchId === original.batchId)).toBe(true);
    const row = await s.t.run(ctx => ctx.db.get(s.subsectionIds.company_context!));
    expect(row?.pendingBatchId).toBeUndefined();
    expect(row).toMatchObject({ state: "in_progress", shownBatchId: original.batchId });
    expect((await s.t.run(ctx => ctx.db.query("seedDecisionEvents").collect())).filter(event => event.kind === "batchLate")).toHaveLength(1);
    expect((await s.t.run(ctx => ctx.db.get(s.generationId)))?.status).toBe("awaiting_input");
  });

  it("can claim and complete immediately before the lease expires", async () => {
    const s = await fixture();
    const dispatched = await openRole(s, "company_context");
    if (dispatched.kind !== "dispatched") throw new Error("not dispatched");
    await s.t.run(ctx => ctx.db.patch(dispatched.batchId, { leaseExpiresAt: Date.now() + 1 }));
    const claim = await s.t.mutation(claimRef, { batchId: dispatched.batchId });
    if (claim.kind !== "claimed") throw new Error("not claimed");
    expect(await s.t.mutation(completeRef, { batchId: dispatched.batchId, attemptId: claim.batch.attemptId, requestsMade: 1, seeds: validBatch })).toMatchObject({ kind: "completed" });
  });

  it.each([
    { kind: "row", count: 1, text: "x".repeat(64_000) },
    { kind: "snapshot", count: 9, text: "x".repeat(60_000) },
    { kind: "rows", count: 129, text: "Short decision." },
  ])("reports database-backed $kind overflow as role-specific INVALID_INPUT without dispatch writes", async ({ count, text }) => {
    const s = await fixture();
    const original = await openRole(s, "company_context");
    if (original.kind !== "dispatched") throw new Error("not dispatched");
    await s.t.run(async ctx => {
      for (let index = 0; index < count; index += 1) {
        const seedId = await ctx.db.insert("seeds", {
          projectId: s.projectId, generationId: s.generationId, batchId: original.batchId,
          roleId: "company_context", order: index, bullets: ["Original decision."],
          tags: ["technical"], support: "writer_asserted", originalSupport: "writer_asserted",
        });
        await ctx.db.insert("seedSelections", {
          projectId: s.projectId, generationId: s.generationId, roleId: "company_context",
          seedId, selected: true, selectedAt: 1, version: 1, editedBullets: [text],
        });
      }
    });
    const before = await s.t.run(async ctx => ({
      batches: await ctx.db.query("seedBatches").collect(),
      jobs: await ctx.db.system.query("_scheduled_functions").collect(),
      generation: await ctx.db.get(s.generationId),
    }));
    await expect(openRole(s, "goal_problem")).rejects.toMatchObject({
      data: { code: "INVALID_INPUT", message: expect.stringContaining("goal_problem") },
    });
    const after = await s.t.run(async ctx => ({
      batches: await ctx.db.query("seedBatches").collect(),
      jobs: await ctx.db.system.query("_scheduled_functions").collect(),
      generation: await ctx.db.get(s.generationId),
    }));
    expect(after).toEqual(before);
  });

  it("translates combined selection and feedback row overflow before writing a successor attempt", async () => {
    const s = await fixture();
    const original = await openRole(s, "company_context");
    if (original.kind !== "dispatched") throw new Error("not dispatched");
    await s.t.run(async ctx => {
      for (let index = 0; index < 65; index += 1) {
        const seedId = await ctx.db.insert("seeds", {
          projectId: s.projectId, generationId: s.generationId, batchId: original.batchId,
          roleId: "company_context", order: index, bullets: ["Frozen wording."],
          tags: ["technical"], support: "writer_asserted", originalSupport: "writer_asserted",
        });
        await ctx.db.insert("seedSelections", {
          projectId: s.projectId, generationId: s.generationId, roleId: "company_context",
          seedId, selected: true, selectedAt: 1, version: 1,
        });
        await ctx.db.insert("seedFeedbackRequests", {
          projectId: s.projectId, generationId: s.generationId, roleId: "company_context",
          targetSeedId: seedId, targetWording: ["Frozen wording."], instruction: "Use detail.", status: "active",
        });
      }
    });
    const before = await s.t.run(async ctx => ({
      batches: await ctx.db.query("seedBatches").collect(),
      jobs: await ctx.db.system.query("_scheduled_functions").collect(),
      generation: await ctx.db.get(s.generationId),
      row: await ctx.db.get(s.subsectionIds.goal_problem!),
    }));
    await expect(openRole(s, "goal_problem")).rejects.toMatchObject({
      data: { code: "INVALID_INPUT", message: expect.stringContaining("goal_problem") },
    });
    const after = await s.t.run(async ctx => ({
      batches: await ctx.db.query("seedBatches").collect(),
      jobs: await ctx.db.system.query("_scheduled_functions").collect(),
      generation: await ctx.db.get(s.generationId),
      row: await ctx.db.get(s.subsectionIds.goal_problem!),
    }));
    expect(after).toEqual(before);
  });

});
