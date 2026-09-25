/// <reference types="vite/client" />

/**
 * The fallbacks of a generation frozen to read facts (review 2026-09-25,
 * missing regression tests): each case returns false, makes no model call,
 * and leaves today's path to the draft. Only `fetch` is stubbed.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getConvexSize } from "convex/values";
import { api, internal } from "./_generated/api";
import { TRANSCRIPT_PARSER_VERSION } from "../shared/transcriptParse";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { ensureFactInputs } from "./ai/condense";
import { resetGenerationModelCache, resetGenerationPlaceholderCache } from "./ai/providers";
import { MAX_FACT_PACK_ROW_BYTES } from "./transcriptDigests";
import { sha256 } from "./lib/contracts";
import { FACT_PACK_MAX_CHARS, FACTS_VERSION } from "./lib/transcriptFacts";

const modules = import.meta.glob("./**/*.ts");
type T = ReturnType<typeof convexTest<typeof schema.tables>>;

const CONTENT = [
  "Dana Whitfield: What made the forecast hard?",
  "Priya Shah: We couldn't forecast net load fast enough when cloud cover changed.",
].join("\n\n");

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-fallback-key");
  resetGenerationModelCache();
  resetGenerationPlaceholderCache();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function reserved(options: { beforeReserve?: (t: T, transcriptId: Id<"transcripts">) => Promise<void> } = {}) {
  const t = convexTest(schema, modules);
  const { projectId } = await t.run(async (ctx) => {
    const writerId = await ctx.db.insert("users", { authId: "fb-writer", role: "writer" });
    const projectId = await ctx.db.insert("projects", {
      title: "Helios",
      clientName: "Verdant Grid",
      status: "draft",
      createdBy: writerId,
      shareToken: "fb-token",
      createdAt: 1,
      updatedAt: 1,
      interviewer: "Dana Whitfield",
      interviewees: ["Priya Shah"],
    });
    await ctx.db.insert("appSettings", { key: "transcripts.factsMode", value: "all", updatedBy: writerId, updatedAt: 1 });
    return { projectId };
  });
  const writer = t.withIdentity({ subject: "fb-writer" });
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected HTTP transport"); }));
  const transcriptId = await writer.mutation(api.transcripts.addTranscript, { projectId, content: CONTENT, label: "call.txt" });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  await options.beforeReserve?.(t, transcriptId);
  const generationId: Id<"generations"> = await writer.mutation(api.generations.requestGeneration, {
    projectId,
    candidateMode: "iterative",
  });
  const fetchMock = vi.fn(() => { throw new Error("No model call expected"); });
  vi.stubGlobal("fetch", fetchMock);
  return { t, projectId, transcriptId, generationId, fetchMock };
}

async function run(t: T, generationId: Id<"generations">, elapsedMs = 0) {
  const lines: string[] = [];
  const ready = await t.action(async (ctx) =>
    ensureFactInputs(ctx, { generationId, elapsedMs, modelId: "claude-sonnet-5" }, async (line) => {
      lines.push(line);
    })
  );
  const packs = await t.run(async (ctx) =>
    (await ctx.db
      .query("generationSources")
      .withIndex("by_generationId", (q) => q.eq("generationId", generationId))
      .collect()).filter((row) => row.kind === "transcript_facts")
  );
  return { ready, lines, packs };
}

describe("ensureFactInputs falls back to today's path", () => {
  it("when an older parser built the transcript's turns, and reserving starts their rebuild once", async () => {
    const f = await reserved({
      beforeReserve: async (t, transcriptId) => {
        await t.run(async (ctx) => {
          for (const turn of await ctx.db
            .query("transcriptTurns")
            .withIndex("by_transcriptId_and_index", (q) => q.eq("transcriptId", transcriptId))
            .collect()) {
            await ctx.db.patch(turn._id, { parserVersion: "1" });
          }
          await ctx.db.patch(transcriptId, { parserVersion: "1" });
        });
      },
    });
    const rebuilds = await f.t.run(async (ctx) =>
      (await ctx.db.system.query("_scheduled_functions").collect()).filter(
        (job) => job.name.includes("buildTranscriptStructure") && job.state.kind === "pending"
      )
    );
    expect(rebuilds.map((job) => job.args[0])).toEqual([{ transcriptId: f.transcriptId }]);
    const result = await run(f.t, f.generationId);
    expect(result).toMatchObject({ ready: false, packs: [] });
    expect(result.lines[0]).toContain("is not ready to be read as verified facts");
    expect(f.fetchMock).not.toHaveBeenCalled();
  });

  it("when a transcript was cut at freeze", async () => {
    const f = await reserved();
    await f.t.run(async (ctx) => {
      const source = (await ctx.db
        .query("generationSources")
        .withIndex("by_generationId", (q) => q.eq("generationId", f.generationId))
        .collect()).find((row) => row.kind === "transcript")!;
      await ctx.db.patch(source._id, { truncated: true });
    });
    const result = await run(f.t, f.generationId);
    expect(result).toMatchObject({ ready: false, packs: [] });
    expect(result.lines[0]).toContain("cannot be read as verified facts");
    expect(f.fetchMock).not.toHaveBeenCalled();
  });

  it("when the transcript's text changed since the freeze", async () => {
    const f = await reserved();
    await f.t.run(async (ctx) => {
      const changed = `${CONTENT}\n\nPriya Shah: One more thing.`;
      await ctx.db.patch(f.transcriptId, { content: changed, contentHash: await sha256(changed) });
    });
    const result = await run(f.t, f.generationId);
    expect(result).toMatchObject({ ready: false, packs: [] });
    expect(f.fetchMock).not.toHaveBeenCalled();
  });

  it("when another extraction of the same text is still running", async () => {
    const f = await reserved();
    await f.t.run(async (ctx) => {
      await ctx.db.insert("transcriptFactRuns", {
        transcriptId: f.transcriptId,
        projectId: f.projectId,
        sourceContentHash: await sha256(CONTENT),
        factsVersion: FACTS_VERSION,
        model: "claude-sonnet-5",
        status: "running",
        counts: { proposed: 0, verified: 0, dropped: 0 },
        startedAt: Date.now(),
      });
    });
    const result = await run(f.t, f.generationId);
    expect(result).toMatchObject({ ready: false, packs: [] });
    expect(result.lines[0]).toContain("still being prepared");
    expect(f.fetchMock).not.toHaveBeenCalled();
  });

  it("when extraction would not leave time for the rest of the draft, and queues it for the next one", async () => {
    const f = await reserved();
    const result = await run(f.t, f.generationId, 450_000);
    expect(result).toMatchObject({ ready: false, packs: [] });
    expect(result.lines[0]).toContain("Facts are being prepared for the next draft.");
    expect(f.fetchMock).not.toHaveBeenCalled();
    const jobs = await f.t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(
      jobs.filter((job) => job.name === "ai/condense:extractTranscriptFactsInBackground" && job.args[0]?.transcriptId === f.transcriptId)
    ).toHaveLength(1);
  });
});

describe("a pack row near the 1 MiB document limit (review 2026-09-25, P3-2)", () => {
  /**
   * A transcript whose speaker label and quotes are Chinese: three bytes a
   * character, so a pack at its character cap, with the spans behind every
   * fact it shows, would pass the document limit.
   */
  async function bigPack(label: string, shape: { quotesPerFact: number; claim: (fact: number) => string }) {
    const t = convexTest(schema, modules);
    const quotes = Array.from({ length: 6_000 }, (_, i) =>
      Array.from({ length: 12 }, (_, k) => String.fromCharCode(0x4e00 + ((i * 12 + k) % 20_000))).join("")
    );
    const content = `${label}: ${quotes.join(" ")}`;
    const ids = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { authId: "big-writer", role: "writer" });
      const projectId = await ctx.db.insert("projects", {
        title: "Big",
        clientName: "Client",
        status: "generating",
        createdBy: userId,
        shareToken: crypto.randomUUID(),
        createdAt: 1,
        updatedAt: 1,
      });
      const hash = await sha256(content);
      const transcriptId = await ctx.db.insert("transcripts", {
        projectId,
        content,
        contentHash: hash,
        createdAt: 1,
        position: 0,
        parserVersion: TRANSCRIPT_PARSER_VERSION,
      });
      const generationId = await ctx.db.insert("generations", {
        projectId,
        transcriptId,
        transcriptIds: [transcriptId],
        transcriptFacts: true,
        status: "running",
        startedAt: 1,
      });
      await ctx.db.insert("generationSources", {
        generationId,
        projectId,
        kind: "transcript",
        transcriptId,
        label: "Big call",
        content,
        contentHash: hash,
        truncated: false,
        originalLength: content.length,
        capturedAt: 1,
      });
      await ctx.db.insert("transcriptFactRuns", {
        transcriptId,
        projectId,
        sourceContentHash: hash,
        factsVersion: FACTS_VERSION,
        model: "claude-sonnet-5",
        status: "ready",
        counts: { proposed: 1_200, verified: 1_200, dropped: 0 },
        startedAt: 1,
        finishedAt: 2,
        // Facts index turns of the current parser version (a run from an
        // older parser is stale).
        parserVersion: TRANSCRIPT_PARSER_VERSION,
      });
      let at = label.length + 2;
      for (let fact = 0; fact < 1_200; fact += 1) {
        const factQuotes = quotes.slice(fact * shape.quotesPerFact, (fact + 1) * shape.quotesPerFact).map((quote) => {
          const charStart = content.indexOf(quote, at);
          at = charStart + quote.length;
          return { charStart, charEnd: charStart + quote.length, exactExcerpt: quote, match: "exact" as const };
        });
        await ctx.db.insert("transcriptFacts", {
          transcriptId,
          projectId,
          sourceContentHash: hash,
          factsVersion: FACTS_VERSION,
          key: `F${fact + 1}`,
          type: "result",
          claim: shape.claim(fact),
          turnIndexes: [],
          quotes: factQuotes,
          speakerLabel: label,
          confidence: 1,
        });
      }
      return { transcriptId, generationId };
    });
    const frozen = await t.mutation(internal.transcriptDigests.freezeFactsSource, ids);
    const row = await t.run(async (ctx) =>
      (await ctx.db
        .query("generationSources")
        .withIndex("by_generationId", (q) => q.eq("generationId", ids.generationId))
        .collect()).find((source) => source.kind === "transcript_facts")
    );
    return { t, ids, frozen, row };
  }

  it("is not frozen past the byte guard, so the draft falls back instead of failing", async () => {
    const { t, ids, frozen, row } = await bigPack("王".repeat(60), { quotesPerFact: 5, claim: (fact) => `结果${fact}` });
    expect(frozen).toBeNull();
    expect(row ?? null).toBeNull();
    // Through the generation's own entry: ready facts, no call, and a clean
    // fallback with a line in the progress log.
    const fetchMock = vi.fn(() => { throw new Error("No model call expected"); });
    vi.stubGlobal("fetch", fetchMock);
    const result = await run(t, ids.generationId);
    expect(result).toMatchObject({ ready: false, packs: [] });
    expect(result.lines).toEqual([
      "A transcript's verified facts could not be frozen, so this draft reads the transcripts the usual way.",
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("freezes only the facts the capped pack shows, and stays under the guard", async () => {
    const { frozen, row } = await bigPack("Priya Shah", {
      quotesPerFact: 1,
      claim: (fact) => `Measurement ${fact} of the ramp forecaster held within tolerance on the feeder. `.repeat(3).trim(),
    });
    expect(frozen).not.toBeNull();
    expect(row!.content.length).toBeLessThanOrEqual(FACT_PACK_MAX_CHARS + 100);
    expect(row!.content).toMatch(/more facts omitted to fit\.\]$/);
    const shown = [...row!.content.matchAll(/^\[(F\d+-\d+)\] /gm)].map((match) => match[1]);
    expect(row!.factSpans!.map((span) => span.id)).toEqual(shown);
    expect(shown.length).toBeLessThan(1_200);
    expect(getConvexSize(row!)).toBeLessThanOrEqual(MAX_FACT_PACK_ROW_BYTES);
    // Every span flags the unconfirmed speaker (decision 24).
    expect(row!.factSpans!.every((span) => span.quotes.every((quote) => quote.needsSpeakerCheck === true))).toBe(true);
  });
});
