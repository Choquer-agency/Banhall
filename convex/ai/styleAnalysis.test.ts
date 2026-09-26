/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildStyleAnalysisPrompt,
  styleAnalysisSchema,
} from "./styleAnalysis";
import { STYLE_OVERRIDE_KEYS } from "../../shared/styleOverrides";
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
