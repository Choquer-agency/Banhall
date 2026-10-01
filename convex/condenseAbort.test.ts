/// <reference types="vite/client" />
/**
 * Audit 2026-09-25 a3 P2-2: a condense call past CONDENSE_TIMEOUT_MS used to
 * be raced and left running, so the provider kept working and billing after
 * the generation had given up. The time limit now aborts the request. Only
 * `fetch` is stubbed in the transport test: the Anthropic SDK, the client
 * routing and the condense unit are the production ones.
 */
import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import schema from "./schema";
import type { ActionCtx } from "./_generated/server";
import {
  CondenseBudgetError,
  condenserFor,
  ensureCondensedInputs,
  type CondenseCtx,
} from "./ai/condense";
import { CONDENSE_TIMEOUT_MS } from "./ai/condenseAgent";
import { sha256 } from "./lib/contracts";

const modules = import.meta.glob("./**/*.ts");
type TestConvex = ReturnType<typeof convexTest<typeof schema.tables>>;

/** Runs `body` inside a real Convex test action. */
function inAction<R>(t: TestConvex, body: (ctx: ActionCtx) => Promise<R>): Promise<R> {
  return t.action(body);
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function generation(t: TestConvex) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { authId: "condense-writer", role: "writer" });
    const projectId = await ctx.db.insert("projects", {
      title: "Condense",
      clientName: "Client",
      status: "generating",
      createdBy: userId,
      shareToken: "condense-token",
      createdAt: 1,
      updatedAt: 1,
    });
    const content = "Interviewer: What was hard?\n\nClient: The seal failed at 4.2 bar.";
    const transcriptId = await ctx.db.insert("transcripts", { projectId, content, createdAt: 1 });
    const generationId = await ctx.db.insert("generations", {
      projectId,
      transcriptId,
      transcriptIds: [transcriptId],
      inputMode: "digest",
      status: "running",
      startedAt: 1,
    });
    await ctx.db.insert("generationSources", {
      generationId,
      projectId,
      kind: "transcript",
      transcriptId,
      label: "Interview",
      content,
      contentHash: await sha256(content),
      truncated: false,
      originalLength: content.length,
      capturedAt: 1,
    });
    return { projectId, generationId };
  });
}

it("aborts a condense call that runs past its time limit", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const t = convexTest(schema, modules);
  const { generationId } = await generation(t);
  let signal: AbortSignal | undefined;
  let called!: () => void;
  const started = new Promise<void>((resolve) => (called = resolve));
  const outcome = ensureCondensedInputs(
    { runQuery: t.query, runMutation: t.mutation } as unknown as CondenseCtx,
    { generationId, elapsedMs: 0 },
    async () => {},
    async (_args, callSignal) => {
      signal = callSignal;
      called();
      return await new Promise<never>(() => {});
    }
  ).then(
    () => "resolved",
    (error: unknown) => error
  );
  await started;
  expect(signal?.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(CONDENSE_TIMEOUT_MS);
  expect(await outcome).toBeInstanceOf(CondenseBudgetError);
  expect(signal?.aborted).toBe(true);
});

it("the abort reaches the provider request through the real SDK", async () => {
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-condense-key");
  let requestSignal: AbortSignal | null | undefined;
  let sent!: () => void;
  const requested = new Promise<void>((resolve) => (sent = resolve));
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>((input, init) => {
      expect(String(input)).toContain("anthropic.com");
      requestSignal = init?.signal;
      sent();
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("The operation was aborted.", "AbortError")));
      });
    })
  );
  const t = convexTest(schema, modules);
  const { projectId, generationId } = await generation(t);
  const result = await inAction(t, async (ctx) => {
    const condense = condenserFor(ctx, { generationId, projectId, modelId: "claude-sonnet-5" });
    const controller = new AbortController();
    const call = condense(
      { text: "Client: The seal failed.", label: "Interview", part: 1, totalParts: 1 },
      controller.signal
    ).then(
      () => "resolved",
      () => "rejected"
    );
    await requested;
    controller.abort(new CondenseBudgetError());
    return await call;
  });
  expect(result).toBe("rejected");
  expect(requestSignal?.aborted).toBe(true);
});
