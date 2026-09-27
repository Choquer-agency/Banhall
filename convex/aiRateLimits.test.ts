/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import schema from "./schema";
import {
  AI_RATE_LIMITS,
  aiRateLimiter,
  GENERATION_PER_USER_FIRM_DAY,
  limitGenerationStart,
  rateLimitedMessage,
} from "./lib/aiRateLimits";
import { firmDateStartAfterDays } from "../shared/firmTime";
import { addDecisionSeed, decisionFixture, decisionMutation } from "./seedDecision.fixture";
import type * as seedEndpoints from "./seeds";

// Audit wave 2 (docs/product-domain.md, 2026-09-27): per-user and
// per-project token buckets on every paid AI entry point. A refusal is
// RATE_LIMITED with `retryAfter` in seconds; a refusal spends nothing;
// another user (or project) is unaffected; scheduler and server-internal
// calls are never limited; admins are counted like everyone else.

const providerMocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("./ai/providers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./ai/providers")>()),
  clientForRole: async () => ({
    client: { messages: { create: providerMocks.create } },
    model: "claude-sonnet-5",
  }),
}));

const modules = import.meta.glob("./**/*.ts");

const AUTH = { writer: "rl-writer", other: "rl-other", manager: "rl-manager", admin: "rl-admin" } as const;

const REPORT_DOC = JSON.stringify({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "The team studied thermal drift." }] }],
});

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
  vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key");
  providerMocks.create.mockReset().mockResolvedValue({
    content: [{ type: "text", text: "NONE" }],
    stop_reason: "end_turn",
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function setup() {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const writerId = await ctx.db.insert("users", { authId: AUTH.writer, role: "writer", firstName: "Wren" });
    const otherId = await ctx.db.insert("users", { authId: AUTH.other, role: "writer", firstName: "Otto" });
    const managerId = await ctx.db.insert("users", { authId: AUTH.manager, role: "manager", firstName: "Mara" });
    const adminId = await ctx.db.insert("users", { authId: AUTH.admin, role: "admin", firstName: "Ada" });
    const project = async (title: string, ownerId: Id<"users">) => {
      const projectId = await ctx.db.insert("projects", {
        title,
        clientName: "Acme",
        status: "review",
        createdBy: ownerId,
        ownerId,
        shareToken: crypto.randomUUID(),
        scienceCode: "2.02.01",
        createdAt: now,
        updatedAt: now,
      });
      const transcriptId = await ctx.db.insert("transcripts", {
        projectId,
        content: "Interviewer: What did you test?\n\nClient: The alloy at low temperature.",
        createdAt: now,
      });
      return { projectId, transcriptId };
    };
    const main = await project("Rate limited project", writerId);
    const second = await project("Second project", otherId);
    const generation = (fields: Record<string, unknown>) =>
      ctx.db.insert("generations", {
        projectId: main.projectId,
        transcriptId: main.transcriptId,
        requestedBy: writerId,
        previousProjectStatus: "review",
        startedAt: now,
        status: "failed",
        candidateMode: "single",
        singleModelId: "claude-sonnet-5",
        ...fields,
      } as never);
    const failedId = await generation({});
    const partialId = await generation({
      status: "awaiting_selection",
      candidateMode: "compare",
      compareModelIds: ["claude-sonnet-5", "google/gemini-3.1-pro-preview"],
    });
    const completedId = await generation({ status: "completed" });
    const iterativeId = await generation({ status: "awaiting_input", candidateMode: "iterative" });
    const seedRunningId = await generation({ status: "running", candidateMode: "iterative", gatedWorkflow: "seeds" });
    const briefId = await ctx.db.insert("generationBriefs", {
      projectId: main.projectId,
      generationId: failedId,
      inputsHash: "brief-inputs",
      version: 1,
      origin: "derived",
      storylineText: "A storyline.",
      createdAt: now,
    });
    const summaryVersionId = await ctx.db.insert("summaryVersions", {
      projectId: main.projectId,
      generationId: failedId,
      version: 1,
      originGenerationId: failedId,
      briefVersionId: briefId,
      settingsHash: "settings",
      skippedRoleIds: [],
      readiness: true,
      signedOffBy: writerId,
      signedOffAt: now,
    });
    const failedSeedsId = await generation({
      candidateMode: "iterative",
      gatedWorkflow: "seeds",
      summaryVersionId,
    });
    const reportId = await ctx.db.insert("reports", {
      projectId: main.projectId,
      generationId: completedId,
      content: REPORT_DOC,
      version: 1,
      generatedAt: now,
      updatedAt: now,
      revisionNumber: 0,
    });
    const documentId = await ctx.db.insert("projectDocuments", {
      projectId: main.projectId,
      fileName: "pd.txt",
      fileType: "txt",
      content: "A written PD.",
      source: "review_pd",
      uploadedBy: writerId,
      createdAt: now,
    });
    const pdReviewId = await ctx.db.insert("pdReviews", {
      projectId: main.projectId,
      documentId,
      sourceFileName: "pd.txt",
      status: "failed",
      error: "failed",
      createdBy: writerId,
      createdAt: now,
    });
    await ctx.db.patch(main.projectId, { activeGenerationId: iterativeId });
    return {
      writerId, otherId, managerId, adminId,
      projectId: main.projectId, secondProjectId: second.projectId,
      failedId, partialId, completedId, iterativeId, seedRunningId, failedSeedsId,
      reportId, documentId, pdReviewId,
    };
  });
  const as = (actor: keyof typeof AUTH) => t.withIdentity({ subject: AUTH[actor] });
  return { t, as, ...ids };
}

type Fixture = Awaited<ReturnType<typeof setup>>;
type HourlyLimit = keyof typeof AI_RATE_LIMITS;

/** Spends a whole hourly bucket, as that many earlier clicks would. */
async function drain(t: Fixture["t"], name: HourlyLimit, key: string) {
  await t.run(async (ctx) => {
    const limitCtx = ctx as unknown as MutationCtx;
    await aiRateLimiter.reset(limitCtx, name, { key });
    const spent = await aiRateLimiter.limit(limitCtx, name, { key, count: AI_RATE_LIMITS[name].rate });
    expect(spent.ok).toBe(true);
  });
}

async function remaining(t: Fixture["t"], name: HourlyLimit, key: string) {
  return await t.run(async (ctx) =>
    (await aiRateLimiter.getValue(ctx as unknown as MutationCtx, name, { key })).value);
}

function rateLimited(retryAfter: number | ReturnType<typeof expect.any> = expect.any(Number)) {
  return { data: { code: "RATE_LIMITED", retryAfter, message: expect.stringMatching(/^You have started a lot of runs/) } };
}

function requestArgs(projectId: Id<"projects">) {
  return { projectId, candidateMode: "single" as const, singleModelId: "claude-sonnet-5", confirmRegeneration: true };
}

async function freeProject(f: Fixture) {
  // requestGeneration refuses while another run is active; the refusal tests
  // below never reach that check, the success checks need a free project.
  await f.t.run(async (ctx) => {
    await ctx.db.patch(f.projectId, { activeGenerationId: undefined });
    await ctx.db.patch(f.iterativeId, { status: "failed" });
    await ctx.db.patch(f.seedRunningId, { status: "failed" });
    await ctx.db.patch(f.partialId, { status: "failed" });
  });
}

describe("generation starts: 12 an hour and 40 a firm day per user, 6 an hour per project", () => {
  it("refuses requestGeneration past the user's hourly limit, names the wait, and leaves another user alone", async () => {
    const f = await setup();
    await freeProject(f);
    await drain(f.t, "generationPerUser", f.writerId);
    await expect(f.as("writer").mutation(api.generations.requestGeneration, requestArgs(f.projectId)))
      .rejects.toMatchObject(rateLimited(300));
    await expect(f.as("writer").mutation(api.generations.requestGeneration, requestArgs(f.projectId)))
      .rejects.toMatchObject({ data: { message: "You have started a lot of runs in the last hour. Try again in 5 minutes." } });
    // A Manager (edit access to every project) has a bucket of their own.
    const generationId = await f.as("manager").mutation(api.generations.requestGeneration, requestArgs(f.projectId));
    expect(await f.t.run((ctx) => ctx.db.get(generationId))).toMatchObject({ requestedBy: f.managerId });
  });

  it("counts an admin like everyone else", async () => {
    const f = await setup();
    await freeProject(f);
    await drain(f.t, "generationPerUser", f.adminId);
    await expect(f.as("admin").mutation(api.generations.requestGeneration, requestArgs(f.projectId)))
      .rejects.toMatchObject(rateLimited());
  });

  it("refuses a seventh start on one project in an hour, whoever asks, and spends nothing on the refusal", async () => {
    const f = await setup();
    await freeProject(f);
    await f.t.run(async (ctx) => {
      for (let i = 0; i < AI_RATE_LIMITS.generationPerProject.rate; i += 1) {
        await limitGenerationStart(ctx as unknown as MutationCtx, f.writerId, f.projectId);
      }
    });
    await expect(f.as("manager").mutation(api.generations.requestGeneration, requestArgs(f.projectId)))
      .rejects.toMatchObject(rateLimited());
    expect(await remaining(f.t, "generationPerUser", f.managerId)).toBe(AI_RATE_LIMITS.generationPerUser.rate);
    // The same Manager on another project is not refused.
    await expect(f.as("manager").mutation(api.generations.requestGeneration, requestArgs(f.secondProjectId)))
      .resolves.toEqual(expect.any(String));
  });

  it("refuses the 41st start of a firm day until the next firm midnight", async () => {
    // 09:00 in Vancouver (PDT), so three hours of starts stay in one firm day.
    const start = Date.UTC(2026, 8, 28, 16, 0, 0);
    vi.useFakeTimers({ now: start, toFake: ["Date"] });
    const f = await setup();
    await freeProject(f);
    let spent = 0;
    await f.t.run(async (ctx) => {
      while (spent < GENERATION_PER_USER_FIRM_DAY) {
        const projectKey = `project-${spent % 4}` as Id<"projects">;
        await limitGenerationStart(ctx as unknown as MutationCtx, f.writerId, projectKey);
        spent += 1;
        if (spent % AI_RATE_LIMITS.generationPerUser.rate === 0) vi.setSystemTime(Date.now() + 60 * 60 * 1000);
      }
    });
    const now = Date.now();
    const untilMidnight = Math.ceil((firmDateStartAfterDays(now, 1) - now) / 1000);
    await expect(f.as("writer").mutation(api.generations.requestGeneration, requestArgs(f.projectId)))
      .rejects.toMatchObject({
        data: {
          code: "RATE_LIMITED",
          retryAfter: untilMidnight,
          message: "You have started a lot of runs today. Try again tomorrow.",
        },
      });
    // The next firm day starts a fresh count.
    vi.setSystemTime(firmDateStartAfterDays(now, 1) + 1000);
    await expect(f.as("writer").mutation(api.generations.requestGeneration, requestArgs(f.projectId)))
      .resolves.toEqual(expect.any(String));
  });

  const retryPaths: Array<[string, (f: Fixture) => Promise<unknown>]> = [
    ["retryGeneration", (f) => f.as("writer").mutation(api.generations.retryGeneration, { generationId: f.failedId })],
    ["retryFromSummary", (f) => f.as("writer").mutation(api.generations.retryFromSummary, { failedGenerationId: f.failedSeedsId })],
    ["retryFailedCandidates", (f) => f.as("writer").mutation(api.generations.retryFailedCandidates, { generationId: f.partialId })],
    ["regenerateSectionDraft", (f) => f.as("writer").mutation(api.generations.regenerateSectionDraft, { generationId: f.iterativeId, section: "s242" })],
    ["retryInitializeSeedStage", (f) => f.as("writer").mutation(api.generations.retryInitializeSeedStage, { generationId: f.seedRunningId })],
    ["retryDraftingInputs", (f) => f.as("writer").mutation(api.generations.retryDraftingInputs, { generationId: f.seedRunningId })],
  ];
  it.each(retryPaths)("refuses %s past the user's hourly limit", async (_name, call) => {
    const f = await setup();
    await drain(f.t, "generationPerUser", f.writerId);
    await expect(call(f)).rejects.toMatchObject(rateLimited());
  });
  it.each(retryPaths)("refuses %s past the project's hourly limit", async (_name, call) => {
    const f = await setup();
    await drain(f.t, "generationPerProject", f.projectId);
    await expect(call(f)).rejects.toMatchObject(rateLimited());
  });
});

describe("QA runs and PD reviews: 20 an hour per user each", () => {
  it("refuses requestReportQa past the limit and leaves another user alone", async () => {
    const f = await setup();
    await drain(f.t, "qaPerUser", f.writerId);
    await expect(f.as("writer").mutation(api.generations.requestReportQa, { generationId: f.completedId }))
      .rejects.toMatchObject(rateLimited());
    await expect(f.as("manager").mutation(api.generations.requestReportQa, { generationId: f.completedId }))
      .resolves.toBeNull();
    // A pass already running is joined, not started, so it spends nothing.
    await drain(f.t, "qaPerUser", f.managerId);
    await expect(f.as("manager").mutation(api.generations.requestReportQa, { generationId: f.completedId }))
      .resolves.toBeNull();
  });

  it("refuses startPdReview, retryPdReview and a review started from a project past the limit", async () => {
    const f = await setup();
    await drain(f.t, "pdReviewPerUser", f.writerId);
    await expect(f.as("writer").mutation(api.pdReviews.startPdReview, { projectId: f.projectId, documentId: f.documentId }))
      .rejects.toMatchObject(rateLimited());
    await expect(f.as("writer").mutation(api.pdReviews.retryPdReview, { reviewId: f.pdReviewId }))
      .rejects.toMatchObject(rateLimited());
    const projectsBefore = await f.t.run(async (ctx) => (await ctx.db.query("projects").collect()).length);
    await expect(f.as("writer").action(api.reviewFromProject.createReviewFromProject, { projectId: f.projectId }))
      .rejects.toMatchObject(rateLimited());
    expect(await f.t.run(async (ctx) => (await ctx.db.query("projects").collect()).length)).toBe(projectsBefore);
    // Another user starts one.
    await expect(f.as("manager").mutation(api.pdReviews.startPdReview, { projectId: f.projectId, documentId: f.documentId }))
      .resolves.toEqual(expect.any(String));
  });
});

describe("research sessions (20 an hour) and science code suggestions (30 an hour)", () => {
  it("refuses startResearch past the limit before any session is written", async () => {
    const f = await setup();
    await drain(f.t, "researchPerUser", f.writerId);
    await expect(f.as("writer").mutation(api.research.startResearch, {
      reportId: f.reportId,
      selectedText: "thermal drift",
      selectionFrom: 1,
      selectionTo: 14,
      surroundingContext: "The team studied thermal drift.",
      instruction: "Is thermal drift a known risk?",
    })).rejects.toMatchObject(rateLimited());
    expect(await f.t.run(async (ctx) => await ctx.db.query("researchSessions").collect())).toEqual([]);
  });

  it("refuses a science code suggestion past the limit without a model call, and leaves another user alone", async () => {
    const f = await setup();
    await drain(f.t, "scienceCodePerUser", f.writerId);
    await expect(f.as("writer").action(api.scienceCodeSuggestions.suggest, { projectId: f.projectId }))
      .rejects.toMatchObject(rateLimited());
    expect(providerMocks.create).not.toHaveBeenCalled();
    await expect(f.as("manager").action(api.scienceCodeSuggestions.suggest, { projectId: f.projectId }))
      .resolves.toBeNull();
    expect(providerMocks.create).toHaveBeenCalledTimes(1);
    expect(await remaining(f.t, "scienceCodePerUser", f.managerId)).toBe(AI_RATE_LIMITS.scienceCodePerUser.rate - 1);
  });
});

const open = decisionMutation<typeof seedEndpoints.open>("seeds:open");
const regenerate = decisionMutation<typeof seedEndpoints.regenerate>("seeds:regenerate");
const giveFeedback = decisionMutation<typeof seedEndpoints.giveFeedback>("seeds:giveFeedback");

describe("Seed model calls: 90 an hour per user", () => {
  it("refuses an explicit open of a new step's Batch past the limit and spends a token on each new Batch", async () => {
    const s = await decisionFixture();
    const args = { generationId: s.generationId, roleId: "company_context" as const, expectedSeedStageVersion: 0 };
    await expect(s.writer.mutation(open, { ...args, commandId: "open-1" })).resolves.toMatchObject({ kind: "dispatched" });
    expect(await remaining(s.t, "seedPerUser", s.userId)).toBe(AI_RATE_LIMITS.seedPerUser.rate - 1);
    await drain(s.t, "seedPerUser", s.userId);
    const version = (await s.t.run((ctx) => ctx.db.get(s.generationId)))?.seedStageVersion ?? 0;
    await expect(s.writer.mutation(open, { ...args, roleId: "goal_problem", expectedSeedStageVersion: version, commandId: "open-2" }))
      .rejects.toMatchObject(rateLimited());
  });

  it("refuses regenerate and feedback past the limit", async () => {
    const s = await decisionFixture();
    const { seedId } = await addDecisionSeed(s);
    await drain(s.t, "seedPerUser", s.userId);
    const version = (await s.t.run((ctx) => ctx.db.get(s.generationId)))?.seedStageVersion ?? 0;
    const common = { generationId: s.generationId, roleId: "company_context" as const, expectedSeedStageVersion: version };
    await expect(s.writer.mutation(regenerate, { ...common, commandId: "regen-1" })).rejects.toMatchObject(rateLimited());
    await expect(s.writer.mutation(giveFeedback, { ...common, seedId, instruction: "Shorter.", commandId: "fb-1" }))
      .rejects.toMatchObject(rateLimited());
    expect(await s.t.run(async (ctx) => await ctx.db.query("seedFeedbackRequests").collect())).toEqual([]);
  });

  it("never limits the server's first Batch, and the browser open it answers spends nothing", async () => {
    const s = await decisionFixture();
    await drain(s.t, "seedPerUser", s.userId);
    await expect(s.t.mutation(internal.seedRuns.startFirstBatch, { generationId: s.generationId }))
      .resolves.toMatchObject({ kind: "dispatched" });
    const version = (await s.t.run((ctx) => ctx.db.get(s.generationId)))?.seedStageVersion ?? 0;
    await expect(s.writer.mutation(open, {
      generationId: s.generationId,
      roleId: "company_context",
      expectedSeedStageVersion: version,
      commandId: "open-after-server",
    })).resolves.toMatchObject({ kind: "reused" });
  });
});

describe("rateLimitedMessage", () => {
  it("rounds up to whole minutes and says tomorrow for a spent day", () => {
    expect(rateLimitedMessage(1, false)).toBe("You have started a lot of runs in the last hour. Try again in 1 minute.");
    expect(rateLimitedMessage(61, false)).toBe("You have started a lot of runs in the last hour. Try again in 2 minutes.");
    expect(rateLimitedMessage(3600, true)).toBe("You have started a lot of runs today. Try again tomorrow.");
  });
});
