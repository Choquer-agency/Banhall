/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildStyleAnalysisPrompt,
  styleAnalysisSchema,
} from "./styleAnalysis";
import { STYLE_OVERRIDE_KEYS } from "../../shared/styleOverrides";
import { MAX_INSTRUCTIONS_CHARS } from "../../shared/writerProfileLimits";
import { aiRateLimiter } from "../lib/aiRateLimits";
import type { MutationCtx } from "../_generated/server";
import { api } from "../_generated/api";
import schema from "../schema";

// The persist path: only the model client is replaced; the action, the
// structured decoding and the coverage write stay real.
const providerMocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("./providers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./providers")>()),
  clientForRole: async () => ({
    client: { messages: { create: providerMocks.create } },
    model: "claude-sonnet-5",
  }),
}));
// Vite names files in this folder "./x.ts"; convex-test needs "../ai/x.ts".
const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, load]) => [
    path.startsWith("./") ? `../ai/${path.slice(2)}` : path,
    load,
  ]),
);

describe("buildStyleAnalysisPrompt", () => {
  it("includes every category's key, label context, and the locked tier", () => {
    const { system, user } = buildStyleAnalysisPrompt("Use short sentences.");
    for (const key of STYLE_OVERRIDE_KEYS) {
      expect(user).toContain(`### ${key}:`);
    }
    expect(user).toContain("## Locked CRA tier (never overridable)");
    expect(user).toContain("Use short sentences.");
    expect(system).toContain("addressed=true");
    expect(system).toContain("Be conservative");
  });

  it("bounds oversized instruction documents", () => {
    const { user } = buildStyleAnalysisPrompt("x".repeat(100_000));
    expect(user.length).toBeLessThan(100_000);
  });
});

describe("styleAnalysisSchema", () => {
  it("accepts a complete result and rejects a partial one", () => {
    const complete = {
      categories: Object.fromEntries(
        STYLE_OVERRIDE_KEYS.map((key) => [
          key,
          { addressed: key === "bannedWords", evidence: key === "bannedWords" ? "never use utilize" : null },
        ])
      ),
      lockedConflicts: [{ excerpt: "skip the hypothesis", rule: "Hypothesis content" }],
    };
    expect(styleAnalysisSchema.safeParse(complete).success).toBe(true);
    const partial = {
      categories: { bannedWords: { addressed: true, evidence: null } },
      lockedConflicts: [],
    };
    expect(styleAnalysisSchema.safeParse(partial).success).toBe(false);
  });
});

describe("analyzeMyInstructions persist (round 2, I2)", () => {
  const analysis = {
    categories: Object.fromEntries(
      STYLE_OVERRIDE_KEYS.map((key) => [
        key,
        key === "sentenceConstruction"
          ? { addressed: true, evidence: "Short sentences" }
          : { addressed: false, evidence: null },
      ]),
    ),
    lockedConflicts: [],
  };

  beforeEach(() => {
    providerMocks.create.mockReset().mockResolvedValue({
      content: [{ type: "tool_use", id: "t1", name: "submit_style_analysis", input: analysis }],
      stop_reason: "tool_use",
      usage: { input_tokens: 1, output_tokens: 1 },
    });
  });

  async function setup(saved: string) {
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { authId: "analysis-writer", role: "writer" });
      await ctx.db.insert("writerProfiles", {
        userId,
        customInstructions: saved,
        enabled: true,
        updatedBy: userId,
        createdAt: 1,
        updatedAt: 1,
      });
    });
    return { t, writer: t.withIdentity({ subject: "analysis-writer" }) };
  }

  it("stores the result as coverage when the analysed text is the saved text", async () => {
    const { writer } = await setup("Short sentences, active voice.");
    await writer.action(api.ai.styleAnalysis.analyzeMyInstructions, {
      text: "  Short sentences, active voice. ",
      persist: true,
    });
    const profile = await writer.query(api.writerProfiles.getMyProfile, {});
    expect(profile?.coverage?.categories.sentenceConstruction).toEqual({
      addressed: true,
      evidence: "Short sentences",
    });
  });

  it("stores nothing without persist or for unsaved text", async () => {
    const { writer } = await setup("Short sentences, active voice.");
    await writer.action(api.ai.styleAnalysis.analyzeMyInstructions, {
      text: "Short sentences, active voice.",
    });
    await writer.action(api.ai.styleAnalysis.analyzeMyInstructions, {
      text: "A draft I have not saved yet.",
      persist: true,
    });
    expect((await writer.query(api.writerProfiles.getMyProfile, {}))?.coverage).toBeUndefined();
    expect(providerMocks.create).toHaveBeenCalledTimes(2);
  });
});

describe("analyzeMyInstructions with long instructions (2026-10-19)", () => {
  // Fictional instructions of about 61,000 characters, the size of the saved
  // instructions whose check failed on 2026-10-07.
  const LONG = Array.from(
    { length: 1200 },
    (_, index) => `Rule ${index + 1}: keep sentences short and name the test rig at Pinebrook Labs.`,
  )
    .join("\n")
    .slice(0, 61_000)
    .trim();
  const categories = Object.fromEntries(
    STYLE_OVERRIDE_KEYS.map((key) => [
      key,
      key === "sentenceConstruction"
        ? { addressed: true, evidence: "keep sentences short" }
        : { addressed: false, evidence: null },
    ]),
  );
  const conflict = { excerpt: "skip the hypothesis", rule: "Hypothesis content" };
  const answer = (input: unknown) => ({
    content: [{ type: "tool_use", id: "t1", name: "submit_style_analysis", input }],
    stop_reason: "tool_use",
    usage: { input_tokens: 1, output_tokens: 1 },
  });

  async function setup() {
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { authId: "long-writer", role: "writer" });
      await ctx.db.insert("writerProfiles", {
        userId,
        customInstructions: LONG,
        enabled: true,
        updatedBy: userId,
        createdAt: 1,
        updatedAt: 1,
      });
    });
    return { writer: t.withIdentity({ subject: "long-writer" }) };
  }

  beforeEach(() => {
    providerMocks.create.mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.mocked(console.warn).mockRestore();
    vi.mocked(console.error).mockRestore();
  });

  it("stores coverage when the answer puts the rest of itself inside categories (the 2026-10-07 failure)", async () => {
    expect(LONG.length).toBeGreaterThan(60_000);
    // The categories object, then `, "lockedConflicts": [...]`, all as the
    // text of `categories`, with no top-level lockedConflicts.
    const text = `${JSON.stringify(categories)}, "lockedConflicts": ${JSON.stringify([conflict])}`;
    providerMocks.create.mockResolvedValue(answer({ categories: text }));
    const { writer } = await setup();

    const result = await writer.action(api.ai.styleAnalysis.analyzeMyInstructions, { text: LONG, persist: true });

    expect(providerMocks.create).toHaveBeenCalledTimes(1);
    expect(result.lockedConflicts).toEqual([conflict]);
    const profile = await writer.query(api.writerProfiles.getMyProfile, {});
    expect(profile?.coverage?.categories).toEqual(categories);
  });

  it("stores coverage when categories is JSON text and lockedConflicts is left out, and returns no conflicts", async () => {
    providerMocks.create.mockResolvedValue(answer({ categories: JSON.stringify(categories) }));
    const { writer } = await setup();

    const result = await writer.action(api.ai.styleAnalysis.analyzeMyInstructions, { text: LONG, persist: true });

    expect(providerMocks.create).toHaveBeenCalledTimes(1);
    expect(result.lockedConflicts).toEqual([]);
    expect(console.warn).toHaveBeenCalledWith(
      "submit_style_analysis: the answer left out lockedConflicts, read as empty",
    );
    const profile = await writer.query(api.writerProfiles.getMyProfile, {});
    expect(profile?.coverage?.categories.sentenceConstruction).toEqual({
      addressed: true,
      evidence: "keep sentences short",
    });
  });

  it("still fails, and stores nothing, when a category verdict is missing", async () => {
    const partial = Object.fromEntries(Object.entries(categories).filter(([key]) => key !== "bannedWords"));
    providerMocks.create.mockResolvedValue(answer({ categories: JSON.stringify(partial), lockedConflicts: [] }));
    const { writer } = await setup();

    await expect(
      writer.action(api.ai.styleAnalysis.analyzeMyInstructions, { text: LONG, persist: true }),
    ).rejects.toThrow(/submit_style_analysis: model returned an unexpected shape/);

    // The answer and its one repair, as before.
    expect(providerMocks.create).toHaveBeenCalledTimes(2);
    expect((await writer.query(api.writerProfiles.getMyProfile, {}))?.coverage).toBeUndefined();
  });
});

describe("analyzeMyInstructions limits (audit wave 2)", () => {
  const analysis = {
    categories: Object.fromEntries(
      STYLE_OVERRIDE_KEYS.map((key) => [key, { addressed: false, evidence: null }]),
    ),
    lockedConflicts: [],
  };

  beforeEach(() => {
    providerMocks.create.mockReset().mockResolvedValue({
      content: [{ type: "tool_use", id: "t1", name: "submit_style_analysis", input: analysis }],
      stop_reason: "tool_use",
      usage: { input_tokens: 1, output_tokens: 1 },
    });
  });

  async function setup() {
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { authId: "limit-writer", role: "writer" });
      await ctx.db.insert("users", { authId: "limit-other", role: "writer" });
      await ctx.db.insert("users", { authId: "limit-roleless" });
    });
    return {
      t,
      writer: t.withIdentity({ subject: "limit-writer" }),
      other: t.withIdentity({ subject: "limit-other" }),
      roleless: t.withIdentity({ subject: "limit-roleless" }),
    };
  }

  it("needs an active internal role", async () => {
    const { roleless } = await setup();
    await expect(roleless.action(api.ai.styleAnalysis.analyzeMyInstructions, { text: "Short sentences." }))
      .rejects.toMatchObject({ data: { code: "NOT_AUTHORIZED" } });
    await expect(roleless.action(api.ai.styleAnalysis.analyzeMyInstructions, { text: "" }))
      .rejects.toMatchObject({ data: { code: "NOT_AUTHORIZED" } });
    expect(providerMocks.create).not.toHaveBeenCalled();
  });

  it("refuses text over the Settings limit (75,000 characters) before any call, in the same words as a save", async () => {
    const { writer } = await setup();
    const tooLong = "x".repeat(MAX_INSTRUCTIONS_CHARS + 1);
    const refusal = { data: { code: "INVALID_INPUT", message: "Writing preferences are limited to 75,000 characters." } };
    await expect(writer.action(api.ai.styleAnalysis.analyzeMyInstructions, { text: tooLong })).rejects.toMatchObject(refusal);
    await expect(writer.mutation(api.writerProfiles.saveMyProfile, { customInstructions: tooLong, enabled: true }))
      .rejects.toMatchObject(refusal);
    // Surrounding space is trimmed first, as on save.
    await writer.action(api.ai.styleAnalysis.analyzeMyInstructions, { text: ` ${"x".repeat(MAX_INSTRUCTIONS_CHARS)} ` });
    expect(providerMocks.create).toHaveBeenCalledTimes(1);
  });

  it("allows 20 checks an hour per user, then refuses with RATE_LIMITED; empty text spends nothing", async () => {
    const { writer, other } = await setup();
    await writer.action(api.ai.styleAnalysis.analyzeMyInstructions, { text: "   " });
    for (let i = 0; i < 20; i += 1) {
      await writer.action(api.ai.styleAnalysis.analyzeMyInstructions, { text: `Rule ${i}.` });
    }
    await expect(writer.action(api.ai.styleAnalysis.analyzeMyInstructions, { text: "One more." }))
      .rejects.toMatchObject({
        data: {
          code: "RATE_LIMITED",
          retryAfter: expect.any(Number),
          message: expect.stringMatching(/^You have started a lot of runs in the last hour\. Try again in \d+ minutes?\.$/),
        },
      });
    expect(providerMocks.create).toHaveBeenCalledTimes(20);
    await other.action(api.ai.styleAnalysis.analyzeMyInstructions, { text: "Another writer." });
    expect(providerMocks.create).toHaveBeenCalledTimes(21);
  });

  it("reuses stored coverage for the automatic check after a save that did not change the saved text", async () => {
    const { t, writer } = await setup();
    // Another tab already saved these words and checked them.
    await writer.mutation(api.writerProfiles.saveMyProfile, { customInstructions: "Short sentences.", enabled: true });
    await writer.action(api.ai.styleAnalysis.analyzeMyInstructions, { text: "Short sentences.", persist: true, auto: true });
    expect(providerMocks.create).toHaveBeenCalledTimes(1);
    const left = async () => await t.run(async (ctx) =>
      (await aiRateLimiter.getValue(ctx as unknown as MutationCtx, "styleAnalysisPerUser", {
        key: (await ctx.db.query("users").first())!._id,
      })).value);
    const afterFirst = await left();
    await writer.mutation(api.writerProfiles.saveMyProfile, { customInstructions: "Short sentences.", enabled: true });
    await expect(writer.action(api.ai.styleAnalysis.analyzeMyInstructions, {
      text: " Short sentences. ",
      persist: true,
      auto: true,
    })).resolves.toMatchObject({ reused: true, categories: analysis.categories });
    expect(providerMocks.create).toHaveBeenCalledTimes(1);
    expect(await left()).toBe(afterFirst);
    // "Check again" always runs and spends.
    await writer.action(api.ai.styleAnalysis.analyzeMyInstructions, { text: "Short sentences.", persist: true });
    expect(providerMocks.create).toHaveBeenCalledTimes(2);
    expect(await left()).toBeLessThan(afterFirst);
  });
});
