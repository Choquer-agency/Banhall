/// <reference types="vite/client" />
/**
 * Decision 65 (Opus review K): an adoption that throws never costs the
 * Step-by-step start its Brief. The run's key computation is made to fail
 * here; the start must still derive its own Brief. Removing the fail-open
 * catch in deriveOrAdoptSeedBrief fails this test.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import schema from "./schema";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { sha256 } from "./lib/contracts";
import { TRANSCRIPT_PARSER_VERSION } from "../shared/transcriptParse";
import { BRIEF_REQUEST } from "./lib/briefRequest";
import { anthropicToolSse, sseResponse } from "./anthropicSse.fixture";
import { deriveOrAdoptSeedBrief } from "./ai/brief";
import { clientForStep, resetGenerationModelCache, resetGenerationPlaceholderCache } from "./ai/providers";
import { resolveGenerationStep } from "./lib/generationSteps";
import { api } from "./_generated/api";

vi.mock("./lib/briefPreparationKey", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/briefPreparationKey")>()),
  generationBriefKey: async () => {
    throw new Error("Key computation failed");
  },
}));

const modules = import.meta.glob("./**/*.ts");
const TRANSCRIPT = "Interviewer: What held?\n\nPriya Raman: The fluoropolymer seal held for 400 cycles without leaking.";
let calls = 0;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-key");
  resetGenerationModelCache();
  resetGenerationPlaceholderCache();
  calls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls += 1;
      const body = (await new Request(input, init).json()) as { model: string };
      return sseResponse(
        anthropicToolSse({
          model: body.model,
          tool: BRIEF_REQUEST.toolName,
          input: { storyline: "S.", storylineClaims: [], claimExclusions: [], confidenceMap: [], glossaryTerms: [] },
        })
      );
    })
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

test("an adoption that throws falls through to the run's own Brief", async () => {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { authId: "fail-open-writer", role: "writer" });
    const projectId = await ctx.db.insert("projects", {
      title: "Fail open", clientName: "Acme", status: "draft", projectType: "writing", ownerId: userId,
      createdBy: userId, shareToken: "fail-open", createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("transcripts", {
      projectId, content: TRANSCRIPT, contentHash: await sha256(TRANSCRIPT), label: "Interview", position: 0,
      parserVersion: TRANSCRIPT_PARSER_VERSION, createdAt: now,
    });
    // A ready preparation exists, so the start computes its key.
    await ctx.db.insert("briefPreparations", {
      projectId, status: "ready", revision: 1, runAt: now, triggeredBy: userId, triggerReason: "transcript_added",
      createdAt: now, updatedAt: now, key: "v1:other",
    });
    return { userId, projectId };
  });
  const writer = t.withIdentity({ subject: "fail-open-writer" });
  const generationId: Id<"generations"> = await writer.mutation(api.generations.requestGeneration, {
    projectId: ids.projectId,
    candidateMode: "iterative",
  });
  await t.run(async (ctx) => ctx.db.patch(generationId, { status: "running" }));
  const generation = (await t.run(async (ctx) => ctx.db.get(generationId))) as Doc<"generations">;
  const run = t.action as unknown as (handler: (ctx: ActionCtx) => Promise<unknown>) => Promise<unknown>;
  const result = (await run.call(t, async (ctx: ActionCtx) => {
    const route = resolveGenerationStep({ freeze: generation.modelFreeze ?? null, step: "brief", writerModel: generation.singleModelId! });
    const client = clientForStep(ctx, route, {
      callSite: "generation:brief", projectId: ids.projectId, attribution: { generationId },
    });
    return await deriveOrAdoptSeedBrief(ctx, client, { projectId: ids.projectId, generationId, model: route.model });
  })) as { kind: string };
  expect(result.kind).toBe("derived");
  expect(calls).toBe(1);
});
