/// <reference types="vite/client" />
/**
 * Brief preparation, stage 1 (decision 65): the lifecycle, its limits and
 * kill switch, adoption and attachment at the Step-by-step start, fenced
 * late writes, retention, usage, and the request a preparation sends
 * compared with a run's own Brief request at the SDK's HTTP boundary.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { sha256 } from "./lib/contracts";
import { TRANSCRIPT_PARSER_VERSION } from "../shared/transcriptParse";
import { requestBriefPreparation, PREPARATION_DEBOUNCE_MS } from "./lib/briefPreparationTrigger";
import { PREPARATION_RETENTION_MS } from "./briefPreparations";
import { BRIEF_REQUEST } from "./lib/briefRequest";
import { anthropicToolSse, sseResponse } from "./anthropicSse.fixture";
import { deriveOrAdoptSeedBrief, deriveOrReuseBrief } from "./ai/brief";
import {
  clientForStep,
  resetGenerationModelCache,
  resetGenerationPlaceholderCache,
} from "./ai/providers";
import { resolveGenerationStep } from "./lib/generationSteps";
import { briefInputsHash } from "./lib/briefInputsHash";
import { verifiedSourceMapping } from "./lib/generations/briefAdoption";
import { expectedBriefMs, DEFAULT_BRIEF_MS } from "./lib/readingFacts";
import {
  PREPARATION_PROJECT_DAILY_USD,
  PREPARATION_USER_DAILY_STARTS,
  preparationCharge,
} from "./lib/briefPreparationBudget";
import { firmDayNumber } from "../shared/firmTime";
import LOOSE_LABELS_FIXTURE from "../shared/__fixtures__/transcripts/loose-labels.txt?raw";

const modules = import.meta.glob("./**/*.ts");

const TRANSCRIPT = [
  "Interviewer: What did you try first?",
  "",
  "Priya Raman: We replaced the silicone gasket with a fluoropolymer seal because the silicone cracked at minus 30 degrees during the cold soak test.",
  "",
  "Interviewer: Did that work?",
  "",
  "Priya Raman: The fluoropolymer seal held for 400 cycles without leaking, which nobody at the plant had managed before.",
].join("\n");
const DOCUMENT = "Cold soak log: fluoropolymer seal, 400 cycles at minus 30 degrees, no leak.";

const PROVIDER_BRIEF = {
  storyline: "The team replaced a cracking silicone gasket with a fluoropolymer seal that held at minus 30 degrees.",
  storylineClaims: [
    {
      text: "The silicone gasket failed in the cold soak test.",
      quote: "the silicone cracked at minus 30 degrees during the cold soak test",
    },
  ],
  claimExclusions: [],
  confidenceMap: [
    {
      text: "The fluoropolymer seal held for 400 cycles.",
      quote: "The fluoropolymer seal held for 400 cycles without leaking",
      confidence: "established",
    },
    { text: "A fabricated result.", quote: "The seal held for a million cycles.", confidence: "partial" },
  ],
  glossaryTerms: [{ term: "fluoropolymer seal" }],
};

const requests: Array<{ url: string; body: Record<string, unknown> }> = [];

function stubProvider() {
  requests.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const body = (await request.json()) as Record<string, unknown>;
      requests.push({ url: request.url, body });
      return sseResponse(
        anthropicToolSse({
          model: String(body.model),
          tool: BRIEF_REQUEST.toolName,
          input: PROVIDER_BRIEF,
          usage: { input_tokens: 1200, output_tokens: 300 },
        })
      );
    })
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-26T15:00:00Z"));
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-preparation-key");
  resetGenerationModelCache();
  resetGenerationPlaceholderCache();
  stubProvider();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

type T = ReturnType<typeof convexTest<typeof schema.tables>>;

/** Runs `fn` as an action (a test adapter over the real action context). */
function inAction<R>(t: T, fn: (ctx: ActionCtx) => Promise<R>): Promise<R> {
  const run = t.action as unknown as (handler: (ctx: ActionCtx) => Promise<R>) => Promise<R>;
  return run.call(t, fn);
}

async function setup(
  options: { projectType?: "writing" | "review"; role?: "writer" | "admin"; transcript?: string } = {}
) {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { authId: "prep-writer", role: options.role ?? "writer", name: "Wren Writer" });
    const outsiderId = await ctx.db.insert("users", { authId: "prep-outsider", role: "writer", name: "Olly Outsider" });
    const projectId = await ctx.db.insert("projects", {
      title: "Cold seal",
      clientName: "Acme Seals",
      status: "draft",
      projectType: options.projectType ?? "writing",
      ownerId: userId,
      createdBy: userId,
      shareToken: "prep-token",
      createdAt: now,
      updatedAt: now,
    });
    const content = options.transcript ?? TRANSCRIPT;
    const transcriptId = await ctx.db.insert("transcripts", {
      projectId,
      content,
      contentHash: await sha256(content),
      label: "Interview",
      position: 0,
      parserVersion: TRANSCRIPT_PARSER_VERSION,
      createdAt: now,
    });
    await ctx.db.insert("transcriptSpeakers", {
      transcriptId, projectId, label: "Interviewer", role: "interviewer", roleSource: "consultant", confidence: 1, turnCount: 2,
    });
    const speakerId = await ctx.db.insert("transcriptSpeakers", {
      transcriptId, projectId, label: "Priya Raman", role: "client", roleSource: "heuristic", confidence: 0.95, turnCount: 2,
    });
    const documentId = await ctx.db.insert("projectDocuments", {
      projectId,
      fileName: "cold-soak.txt",
      fileType: "txt",
      content: DOCUMENT,
      category: "background",
      source: "context_input",
      uploadedBy: userId,
      uploaderRole: "writer",
      createdAt: now,
    });
    return { userId, outsiderId, projectId, transcriptId, speakerId, documentId };
  });
  return { t, ...ids, writer: t.withIdentity({ subject: "prep-writer" }) };
}

type Setup = Awaited<ReturnType<typeof setup>>;
type Reason = Parameters<typeof requestBriefPreparation>[2]["reason"];

async function trigger(s: Setup, reason: Reason = "transcript_added", userId?: Id<"users">) {
  await s.t.run(async (ctx) => requestBriefPreparation(ctx, s.projectId, { userId: userId ?? s.userId, reason }));
}

async function preparations(s: Setup): Promise<Doc<"briefPreparations">[]> {
  return await s.t.run(async (ctx) =>
    ctx.db.query("briefPreparations").withIndex("by_projectId", (q) => q.eq("projectId", s.projectId)).collect()
  );
}

/**
 * Runs what is due over the next half minute, step by step: the debounced
 * start, the call, its completion and usage logging. Never jumps ahead to
 * the lease expiry the way running every timer would.
 */
async function settle(s: Setup) {
  for (let step = 0; step < 6; step += 1) {
    vi.advanceTimersByTime(PREPARATION_DEBOUNCE_MS + 100);
    await s.t.finishInProgressScheduledFunctions();
  }
}

/** Trigger and let the debounce, the claim, the call and usage logging all run. */
async function prepare(s: Setup) {
  await trigger(s);
  await settle(s);
  const rows = await preparations(s);
  return rows[rows.length - 1];
}

/** Claim without running the call: the preparation stays `running`. */
async function claimOnly(s: Setup) {
  await trigger(s);
  const [queued] = (await preparations(s)).filter((row) => row.status === "queued");
  await s.t.mutation(internal.briefPreparations.startBriefPreparation, { preparationId: queued._id, revision: queued.revision });
  const row = await s.t.run(async (ctx) => ctx.db.get(queued._id));
  return row!;
}

/** A Step-by-step generation frozen by the real reservation, moved to running. */
async function reserve(s: Setup, args: { singleModelId?: string } = {}) {
  const generationId = await s.writer.mutation(api.generations.requestGeneration, {
    projectId: s.projectId,
    candidateMode: "iterative",
    ...args,
  });
  await s.t.run(async (ctx) => ctx.db.patch(generationId, { status: "running" }));
  return generationId;
}

async function generationSources(s: Setup, generationId: Id<"generations">) {
  return await s.t.run(async (ctx) =>
    ctx.db.query("generationSources").withIndex("by_generationId", (q) => q.eq("generationId", generationId)).collect()
  );
}

async function loadGeneration(s: Setup, generationId: Id<"generations">) {
  return (await s.t.run(async (ctx) => ctx.db.get(generationId)))!;
}

/** The run's Brief client, exactly as the Step-by-step start builds it. */
function briefClient(ctx: ActionCtx, generation: Doc<"generations">) {
  const route = resolveGenerationStep({
    freeze: generation.modelFreeze ?? null,
    step: "brief",
    writerModel: generation.singleModelId!,
  });
  return {
    route,
    client: clientForStep(ctx, route, {
      callSite: "generation:brief",
      projectId: generation.projectId,
      attribution: { generationId: generation._id },
    }),
  };
}

async function adoptAtStart(s: Setup, generationId: Id<"generations">) {
  const generation = await loadGeneration(s, generationId);
  return await inAction(s.t, async (ctx) => {
    const { route, client } = briefClient(ctx, generation);
    return await deriveOrAdoptSeedBrief(ctx, client, { projectId: s.projectId, generationId, model: route.model });
  });
}

async function addDocument(s: Setup, fileName: string, content: string) {
  await s.t.run(async (ctx) =>
    ctx.db.insert("projectDocuments", {
      projectId: s.projectId, fileName, fileType: "txt", content,
      source: "context_input", uploadedBy: s.userId, createdAt: Date.now(),
    })
  );
}

async function switchOff(s: Setup) {
  await s.t.run(async (ctx) =>
    ctx.db.insert("appSettings", { key: "briefPreparation.enabled", value: "off", updatedBy: s.userId, updatedAt: Date.now() })
  );
}

describe("preparing and adopting", () => {
  test("a prepared Brief sends the same request as the run's own Brief", async () => {
    const s = await setup();
    const preparation = await prepare(s);
    expect(preparation.failureCode ?? null).toBeNull();
    expect(preparation.status).toBe("ready");
    expect(requests).toHaveLength(1);
    const prepared = requests[0];

    // Usage: one row, attributed to the preparation, settled on it.
    const usage = await s.t.run(async (ctx) => ctx.db.query("aiUsage").collect());
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({
      callSite: "preparation:brief",
      briefPreparationId: preparation._id,
      preparationAttemptId: preparation.attemptId,
      projectId: s.projectId,
      userId: s.userId,
    });
    expect(usage[0].generationId).toBeUndefined();
    const settled = (await s.t.run(async (ctx) => ctx.db.get(preparation._id)))!;
    expect(settled.usageCalls).toBe(1);
    expect(settled.usageCostUsd).toBeCloseTo(usage[0].costUsd, 10);
    expect(preparationCharge(settled)).toBeCloseTo(usage[0].costUsd, 10);

    // Its entries cite its own frozen rows; the fabricated quote was dropped.
    const entries = await s.t.run(async (ctx) =>
      ctx.db.query("briefPreparationEntries").withIndex("by_preparationId", (q) => q.eq("preparationId", preparation._id)).collect()
    );
    expect(entries.map((entry) => entry.group).sort()).toEqual(["confidenceMap", "glossaryTerm", "storyline"]);
    expect(settled.droppedEntryCount).toBe(1);
    const facts = await s.t.run(async (ctx) => ctx.db.query("briefPreparationFacts").collect());
    expect(facts.length).toBeGreaterThan(0);
    expect(facts.every((fact) => fact.attemptId === preparation.attemptId)).toBe(true);

    // The run's own Brief request over the same evidence, at the HTTP boundary.
    const generationId = await reserve(s);
    const generation = await loadGeneration(s, generationId);
    await inAction(s.t, async (ctx) => {
      const { route, client } = briefClient(ctx, generation);
      return await deriveOrReuseBrief(ctx, client, {
        projectId: s.projectId, generationId, model: route.model, seedStartup: true,
      });
    });
    expect(requests).toHaveLength(2);
    const ordinary = requests[1];
    expect(ordinary.url).toBe(prepared.url);
    expect(ordinary.body).toEqual(prepared.body);
    // Names were hidden in both, and the request streamed with a cached prefix.
    const sent = JSON.stringify(prepared.body);
    expect(sent).not.toContain("Priya");
    expect(sent).not.toContain("Acme");
    expect(prepared.body.stream).toBe(true);
    expect(sent).toContain("cache_control");
  });

  test("the run adopts a ready preparation: a new generation-bound Brief, mapped citations, facts at once, no second charge", async () => {
    const s = await setup();
    const preparation = await prepare(s);
    const callsBefore = requests.length;
    const usageBefore = (await s.t.run(async (ctx) => ctx.db.query("aiUsage").collect())).length;
    // The writer's model is not a Brief dependency.
    const generationId = await reserve(s, { singleModelId: "claude-opus-4-8" });
    const result = await adoptAtStart(s, generationId);
    expect(result.kind).toBe("adopted");
    expect(requests).toHaveLength(callsBefore);

    const state = await s.t.run(async (ctx) => {
      const generation = (await ctx.db.get(generationId))!;
      const brief = (await ctx.db.get(generation.briefId!))!;
      const entries = await ctx.db
        .query("generationBriefEntries")
        .withIndex("by_briefId", (q) => q.eq("briefId", brief._id))
        .collect();
      const sources = await ctx.db
        .query("generationSources")
        .withIndex("by_generationId", (q) => q.eq("generationId", generationId))
        .collect();
      const facts = await ctx.db
        .query("generationReadingFacts")
        .withIndex("by_generationId_and_seq", (q) => q.eq("generationId", generationId))
        .collect();
      return { generation, brief, entries, sources, facts, usage: await ctx.db.query("aiUsage").collect() };
    });
    expect(state.brief.generationId).toBe(generationId);
    expect(state.brief.origin).toBe("derived");
    expect(state.brief.preparation).toMatchObject({
      preparationId: preparation._id,
      attemptId: preparation.attemptId,
      key: preparation.key,
      model: preparation.planningModel,
    });
    expect(state.brief.inputsHash).toBe(state.generation.seedBriefInputsHash);
    expect(state.brief.droppedEntryCount).toBe(1);
    expect(state.entries).toHaveLength(3);
    const sourceIds = new Set<string>(state.sources.map((row) => row._id));
    for (const entry of state.entries) {
      expect(sourceIds.has(entry.sourceId)).toBe(true);
      const source = state.sources.find((row) => row._id === entry.sourceId)!;
      expect(source.content.slice(entry.startOffset, entry.endOffset)).toBe(entry.exactExcerpt);
    }
    expect(state.generation.briefPreparation).toMatchObject({ preparationId: preparation._id, state: "adopted" });
    expect(state.facts.length).toBeGreaterThan(0);
    expect(state.usage).toHaveLength(usageBefore);

    // The Reading page shows them at once and complete; the estimate never
    // samples the preparation's or the adoption's time.
    const view = await s.writer.query(api.seeds.getReadingFacts, { generationId });
    expect(view?.done).toBe(true);
    expect(view?.count).toBe(state.facts.length);
    expect(await s.t.run(async (ctx) => expectedBriefMs(ctx, state.generation.modelFreeze?.roles.planning))).toBe(
      DEFAULT_BRIEF_MS
    );
    // Its published Brief is keyed by the run's own inputs hash.
    expect(state.generation.seedBriefInputsHash).toBe(await briefInputsHash(await generationSources(s, generationId)));
  });

  test("changed evidence after the preparation misses, and the run derives its own Brief", async () => {
    const s = await setup();
    await prepare(s);
    await addDocument(s, "late.txt", "A late test note.");
    const generationId = await reserve(s);
    const calls = requests.length;
    expect((await adoptAtStart(s, generationId)).kind).toBe("derived");
    expect(requests).toHaveLength(calls + 1);
    const brief = await s.t.run(async (ctx) => ctx.db.get((await ctx.db.get(generationId))!.briefId!));
    expect(brief?.preparation).toBeUndefined();
  });

  test("a speaker role corrected after the preparation misses", async () => {
    const s = await setup();
    await prepare(s);
    await s.t.run(async (ctx) => ctx.db.patch(s.speakerId, { role: "other", roleSource: "consultant", confidence: 1 }));
    const generationId = await reserve(s);
    expect((await adoptAtStart(s, generationId)).kind).toBe("derived");
  });

  test("a Brief the startup pin already chose wins over a preparation", async () => {
    const s = await setup();
    const preparation = await prepare(s);
    const first = await reserve(s);
    expect((await adoptAtStart(s, first)).kind).toBe("adopted");
    // End that run; the next run with the same inputs reuses its Brief.
    await s.t.run(async (ctx) => {
      await ctx.db.patch(first, { status: "failed" });
      await ctx.db.patch(s.projectId, { activeGenerationId: undefined });
    });
    const second = await reserve(s);
    expect((await adoptAtStart(s, second)).kind).toBe("reused");
    const row = await s.t.run(async (ctx) => ctx.db.get(preparation._id));
    expect(row?.adoptedCount).toBe(1);
  });

  test("the kill switch stops adoption", async () => {
    const s = await setup();
    await prepare(s);
    await switchOff(s);
    const generationId = await reserve(s);
    expect((await adoptAtStart(s, generationId)).kind).toBe("derived");
  });
});

describe("loose labels in the placeholder map (review 2026-09-26, P1-1)", () => {
  // The shared fixture: v7 speakers with lowercase lines that look like
  // labels ("thermal drift:", "latency:", "bottom line:") and open no turn.
  const LOOSE = LOOSE_LABELS_FIXTURE;

  test("a preparation and a generation reservation store label-only entries", async () => {
    const s = await setup({ transcript: LOOSE });
    const claimed = await claimOnly(s);
    const prepared = claimed.placeholders ?? [];
    for (const label of ["thermal drift", "latency", "bottom line"]) {
      expect(prepared.find((entry) => entry.value === label)?.at, label).toBe("label");
    }
    const generationId = await reserve(s);
    const frozen = (await loadGeneration(s, generationId)).placeholders ?? [];
    expect(frozen.filter((entry) => entry.at === "label").map((entry) => entry.value).sort()).toEqual([
      "bottom line",
      "latency",
      "thermal drift",
    ]);
  });
});

describe("attaching to a running preparation", () => {
  async function completeWithOneEntry(s: Setup, preparation: Doc<"briefPreparations">) {
    const sources = await s.t.run(async (ctx) =>
      ctx.db.query("briefPreparationSources").withIndex("by_preparationId", (q) => q.eq("preparationId", preparation._id)).collect()
    );
    const transcript = sources.find((row) => row.kind === "transcript")!;
    const excerpt = "The fluoropolymer seal held for 400 cycles without leaking";
    const at = transcript.content.indexOf(excerpt);
    await s.t.mutation(internal.briefPreparations.completePreparation, {
      preparationId: preparation._id,
      attemptId: preparation.attemptId!,
      storylineText: "Prepared.",
      entries: [
        {
          group: "confidenceMap", text: "Held for 400 cycles.", confidence: "established",
          sourceId: transcript._id, sourceContentHash: transcript.contentHash,
          startOffset: at, endOffset: at + excerpt.length, exactExcerpt: excerpt,
        },
      ],
      upstreamDroppedEntryCount: 0,
    });
  }

  test("registration first: the run waits, completion releases it, and it adopts without polling", async () => {
    const s = await setup();
    const running = await claimOnly(s);
    expect(running.status).toBe("running");
    const generationId = await reserve(s);
    expect((await adoptAtStart(s, generationId)).kind).toBe("attached");
    const waiter = await s.t.run(async (ctx) =>
      ctx.db.query("briefPreparationWaiters").withIndex("by_generationId", (q) => q.eq("generationId", generationId)).unique()
    );
    expect(waiter).toMatchObject({ status: "waiting", attemptId: running.attemptId });

    // Facts of the running attempt stream into the run's Reading page,
    // paced from the preparation's own start.
    await s.t.mutation(internal.briefPreparations.appendPreparationFacts, {
      preparationId: running._id, attemptId: running.attemptId!,
      facts: [{ chip: "Fact", quote: "The fluoropolymer seal held", sourceLabel: "Priya, line 7" }],
    });
    const waiting = await s.writer.query(api.seeds.getReadingFacts, { generationId });
    expect(waiting).toMatchObject({ count: 1, done: false, startedAt: running.dispatchedAt });

    await completeWithOneEntry(s, running);
    const released = await s.t.run(async (ctx) => ctx.db.get(waiter!._id));
    expect(released?.status).toBe("released");
    const scheduled = await s.t.run(async (ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(
      scheduled.some((job) => job.name.includes("continueAfterBriefPreparation") && job.state.kind === "pending")
    ).toBe(true);

    const calls = requests.length;
    expect((await adoptAtStart(s, generationId)).kind).toBe("adopted");
    expect(requests).toHaveLength(calls);
    const view = await s.writer.query(api.seeds.getReadingFacts, { generationId });
    expect(view).toMatchObject({ count: 1, done: true });
  });

  test("the scheduled continuation adopts and hands the Brief to the start's join", async () => {
    const s = await setup();
    const running = await claimOnly(s);
    const generationId = await reserve(s);
    expect((await adoptAtStart(s, generationId)).kind).toBe("attached");
    await completeWithOneEntry(s, running);
    // Completion scheduled the continuation; running it adopts with no call.
    const calls = requests.length;
    await settle(s);
    expect(requests).toHaveLength(calls);
    const generation = await loadGeneration(s, generationId);
    expect(generation.briefId).toBeDefined();
    expect(generation.briefPreparation?.state).toBe("adopted");
    // The writer style is not frozen yet, so the start action opens the stage.
    expect(generation.seedBriefOutcome).toBe("ready");
  });

  test("completion first: the run adopts directly", async () => {
    const s = await setup();
    const running = await claimOnly(s);
    await completeWithOneEntry(s, running);
    const generationId = await reserve(s);
    expect((await adoptAtStart(s, generationId)).kind).toBe("adopted");
    const waiters = await s.t.run(async (ctx) => ctx.db.query("briefPreparationWaiters").collect());
    expect(waiters).toHaveLength(0);
  });

  test("failure releases the waiter for one fresh attempt, never another wait", async () => {
    const s = await setup();
    const running = await claimOnly(s);
    const generationId = await reserve(s);
    expect((await adoptAtStart(s, generationId)).kind).toBe("attached");
    await s.t.mutation(internal.briefPreparations.failPreparation, { preparationId: running._id, attemptId: running.attemptId!, code: "rate_limited" });
    const calls = requests.length;
    expect((await adoptAtStart(s, generationId)).kind).toBe("derived");
    expect(requests).toHaveLength(calls + 1);
    expect((await loadGeneration(s, generationId)).briefPreparation?.state).toBe("released");
  });

  test("an expired lease fails the attempt and releases the waiter", async () => {
    const s = await setup();
    const running = await claimOnly(s);
    const generationId = await reserve(s);
    expect((await adoptAtStart(s, generationId)).kind).toBe("attached");
    await s.t.mutation(internal.briefPreparations.expirePreparationLease, { preparationId: running._id, attemptId: running.attemptId! });
    const row = await s.t.run(async (ctx) => ctx.db.get(running._id));
    expect(row).toMatchObject({ status: "failed", failureCode: "timed_out" });
    const waiter = await s.t.run(async (ctx) => ctx.db.query("briefPreparationWaiters").first());
    expect(waiter?.status).toBe("released");
  });

  test("the seed stage opens only once both halves are in, in either order", async () => {
    const s = await setup();
    const generationId = await reserve(s);
    // The continuation settles first, before the writer style exists.
    expect(await s.t.mutation(internal.generations.openSeedStageAfterBrief, { generationId, outcome: "failed" })).toBe(
      "waiting"
    );
    expect((await loadGeneration(s, generationId)).seedBriefOutcome).toBe("failed");
    // Then the style: the start action's half records the retryable failure.
    await s.t.run(async (ctx) =>
      ctx.db.insert("generationArtifacts", { generationId, kind: "writer_style", content: "{}" })
    );
    expect(await s.t.mutation(internal.generations.openSeedStageAfterBrief, { generationId })).toBe("failed");
    expect((await loadGeneration(s, generationId)).seedStageError).toBeTruthy();
  });

  test("the start action's half waits while the run is still attached", async () => {
    const s = await setup();
    await claimOnly(s);
    const generationId = await reserve(s);
    expect((await adoptAtStart(s, generationId)).kind).toBe("attached");
    await s.t.run(async (ctx) =>
      ctx.db.insert("generationArtifacts", { generationId, kind: "writer_style", content: "{}" })
    );
    expect(await s.t.mutation(internal.generations.openSeedStageAfterBrief, { generationId })).toBe("waiting");
  });
});

describe("fenced writes", () => {
  test("a replaced attempt's late writes are dropped, and its call holds the slot until it ends", async () => {
    const s = await setup();
    const first = await claimOnly(s);
    // New evidence: the next start has another key and makes the first
    // obsolete, but the first call is still being paid for, so it waits.
    await addDocument(s, "new.txt", "New cold data.");
    const second = await claimOnly(s);
    expect(second).toMatchObject({ status: "queued", waitingFor: "slot", deferrals: 1 });
    const obsolete = await s.t.run(async (ctx) => ctx.db.get(first._id));
    expect(obsolete).toMatchObject({ status: "obsolete", endedReason: "superseded" });
    // Still in flight: another try waits again.
    await s.t.mutation(internal.briefPreparations.startBriefPreparation, { preparationId: second._id, revision: second.revision + 1 });
    expect((await s.t.run(async (ctx) => ctx.db.get(second._id)))?.status).toBe("queued");

    // The first call ends: its late facts and completion write nothing,
    // and the slot is free.
    await s.t.mutation(internal.briefPreparations.appendPreparationFacts, {
      preparationId: first._id, attemptId: first.attemptId!,
      facts: [{ chip: "Fact", quote: "late", sourceLabel: "x" }],
    });
    await s.t.mutation(internal.briefPreparations.completePreparation, {
      preparationId: first._id, attemptId: first.attemptId!, storylineText: "late", entries: [], upstreamDroppedEntryCount: 0,
    });
    const after = await s.t.run(async (ctx) => ({
      row: await ctx.db.get(first._id),
      facts: await ctx.db.query("briefPreparationFacts").collect(),
    }));
    expect(after.row?.status).toBe("obsolete");
    expect(after.row?.storylineText).toBeUndefined();
    expect(after.row?.attemptEndedAt).toBeDefined();
    expect(after.facts).toHaveLength(0);
    const waiting = (await s.t.run(async (ctx) => ctx.db.get(second._id)))!;
    await s.t.mutation(internal.briefPreparations.startBriefPreparation, { preparationId: second._id, revision: waiting.revision });
    const dispatched = (await s.t.run(async (ctx) => ctx.db.get(second._id)))!;
    expect(dispatched.status).toBe("running");
    expect(dispatched.key).not.toBe(first.key);
  });

  test("a wrong attempt id, a deleting project or an expired lease fences the write", async () => {
    const s = await setup();
    const running = await claimOnly(s);
    const complete = (attemptId: string) =>
      s.t.mutation(internal.briefPreparations.completePreparation, {
        preparationId: running._id, attemptId, storylineText: "x", entries: [], upstreamDroppedEntryCount: 0,
      });
    await complete("another-attempt");
    expect((await s.t.run(async (ctx) => ctx.db.get(running._id)))?.status).toBe("running");
    await s.t.run(async (ctx) => ctx.db.patch(s.projectId, { deletionStartedAt: Date.now() }));
    await complete(running.attemptId!);
    expect((await s.t.run(async (ctx) => ctx.db.get(running._id)))?.status).toBe("running");
    await s.t.run(async (ctx) => ctx.db.patch(s.projectId, { deletionStartedAt: undefined }));
    vi.setSystemTime(Date.now() + 12 * 60 * 1000);
    await complete(running.attemptId!);
    expect((await s.t.run(async (ctx) => ctx.db.get(running._id)))?.status).toBe("running");
  });

  test("an entry that does not match its frozen row is dropped at completion and again at adoption", async () => {
    const s = await setup();
    const running = await claimOnly(s);
    const sources = await s.t.run(async (ctx) =>
      ctx.db.query("briefPreparationSources").withIndex("by_preparationId", (q) => q.eq("preparationId", running._id)).collect()
    );
    const transcript = sources.find((row) => row.kind === "transcript")!;
    await s.t.mutation(internal.briefPreparations.completePreparation, {
      preparationId: running._id, attemptId: running.attemptId!, storylineText: "x",
      entries: [
        {
          group: "storyline", text: "Tampered.", sourceId: transcript._id, sourceContentHash: transcript.contentHash,
          startOffset: 0, endOffset: 5, exactExcerpt: "Other",
        },
      ],
      upstreamDroppedEntryCount: 0,
    });
    const ready = (await s.t.run(async (ctx) => ctx.db.get(running._id)))!;
    expect(ready).toMatchObject({ status: "ready", droppedEntryCount: 1 });
    // A stored entry whose hash no longer matches is dropped at adoption.
    await s.t.run(async (ctx) =>
      ctx.db.insert("briefPreparationEntries", {
        preparationId: running._id, projectId: s.projectId, group: "confidenceMap", text: "Tampered later.",
        confidence: "partial", sourceId: transcript._id, sourceContentHash: "not-the-hash",
        startOffset: 0, endOffset: 11, exactExcerpt: "Interviewer",
      })
    );
    const generationId = await reserve(s);
    expect((await adoptAtStart(s, generationId)).kind).toBe("adopted");
    const brief = await s.t.run(async (ctx) => ctx.db.get((await ctx.db.get(generationId))!.briefId!));
    expect(brief?.droppedEntryCount).toBe(2);
  });
});

describe("what a preparation holds against the limits", () => {
  test("a completed preparation counts its settled usage, even once obsolete; an unfinished one its reservation", () => {
    const base = { dispatchedAt: 1, reservedUsd: 0.24, usageCostUsd: 0.02, usageCalls: 1 };
    expect(preparationCharge({ ...base, status: "ready", completedAt: 2 })).toBeCloseTo(0.02, 10);
    expect(preparationCharge({ ...base, status: "obsolete", completedAt: 2 })).toBeCloseTo(0.02, 10);
    expect(preparationCharge({ ...base, status: "obsolete" })).toBeCloseTo(0.24, 10);
    expect(preparationCharge({ ...base, status: "failed", completedAt: undefined })).toBeCloseTo(0.24, 10);
    expect(preparationCharge({ ...base, status: "obsolete", completedAt: 2, usageCalls: 0 })).toBeCloseTo(0.24, 10);
    expect(preparationCharge({ status: "queued", reservedUsd: 0.24 })).toBe(0);
  });
});

describe("the verified source mapping", () => {
  const row = (id: string, fields: Partial<Doc<"briefPreparationSources">> = {}) =>
    ({
      _id: id, _creationTime: 0, preparationId: "p", projectId: "x", kind: "project_document", projectDocumentId: `doc-${id}`,
      label: "other:a.txt", content: "Same text.", contentHash: "h", truncated: false, originalLength: 10, capturedAt: 0,
      ...fields,
    }) as unknown as Doc<"briefPreparationSources">;
  const target = (id: string, fields: Partial<Doc<"generationSources">> = {}) =>
    ({
      _id: id, _creationTime: 0, generationId: "g", projectId: "x", kind: "project_document", projectDocumentId: `doc-${id}`,
      label: "other:a.txt", content: "Same text.", contentHash: "h", truncated: false, originalLength: 10, capturedAt: 0,
      ...fields,
    }) as unknown as Doc<"generationSources">;

  test("maps by identity and position, never by equal text", () => {
    const mapping = verifiedSourceMapping([row("1"), row("2")], [target("1"), target("2")]);
    expect(mapping?.get("1" as Id<"briefPreparationSources">)?._id).toBe("1");
    // Two files with identical text in swapped order do not map.
    expect(verifiedSourceMapping([row("1"), row("2")], [target("2"), target("1")])).toBeNull();
    // A missing row, another label, another hash or another cut does not map.
    expect(verifiedSourceMapping([row("1"), row("2")], [target("1")])).toBeNull();
    expect(verifiedSourceMapping([row("1")], [target("1", { label: "other:b.txt" })])).toBeNull();
    expect(verifiedSourceMapping([row("1")], [target("1", { contentHash: "other" })])).toBeNull();
    expect(verifiedSourceMapping([row("1")], [target("1", { truncated: true })])).toBeNull();
  });
});

describe("triggers, eligibility and limits", () => {
  test("changes within the debounce ask once; reads never ask", async () => {
    const s = await setup();
    await s.writer.query(api.transcripts.listTranscripts, { projectId: s.projectId });
    await s.writer.query(api.projects.getProject, { projectId: s.projectId });
    expect(await preparations(s)).toHaveLength(0);
    await trigger(s, "document_added");
    vi.setSystemTime(Date.now() + PREPARATION_DEBOUNCE_MS - 1000);
    await trigger(s, "document_added");
    const rows = await preparations(s);
    expect(rows).toHaveLength(1);
    // Trailing debounce: the second change moves the start to 5 seconds
    // after itself, and the first start is taken off the queue.
    expect(rows[0]).toMatchObject({ status: "queued", revision: 2, runAt: Date.now() + PREPARATION_DEBOUNCE_MS });
    const jobs = await s.t.run(async (ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(
      jobs.filter((job) => job.name.includes("startBriefPreparation") && job.state.kind === "pending")
    ).toHaveLength(1);
    // A start for another revision does nothing.
    await s.t.mutation(internal.briefPreparations.startBriefPreparation, { preparationId: rows[0]._id, revision: 7 });
    expect((await preparations(s))[0].status).toBe("queued");
  });

  test("evidence mutations on the project ask for a preparation", async () => {
    const s = await setup();
    await s.writer.mutation(api.documents.setDocumentArchived, { documentId: s.documentId, archived: true });
    expect(await preparations(s)).toHaveLength(1);
    await s.writer.mutation(api.transcripts.setSpeakerRole, { transcriptId: s.transcriptId, label: "Priya Raman", role: "client" });
    await s.writer.mutation(api.projects.updateProjectClientName, { projectId: s.projectId, clientName: "Acme Seals Ltd" });
    const rows = await preparations(s);
    expect(rows).toHaveLength(1);
    // Each change moved the one queued start; the last one names the reason.
    expect(rows[0]).toMatchObject({ revision: 3, triggerReason: "identity_changed", triggeredBy: s.userId });
  });

  test("a review project, and the kill switch, never ask", async () => {
    const review = await setup({ projectType: "review" });
    await trigger(review);
    expect(await preparations(review)).toHaveLength(0);
    const off = await setup();
    await switchOff(off);
    await trigger(off);
    expect(await preparations(off)).toHaveLength(0);
  });

  test("only an Admin sets the kill switch", async () => {
    const s = await setup();
    await expect(s.writer.mutation(api.appSettings.setBriefPreparationEnabled, { enabled: false })).rejects.toThrow();
    const admin = await setup({ role: "admin" });
    await admin.writer.mutation(api.appSettings.setBriefPreparationEnabled, { enabled: false });
    const row = await admin.t.run(async (ctx) =>
      ctx.db.query("appSettings").withIndex("by_key", (q) => q.eq("key", "briefPreparation.enabled")).unique()
    );
    expect(row?.value).toBe("off");
  });

  test("a start is cancelled without a call when it is not eligible", async () => {
    const cases: Array<[string, (s: Setup) => Promise<unknown>]> = [
      ["not_authorized", async (s) => s.t.run(async (ctx) => ctx.db.patch(s.projectId, { ownerId: s.outsiderId }))],
      ["no_transcript", async (s) => s.t.run(async (ctx) => ctx.db.patch(s.transcriptId, { content: "  " }))],
      ["ingestion_port", async (s) => s.t.run(async (ctx) => ctx.db.patch(s.documentId, { source: "ingestion_port" }))],
      ["disabled", switchOff],
      [
        "representation",
        async (s) =>
          s.t.run(async (ctx) =>
            ctx.db.insert("appSettings", { key: "transcripts.factsMode", value: "all", updatedBy: s.userId, updatedAt: Date.now() })
          ),
      ],
    ];
    for (const [reason, arrange] of cases) {
      const s = await setup();
      requests.length = 0;
      await trigger(s);
      await arrange(s);
      await settle(s);
      const [row] = await preparations(s);
      expect(row, reason).toMatchObject({ status: "cancelled", endedReason: reason });
      expect(requests, reason).toHaveLength(0);
    }
  });

  test("an active run cancels the start", async () => {
    const s = await setup();
    await trigger(s);
    await reserve(s);
    const [queued] = await preparations(s);
    await s.t.mutation(internal.briefPreparations.startBriefPreparation, { preparationId: queued._id, revision: queued.revision });
    expect((await preparations(s))[0]).toMatchObject({ status: "cancelled", endedReason: "generation_active" });
  });

  test("a transcript whose turns are still being built waits, and the finished build asks again", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => ctx.db.patch(s.transcriptId, { structureBuildId: "build-1" }));
    await trigger(s);
    const [queued] = await preparations(s);
    await s.t.mutation(internal.briefPreparations.startBriefPreparation, { preparationId: queued._id, revision: queued.revision });
    expect((await preparations(s))[0]).toMatchObject({ status: "queued", waitingFor: "structure" });
    await s.t.run(async (ctx) => ctx.db.patch(s.transcriptId, { structureBuildId: undefined }));
    await s.t.run(async (ctx) => requestBriefPreparation(ctx, s.projectId, { reason: "structure_ready" }));
    await settle(s);
    expect((await preparations(s))[0].status).toBe("ready");
  });

  test("a new transcript's uncertain speakers are waited for, then the preparation runs", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => ctx.db.patch(s.speakerId, { confidence: 0.3 }));
    await trigger(s);
    const [queued] = await preparations(s);
    await s.t.mutation(internal.briefPreparations.startBriefPreparation, { preparationId: queued._id, revision: queued.revision });
    expect((await preparations(s))[0]).toMatchObject({ status: "queued", waitingFor: "speakers", deferrals: 1 });
    // The model's answer lands and asks again; the preparation then runs.
    await s.t.mutation(internal.transcripts.recordModelSpeakerRoles, {
      transcriptId: s.transcriptId,
      roles: [{ label: "Priya Raman", role: "client", confidence: 0.9 }],
    });
    await settle(s);
    expect((await preparations(s))[0].status).toBe("ready");
    expect(requests).toHaveLength(1);
  });

  test("the same key already prepared buys nothing", async () => {
    const s = await setup();
    await prepare(s);
    await trigger(s, "speakers_changed");
    await settle(s);
    const rows = await preparations(s);
    expect(rows.map((row) => row.status)).toEqual(["ready", "cancelled"]);
    expect(rows[1].endedReason).toBe("duplicate");
    expect(requests).toHaveLength(1);
  });

  test("one running preparation per user: another project waits for the slot", async () => {
    const s = await setup();
    await claimOnly(s);
    const otherProject = await s.t.run(async (ctx) => {
      const now = Date.now();
      const projectId = await ctx.db.insert("projects", {
        title: "Other", clientName: "Other Co", status: "draft", projectType: "writing", ownerId: s.userId,
        createdBy: s.userId, shareToken: "other-token", createdAt: now, updatedAt: now,
      });
      await ctx.db.insert("transcripts", {
        projectId, content: TRANSCRIPT, contentHash: await sha256(TRANSCRIPT), label: "Interview", position: 0,
        parserVersion: TRANSCRIPT_PARSER_VERSION, createdAt: now,
      });
      await requestBriefPreparation(ctx, projectId, { userId: s.userId, reason: "transcript_added" });
      return projectId;
    });
    const queued = await s.t.run(async (ctx) =>
      ctx.db.query("briefPreparations").withIndex("by_projectId", (q) => q.eq("projectId", otherProject)).unique()
    );
    await s.t.mutation(internal.briefPreparations.startBriefPreparation, { preparationId: queued!._id, revision: queued!.revision });
    const after = await s.t.run(async (ctx) => ctx.db.get(queued!._id));
    expect(after).toMatchObject({ status: "queued", waitingFor: "slot", deferrals: 1 });
  });

  test("daily starts and spend are capped before the call", async () => {
    const limits: Array<[string, (s: Setup, firmDay: number) => Promise<unknown>]> = [
      [
        "daily_starts",
        async (s, firmDay) =>
          s.t.run(async (ctx) => {
            for (let i = 0; i < PREPARATION_USER_DAILY_STARTS; i += 1) {
              await ctx.db.insert("briefPreparations", {
                projectId: s.projectId, status: "failed", revision: 1, runAt: 0, triggeredBy: s.userId, triggerReason: "x",
                createdAt: 0, updatedAt: 0, dispatchedAt: Date.now(), firmDay, reservedUsd: 0.001, endedAt: Date.now(),
              });
            }
          }),
      ],
      [
        "project_budget",
        async (s, firmDay) =>
          s.t.run(async (ctx) =>
            ctx.db.insert("briefPreparations", {
              projectId: s.projectId, status: "obsolete", revision: 1, runAt: 0, triggeredBy: s.outsiderId, triggerReason: "x",
              createdAt: 0, updatedAt: 0, dispatchedAt: Date.now(), firmDay,
              reservedUsd: PREPARATION_PROJECT_DAILY_USD - 0.01, endedAt: Date.now(),
            })
          ),
      ],
      [
        "user_budget",
        async (s, firmDay) =>
          s.t.run(async (ctx) => {
            const now = Date.now();
            const other = await ctx.db.insert("projects", {
              title: "Spent", clientName: "Spent Co", status: "draft", createdBy: s.userId, shareToken: "spent", createdAt: now, updatedAt: now,
            });
            await ctx.db.insert("briefPreparations", {
              projectId: other, status: "ready", revision: 1, runAt: 0, triggeredBy: s.userId, triggerReason: "x",
              createdAt: 0, updatedAt: 0, dispatchedAt: now, firmDay, reservedUsd: 1, usageCostUsd: 4.99, usageCalls: 1,
            });
          }),
      ],
    ];
    for (const [reason, arrange] of limits) {
      const s = await setup();
      requests.length = 0;
      await arrange(s, firmDayNumber(Date.now()));
      await trigger(s);
      await settle(s);
      const rows = (await preparations(s)).filter((row) => row.triggerReason === "transcript_added");
      expect(rows[0], reason).toMatchObject({ status: "cancelled", endedReason: reason });
      expect(requests, reason).toHaveLength(0);
    }
  });

  test("a failed preparation is not retried by itself", async () => {
    const s = await setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ type: "error", error: { type: "invalid_request_error", message: "bad" } }, { status: 400 })
      )
    );
    const row = await prepare(s);
    expect(row.status).toBe("failed");
    expect(row.failureCode).toBeTruthy();
    await s.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await preparations(s)).toHaveLength(1);
  });
});

describe("retention", () => {
  test("ended content is purged after 24 hours in batches; ready and recent rows keep theirs", async () => {
    const s = await setup();
    const ready = await prepare(s);
    const seeded = await s.t.run(async (ctx) => {
      const now = Date.now();
      const failedId = await ctx.db.insert("briefPreparations", {
        projectId: s.projectId, status: "failed", revision: 1, runAt: 0, triggeredBy: s.userId, triggerReason: "x",
        createdAt: 0, updatedAt: 0, attemptId: "old", storylineText: "Old text.",
        placeholders: [{ token: "[PERSON_1]", value: "Priya" }],
        failureCode: "unknown", endedAt: now - PREPARATION_RETENTION_MS - 60 * 60 * 1000,
      });
      const recentId = await ctx.db.insert("briefPreparations", {
        projectId: s.projectId, status: "obsolete", revision: 1, runAt: 0, triggeredBy: s.userId, triggerReason: "x",
        createdAt: 0, updatedAt: 0, storylineText: "Recent.", endedAt: now - 60 * 1000,
      });
      for (let i = 0; i < 3; i += 1) {
        const sourceId = await ctx.db.insert("briefPreparationSources", {
          preparationId: failedId, projectId: s.projectId, kind: "transcript", label: "l", content: TRANSCRIPT,
          contentHash: "h", truncated: false, originalLength: 1, capturedAt: 0,
        });
        await ctx.db.insert("briefPreparationEntries", {
          preparationId: failedId, projectId: s.projectId, group: "storyline", text: "t", sourceId, sourceContentHash: "h",
          startOffset: 0, endOffset: 1, exactExcerpt: "I",
        });
        await ctx.db.insert("briefPreparationFacts", {
          preparationId: failedId, projectId: s.projectId, attemptId: "old", seq: i + 1, chip: "Fact", quote: "q",
          sourceLabel: "l", createdAt: 0,
        });
      }
      return { failedId, recentId };
    });
    await s.t.mutation(internal.briefPreparations.purgeStalePreparations, {});
    await settle(s);
    const state = await s.t.run(async (ctx) => {
      const count = async (preparationId: Id<"briefPreparations">) => ({
        sources: (await ctx.db.query("briefPreparationSources").withIndex("by_preparationId", (q) => q.eq("preparationId", preparationId)).collect()).length,
        entries: (await ctx.db.query("briefPreparationEntries").withIndex("by_preparationId", (q) => q.eq("preparationId", preparationId)).collect()).length,
        facts: (await ctx.db.query("briefPreparationFacts").withIndex("by_preparationId_and_attemptId_and_seq", (q) => q.eq("preparationId", preparationId)).collect()).length,
      });
      return {
        failed: await ctx.db.get(seeded.failedId),
        recent: await ctx.db.get(seeded.recentId),
        ready: await ctx.db.get(ready._id),
        failedChildren: await count(seeded.failedId),
        readyChildren: await count(ready._id),
      };
    });
    expect(state.failedChildren).toEqual({ sources: 0, entries: 0, facts: 0 });
    expect(state.readyChildren.sources).toBeGreaterThan(0);
    expect(state.failed?.contentPurgedAt).toBeDefined();
    expect(state.failed?.storylineText).toBeUndefined();
    expect(state.failed?.placeholders).toBeUndefined();
    expect(state.failed?.failureCode).toBe("unknown");
    expect(state.recent?.storylineText).toBe("Recent.");
    expect(state.ready?.storylineText).toBeDefined();
  });
});

describe("review fixes (2026-09-26 reviews)", () => {
  test("a parser upgrade followed by a read spends nothing (A)", async () => {
    const s = await setup();
    const ready = await prepare(s);
    // Prepared on an earlier firm day, then the parser version moves on.
    await s.t.run(async (ctx) => {
      await ctx.db.patch(ready._id, { firmDay: (ready.firmDay ?? 0) - 3 });
      await ctx.db.patch(s.transcriptId, { parserVersion: "6" });
      await ctx.db.insert("appSettings", { key: "transcripts.factsMode", value: "long", updatedBy: s.userId, updatedAt: Date.now() });
    });
    const calls = requests.length;
    // Opening the transcript asks for facts, which rebuilds its turns.
    await s.writer.mutation(api.transcripts.requestTranscriptFacts, { transcriptId: s.transcriptId });
    await settle(s);
    expect((await s.t.run(async (ctx) => ctx.db.get(s.transcriptId)))?.parserVersion).toBe(TRANSCRIPT_PARSER_VERSION);
    expect(await preparations(s)).toHaveLength(1);
    expect(requests).toHaveLength(calls);
  });

  test("a system change follows up only today's or live work (A)", async () => {
    const s = await setup();
    const ready = await prepare(s);
    await s.t.run(async (ctx) => ctx.db.patch(ready._id, { firmDay: (ready.firmDay ?? 0) - 1 }));
    await s.t.run(async (ctx) => requestBriefPreparation(ctx, s.projectId, { reason: "speakers_changed" }));
    expect(await preparations(s)).toHaveLength(1);
    await s.t.run(async (ctx) => ctx.db.patch(ready._id, { firmDay: ready.firmDay }));
    await s.t.run(async (ctx) => requestBriefPreparation(ctx, s.projectId, { reason: "speakers_changed" }));
    const rows = await preparations(s);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ status: "queued", triggeredBy: s.userId });
  });

  test("a project past the writing stages is never prepared (A)", async () => {
    for (const stage of ["internal_review", "client_review", "ready_for_delivery", "delivered", "on_hold", "abandoned"] as const) {
      const s = await setup();
      await s.t.run(async (ctx) => ctx.db.patch(s.projectId, { workflowStage: stage }));
      await trigger(s);
      expect(await preparations(s), stage).toHaveLength(0);
    }
    const s = await setup();
    await trigger(s);
    await s.t.run(async (ctx) => ctx.db.patch(s.projectId, { workflowStage: "internal_review" }));
    await settle(s);
    expect((await preparations(s))[0]).toMatchObject({ status: "cancelled", endedReason: "stage" });
    expect(requests).toHaveLength(0);
  });

  test("a start that reads the evidence drops an older ready copy, even when it is cancelled (B)", async () => {
    const s = await setup();
    const ready = await prepare(s);
    await s.t.run(async (ctx) =>
      ctx.db.insert("appSettings", { key: "transcripts.factsMode", value: "all", updatedBy: s.userId, updatedAt: Date.now() })
    );
    await trigger(s);
    await settle(s);
    const rows = await preparations(s);
    expect(rows[1]).toMatchObject({ status: "cancelled", endedReason: "representation" });
    expect(await s.t.run(async (ctx) => ctx.db.get(ready._id))).toMatchObject({ status: "obsolete", endedReason: "superseded" });
  });

  test("an active run cancels the start before the evidence is read: an older ready copy stays", async () => {
    const s = await setup();
    const ready = await prepare(s);
    await reserve(s);
    await trigger(s);
    await settle(s);
    const rows = await preparations(s);
    expect(rows[1]).toMatchObject({ status: "cancelled", endedReason: "generation_active" });
    expect((await s.t.run(async (ctx) => ctx.db.get(ready._id)))?.status).toBe("ready");
  });

  test("ready content is deleted 7 days after it finished or was last adopted (B)", async () => {
    const s = await setup();
    const ready = await prepare(s);
    expect(ready.contentExpiresAt).toBe((ready.completedAt ?? 0) + 7 * 24 * 60 * 60 * 1000);
    // Adopted on day 5: the limit moves to day 12.
    vi.setSystemTime(Date.now() + 5 * 24 * 60 * 60 * 1000);
    const generationId = await reserve(s);
    expect((await adoptAtStart(s, generationId)).kind).toBe("adopted");
    vi.setSystemTime(Date.now() + 3 * 24 * 60 * 60 * 1000);
    await s.t.mutation(internal.briefPreparations.purgeStalePreparations, {});
    expect((await s.t.run(async (ctx) => ctx.db.get(ready._id)))?.status).toBe("ready");
    vi.setSystemTime(Date.now() + 5 * 24 * 60 * 60 * 1000);
    await s.t.mutation(internal.briefPreparations.purgeStalePreparations, {});
    const expired = (await s.t.run(async (ctx) => ctx.db.get(ready._id)))!;
    expect(expired).toMatchObject({ status: "obsolete", endedReason: "expired" });
    expect(expired.contentPurgedAt).toBeDefined();
    expect(expired.storylineText).toBeUndefined();
    const sources = await s.t.run(async (ctx) =>
      ctx.db.query("briefPreparationSources").withIndex("by_preparationId", (q) => q.eq("preparationId", ready._id)).collect()
    );
    expect(sources).toHaveLength(0);
    // The adopted run keeps its own Brief.
    expect((await loadGeneration(s, generationId)).briefId).toBeDefined();
  });

  test("switched off, the purge deletes every ready copy at once (B)", async () => {
    const admin = await setup({ role: "admin" });
    const ready = await prepare(admin);
    await admin.writer.mutation(api.appSettings.setBriefPreparationEnabled, { enabled: false });
    await settle(admin);
    const row = (await admin.t.run(async (ctx) => ctx.db.get(ready._id)))!;
    expect(row).toMatchObject({ status: "obsolete", endedReason: "expired" });
    expect(row.contentPurgedAt).toBeDefined();
    expect(row.placeholders).toBeUndefined();
  });

  test("a billing failure cools the project down for 30 minutes (E)", async () => {
    const s = await setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { type: "error", error: { type: "billing_error", message: "Your credit balance is too low" } },
          { status: 400 }
        )
      )
    );
    const failed = await prepare(s);
    expect(failed).toMatchObject({ status: "failed", failureCode: "billing" });
    stubProvider();
    await trigger(s, "document_added");
    await settle(s);
    expect((await preparations(s))[1]).toMatchObject({ status: "cancelled", endedReason: "cooldown" });
    vi.setSystemTime(Date.now() + 31 * 60 * 1000);
    await trigger(s, "document_added");
    await settle(s);
    expect((await preparations(s))[2].status).toBe("ready");
  });

  test("switched off after the claim, the attempt sends nothing and ends cancelled (F)", async () => {
    const s = await setup();
    const running = await claimOnly(s);
    await switchOff(s);
    await settle(s);
    expect(await s.t.run(async (ctx) => ctx.db.get(running._id))).toMatchObject({
      status: "cancelled",
      endedReason: "disabled",
    });
    expect(requests).toHaveLength(0);
  });

  test("an editor who lost authority during the call publishes nothing; the spend stays (G)", async () => {
    const s = await setup();
    const running = await claimOnly(s);
    await s.t.run(async (ctx) => ctx.db.patch(s.projectId, { ownerId: s.outsiderId }));
    await settle(s);
    const row = (await s.t.run(async (ctx) => ctx.db.get(running._id)))!;
    expect(row).toMatchObject({ status: "cancelled", endedReason: "not_authorized", usageCalls: 1 });
    expect(requests).toHaveLength(1);
    const entries = await s.t.run(async (ctx) =>
      ctx.db.query("briefPreparationEntries").withIndex("by_preparationId", (q) => q.eq("preparationId", running._id)).collect()
    );
    expect(entries).toHaveLength(0);
  });

  test("a ported project is never prepared, whatever became of the ported file (H)", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      await ctx.db.patch(s.documentId, { archived: true });
      await ctx.db.insert("ingestionItems", {
        driveItemId: "item-1", path: "Clients/Acme/old.docx", name: "old.docx", docKind: "pd", size: 1,
        lastModifiedAt: 0, contentHash: "h", status: "approved", pairGroupKey: "Acme::2025", updatedAt: 0,
        portedProjectId: s.projectId,
      });
    });
    await trigger(s);
    await settle(s);
    expect((await preparations(s))[0]).toMatchObject({ status: "cancelled", endedReason: "ingestion_port" });
    expect(requests).toHaveLength(0);
  });

  test("a start waiting on a turn build looks again every 2 minutes, at most 10 times (O)", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => ctx.db.patch(s.transcriptId, { structureBuildId: "build-1" }));
    await trigger(s);
    await settle(s);
    expect((await preparations(s))[0]).toMatchObject({ status: "queued", waitingFor: "structure", deferrals: 1 });
    // The build ends without asking (a rebuild from a read, say).
    await s.t.run(async (ctx) => ctx.db.patch(s.transcriptId, { structureBuildId: undefined }));
    vi.advanceTimersByTime(2 * 60 * 1000);
    await s.t.finishInProgressScheduledFunctions();
    await settle(s);
    expect((await preparations(s))[0].status).toBe("ready");

    const stuck = await setup();
    await stuck.t.run(async (ctx) => ctx.db.patch(stuck.transcriptId, { structureBuildId: "build-2" }));
    await trigger(stuck);
    for (let i = 0; i < 12; i += 1) {
      vi.advanceTimersByTime(2 * 60 * 1000 + 100);
      await stuck.t.finishInProgressScheduledFunctions();
    }
    expect((await preparations(stuck))[0]).toMatchObject({ status: "cancelled", endedReason: "structure_unsettled" });
  });
});

describe("bounded waits (J, L)", () => {
  async function attached(s: Setup) {
    const running = await claimOnly(s);
    const generationId = await reserve(s);
    expect((await adoptAtStart(s, generationId)).kind).toBe("attached");
    const waiter = (await s.t.run(async (ctx) =>
      ctx.db.query("briefPreparationWaiters").withIndex("by_generationId", (q) => q.eq("generationId", generationId)).unique()
    ))!;
    return { running, generationId, waiter };
  }

  test("the wait ends at its deadline; the run reads on its own and never shows the attempt's facts (J, L)", async () => {
    const s = await setup();
    const { running, generationId, waiter } = await attached(s);
    expect(waiter.deadlineAt).toBe((running.dispatchedAt ?? 0) + 4 * 60 * 1000);
    await s.t.mutation(internal.briefPreparations.appendPreparationFacts, {
      preparationId: running._id, attemptId: running.attemptId!,
      facts: [{ chip: "Fact", quote: "Streamed before the deadline", sourceLabel: "Priya, line 7" }],
    });
    // Before the deadline the check only looks again.
    await s.t.mutation(internal.briefPreparations.checkBriefWaiter, { waiterId: waiter._id });
    expect((await s.t.run(async (ctx) => ctx.db.get(waiter._id)))?.status).toBe("waiting");
    vi.setSystemTime((waiter.deadlineAt ?? 0) + 1);
    await s.t.mutation(internal.briefPreparations.checkBriefWaiter, { waiterId: waiter._id });
    expect((await s.t.run(async (ctx) => ctx.db.get(waiter._id)))?.status).toBe("released");
    const generation = await loadGeneration(s, generationId);
    expect(generation.briefPreparation).toMatchObject({ state: "released", at: Date.now() });
    // The attempt runs on for anyone else.
    expect((await s.t.run(async (ctx) => ctx.db.get(running._id)))?.status).toBe("running");
    const view = await s.writer.query(api.seeds.getReadingFacts, { generationId });
    expect(view).toMatchObject({ count: 0, done: false, startedAt: Date.now() });
    // The run derives its own Brief, once.
    const calls = requests.length;
    expect((await adoptAtStart(s, generationId)).kind).toBe("derived");
    expect(requests).toHaveLength(calls + 1);
  });

  test("a run let go at its deadline still adopts the preparation once it is ready, with no Brief call of its own", async () => {
    const s = await setup();
    const { running, generationId, waiter } = await attached(s);
    vi.setSystemTime((waiter.deadlineAt ?? 0) + 1);
    await s.t.mutation(internal.briefPreparations.checkBriefWaiter, { waiterId: waiter._id });
    expect((await loadGeneration(s, generationId)).briefPreparation?.state).toBe("released");
    const sources = await s.t.run(async (ctx) =>
      ctx.db.query("briefPreparationSources").withIndex("by_preparationId", (q) => q.eq("preparationId", running._id)).collect()
    );
    const transcript = sources.find((row) => row.kind === "transcript")!;
    const excerpt = "The fluoropolymer seal held for 400 cycles without leaking";
    const at = transcript.content.indexOf(excerpt);
    await s.t.mutation(internal.briefPreparations.completePreparation, {
      preparationId: running._id,
      attemptId: running.attemptId!,
      storylineText: "Prepared.",
      entries: [
        {
          group: "confidenceMap", text: "Held for 400 cycles.", confidence: "established",
          sourceId: transcript._id, sourceContentHash: transcript.contentHash,
          startOffset: at, endOffset: at + excerpt.length, exactExcerpt: excerpt,
        },
      ],
      upstreamDroppedEntryCount: 0,
    });
    const calls = requests.length;
    expect((await adoptAtStart(s, generationId)).kind).toBe("adopted");
    expect(requests).toHaveLength(calls);
    expect((await loadGeneration(s, generationId)).briefPreparation).toMatchObject({
      preparationId: running._id,
      state: "adopted",
    });
  });

  test("a run let go of its wait never waits again on a still running attempt", async () => {
    const s = await setup();
    const { generationId, waiter } = await attached(s);
    vi.setSystemTime((waiter.deadlineAt ?? 0) + 1);
    await s.t.mutation(internal.briefPreparations.checkBriefWaiter, { waiterId: waiter._id });
    const calls = requests.length;
    expect((await adoptAtStart(s, generationId)).kind).toBe("derived");
    expect(requests).toHaveLength(calls + 1);
    const waiters = await s.t.run(async (ctx) =>
      ctx.db.query("briefPreparationWaiters").withIndex("by_generationId", (q) => q.eq("generationId", generationId)).collect()
    );
    expect(waiters.map((row) => row.status)).toEqual(["released"]);
  });

  test("a dead preparation action fails the attempt and lets every waiting run go (J)", async () => {
    const s = await setup();
    const { running, waiter } = await attached(s);
    await s.t.run(async (ctx) => ctx.scheduler.cancel(running.actionJobId!));
    await s.t.mutation(internal.briefPreparations.checkBriefWaiter, { waiterId: waiter._id });
    expect(await s.t.run(async (ctx) => ctx.db.get(running._id))).toMatchObject({
      status: "failed",
      failureCode: "action_failed",
    });
    expect((await s.t.run(async (ctx) => ctx.db.get(waiter._id)))?.status).toBe("released");
  });
});

describe("the Step-by-step start with a preparation (K)", () => {
  /** Cancels every pending job of one function and returns their arguments. */
  async function takeOver<Args>(s: Setup, name: string): Promise<Args[]> {
    return await s.t.run(async (ctx) => {
      const jobs = (await ctx.db.system.query("_scheduled_functions").collect()).filter(
        (job) => job.name.includes(name) && job.state.kind === "pending"
      );
      for (const job of jobs) await ctx.scheduler.cancel(job._id);
      return jobs.map((job) => job.args[0] as Args);
    });
  }

  async function pending(s: Setup, name: string) {
    return (await s.t.run(async (ctx) => ctx.db.system.query("_scheduled_functions").collect())).filter(
      (job) => job.name.includes(name) && job.state.kind === "pending"
    ).length;
  }

  /** Reserve through the real mutation and run its start action directly. */
  async function start(s: Setup) {
    const generationId = await s.writer.mutation(api.generations.requestGeneration, {
      projectId: s.projectId,
      candidateMode: "iterative",
    });
    await takeOver(s, "startIterativeGeneration");
    await s.t.action(internal.ai.iterative.startIterativeGeneration, { generationId });
    return generationId;
  }

  async function continueRun(s: Setup) {
    for (const args of await takeOver<{ generationId: Id<"generations"> }>(s, "continueAfterBriefPreparation")) {
      await s.t.action(internal.ai.iterative.continueAfterBriefPreparation, args);
    }
  }

  async function seedRows(s: Setup, generationId: Id<"generations">) {
    return await s.t.run(async (ctx) =>
      ctx.db.query("seedSubsections").withIndex("by_generationId", (q) => q.eq("generationId", generationId)).collect()
    );
  }

  test("a ready preparation: the start adopts, opens the stage once and schedules one first batch, with no Brief call", async () => {
    const s = await setup();
    await prepare(s);
    const calls = requests.length;
    const generationId = await start(s);
    expect(requests.filter((request) => JSON.stringify(request.body).includes(BRIEF_REQUEST.toolName))).toHaveLength(calls);
    const generation = await loadGeneration(s, generationId);
    expect(generation.status).toBe("awaiting_input");
    expect(generation.briefPreparation?.state).toBe("adopted");
    expect(await seedRows(s, generationId)).toHaveLength(13);
    expect(await pending(s, "startFirstBatch")).toBe(1);
  });

  test("a running preparation: the start waits, the continuation adopts and opens once, and a duplicate continuation does nothing", async () => {
    const s = await setup();
    const running = await claimOnly(s);
    await takeOver(s, "runBriefPreparation");
    const generationId = await start(s);
    let generation = await loadGeneration(s, generationId);
    expect(generation.briefPreparation?.state).toBe("attached");
    expect(generation.status).toBe("running");
    expect(await seedRows(s, generationId)).toHaveLength(0);

    // The preparation's own call, run now.
    await s.t.action(internal.ai.brief.runBriefPreparation, { preparationId: running._id, attemptId: running.attemptId! });
    expect(await pending(s, "continueAfterBriefPreparation")).toBe(1);
    await continueRun(s);
    generation = await loadGeneration(s, generationId);
    expect(generation.status).toBe("awaiting_input");
    expect(generation.briefPreparation?.state).toBe("adopted");
    expect(await seedRows(s, generationId)).toHaveLength(13);
    expect(await pending(s, "startFirstBatch")).toBe(1);
    const briefCalls = requests.length;

    // Delivered twice: nothing more.
    await s.t.action(internal.ai.iterative.continueAfterBriefPreparation, { generationId });
    expect(await seedRows(s, generationId)).toHaveLength(13);
    expect(await pending(s, "startFirstBatch")).toBe(1);
    expect(requests).toHaveLength(briefCalls);
  });

  test("a run cancelled while it waits makes no call and opens nothing", async () => {
    const s = await setup();
    const running = await claimOnly(s);
    await takeOver(s, "runBriefPreparation");
    const generationId = await start(s);
    await s.writer.mutation(api.generations.cancelIterativeGeneration, { generationId });
    await s.t.action(internal.ai.brief.runBriefPreparation, { preparationId: running._id, attemptId: running.attemptId! });
    const calls = requests.length;
    await continueRun(s);
    expect(requests).toHaveLength(calls);
    expect(await seedRows(s, generationId)).toHaveLength(0);
    expect((await loadGeneration(s, generationId)).briefId).toBeUndefined();
  });

  test("evidence that changes during the wait makes the continuation miss and derive", async () => {
    const s = await setup();
    const running = await claimOnly(s);
    await takeOver(s, "runBriefPreparation");
    const generationId = await start(s);
    await s.t.run(async (ctx) => ctx.db.patch(s.speakerId, { role: "other", roleSource: "consultant", confidence: 1 }));
    await s.t.action(internal.ai.brief.runBriefPreparation, { preparationId: running._id, attemptId: running.attemptId! });
    const calls = requests.length;
    await continueRun(s);
    expect(requests).toHaveLength(calls + 1);
    const generation = await loadGeneration(s, generationId);
    expect(generation.briefPreparation?.state).toBe("released");
    const brief = await s.t.run(async (ctx) => ctx.db.get(generation.briefId!));
    expect(brief?.preparation).toBeUndefined();
    expect(await seedRows(s, generationId)).toHaveLength(13);
  });

  test("switched off while a run waits: the continuation derives its own", async () => {
    const s = await setup();
    const running = await claimOnly(s);
    await takeOver(s, "runBriefPreparation");
    const generationId = await start(s);
    await s.t.action(internal.ai.brief.runBriefPreparation, { preparationId: running._id, attemptId: running.attemptId! });
    await switchOff(s);
    const calls = requests.length;
    await continueRun(s);
    expect(requests).toHaveLength(calls + 1);
    expect((await loadGeneration(s, generationId)).briefPreparation?.state).toBe("released");
  });

  test("a lease already expired at the start is a miss", async () => {
    const s = await setup();
    await claimOnly(s);
    await takeOver(s, "runBriefPreparation");
    vi.setSystemTime(Date.now() + 12 * 60 * 1000);
    const generationId = await reserve(s);
    expect((await adoptAtStart(s, generationId)).kind).toBe("derived");
  });

  test("a writer-edited Brief with the same inputs wins over a ready preparation", async () => {
    const s = await setup();
    await prepare(s);
    const first = await reserve(s);
    expect((await adoptAtStart(s, first)).kind).toBe("adopted");
    // The writer edits that Brief: a newer version with the same inputs.
    const editedId = await s.t.run(async (ctx) => {
      const adopted = (await ctx.db.get((await ctx.db.get(first))!.briefId!))!;
      const { _id, _creationTime, preparation, ...fields } = adopted;
      void _id; void _creationTime; void preparation;
      await ctx.db.patch(first, { status: "failed" });
      await ctx.db.patch(s.projectId, { activeGenerationId: undefined });
      return await ctx.db.insert("generationBriefs", {
        ...fields, version: adopted.version + 1, origin: "edited", storylineText: "Edited by the writer.", createdAt: Date.now(),
      });
    });
    const second = await reserve(s);
    expect((await adoptAtStart(s, second)).kind).toBe("reused");
    expect((await loadGeneration(s, second)).briefId).toBe(editedId);
  });
});

describe("stage 1 re-review follow-ups", () => {
  test("a start that read the evidence and ends on the wait limit drops older ready copies", async () => {
    const s = await setup();
    const ready = await prepare(s);
    await s.t.run(async (ctx) => ctx.db.patch(s.transcriptId, { structureBuildId: "build-stuck" }));
    await trigger(s);
    const queued = (await preparations(s)).find((row) => row.status === "queued")!;
    await s.t.run(async (ctx) => ctx.db.patch(queued._id, { deferrals: 10 }));
    await s.t.mutation(internal.briefPreparations.startBriefPreparation, { preparationId: queued._id, revision: queued.revision });
    expect(await s.t.run(async (ctx) => ctx.db.get(queued._id))).toMatchObject({
      status: "cancelled",
      endedReason: "structure_unsettled",
    });
    expect(await s.t.run(async (ctx) => ctx.db.get(ready._id))).toMatchObject({ status: "obsolete", endedReason: "superseded" });
  });

  test("an attempt whose action finds nothing to run frees the running slot at once", async () => {
    const s = await setup();
    const running = await claimOnly(s);
    await s.t.run(async (ctx) => ctx.db.patch(running._id, { status: "obsolete", endedReason: "superseded", endedAt: Date.now() }));
    await s.t.action(internal.ai.brief.runBriefPreparation, { preparationId: running._id, attemptId: running.attemptId! });
    expect(requests).toHaveLength(0);
    const after = (await s.t.run(async (ctx) => ctx.db.get(running._id)))!;
    expect(after.attemptEndedAt).toBe(Date.now());
    // The next start is not held back by the ended attempt.
    await trigger(s, "document_added");
    const queued = (await preparations(s)).find((row) => row.status === "queued")!;
    await s.t.run(async (ctx) =>
      ctx.db.insert("appSettings", { key: "transcripts.factsMode", value: "off", updatedBy: s.userId, updatedAt: Date.now() })
    );
    await addDocument(s, "later.txt", "A later cold soak note.");
    await s.t.mutation(internal.briefPreparations.startBriefPreparation, { preparationId: queued._id, revision: queued.revision });
    expect((await s.t.run(async (ctx) => ctx.db.get(queued._id)))?.status).toBe("running");
  });

  test("the start runs 5 seconds after the last change, not the first", async () => {
    const s = await setup();
    const t0 = Date.now();
    await trigger(s);
    vi.setSystemTime(t0 + 4_000);
    await trigger(s, "document_added");
    vi.advanceTimersByTime(PREPARATION_DEBOUNCE_MS + 100 - 4_000);
    await s.t.finishInProgressScheduledFunctions();
    // 5 seconds after the first change nothing has started.
    expect((await preparations(s))[0]).toMatchObject({ status: "queued", revision: 2 });
    await settle(s);
    // Only the second change's start ran, 5 seconds after it.
    const rows = await preparations(s);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("ready");
    expect(rows[0].revision).toBe(2);
    expect(rows[0].dispatchedAt).toBeGreaterThanOrEqual(t0 + 4_000 + PREPARATION_DEBOUNCE_MS);
  });

  test("uploads still arriving hold the start without reading the evidence or using up its waits", async () => {
    const s = await setup();
    const ready = await prepare(s);
    await addDocument(s, "second.txt", "A second cold soak note for a different gasket.");
    const attemptId = await s.t.run(async (ctx) =>
      ctx.db.insert("documentUploadAttempts", {
        projectId: s.projectId, attemptKey: "0b7c8a3e-1d2f-4a5b-8c9d-0e1f2a3b4c5d", fileName: "third.txt",
        origin: "context_input", status: "in_progress", createdBy: s.userId, createdAt: Date.now(), updatedAt: Date.now(),
      })
    );
    await trigger(s, "document_added");
    // Twelve waits (a minute), more than the ten shared ones: still queued,
    // and the older ready copy is kept since no evidence was read.
    for (let wait = 0; wait < 12; wait += 1) {
      await s.t.run(async (ctx) => ctx.db.patch(attemptId, { updatedAt: Date.now() }));
      vi.advanceTimersByTime(PREPARATION_DEBOUNCE_MS + 10);
      await s.t.finishInProgressScheduledFunctions();
    }
    const queued = (await preparations(s)).find((row) => row._id !== ready._id)!;
    expect(queued).toMatchObject({ status: "queued", waitingFor: "uploads", uploadWaits: 12 });
    expect(queued.deferrals ?? 0).toBe(0);
    expect((await s.t.run(async (ctx) => ctx.db.get(ready._id)))?.status).toBe("ready");
    // The batch ends: the start reads the evidence and prepares it.
    await s.t.run(async (ctx) => ctx.db.patch(attemptId, { status: "succeeded", updatedAt: Date.now() }));
    await settle(s);
    expect((await s.t.run(async (ctx) => ctx.db.get(queued._id)))?.status).toBe("ready");
    expect((await s.t.run(async (ctx) => ctx.db.get(ready._id)))?.status).toBe("obsolete");
  });
});
