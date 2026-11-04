/// <reference types="vite/client" />
// 2026-10-28 (Phase D step 1 live check): a Brief reused from an earlier
// draft names that draft's rows. Seeds see each of its entries with this
// draft's row of the same text, so a Seed that quotes an entry cites a row
// this draft has (live: 4 of 46 Seeds kept a quote before, 45 of 47 with
// the draft's own Brief).
import { describe, expect, it } from "vitest";
import type { Id } from "./_generated/dataModel";
import { decisionFixture } from "./seedDecision.fixture";
import { loadFrozenSeedActionInput, ownSourceIdOf } from "./lib/seedSnapshotLoader";
import { validateSeed } from "./lib/seedContract";

const id = (value: string) => value as Id<"generationSources">;

describe("a reused Brief's entries, as Seeds read them", () => {
  it("name this draft's row of the same text, and keep an id this draft has no text for", async () => {
    const s = await decisionFixture();
    const { earlierRow, otherRow } = await s.t.run(async (ctx) => {
      const earlier = await ctx.db.insert("generations", {
        projectId: s.projectId, status: "completed", requestedBy: s.userId, startedAt: 0,
      });
      const earlierRow = await ctx.db.insert("generationSources", {
        generationId: earlier, projectId: s.projectId, kind: "transcript", label: "Interview",
        content: "Evidence alpha supports the work.", contentHash: "source-hash",
        truncated: false, originalLength: 33, capturedAt: 0,
      });
      const otherRow = await ctx.db.insert("generationSources", {
        generationId: earlier, projectId: s.projectId, kind: "project_document", label: "other:gone.md",
        content: "A file this draft did not freeze.", contentHash: "gone-hash",
        truncated: false, originalLength: 33, capturedAt: 0,
      });
      const briefId = await ctx.db.insert("generationBriefs", {
        projectId: s.projectId, generationId: earlier, inputsHash: "brief-inputs", version: 1,
        origin: "derived", storylineText: "The team investigated a technical uncertainty.", createdAt: 0,
      });
      for (const [sourceId, hash, excerpt] of [
        [earlierRow, "source-hash", "Evidence alpha"],
        [otherRow, "gone-hash", "A file"],
      ] as const) {
        await ctx.db.insert("generationBriefEntries", {
          briefId, projectId: s.projectId, group: "confidenceMap", text: "A fact.", confidence: "established",
          sourceId, sourceContentHash: hash, startOffset: 0, endOffset: excerpt.length, exactExcerpt: excerpt, createdAt: 0,
        });
      }
      await ctx.db.patch(s.generationId, { briefId, briefVersionId: briefId });
      return { earlierRow, otherRow };
    });
    const input = await s.t.run(async (ctx) => {
      const generation = (await ctx.db.get(s.generationId))!;
      return await loadFrozenSeedActionInput(ctx, { generation, briefVersionId: generation.briefVersionId! });
    });
    expect(input.briefEntries.map((entry) => entry.sourceId)).toEqual([s.sourceId, otherRow]);
    expect(input.briefEntries[0]!.sourceId).not.toBe(earlierRow);

    // A Seed that quotes the entry with the id it was shown keeps its quote;
    // with the earlier draft's id it would have lost it.
    const frozenSources = input.sources.map((source) => ({
      sourceId: source._id, generationId: s.generationId, content: source.content, contentHash: source.contentHash,
    }));
    const citing = (sourceId: string) =>
      validateSeed({
        roleId: "company_context",
        seed: {
          bullets: ["The company tested its control loop."],
          tags: ["technical"],
          provenance: [{ sourceId, startOffset: 0, endOffset: 14, exactExcerpt: "Evidence alpha" }],
        },
        referenceContext: { generationId: s.generationId, references: [] },
        frozenSources,
      } as never);
    const shown = citing(input.briefEntries[0]!.sourceId);
    expect(shown.ok && shown.seed.support).toBe("source_supported");
    const before = citing(earlierRow);
    expect(before.ok && before.seed.support).toBe("writer_asserted");
  });

  it("keeps the draft's own ids, and takes an interview first among rows of the same text (review)", () => {
    const sources = [
      { _id: id("own-doc"), kind: "project_document", contentHash: "same" },
      { _id: id("own-transcript"), kind: "transcript", contentHash: "same" },
      { _id: id("own-other"), kind: "project_document", contentHash: "other" },
    ];
    const ownId = ownSourceIdOf(sources);
    expect(ownId({ sourceId: id("own-doc"), sourceContentHash: "same" })).toBe("own-doc");
    expect(ownId({ sourceId: id("earlier"), sourceContentHash: "same" })).toBe("own-transcript");
    expect(ownId({ sourceId: id("earlier"), sourceContentHash: "other" })).toBe("own-other");
    expect(ownId({ sourceId: id("earlier"), sourceContentHash: "missing" })).toBe("earlier");
  });
});
