/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildStyleAnalysisPrompt,
  styleAnalysisSchema,
} from "./styleAnalysis";
import { STYLE_OVERRIDE_KEYS } from "../../shared/styleOverrides";
import { MAX_INSTRUCTIONS_CHARS } from "../../shared/writerProfileLimits";
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

  it("refuses text over the Settings limit (75,000 characters) before any call", async () => {
    const { writer } = await setup();
    await expect(writer.action(api.ai.styleAnalysis.analyzeMyInstructions, { text: "x".repeat(MAX_INSTRUCTIONS_CHARS + 1) }))
      .rejects.toMatchObject({
        data: { code: "INVALID_INPUT", message: "Writing preferences are limited to 75,000 characters." },
      });
    // Surrounding space is trimmed first, as on save.
    await writer.action(api.ai.styleAnalysis.analyzeMyInstructions, { text: ` ${"x".repeat(MAX_INSTRUCTIONS_CHARS)} ` });
    expect(providerMocks.create).toHaveBeenCalledTimes(1);
  });

  it("allows 10 checks an hour per user, then refuses with RATE_LIMITED; empty text spends nothing", async () => {
    const { writer, other } = await setup();
    await writer.action(api.ai.styleAnalysis.analyzeMyInstructions, { text: "   " });
    for (let i = 0; i < 10; i += 1) {
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
    expect(providerMocks.create).toHaveBeenCalledTimes(10);
    await other.action(api.ai.styleAnalysis.analyzeMyInstructions, { text: "Another writer." });
    expect(providerMocks.create).toHaveBeenCalledTimes(11);
  });
});
