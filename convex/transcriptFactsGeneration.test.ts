/// <reference types="vite/client" />

/**
 * A generation that reads fact packs (phase 3, the transcript method; plan
 * steps 7 and 8), driven through the real iterative entry action with only
 * `fetch` stubbed. Covers facts that are ready before the generation, facts
 * extracted inside it, the fallback when extraction fails, and the flag off.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { allGenerationProgress } from "./lib/generationProgress";
import type { Id } from "./_generated/dataModel";
import { resetGenerationModelCache, resetGenerationPlaceholderCache } from "./ai/providers";

const modules = import.meta.glob("./**/*.ts");

const CONTENT = [
  "Dana Whitfield: What made the forecast hard?",
  "Priya Shah: We couldn't forecast net load fast enough when cloud cover changed.",
  "Dana Whitfield: And the result?",
  "Priya Shah: The model hit 71 percent accuracy on sunny days and 38 percent on cloudy days.",
].join("\n\n");

type Body = {
  model: string;
  system?: unknown;
  tool_choice?: { name: string };
  messages: Array<{ content: unknown }>;
};

function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((block) => {
      if (!block || typeof block !== "object") return "";
      if ("text" in block && typeof block.text === "string") return block.text;
      if ("source" in block && block.source && typeof block.source === "object" && "content" in block.source) {
        return text((block.source as { content: unknown }).content);
      }
      return "";
    })
    .join("");
}

function message(content: unknown[], stop = "tool_use") {
  return Response.json({
    id: "msg_generation_facts",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5",
    content,
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: 50, output_tokens: 20 },
  });
}

/** Citations-mode extraction answer for CONTENT (turn blocks 1 and 3). */
function factsAnswer() {
  return message(
    [
      { type: "text", text: "uncertainty | " },
      {
        type: "text",
        text: "They could not forecast net load fast enough when cloud cover changed",
        citations: [
          {
            type: "content_block_location",
            cited_text: "We couldn't forecast net load fast enough when cloud cover changed.",
            document_index: 0,
            document_title: "Interview transcript window",
            start_block_index: 1,
            end_block_index: 2,
          },
        ],
      },
      { type: "text", text: "\nresult | " },
      {
        type: "text",
        text: "Accuracy was 71 percent on sunny days and 38 percent on cloudy days",
        citations: [
          {
            type: "content_block_location",
            cited_text: "hit 71 percent accuracy on sunny days and 38 percent on cloudy days",
            document_index: 0,
            document_title: "Interview transcript window",
            start_block_index: 3,
            end_block_index: 4,
          },
        ],
      },
    ],
    "end_turn"
  );
}

function toolAnswer(name: string, input: unknown) {
  return message([{ type: "tool_use", id: `tool_${name}`, name, input }]);
}

const ANALYSIS = {
  company_context: "An energy analytics firm.",
  project_goal: "Forecast net load.",
  business_problem: "Unstable forecasts.",
  scientific_technical_problem: "Net load could not be forecast under cloud cover.",
  technological_objective: "A fast net load forecast.",
  work_performed: {},
  project_status: "completed",
};

type Network = {
  calls: Array<{ kind: string; body: Body }>;
  failFacts: boolean;
};

function stubNetwork(network: Network) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      if (!request.url.includes("anthropic")) return new Response("offline", { status: 503 });
      const body = (await request.json()) as Body;
      const tool = body.tool_choice?.name;
      if (!tool) {
        network.calls.push({ kind: "facts", body });
        return network.failFacts ? new Response("bad", { status: 400 }) : factsAnswer();
      }
      network.calls.push({ kind: tool, body });
      if (tool === "submit_transcript_analysis") return toolAnswer(tool, ANALYSIS);
      if (tool === "submit_retrieval_brief") {
        return toolAnswer(tool, { problem: "p", uncertainty: "u", work: "w", advancement: "a" });
      }
      if (tool === "submit_generation_brief") {
        return toolAnswer(tool, {
          storyline: "The team could not forecast net load under cloud cover.",
          storylineClaims: [
            // Quoted from the pack, where the pack printed it on one line.
            { text: "Forecasts failed when clouds moved.", quote: "We couldn't forecast net load fast enough when cloud cover changed." },
          ],
          claimExclusions: [],
          confidenceMap: [
            { text: "Accuracy numbers.", quote: "hit 71 percent accuracy on sunny days", confidence: "established" },
            // Outside every verified span (the interviewer's question): never cited.
            { text: "The difficulty.", quote: "What made the forecast hard?", confidence: "partial" },
          ],
          glossaryTerms: [],
        });
      }
      return new Response("unexpected tool", { status: 400 });
    })
  );
}

async function setup(mode: "off" | "long" | "all") {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const writerId = await ctx.db.insert("users", { authId: "gf-writer", role: "writer", firstName: "Wren" });
    const projectId = await ctx.db.insert("projects", {
      title: "Helios",
      clientName: "Verdant Grid",
      status: "draft",
      createdBy: writerId,
      shareToken: "gf-token",
      createdAt: 1,
      updatedAt: 1,
      interviewer: "Dana Whitfield",
      interviewees: ["Priya Shah"],
    });
    await ctx.db.insert("appSettings", { key: "transcripts.factsMode", value: mode, updatedBy: writerId, updatedAt: 1 });
    return { writerId, projectId };
  });
  const writer = t.withIdentity({ subject: "gf-writer" });
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected HTTP transport"); }));
  const transcriptId = await writer.mutation(api.transcripts.addTranscript, {
    projectId: ids.projectId,
    content: CONTENT,
    label: "call.txt",
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  return { t, writer, transcriptId, ...ids };
}

async function generate(f: Awaited<ReturnType<typeof setup>>) {
  const generationId: Id<"generations"> = await f.writer.mutation(api.generations.requestGeneration, {
    projectId: f.projectId,
    candidateMode: "iterative",
  });
  // The reserved entry action, run to its end: analysis, Brief and the seed
  // stage. Nothing else scheduled is needed here.
  await f.t.action(internal.ai.iterative.startIterativeGeneration, { generationId });
  const state = await f.t.run(async (ctx) => ({
    generation: await ctx.db.get(generationId),
    progress: await allGenerationProgress(ctx, generationId),
    sources: await ctx.db
      .query("generationSources")
      .withIndex("by_generationId", (q) => q.eq("generationId", generationId))
      .collect(),
    entries: await ctx.db.query("generationBriefEntries").collect(),
    subsections: await ctx.db
      .query("seedSubsections")
      .withIndex("by_generationId", (q) => q.eq("generationId", generationId))
      .collect(),
  }));
  return { generationId, ...state };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-generation-facts-key");
  resetGenerationModelCache();
  resetGenerationPlaceholderCache();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("a generation frozen to read facts", () => {
  it("freezes the pack of ready facts, feeds it to the analyzer and the Brief, and cites the transcript row", async () => {
    const f = await setup("all");
    const network: Network = { calls: [], failFacts: false };
    stubNetwork(network);
    await f.writer.mutation(api.transcripts.requestTranscriptFacts, { transcriptId: f.transcriptId });
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(network.calls.map((call) => call.kind)).toEqual(["facts"]);
    network.calls = [];

    const result = await generate(f);
    expect(result.generation?.transcriptFacts).toBe(true);
    // Ready facts are reused: no extraction inside the generation.
    expect(network.calls.map((call) => call.kind)).not.toContain("facts");
    const transcriptRow = result.sources.find((row) => row.kind === "transcript")!;
    const pack = result.sources.find((row) => row.kind === "transcript_facts")!;
    expect(pack.content).toContain("[F1-1] (uncertainty)");
    expect(pack.factSpans?.map((span) => span.id)).toEqual(["F1-1", "F1-2"]);
    for (const span of pack.factSpans ?? []) {
      for (const quote of span.quotes) expect(quote.role).toBe("client");
    }

    // The analyzer reads the pack, not the text, and every name is a
    // placeholder (decision 26).
    const analyzer = network.calls.find((call) => call.kind === "submit_transcript_analysis")!;
    const analyzerText = text(analyzer.body.messages[0].content);
    expect(analyzerText).toContain("[F1-1] (uncertainty)");
    expect(analyzerText).not.toContain("What made the forecast hard?");
    expect(analyzerText).not.toContain("Priya");
    expect(transcriptRow.content).toBe(CONTENT);
    const brief = network.calls.find((call) => call.kind === "submit_generation_brief")!;
    const briefText = text(brief.body.messages[0].content);
    expect(briefText).toContain("SOURCE_KIND=transcript_facts");
    expect(briefText).not.toContain("What made the forecast hard?");
    // Plan step 8: the retrieval brief is built from the facts, no call.
    expect(network.calls.map((call) => call.kind)).not.toContain("submit_retrieval_brief");

    // Brief quotes read from the pack cite the frozen transcript row, inside
    // a verified client span.
    const cited = result.entries.filter((entry) => entry.group !== "glossaryTerm");
    expect(cited.map((entry) => entry.group).sort()).toEqual(["confidenceMap", "storyline"]);
    expect(cited.map((entry) => entry.exactExcerpt)).not.toContain("What made the forecast hard?");
    for (const entry of cited) {
      expect(entry.sourceId).toBe(transcriptRow._id);
      expect(transcriptRow.content.slice(entry.startOffset, entry.endOffset)).toBe(entry.exactExcerpt);
    }
    expect(result.subsections).toHaveLength(13);
  });

  it("extracts missing facts inside the generation, then drafts from the pack", async () => {
    const f = await setup("all");
    const network: Network = { calls: [], failFacts: false };
    stubNetwork(network);
    const result = await generate(f);
    expect(network.calls[0].kind).toBe("facts");
    expect(network.calls.filter((call) => call.kind === "facts")).toHaveLength(1);
    expect(result.sources.some((row) => row.kind === "transcript_facts")).toBe(true);
    expect(result.progress.join("\n")).toContain("Drafting from the verified facts of 1 transcript.");
  });

  it("falls back to the transcript text when extraction fails, and the draft still runs", async () => {
    const f = await setup("all");
    const network: Network = { calls: [], failFacts: true };
    stubNetwork(network);
    const result = await generate(f);
    expect(result.sources.some((row) => row.kind === "transcript_facts")).toBe(false);
    const analyzer = network.calls.find((call) => call.kind === "submit_transcript_analysis")!;
    expect(text(analyzer.body.messages[0].content)).toContain("What made the forecast hard?");
    // Today's path: the retrieval brief call runs as before.
    expect(network.calls.map((call) => call.kind)).toContain("submit_retrieval_brief");
    expect(result.subsections).toHaveLength(13);
  });

  it("changes nothing while the setting is off, and small projects wait for `all`", async () => {
    for (const mode of ["off", "long"] as const) {
      const f = await setup(mode);
      const network: Network = { calls: [], failFacts: false };
      stubNetwork(network);
      const result = await generate(f);
      expect(result.generation?.transcriptFacts).toBeUndefined();
      expect(network.calls.map((call) => call.kind)).not.toContain("facts");
      expect(result.sources.some((row) => row.kind === "transcript_facts")).toBe(false);
      const analyzer = network.calls.find((call) => call.kind === "submit_transcript_analysis")!;
      expect(text(analyzer.body.messages[0].content)).toContain("What made the forecast hard?");
      vi.unstubAllGlobals();
      resetGenerationModelCache();
      resetGenerationPlaceholderCache();
    }
  });
});
