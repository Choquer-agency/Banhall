/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { clientForModel, resetGenerationModelCache, resetGenerationPlaceholderCache } from "./ai/providers";
import { MODEL } from "./ai/model";
import { TRANSCRIPT_PARSER_VERSION } from "../shared/transcriptParse";

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
      ownerId: writerId,
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
 * Review 2026-09-25: models sometimes write a placeholder without its
 * brackets (`CLIENT_1_BRAND`, "led by PERSON_2"). The restore at the
 * provider boundary takes a bare id the frozen map issued, and only that.
 */
describe("bare placeholders at the HTTP boundary", () => {
  function stubResponse(content: unknown[], bodies: string[]) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        bodies.push(await new Request(input, init).text());
        return Response.json({
          id: "msg_bare",
          type: "message",
          role: "assistant",
          model: MODEL,
          content,
          stop_reason: "tool_use",
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 5 },
        });
      })
    );
  }

  it("restores bare ids in text and nested tool input, leaving ids the map never issued", async () => {
    const f = await setup();
    const generationId = await f.writer.mutation(api.generations.requestGeneration, {
      projectId: f.projectId,
      candidateMode: "single",
    });
    const bodies: string[] = [];
    stubResponse(
      [
        { type: "text", text: "CLIENT_1_BRAND's controller, led by PERSON_4; PERSON_1_FIRST asked. CLIENT_10 and XPERSON_1 stay." },
        {
          type: "tool_use",
          id: "tool_1",
          name: "t",
          input: {
            claims: [{ text: "PERSON_3 confirmed CLIENT_1_SHORT's result", quote: "A controller for [CLIENT_1_SHORT]." }],
            meta: { ids: ["PERSON_9", "CLIENT_1_OTHER", "PERSON_4_LAST"] },
          },
        },
      ],
      bodies
    );
    const response = await f.t.action(async (ctx) =>
      clientForModel(ctx, MODEL, {
        callSite: "generation:analyzer",
        projectId: f.projectId,
        attribution: { generationId },
      }).messages.create({
        model: MODEL,
        max_tokens: 100,
        messages: [
          {
            role: "user",
            content: "Dana Whitfield: What did you build?\n\nMarcus Lindqvist: A controller for Verdant Grid Technologies.",
          },
        ],
      })
    );
    expect(bodies).toHaveLength(1);
    // The request is masked exactly as before.
    expect(bodies[0]).toContain("[PERSON_1]: What did you build?\\n\\n[PERSON_4]: A controller for [CLIENT_1_SHORT].");
    expect(response.content).toEqual([
      { type: "text", text: "Verdant Grid's controller, led by Marcus Lindqvist; Dana asked. CLIENT_10 and XPERSON_1 stay." },
      {
        type: "tool_use",
        id: "tool_1",
        name: "t",
        input: {
          claims: [{ text: "Priya Shah confirmed Verdant Grid Technologies's result", quote: "A controller for Verdant Grid Technologies." }],
          meta: { ids: ["PERSON_9", "CLIENT_1_OTHER", "Lindqvist"] },
        },
      },
    ]);
  });

  it("renumbers the frozen map past a literal bare id in a transcript, so the id is never restored into a name", async () => {
    const f = await setup();
    await f.t.run(async (ctx) => {
      await ctx.db.insert("transcripts", {
        projectId: f.projectId,
        content: "Marcus Lindqvist: PERSON_1 in the logger is the rig id, and CLIENT_1 is the test bench.",
        createdAt: 2,
        position: 1,
      });
    });
    const generationId = await f.writer.mutation(api.generations.requestGeneration, {
      projectId: f.projectId,
      candidateMode: "single",
    });
    const map = (await f.t.run((ctx) => ctx.db.get(generationId)))?.placeholders ?? [];
    const tokens = map.map((entry) => entry.token);
    expect(tokens[0]).toBe("[CLIENT_2]");
    expect(tokens).not.toContain("[PERSON_1]");
    expect(map.find((entry) => entry.value === "Marcus Lindqvist")?.token).toBe("[PERSON_5]");
    // Built since bare ids restore, so every entry carries the mark.
    expect(map.every((entry) => entry.bare)).toBe(true);

    const bodies: string[] = [];
    stubResponse([{ type: "text", text: "PERSON_1 is the rig id on CLIENT_1, per PERSON_5 of CLIENT_2_BRAND." }], bodies);
    const response = await f.t.action(async (ctx) =>
      clientForModel(ctx, MODEL, {
        callSite: "generation:analyzer",
        projectId: f.projectId,
        attribution: { generationId },
      }).messages.create({
        model: MODEL,
        max_tokens: 100,
        messages: [{ role: "user", content: "Marcus Lindqvist: PERSON_1 in the logger is the rig id, and CLIENT_1 is the test bench." }],
      })
    );
    expect(bodies[0]).toContain("[PERSON_5]: PERSON_1 in the logger is the rig id, and CLIENT_1 is the test bench.");
    expect(response.content).toEqual([
      { type: "text", text: "PERSON_1 is the rig id on CLIENT_1, per Marcus Lindqvist of Verdant Grid." },
    ]);
  });

  it("restores only bracketed tokens for a generation whose map was frozen before bare ids were restored", async () => {
    const f = await setup();
    const generationId = await f.writer.mutation(api.generations.requestGeneration, {
      projectId: f.projectId,
      candidateMode: "single",
    });
    // A map frozen before the change has no mark on its entries.
    await f.t.run(async (ctx) => {
      const generation = await ctx.db.get(generationId);
      const frozen = (generation?.placeholders ?? []).map(({ token, value }) => ({ token, value }));
      expect(frozen.length).toBeGreaterThan(0);
      await ctx.db.patch(generationId, { placeholders: frozen });
    });
    const bodies: string[] = [];
    stubResponse([{ type: "text", text: "PERSON_4 of CLIENT_1_BRAND, per [PERSON_4] of [CLIENT_1_BRAND]." }], bodies);
    const response = await f.t.action(async (ctx) =>
      clientForModel(ctx, MODEL, {
        callSite: "generation:analyzer",
        projectId: f.projectId,
        attribution: { generationId },
      }).messages.create({
        model: MODEL,
        max_tokens: 100,
        messages: [{ role: "user", content: "Marcus Lindqvist: A controller for Verdant Grid Technologies." }],
      })
    );
    // The request is masked the same way either way.
    expect(bodies[0]).toContain("[PERSON_4]: A controller for [CLIENT_1_SHORT].");
    expect(response.content).toEqual([
      { type: "text", text: "PERSON_4 of CLIENT_1_BRAND, per Marcus Lindqvist of Verdant Grid." },
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

  async function setupFresh(tag: string, content = TRANSCRIPT) {
    const t = convexTest(schema, modules);
    const projectId = await t.run(async (ctx) => {
      const writerId = await ctx.db.insert("users", { authId: `race-${tag}`, role: "writer", firstName: "Wren", lastName: "Writer" });
      return await ctx.db.insert("projects", {
        title: "Helios",
        clientName: "Verdant Grid Technologies Inc.",
        interviewer: "Dana Whitfield",
        status: "draft",
        createdBy: writerId,
        ownerId: writerId,
        shareToken: `race-${tag}`,
        createdAt: 1,
        updatedAt: 1,
      });
    });
    const writer = t.withIdentity({ subject: `race-${tag}` });
    // The real intake path: saves the row and schedules the speaker build.
    const transcriptId = await writer.mutation(api.transcripts.addTranscript, {
      projectId,
      content,
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

  it("reads the names the build stored at generation start, and parses a row the current parser did not build", async () => {
    const f = await setupFresh("stored");
    await f.t.mutation(internal.transcripts.buildTranscriptStructure, { transcriptId: f.transcriptId });
    const built = await f.t.run((ctx) => ctx.db.get(f.transcriptId));
    expect(built?.speakerNames).toEqual({
      parserVersion: TRANSCRIPT_PARSER_VERSION,
      otherNames: ["Shah, Priya"],
      organizations: ["Northwind Labs"],
    });
    // A name only the stored list holds: a map that reads the stored names
    // has it, a map that parses the text does not.
    await f.t.run((ctx) =>
      ctx.db.patch(f.transcriptId, {
        speakerNames: { ...built!.speakerNames!, otherNames: ["Shah, Priya", "Stored Sentinel"] },
      })
    );
    const current = await f.writer.mutation(api.generations.requestGeneration, {
      projectId: f.projectId,
      candidateMode: "single",
    });
    const currentValues = (await f.t.run((ctx) => ctx.db.get(current)))?.placeholders?.map((entry) => entry.value);
    expect(currentValues).toContain("Stored Sentinel");
    expect(currentValues).toContain("Northwind Labs");

    // Built by an older parser: the stored names are not trusted, the text is
    // parsed, and every speaker is still hidden.
    const old = await setupFresh("stored-stale");
    await old.t.mutation(internal.transcripts.buildTranscriptStructure, { transcriptId: old.transcriptId });
    await old.t.run((ctx) =>
      ctx.db.patch(old.transcriptId, {
        parserVersion: "4",
        speakerNames: { parserVersion: "4", otherNames: ["Stored Sentinel"], organizations: [] },
      })
    );
    const stale = await old.writer.mutation(api.generations.requestGeneration, {
      projectId: old.projectId,
      candidateMode: "single",
    });
    const staleValues = (await old.t.run((ctx) => ctx.db.get(stale)))?.placeholders?.map((entry) => entry.value);
    expect(staleValues).not.toContain("Stored Sentinel");
    for (const name of ["Dana Whitfield", "Marcus Lindqvist", "Anika Rao", "Priya Shah", "Shah, Priya", "Northwind Labs"]) {
      expect(staleValues).toContain(name);
    }
  });

  it("keeps people apart and hides each one when a company is written before their name (Acme (Priya Shah))", async () => {
    const content = [
      "Jordan Ellis: Priya, why not buy one?",
      "",
      "Acme (Priya Shah): We tried. Raj knows.",
      "",
      "Jordan Ellis: Raj?",
      "",
      "Acme (Raj Patel): Shah is right.",
    ].join("\n");
    for (const built of [false, true]) {
      const f = await setupFresh(`acme-${built}`, content);
      if (built) {
        await f.t.mutation(internal.transcripts.buildTranscriptStructure, { transcriptId: f.transcriptId });
        expect((await speakerLabels(f.t, f.transcriptId)).sort()).toEqual(["Jordan Ellis", "Priya Shah", "Raj Patel"]);
      }
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
            id: "msg_acme",
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
          messages: [{ role: "user", content }],
        })
      );
      expect(bodies).toHaveLength(1);
      for (const word of ["Priya", "Raj", "Shah", "Patel", "Jordan", "Ellis", "Acme"]) {
        expect(bodies[0], `${word} (built: ${built})`).not.toContain(word);
      }
      expect(bodies[0]).toContain("why not buy one?");
    }
  });

  it("hides a company or a person whose name holds a title word (Northwind Engineering, Acme (Jonathan Head))", async () => {
    const content = [
      "Jordan Ellis: Who built the rig?",
      "",
      "Priya Shah (Northwind Engineering): Our bench team.",
      "",
      "Raj Patel (Pacific Research): We ran the tests.",
      "",
      "Ann Lee (Acme Design): We drew the housing.",
      "",
      "Acme (Jonathan Head): I signed it off.",
      "",
      "Acme (Pedro Sales): I ordered the parts.",
      "",
      "Tom Becker (VP Engineering): The design held.",
    ].join("\n");
    const words = ["Northwind", "Pacific", "Acme", "Jonathan", "Head", "Pedro", "Sales", "Priya", "Patel", "Becker"];
    for (const built of [false, true]) {
      const f = await setupFresh(`titles-${built}`, content);
      if (built) {
        await f.t.mutation(internal.transcripts.buildTranscriptStructure, { transcriptId: f.transcriptId });
        expect((await speakerLabels(f.t, f.transcriptId)).sort()).toEqual([
          "Ann Lee",
          "Jonathan Head",
          "Jordan Ellis",
          "Pedro Sales",
          "Priya Shah",
          "Raj Patel",
          "Tom Becker",
        ]);
      }
      const generationId = await f.writer.mutation(api.generations.requestGeneration, {
        projectId: f.projectId,
        candidateMode: "single",
      });
      const values = (await f.t.run((ctx) => ctx.db.get(generationId)))?.placeholders?.map((entry) => entry.value) ?? [];
      for (const value of ["Northwind Engineering", "Pacific Research", "Acme Design", "Acme", "Jonathan Head", "Pedro Sales"]) {
        expect(values, `${value} (built: ${built})`).toContain(value);
      }
      // A title made only of title words names no one.
      expect(values).not.toContain("VP Engineering");
      const bodies: string[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          bodies.push(await new Request(input, init).text());
          return Response.json({
            id: "msg_titles",
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
          messages: [{ role: "user", content }],
        })
      );
      expect(bodies).toHaveLength(1);
      for (const word of words) {
        expect(bodies[0], `${word} (built: ${built})`).not.toContain(word);
      }
      expect(bodies[0]).toContain("VP Engineering");
      expect(bodies[0]).toContain("We drew the housing.");
    }
  });

  it("keeps hiding speakers past the speaker row cap when the build's stored names are read", async () => {
    const first = ["Avery", "Blake", "Casey", "Devon", "Emery", "Finley", "Gray", "Harper", "Indigo", "Jules", "Kendall", "Logan", "Morgan", "Noel", "Oakley"];
    const last = ["Abbott", "Barros", "Castell", "Dunmore", "Everly", "Fairholt", "Gansett"];
    const names = Array.from({ length: 105 }, (_, i) => `${first[i % first.length]} ${last[Math.floor(i / first.length)]}`);
    const content = names.map((name, i) => `${name}: Line ${i} about the rig.`).join("\n\n");
    const f = await setupFresh("past-cap", content);
    await f.t.mutation(internal.transcripts.buildTranscriptStructure, { transcriptId: f.transcriptId });
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    const row = await f.t.run((ctx) => ctx.db.get(f.transcriptId));
    expect(row?.parserVersion).toBe(TRANSCRIPT_PARSER_VERSION);
    expect(row?.structureBuildId).toBeUndefined();
    // Rows stop at the cap; the labels past it are kept with the other names.
    expect((await speakerLabels(f.t, f.transcriptId)).length).toBeGreaterThan(0);
    expect(row?.speakerNames?.otherNames).toEqual(names.slice(100));

    const generationId = await f.writer.mutation(api.generations.requestGeneration, {
      projectId: f.projectId,
      candidateMode: "single",
    });
    const values = (await f.t.run((ctx) => ctx.db.get(generationId)))?.placeholders?.map((entry) => entry.value) ?? [];
    for (const name of names) expect(values, name).toContain(name);
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
