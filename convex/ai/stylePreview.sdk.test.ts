/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import schema from "../schema";
import { previewMyStyleRef } from "../../src/lib/settings/stylePreviewApi";
import { buildStylePreviewPrompt } from "./stylePreview";
import { NO_STYLE_OVERRIDES } from "../../shared/styleOverrides";
import { ROLE_POLICIES } from "../../shared/modelCatalog";

// Keep the model catalog, the Anthropic SDK and Convex persistence real;
// replace only the HTTP transport (AGENTS pitfall: prove the request body at
// the real SDK boundary).
const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, load]) => [
    path.startsWith("./") ? `../ai/${path.slice(2)}` : path,
    load,
  ]),
);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-preview-key");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected HTTP transport"); }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

test("sends the house preview request through the real SDK and stores the decoded sample", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("users", { authId: "sdk-writer", role: "writer" });
  });
  const requests: Request[] = [];
  const transport = vi.fn<typeof fetch>(async (input, init) => {
    const request = new Request(input, init);
    requests.push(request);
    const body = (await request.clone().json()) as { model: string };
    return Response.json({
      id: "msg_preview",
      type: "message",
      role: "assistant",
      model: body.model,
      content: [{ type: "text", text: "Cedarline did not know.\n\nThe team ran three builds." }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 40, output_tokens: 12 },
    }, { headers: { "request-id": "req_preview" } });
  });
  vi.stubGlobal("fetch", transport);

  const result = await t
    .withIdentity({ subject: "sdk-writer", tokenIdentifier: "sdk|writer" })
    .action(previewMyStyleRef, { variant: "house" });
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  expect(result).toEqual({
    status: "ready",
    cached: false,
    paragraphs: ["Cedarline did not know.", "The team ran three builds."],
  });
  expect(transport).toHaveBeenCalledTimes(1);
  const request = requests[0]!;
  expect(request.url).toBe("https://api.anthropic.com/v1/messages");
  expect(request.headers.get("x-api-key")).toBe("synthetic-preview-key");
  const body = (await request.json()) as Record<string, unknown>;
  // With no stored modes row, opening clauses are off org-wide (2026-09-15).
  const expected = buildStylePreviewPrompt({
    instructions: null,
    styleOverrides: { ...NO_STYLE_OVERRIDES, openingClauses: true },
  });
  expect(body).toMatchObject({
    model: ROLE_POLICIES.planning.defaultModelId,
    system: expected.system,
    messages: [{ role: "user", content: expected.user }],
  });
  expect(body).not.toHaveProperty("tools");
  const usage = await t.run((ctx) => ctx.db.query("aiUsage").take(5));
  expect(usage).toHaveLength(1);
  expect(usage[0]).toMatchObject({ callSite: "settings:style_preview", inputTokens: 40, outputTokens: 12 });
  const stored = await t.run((ctx) => ctx.db.query("writerStylePreviews").take(5));
  expect(stored).toHaveLength(1);
});
