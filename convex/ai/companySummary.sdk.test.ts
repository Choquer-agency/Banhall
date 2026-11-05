/// <reference types="vite/client" />
/**
 * 2026-11-04 (the company profile): the AI company summary through the real
 * request path. The model catalog, clientForRole, the Anthropic SDK and the
 * save stay real; only `fetch` is replaced (AGENTS: prove the SDK boundary
 * through the real request and response).
 */
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "../schema";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import fixture from "../../shared/__fixtures__/openrouter-models-2026-09-24.json";
import { parseOpenRouterModels } from "../../shared/modelCatalog";
import { resetRegisteredModelEntries } from "../../shared/generationModels";
import { applyCatalogRefreshRef } from "../lib/modelCatalogRefs";
import { resetGenerationModelCache } from "./providers";
import { guardProviderNetwork } from "../../tests/providerNetworkGuard";

beforeAll(async () => {
  await import("../providerCredit");
});

guardProviderNetwork();

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, load]) => [
    path.startsWith("./") ? `../ai/${path.slice(2)}` : path,
    load,
  ]),
);

const NOW = Date.parse("2026-11-04T12:00:00Z");
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const URL_ = "https://cedarline.ca";
const TEXT = "Cedarline Systems builds controls for commercial refrigeration. Priya Raman leads our compressor team.";

type Seen = { url: string; body: Record<string, unknown> };
let seen: Seen[];
let answer: (body: Record<string, unknown>) => Response;

const toolAnswer = (input: unknown) =>
  Response.json(
    {
      id: "msg_summary",
      type: "message",
      role: "assistant",
      model: "claude-haiku-5-5",
      content: [{ type: "tool_use", id: "toolu_1", name: "submit_company_summary", input }],
      stop_reason: "tool_use",
      stop_sequence: null,
      usage: { input_tokens: 300, output_tokens: 40 },
    },
    { headers: { "request-id": "req_summary" } }
  );

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-anthropic-key");
  vi.stubEnv("OPENROUTER_API_KEY", "synthetic-openrouter-key");
  resetRegisteredModelEntries();
  resetGenerationModelCache();
  seen = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const body = (await request.json()) as Record<string, unknown>;
      seen.push({ url: request.url, body });
      return answer(body);
    })
  );
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetRegisteredModelEntries();
});

async function setup(summary?: { text: string; editedBy?: "writer" }) {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  await t.mutation(applyCatalogRefreshRef, { models: parseOpenRouterModels(fixture, NOW).models, fetchedAt: NOW, complete: false });
  const ids = await t.run(async (ctx) => {
    const { companyFileTextFacts, insertCompanyFileTextPieces } = await import("../lib/companyFileText");
    const writerId = await ctx.db.insert("users", { authId: "summary-writer", role: "writer" });
    const clientId = await ctx.db.insert("clients", {
      name: "Cedarline Systems",
      nameKey: "cedarline systems",
      status: "active",
      website: URL_,
      websiteRead: { url: URL_, status: "read", requestedAt: NOW - 1_000, finishedAt: NOW },
      createdBy: writerId,
      createdAt: NOW,
      updatedAt: NOW,
      ...(summary ? { summary: { text: summary.text, ...(summary.editedBy ? { editedBy: writerId, editedAt: NOW } : {}) } } : {}),
    });
    await ctx.db.insert("projects", {
      title: "Cold seal",
      clientName: "Cedarline Systems",
      clientId,
      interviewees: ["Priya Raman"],
      status: "draft",
      createdBy: writerId,
      ownerId: writerId,
      shareToken: "summary-token",
      createdAt: NOW,
      updatedAt: NOW,
    });
    const companyFileId = await ctx.db.insert("companyFiles", {
      clientId,
      fileName: "Website: cedarline.ca",
      fileType: "txt",
      category: "background",
      ...(await companyFileTextFacts(TEXT)),
      processingStatus: "ready",
      uploadedBy: writerId,
      createdAt: NOW,
    });
    await insertCompanyFileTextPieces(ctx, companyFileId, TEXT);
    await ctx.db.patch(clientId, { websiteFileId: companyFileId });
    return { writerId, clientId, companyFileId };
  });
  const args = { clientId: ids.clientId, companyFileId: ids.companyFileId, url: URL_, requestedAt: NOW - 1_000, userId: ids.writerId };
  return { t, ...ids, args };
}

const tokenIn = (text: string, kind: "CLIENT" | "PERSON") => text.match(new RegExp(`\\[${kind}_\\d+\\]`))?.[0] ?? null;
const clientRow = (t: Awaited<ReturnType<typeof setup>>["t"], id: Id<"clients">) => t.run(async (ctx) => ctx.db.get(id));

describe("the AI company summary (2026-11-04)", () => {
  it("sends the website text with the names hidden, thinking off and a forced tool, and saves it with real names", async () => {
    answer = (body) => {
      const content = JSON.stringify(body.messages);
      return toolAnswer({ summary: `${tokenIn(content, "CLIENT")} builds controls for commercial refrigeration. [PERSON_99] says hi.` });
    };
    const { t, clientId, args } = await setup();
    await t.action(internal.ai.companySummary.draftCompanySummary, args);

    expect(seen).toHaveLength(1);
    const [request] = seen;
    expect(request!.url).toBe(ANTHROPIC_URL);
    expect(request!.body).toMatchObject({
      thinking: { type: "disabled" },
      tool_choice: { type: "tool", name: "submit_company_summary" },
      max_tokens: 1024,
    });
    // The model the file labels role uses (the Haiku tier), not a fixed ID.
    expect(String(request!.body.model)).toContain("haiku");
    const sent = JSON.stringify(request!.body);
    expect(sent).not.toContain("Cedarline Systems");
    expect(sent).not.toContain("Priya Raman");
    // No web search tool.
    expect((request!.body.tools as Array<{ name: string }>).map((tool) => tool.name)).toEqual(["submit_company_summary"]);

    const row = await clientRow(t, clientId);
    expect(row?.summary).toMatchObject({
      text: "Cedarline Systems builds controls for commercial refrigeration. says hi.",
      aiDraftedFrom: URL_,
      aiDraftedAt: NOW,
    });
    expect(row?.summary?.editedBy).toBeUndefined();
    // Counted in AI usage as its own feature.
    await vi.waitFor(async () => {
      const usage = await t.run(async (ctx) => ctx.db.query("aiUsage").collect());
      expect(usage.map((entry) => entry.callSite)).toEqual(["company_summary"]);
    });
  });

  it("never calls the model when a person wrote the summary, and leaves their text", async () => {
    answer = () => toolAnswer({ summary: "AI words." });
    const { t, clientId, args } = await setup({ text: "Our own words.", editedBy: "writer" });
    await t.action(internal.ai.companySummary.draftCompanySummary, args);
    expect(seen).toHaveLength(0);
    expect((await clientRow(t, clientId))?.summary?.text).toBe("Our own words.");
  });

  it("a failed call (a provider error) leaves the summary empty", async () => {
    answer = () =>
      Response.json({ type: "error", error: { type: "api_error", message: "Internal server error" } }, { status: 500 });
    const { t, clientId, args } = await setup();
    await t.action(internal.ai.companySummary.draftCompanySummary, args);
    expect(seen.length).toBeGreaterThanOrEqual(1);
    expect((await clientRow(t, clientId))?.summary).toBeUndefined();
  });

  it("a refused or unreadable answer leaves the summary as it was", async () => {
    answer = () =>
      Response.json(
        {
          id: "msg_summary",
          type: "message",
          role: "assistant",
          model: "claude-haiku-5-5",
          content: [],
          stop_reason: "refusal",
          stop_sequence: null,
          usage: { input_tokens: 300, output_tokens: 0 },
        },
        { headers: { "request-id": "req_summary" } }
      );
    const { t, clientId, args } = await setup({ text: "An earlier AI draft." });
    await t.action(internal.ai.companySummary.draftCompanySummary, args);
    expect((await clientRow(t, clientId))?.summary?.text).toBe("An earlier AI draft.");
    answer = () => toolAnswer({ summary: "" });
    await t.action(internal.ai.companySummary.draftCompanySummary, args);
    expect((await clientRow(t, clientId))?.summary?.text).toBe("An earlier AI draft.");
  });
});
