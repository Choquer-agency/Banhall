/// <reference types="vite/client" />
/**
 * 2026-09-27 (second): the head start waits for files still being read and
 * stops out-of-date readings.
 *
 * Waiting: a draft's start waits while the New project page reports files
 * still being read (or read and not saved), runs 2 seconds after the count
 * reaches zero, stops counting a count not refreshed for 90 seconds, and
 * waits at most 3 minutes from its first wait, on its own counter.
 *
 * Stopping: a preparation made out of date while its call streams is
 * stopped within about 2 seconds, through the real Anthropic SDK with only
 * `fetch` stubbed (a slow stream that ends only when the SDK aborts it),
 * on the direct transport and through the OpenRouter credit fallback. Its
 * slot frees at once, the next preparation dispatches straight away, the
 * usage the stream reported is logged (or the cost is marked unknown), and
 * the stop is not a model failure. A preparation a run waits on is never
 * stopped by later edits.
 */
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { sha256 } from "./lib/contracts";
import { TRANSCRIPT_PARSER_VERSION } from "../shared/transcriptParse";
import { requestBriefPreparation } from "./lib/briefPreparationTrigger";
import { BRIEF_REQUEST } from "./lib/briefRequest";
import { anthropicToolSse, sseResponse } from "./anthropicSse.fixture";
import { deriveOrAdoptSeedBrief } from "./ai/brief";
import { clientForStep, resetGenerationModelCache, resetGenerationPlaceholderCache } from "./ai/providers";
import { resetStaleLatchCheck } from "./ai/anthropicCredit";
import { resolveGenerationStep } from "./lib/generationSteps";
import { preparationCharge } from "./lib/briefPreparationBudget";
import { assignRoleModelByHand } from "./lib/modelRoles";
import { CREDIT_LATCH_COOLDOWN_MS } from "../shared/anthropicCreditFallback";
import { intakeDraftRefs } from "./lib/intakeDraftRefs";
import {
  INTAKE_DEBOUNCE_MS,
  MAX_PENDING_READS_WAIT_MS,
  PENDING_READS_STALE_MS,
} from "./lib/intakeDrafts";

const modules = import.meta.glob("./**/*.ts");
/** Captured before the clock is faked: a real pause for the SDK's stream reads. */
const realSetTimeout = globalThis.setTimeout;
const realPause = (ms = 25) => new Promise<void>((resolve) => realSetTimeout(resolve, ms));

const TRANSCRIPT = [
  "Interviewer: What did you try first?",
  "",
  "Priya Raman: We replaced the silicone gasket with a fluoropolymer seal because the silicone cracked at minus 30 degrees during the cold soak test.",
  "",
  "Interviewer: Did that work?",
  "",
  "Priya Raman: The fluoropolymer seal held for 400 cycles without leaking, which nobody at the plant had managed before.",
].join("\n");
const DOCUMENT = "Cold soak log: fluoropolymer seal, 400 cycles at minus 30 degrees, no leak.";

const PROVIDER_BRIEF = {
  storyline: "The team replaced a cracking silicone gasket with a fluoropolymer seal that held at minus 30 degrees.",
  storylineClaims: [
    {
      text: "The silicone gasket failed in the cold soak test.",
      quote: "the silicone cracked at minus 30 degrees during the cold soak test",
    },
  ],
  claimExclusions: [],
  confidenceMap: [
    {
      text: "The fluoropolymer seal held for 400 cycles.",
      quote: "The fluoropolymer seal held for 400 cycles without leaking",
      confidence: "established",
    },
  ],
  glossaryTerms: [{ term: "fluoropolymer seal" }],
};

/**
 * How the next Brief requests answer, in order: `full` streams the whole
 * answer; `slow` streams the start (usage included) and then holds until
 * the request is aborted, or released by the test; `hang` sends nothing
 * until it is aborted; `billing` refuses for credit (direct only).
 */
type Plan = "full" | "slow" | "hang" | "billing" | "cut" | "overloaded" | "chat";
const plan: Plan[] = [];
type Sent = { url: string; body: Record<string, unknown>; signal: AbortSignal | null; aborted: boolean };
const requests: Sent[] = [];
/** Finishes a held `slow` stream normally. */
const releases: Array<() => void> = [];

function sseEvents(model: string): string[] {
  return anthropicToolSse({
    model,
    tool: BRIEF_REQUEST.toolName,
    input: PROVIDER_BRIEF,
    usage: { input_tokens: 1200, output_tokens: 300 },
  })
    .split("\n\n")
    .filter((event) => event.trim() !== "")
    .map((event) => `${event}\n\n`);
}

function abortError(): DOMException {
  return new DOMException("This operation was aborted", "AbortError");
}

function stubProvider() {
  requests.length = 0;
  releases.length = 0;
  plan.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const body = (await request.json()) as Record<string, unknown>;
      const signal = init?.signal ?? null;
      const sent: Sent = { url: request.url, body, signal, aborted: false };
      requests.push(sent);
      signal?.addEventListener("abort", () => (sent.aborted = true), { once: true });
      const next = plan.shift() ?? "full";
      const model = String(body.model);
      if (next === "chat") {
        // The OpenRouter gateway's chat completion with the Brief as a tool call.
        return Response.json({
          id: "gen_synthetic",
          model,
          choices: [
            {
              index: 0,
              finish_reason: "tool_calls",
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call_1",
                    type: "function",
                    function: { name: BRIEF_REQUEST.toolName, arguments: JSON.stringify(PROVIDER_BRIEF) },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 1200, completion_tokens: 300, cost: 0.01 },
        });
      }
      if (next === "cut") {
        return sseResponse(
          anthropicToolSse({
            model,
            tool: BRIEF_REQUEST.toolName,
            input: PROVIDER_BRIEF,
            usage: { input_tokens: 1200, output_tokens: 16000 },
            stopReason: "max_tokens",
          })
        );
      }
      if (next === "overloaded") {
        // Retryable, with a long wait the SDK would honour.
        return Response.json(
          { type: "error", error: { type: "overloaded_error", message: "Overloaded" } },
          { status: 529, headers: { "retry-after": "20" } }
        );
      }
      if (next === "billing") {
        return Response.json(
          { type: "error", error: { type: "billing_error", message: "There's an issue with your billing." } },
          { status: 402 }
        );
      }
      if (next === "hang") {
        return await new Promise<Response>((_, reject) => {
          if (signal?.aborted) reject(abortError());
          signal?.addEventListener("abort", () => reject(abortError()), { once: true });
        });
      }
      if (next === "full") return sseResponse(sseEvents(model).join(""));
      const events = sseEvents(model);
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          // message_start (with the input usage), the tool block and its
          // first piece; the rest waits.
          for (const event of events.slice(0, 3)) controller.enqueue(encoder.encode(event));
          let open = true;
          const stop = () => {
            if (!open) return;
            open = false;
            controller.error(abortError());
          };
          if (signal?.aborted) stop();
          else signal?.addEventListener("abort", stop, { once: true });
          releases.push(() => {
            if (!open) return;
            open = false;
            for (const event of events.slice(3)) controller.enqueue(encoder.encode(event));
            controller.close();
          });
        },
      });
      return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
    })
  );
}

beforeEach(() => {
  resetStaleLatchCheck();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-27T15:00:00Z"));
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-stop-key");
  resetGenerationModelCache();
  resetGenerationPlaceholderCache();
  stubProvider();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

type T = ReturnType<typeof convexTest<typeof schema.tables>>;

function inAction<R>(t: T, fn: (ctx: ActionCtx) => Promise<R>): Promise<R> {
  const run = t.action as unknown as (handler: (ctx: ActionCtx) => Promise<R>) => Promise<R>;
  return run.call(t, fn);
}

/** Waits (really) until `ready` holds. */
async function until(ready: () => boolean | Promise<boolean>, tries = 200) {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    if (await ready()) return;
    await realPause(10);
  }
  throw new Error("Timed out waiting for the test condition");
}

// ─── Project-scoped setup ───────────────────────────────────────────────────

async function projectSetup(options: { planningModel?: string } = {}) {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { authId: "stop-writer", role: "writer", name: "Wren Writer" });
    if (options.planningModel) {
      const adminId = await ctx.db.insert("users", { authId: "stop-admin", role: "admin", name: "Ada Admin" });
      await assignRoleModelByHand(ctx, "planning", options.planningModel, adminId);
    }
    const projectId = await ctx.db.insert("projects", {
      title: "Cold seal",
      clientName: "Acme Seals",
      status: "draft",
      projectType: "writing",
      ownerId: userId,
      createdBy: userId,
      shareToken: "stop-token",
      createdAt: now,
      updatedAt: now,
    });
    const transcriptId = await ctx.db.insert("transcripts", {
      projectId,
      content: TRANSCRIPT,
      contentHash: await sha256(TRANSCRIPT),
      label: "Interview",
      position: 0,
      parserVersion: TRANSCRIPT_PARSER_VERSION,
      createdAt: now,
    });
    await ctx.db.insert("transcriptSpeakers", {
      transcriptId, projectId, label: "Interviewer", role: "interviewer", roleSource: "consultant", confidence: 1, turnCount: 2,
    });
    await ctx.db.insert("transcriptSpeakers", {
      transcriptId, projectId, label: "Priya Raman", role: "client", roleSource: "heuristic", confidence: 0.95, turnCount: 2,
    });
    await ctx.db.insert("projectDocuments", {
      projectId,
      fileName: "cold-soak.txt",
      fileType: "txt",
      content: DOCUMENT,
      category: "background",
      source: "context_input",
      uploadedBy: userId,
      uploaderRole: "writer",
      createdAt: now,
    });
    return { userId, projectId };
  });
  return { t, ...ids, writer: t.withIdentity({ subject: "stop-writer" }) };
}

type ProjectSetup = Awaited<ReturnType<typeof projectSetup>>;

async function projectPreparations(s: ProjectSetup): Promise<Doc<"briefPreparations">[]> {
  return await s.t.run(async (ctx) =>
    ctx.db.query("briefPreparations").withIndex("by_projectId", (q) => q.eq("projectId", s.projectId)).collect()
  );
}

async function row(s: { t: T }, id: Id<"briefPreparations">) {
  return (await s.t.run(async (ctx) => ctx.db.get(id)))!;
}

/** Queues and claims a preparation; its call is scheduled but has not run. */
async function claim(s: ProjectSetup) {
  await s.t.run(async (ctx) => requestBriefPreparation(ctx, s.projectId, { userId: s.userId, reason: "document_added" }));
  const queued = (await projectPreparations(s)).find((prep) => prep.status === "queued")!;
  await s.t.mutation(internal.briefPreparations.startBriefPreparation, { preparationId: queued._id, revision: queued.revision });
  return await row(s, queued._id);
}

/** Waits until the claimed call started: the stubbed stream is then open. */
async function startCall(count = 1) {
  await until(() => requests.length >= count);
  // The SDK reads what the stream already sent.
  await realPause(50);
}

/** A newer key: another file, and its start makes the running attempt obsolete. */
async function supersede(s: ProjectSetup, fileName = "new.txt") {
  await s.t.run(async (ctx) =>
    ctx.db.insert("projectDocuments", {
      projectId: s.projectId, fileName, fileType: "txt", content: `New cold data from ${fileName}.`,
      source: "context_input", uploadedBy: s.userId, createdAt: Date.now(),
    })
  );
  await s.t.run(async (ctx) => requestBriefPreparation(ctx, s.projectId, { userId: s.userId, reason: "document_added" }));
  const queued = (await projectPreparations(s)).find((prep) => prep.status === "queued")!;
  await s.t.mutation(internal.briefPreparations.startBriefPreparation, { preparationId: queued._id, revision: queued.revision });
  return await row(s, queued._id);
}


/**
 * Waits until no preparation of the project is queued or running, so no
 * follow-up call of this test reaches the next test's stubbed provider.
 */
async function quiet(s: ProjectSetup) {
  await until(async () => (await projectPreparations(s)).every((prep) => prep.status !== "queued" && prep.status !== "running"), 600);
  await s.t.finishInProgressScheduledFunctions();
}

async function usageRows(s: { t: T }) {
  return await s.t.run(async (ctx) => ctx.db.query("aiUsage").collect());
}

async function modelFailures(s: { t: T }) {
  return (await s.t.run(async (ctx) => ctx.db.query("modelCallOutcomes").collect())).filter(
    (outcome) => outcome.outcome !== "success"
  );
}

/**
 * These run on real timers: the attempt's check is a timer inside its
 * action, and the test harness runs an action's own ctx calls only in that
 * action's context, which a fake timer's callback does not carry.
 */
describe("stopping out-of-date readings", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  test("a superseded call is stopped mid-stream within about 2 seconds; the slot frees and the next one dispatches at once", async () => {
    const s = await projectSetup();
    plan.push("slow");
    const first = await claim(s);
    expect(first.status).toBe("running");
    await startCall();
    expect(requests[0].body.stream).toBe(true);
    expect(requests[0].signal).not.toBeNull();

    const second = await supersede(s);
    const madeObsoleteAt = Date.now();
    expect(await row(s, first._id)).toMatchObject({ status: "obsolete", endedReason: "superseded" });
    // The stopped call still held the slot when the second start looked.
    expect(second).toMatchObject({ status: "queued", waitingFor: "slot" });

    await until(async () => (await row(s, first._id)).attemptEndedAt !== undefined, 400);
    const stopped = await row(s, first._id);
    expect(requests[0].aborted).toBe(true);
    expect(stopped.abortedAt).toBeDefined();
    // Within about 2 seconds (one check interval, plus the harness's own time).
    expect(stopped.abortedAt! - madeObsoleteAt).toBeLessThanOrEqual(2_600);
    expect(stopped.attemptEndedAt! - stopped.abortedAt!).toBeLessThan(50);
    // Not a model failure: no failure code, no cooldown, no outcome.
    expect(stopped.status).toBe("obsolete");
    expect(stopped.failureCode).toBeUndefined();
    expect(stopped.costUnknown).toBeUndefined();

    // The next preparation dispatches straight away, not at its next 30-second look.
    await until(async () => (await row(s, second._id)).status !== "queued");
    const next = await row(s, second._id);
    expect(next.dispatchedAt! - stopped.attemptEndedAt!).toBeLessThan(1_000);
    expect(next.key).not.toBe(first.key);
    await until(async () => (await row(s, second._id)).status === "ready", 400);
    expect(requests).toHaveLength(2);

    // Usage recorded honestly: the stopped call's reported input, marked as
    // stopped, and its reservation still counted for the day.
    await until(async () => (await row(s, first._id)).usageCalls === 1);
    const usage = await usageRows(s);
    const partial = usage.find((entry) => entry.preparationAttemptId === first.attemptId);
    expect(partial).toMatchObject({ callSite: "preparation:brief", stopReason: "aborted", inputTokens: 1200, partial: true });
    // The stream had reported 1 output token; the output is estimated from
    // the 24 characters of tool input received (3 a token).
    expect(partial!.outputTokens).toBe(8);
    expect(partial!.costUsd).toBeGreaterThan(0);
    const settled = await row(s, first._id);
    expect(settled.usageCalls).toBe(1);
    expect(preparationCharge(settled)).toBe(settled.reservedUsd);
    expect(await modelFailures(s)).toHaveLength(0);
    await quiet(s);
  });

  test("stopped before the stream reported any usage, the cost is marked unknown and the reservation stays counted", async () => {
    const s = await projectSetup();
    plan.push("hang");
    const first = await claim(s);
    await startCall();
    await supersede(s);
    await until(async () => (await row(s, first._id)).attemptEndedAt !== undefined, 400);
    const stopped = await row(s, first._id);
    expect(requests[0].aborted).toBe(true);
    expect(stopped).toMatchObject({ status: "obsolete", costUnknown: true });
    expect(stopped.failureCode).toBeUndefined();
    await until(async () => (await projectPreparations(s)).some((prep) => prep.status === "ready"), 400);
    expect((await usageRows(s)).filter((entry) => entry.preparationAttemptId === first.attemptId)).toHaveLength(0);
    expect(preparationCharge(await row(s, first._id))).toBe(stopped.reservedUsd);
    expect(stopped.reservedUsd).toBeGreaterThan(0);
    expect(await modelFailures(s)).toHaveLength(0);
    await quiet(s);
  });

  test("a call answered through the OpenRouter credit fallback is stopped the same way", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "synthetic-stop-openrouter");
    const s = await projectSetup();
    plan.push("billing", "slow");
    const first = await claim(s);
    await startCall(2);
    expect(requests[0].url).toContain("api.anthropic.com");
    expect(requests[1].url).toContain("openrouter.ai");
    expect(requests[1].signal).not.toBeNull();

    await supersede(s);
    await until(async () => (await row(s, first._id)).attemptEndedAt !== undefined, 400);
    expect(requests[1].aborted).toBe(true);
    const stopped = await row(s, first._id);
    expect(stopped.failureCode).toBeUndefined();
    await until(async () => (await row(s, first._id)).usageCalls === 1);
    const partial = (await usageRows(s)).find((entry) => entry.preparationAttemptId === first.attemptId);
    expect(partial).toMatchObject({ stopReason: "aborted", transport: "openrouter", inputTokens: 1200 });
    expect(await modelFailures(s)).toHaveLength(0);
    await quiet(s);
  });

  test("stopped during the repair, the first call's usage stays and the cost is not marked unknown (Q2)", async () => {
    const s = await projectSetup();
    plan.push("cut", "hang");
    const first = await claim(s);
    await startCall(2);
    // The first answer was cut off, so the repair (not streamed) is on its way.
    expect(requests[0].body.stream).toBe(true);
    expect(requests[1].body.stream).toBeUndefined();
    await supersede(s);
    await until(async () => (await row(s, first._id)).attemptEndedAt !== undefined, 400);
    expect(requests[1].aborted).toBe(true);
    const stopped = await row(s, first._id);
    expect(stopped.costUnknown).toBeUndefined();
    expect(stopped.failureCode).toBeUndefined();
    await until(async () => (await row(s, first._id)).usageCalls === 1);
    const landed = (await usageRows(s)).filter((entry) => entry.preparationAttemptId === first.attemptId);
    expect(landed).toHaveLength(1);
    expect(landed[0].partial).toBeUndefined();
    expect(preparationCharge(await row(s, first._id))).toBeGreaterThanOrEqual(stopped.reservedUsd!);
    await quiet(s);
  });

  test("a call waiting out a provider's retry wait is stopped at once, and the retry is never sent (P3-4)", async () => {
    const s = await projectSetup();
    plan.push("overloaded");
    const first = await claim(s);
    await startCall();
    const madeObsoleteAt = Date.now();
    await supersede(s);
    await until(async () => (await row(s, first._id)).attemptEndedAt !== undefined, 400);
    const stopped = await row(s, first._id);
    // Within one check, far inside the 20-second wait.
    expect(stopped.abortedAt! - madeObsoleteAt).toBeLessThanOrEqual(2_600);
    expect(stopped).toMatchObject({ status: "obsolete", costUnknown: true });
    expect(stopped.failureCode).toBeUndefined();
    await until(async () => (await projectPreparations(s)).some((prep) => prep.status === "ready"), 400);
    // One overloaded try, then the next preparation's call; no retry.
    expect(requests).toHaveLength(2);
    expect(await modelFailures(s)).toHaveLength(0);
    await quiet(s);
  });

  test("a call on the OpenRouter gateway is stopped the same way", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "synthetic-stop-openrouter");
    const s = await projectSetup({ planningModel: "openai/gpt-6-sol" });
    plan.push("hang", "chat");
    const first = await claim(s);
    expect(first.planningModel).toBe("openai/gpt-6-sol");
    await startCall();
    expect(requests[0].url).toContain("openrouter.ai/api/v1/chat/completions");
    await supersede(s);
    await until(async () => (await row(s, first._id)).attemptEndedAt !== undefined, 400);
    expect(requests[0].aborted).toBe(true);
    const stopped = await row(s, first._id);
    expect(stopped).toMatchObject({ status: "obsolete", costUnknown: true });
    expect(stopped.failureCode).toBeUndefined();
    await quiet(s);
    // The next preparation answered on the same gateway; nothing counts against the model.
    expect((await projectPreparations(s)).filter((prep) => prep.status === "ready")).toHaveLength(1);
    expect(await modelFailures(s)).toHaveLength(0);
  });

  test("a stopped credit probe gives up its claim at once without restarting the cool-down (Q3)", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "synthetic-stop-openrouter");
    const s = await projectSetup();
    const latchedAt = Date.now() - CREDIT_LATCH_COOLDOWN_MS - 60_000;
    await s.t.run(async (ctx) => ctx.db.insert("anthropicCreditLatch", { key: "direct", latchedAt }));
    plan.push("hang");
    const first = await claim(s);
    await startCall();
    // The cool-down is over, so this call probes direct.
    expect(requests[0].url).toContain("api.anthropic.com");
    const claimed = await s.t.run(async (ctx) => ctx.db.query("anthropicCreditLatch").first());
    expect(claimed?.probeStartedAt).toBeDefined();
    await supersede(s);
    await until(async () => (await row(s, first._id)).attemptEndedAt !== undefined, 400);
    expect(requests[0].aborted).toBe(true);
    await quiet(s);
    // The stopped probe was not rerouted. The next call probed direct at
    // once: the claim was given up and the cool-down not restarted (a
    // restarted one would have sent it through OpenRouter). Its success
    // cleared the latch.
    expect(requests).toHaveLength(2);
    expect(requests[1].url).toContain("api.anthropic.com");
    expect(requests.some((sent) => sent.url.includes("openrouter.ai"))).toBe(false);
    expect(await s.t.run(async (ctx) => ctx.db.query("anthropicCreditLatch").first())).toBeNull();
  });

  test("a start woken when the slot freed that finds it taken again is not charged a wait (P3-6)", async () => {
    const s = await projectSetup();
    plan.push("hang");
    const first = await claim(s);
    await startCall();
    const second = await supersede(s);
    expect(second).toMatchObject({ status: "queued", waitingFor: "slot", deferrals: 1 });
    // The first call is still in flight: a woken start re-defers for free,
    // an ordinary one is counted.
    await s.t.mutation(internal.briefPreparations.startBriefPreparation, {
      preparationId: second._id, revision: second.revision, woken: true,
    });
    const afterWoken = await row(s, second._id);
    expect(afterWoken).toMatchObject({ status: "queued", waitingFor: "slot", deferrals: 1 });
    expect(afterWoken.revision).toBe(second.revision + 1);
    await s.t.mutation(internal.briefPreparations.startBriefPreparation, {
      preparationId: second._id, revision: afterWoken.revision,
    });
    expect((await row(s, second._id)).deferrals).toBe(2);
    // The wake itself asks as a woken start.
    await until(async () => (await row(s, first._id)).attemptEndedAt !== undefined, 400);
    const jobs = await s.t.run(async (ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(
      jobs.some((job) => job.name.includes("startBriefPreparation") && (job.args[0] as { woken?: boolean }).woken === true)
    ).toBe(true);
    await until(async () => (await row(s, second._id)).status === "ready", 400);
    await quiet(s);
  });

  test("a preparation a run waits on is never stopped by later edits", async () => {
    const s = await projectSetup();
    plan.push("slow");
    const first = await claim(s);
    await startCall();
    const generationId = await s.writer.mutation(api.generations.requestGeneration, {
      projectId: s.projectId,
      candidateMode: "iterative",
    });
    await s.t.run(async (ctx) => ctx.db.patch(generationId, { status: "running" }));
    const generation = (await s.t.run(async (ctx) => ctx.db.get(generationId)))!;
    const attached = await inAction(s.t, async (ctx) => {
      const route = resolveGenerationStep({ freeze: generation.modelFreeze ?? null, step: "brief", writerModel: generation.singleModelId! });
      const client = clientForStep(ctx, route, {
        callSite: "generation:brief",
        projectId: s.projectId,
        attribution: { generationId },
      });
      return await deriveOrAdoptSeedBrief(ctx, client, { projectId: s.projectId, generationId, model: route.model });
    });
    expect(attached.kind).toBe("attached");

    // An edit asks again; the attached attempt runs on for its run.
    await supersede(s);
    await realPause(4_200);
    expect(requests[0].aborted).toBe(false);
    expect((await row(s, first._id)).status).toBe("running");
    releases[0]();
    await until(async () => (await row(s, first._id)).status !== "running", 400);
    const done = await row(s, first._id);
    expect(done.status).toBe("ready");
    expect(done.abortedAt).toBeUndefined();
    await quiet(s);
  });
});

// ─── Draft-scoped setup ─────────────────────────────────────────────────────

async function draftSetup() {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  const userId = await t.run(async (ctx) =>
    ctx.db.insert("users", { authId: "reads-writer", role: "writer", name: "Wren Writer" })
  );
  const writer = t.withIdentity({ subject: "reads-writer" });
  const draftId = await writer.mutation(intakeDraftRefs.createIntakeDraft, {});
  await writer.mutation(intakeDraftRefs.saveIntakeSource, {
    draftId, sourceKey: "transcript-key-1", kind: "transcript", position: 0, label: "Interview", content: TRANSCRIPT, sourceFormat: "txt",
  });
  return { t, userId, writer, draftId };
}

type DraftSetup = Awaited<ReturnType<typeof draftSetup>>;

async function draftPreparations(s: DraftSetup): Promise<Doc<"briefPreparations">[]> {
  return await s.t.run(async (ctx) =>
    ctx.db.query("briefPreparations").withIndex("by_intakeDraftId", (q) => q.eq("intakeDraftId", s.draftId)).collect()
  );
}

async function names(s: DraftSetup) {
  await s.writer.mutation(intakeDraftRefs.updateIntakeContext, {
    draftId: s.draftId, clientName: "Acme Seals", interviewees: ["Priya Raman"],
  });
}

async function report(s: DraftSetup, count: number) {
  await s.writer.mutation(intakeDraftRefs.reportIntakePendingReads, { draftId: s.draftId, count });
}

/** Runs what is due, `ms` of fake time in steps of `step`. */
async function run(s: { t: T }, ms: number, step = 500) {
  for (let spent = 0; spent < ms; spent += step) {
    vi.advanceTimersByTime(Math.min(step, ms - spent));
    await s.t.finishInProgressScheduledFunctions();
  }
}

describe("waiting for files still being read", () => {
  test("a draft's start waits while files are being read, on its own counter, and starts 2 seconds after the count reaches zero", async () => {
    const s = await draftSetup();
    await report(s, 2);
    await names(s);
    // Past the names' 5-second settle: still waiting, for the files.
    await run(s, 12_000);
    let [prep] = await draftPreparations(s);
    expect(prep).toMatchObject({ status: "queued", waitingFor: "reads" });
    expect(prep.readsWaits).toBeGreaterThanOrEqual(1);
    expect(prep.deferrals ?? 0).toBe(0);
    expect(requests).toHaveLength(0);

    // Still one file: the wait goes on.
    await report(s, 1);
    await run(s, 10_000);
    expect(requests).toHaveLength(0);

    // The last file is saved (an edit) and the count drops to zero.
    await s.writer.mutation(intakeDraftRefs.saveIntakeSource, {
      draftId: s.draftId, sourceKey: "document-key-1", kind: "document", position: 1000, label: "cold-soak.txt",
      content: DOCUMENT, fileType: "txt", category: "background", intake: "file", extractionOutcome: "ok",
    });
    await report(s, 0);
    const zeroAt = Date.now();
    await run(s, INTAKE_DEBOUNCE_MS - 200, 100);
    [prep] = await draftPreparations(s);
    expect(prep.status).toBe("queued");
    expect(requests).toHaveLength(0);
    await run(s, 400, 100);
    await run(s, 2_000);
    [prep] = await draftPreparations(s);
    expect(prep.dispatchedAt! - zeroAt).toBeGreaterThanOrEqual(INTAKE_DEBOUNCE_MS);
    expect(prep.dispatchedAt! - zeroAt).toBeLessThan(INTAKE_DEBOUNCE_MS + 300);
    expect(prep.status).toBe("ready");
    expect(requests).toHaveLength(1);
    // The document the page was still reading is in the Brief's request.
    expect(JSON.stringify(requests[0].body)).toContain("400 cycles at minus 30 degrees, no leak");
  });

  test("a count not refreshed for 90 seconds stops counting (a closed tab)", async () => {
    const s = await draftSetup();
    await report(s, 1);
    const reportedAt = Date.now();
    await names(s);
    await run(s, PENDING_READS_STALE_MS - 10_000, 1_000);
    expect(requests).toHaveLength(0);
    expect((await draftPreparations(s))[0]).toMatchObject({ status: "queued", waitingFor: "reads" });
    await run(s, 15_000, 1_000);
    const [prep] = await draftPreparations(s);
    expect(prep.status).toBe("ready");
    expect(prep.dispatchedAt! - reportedAt).toBeGreaterThanOrEqual(PENDING_READS_STALE_MS);
    expect(requests).toHaveLength(1);
  });

  test("refreshed every 30 seconds, the start waits at most 3 minutes from its first wait, then prepares with what is saved", async () => {
    const s = await draftSetup();
    await report(s, 1);
    await names(s);
    await run(s, 8_000);
    const [waiting] = await draftPreparations(s);
    const firstWait = waiting.readsWaitStartedAt!;
    expect(firstWait).toBeDefined();
    const boundAt = firstWait + MAX_PENDING_READS_WAIT_MS;
    // The page keeps the count fresh every 30 seconds.
    while (Date.now() + 30_000 < boundAt - 1_000) {
      await run(s, 30_000, 1_000);
      await report(s, 1);
      expect(requests).toHaveLength(0);
    }
    await run(s, boundAt - 1_000 - Date.now(), 500);
    expect((await draftPreparations(s))[0]).toMatchObject({ status: "queued", waitingFor: "reads" });
    await report(s, 1);
    await run(s, 6_000, 500);
    const [prep] = await draftPreparations(s);
    expect(prep.status).toBe("ready");
    expect(prep.dispatchedAt! - firstWait).toBeGreaterThanOrEqual(MAX_PENDING_READS_WAIT_MS);
    // Many waits, none of them charged to the other waits.
    expect(prep.readsWaits).toBeGreaterThan(1);
    expect(prep.deferrals ?? 0).toBe(0);
    expect(requests).toHaveLength(1);
  });

  test("a later batch of files gets its own 3 minutes: the bound starts again after the count reaches zero (P3-5)", async () => {
    const s = await draftSetup();
    await report(s, 1);
    await names(s);
    await run(s, 8_000);
    const firstWait = (await draftPreparations(s))[0].readsWaitStartedAt!;
    expect(firstWait).toBeDefined();
    // The first batch takes two and a half minutes.
    for (let step = 0; step < 5; step += 1) {
      await run(s, 30_000, 1_000);
      await report(s, 1);
    }
    // It lands; before the 2-second quiet period ends, another batch starts.
    await report(s, 0);
    expect((await draftPreparations(s))[0].readsWaitStartedAt).toBeUndefined();
    await report(s, 2);
    await run(s, 3_000, 500);
    const [again] = await draftPreparations(s);
    expect(again).toMatchObject({ status: "queued", waitingFor: "reads" });
    const secondWait = again.readsWaitStartedAt!;
    expect(secondWait).toBeGreaterThan(firstWait + 150_000);
    // Past the first batch's bound, the second still waits.
    while (Date.now() < firstWait + MAX_PENDING_READS_WAIT_MS + 20_000) {
      await run(s, 20_000, 1_000);
      await report(s, 2);
    }
    expect((await draftPreparations(s))[0].status).toBe("queued");
    expect(requests).toHaveLength(0);
    while (Date.now() < secondWait + MAX_PENDING_READS_WAIT_MS + 5_000) {
      await run(s, 20_000, 1_000);
      await report(s, 2);
    }
    const [prep] = await draftPreparations(s);
    expect(prep.status).toBe("ready");
    expect(prep.dispatchedAt! - secondWait).toBeGreaterThanOrEqual(MAX_PENDING_READS_WAIT_MS);
  });

  test("the count is the owner's alone, whole and not negative, and discarding the draft clears it", async () => {
    const s = await draftSetup();
    const other = s.t.withIdentity({ subject: "reads-outsider" });
    await s.t.run(async (ctx) => ctx.db.insert("users", { authId: "reads-outsider", role: "writer", name: "Olly Outsider" }));
    await expect(other.mutation(intakeDraftRefs.reportIntakePendingReads, { draftId: s.draftId, count: 3 })).rejects.toThrow();
    await expect(s.writer.mutation(intakeDraftRefs.reportIntakePendingReads, { draftId: s.draftId, count: -1 })).rejects.toThrow();
    await expect(s.writer.mutation(intakeDraftRefs.reportIntakePendingReads, { draftId: s.draftId, count: 1.5 })).rejects.toThrow();
    await report(s, 2);
    const before = (await s.t.run(async (ctx) => ctx.db.get(s.draftId)))!;
    expect(before.pendingReads).toBe(2);
    // Not an edit: later reports move neither the last edit nor the idle expiry.
    vi.advanceTimersByTime(60_000);
    await report(s, 3);
    const later = (await s.t.run(async (ctx) => ctx.db.get(s.draftId)))!;
    expect(later.pendingReads).toBe(3);
    expect(later.pendingReadsUpdatedAt).toBe(before.pendingReadsUpdatedAt! + 60_000);
    expect(later.expiresAt).toBe(before.expiresAt);
    expect(later.lastEditedAt).toBe(before.lastEditedAt);
    await s.writer.mutation(intakeDraftRefs.discardIntakeDraft, { draftId: s.draftId });
    const after = (await s.t.run(async (ctx) => ctx.db.get(s.draftId)))!;
    expect(after.pendingReads).toBeUndefined();
    expect(after.pendingReadsUpdatedAt).toBeUndefined();
  });
});

describe("stopping a draft's reading", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  test("a draft reading stops at once when the writer discards the draft", async () => {
    const s = await draftSetup();
    plan.push("slow");
    await names(s);
    // Names settled long ago, so the start runs 2 seconds after this edit.
    await s.t.run(async (ctx) => ctx.db.patch(s.draftId, { contextChangedAt: Date.now() - 60_000 }));
    await s.writer.mutation(intakeDraftRefs.setIntakeSelection, { draftId: s.draftId, excludedSourceKeys: ["unused-key-1"] });
    await startCall();
    const [running] = await draftPreparations(s);
    expect(running.status).toBe("running");
    const discardedAt = Date.now();
    await s.writer.mutation(intakeDraftRefs.discardIntakeDraft, { draftId: s.draftId });
    await until(async () => (await row(s, running._id)).attemptEndedAt !== undefined, 400);
    expect(requests[0].aborted).toBe(true);
    const stopped = await row(s, running._id);
    expect(stopped).toMatchObject({ status: "obsolete", endedReason: "draft_closed" });
    expect(stopped.failureCode).toBeUndefined();
    expect(stopped.abortedAt! - discardedAt).toBeLessThanOrEqual(2_600);
    expect(await modelFailures(s)).toHaveLength(0);
  });
});
