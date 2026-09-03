/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import {
  buildTranscriptPromptText,
  describeTranscriptInput,
  findQuoteInParts,
  mapClaimToPart,
  MAX_TRANSCRIPTS_PER_PROJECT,
} from "./lib/transcripts";

const modules = import.meta.glob("./**/*.ts");

type Seed = { label?: string; position?: number; content: string; createdAt: number };

async function setup(seeds: Seed[]) {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const writerId = await ctx.db.insert("users", {
      authId: "tr-writer",
      role: "writer",
      firstName: "Writer",
    });
    const rolelessId = await ctx.db.insert("users", {
      authId: "tr-roleless",
      firstName: "NoRole",
    });
    await ctx.db.insert("users", {
      authId: "tr-anon",
      role: "writer",
      isAnonymous: true,
    });
    const now = Date.now();
    const projectId = await ctx.db.insert("projects", {
      title: "Transcript project",
      clientName: "Client",
      status: "draft",
      createdBy: writerId,
      shareToken: "transcript-token",
      createdAt: now,
      updatedAt: now,
    });
    const transcriptIds: Id<"transcripts">[] = [];
    for (const seed of seeds) {
      transcriptIds.push(
        await ctx.db.insert("transcripts", {
          projectId,
          content: seed.content,
          createdAt: seed.createdAt,
          ...(seed.label === undefined ? {} : { label: seed.label }),
          ...(seed.position === undefined ? {} : { position: seed.position }),
        })
      );
    }
    return { writerId, rolelessId, projectId, transcriptIds };
  });
  return {
    t,
    ...ids,
    writer: t.withIdentity({ subject: "tr-writer" }),
    roleless: t.withIdentity({ subject: "tr-roleless" }),
    anonymous: t.withIdentity({ subject: "tr-anon" }),
  };
}

describe("listTranscripts", () => {
  it("returns metadata in position order, without content (AC1)", async () => {
    const f = await setup([
      { label: "third.docx", position: 2, content: "Third body", createdAt: 100 },
      { label: "first.docx", position: 0, content: "First body", createdAt: 300 },
      { label: "second.docx", position: 1, content: "Second body", createdAt: 200 },
    ]);

    const list = await f.writer.query(api.transcripts.listTranscripts, {
      projectId: f.projectId,
    });

    expect(list.map((row) => row.label)).toEqual([
      "first.docx",
      "second.docx",
      "third.docx",
    ]);
    expect(list.map((row) => row.position)).toEqual([0, 1, 2]);
    expect(list[0]).toEqual({
      _id: f.transcriptIds[1],
      label: "first.docx",
      position: 0,
      createdAt: 300,
      charCount: "First body".length,
      wordCount: 2,
      contentHash: undefined,
    });
    for (const row of list) {
      expect(row).not.toHaveProperty("content");
    }
  });

  it("orders legacy rows by createdAt and labels them Interview transcript (AC1)", async () => {
    const f = await setup([
      { content: "Later legacy", createdAt: 500 },
      { content: "Earlier legacy", createdAt: 100 },
    ]);

    const list = await f.writer.query(api.transcripts.listTranscripts, {
      projectId: f.projectId,
    });

    expect(list.map((row) => row.createdAt)).toEqual([100, 500]);
    expect(list.map((row) => row.label)).toEqual([
      "Interview transcript",
      "Interview transcript",
    ]);
    expect(list.map((row) => row.position)).toEqual([undefined, undefined]);
  });

  it("sorts a positioned row ahead of legacy rows regardless of createdAt (AC1)", async () => {
    const f = await setup([
      { content: "Legacy", createdAt: 100 },
      { label: "Positioned", position: 0, content: "Positioned body", createdAt: 900 },
    ]);

    const list = await f.writer.query(api.transcripts.listTranscripts, {
      projectId: f.projectId,
    });

    expect(list.map((row) => row.label)).toEqual(["Positioned", "Interview transcript"]);
  });

  it("breaks a position tie by createdAt (edge case)", async () => {
    const f = await setup([
      { label: "later", position: 0, content: "Later body", createdAt: 400 },
      { label: "earlier", position: 0, content: "Earlier body", createdAt: 200 },
    ]);

    const list = await f.writer.query(api.transcripts.listTranscripts, {
      projectId: f.projectId,
    });

    expect(list.map((row) => row.label)).toEqual(["earlier", "later"]);
  });

  it("drops empty and whitespace-only rows (AC2)", async () => {
    const f = await setup([
      { content: "", createdAt: 100 },
      { content: "   \n\t ", createdAt: 200 },
      { label: "real.docx", position: 0, content: "Real body", createdAt: 300 },
    ]);

    const list = await f.writer.query(api.transcripts.listTranscripts, {
      projectId: f.projectId,
    });

    expect(list).toHaveLength(1);
    expect(list[0].label).toBe("real.docx");
  });

  it("returns at most MAX_TRANSCRIPTS_PER_PROJECT rows (edge case)", async () => {
    const seeds: Seed[] = [];
    for (let i = 0; i < MAX_TRANSCRIPTS_PER_PROJECT + 3; i++) {
      seeds.push({ label: `t${i}`, position: i, content: `Body ${i}`, createdAt: 100 + i });
    }
    const f = await setup(seeds);

    const list = await f.writer.query(api.transcripts.listTranscripts, {
      projectId: f.projectId,
    });

    expect(list).toHaveLength(MAX_TRANSCRIPTS_PER_PROJECT);
  });

  it("returns [] for callers without internal access (AC3)", async () => {
    const f = await setup([
      { label: "only.docx", position: 0, content: "Body", createdAt: 100 },
    ]);

    for (const caller of [f.t, f.roleless, f.anonymous]) {
      expect(
        await caller.query(api.transcripts.listTranscripts, { projectId: f.projectId })
      ).toEqual([]);
    }
  });
});

describe("getTranscriptContent", () => {
  it("returns the labelled body for a caller with access (AC3)", async () => {
    const f = await setup([
      { label: "only.docx", position: 0, content: "Body text", createdAt: 100 },
    ]);

    expect(
      await f.writer.query(api.transcripts.getTranscriptContent, {
        transcriptId: f.transcriptIds[0],
      })
    ).toEqual({ _id: f.transcriptIds[0], label: "only.docx", content: "Body text" });
  });

  it("defaults the label for a legacy row (AC3)", async () => {
    const f = await setup([{ content: "Legacy body", createdAt: 100 }]);

    const got = await f.writer.query(api.transcripts.getTranscriptContent, {
      transcriptId: f.transcriptIds[0],
    });

    expect(got?.label).toBe("Interview transcript");
  });

  it("returns null for callers without internal access (AC3)", async () => {
    const f = await setup([
      { label: "only.docx", position: 0, content: "Body", createdAt: 100 },
    ]);

    for (const caller of [f.t, f.roleless, f.anonymous]) {
      expect(
        await caller.query(api.transcripts.getTranscriptContent, {
          transcriptId: f.transcriptIds[0],
        })
      ).toBeNull();
    }
  });

  it("returns null, never a throw, for a transcript of an unreadable project (edge case)", async () => {
    const f = await setup([
      { label: "only.docx", position: 0, content: "Body", createdAt: 100 },
    ]);
    const otherTranscriptId = await f.t.run(async (ctx) => {
      const ownerId = await ctx.db.insert("users", { authId: "tr-other", role: "writer" });
      const now = Date.now();
      const otherProjectId = await ctx.db.insert("projects", {
        title: "Other project",
        clientName: "Other client",
        status: "draft",
        createdBy: ownerId,
        shareToken: "other-token",
        createdAt: now,
        updatedAt: now,
      });
      return await ctx.db.insert("transcripts", {
        projectId: otherProjectId,
        content: "Other body",
        createdAt: now,
      });
    });

    expect(
      await f.roleless.query(api.transcripts.getTranscriptContent, {
        transcriptId: otherTranscriptId,
      })
    ).toBeNull();
  });
});

describe("getTranscript", () => {
  it("returns the first transcript of the ordered set (AC6)", async () => {
    const f = await setup([
      { label: "second.docx", position: 1, content: "Second body", createdAt: 100 },
      { label: "first.docx", position: 0, content: "First body", createdAt: 900 },
    ]);

    const got = await f.writer.query(api.transcripts.getTranscript, {
      projectId: f.projectId,
    });

    expect(got?._id).toBe(f.transcriptIds[1]);
    expect(got?.content).toBe("First body");
  });

  it("skips empty legacy placeholder rows (AC2, AC6)", async () => {
    const f = await setup([
      { content: "", createdAt: 100 },
      { content: "Real legacy body", createdAt: 200 },
    ]);

    const got = await f.writer.query(api.transcripts.getTranscript, {
      projectId: f.projectId,
    });

    expect(got?._id).toBe(f.transcriptIds[1]);
  });

  it("returns null with no transcripts and without access (AC3, AC6)", async () => {
    const f = await setup([]);

    expect(
      await f.writer.query(api.transcripts.getTranscript, { projectId: f.projectId })
    ).toBeNull();
    expect(
      await f.roleless.query(api.transcripts.getTranscript, { projectId: f.projectId })
    ).toBeNull();
  });
});

describe("buildTranscriptPromptText", () => {
  it("passes a single transcript through unchanged", () => {
    expect(
      buildTranscriptPromptText([{ label: "kickoff.docx", content: "Raw body" }])
    ).toBe("Raw body");
  });

  it("heads each part and joins with a blank line", () => {
    expect(
      buildTranscriptPromptText([
        { label: "kickoff.docx", content: "First" },
        { label: "follow-up.docx", content: "Second" },
      ])
    ).toBe(
      "=== Transcript 1: kickoff.docx ===\nFirst\n\n=== Transcript 2: follow-up.docx ===\nSecond"
    );
  });

  it("returns an empty string for no parts", () => {
    expect(buildTranscriptPromptText([])).toBe("");
  });
});

describe("findQuoteInParts", () => {
  const parts = [
    { label: "one", content: "alpha bravo" },
    { label: "two", content: "charlie bravo delta" },
  ];

  it("returns the offset inside the part that holds the quote", () => {
    expect(findQuoteInParts(parts, "charlie")).toEqual({ partIndex: 1, startOffset: 0 });
    expect(findQuoteInParts(parts, "delta")).toEqual({ partIndex: 1, startOffset: 14 });
  });

  it("returns the first part when several contain the quote", () => {
    expect(findQuoteInParts(parts, "bravo")).toEqual({ partIndex: 0, startOffset: 6 });
  });

  it("returns null for a quote no part contains and for the empty quote", () => {
    expect(findQuoteInParts(parts, "echo")).toBeNull();
    expect(findQuoteInParts(parts, "")).toBeNull();
    expect(findQuoteInParts([], "alpha")).toBeNull();
  });
});

describe("mapClaimToPart", () => {
  const parts = [
    { sourceId: "src1" as Id<"generationSources">, contentHash: "hash-one", label: "one", content: "alpha bravo" },
    { sourceId: "src2" as Id<"generationSources">, contentHash: "hash-two", label: "two", content: "charlie bravo delta" },
  ];

  it("cites the part the quote came from, with an offset inside that part (AC4)", () => {
    expect(mapClaimToPart(parts, { sourceQuote: "delta" })).toEqual({
      generationSourceId: "src2",
      sourceContentHash: "hash-two",
      exactExcerpt: "delta",
      startOffset: 14,
      endOffset: 19,
    });
  });

  it("resolves a duplicated quote to the first part (edge case)", () => {
    expect(mapClaimToPart(parts, { sourceQuote: "bravo" })).toEqual({
      generationSourceId: "src1",
      sourceContentHash: "hash-one",
      exactExcerpt: "bravo",
      startOffset: 6,
      endOffset: 11,
    });
  });

  it("returns null without a quote, for an unmatched quote, and with no parts (AC4)", () => {
    expect(mapClaimToPart(parts, {})).toBeNull();
    expect(mapClaimToPart(parts, { sourceQuote: "echo" })).toBeNull();
    expect(mapClaimToPart([], { sourceQuote: "alpha" })).toBeNull();
  });
});

describe("describeTranscriptInput", () => {
  it("keeps today's singular line for one transcript (AC6)", () => {
    expect(describeTranscriptInput([{ label: "one", content: "a b c" }])).toBe(
      "Read frozen interview transcript — 3 words."
    );
  });

  it("counts words across every part and pluralises (AC6)", () => {
    expect(
      describeTranscriptInput([
        { label: "one", content: "a b c" },
        { label: "two", content: "d e" },
      ])
    ).toBe("Read 2 frozen interview transcripts — 5 words.");
  });

  it("falls back to the documents-only line with no words (AC6)", () => {
    expect(describeTranscriptInput([])).toBe(
      "No interview transcript — drafting from context documents only."
    );
    expect(describeTranscriptInput([{ label: "one", content: "   " }])).toBe(
      "No interview transcript — drafting from context documents only."
    );
  });
});
