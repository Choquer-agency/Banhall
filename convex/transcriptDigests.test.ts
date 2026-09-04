/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Doc, Id } from "./_generated/dataModel";
import { sha256 } from "./lib/contracts";
import {
  CONDENSE_VERSION,
  MAX_TRANSCRIPTS_PER_PROJECT,
  mapClaimToPart,
  TRANSCRIPT_BUDGET_CHARS,
} from "./lib/transcripts";
import { decideInputMode } from "./generations";
import { ensureCondensedInputs, type CondenseCtx } from "./ai/condense";
import { renderDigest, type TranscriptDigest } from "./ai/condenseAgent";

const modules = import.meta.glob("./**/*.ts");
type TestConvex = ReturnType<typeof convexTest<typeof schema.tables>>;
const authId = "digest-writer";

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
  vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key");
});

type Seed = { label?: string; content: string };

async function setup(seeds: Seed[], documents: string[] = []) {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { authId, role: "writer" });
    const projectId = await ctx.db.insert("projects", {
      title: "Digest project",
      clientName: "Client",
      status: "draft",
      createdBy: userId,
      shareToken: "digest-token",
      createdAt: now,
      updatedAt: now,
    });
    const transcriptIds: Id<"transcripts">[] = [];
    for (const [index, seed] of seeds.entries()) {
      transcriptIds.push(
        await ctx.db.insert("transcripts", {
          projectId,
          content: seed.content,
          label: seed.label ?? `Transcript ${index + 1}`,
          position: index,
          contentHash: await sha256(seed.content),
          createdAt: now + index,
        })
      );
    }
    for (const [index, content] of documents.entries()) {
      await ctx.db.insert("projectDocuments", {
        projectId,
        fileName: `doc-${index}.txt`,
        fileType: "txt",
        content,
        source: "upload",
        uploadedBy: userId,
        createdAt: now,
      });
    }
    return { userId, projectId, transcriptIds };
  });
  return { t, authed: t.withIdentity({ subject: authId }), ...ids };
}

/** `ensureCondensedInputs` needs nothing from an action but its two calls. */
function condenseCtx(t: TestConvex): CondenseCtx {
  // convex-test's runners do the same work under a looser reference type.
  return { runQuery: t.query, runMutation: t.mutation } as unknown as CondenseCtx;
}

function digestOf(overrides: Partial<TranscriptDigest> = {}): TranscriptDigest {
  return {
    participants: [],
    timeline: [],
    technologicalUncertainties: [],
    hypotheses: [],
    experiments: [],
    resultsAndNumbers: [],
    namesAndSystems: [],
    keyQuotes: [],
    ...overrides,
  };
}

async function sourcesOf(t: TestConvex, generationId: Id<"generations">) {
  return await t.run(async (ctx) =>
    ctx.db
      .query("generationSources")
      .withIndex("by_generationId", (q) => q.eq("generationId", generationId))
      .collect()
  );
}

/**
 * Reserves a generation the way `reserveGeneration` freezes one, without the
 * scheduled pipeline: these cases drive `ensureCondensedInputs` themselves, and
 * a background generateReport would race them for the same rows.
 */
async function reserve(
  t: TestConvex,
  projectId: Id<"projects">,
  inputMode: "full" | "digest"
): Promise<Id<"generations">> {
  return await t.run(async (ctx) => {
    const transcripts = (
      await ctx.db
        .query("transcripts")
        .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
        .collect()
    ).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    const now = Date.now();
    const generationId = await ctx.db.insert("generations", {
      projectId,
      transcriptId: transcripts[0]?._id,
      transcriptIds: transcripts.map((row) => row._id),
      inputMode,
      status: "reserved",
      requestedAt: now,
      startedAt: now,
    });
    for (const row of transcripts) {
      await ctx.db.insert("generationSources", {
        generationId,
        projectId,
        kind: "transcript",
        transcriptId: row._id,
        label: row.label ?? "Interview transcript",
        content: row.content,
        contentHash: await sha256(row.content),
        truncated: false,
        originalLength: row.content.length,
        capturedAt: now,
      });
    }
    for (const document of await ctx.db
      .query("projectDocuments")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .collect()) {
      await ctx.db.insert("generationSources", {
        generationId,
        projectId,
        kind: "project_document",
        projectDocumentId: document._id,
        label: `other:${document.fileName}`,
        content: document.content,
        contentHash: await sha256(document.content),
        truncated: false,
        originalLength: document.content.length,
        capturedAt: now,
      });
    }
    await ctx.db.patch(projectId, { activeGenerationId: generationId });
    return generationId;
  });
}

async function digestRows(t: TestConvex): Promise<Doc<"transcriptDigests">[]> {
  return await t.run((ctx) => ctx.db.query("transcriptDigests").collect());
}

/** Over the budget by construction: two transcripts, neither one alone over it. */
const OVER_BUDGET: Seed[] = [
  { label: "Kickoff.docx", content: `A${"a".repeat(TRANSCRIPT_BUDGET_CHARS / 2)}` },
  { label: "Follow-up.docx", content: `B${"b".repeat(TRANSCRIPT_BUDGET_CHARS / 2)}` },
];

/** Chars the two OVER_BUDGET transcripts condense to under the stub below. */
const digestChars = OVER_BUDGET.reduce(
  (sum, seed) =>
    sum +
    renderDigest(digestOf({ participants: [`speaker of ${seed.label}`] })).length,
  0
);

describe("decideInputMode (AC1, AC2)", () => {
  it("switches to digests only past the budget", () => {
    expect(decideInputMode(0)).toBe("full");
    expect(decideInputMode(TRANSCRIPT_BUDGET_CHARS - 1)).toBe("full");
    expect(decideInputMode(TRANSCRIPT_BUDGET_CHARS)).toBe("full");
    expect(decideInputMode(TRANSCRIPT_BUDGET_CHARS + 1)).toBe("digest");
  });
});

describe("a generation under the budget is untouched (AC1)", () => {
  it("reserves inputMode full, writes no digest, and feeds the full join", async () => {
    const { t, authed, projectId } = await setup([
      { label: "First", content: "Alpha body" },
      { label: "Second", content: "Bravo body" },
    ]);
    const generationId = await authed.mutation(api.generations.requestGeneration, {
      projectId,
    });
    const generation = await t.run((ctx) => ctx.db.get(generationId));
    expect(generation?.inputMode).toBe("full");
    expect(generation?.digestIds).toBeUndefined();
    expect(await digestRows(t)).toEqual([]);

    const input = await t.query(internal.generations.getGenerationInput, {
      generationId,
    });
    expect(input?.inputMode).toBe("full");
    expect(input?.transcript).toBe(
      "=== Transcript 1: First ===\nAlpha body\n\n" +
        "=== Transcript 2: Second ===\nBravo body"
    );
  });
});

describe("a generation over the budget reserves in digest mode (AC2)", () => {
  it("records inputMode digest on the reservation itself", async () => {
    const { t, authed, projectId } = await setup(OVER_BUDGET);
    const generationId = await authed.mutation(api.generations.requestGeneration, {
      projectId,
    });
    const generation = await t.run((ctx) => ctx.db.get(generationId));
    expect(generation?.inputMode).toBe("digest");
    expect(generation?.transcriptIds).toHaveLength(2);
  });
});

describe("recordDigest is idempotent on its key (AC3)", () => {
  it("returns the stored id instead of writing a second row", async () => {
    const { t, projectId, transcriptIds } = await setup([
      { content: "Interview body" },
    ]);
    const args = {
      transcriptId: transcriptIds[0],
      projectId,
      sourceContentHash: "hash-of-the-frozen-bytes",
      content: "## Participants\n- Dana",
      structured: "[]",
      model: "claude-test",
      promptVersion: "sha256:test",
      originalLength: 14,
    };
    const first = await t.mutation(internal.transcriptDigests.recordDigest, args);
    const second = await t.mutation(internal.transcriptDigests.recordDigest, {
      ...args,
      content: "## Participants\n- someone else entirely",
    });
    expect(second).toBe(first);
    const rows = await digestRows(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      condenseVersion: CONDENSE_VERSION,
      content: "## Participants\n- Dana",
      charCount: "## Participants\n- Dana".length,
      originalLength: 14,
    });
  });

  it("writes a new row past a version bump and leaves the old one alone", async () => {
    const { t, projectId, transcriptIds } = await setup([
      { content: "Interview body" },
    ]);
    const staleId = await t.run((ctx) =>
      ctx.db.insert("transcriptDigests", {
        transcriptId: transcriptIds[0],
        projectId,
        sourceContentHash: "same-bytes",
        condenseVersion: `${CONDENSE_VERSION}-previous`,
        content: "digest under the old contract",
        structured: "[]",
        model: "claude-test",
        promptVersion: "sha256:old",
        charCount: 29,
        originalLength: 14,
        createdAt: Date.now(),
      })
    );
    const freshId = await t.mutation(internal.transcriptDigests.recordDigest, {
      transcriptId: transcriptIds[0],
      projectId,
      sourceContentHash: "same-bytes",
      content: "digest under the current contract",
      structured: "[]",
      model: "claude-test",
      promptVersion: "sha256:new",
      originalLength: 14,
    });
    expect(freshId).not.toBe(staleId);
    const rows = await digestRows(t);
    expect(rows).toHaveLength(2);
    expect(await t.run((ctx) => ctx.db.get(staleId))).not.toBeNull();
  });
});

describe("ensureCondensedInputs freezes one digest per transcript (AC2, AC3)", () => {
  it("condenses, stores, freezes and reports the digest parts", async () => {
    const { t, projectId, transcriptIds } = await setup(OVER_BUDGET);
    const generationId = await reserve(t, projectId, "digest");

    const seen: string[] = [];
    const condensed: string[] = [];
    await ensureCondensedInputs(
      condenseCtx(t),
      { generationId, elapsedMs: 0 },
      async (line) => void seen.push(line),
      async ({ text, label, part, totalParts }) => {
        condensed.push(`${label} ${part}/${totalParts} ${text.length}`);
        return digestOf({ participants: [`speaker of ${label}`] });
      }
    );

    expect(condensed).toEqual([
      `Kickoff.docx 1/1 ${OVER_BUDGET[0].content.length}`,
      `Follow-up.docx 1/1 ${OVER_BUDGET[1].content.length}`,
    ]);
    expect(seen).toEqual([
      `Condensing transcript 1 of 2 "Kickoff.docx" (${OVER_BUDGET[0].content.length.toLocaleString("en-US")} chars)…`,
      `Condensing transcript 2 of 2 "Follow-up.docx" (${OVER_BUDGET[1].content.length.toLocaleString("en-US")} chars)…`,
      `Drafting from 2 digests (${digestChars.toLocaleString("en-US")} chars).`,
    ]);

    const stored = await digestRows(t);
    expect(stored).toHaveLength(2);
    for (const [index, row] of stored.entries()) {
      expect(row).toMatchObject({
        transcriptId: transcriptIds[index],
        projectId,
        condenseVersion: CONDENSE_VERSION,
        sourceContentHash: await sha256(OVER_BUDGET[index].content),
        content: renderDigest(
          digestOf({ participants: [`speaker of ${OVER_BUDGET[index].label}`] })
        ),
        originalLength: OVER_BUDGET[index].content.length,
      });
      expect(row.charCount).toBe(row.content.length);
      expect(row.model).not.toBe("");
      expect(row.promptVersion).toMatch(/^sha256:/);
      expect(JSON.parse(row.structured)).toHaveLength(1);
    }

    const generation = await t.run((ctx) => ctx.db.get(generationId));
    expect(generation?.digestIds).toEqual(stored.map((row) => row._id));

    const frozen = (await sourcesOf(t, generationId)).filter(
      (row) => row.kind === "transcript_digest"
    );
    expect(frozen).toHaveLength(2);
    for (const [index, row] of frozen.entries()) {
      expect(row).toMatchObject({
        transcriptId: transcriptIds[index],
        digestId: stored[index]._id,
        label: OVER_BUDGET[index].label,
        content: stored[index].content,
        contentHash: await sha256(stored[index].content),
      });
    }

    const input = await t.query(internal.generations.getGenerationInput, {
      generationId,
    });
    expect(input?.inputMode).toBe("digest");
    expect(input?.digestIds).toEqual(stored.map((row) => row._id));
    expect(input?.transcriptParts.map((part) => part.sourceId)).toEqual(
      frozen.map((row) => row._id)
    );
    expect(input?.transcript).toContain("=== Transcript 1: Kickoff.docx ===");
    expect(input?.transcript).not.toContain("aaaaaaaaaa");
  });

  it("reuses the stored digest on the next generation and pays nothing (AC3)", async () => {
    const { t, projectId } = await setup(OVER_BUDGET);
    const condense = async ({ label }: { label: string }) =>
      digestOf({ participants: [`speaker of ${label}`] });

    const first = await reserve(t, projectId, "digest");
    await ensureCondensedInputs(
      condenseCtx(t),
      { generationId: first, elapsedMs: 0 },
      async () => {},
      condense
    );
    const stored = await digestRows(t);
    await t.run((ctx) => ctx.db.patch(first, { status: "completed" }));

    const second = await reserve(t, projectId, "digest");
    const seen: string[] = [];
    let calls = 0;
    await ensureCondensedInputs(
      condenseCtx(t),
      { generationId: second, elapsedMs: 0 },
      async (line) => void seen.push(line),
      async (args) => {
        calls += 1;
        return await condense(args);
      }
    );

    expect(calls).toBe(0);
    expect(seen).toEqual([
      'Reusing stored digest for transcript 1 of 2 "Kickoff.docx".',
      'Reusing stored digest for transcript 2 of 2 "Follow-up.docx".',
      `Drafting from 2 digests (${digestChars.toLocaleString("en-US")} chars).`,
    ]);
    expect((await digestRows(t)).map((row) => row._id)).toEqual(
      stored.map((row) => row._id)
    );
    const generation = await t.run((ctx) => ctx.db.get(second));
    expect(generation?.digestIds).toEqual(stored.map((row) => row._id));
  });

  it("is idempotent when the same generation is condensed twice", async () => {
    const { t, projectId } = await setup(OVER_BUDGET);
    const generationId = await reserve(t, projectId, "digest");
    const run = () =>
      ensureCondensedInputs(
        condenseCtx(t),
        { generationId, elapsedMs: 0 },
        async () => {},
        async ({ label }) => digestOf({ participants: [`speaker of ${label}`] })
      );
    await run();
    await run();
    expect(await digestRows(t)).toHaveLength(2);
    expect(
      (await sourcesOf(t, generationId)).filter(
        (row) => row.kind === "transcript_digest"
      )
    ).toHaveLength(2);
    const generation = await t.run((ctx) => ctx.db.get(generationId));
    expect(generation?.digestIds).toHaveLength(2);
  });

  it("splits a transcript past the window into marked parts (AC4)", async () => {
    const paragraph = `${"c".repeat(90_000)}`;
    const { t, projectId } = await setup([
      { label: "Long.docx", content: [paragraph, paragraph].join("\n\n") },
      { label: "Short.docx", content: "d".repeat(120_000) },
    ]);
    const generationId = await reserve(t, projectId, "digest");
    const windows: string[] = [];
    await ensureCondensedInputs(
      condenseCtx(t),
      { generationId, elapsedMs: 0 },
      async () => {},
      async ({ label, part, totalParts }) => {
        windows.push(`${label} ${part}/${totalParts}`);
        return digestOf({ participants: [`part ${part}`] });
      }
    );
    expect(windows.sort()).toEqual([
      "Long.docx 1/2",
      "Long.docx 2/2",
      "Short.docx 1/1",
    ]);
    const rows = await digestRows(t);
    expect(rows[0].content).toBe(
      "--- part 1 of 2 ---\n## Participants\n- part 1\n\n" +
        "--- part 2 of 2 ---\n## Participants\n- part 2"
    );
    expect(rows[1].content).toBe("## Participants\n- part 1");
  });

  it("fails before any provider call when condensation cannot fit the action", async () => {
    const { t, projectId } = await setup(OVER_BUDGET);
    const generationId = await reserve(t, projectId, "digest");
    let called = false;
    await expect(
      ensureCondensedInputs(
        condenseCtx(t),
        { generationId, elapsedMs: 590_000 },
        async () => {},
        async () => {
          called = true;
          return digestOf();
        }
      )
    ).rejects.toThrow(/exceed the generation time limit/);
    expect(called).toBe(false);
    expect(await digestRows(t)).toEqual([]);
  });

  it("freezes the transcript text when the digest came out longer (edge case)", async () => {
    const short = "e".repeat(10);
    const { t, projectId } = await setup([
      { label: "Tiny.docx", content: short },
      { label: "Huge.docx", content: "f".repeat(TRANSCRIPT_BUDGET_CHARS) },
    ]);
    const generationId = await reserve(t, projectId, "digest");
    await ensureCondensedInputs(
      condenseCtx(t),
      { generationId, elapsedMs: 0 },
      async () => {},
      async ({ label }) =>
        digestOf({ participants: [`a far longer digest than ${label} itself`] })
    );
    const [tiny] = (await sourcesOf(t, generationId)).filter(
      (row) => row.kind === "transcript_digest"
    );
    expect(tiny.content).toBe(short);
    const [tinyDigest] = await digestRows(t);
    expect(tinyDigest.content.length).toBeGreaterThan(short.length);
    expect(tinyDigest.structured).not.toBe("");
  });
});

describe("digest rows survive the busiest generation (validation-2)", () => {
  it("returns all 20 digest parts beside 20 transcripts and 50 documents", async () => {
    const seeds = Array.from({ length: MAX_TRANSCRIPTS_PER_PROJECT }, (_, i) => ({
      label: `Interview ${i + 1}`,
      content: `Interview body ${i + 1}. `.repeat(20),
    }));
    const documents = Array.from({ length: 50 }, (_, i) => `document ${i + 1}`);
    const { t, projectId, transcriptIds } = await setup(seeds, documents);
    const generationId = await reserve(t, projectId, "digest");
    // 20 transcripts × 1 window at concurrency 4 does not fit one action, so a
    // project this size only reaches digest mode on stored digests. See the
    // ticket's deferred list.
    for (const [index, transcriptId] of transcriptIds.entries()) {
      await t.mutation(internal.transcriptDigests.recordDigest, {
        transcriptId,
        projectId,
        sourceContentHash: await sha256(seeds[index].content),
        content: renderDigest(digestOf({ participants: [seeds[index].label] })),
        structured: "[]",
        model: "claude-test",
        promptVersion: "sha256:test",
        originalLength: seeds[index].content.length,
      });
    }
    await ensureCondensedInputs(
      condenseCtx(t),
      { generationId, elapsedMs: 0 },
      async () => {},
      async ({ label }) => digestOf({ participants: [label] })
    );

    const input = await t.query(internal.generations.getGenerationInput, {
      generationId,
    });
    expect(input?.inputMode).toBe("digest");
    expect(input?.digestIds).toHaveLength(MAX_TRANSCRIPTS_PER_PROJECT);
    expect(input?.transcriptParts).toHaveLength(MAX_TRANSCRIPTS_PER_PROJECT);
    expect(input?.transcriptParts.map((part) => part.label)).toEqual(
      seeds.map((seed) => seed.label)
    );
    expect(input?.contextDocs).toHaveLength(50);
    for (const part of input?.transcriptParts ?? []) {
      expect(part.content).toContain("## Participants");
    }
    expect(transcriptIds).toHaveLength(MAX_TRANSCRIPTS_PER_PROJECT);
  });
});

describe("provenance in digest mode cites the digest source rows (AC6)", () => {
  it("byte-checks a surviving quote and refuses one the digest dropped", async () => {
    const quote = "the seal failed at 4.2 bar on 2026-03-04";
    const { t, projectId } = await setup(OVER_BUDGET);
    const generationId = await reserve(t, projectId, "digest");
    await ensureCondensedInputs(
      condenseCtx(t),
      { generationId, elapsedMs: 0 },
      async () => {},
      async ({ part }) => digestOf({ keyQuotes: part === 1 ? [quote] : [] })
    );
    const input = await t.query(internal.generations.getGenerationInput, {
      generationId,
    });
    expect(input).not.toBeNull();
    const parts = input!.transcriptParts;

    const citation = mapClaimToPart(parts, { sourceQuote: quote });
    expect(citation).not.toBeNull();
    expect(citation!.generationSourceId).toBe(parts[0].sourceId);
    expect(mapClaimToPart(parts, { sourceQuote: "never said this" })).toBeNull();

    const claimText = "The seal failed under pressure.";
    const reportContent = JSON.stringify({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: claimText }] },
      ],
    });
    const provenanceId = await t.mutation(internal.reports.createProvenance, {
      projectId,
      generationId,
      sourceTranscriptId: input!.transcriptId,
      sourceTranscriptIds: input!.transcriptIds,
      digestIds: input!.digestIds,
      content: reportContent,
      claims: [
        {
          claimId: "c1",
          section: "242",
          material: true,
          claimText,
          claimTextHash: await sha256(claimText),
          state: "needs_review" as const,
          sources: [citation!],
        },
      ],
    });
    const provenance = await t.run((ctx) => ctx.db.get(provenanceId));
    expect(provenance?.digestIds).toEqual(input!.digestIds);
    expect(provenance?.claims[0].sources[0].generationSourceId).toBe(
      parts[0].sourceId
    );
  });
});
