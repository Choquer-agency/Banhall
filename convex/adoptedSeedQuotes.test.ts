/// <reference types="vite/client" />
/**
 * Regression (timing test 2026-09-26, run A): the first Seed batch of a run
 * that adopted a draft-prepared Brief must place and underline its quotes
 * exactly as a run that derived the same Brief itself. Both runs read the
 * same fictional transcript and get the same model answers at the SDK's
 * HTTP boundary (fetch stubbed): the Brief, then the first batch, whose
 * quotes are given with wrong offsets on purpose so the locator places
 * them. The seeds' citations (line, speaker, offsets, excerpt) and the
 * card's underline spans must be the same.
 */
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { anthropicToolSse, sseResponse } from "./anthropicSse.fixture";
import { BRIEF_REQUEST } from "./lib/briefRequest";
import { intakeDraftRefs } from "./lib/intakeDraftRefs";
import { INTAKE_DEBOUNCE_MS } from "./lib/intakeDrafts";
import { resetGenerationModelCache, resetGenerationPlaceholderCache } from "./ai/providers";
import { findExactQuoteSpans } from "../src/lib/components/seeds/exactQuote";

const modules = import.meta.glob("./**/*.ts");

const TRANSCRIPT = [
  "Northwind Test Labs - SR&ED interview, fiscal year ending June 30, 2025",
  "Project: Low-temperature structural bonding of composite sensor brackets",
  "Recorded September 18. Fictional transcript for testing only.",
  "",
  "Dana Whitfield: What does the company do, and where did this project come from?",
  "",
  "Maren Kowalczyk: We are a test and instrumentation company. We design and install sensor packages for customers who need long-term structural monitoring.",
  "",
  "Elliot Fairbanks: Historically we attached them mechanically. Drill, tap, bolt. More and more of our customers put it in the contract that we cannot drill.",
  "",
  "Dana Whitfield: Why not heating blankets?",
  "",
  "Elliot Fairbanks: One customer caps any surface heat source at thirty-five degrees and wants it attended the whole time.",
].join("\n");

const QUOTES = [
  "We design and install sensor packages for customers who need long-term structural monitoring",
  "our customers put it in the contract that we cannot drill",
  "One customer caps any surface heat source at thirty-five degrees",
];

const BRIEF_ANSWER = {
  storyline: "The team had to bond sensor brackets without drilling or heat.",
  storylineClaims: [
    { text: "Customers forbid drilling.", quote: QUOTES[1] },
    { text: "Heat sources are capped.", quote: QUOTES[2] },
  ],
  claimExclusions: [],
  confidenceMap: [{ text: "The company installs sensor packages.", quote: QUOTES[0], confidence: "established" }],
  glossaryTerms: [],
};

/** The same first batch for both runs; offsets are wrong, the excerpts exact. */
function seedAnswer(sourceId: string) {
  return {
    seeds: [
      {
        bullets: ["The company is a test and instrumentation firm that will design and install sensor packages for customers who need long-term structural monitoring."],
        tags: ["technical"],
        provenance: [{ sourceId, startOffset: 0, endOffset: 5, exactExcerpt: QUOTES[0] }],
      },
      {
        bullets: ["More and more of our customers put it in the contract that we cannot drill, so bonding replaced bolts."],
        tags: ["detailed"],
        provenance: [{ sourceId, startOffset: 3, endOffset: 9, exactExcerpt: QUOTES[1] }],
      },
      {
        bullets: ["One customer caps any surface heat source at thirty-five degrees, which rules out heating blankets."],
        tags: ["conservative"],
        provenance: [{ sourceId, startOffset: 7, endOffset: 11, exactExcerpt: QUOTES[2] }],
      },
    ],
  };
}

function toolMessage(model: string, name: string, input: unknown) {
  return Response.json({
    id: `msg_${name}`,
    type: "message",
    role: "assistant",
    model,
    content: [{ type: "tool_use", id: "tool_1", name, input }],
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 50 },
  });
}

let briefCalls = 0;
let currentSourceId = "";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-26T15:00:00Z"));
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-adoption-key");
  resetGenerationModelCache();
  resetGenerationPlaceholderCache();
  briefCalls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const text = await request.text();
      const body = JSON.parse(text) as { model: string; tools?: Array<{ name: string }> };
      const tool = body.tools?.[0]?.name ?? "";
      if (tool === "submit_seed_batch") {
        // The frozen source the batch cites (the test sets it: test ids are
        // not written into the prompt verbatim).
        return toolMessage(body.model, tool, seedAnswer(currentSourceId));
      }
      if (tool === "record_speaker_roles") return toolMessage(body.model, tool, { speakers: [] });
      if (tool === BRIEF_REQUEST.toolName) briefCalls += 1;
      return sseResponse(
        anthropicToolSse({ model: body.model, tool: BRIEF_REQUEST.toolName, input: BRIEF_ANSWER })
      );
    })
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

type T = ReturnType<typeof convexTest<typeof schema.tables>>;

async function drain(t: T, steps = 12) {
  for (let step = 0; step < steps; step += 1) {
    vi.advanceTimersByTime(INTAKE_DEBOUNCE_MS + 100);
    await t.finishInProgressScheduledFunctions();
  }
}

/** Cancels every pending job of one function and returns their arguments. */
async function takeOver<Args>(t: T, name: string): Promise<Args[]> {
  return await t.run(async (ctx) => {
    const jobs = (await ctx.db.system.query("_scheduled_functions").collect()).filter(
      (job) => job.name.includes(name) && job.state.kind === "pending"
    );
    for (const job of jobs) await ctx.scheduler.cancel(job._id);
    return jobs.map((job) => job.args[0] as Args);
  });
}

/** Reserve, run the Step-by-step start, then the first Seed batch; returns what the cards show. */
async function firstBatch(t: T, writer: ReturnType<T["withIdentity"]>, projectId: Id<"projects">) {
  const generationId = await writer.mutation(api.generations.requestGeneration, { projectId, candidateMode: "iterative" });
  await takeOver(t, "startIterativeGeneration");
  await t.action(internal.ai.iterative.startIterativeGeneration, { generationId });
  for (const args of await takeOver<{ generationId: Id<"generations"> }>(t, "startFirstBatch")) {
    await t.mutation(internal.seedRuns.startFirstBatch, args);
  }
  currentSourceId = await t.run(async (ctx) => {
    const source = await ctx.db
      .query("generationSources")
      .withIndex("by_generationId", (q) => q.eq("generationId", generationId))
      .first();
    return source!._id;
  });
  for (const args of await takeOver<{ batchId: Id<"seedBatches"> }>(t, "generateBatch")) {
    await t.action(internal.ai.seeds.generateBatch, args);
  }
  return await t.run(async (ctx) => {
    const generation = (await ctx.db.get(generationId))!;
    const seeds = await ctx.db.query("seeds").withIndex("by_generationId_and_roleId", (q) => q.eq("generationId", generationId)).collect();
    const cards = [];
    for (const seed of seeds.sort((a, b) => a.order - b.order)) {
      const provenance = await ctx.db.query("seedProvenance").withIndex("by_seedId", (q) => q.eq("seedId", seed._id)).collect();
      const excerpts = provenance.map((row) => row.exactExcerpt);
      cards.push({
        bullets: seed.bullets,
        citations: provenance.map((row) => ({
          line: row.line,
          speaker: row.speaker,
          startOffset: row.startOffset,
          endOffset: row.endOffset,
          exactExcerpt: row.exactExcerpt,
        })),
        underlines: seed.bullets.map((bullet) => findExactQuoteSpans(bullet, excerpts)),
      });
    }
    return { adopted: generation.briefPreparation?.state === "adopted", cards };
  });
}

test("a run that adopts a draft-prepared Brief places and underlines its first ideas' quotes as a run that derived its own", async () => {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  await t.run(async (ctx) => ctx.db.insert("users", { authId: "quotes-writer", role: "writer", name: "Wren Writer" }));
  const writer = t.withIdentity({ subject: "quotes-writer" });
  const project = { title: "Composite bonding", clientName: "Northwind Test Labs", interviewees: ["Maren Kowalczyk", "Elliot Fairbanks"] };

  // Run A: saved while setting up, prepared, promoted, adopted.
  const draftId = await writer.mutation(intakeDraftRefs.createIntakeDraft, {});
  await writer.mutation(intakeDraftRefs.saveIntakeSource, {
    draftId, sourceKey: "northwind-key-1", kind: "transcript", position: 0,
    label: "Northwind interview, Sep 18.txt", content: TRANSCRIPT, sourceFormat: "txt",
  });
  await writer.mutation(intakeDraftRefs.updateIntakeContext, {
    draftId, clientName: project.clientName, interviewees: project.interviewees,
  });
  await drain(t);
  expect(briefCalls).toBe(1);
  const receipt = await writer.mutation(intakeDraftRefs.promoteIntakeDraft, {
    draftId, commandId: "quotes-a", sourceKeys: ["northwind-key-1"], project,
  });
  if ("ended" in receipt) throw new Error("ended");
  await drain(t, 3);
  const adopted = await firstBatch(t, writer, receipt.projectId);
  expect(adopted.adopted).toBe(true);
  expect(briefCalls).toBe(1);

  // Run B: the same transcript on a project with no preparation.
  await t.run(async (ctx) =>
    ctx.db.insert("appSettings", { key: "briefPreparation.enabled", value: "off", updatedBy: (await ctx.db.query("users").first())!._id, updatedAt: Date.now() })
  );
  const created = await writer.mutation(api.projects.createProject, {
    ...project,
    mode: "generate",
    transcripts: [{ content: TRANSCRIPT, label: "Northwind interview, Sep 18.txt", sourceFormat: "txt" }],
  });
  await drain(t, 3);
  const own = await firstBatch(t, writer, created.projectId);
  expect(own.adopted).toBe(false);
  expect(briefCalls).toBe(2);

  // The same quotes, on the same lines, underlined the same way.
  expect(adopted.cards).toEqual(own.cards);
  expect(adopted.cards).toHaveLength(3);
  for (const card of adopted.cards) {
    expect(card.citations).toHaveLength(1);
    expect(card.underlines.flat().length).toBeGreaterThan(0);
  }
  expect(adopted.cards.map((card) => card.citations[0].line)).toEqual([7, 9, 13]);
});
