/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { clientForModel, resetGenerationModelCache, resetGenerationPlaceholderCache } from "./ai/providers";
import { MODEL } from "./ai/model";

/**
 * Owner decision 26: every generation-owned provider call, Claude included,
 * reads placeholders instead of the names on the project record, and every
 * response is restored before the app stores it. The map is frozen at
 * reservation.
 */
const modules = import.meta.glob("./**/*.ts");

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-placeholder-key");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected HTTP transport"); }));
  resetGenerationModelCache();
  resetGenerationPlaceholderCache();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function setup(placeholders?: "on" | "off") {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const writerId = await ctx.db.insert("users", { authId: "gp-writer", role: "writer", firstName: "Wren", lastName: "Writer" });
    const projectId = await ctx.db.insert("projects", {
      title: "Helios",
      clientName: "Verdant Grid Technologies Inc.",
      writer: "Wren Writer",
      interviewer: "Dana Whitfield",
      interviewees: ["Priya Shah"],
      status: "draft",
      createdBy: writerId,
      shareToken: "gp-token",
      createdAt: 1,
      updatedAt: 1,
    });
    const transcriptId = await ctx.db.insert("transcripts", {
      projectId,
      content: "Dana Whitfield: What did you build?\n\nMarcus Lindqvist: A controller for Verdant Grid Technologies.",
      createdAt: 1,
      position: 0,
    });
    await ctx.db.insert("transcriptSpeakers", {
      transcriptId,
      projectId,
      label: "Marcus Lindqvist",
      role: "client",
      roleSource: "heuristic",
      confidence: 0.6,
      turnCount: 1,
    });
    if (placeholders) {
      await ctx.db.insert("appSettings", { key: "transcripts.placeholders", value: placeholders, updatedBy: writerId, updatedAt: 1 });
    }
    return { writerId, projectId };
  });
  return { t, ...ids, writer: t.withIdentity({ subject: "gp-writer" }) };
}

describe("placeholders frozen on a generation", () => {
  it("freezes the project's names and speaker labels at reservation", async () => {
    const f = await setup();
    const generationId = await f.writer.mutation(api.generations.requestGeneration, {
      projectId: f.projectId,
      candidateMode: "single",
    });
    const generation = await f.t.run((ctx) => ctx.db.get(generationId));
    expect(generation?.placeholders?.map((entry) => entry.value)).toEqual([
      "Verdant Grid Technologies Inc.",
      "Verdant Grid Technologies",
      "Verdant Grid",
      "VERDANT GRID TECHNOLOGIES",
      "Dana Whitfield",
      "Dana",
      "Whitfield",
      "Wren Writer",
      "Wren",
      "Writer",
      "Priya Shah",
      "Priya",
      "Shah",
      "Marcus Lindqvist",
      "Marcus",
      "Lindqvist",
    ]);
  });

  it("renumbers the frozen map when a transcript already holds placeholder-style tokens", async () => {
    const f = await setup();
    await f.t.run(async (ctx) => {
      await ctx.db.insert("transcripts", {
        projectId: f.projectId,
        content: "[PERSON_1]: A redacted earlier note about [CLIENT_1].",
        createdAt: 2,
        position: 1,
      });
    });
    const generationId = await f.writer.mutation(api.generations.requestGeneration, {
      projectId: f.projectId,
      candidateMode: "single",
    });
    const generation = await f.t.run((ctx) => ctx.db.get(generationId));
    const tokens = generation?.placeholders?.map((entry) => entry.token) ?? [];
    expect(tokens[0]).toBe("[CLIENT_2]");
    expect(tokens).not.toContain("[PERSON_1]");
    expect(tokens).not.toContain("[CLIENT_1]");
  });

  it("freezes none when the emergency switch is off", async () => {
    const f = await setup("off");
    const generationId = await f.writer.mutation(api.generations.requestGeneration, {
      projectId: f.projectId,
      candidateMode: "single",
    });
    expect((await f.t.run((ctx) => ctx.db.get(generationId)))?.placeholders).toBeUndefined();
  });

  it("hides every name at the HTTP boundary and restores the response, for Claude too", async () => {
    const f = await setup();
    const generationId = await f.writer.mutation(api.generations.requestGeneration, {
      projectId: f.projectId,
      candidateMode: "single",
    });
    const bodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        bodies.push(await new Request(input, init).text());
        return Response.json({
          id: "msg_placeholder",
          type: "message",
          role: "assistant",
          model: MODEL,
          content: [
            { type: "text", text: "[PERSON_4_FIRST] built it for [CLIENT_1_SHORT]." },
            { type: "tool_use", id: "tool_1", name: "t", input: { quote: "A controller for [CLIENT_1_SHORT]." } },
          ],
          stop_reason: "tool_use",
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 5 },
        });
      })
    );
    const response = await f.t.action(async (ctx) =>
      clientForModel(ctx, MODEL, {
        callSite: "generation:analyzer",
        projectId: f.projectId,
        attribution: { generationId },
      }).messages.create({
        model: MODEL,
        max_tokens: 100,
        system: "You write for Verdant Grid Technologies Inc.",
        messages: [
          {
            role: "user",
            content: "Dana Whitfield: What did you build?\n\nMarcus Lindqvist: A controller for Verdant Grid Technologies.",
          },
        ],
      })
    );
    // The reserved pipeline is scheduled but never run here: this is the
    // one request made.
    expect(bodies).toHaveLength(1);
    for (const name of ["Verdant", "Dana", "Whitfield", "Marcus", "Lindqvist"]) expect(bodies[0]).not.toContain(name);
    expect(bodies[0]).toContain("[PERSON_1]: What did you build?");
    expect(response.content).toEqual([
      { type: "text", text: "Marcus built it for Verdant Grid Technologies." },
      { type: "tool_use", id: "tool_1", name: "t", input: { quote: "A controller for Verdant Grid Technologies." } },
    ]);
  });
});

/**
 * Review 2026-09-25: speaker rows are written by a build scheduled after the
 * transcript is saved, and three demo drafts started 28 to 53 ms after the
 * save froze maps without the speakers' names. The map now parses the text
 * itself, so it is the same whether or not the build has run.
 */
describe("placeholders frozen before the speaker build runs", () => {
  // Nobody here but the interviewer is on the project record.
  const TRANSCRIPT = [
    "Dana Whitfield: What did you build for the feeder?",
    "",
    "Marcus Lindqvist: A predictive controller.",
    "",
    "Anika Rao (Northwind Labs): We ran the bench tests.",
    "",
    "Dana Whitfield: How long did that take?",
    "",
    "Shah, Priya [00:04:10]: About six weeks.",
  ].join("\n");
  const SPEAKER_WORDS = ["Dana", "Whitfield", "Marcus", "Lindqvist", "Anika", "Rao", "Northwind", "Shah", "Priya", "Verdant"];

  async function setupFresh(tag: string) {
    const t = convexTest(schema, modules);
    const projectId = await t.run(async (ctx) => {
      const writerId = await ctx.db.insert("users", { authId: `race-${tag}`, role: "writer", firstName: "Wren", lastName: "Writer" });
      return await ctx.db.insert("projects", {
        title: "Helios",
        clientName: "Verdant Grid Technologies Inc.",
        interviewer: "Dana Whitfield",
        status: "draft",
        createdBy: writerId,
        shareToken: `race-${tag}`,
        createdAt: 1,
        updatedAt: 1,
      });
    });
    const writer = t.withIdentity({ subject: `race-${tag}` });
    // The real intake path: saves the row and schedules the speaker build.
    const transcriptId = await writer.mutation(api.transcripts.addTranscript, {
      projectId,
      content: TRANSCRIPT,
      label: "Helios interview",
    });
    return { t, projectId, transcriptId, writer };
  }

  async function speakerLabels(
    t: Awaited<ReturnType<typeof setupFresh>>["t"],
    transcriptId: Awaited<ReturnType<typeof setupFresh>>["transcriptId"]
  ) {
    return await t.run(async (ctx) =>
      (
        await ctx.db
          .query("transcriptSpeakers")
          .withIndex("by_transcriptId_and_label", (q) => q.eq("transcriptId", transcriptId))
          .take(10)
      ).map((row) => row.label)
    );
  }

  it("hides every speaker at the HTTP boundary when the draft starts before the build", async () => {
    const f = await setupFresh("before");
    // The build is scheduled but has not run: no speaker rows yet.
    expect(await speakerLabels(f.t, f.transcriptId)).toEqual([]);
    const generationId = await f.writer.mutation(api.generations.requestGeneration, {
      projectId: f.projectId,
      candidateMode: "single",
    });
    const values = (await f.t.run((ctx) => ctx.db.get(generationId)))?.placeholders?.map((entry) => entry.value) ?? [];
    for (const name of ["Dana Whitfield", "Marcus Lindqvist", "Anika Rao", "Priya Shah", "Shah, Priya", "Northwind Labs"]) {
      expect(values).toContain(name);
    }

    const bodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        bodies.push(await new Request(input, init).text());
        return Response.json({
          id: "msg_race",
          type: "message",
          role: "assistant",
          model: MODEL,
          content: [{ type: "text", text: "ok" }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 1 },
        });
      })
    );
    await f.t.action(async (ctx) =>
      clientForModel(ctx, MODEL, {
        callSite: "generation:analyzer",
        projectId: f.projectId,
        attribution: { generationId },
      }).messages.create({
        model: MODEL,
        max_tokens: 100,
        messages: [{ role: "user", content: TRANSCRIPT }],
      })
    );
    expect(bodies).toHaveLength(1);
    for (const word of SPEAKER_WORDS) expect(bodies[0], word).not.toContain(word);
    expect(bodies[0]).toContain("What did you build for the feeder?");
  });

  it("freezes the same map once the build has written the speaker rows", async () => {
    const before = await setupFresh("same-before");
    const beforeId = await before.writer.mutation(api.generations.requestGeneration, {
      projectId: before.projectId,
      candidateMode: "single",
    });
    const beforeMap = (await before.t.run((ctx) => ctx.db.get(beforeId)))?.placeholders;

    const after = await setupFresh("same-after");
    await after.t.mutation(internal.transcripts.buildTranscriptStructure, { transcriptId: after.transcriptId });
    expect((await speakerLabels(after.t, after.transcriptId)).sort()).toEqual([
      "Anika Rao",
      "Dana Whitfield",
      "Marcus Lindqvist",
      "Priya Shah",
    ]);
    const afterId = await after.writer.mutation(api.generations.requestGeneration, {
      projectId: after.projectId,
      candidateMode: "single",
    });
    const afterMap = (await after.t.run((ctx) => ctx.db.get(afterId)))?.placeholders;
    expect(beforeMap?.length).toBeGreaterThan(0);
    expect(afterMap).toEqual(beforeMap);
  });

  it("hides the speakers of a transcript whose build has not run in an extraction's map too", async () => {
    const f = await setupFresh("facts");
    await f.t.mutation(internal.transcripts.buildTranscriptStructure, { transcriptId: f.transcriptId });
    // A second interview added a moment ago: its build has not run.
    const second = await f.writer.mutation(api.transcripts.addTranscript, {
      projectId: f.projectId,
      content: "Dana Whitfield: Who wired the rig?\n\nTomas Okafor: I did, over two weekends.",
      label: "Follow-up",
    });
    expect(await speakerLabels(f.t, second)).toEqual([]);
    const input = await f.t.query(internal.transcripts.factsInput, { transcriptId: f.transcriptId });
    expect(input?.placeholders.map((entry) => entry.value)).toContain("Tomas Okafor");
  });
});
