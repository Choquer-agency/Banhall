/// <reference types="vite/client" />
import agentTest from "@convex-dev/agent/test";
import { createThread, saveMessage } from "@convex-dev/agent";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, components } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// Security wave 1 (audit 2026-09-25, a2 P2-6): erasing a project deletes its
// chat threads in the agent component too (thread, messages, streams), not
// only the app's agentChatThreads rows. The writer's questions, highlighted
// report text and the model's answers go with the project.

async function setup() {
  const t = convexTest(schema, modules);
  agentTest.register(t);
  const ids = await t.run(async (ctx) => {
    const adminId = await ctx.db.insert("users", { authId: "ea-admin", role: "admin" });
    const now = Date.now();
    const project = {
      clientName: "Erasure Co",
      status: "draft" as const,
      createdBy: adminId,
      ownerId: adminId,
      createdAt: now,
      updatedAt: now,
    };
    const projectId = await ctx.db.insert("projects", { ...project, title: "Erased", shareToken: "ea-1" });
    const keptProjectId = await ctx.db.insert("projects", { ...project, title: "Kept", shareToken: "ea-2" });
    const threads: Record<"erased" | "kept", string> = { erased: "", kept: "" };
    for (const [key, id] of [["erased", projectId], ["kept", keptProjectId]] as const) {
      const reportId = await ctx.db.insert("reports", {
        projectId: id,
        content: JSON.stringify({ type: "doc", content: [] }),
        version: 1,
        generatedAt: now,
        updatedAt: now,
      });
      const threadId = await createThread(ctx, components.agent, { userId: adminId, title: key });
      await saveMessage(ctx, components.agent, {
        threadId,
        userId: adminId,
        message: { role: "user", content: `What did Priya Shah test? (${key})` },
      });
      await saveMessage(ctx, components.agent, {
        threadId,
        message: { role: "assistant", content: "She tested the alloy at low temperature." },
      });
      await ctx.db.insert("agentChatThreads", {
        projectId: id,
        reportId,
        agentThreadId: threadId,
        title: key,
        createdAt: now,
      });
      threads[key] = threadId;
    }
    return { projectId, threads };
  });
  return { t, ...ids, admin: t.withIdentity({ subject: "ea-admin" }) };
}

async function componentState(t: Awaited<ReturnType<typeof setup>>["t"], threadId: string) {
  return await t.run(async (ctx) => ({
    thread: await ctx.runQuery(components.agent.threads.getThread, { threadId }),
    messages: (
      await ctx.runQuery(components.agent.messages.listMessagesByThreadId, {
        threadId,
        order: "asc",
        paginationOpts: { numItems: 50, cursor: null },
      })
    ).page.length,
  }));
}

describe("project erasure and agent chat threads", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("deletes the erased project's component threads and messages, and only those", async () => {
    const f = await setup();
    expect(await componentState(f.t, f.threads.erased)).toMatchObject({ messages: 2 });

    await f.admin.mutation(api.projects.deleteProject, { projectId: f.projectId });
    await f.t.finishAllScheduledFunctions(() => vi.runAllTimers());

    expect(await f.t.run((ctx) => ctx.db.get(f.projectId))).toBeNull();
    expect(await componentState(f.t, f.threads.erased)).toEqual({ thread: null, messages: 0 });
    const kept = await componentState(f.t, f.threads.kept);
    expect(kept.thread).not.toBeNull();
    expect(kept.messages).toBe(2);
  });
});
