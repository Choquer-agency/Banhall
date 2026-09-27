/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import workflowSchema from "../node_modules/@convex-dev/workflow/src/component/schema.js";
import workpoolSchema from "../node_modules/@convex-dev/workpool/src/component/schema.js";
import { clientForModel, resetGenerationModelCache, resetGenerationPlaceholderCache } from "./ai/providers";
import { MODEL } from "./ai/model";

/**
 * Audit wave 2, privacy (2026-09-26; a2 P2-5, a4 #9 and #10): parser v8
 * labels (lowercase, email, caseless script, short), the firm's own names
 * and research prompts, checked on the request body the real SDKs send
 * with only `fetch` stubbed. Every name here is fictional.
 */
const modules = import.meta.glob("./**/*.ts");
const workflowModules = import.meta.glob("../node_modules/@convex-dev/workflow/src/component/**/*.ts");
const workpoolModules = import.meta.glob("../node_modules/@convex-dev/workpool/src/component/**/*.ts");

const TRANSCRIPT = [
  "dana whitfield: What did you build for the feeder?",
  "marcus lindqvist: A controller. Marcus here, and Bo helped.",
  "pshah@acme.example: I ran the bench. Ask pshah for the logs.",
  "李伟: 我们重建了测试台。",
  "dana whitfield: And Northwind Advisory wrote the claim?",
  "marcus lindqvist: Yes, NWA did.",
  "李伟: 李伟确认了结果。",
  "Bo: The drift stayed in band.",
].join("\n\n");

/** Every name the request bodies must never hold. */
const HIDDEN = [
  "dana",
  "Dana",
  "whitfield",
  "Whitfield",
  "marcus",
  "Marcus",
  "lindqvist",
  "Lindqvist",
  "pshah",
  "acme.example",
  "李伟",
  "Northwind",
  "NWA",
  "Verdant",
];

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-wave2-key");
  vi.stubEnv("OPENROUTER_API_KEY", "synthetic-wave2-openrouter");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected HTTP transport"); }));
  resetGenerationModelCache();
  resetGenerationPlaceholderCache();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function setup(options: { report?: boolean } = {}) {
  const t = convexTest(schema, modules);
  t.registerComponent("researchWorkflow", workflowSchema, workflowModules);
  t.registerComponent("researchWorkflow/workpool", workpoolSchema, workpoolModules);
  const ids = await t.run(async (ctx) => {
    const writerId = await ctx.db.insert("users", { authId: "w2-writer", role: "writer", firstName: "Wren", lastName: "Writer" });
    const adminId = await ctx.db.insert("users", { authId: "w2-admin", role: "admin", name: "Ada Admin" });
    const projectId = await ctx.db.insert("projects", {
      title: "Helios",
      clientName: "Verdant Grid Technologies Inc.",
      writer: "Wren Writer",
      status: "draft",
      createdBy: writerId,
      ownerId: writerId,
      shareToken: "w2-token",
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("transcripts", { projectId, content: TRANSCRIPT, createdAt: 1, position: 0 });
    // A generation needs a project with no report yet; research needs one.
    if (!options.report) return { writerId, adminId, projectId, reportId: undefined };
    const reportId = await ctx.db.insert("reports", {
      projectId,
      content: "Marcus Lindqvist and 李伟 rebuilt the feeder rig for Verdant Grid.",
      version: 1,
      generatedAt: 1,
      updatedAt: 1,
      revisionNumber: 1,
    });
    return { writerId, adminId, projectId, reportId };
  });
  await t.withIdentity({ subject: "w2-admin" }).mutation(api.appSettings.setFirmNames, {
    names: ["Northwind Advisory", "NWA"],
  });
  return { t, ...ids, writer: t.withIdentity({ subject: "w2-writer" }) };
}

function captureOpenRouter(bodies: string[], content: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      expect(request.url).toContain("openrouter.ai");
      bodies.push(await request.text());
      return Response.json({
        id: "gen-w2",
        model: "test",
        choices: [{ message: { role: "assistant", content } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.001 },
      });
    })
  );
}

describe("generation calls hide parser v8 labels and the firm", () => {
  it("freezes every label kind and the firm names in the generation's map", async () => {
    const f = await setup();
    const generationId = await f.writer.mutation(api.generations.requestGeneration, {
      projectId: f.projectId,
      candidateMode: "single",
    });
    const values = (await f.t.run((ctx) => ctx.db.get(generationId)))?.placeholders?.map((entry) => entry.value) ?? [];
    for (const name of [
      "Northwind Advisory",
      "NWA",
      "dana whitfield",
      "Dana",
      "marcus lindqvist",
      "Marcus",
      "pshah@acme.example",
      "pshah",
      "acme.example",
      "李伟",
      "Bo",
    ]) {
      expect(values, name).toContain(name);
    }
  });

  it("sends no name at the HTTP boundary and restores the response, for Claude too", async () => {
    const f = await setup();
    const generationId = await f.writer.mutation(api.generations.requestGeneration, {
      projectId: f.projectId,
      candidateMode: "single",
    });
    const map = (await f.t.run((ctx) => ctx.db.get(generationId)))?.placeholders ?? [];
    const tokenOf = (value: string) => map.find((entry) => entry.value === value)!.token;
    const bodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        bodies.push(await new Request(input, init).text());
        return Response.json({
          id: "msg_w2",
          type: "message",
          role: "assistant",
          model: MODEL,
          content: [
            {
              type: "text",
              text: `${tokenOf("李伟")} and ${tokenOf("Marcus")} built it; ${tokenOf("Northwind Advisory")} filed.`,
            },
          ],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 5 },
        });
      })
    );
    const response = await f.t.action((ctx) =>
      clientForModel(ctx, MODEL, {
        callSite: "generation:analyzer",
        projectId: f.projectId,
        attribution: { generationId },
      }).messages.create({
        model: MODEL,
        max_tokens: 100,
        system: "You write for Verdant Grid Technologies Inc. on behalf of Northwind Advisory.",
        messages: [{ role: "user", content: TRANSCRIPT }],
      })
    );
    expect(bodies).toHaveLength(1);
    for (const name of HIDDEN) expect(bodies[0], name).not.toContain(name);
    // "Bo" as a whole word is hidden too.
    expect(bodies[0]).not.toMatch(/(?<![\p{L}\p{N}])Bo(?![\p{L}\p{N}])/u);
    expect(response.content).toEqual([
      { type: "text", text: "李伟 and Marcus built it; Northwind Advisory filed." },
    ]);
  });
});

describe("research prompts go through the same map", () => {
  async function startSession(f: Awaited<ReturnType<typeof setup>>) {
    return await f.writer.mutation(api.research.startResearch, {
      reportId: f.reportId!,
      selectedText: "Marcus Lindqvist and 李伟 rebuilt the feeder rig for Verdant Grid.",
      selectionFrom: 1,
      selectionTo: 60,
      surroundingContext: "pshah ran the bench; Northwind Advisory (NWA) wrote the claim with Dana.",
      instruction: "Check what dana whitfield said about drift standards.",
    });
  }

  it("masks the external brief with first and last name parts and speaker names", async () => {
    const f = await setup({ report: true });
    const sessionId = await startSession(f);
    const session = await f.t.run((ctx) => ctx.db.get(sessionId));
    expect(session?.placeholders?.length).toBeGreaterThan(0);
    for (const name of HIDDEN) expect(session?.externalBrief, name).not.toContain(name);
    expect(session?.externalBrief).toContain("Selected report passage");
  });

  it("sends no name to the researchers or the reviewer, and restores the reviewer's answer", async () => {
    const f = await setup({ report: true });
    const sessionId = await startSession(f);
    const map = (await f.t.run((ctx) => ctx.db.get(sessionId)))?.placeholders ?? [];
    const tokenOf = (value: string) => map.find((entry) => entry.value === value)!.token;

    const researchBodies: string[] = [];
    captureOpenRouter(researchBodies, `Drift standards apply to ${tokenOf("Marcus Lindqvist")}'s rig.`);
    await f.t.action(internal.ai.research.actions.runExternalResearch, { sessionId, provider: "gpt" });
    expect(researchBodies).toHaveLength(1);
    for (const name of HIDDEN) expect(researchBodies[0], name).not.toContain(name);

    const reviewerBodies: string[] = [];
    captureOpenRouter(
      reviewerBodies,
      JSON.stringify({
        answer: `${tokenOf("Marcus Lindqvist")} and ${tokenOf("李伟")} followed the standard; ${tokenOf("Northwind Advisory")} can cite it.`,
        evidenceBoundary: `General knowledge only for ${tokenOf("Verdant Grid Technologies Inc.")}.`,
        confidence: "medium",
        warnings: [],
        claims: [{ text: `${tokenOf("Marcus")} tested drift.`, evidenceKind: "external", support: "qualified", sourceKeys: [] }],
        proposedText: `${tokenOf("Marcus Lindqvist")} and ${tokenOf("李伟")} rebuilt the feeder rig for ${tokenOf("Verdant Grid")}, following the drift standard.`,
      })
    );
    await f.t.action(internal.ai.research.actions.reviewResearch, { sessionId });
    expect(reviewerBodies).toHaveLength(1);
    for (const name of HIDDEN) expect(reviewerBodies[0], name).not.toContain(name);

    const session = await f.t.run((ctx) => ctx.db.get(sessionId));
    expect(session?.status).toBe("completed");
    expect(session?.answer).toBe("Marcus Lindqvist and 李伟 followed the standard; Northwind Advisory can cite it.");
    expect(session?.evidenceBoundary).toBe("General knowledge only for Verdant Grid Technologies Inc..");
    const claims = await f.t.run((ctx) =>
      ctx.db.query("researchClaims").withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId)).take(5)
    );
    expect(claims.map((claim) => claim.text)).toEqual(["Marcus tested drift."]);
    const proposal = session?.proposalId ? await f.t.run((ctx) => ctx.db.get(session.proposalId!)) : null;
    expect(proposal?.newText).toBe(
      "Marcus Lindqvist and 李伟 rebuilt the feeder rig for Verdant Grid, following the drift standard."
    );
  });

  it("keeps the whole-string redaction when placeholders are switched off", async () => {
    const f = await setup({ report: true });
    await f.t.run(async (ctx) => {
      await ctx.db.insert("appSettings", { key: "transcripts.placeholders", value: "off", updatedBy: f.adminId, updatedAt: 1 });
    });
    const sessionId = await startSession(f);
    const session = await f.t.run((ctx) => ctx.db.get(sessionId));
    expect(session?.placeholders).toBeUndefined();
    expect(session?.externalBrief).not.toContain("Verdant Grid Technologies Inc.");
    expect(session?.externalBrief).not.toContain("Northwind Advisory");
  });
});

describe("the firm-name setting", () => {
  it("is empty until an admin sets it, and only admins read or write it", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { authId: "fn-admin", role: "admin", name: "Ada Admin" });
      await ctx.db.insert("users", { authId: "fn-writer", role: "writer", name: "Wren Writer" });
    });
    const admin = t.withIdentity({ subject: "fn-admin" });
    const writer = t.withIdentity({ subject: "fn-writer" });
    expect(await admin.query(api.appSettings.getFirmNames, {})).toEqual({ names: [], updatedAt: null });
    expect(await writer.query(api.appSettings.getFirmNames, {})).toBeNull();
    await expect(writer.mutation(api.appSettings.setFirmNames, { names: ["Northwind"] })).rejects.toThrow(
      /NOT_AUTHORIZED|elevated role/
    );
    await admin.mutation(api.appSettings.setFirmNames, { names: ["  Northwind   Advisory ", "", "NWA", "NWA"] });
    expect((await admin.query(api.appSettings.getFirmNames, {}))?.names).toEqual(["Northwind Advisory", "NWA"]);
    await expect(admin.mutation(api.appSettings.setFirmNames, { names: ["x".repeat(121)] })).rejects.toThrow(
      /at most 120/
    );
    await admin.mutation(api.appSettings.setFirmNames, { names: [] });
    expect((await admin.query(api.appSettings.getFirmNames, {}))?.names).toEqual([]);
  });
});
