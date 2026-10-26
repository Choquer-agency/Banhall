/// <reference types="vite/client" />
/**
 * 2026-10-26 (Phase B4): one file's labels through the real request path.
 * The model catalog, clientForRole, the Anthropic SDK and the save stay
 * real; only `fetch` is replaced (AGENTS: prove the SDK boundary through
 * the real request and response).
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
import { insertDocumentWithText } from "../lib/documentText";
import { FILE_LABELS_PROMPT_VERSION, LABEL_RETRY_DELAYS_MS } from "../lib/fileLabels";

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

const NOW = Date.parse("2026-10-26T12:00:00Z");
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const TEXT = [
  "Acme Seals cold soak report, fiscal 2025.",
  "Priya Raman ran trial 3: the fluoropolymer seal held at 4.2 bar for 400 cycles.",
].join("\n\n");

type Seen = { url: string; body: Record<string, unknown> };
let seen: Seen[];
let answer: (body: Record<string, unknown>) => Response;

const toolAnswer = (input: unknown) =>
  Response.json(
    {
      id: "msg_labels",
      type: "message",
      role: "assistant",
      model: "claude-haiku-5-5",
      content: [{ type: "tool_use", id: "toolu_1", name: "submit_file_labels", input }],
      stop_reason: "tool_use",
      stop_sequence: null,
      usage: { input_tokens: 400, output_tokens: 60 },
    },
    { headers: { "request-id": "req_labels" } }
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

async function setup() {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  await t.mutation(applyCatalogRefreshRef, { models: parseOpenRouterModels(fixture, NOW).models, fetchedAt: NOW, complete: false });
  const documentId = await t.run(async (ctx) => {
    const writerId = await ctx.db.insert("users", { authId: "labels-writer", role: "writer" });
    const projectId = await ctx.db.insert("projects", {
      title: "Cold seal",
      clientName: "Acme Seals",
      interviewees: ["Priya Raman"],
      status: "draft",
      createdBy: writerId,
      ownerId: writerId,
      shareToken: "labels-token",
      createdAt: NOW,
      updatedAt: NOW,
    });
    const id = await insertDocumentWithText(
      ctx,
      { projectId, fileName: "Acme Seals cold soak.txt", fileType: "txt", category: "background", source: "chat_upload", uploadedBy: "writer", createdAt: NOW },
      TEXT
    );
    await ctx.db.patch(id, { labelsDue: true });
    return id;
  });
  return { t, documentId };
}

const tokenIn = (text: string, kind: "CLIENT" | "PERSON") => text.match(new RegExp(`\\[${kind}_\\d+\\]`))?.[0] ?? null;

describe("a file's labels (2026-10-26)", () => {
  it("sends the masked file with thinking off and a forced tool, and saves the labels with real names", async () => {
    answer = (body) => {
      const content = JSON.stringify(body.messages);
      return toolAnswer({
        documentType: "test or lab results",
        fiscalYear: 2025,
        title: `Cold soak report for ${tokenIn(content, "CLIENT")}`,
        summary: `${tokenIn(content, "PERSON")} ran trial 3, where the seal held at 4.2 bar. [PERSON_99] signed off.`,
      });
    };
    const { t, documentId } = await setup();
    await t.action(internal.ai.fileLabels.labelFile, { documentId });

    expect(seen).toHaveLength(1);
    const [request] = seen;
    expect(request!.url).toBe(ANTHROPIC_URL);
    expect(request!.body).toMatchObject({
      thinking: { type: "disabled" },
      tool_choice: { type: "tool", name: "submit_file_labels" },
      max_tokens: 1024,
    });
    const sent = JSON.stringify(request!.body);
    expect(sent).not.toContain("Acme Seals");
    expect(sent).not.toContain("Priya Raman");
    expect(tokenIn(sent, "CLIENT")).not.toBeNull();

    const doc = await t.run(async (ctx) => ctx.db.get(documentId as Id<"projectDocuments">));
    expect(doc?.labels).toMatchObject({
      documentType: "test or lab results",
      fiscalYear: 2025,
      title: "Cold soak report for Acme Seals",
      summary: "Priya Raman ran trial 3, where the seal held at 4.2 bar. signed off.",
      promptVersion: FILE_LABELS_PROMPT_VERSION,
      fileName: "Acme Seals cold soak.txt",
    });
    expect(doc?.labelsDue).toBeUndefined();
    // The usage row is written by a scheduled mutation.
    await vi.waitFor(async () => {
      const usage = await t.run(async (ctx) => ctx.db.query("aiUsage").collect());
      expect(usage.map((row) => row.callSite)).toEqual(["file_labels"]);
    });
  });

  it("a summary longer than asked is clipped after names are put back, not refused", async () => {
    answer = () =>
      toolAnswer({ documentType: "technical report", fiscalYear: null, title: "Seal log", summary: `${"The seal held. ".repeat(60)}` });
    const { t, documentId } = await setup();
    await t.action(internal.ai.fileLabels.labelFile, { documentId });
    const doc = await t.run(async (ctx) => ctx.db.get(documentId));
    expect(doc?.labels?.summary.length).toBeLessThanOrEqual(300);
    expect(doc?.labels?.summary.endsWith("…")).toBe(true);
  });

  it("reads an odd kind as other, a year written as text, and drops extra fields", async () => {
    answer = () => toolAnswer({ documentType: "novel", fiscalYear: "2025", title: "Seal log", summary: "The seal held.", notes: "x" });
    const { t, documentId } = await setup();
    await t.action(internal.ai.fileLabels.labelFile, { documentId });
    expect((await t.run(async (ctx) => ctx.db.get(documentId)))?.labels).toMatchObject({ documentType: "other", fiscalYear: 2025 });
  });

  it("an answer that breaks its schema is tried again later, and left after four tries", async () => {
    answer = () => toolAnswer({ documentType: "technical report", fiscalYear: 2025, title: "", summary: "y" });
    const { t, documentId } = await setup();
    await t.action(internal.ai.fileLabels.labelFile, { documentId });
    let doc = await t.run(async (ctx) => ctx.db.get(documentId));
    expect(doc).toMatchObject({ labelsDue: true, labelsAttempts: 1, labelsNextAt: NOW + LABEL_RETRY_DELAYS_MS[0] });
    expect(doc?.labelsLastError).toMatch(/schema \(title:too_small\)/);
    expect(doc?.labels).toBeUndefined();
    for (let i = 0; i < 3; i++) await t.action(internal.ai.fileLabels.labelFile, { documentId });
    doc = await t.run(async (ctx) => ctx.db.get(documentId));
    expect(doc).toMatchObject({ labelsAttempts: 4 });
    expect(doc?.labelsDue).toBeUndefined();
  });
});
