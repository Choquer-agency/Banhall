/// <reference types="vite/client" />
/**
 * Round 2 (F2, decision 57): the display-only reading facts behind "Reading
 * the interview". Who may read them, when they may still be written, what a
 * reused Brief copies, how the pill is paced, and that they go with the
 * project.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import {
  DEFAULT_BRIEF_MS,
  READING_FACTS_FLUSH_MS,
  confidenceChip,
  createReadingFactsCollector,
  glossaryChip,
  sentenceAround,
  speakerFirstName,
  type ReadingFact,
} from "./lib/readingFacts";

const modules = import.meta.glob("./**/*.ts");
type T = ReturnType<typeof convexTest<typeof schema.tables>>;

const CONTENT = "Interviewer: What failed?\n\nPriya: The seal cracked at minus 30. We never found why.";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

async function fixture(t: T, overrides: Record<string, unknown> = {}) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const writerId = await ctx.db.insert("users", { authId: "facts-writer", role: "writer" });
    await ctx.db.insert("users", { authId: "facts-manager", role: "manager" });
    await ctx.db.insert("users", { authId: "facts-admin", role: "admin" });
    await ctx.db.insert("users", { authId: "facts-roleless" });
    const projectId = await ctx.db.insert("projects", {
      title: "Seal",
      clientName: "Cold Co",
      status: "generating",
      createdBy: writerId,
      ownerId: writerId,
      shareToken: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    });
    const generationId = await ctx.db.insert("generations", {
      projectId,
      status: "running",
      candidateMode: "iterative",
      gatedWorkflow: "seeds",
      requestedBy: writerId,
      startedAt: now,
      previousProjectStatus: "draft",
      learningDigestIds: [],
      modelFreeze: {
        entries: [],
        roles: {
          writing: "claude-sonnet-5",
          condense: "claude-sonnet-5",
          retrieval_brief: "claude-haiku-4-5-20251001",
          analysis: "claude-sonnet-5",
          planning: "claude-sonnet-5",
        },
        frozenAt: now,
      },
      ...overrides,
    });
    await ctx.db.patch(projectId, { activeGenerationId: generationId });
    const sourceId = await ctx.db.insert("generationSources", {
      generationId,
      projectId,
      kind: "transcript",
      label: "Kickoff call",
      content: CONTENT,
      contentHash: "h",
      truncated: false,
      originalLength: CONTENT.length,
      capturedAt: now,
    });
    return { writerId, projectId, generationId, sourceId };
  });
}

const FACT = { chip: "Fact", quote: "The seal cracked at minus 30.", sourceLabel: "Priya, line 3", speaker: "Priya", line: 3 };

async function append(t: T, generationId: Id<"generations">, count: number) {
  await t.mutation(internal.seeds.appendReadingFacts, {
    generationId,
    facts: Array.from({ length: count }, (_, index) => ({ ...FACT, quote: `${FACT.quote} ${index + 1}` })),
  });
}

describe("seeds.getReadingFacts", () => {
  it("counts every fact and returns the three newest first", async () => {
    const t = convexTest(schema, modules);
    const f = await fixture(t);
    await append(t, f.generationId, 2);
    await append(t, f.generationId, 3);
    const view = await t.withIdentity({ subject: "facts-writer" }).query(api.seeds.getReadingFacts, { generationId: f.generationId });
    expect(view).toMatchObject({ count: 5, expectedMs: DEFAULT_BRIEF_MS, done: false });
    expect(view?.latest.map((fact) => [fact.seq, fact.quote])).toEqual([
      [5, "The seal cracked at minus 30. 3"],
      [4, "The seal cracked at minus 30. 2"],
      [3, "The seal cracked at minus 30. 1"],
    ]);
  });

  it("places a fact by the speaker's first name on every size, rows stored with a full name included", async () => {
    const t = convexTest(schema, modules);
    const f = await fixture(t);
    await t.mutation(internal.seeds.appendReadingFacts, {
      generationId: f.generationId,
      facts: [
        { ...FACT, sourceLabel: "Anika Rao, line 19", speaker: "Anika Rao", line: 19 },
        { chip: "Fact", quote: "No speaker here.", sourceLabel: "Follow-up call, line 12", line: 12 },
      ],
    });
    const view = await t.withIdentity({ subject: "facts-writer" }).query(api.seeds.getReadingFacts, { generationId: f.generationId });
    expect(view?.latest.map((fact) => fact.sourceLabel)).toEqual(["Follow-up call, line 12", "Anika, line 19"]);
  });

  it("serves internal roles and is silent for everyone else", async () => {
    const t = convexTest(schema, modules);
    const f = await fixture(t);
    await append(t, f.generationId, 1);
    for (const subject of ["facts-writer", "facts-manager", "facts-admin"]) {
      expect((await t.withIdentity({ subject }).query(api.seeds.getReadingFacts, { generationId: f.generationId }))?.count, subject).toBe(1);
    }
    expect(await t.withIdentity({ subject: "facts-roleless" }).query(api.seeds.getReadingFacts, { generationId: f.generationId })).toBeNull();
    expect(await t.query(api.seeds.getReadingFacts, { generationId: f.generationId })).toBeNull();
    await t.run((ctx) => ctx.db.patch(f.projectId, { deletionStartedAt: Date.now() }));
    expect(await t.withIdentity({ subject: "facts-writer" }).query(api.seeds.getReadingFacts, { generationId: f.generationId })).toBeNull();
  });

  it("paces the pill by the median of the last Briefs on the planning model", async () => {
    const t = convexTest(schema, modules);
    const f = await fixture(t);
    await t.run(async (ctx) => {
      const base = { callSite: "generation:brief", inputTokens: 1, outputTokens: 1, costUsd: 0, createdAt: Date.now() };
      for (const durationMs of [20_000, 30_000, 90_000]) {
        await ctx.db.insert("aiUsage", { ...base, model: "claude-sonnet-5", durationMs });
      }
      // Another model and another call site do not count.
      await ctx.db.insert("aiUsage", { ...base, model: "claude-opus-5-5", durationMs: 1_000 });
      await ctx.db.insert("aiUsage", { ...base, callSite: "generation:analysis", model: "claude-sonnet-5", durationMs: 1_000 });
    });
    const view = await t.withIdentity({ subject: "facts-writer" }).query(api.seeds.getReadingFacts, { generationId: f.generationId });
    expect(view?.expectedMs).toBe(30_000);
  });

  it("is done once the Brief has landed", async () => {
    const t = convexTest(schema, modules);
    const f = await fixture(t);
    const briefId = await t.run((ctx) =>
      ctx.db.insert("generationBriefs", {
        projectId: f.projectId,
        generationId: f.generationId,
        inputsHash: "h",
        version: 1,
        origin: "derived",
        storylineText: "s",
        createdAt: Date.now(),
      })
    );
    await t.run((ctx) => ctx.db.patch(f.generationId, { briefId }));
    expect((await t.withIdentity({ subject: "facts-writer" }).query(api.seeds.getReadingFacts, { generationId: f.generationId }))?.done).toBe(true);
  });
});

describe("seeds.appendReadingFacts is fenced", () => {
  it.each([
    ["failed (a cancel fails the run)", { status: "failed" }],
    ["completed", { status: "completed" }],
    ["a Single draft", { gatedWorkflow: undefined, candidateMode: "single" }],
  ])("writes nothing once the run is %s", async (_label, patch) => {
    const t = convexTest(schema, modules);
    const f = await fixture(t);
    await t.run((ctx) => ctx.db.patch(f.generationId, patch as never));
    await append(t, f.generationId, 2);
    expect(await t.run((ctx) => ctx.db.query("generationReadingFacts").collect())).toEqual([]);
  });

  it("writes nothing once the seed stage has opened", async () => {
    const t = convexTest(schema, modules);
    const f = await fixture(t);
    await t.run((ctx) =>
      ctx.db.insert("seedSubsections", {
        generationId: f.generationId,
        projectId: f.projectId,
        roleId: "company_context",
        kind: "standard",
        state: "untouched",
        currentContextRevision: "r1",
        selectionRevision: "s1",
        consecutiveFailures: 0,
      })
    );
    await append(t, f.generationId, 1);
    expect(await t.run((ctx) => ctx.db.query("generationReadingFacts").collect())).toEqual([]);
  });

  it("bounds each quote to 300 characters", async () => {
    const t = convexTest(schema, modules);
    const f = await fixture(t);
    await t.mutation(internal.seeds.appendReadingFacts, {
      generationId: f.generationId,
      facts: [{ ...FACT, quote: "x".repeat(500) }],
    });
    const [row] = await t.run((ctx) => ctx.db.query("generationReadingFacts").collect());
    expect(row.quote.length).toBe(300);
    expect(row.quote.endsWith("...")).toBe(true);
  });
});

describe("a reused Brief fills the list at once", () => {
  it("copies its located entries with chips, skipping unreliable entries and exclusions", async () => {
    const t = convexTest(schema, modules);
    const f = await fixture(t);
    const briefId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("generationBriefs", {
        projectId: f.projectId,
        generationId: f.generationId,
        inputsHash: "h",
        version: 1,
        origin: "derived",
        storylineText: "s",
        createdAt: Date.now(),
      });
      const place = (text: string) => {
        const startOffset = CONTENT.indexOf(text);
        return { startOffset, endOffset: startOffset + text.length, exactExcerpt: text };
      };
      const base = { briefId: id, projectId: f.projectId, sourceId: f.sourceId, sourceContentHash: "h", createdAt: Date.now() };
      await ctx.db.insert("generationBriefEntries", { ...base, group: "confidenceMap", text: "Cracked", confidence: "established", ...place("The seal cracked at minus 30.") });
      await ctx.db.insert("generationBriefEntries", { ...base, group: "confidenceMap", text: "Why", confidence: "unresolved", ...place("We never found why.") });
      await ctx.db.insert("generationBriefEntries", { ...base, group: "confidenceMap", text: "Bad", confidence: "unreliable", ...place("What failed?") });
      await ctx.db.insert("generationBriefEntries", { ...base, group: "claimExclusion", text: "No", reason: "business_risk", ...place("What failed?") });
      await ctx.db.insert("generationBriefEntries", { ...base, group: "glossaryTerm", text: "seal", ...place("seal") });
      return id;
    });
    await t.mutation(internal.seeds.copyBriefToReadingFacts, { generationId: f.generationId, briefId });
    const rows = await t.run((ctx) => ctx.db.query("generationReadingFacts").collect());
    expect(rows.map((row) => [row.seq, row.chip, row.quote, row.sourceLabel])).toEqual([
      [1, "Fact", "The seal cracked at minus 30.", "Priya, line 3"],
      [2, "Uncertainty", "We never found why.", "Priya, line 3"],
      [3, "Term", "Priya: The seal cracked at minus 30.", "Priya, line 3"],
    ]);
    // Copying again adds nothing.
    await t.mutation(internal.seeds.copyBriefToReadingFacts, { generationId: f.generationId, briefId });
    expect(await t.run((ctx) => ctx.db.query("generationReadingFacts").collect())).toHaveLength(3);
  });
});

describe("the collector writes each fact as its entry completes (fidelity broken behaviour 9)", () => {
  it("writes the first fact at once, a quick second one when the pace allows, and a late one at once", async () => {
    const source = { _id: "source-1" as Id<"generationSources">, kind: "transcript" as const, label: "Kickoff call", content: CONTENT };
    const writes: Array<{ at: number; quotes: string[] }> = [];
    const start = Date.now();
    const collector = createReadingFactsCollector({
      ctx: {
        runMutation: (async (_ref: unknown, args: { facts: ReadingFact[] }) => {
          writes.push({ at: Date.now() - start, quotes: args.facts.map((fact) => fact.quote) });
          return null;
        }) as never,
      },
      generationId: "generation-1" as Id<"generations">,
      append: internal.seeds.appendReadingFacts,
      sources: [source],
      writerStoryline: false,
      placeholders: [],
      locate: async (quote) => {
        const startOffset = CONTENT.indexOf(quote);
        return startOffset < 0
          ? null
          : { sourceId: source._id, sourceContentHash: "h", exactExcerpt: quote, startOffset, endOffset: startOffset + quote.length };
      },
    });
    // The tool input as a stubbed stream delivers it: each Confidence Map
    // entry completes in its own piece.
    const entries = [
      { text: "a", quote: "The seal cracked at minus 30.", confidence: "established" },
      { text: "b", quote: "We never found why.", confidence: "unresolved" },
      { text: "c", quote: "What failed?", confidence: "partial" },
    ];
    let text = '{"storyline":"s","storylineClaims":[],"claimExclusions":[],"confidenceMap":[';
    const complete = async (index: number) => {
      text += `${index ? "," : ""}${JSON.stringify(entries[index])}`;
      collector.onToolInput(text);
      await vi.advanceTimersByTimeAsync(0);
    };
    await complete(0);
    expect(writes).toEqual([{ at: 0, quotes: ["The seal cracked at minus 30."] }]);
    // A second entry 100ms later waits for the pace, then is written without
    // waiting for another entry.
    await vi.advanceTimersByTimeAsync(100);
    await complete(1);
    expect(writes).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(READING_FACTS_FLUSH_MS);
    expect(writes).toEqual([
      { at: 0, quotes: ["The seal cracked at minus 30."] },
      { at: READING_FACTS_FLUSH_MS, quotes: ["We never found why."] },
    ]);
    // An entry after a long gap is written at once.
    await vi.advanceTimersByTimeAsync(5_000);
    await complete(2);
    expect(writes.at(-1)).toEqual({ at: 100 + READING_FACTS_FLUSH_MS + 5_000, quotes: ["What failed?"] });
    text += "]}";
    collector.onToolInput(text);
    await collector.finish();
    expect(writes).toHaveLength(3);
  });
});

describe("chips and quotes (option A, no prompt change)", () => {
  it("maps the Brief's groups", () => {
    expect(confidenceChip("established")).toBe("Fact");
    expect(confidenceChip("partial")).toBe("Partly known");
    expect(confidenceChip("unresolved")).toBe("Uncertainty");
    expect(confidenceChip("unreliable")).toBeNull();
    expect(glossaryChip("FrostLine")).toBe("Product name");
    expect(glossaryChip("leak rate")).toBe("Term");
  });

  it("names a speaker by first name, keeping numbered labels and skipping a title", () => {
    expect(speakerFirstName("Priya Raman")).toBe("Priya");
    expect(speakerFirstName("  Anika   Rao ")).toBe("Anika");
    expect(speakerFirstName("Priya")).toBe("Priya");
    expect(speakerFirstName("Dr. Priya Raman")).toBe("Priya");
    expect(speakerFirstName("Speaker 2")).toBe("Speaker 2");
    expect(speakerFirstName("Interviewer")).toBe("Interviewer");
  });

  it("shows the sentence around a glossary term", () => {
    const text = "First line. The foam cores deform at 120 degrees. Next one.";
    const start = text.indexOf("foam cores");
    expect(sentenceAround(text, start, start + "foam cores".length)).toBe("The foam cores deform at 120 degrees.");
  });
});
