/// <reference types="vite/client" />
/**
 * Completes the getChatContextV2 grounding matrix from chatContext.test.ts:
 * a report LINKED to a generation that stored no agentOutputs must fall back
 * to the newest completed generation that has outputs, instead of grounding
 * the chat on nothing.
 */
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("getChatContextV2 grounding — linked generation without outputs", () => {
  test("falls back to the newest completed generation with agentOutputs", async () => {
    const t = convexTest(schema, modules);
    const { projectId, transcriptId } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        authId: "chat-context-fallback-user",
        role: "writer",
      });
      const now = Date.now();
      const projectId = await ctx.db.insert("projects", {
        title: "Fallback grounding project",
        clientName: "Client",
        status: "review",
        createdBy: userId,
        shareToken: "chat-context-fallback-token",
        createdAt: now,
        updatedAt: now,
      });
      const transcriptId = await ctx.db.insert("transcripts", {
        projectId,
        content: "Interview content",
        createdAt: now,
      });
      return { projectId, transcriptId };
    });

    // Older completed generation with usable outputs — the fallback target.
    await t.run(async (ctx) =>
      ctx.db.insert("generations", {
        projectId,
        transcriptId,
        status: "completed",
        agentOutputs: JSON.stringify({ analyzer: "FALLBACK-ANALYSIS" }),
        startedAt: Date.now(),
      })
    );
    // The report's own generation completed but stored no agentOutputs
    // (legacy row / stripped outputs).
    const linkedGenerationId = await t.run(async (ctx) =>
      ctx.db.insert("generations", {
        projectId,
        transcriptId,
        status: "completed",
        startedAt: Date.now(),
      })
    );
    const reportId = await t.run(async (ctx) =>
      ctx.db.insert("reports", {
        projectId,
        generationId: linkedGenerationId,
        content: JSON.stringify({ type: "doc", content: [] }),
        version: 1,
        generatedAt: Date.now(),
        updatedAt: Date.now(),
      })
    );

    const context = await t.query(internal.chatV2.getChatContextV2, {
      reportId,
      agentThreadId: "thread-linked-fallback",
    });
    expect(context.agentOutputs).toContain("FALLBACK-ANALYSIS");
  });
});
