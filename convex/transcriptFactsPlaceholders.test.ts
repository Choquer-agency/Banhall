/// <reference types="vite/client" />

/**
 * One placeholder map per extraction (review 2026-09-25, P1). A generation
 * with two transcripts extracts facts on an OpenRouter model (the structured
 * adapter), with only `fetch` stubbed: every window is hidden and every
 * answer restored with the same map, so a claim names the right person.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { ensureFactInputs } from "./ai/condense";
import { resetGenerationModelCache, resetGenerationPlaceholderCache } from "./ai/providers";
import { FACTS_VERSION } from "./lib/transcriptFacts";

const modules = import.meta.glob("./**/*.ts");
const OPENROUTER_MODEL = "openai/gpt-5.6-sol";

const FIRST = [
  "Dana Whitfield: What made the forecast hard?",
  "Priya Shah: We couldn't forecast net load fast enough when cloud cover changed.",
].join("\n\n");
const SECOND = [
  "Dana Whitfield: What did the second trial show?",
  "Sam Okafor: We measured 38 percent after Dana Whitfield retrained the model on feeder data.",
].join("\n\n");

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-placeholder-facts-key");
  vi.stubEnv("OPENROUTER_API_KEY", "synthetic-placeholder-facts-openrouter");
  resetGenerationModelCache();
  resetGenerationPlaceholderCache();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/**
 * The structured adapter's answer for one window: one fact per client turn,
 * its claim and quote copied from the turn line exactly as the model saw
 * it, placeholders included.
 */
function openRouterAnswer(requestBody: string) {
  const body = JSON.parse(requestBody) as { messages: Array<{ role: string; content: string }> };
  const user = body.messages.find((message) => message.role === "user")!.content;
  const facts = [...user.matchAll(/^\[(T\d{4})\] \(client\) ([^:\n]+): (.+)$/gm)].map((match) => ({
    type: "result",
    claim: `${match[2]} said: ${match[3]}`,
    turnIds: [match[1]],
    quotes: [match[3]],
  }));
  return Response.json({
    choices: [
      {
        message: {
          content: null,
          tool_calls: [{ id: "call-facts", function: { name: "record_transcript_facts", arguments: JSON.stringify({ facts }) } }],
        },
        finish_reason: "tool_calls",
      },
    ],
    usage: { prompt_tokens: 200, completion_tokens: 50, cost: 0.001 },
  });
}

describe("fact extraction inside a generation uses one placeholder map", () => {
  it("restores each claim to the person who said it, across two transcripts", async () => {
    const t = convexTest(schema, modules);
    const { projectId } = await t.run(async (ctx) => {
      const writerId = await ctx.db.insert("users", { authId: "pf-writer", role: "writer" });
      const projectId = await ctx.db.insert("projects", {
        title: "Helios",
        clientName: "Verdant Grid",
        status: "draft",
        createdBy: writerId,
        ownerId: writerId,
        shareToken: "pf-token",
        createdAt: 1,
        updatedAt: 1,
        interviewer: "Dana Whitfield",
      });
      await ctx.db.insert("appSettings", { key: "transcripts.factsMode", value: "all", updatedBy: writerId, updatedAt: 1 });
      return { projectId };
    });
    const writer = t.withIdentity({ subject: "pf-writer" });
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected HTTP transport"); }));
    const firstId = await writer.mutation(api.transcripts.addTranscript, { projectId, content: FIRST, label: "first.txt" });
    const secondId = await writer.mutation(api.transcripts.addTranscript, { projectId, content: SECOND, label: "second.txt" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const generationId: Id<"generations"> = await writer.mutation(api.generations.requestGeneration, {
      projectId,
      candidateMode: "iterative",
    });
    const frozen = await t.run(async (ctx) => (await ctx.db.get(generationId))!.placeholders ?? []);
    // The generation's own map numbers Sam after Priya; a per-transcript map
    // would not, which is what used to garble the claim.
    expect(frozen.find((entry) => entry.value === "Sam Okafor")?.token).toBe("[PERSON_3]");

    const bodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        if (!request.url.includes("openrouter.ai")) throw new Error(`Unexpected ${request.url}`);
        const text = await request.text();
        bodies.push(text);
        return openRouterAnswer(text);
      })
    );
    const ready = await t.action(async (ctx) =>
      ensureFactInputs(ctx, { generationId, elapsedMs: 0, modelId: OPENROUTER_MODEL }, async () => null)
    );
    expect(ready).toBe(true);
    expect(bodies).toHaveLength(2);
    for (const body of bodies) {
      for (const name of ["Dana", "Whitfield", "Priya", "Sam", "Okafor", "Verdant"]) expect(body).not.toContain(name);
    }

    const facts = await t.run(async (ctx) => {
      const of = async (transcriptId: Id<"transcripts">) =>
        ctx.db
          .query("transcriptFacts")
          .withIndex("by_transcriptId_and_factsVersion", (q) => q.eq("transcriptId", transcriptId).eq("factsVersion", FACTS_VERSION))
          .collect();
      return { first: await of(firstId), second: await of(secondId) };
    });
    expect(facts.first.map((fact) => fact.claim)).toEqual([
      "Priya Shah said: We couldn't forecast net load fast enough when cloud cover changed.",
    ]);
    expect(facts.second.map((fact) => fact.claim)).toEqual([
      "Sam Okafor said: We measured 38 percent after Dana Whitfield retrained the model on feeder data.",
    ]);
    expect(facts.second[0].quotes[0].exactExcerpt).toBe(
      "We measured 38 percent after Dana Whitfield retrained the model on feeder data."
    );
    const runs = await t.run((ctx) => ctx.db.query("transcriptFactRuns").collect());
    expect(runs.map((run) => [run.adapter, run.status])).toEqual([
      ["structured", "ready"],
      ["structured", "ready"],
    ]);
    // The facts pack froze for both transcripts.
    const sources = await t.run((ctx) =>
      ctx.db
        .query("generationSources")
        .withIndex("by_generationId", (q) => q.eq("generationId", generationId))
        .collect()
    );
    expect(sources.filter((row) => row.kind === "transcript_facts")).toHaveLength(2);
    await t.mutation(internal.generations.failGeneration, { generationId, error: "test done" });
  });
});
