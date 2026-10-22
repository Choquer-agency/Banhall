/// <reference types="vite/client" />
/**
 * The track readiness check at the real HTTP boundary (2026-10-22
 * decision: models follow the newest version of their tier). Only `fetch`
 * is stubbed: the Anthropic SDK (models API and messages), the OpenRouter
 * transport, the instrumented clients, usage recording and the catalog
 * mutations are the production ones.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "../schema";
import fixture from "../../shared/__fixtures__/openrouter-models-2026-10-22.json";
import { parseOpenRouterModels } from "../../shared/modelCatalog";
import { resetRegisteredModelEntries } from "../../shared/generationModels";
import { applyCatalogRefreshRef, upgradeTracksRef } from "../lib/modelCatalogRefs";
import { AUTO_SWITCH_KEY } from "../lib/modelRoles";
import { resetGenerationModelCache } from "./providers";
import { guardProviderNetwork } from "../../tests/providerNetworkGuard";

beforeAll(async () => {
  await import("../providerCredit");
  await import("../modelCatalog");
});

guardProviderNetwork();

// Vite keys this directory's own files as "./x.ts"; convex-test resolves
// function names from the convex root, so map them back under "../ai/".
const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, load]) => [
    path.startsWith("./") ? `../ai/${path.slice(2)}` : path,
    load,
  ])
);

const NOW = Date.parse("2026-10-22T12:00:00Z");
type Raw = Record<string, unknown> & { id: string; canonical_slug: string; name: string };
const rawRows = (fixture as { data: Raw[] }).data;

/** A listing OpenRouter does not have yet, copied from a real row. */
function futureListing(fromId: string, id: string, slug: string, name: string): Raw {
  const base = rawRows.find((row) => row.id === fromId);
  if (!base) throw new Error(`missing ${fromId}`);
  return { ...base, id, canonical_slug: slug, name, created: 1792000000 };
}

const OPUS_6 = futureListing("anthropic/claude-opus-5.5", "anthropic/claude-opus-6", "anthropic/claude-opus-6-20261101", "Anthropic: Claude Opus 6");
const SOL_62 = futureListing("openai/gpt-6.1-sol", "openai/gpt-6.2-sol", "openai/gpt-6.2-sol-20261101", "OpenAI: GPT-6.2 Sol");

type Captured = { url: string; method: string; body: Record<string, unknown> | null };
let captured: Captured[];
let anthropicModels: string[];
let messagesReply: (body: Record<string, unknown>) => Response;
let openRouterReply: (body: Record<string, unknown>) => Response;

const anthropicText = () =>
  Response.json({
    id: "msg_ready",
    type: "message",
    role: "assistant",
    model: "claude-opus-6",
    content: [{ type: "text", text: "ready" }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 12, output_tokens: 3 },
  });

const anthropicError = (status: number, message: string) =>
  new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message } }), {
    status,
    headers: { "content-type": "application/json" },
  });

const openRouterText = () =>
  Response.json({
    choices: [{ message: { content: "ready" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 12, completion_tokens: 3, cost: 0.0001 },
  });

const openRouterTool = () =>
  Response.json({
    choices: [
      {
        message: {
          content: null,
          tool_calls: [{ id: "call-1", function: { name: "report_ready", arguments: JSON.stringify({ ready: true }) } }],
        },
        finish_reason: "tool_calls",
      },
    ],
    usage: { prompt_tokens: 20, completion_tokens: 5, cost: 0.0001 },
  });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-direct-anthropic-key");
  vi.stubEnv("OPENROUTER_API_KEY", "synthetic-openrouter-key");
  resetRegisteredModelEntries();
  resetGenerationModelCache();
  captured = [];
  anthropicModels = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-opus-6"];
  // Opus 6, like Opus 5.5, refuses a forced tool call with a 400.
  messagesReply = (body) =>
    (body.tool_choice as { type?: string } | undefined)?.type === "tool"
      ? anthropicError(400, "tool_choice: type \"tool\" and \"any\" are not supported for this model.")
      : anthropicText();
  openRouterReply = (body) => (body.tool_choice ? openRouterTool() : openRouterText());
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const text = request.method === "GET" ? "" : await request.text();
      const body = text ? (JSON.parse(text) as Record<string, unknown>) : null;
      captured.push({ url: request.url, method: request.method, body });
      if (request.url.startsWith("https://api.anthropic.com/v1/models")) {
        return Response.json({
          data: anthropicModels.map((id) => ({ id, type: "model", display_name: id, created_at: "2026-10-01T00:00:00Z" })),
          has_more: false,
          first_id: anthropicModels[0] ?? null,
          last_id: anthropicModels.at(-1) ?? null,
        });
      }
      if (request.url === "https://api.anthropic.com/v1/messages") return messagesReply(body ?? {});
      if (request.url === "https://openrouter.ai/api/v1/chat/completions") return openRouterReply(body ?? {});
      throw new Error(`Unexpected request to ${request.url}`);
    })
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetRegisteredModelEntries();
});

async function setup(extra: Raw[] = [OPUS_6, SOL_62]) {
  const t = convexTest(schema, modules);
  await t.mutation(applyCatalogRefreshRef, {
    models: parseOpenRouterModels({ data: [...extra, ...rawRows] }, NOW).models,
    fetchedAt: NOW,
    complete: true,
  });
  return t;
}

const tracks = (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => await ctx.db.query("modelTracks").collect());
const trackOf = async (t: ReturnType<typeof convexTest>, track: string) =>
  (await tracks(t)).find((row) => row.track === track);

describe("upgradeTracks", () => {
  it("moves Claude Opus and GPT Sol to their newer versions after the readiness check", async () => {
    const t = await setup();
    const outcomes = await t.action(upgradeTracksRef, {});
    expect(outcomes).toEqual(
      expect.arrayContaining([
        { track: "claude-opus", outcome: "moved" },
        { track: "gpt-sol", outcome: "moved" },
      ])
    );
    expect(outcomes).toHaveLength(2);

    // The Claude track confirmed the direct id with Anthropic's models API,
    // then sent a plain request with adaptive thinking and a forced one.
    const models = captured.filter((item) => item.url.startsWith("https://api.anthropic.com/v1/models"));
    expect(models).toHaveLength(1);
    expect(models[0].method).toBe("GET");
    const direct = captured.filter((item) => item.url === "https://api.anthropic.com/v1/messages");
    expect(direct.map((item) => item.body?.model)).toEqual(["claude-opus-6", "claude-opus-6"]);
    expect(direct[0].body?.thinking).toEqual({ type: "adaptive" });
    expect(direct[1].body?.tool_choice).toEqual({ type: "tool", name: "report_ready" });
    // GPT Sol went through OpenRouter only.
    const openRouter = captured.filter((item) => item.url === "https://openrouter.ai/api/v1/chat/completions");
    expect(openRouter.map((item) => item.body?.model)).toEqual(["openai/gpt-6.2-sol", "openai/gpt-6.2-sol"]);

    const opus = await trackOf(t, "claude-opus");
    expect(opus).toMatchObject({ modelId: "claude-opus-6", previousModelId: "claude-opus-5-5", rolledBackFrom: [] });
    expect((await trackOf(t, "gpt-sol"))).toMatchObject({ modelId: "openai/gpt-6.2-sol", previousModelId: "openai/gpt-6.1-sol" });
    // The other five stay where they are, checked.
    const sonnet = await trackOf(t, "claude-sonnet");
    expect(sonnet).toMatchObject({ modelId: "claude-sonnet-5-5" });
    expect(sonnet?.lastCheckedAt).toBe(NOW);

    await t.run(async (ctx) => {
      const row = await ctx.db.query("modelCatalog").withIndex("by_modelId", (q) => q.eq("modelId", "claude-opus-6")).first();
      // A direct Anthropic row, priced and limited from its listing, that
      // runs on the unforced tool path.
      expect(row).toMatchObject({
        gateway: "anthropic",
        status: "enabled",
        displayName: "Opus 6",
        canonicalSlug: "anthropic/claude-opus-6-20261101",
        inputUsdPerMTok: 4,
        outputUsdPerMTok: 20,
        maxCompletionTokens: 128_000,
        forcedToolChoice: false,
        reasoning: false,
      });
      const sol = await ctx.db.query("modelCatalog").withIndex("by_modelId", (q) => q.eq("modelId", "openai/gpt-6.2-sol")).first();
      expect(sol?.status).toBe("enabled");
      expect(sol?.forcedToolChoice).toBeUndefined();
      const events = await ctx.db.query("modelSwitchEvents").collect();
      expect(events.map((event) => [event.track, event.kind, event.actor, event.fromModelId, event.toModelId]).sort()).toEqual([
        ["claude-opus", "upgrade", "system", "claude-opus-5-5", "claude-opus-6"],
        ["gpt-sol", "upgrade", "system", "openai/gpt-6.1-sol", "openai/gpt-6.2-sol"],
      ]);
      expect(await ctx.db.query("errorReports").collect()).toEqual([]);
    });
  });

  it("never moves a Claude track whose direct id Anthropic does not list yet", async () => {
    anthropicModels = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];
    const t = await setup([OPUS_6]);
    expect(await t.action(upgradeTracksRef, {})).toEqual([{ track: "claude-opus", outcome: "held" }]);
    expect(captured.some((item) => item.url === "https://api.anthropic.com/v1/messages")).toBe(false);
    // Nor through OpenRouter: a Claude track never changes gateway.
    expect(captured.some((item) => item.url.startsWith("https://openrouter.ai"))).toBe(false);
    const opus = await trackOf(t, "claude-opus");
    expect(opus).toMatchObject({ modelId: "claude-opus-5-5" });
    expect(opus?.previousModelId).toBeUndefined();
    expect(opus?.lastCheckNote).toContain("claude-opus-6 is not on Anthropic's API yet");
    await t.run(async (ctx) => {
      expect(await ctx.db.query("modelSwitchEvents").collect()).toEqual([]);
      expect(await ctx.db.query("modelCatalog").withIndex("by_modelId", (q) => q.eq("modelId", "claude-opus-6")).first()).toBeNull();
    });
  });

  it("holds a track when its plain request fails, and checks it again the next day", async () => {
    openRouterReply = () => new Response(JSON.stringify({ error: { message: "Rate limited" } }), { status: 429 });
    const t = await setup([SOL_62]);
    expect(await t.action(upgradeTracksRef, {})).toEqual([{ track: "gpt-sol", outcome: "held" }]);
    const sol = await trackOf(t, "gpt-sol");
    expect(sol).toMatchObject({ modelId: "openai/gpt-6.1-sol" });
    expect(sol?.lastCheckNote).toContain("GPT-6.2 Sol is not ready yet");
    await t.run(async (ctx) => {
      expect(await ctx.db.query("errorReports").collect()).toEqual([]);
    });
  });

  it("records a model that accepts a forced tool call as one", async () => {
    messagesReply = (body) =>
      (body.tool_choice as { type?: string } | undefined)?.type === "tool"
        ? Response.json({
            id: "msg_tool",
            type: "message",
            role: "assistant",
            model: "claude-opus-6",
            content: [{ type: "tool_use", id: "toolu_1", name: "report_ready", input: { ready: true } }],
            stop_reason: "tool_use",
            stop_sequence: null,
            usage: { input_tokens: 20, output_tokens: 5 },
          })
        : anthropicText();
    const t = await setup([OPUS_6]);
    expect(await t.action(upgradeTracksRef, {})).toEqual([{ track: "claude-opus", outcome: "moved" }]);
    await t.run(async (ctx) => {
      const row = await ctx.db.query("modelCatalog").withIndex("by_modelId", (q) => q.eq("modelId", "claude-opus-6")).first();
      expect(row?.forcedToolChoice).toBeUndefined();
    });
  });

  it("sends nothing while automatic updates are off", async () => {
    const t = await setup();
    await t.run(async (ctx) => {
      const adminId = await ctx.db.insert("users", { email: "admin@example.test", role: "admin" } as never);
      await ctx.db.insert("appSettings", { key: AUTO_SWITCH_KEY, value: "off", updatedBy: adminId, updatedAt: NOW });
    });
    expect(await t.action(upgradeTracksRef, {})).toEqual([]);
    expect(captured).toEqual([]);
    expect((await trackOf(t, "claude-opus"))?.lastCheckNote).toContain("Automatic updates are off");
  });
});
