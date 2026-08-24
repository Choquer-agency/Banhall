/// <reference types="vite/client" />
/**
 * Raw provider/gateway text stored on generation rows (for ops) must never
 * cross the writer-facing query boundaries. getIterativeState has coverage in
 * generationRecovery.test.ts; this file proves the SAME row projects safely
 * through getLatestGeneration too, with hostile gateway trash (HTML error
 * pages) in both the error field and the progress narration — and that
 * authored, colon-free copy still passes through verbatim.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const authId = "sanitization-boundary-user";

const RAW_ERROR = "unknown: <!DOCTYPE html><html><body>RAWSECRET gateway trash</body></html>";
const RAW_NARRATION = "✗ GPT-5.6 failed: unknown: RAWSECRET details";

async function seed(overrides: { error?: string; progressLog?: string[] }) {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { authId, role: "writer" });
    const now = Date.now();
    const projectId = await ctx.db.insert("projects", {
      title: "Sanitization project",
      clientName: "Client",
      status: "generating",
      createdBy: userId,
      shareToken: "sanitization-token",
      createdAt: now,
      updatedAt: now,
    });
    const transcriptId = await ctx.db.insert("transcripts", {
      projectId,
      content: "Interview content",
      createdAt: now,
    });
    const generationId = await ctx.db.insert("generations", {
      projectId,
      transcriptId,
      status: "failed",
      candidateMode: "iterative",
      startedAt: now,
      ...overrides,
    });
    return { projectId, generationId };
  });
  return { t, ...ids, actor: t.withIdentity({ subject: authId }) };
}

describe("generation error/narration sanitization at the query boundary", () => {
  it("getLatestGeneration ships no gateway trash from error or progressLog", async () => {
    const { actor, projectId } = await seed({
      error: RAW_ERROR,
      progressLog: ["Section-by-section drafting with Sonnet 5.", RAW_NARRATION],
    });

    const latest = await actor.query(api.generations.getLatestGeneration, {
      projectId,
    });

    expect(latest?.error).toBe("The generation did not complete. Try again.");
    expect(latest?.progressLog).toEqual([
      "Section-by-section drafting with Sonnet 5.",
      "✗ GPT-5.6 failed.",
    ]);
    const serialized = JSON.stringify(latest);
    expect(serialized).not.toContain("RAWSECRET");
    expect(serialized).not.toContain("<!DOCTYPE");
    expect(serialized).not.toContain("unknown:");
  });

  it("getIterativeState ships no gateway trash from the same row", async () => {
    const { actor, generationId } = await seed({
      error: RAW_ERROR,
      progressLog: ["Section-by-section drafting with Sonnet 5.", RAW_NARRATION],
    });

    const state = await actor.query(api.generations.getIterativeState, {
      generationId,
    });

    expect(state?.error).toBe("The generation did not complete. Try again.");
    expect(state?.progressLog).toEqual([
      "Section-by-section drafting with Sonnet 5.",
      "✗ GPT-5.6 failed.",
    ]);
    const serialized = JSON.stringify(state);
    expect(serialized).not.toContain("RAWSECRET");
    expect(serialized).not.toContain("<!DOCTYPE");
    expect(serialized).not.toContain("unknown:");
  });

  it("authored colon-free error copy passes through verbatim", async () => {
    const { actor, projectId, generationId } = await seed({
      error: "Timed out before the draft completed.",
      progressLog: ["Assembling the report."],
    });

    const latest = await actor.query(api.generations.getLatestGeneration, {
      projectId,
    });
    expect(latest?.error).toBe("Timed out before the draft completed.");
    expect(latest?.progressLog).toEqual(["Assembling the report."]);

    const state = await actor.query(api.generations.getIterativeState, {
      generationId,
    });
    expect(state?.error).toBe("Timed out before the draft completed.");
  });
});
