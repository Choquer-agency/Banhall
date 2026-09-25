/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import { api } from "../_generated/api";
import schema from "../schema";
import { loadSeedDispatchSnapshot } from "../lib/seedSnapshotLoader";
import { emptySelectionRevision } from "../lib/seedRevisions";
import type { PdSubsectionRoleId } from "../../shared/pdSubsections";
import { SEED_PROMPT_PROGRAM } from "./promptDefinitions";
import { seedToolSchema } from "../lib/seedContract";
import { seedRepairSummary } from "./seeds";

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, load]) => [
    path.startsWith("./") ? `../ai/${path.slice(2)}` : path,
    load,
  ])
);
const model = "claude-opus-4-8";
const generateBatchRef = makeFunctionReference<
  "action",
  { batchId: Id<"seedBatches"> },
  null
>("ai/seeds:generateBatch");
type DispatchResult =
  | { kind: "dispatched"; batchId: Id<"seedBatches"> }
  | { kind: "reused" | "history"; batchId: Id<"seedBatches"> }
  | { kind: "not_dispatched"; reason: "prefetch_ineligible" };
const dispatchRef = makeFunctionReference<
  "mutation",
  {
    generationId: Id<"generations">;
    roleId: PdSubsectionRoleId;
    operation: "open" | "prefetch" | "retry" | "regenerate" | "feedback";
    commandId: string;
    feedbackRequestId?: Id<"seedFeedbackRequests">;
    actorUserId?: Id<"users">;
  },
  DispatchResult
>("seedRuns:dispatch");
const claimAttemptRef = makeFunctionReference<
  "mutation",
  { batchId: Id<"seedBatches"> },
  | { kind: "not_claimed"; reason: string }
  | { kind: "claimed"; batch: { attemptId: string } }
>("seedRuns:claimAttempt");
const completeAttemptRef = makeFunctionReference<
  "mutation",
  {
    batchId: Id<"seedBatches">;
    attemptId: string;
    requestsMade: number;
    seeds: Array<{
      bullets: string[];
      tags: ProviderSeed["tags"];
      provenance: Array<{
        sourceId: Id<"generationSources">;
        startOffset: number;
        endOffset: number;
        exactExcerpt: string;
      }>;
      uncertaintySeedId?: Id<"seeds">;
      experimentSeedIds?: Id<"seeds">[];
    }>;
    seedsDropped?: number;
  },
  { kind: "completed"; seeds: number } | { kind: "failed" | "late" | "missing" }
>("seedRuns:completeAttempt");

type ProviderSeed = {
  bullets: string[];
  tags: Array<
    | "conservative"
    | "aggressive"
    | "high_level"
    | "detailed"
    | "technical"
    | "alternative_angle"
  >;
  provenance: [];
  uncertaintySeedId?: string;
  experimentSeedIds?: string[];
};

const validSeeds: ProviderSeed[] = [
  {
    bullets: ["The team needed to determine whether the control loop remained stable under peak load."],
    tags: ["conservative"],
    provenance: [],
  },
  {
    bullets: ["Peak-load response could not be predicted using the available controller model."],
    tags: ["technical"],
    provenance: [],
  },
  {
    bullets: ["The unresolved response created a measurable control-system uncertainty."],
    tags: ["detailed"],
    provenance: [],
  },
];

function requestText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((block) =>
      typeof block === "object" &&
      block !== null &&
      "type" in block &&
      block.type === "text" &&
      "text" in block &&
      typeof block.text === "string"
        ? block.text
        : ""
    )
    .join("");
}

function providerResponse(input: unknown, request: number): Response {
  return Response.json(
    {
      id: `msg_seed_${request}`,
      type: "message",
      role: "assistant",
      model,
      content: [
        {
          type: "tool_use",
          id: `tool_seed_${request}`,
          name: SEED_PROMPT_PROGRAM.request.toolName,
          input,
        },
      ],
      stop_reason: "tool_use",
      stop_sequence: null,
      usage: {
        input_tokens: 100,
        output_tokens: 40,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
    { headers: { "request-id": `req_seed_${request}` } }
  );
}

async function seedAttempt(
  t: ReturnType<typeof convexTest>,
  selectedModel = model
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      authId: "seed-action-writer",
      role: "writer",
    });
    const projectId = await ctx.db.insert("projects", {
      title: "Seed action boundary",
      clientName: "Client",
      status: "generating",
      createdBy: userId,
      shareToken: "seed-action-boundary-token",
      createdAt: now,
      updatedAt: now,
    });
    const generationId = await ctx.db.insert("generations", {
      projectId,
      status: "awaiting_input",
      gatedWorkflow: "seeds",
      seedStageVersion: 0,
      seedRequestsReserved: 2,
      lengthTarget: "standard",
      startedAt: now,
      previousProjectStatus: "draft",
    });
    await ctx.db.patch(projectId, { activeGenerationId: generationId });
    const sourceText =
      "The controller became unstable at peak load and the available model could not predict its response.";
    await ctx.db.insert("generationSources", {
      generationId,
      projectId,
      kind: "transcript",
      label: "Frozen interview",
      content: sourceText,
      contentHash: "sha256:frozen-interview",
      truncated: false,
      originalLength: sourceText.length,
      capturedAt: now,
    });
    const briefId = await ctx.db.insert("generationBriefs", {
      projectId,
      generationId,
      inputsHash: "seed-inputs-hash",
      version: 1,
      origin: "derived",
      storylineText: "The team investigated peak-load controller stability.",
      createdAt: now,
    });
    await ctx.db.patch(generationId, { briefVersionId: briefId });
    await ctx.db.insert("generationArtifacts", {
      generationId,
      kind: "brain_blocks",
      content: JSON.stringify({
        styleGuidance: "Frozen writer guidance.",
        styleOverrides: { bannedWords: false },
      }),
    });
    const subsectionId = await ctx.db.insert("seedSubsections", {
      projectId,
      generationId,
      roleId: "active_uncertainties",
      kind: "standard",
      state: "generating",
      currentContextRevision: "context-r0",
      selectionRevision: "selection-r0",
      priorState: "untouched",
      consecutiveFailures: 0,
    });
    const batchId = await ctx.db.insert("seedBatches", {
      projectId,
      generationId,
      roleId: "active_uncertainties",
      operation: "open",
      dedupeKey: "seed-action-dedupe",
      commandId: "seed-action-command",
      attemptId: "seed-action-attempt",
      consumedContextRevision: "context-r0",
      briefVersionId: briefId,
      settingsHash: "settings-hash",
      status: "queued",
      queuedAt: now,
      leaseExpiresAt: now + 600_000,
      model: selectedModel,
      slot: "generation:seeds:active_uncertainties",
      promptVersion: "prompt-version",
      roleOpen: true,
      requestsReserved: 2,
    });
    await ctx.db.patch(subsectionId, { pendingBatchId: batchId });
    return { batchId, generationId, projectId };
  });
}

type PriorDecision = {
  roleId: PdSubsectionRoleId;
  bullets: string[];
  selected?: boolean;
};

async function dispatchedAttempt(
  t: ReturnType<typeof convexTest>,
  args: {
    targetRoleId: PdSubsectionRoleId;
    decisions: PriorDecision[];
  }
) {
  const fixture = await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      authId: `seed-dispatch-${args.targetRoleId}`,
      role: "writer",
    });
    const projectId = await ctx.db.insert("projects", {
      title: "Frozen dispatch boundary",
      clientName: "Client",
      status: "generating",
      createdBy: userId,
      shareToken: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    });
    const generationId = await ctx.db.insert("generations", {
      projectId,
      status: "awaiting_input",
      gatedWorkflow: "seeds",
      seedStageVersion: 0,
      seedRequestsReserved: 0,
      singleModelId: model,
      lengthTarget: "standard",
      promptVersion: "seed-action-review",
      startedAt: now,
      previousProjectStatus: "draft",
    });
    await ctx.db.patch(projectId, { activeGenerationId: generationId });
    const sourceText = "Frozen dispatch evidence remained stable.";
    const sourceId = await ctx.db.insert("generationSources", {
      generationId,
      projectId,
      kind: "transcript",
      label: "Frozen dispatch source",
      content: sourceText,
      contentHash: "sha256:frozen-dispatch-source",
      truncated: false,
      originalLength: sourceText.length,
      capturedAt: now,
    });
    const briefId = await ctx.db.insert("generationBriefs", {
      projectId,
      generationId,
      inputsHash: "frozen-dispatch-inputs",
      version: 1,
      origin: "derived",
      storylineText: "The frozen Brief for the dispatched attempt.",
      createdAt: now,
    });
    await ctx.db.patch(generationId, { briefVersionId: briefId });
    const briefEntryBase = {
      briefId,
      projectId,
      sourceId,
      sourceContentHash: "sha256:frozen-dispatch-source",
      startOffset: 0,
      endOffset: sourceText.length,
      exactExcerpt: sourceText,
      createdAt: now,
    } as const;
    const activeBriefEntryId = await ctx.db.insert("generationBriefEntries", {
      ...briefEntryBase,
      group: "storyline",
      text: "ACTIVE BRIEF GUIDANCE FOR THE SEED REQUEST",
      change: "unchanged",
    });
    const removedBriefEntryId = await ctx.db.insert("generationBriefEntries", {
      ...briefEntryBase,
      group: "claimExclusion",
      text: "REMOVED BRIEF GUIDANCE MUST STAY OUT",
      reason: "routine_engineering",
      change: "removed",
    });
    const questionBriefEntryId = await ctx.db.insert("generationBriefEntries", {
      ...briefEntryBase,
      group: "storylineQuestion",
      text: "STORYLINE QUESTION MUST STAY OUT",
      question: { questionText: "Should this become guidance?" },
      change: "unchanged",
    });
    await ctx.db.insert("generationArtifacts", {
      generationId,
      kind: "brain_blocks",
      content: JSON.stringify({
        styleGuidance: "Frozen dispatch style.",
        styleOverrides: {},
      }),
    });
    const subsectionId = await ctx.db.insert("seedSubsections", {
      projectId,
      generationId,
      roleId: args.targetRoleId,
      kind: args.targetRoleId === "specific_advancements" ? "multiple" : "standard",
      state: "untouched",
      currentContextRevision: "pending",
      selectionRevision: await emptySelectionRevision(),
      priorState: "untouched",
      consecutiveFailures: 0,
    });
    const decisions: Array<{
      seedId: Id<"seeds">;
      selectionId: Id<"seedSelections">;
      roleId: PdSubsectionRoleId;
      bullets: string[];
      selected: boolean;
    }> = [];
    for (const [index, decision] of args.decisions.entries()) {
      const priorBatchId = await ctx.db.insert("seedBatches", {
        projectId,
        generationId,
        roleId: decision.roleId,
        operation: "open",
        dedupeKey: `prior-${index}`,
        commandId: `prior-${index}`,
        attemptId: `prior-${index}`,
        consumedContextRevision: "prior",
        briefVersionId: briefId,
        settingsHash: "prior-settings",
        status: "shown",
        queuedAt: now,
        leaseExpiresAt: now + 1,
        completedAt: now,
        model,
        slot: `generation:seeds:${decision.roleId}`,
        promptVersion: "prior-prompt",
        requestsReserved: 2,
        requestsMade: 1,
        settledAt: now,
      });
      const seedId = await ctx.db.insert("seeds", {
        projectId,
        generationId,
        batchId: priorBatchId,
        roleId: decision.roleId,
        order: index,
        bullets: decision.bullets,
        tags: ["technical"],
        support: "writer_asserted",
        originalSupport: "writer_asserted",
      });
      const selected = decision.selected ?? true;
      const selectionId = await ctx.db.insert("seedSelections", {
        projectId,
        generationId,
        seedId,
        roleId: decision.roleId,
        selected,
        selectedAt: now,
        version: 1,
      });
      decisions.push({
        seedId,
        selectionId,
        roleId: decision.roleId,
        bullets: decision.bullets,
        selected,
      });
    }
    const loaded = await loadSeedDispatchSnapshot(ctx, {
      generationId,
      roleId: args.targetRoleId,
    });
    await ctx.db.patch(subsectionId, {
      currentContextRevision: loaded.contextRevision,
    });
    return {
      userId,
      projectId,
      generationId,
      subsectionId,
      decisions,
      dispatchedRevision: loaded.contextRevision,
      briefEntryIds: [
        activeBriefEntryId,
        removedBriefEntryId,
        questionBriefEntryId,
      ],
      briefEntriesBefore: await Promise.all([
        ctx.db.get(activeBriefEntryId),
        ctx.db.get(removedBriefEntryId),
        ctx.db.get(questionBriefEntryId),
      ]),
    };
  });
  const dispatched = await t.mutation(dispatchRef, {
    generationId: fixture.generationId,
    roleId: args.targetRoleId,
    operation: "open",
    commandId: `dispatch-${args.targetRoleId}-${crypto.randomUUID()}`,
    actorUserId: fixture.userId,
  });
  if (dispatched.kind !== "dispatched") {
    throw new Error(`Seed attempt was not dispatched: ${dispatched.kind}`);
  }
  return { ...fixture, batchId: dispatched.batchId };
}

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-seed-sdk-key");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("seed Node action request boundary", () => {
  it("claims frozen inputs and completes after one real SDK transport request", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedAttempt(t);
    const requests: Request[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        requests.push(new Request(input, init));
        return providerResponse({ seeds: validSeeds }, 1);
      })
    );

    await t.action(generateBatchRef, { batchId: fixture.batchId });

    expect(requests).toHaveLength(1);
    const body = await requests[0]?.json();
    expect(body).toMatchObject({
      model,
      max_tokens: 4000,
      tool_choice: { type: "tool", name: SEED_PROMPT_PROGRAM.request.toolName },
    });
    const system = requestText(body.system);
    const user = requestText(body.messages[0].content);
    // Cost phase 1: the role-independent schema, so every role shares the
    // cached tools prefix.
    expect(body.tools[0].input_schema).toEqual(seedToolSchema());
    expect(system).toContain("Return only the forced tool object");
    expect(system).not.toContain("The controller became unstable");
    expect(user).toContain("The controller became unstable");
    expect(user).not.toContain("context-r0");

    const batch = await t.run((ctx) => ctx.db.get(fixture.batchId));
    expect(batch).toMatchObject({ status: "shown", requestsMade: 1, settledAt: expect.any(Number) });
    const seeds = await t.run((ctx) =>
      ctx.db
        .query("seeds")
        .withIndex("by_batchId", (q) => q.eq("batchId", fixture.batchId))
        .collect()
    );
    expect(seeds).toHaveLength(3);
  });

  it("keeps an original-transcript citation source_supported in digest mode (cost phase 1)", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedAttempt(t);
    const excerpt = "The controller became unstable at peak load";
    const { transcriptSourceId } = await t.run(async (ctx) => {
      const transcriptSource = (await ctx.db
        .query("generationSources")
        .withIndex("by_generationId", (q) => q.eq("generationId", fixture.generationId))
        .collect()).find((row) => row.kind === "transcript")!;
      const transcriptId = await ctx.db.insert("transcripts", {
        projectId: fixture.projectId,
        content: transcriptSource.content,
        createdAt: 1,
      });
      await ctx.db.patch(transcriptSource._id, { transcriptId });
      await ctx.db.insert("generationSources", {
        generationId: fixture.generationId,
        projectId: fixture.projectId,
        kind: "transcript_digest",
        label: "Frozen interview",
        transcriptId,
        content: "DIGEST: controller unstable at peak load.",
        contentHash: "sha256:digest",
        truncated: false,
        originalLength: 41,
        capturedAt: 1,
      });
      return { transcriptSourceId: transcriptSource._id };
    });
    const citedSeeds = validSeeds.map((seed, index) =>
      index === 0
        ? {
            ...seed,
            // A citation reused from a Brief entry, which cites the original
            // transcript rather than its digest.
            provenance: [{
              sourceId: transcriptSourceId,
              startOffset: 0,
              endOffset: excerpt.length,
              exactExcerpt: excerpt,
            }],
          }
        : seed
    );
    const requests: Request[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        requests.push(new Request(input, init));
        return providerResponse({ seeds: citedSeeds }, 1);
      })
    );

    await t.action(generateBatchRef, { batchId: fixture.batchId });

    const body = await requests[0]!.json();
    const user = requestText(body.messages[0].content);
    // The prompt reads the digest only...
    expect(user).toContain("DIGEST: controller unstable at peak load.");
    expect(user).not.toContain("the available model could not predict");
    // ...while validation still knows the original transcript.
    const seeds = await t.run((ctx) =>
      ctx.db
        .query("seeds")
        .withIndex("by_batchId", (q) => q.eq("batchId", fixture.batchId))
        .collect()
    );
    const cited = seeds.find((seed) => seed.bullets[0] === citedSeeds[0].bullets[0]);
    expect(cited).toMatchObject({ support: "source_supported" });
  });

  it("sends the dispatch-time predecessor wording after the live selection is edited", async () => {
    const t = convexTest(schema, modules);
    const original = "Original predecessor decision frozen at dispatch.";
    const changed = "Later live edit that must not enter the request.";
    const fixture = await dispatchedAttempt(t, {
      targetRoleId: "goal_problem",
      decisions: [{ roleId: "company_context", bullets: [original] }],
    });
    const liveRevision = await t.run(async (ctx) => {
      await ctx.db.patch(fixture.decisions[0]!.selectionId, {
        editedBullets: [changed],
        editedAt: Date.now(),
        version: 2,
      });
      const live = await loadSeedDispatchSnapshot(ctx, {
        generationId: fixture.generationId,
        roleId: "goal_problem",
      });
      await ctx.db.patch(fixture.subsectionId, {
        currentContextRevision: live.contextRevision,
      });
      return live.contextRevision;
    });
    expect(liveRevision).not.toBe(fixture.dispatchedRevision);
    const requests: Request[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        requests.push(new Request(input, init));
        return providerResponse({ seeds: validSeeds }, requests.length);
      })
    );

    await t.action(generateBatchRef, { batchId: fixture.batchId });

    expect(requests).toHaveLength(1);
    const body = await requests[0]!.json();
    const user = requestText(body.messages[0].content);
    expect(user).toContain(original);
    expect(user).not.toContain(changed);
    expect(user).toContain("ACTIVE BRIEF GUIDANCE FOR THE SEED REQUEST");
    expect(user).not.toContain("REMOVED BRIEF GUIDANCE MUST STAY OUT");
    expect(user).not.toContain("STORYLINE QUESTION MUST STAY OUT");
    const after = await t.run(async (ctx) => ({
      batch: await ctx.db.get(fixture.batchId),
      subsection: await ctx.db.get(fixture.subsectionId),
      briefEntries: await Promise.all(
        fixture.briefEntryIds.map((entryId) => ctx.db.get(entryId))
      ),
    }));
    expect(after.batch).toMatchObject({
      status: "shown",
      consumedContextRevision: fixture.dispatchedRevision,
    });
    expect(after.subsection?.currentContextRevision).toBe(liveRevision);
    expect(after.briefEntries).toEqual(fixture.briefEntriesBefore);
  });

  it("persists role 11 links from the frozen snapshot after live deselection", async () => {
    const t = convexTest(schema, modules);
    const fixture = await dispatchedAttempt(t, {
      targetRoleId: "specific_advancements",
      decisions: [
        {
          roleId: "active_uncertainties",
          bullets: ["Frozen uncertainty selection."],
        },
        {
          roleId: "experimentation",
          bullets: ["Frozen experiment selection."],
        },
      ],
    });
    const uncertainty = fixture.decisions[0]!;
    const experiment = fixture.decisions[1]!;
    await t.run(async (ctx) => {
      await ctx.db.patch(uncertainty.selectionId, {
        selected: false,
        version: 2,
      });
      await ctx.db.patch(experiment.selectionId, {
        selected: false,
        version: 2,
      });
    });
    const linkedSeeds: ProviderSeed[] = validSeeds.map((seed) => ({
      ...seed,
      uncertaintySeedId: uncertainty.seedId,
      experimentSeedIds: [experiment.seedId],
    }));
    const transport = vi.fn<typeof fetch>(async () =>
      providerResponse({ seeds: linkedSeeds }, 1)
    );
    vi.stubGlobal("fetch", transport);

    await t.action(generateBatchRef, { batchId: fixture.batchId });

    expect(transport).toHaveBeenCalledTimes(1);
    const persisted = await t.run((ctx) =>
      ctx.db
        .query("seeds")
        .withIndex("by_batchId", (q) => q.eq("batchId", fixture.batchId))
        .collect()
    );
    expect(persisted).toHaveLength(3);
    for (const seed of persisted) {
      expect(seed).toMatchObject({
        uncertaintySeedId: uncertainty.seedId,
        experimentSeedIds: [experiment.seedId],
      });
    }
    expect(await t.run((ctx) => ctx.db.get(fixture.batchId))).toMatchObject({
      status: "shown",
      requestsMade: 1,
      consumedContextRevision: fixture.dispatchedRevision,
    });
  });

  it("repairs then rejects role 11 links outside the frozen snapshot", async () => {
    const t = convexTest(schema, modules);
    const fixture = await dispatchedAttempt(t, {
      targetRoleId: "specific_advancements",
      decisions: [
        {
          roleId: "active_uncertainties",
          bullets: ["Frozen uncertainty selection."],
        },
        {
          roleId: "experimentation",
          bullets: ["Frozen experiment selection."],
        },
        {
          roleId: "experimentation",
          bullets: ["Experiment outside the frozen selected set."],
          selected: false,
        },
      ],
    });
    const invalidSeeds: ProviderSeed[] = validSeeds.map((seed) => ({
      ...seed,
      uncertaintySeedId: fixture.decisions[0]!.seedId,
      experimentSeedIds: [fixture.decisions[2]!.seedId],
    }));
    const transport = vi.fn<typeof fetch>(async () =>
      providerResponse({ seeds: invalidSeeds }, 1)
    );
    vi.stubGlobal("fetch", transport);

    await t.action(generateBatchRef, { batchId: fixture.batchId });

    expect(transport).toHaveBeenCalledTimes(2);
    expect(await t.run((ctx) => ctx.db.get(fixture.batchId))).toMatchObject({
      status: "failed",
      error: "INVALID_OUTPUT",
      requestsMade: 2,
    });
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("seeds")
          .withIndex("by_batchId", (q) => q.eq("batchId", fixture.batchId))
          .collect()
      )
    ).toEqual([]);
  });

  it("rejects an outside-snapshot role 11 link at direct completion", async () => {
    const t = convexTest(schema, modules);
    const fixture = await dispatchedAttempt(t, {
      targetRoleId: "specific_advancements",
      decisions: [
        {
          roleId: "active_uncertainties",
          bullets: ["Frozen uncertainty selection."],
        },
        {
          roleId: "experimentation",
          bullets: ["Frozen experiment selection."],
        },
        {
          roleId: "experimentation",
          bullets: ["Well-formed experiment outside the frozen snapshot."],
          selected: false,
        },
      ],
    });
    const claim = await t.mutation(claimAttemptRef, {
      batchId: fixture.batchId,
    });
    if (claim.kind !== "claimed") {
      throw new Error(`Seed attempt was not claimed: ${claim.reason}`);
    }
    const result = await t.mutation(completeAttemptRef, {
      batchId: fixture.batchId,
      attemptId: claim.batch.attemptId,
      requestsMade: 1,
      seeds: validSeeds.map((seed) => ({
        ...seed,
        uncertaintySeedId: fixture.decisions[0]!.seedId,
        experimentSeedIds: [fixture.decisions[2]!.seedId],
      })),
      seedsDropped: 0,
    });

    expect(result).toEqual({ kind: "failed" });
    expect(await t.run((ctx) => ctx.db.get(fixture.batchId))).toMatchObject({
      status: "failed",
      error: "INVALID_OUTPUT",
      requestsMade: 1,
    });
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("seeds")
          .withIndex("by_batchId", (q) => q.eq("batchId", fixture.batchId))
          .collect()
      )
    ).toEqual([]);
  });

  it("accepts unlinked role 11 output when the frozen snapshot has no experiments", async () => {
    const t = convexTest(schema, modules);
    const fixture = await dispatchedAttempt(t, {
      targetRoleId: "specific_advancements",
      decisions: [
        {
          roleId: "active_uncertainties",
          bullets: ["Frozen uncertainty without a selected experiment."],
        },
      ],
    });
    const transport = vi.fn<typeof fetch>(async () =>
      providerResponse({ seeds: validSeeds }, 1)
    );
    vi.stubGlobal("fetch", transport);

    await t.action(generateBatchRef, { batchId: fixture.batchId });

    expect(transport).toHaveBeenCalledTimes(1);
    const persisted = await t.run((ctx) =>
      ctx.db
        .query("seeds")
        .withIndex("by_batchId", (q) => q.eq("batchId", fixture.batchId))
        .collect()
    );
    expect(persisted).toHaveLength(3);
    expect(
      persisted.every(
        (seed) =>
          seed.uncertaintySeedId === undefined &&
          seed.experimentSeedIds === undefined
      )
    ).toBe(true);
    expect(await t.run((ctx) => ctx.db.get(fixture.batchId))).toMatchObject({
      status: "shown",
      requestsMade: 1,
    });
  });

  it("makes no HTTP request when the queued dispatch lease has expired", async () => {
    const t = convexTest(schema, modules);
    const fixture = await dispatchedAttempt(t, {
      targetRoleId: "company_context",
      decisions: [],
    });
    await t.run((ctx) =>
      ctx.db.patch(fixture.batchId, { leaseExpiresAt: Date.now() - 1 })
    );
    const transport = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", transport);

    await t.action(generateBatchRef, { batchId: fixture.batchId });

    expect(transport).not.toHaveBeenCalled();
    expect(await t.run((ctx) => ctx.db.get(fixture.batchId))).toMatchObject({
      status: "failed",
      error: "LEASE_EXPIRED",
      requestsMade: 2,
    });
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("seeds")
          .withIndex("by_batchId", (q) => q.eq("batchId", fixture.batchId))
          .collect()
      )
    ).toEqual([]);
  });

  it("spends exactly one repair request for an invalid tool shape", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedAttempt(t);
    const requests: Request[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        requests.push(new Request(input, init));
        return requests.length === 1
          ? providerResponse({ seeds: [] }, 1)
          : providerResponse({ seeds: validSeeds }, 2);
      })
    );

    await t.action(generateBatchRef, { batchId: fixture.batchId });

    expect(requests).toHaveLength(2);
    const first = await requests[0]?.json();
    const second = await requests[1]?.json();
    const firstUser = requestText(first.messages[0].content);
    const secondUser = requestText(second.messages[0].content);
    expect(secondUser).toContain(firstUser);
    expect(secondUser).toContain(
      "Your previous tool output was invalid"
    );
    expect(await t.run((ctx) => ctx.db.get(fixture.batchId))).toMatchObject({
      status: "shown",
      requestsMade: 2,
    });
  });

  it("tells the repair attempt which Seeds failed and why, without Seed text", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedAttempt(t);
    const longBullet =
      "The client secret team measured every zone of the warehouse many times over many weeks to learn how the coupled zones behaved under changing loads through the whole working day.";
    const requests: Request[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        requests.push(new Request(input, init));
        return requests.length === 1
          ? providerResponse(
              {
                seeds: [
                  validSeeds[0],
                  { ...validSeeds[1], bullets: [longBullet] },
                  { ...validSeeds[2], bullets: [longBullet] },
                ],
              },
              1
            )
          : providerResponse({ seeds: validSeeds }, 2);
      })
    );

    await t.action(generateBatchRef, { batchId: fixture.batchId });

    expect(requests).toHaveLength(2);
    const second = requestText((await requests[1]?.json()).messages[0].content);
    expect(second).toContain(
      "Your previous tool output was invalid: (root): 1 of 3 Seeds valid; return 3 to 5 valid Seeds; use at least two different tags; Seed 2: a bullet is over 25 words; Seed 3: a bullet is over 25 words."
    );
    expect(second.split("Your previous tool output was invalid")[1]).not.toContain("client secret");
    expect(await t.run((ctx) => ctx.db.get(fixture.batchId))).toMatchObject({
      status: "shown",
      requestsMade: 2,
    });
  });

  it("keeps the repair note inside the reserved repair bytes", () => {
    const issues = Array.from({ length: 5 }, (_, seedIndex) => [
      { code: "BULLET_TOO_LONG" as const, message: "long", seedIndex },
      { code: "INVALID_ADVANCEMENT_REFERENCE" as const, message: "links", seedIndex },
      { code: "INVALID_PROVENANCE" as const, message: "provenance", seedIndex },
    ]).flat();
    const summary = seedRepairSummary(
      {
        ok: false,
        seeds: [],
        dropped: 5,
        issues: [...issues, { code: "INVALID_BATCH_SIZE", message: "size" }],
      },
      5
    );
    expect(summary.startsWith("0 of 5 Seeds valid; return 3 to 5 valid Seeds; Seed 1: a bullet is over 25 words, copy uncertaintySeedId")).toBe(true);
    expect(summary).not.toContain("provenance");
    expect(
      new TextEncoder().encode(`(root): ${summary}`).byteLength
    ).toBeLessThanOrEqual(SEED_PROMPT_PROGRAM.request.repairValidationSummaryMaxUtf8Bytes);
  });

  it("fails with a sanitized code after two invalid requests and never sends a third", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedAttempt(t);
    const transport = vi.fn<typeof fetch>(async () =>
      providerResponse({ seeds: [{ bullets: ["client secret"], tags: [], provenance: [] }] }, 1)
    );
    vi.stubGlobal("fetch", transport);

    await t.action(generateBatchRef, { batchId: fixture.batchId });

    expect(transport).toHaveBeenCalledTimes(2);
    const batch = await t.run((ctx) => ctx.db.get(fixture.batchId));
    expect(batch).toMatchObject({
      status: "failed",
      requestsMade: 2,
      error: "INVALID_OUTPUT",
    });
    expect(JSON.stringify(batch)).not.toContain("client secret");
  });

  it("sanitizes malformed OpenRouter output before shared repair logs or persistence", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedAttempt(t, "openai/gpt-5.6-luna");
    vi.stubEnv("OPENROUTER_API_KEY", "synthetic-openrouter-key");
    const malicious = "CLIENT-PRIVATE-TOOL-NAME";
    const transport = vi.fn<typeof fetch>(async () =>
      Response.json({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  id: "malformed-tool",
                  function: { name: malicious, arguments: "{not-json" },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      })
    );
    vi.stubGlobal("fetch", transport);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await t.action(generateBatchRef, { batchId: fixture.batchId });

    expect(transport).toHaveBeenCalledTimes(2);
    const logged = JSON.stringify([...warn.mock.calls, ...error.mock.calls]);
    expect(logged).not.toContain(malicious);
    const batch = await t.run((ctx) => ctx.db.get(fixture.batchId));
    if (!batch) throw new Error("Seed batch disappeared before privacy assertion");
    const events = await t.run((ctx) =>
      ctx.db
        .query("seedDecisionEvents")
        .withIndex("by_generationId_and_at", (q) =>
          q.eq("generationId", batch.generationId)
        )
        .collect()
    );
    expect(batch).toMatchObject({ error: "INVALID_OUTPUT", requestsMade: 2 });
    expect(JSON.stringify({ batch, events })).not.toContain(malicious);
  });

  it("does not resurrect purged seed rows and retains delivered usage detached", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-18T12:00:00Z"));
    const t = convexTest(schema, modules);
    const fixture = await seedAttempt(t);
    let releaseProvider!: () => void;
    let markRequestStarted!: () => void;
    const providerReleased = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    const requestStarted = new Promise<void>((resolve) => {
      markRequestStarted = resolve;
    });
    const transport = vi.fn<typeof fetch>(async () => {
      markRequestStarted();
      await providerReleased;
      return providerResponse({ seeds: validSeeds }, 1);
    });
    vi.stubGlobal("fetch", transport);

    const lateAction = t.action(generateBatchRef, { batchId: fixture.batchId });
    await requestStarted;

    await t
      .withIdentity({ subject: "seed-action-writer" })
      .mutation(api.projects.deleteProject, { projectId: fixture.projectId });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect(await t.run((ctx) => ctx.db.get(fixture.projectId))).toBeNull();

    releaseProvider();
    await lateAction;
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    const after = await t.run(async (ctx) => ({
      batches: await ctx.db
        .query("seedBatches")
        .withIndex("by_projectId", (q) => q.eq("projectId", fixture.projectId))
        .collect(),
      seeds: await ctx.db
        .query("seeds")
        .withIndex("by_projectId", (q) => q.eq("projectId", fixture.projectId))
        .collect(),
      usage: await ctx.db.query("aiUsage").collect(),
    }));
    expect(transport).toHaveBeenCalledTimes(1);
    expect(after.batches).toEqual([]);
    expect(after.seeds).toEqual([]);
    expect(after.usage).toHaveLength(1);
    expect(after.usage[0]).toMatchObject({
      callSite: "generation:seeds:active_uncertainties",
      model,
      inputTokens: 100,
      outputTokens: 40,
    });
    expect(after.usage[0]?.projectId).toBeUndefined();
  });
});
