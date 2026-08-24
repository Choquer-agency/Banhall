/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const authId = "research-projection-user";

// getSessionDetails is the research panel's only data source. Raw provider
// failures ("gpt: <300 chars of provider text>") and provider identity are
// ops detail — neither crosses this query boundary (docs/product-domain.md:
// failure states use typed, user-safe errors).

async function setup(status: "failed" | "completed", errorMessage?: string) {
  const t = convexTest(schema, modules);
  const sessionId = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { authId, role: "writer" });
    const now = Date.now();
    const projectId = await ctx.db.insert("projects", {
      title: "Research projection",
      clientName: "Client",
      status: "review",
      createdBy: userId,
      shareToken: "research-projection-token",
      createdAt: now,
      updatedAt: now,
    });
    const reportId = await ctx.db.insert("reports", {
      projectId,
      content: JSON.stringify({ type: "doc", content: [] }),
      version: 1,
      generatedAt: now,
      updatedAt: now,
    });
    const sessionId = await ctx.db.insert("researchSessions", {
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
      status,
      errorMessage,
      createdAt: now,
      updatedAt: now,
      completedAt: now,
    });
    for (const [provider, runStatus] of [
      ["gpt", "failed"],
      ["perplexity", "completed"],
      ["reviewer", "failed"],
    ] as const) {
      await ctx.db.insert("researchRuns", {
        sessionId,
        projectId,
        provider,
        model: "test-model",
        status: runStatus,
        errorMessage: runStatus === "failed" ? "RAWSECRET provider text" : undefined,
        startedAt: now,
        completedAt: now,
      });
    }
    return sessionId;
  });
  return { t, sessionId };
}

describe("research session projections", () => {
  it("maps a failed session's stored provider error to typed user-safe copy", async () => {
    const { t, sessionId } = await setup(
      "failed",
      "gpt: RAWSECRET provider text; perplexity: RAWSECRET other text"
    );
    const details = await t
      .withIdentity({ subject: authId })
      .query(api.research.getSessionDetails, { sessionId });

    expect(details?.session.errorMessage).toBe(
      "Research did not complete. Try running it again."
    );
    const serialized = JSON.stringify(details);
    expect(serialized).not.toContain("RAWSECRET");
    expect(serialized).not.toContain("gpt");
    expect(serialized).not.toContain("perplexity");
  });

  it("ships runs as neutral kinds, not provider identities", async () => {
    const { t, sessionId } = await setup("completed");
    const details = await t
      .withIdentity({ subject: authId })
      .query(api.research.getSessionDetails, { sessionId });

    expect(details?.runs).toEqual([
      { kind: "search", status: "failed" },
      { kind: "search", status: "completed" },
      { kind: "reviewer", status: "failed" },
    ]);
    expect(details?.session.errorMessage).toBeNull();
  });
});
