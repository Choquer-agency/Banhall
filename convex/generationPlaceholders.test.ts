/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
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
