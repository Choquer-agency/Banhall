/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// Security wave 1 (audit 2026-09-25, a2 P2-7): raw provider errors never
// reach the history list, and pipeline internals (the full agentOutputs,
// prompt version, learned-guidance ids, cost) are for admins only. Writers
// keep what the project page shows: QA scores and the chronology table.

const OUTPUTS = {
  qa: { overall: 7 },
  chronology: [{ date: "2025-01", activity: "Trial" }],
  analysis: "Internal analyzer notes naming Priya Shah",
  brief: "Internal Brief",
};

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const writerId = await ctx.db.insert("users", { authId: "gi-writer", role: "writer" });
    await ctx.db.insert("users", { authId: "gi-manager", role: "manager" });
    await ctx.db.insert("users", { authId: "gi-admin", role: "admin" });
    const projectId = await ctx.db.insert("projects", {
      title: "Internals",
      clientName: "Acme",
      status: "review",
      createdBy: writerId,
      ownerId: writerId,
      shareToken: "gi-token",
      createdAt: now,
      updatedAt: now,
    });
    const failedId = await ctx.db.insert("generations", {
      projectId,
      status: "failed",
      error: "unknown: 529 overloaded_error {\"request_id\":\"req_secret_123\"}",
      startedAt: now - 10,
      completedAt: now - 5,
    });
    const generationId = await ctx.db.insert("generations", {
      projectId,
      status: "completed",
      promptVersion: "prompt-v-1",
      learningDigestIds: [],
      agentOutputs: JSON.stringify(OUTPUTS),
      startedAt: now,
      completedAt: now,
    });
    await ctx.db.insert("aiUsage", {
      generationId,
      callSite: "generation:analyzer",
      model: "claude-sonnet-5",
      inputTokens: 10,
      outputTokens: 2,
      costUsd: 1.5,
      createdAt: now,
    });
    return { projectId, failedId, generationId };
  });
  return {
    t,
    ...ids,
    writer: t.withIdentity({ subject: "gi-writer" }),
    manager: t.withIdentity({ subject: "gi-manager" }),
    admin: t.withIdentity({ subject: "gi-admin" }),
  };
}

describe("listGenerations", () => {
  it("shows a stored provider error only as user-safe copy", async () => {
    const f = await setup();
    const history = await f.writer.query(api.generations.listGenerations, { projectId: f.projectId });
    const failed = history.find((row) => row._id === f.failedId);
    expect(failed?.error).toBeTruthy();
    expect(JSON.stringify(history)).not.toContain("req_secret_123");
    expect(JSON.stringify(history)).not.toContain("overloaded_error");
  });
});

describe("generation internals", () => {
  it("gives writers and managers only the QA and chronology outputs, and no cost or provenance", async () => {
    const f = await setup();
    for (const reader of [f.writer, f.manager]) {
      const exact = await reader.query(api.generations.getGeneration, { generationId: f.generationId });
      expect(exact?.cost).toBeNull();
      expect(exact?.promptVersion).toBeNull();
      expect(exact?.learningDigestIds).toBeNull();
      expect(JSON.parse(exact?.agentOutputs ?? "null")).toEqual({
        qa: OUTPUTS.qa,
        chronology: OUTPUTS.chronology,
      });
      const latest = await reader.query(api.generations.getLatestGeneration, { projectId: f.projectId });
      expect(JSON.parse(latest?.agentOutputs ?? "null")).toEqual({
        qa: OUTPUTS.qa,
        chronology: OUTPUTS.chronology,
      });
    }
  });

  it("gives admins the full record", async () => {
    const f = await setup();
    const exact = await f.admin.query(api.generations.getGeneration, { generationId: f.generationId });
    expect(exact?.cost).toBe(1.5);
    expect(exact?.promptVersion).toBe("prompt-v-1");
    expect(exact?.learningDigestIds).toEqual([]);
    expect(JSON.parse(exact?.agentOutputs ?? "null")).toEqual(OUTPUTS);
  });
});
