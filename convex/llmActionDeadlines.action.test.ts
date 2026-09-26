/// <reference types="vite/client" />
/**
 * Audit 2026-09-25 (a3 P2-4, a4 #19): LLM actions outside generation had no
 * action deadline, so a slow answer plus its repair or retry could run past
 * Convex's 600 s action limit and leave rows "running" until a reaper found
 * them. Each such action now records its deadline when it starts, and the
 * research requests are capped to fit it. Only `fetch` is stubbed: the
 * Anthropic SDK, the OpenRouter transport and the actions are the real ones.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { ACTION_TIME_BUDGET_MESSAGE } from "./ai/actionDeadline";
import { RESEARCH_TIMEOUT_MS } from "./ai/research/openrouter";
import { chatStreamTimeoutMs } from "./ai/chatAgentV2";

const modules = import.meta.glob("./**/*.ts");
const START = Date.parse("2026-09-25T12:00:00Z");

beforeEach(() => {
  vi.useFakeTimers({ now: START, toFake: ["Date"] });
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-deadline-key");
  vi.stubEnv("OPENROUTER_API_KEY", "synthetic-deadline-openrouter");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

async function project(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { authId: "deadline-writer", role: "writer" });
    const projectId = await ctx.db.insert("projects", {
      title: "Deadline",
      clientName: "Client",
      status: "review",
      ownerId: userId,
      createdBy: userId,
      shareToken: "deadline-token",
      createdAt: 1,
      updatedAt: 1,
    });
    return { userId, projectId };
  });
}

it("a PD review whose answer comes back cut off late fails on time instead of sending a repair past the limit", async () => {
  const t = convexTest(schema, modules);
  const { userId, projectId } = await project(t);
  const reviewId = await t.run(async (ctx) => {
    const documentId = await ctx.db.insert("projectDocuments", {
      projectId,
      fileName: "PD.docx",
      fileType: "docx",
      content: "Line 242. The team could not predict how the seal fails at 4.2 bar.",
      source: "review_pd",
      uploadedBy: "Writer",
      uploaderRole: "writer",
      createdAt: 1,
    });
    return await ctx.db.insert("pdReviews", {
      projectId,
      documentId,
      sourceFileName: "PD.docx",
      status: "running",
      createdBy: userId,
      createdAt: 1,
    });
  });
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    expect(String(input)).toContain("anthropic.com");
    // A long review, cut off at its output limit, 530 s into the action.
    vi.setSystemTime(Date.now() + 530_000);
    return json({
      id: "msg-review",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-5",
      content: [{ type: "tool_use", id: "tool-review", name: "submit_pd_review", input: {} }],
      stop_reason: "max_tokens",
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 10 },
    });
  });
  vi.stubGlobal("fetch", fetchMock);

  await t.action(internal.ai.reviewAgent.runPdReview, { reviewId, projectId });

  // The repair would end past the action limit, so it is never sent.
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const review = await t.run((ctx) => ctx.db.get(reviewId));
  expect(review?.status).toBe("failed");
  expect(review?.error).toContain(ACTION_TIME_BUDGET_MESSAGE);
});

async function researchSession(t: ReturnType<typeof convexTest>) {
  const { userId, projectId } = await project(t);
  return await t.run(async (ctx) => {
    const reportId = await ctx.db.insert("reports", {
      projectId,
      content: JSON.stringify({ type: "doc", content: [] }),
      version: 1,
      generatedAt: 1,
      updatedAt: 1,
    });
    return await ctx.db.insert("researchSessions", {
      projectId,
      reportId,
      requestedBy: userId,
      selectedText: "Selected passage",
      selectionFrom: 1,
      selectionTo: 10,
      surroundingContext: "Context",
      instruction: "Verify this",
      externalBrief: "Brief",
      reportRevisionNumber: 0,
      status: "researching",
      createdAt: 1,
      updatedAt: 1,
    });
  });
}

it("research asks for at most 270 s per attempt and drops a retry that would not fit the action", async () => {
  const t = convexTest(schema, modules);
  const sessionId = await researchSession(t);
  const timeouts: number[] = [];
  const realTimeout = AbortSignal.timeout.bind(AbortSignal);
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
    timeouts.push(ms);
    return realTimeout(ms);
  });
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    expect(String(input)).toContain("openrouter.ai");
    // The network drops 530 s into the action: too late for a retry.
    vi.setSystemTime(Date.now() + 530_000);
    throw new TypeError("fetch failed");
  });
  vi.stubGlobal("fetch", fetchMock);

  await t.action(internal.ai.research.actions.runExternalResearch, {
    sessionId,
    provider: "gpt",
  });

  expect(RESEARCH_TIMEOUT_MS).toBe(270_000);
  expect(timeouts[0]).toBe(270_000);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const runs = await t.run((ctx) =>
    ctx.db
      .query("researchRuns")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
      .take(5)
  );
  expect(runs).toMatchObject([{ provider: "gpt", status: "failed" }]);
});

it("the chat stream is given what is left of the action's request window", () => {
  expect(chatStreamTimeoutMs(START, START)).toBe(540_000);
  expect(chatStreamTimeoutMs(START, START + 40_000)).toBe(500_000);
  expect(chatStreamTimeoutMs(START, START + 600_000)).toBe(1);
});
