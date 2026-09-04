/// <reference types="vite/client" />
import agentTest from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, components, internal } from "./_generated/api";
import schema from "./schema";
import {
  CHAT_CONTEXT_OPTIONS,
  reportChatAgent,
} from "./ai/chatAgentV2";
import type { ModelMessage } from "ai";
import { CHAT_EVIDENCE_GUIDANCE } from "./ai/prompts";

const modules = import.meta.glob("./**/*.ts");
const authId = "auth-chat-turns";

function createTest() {
  const t = convexTest(schema, modules);
  agentTest.register(t);
  return t;
}

async function setup() {
  const t = createTest();
  const { projectId, reportId, userId } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      authId,
      role: "writer",
    });
    await ctx.db.insert("users", {
      authId: `${authId}-roleless`,
    });
    const now = Date.now();
    const projectId = await ctx.db.insert("projects", {
      title: "Chat timing project",
      clientName: "Client",
      status: "review",
      createdBy: userId,
      shareToken: "chat-timing-token",
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
    return { projectId, reportId, userId };
  });
  return {
    t,
    userId,
    projectId,
    reportId,
    actor: t.withIdentity({ subject: authId }),
    rolelessActor: t.withIdentity({ subject: `${authId}-roleless` }),
  };
}

async function sendQueuedTurn(setupResult: Awaited<ReturnType<typeof setup>>) {
  const result = await setupResult.actor.mutation(api.chatV2.sendMessage, {
    reportId: setupResult.reportId,
    content: "Help revise this report.",
    newThread: true,
  });
  const turn = await setupResult.t.run(async (ctx) =>
    await ctx.db
      .query("chatTurns")
      .withIndex("by_agentThreadId_and_promptMessageId", (q) =>
        q
          .eq("agentThreadId", result.threadId)
          .eq("promptMessageId", result.messageId)
      )
      .unique()
  );
  if (!turn) throw new Error("queued turn missing");
  return { result, turn };
}

async function insertTurn(
  t: ReturnType<typeof createTest>,
  values: {
    agentThreadId: string;
    promptMessageId: string;
    order: number;
    status: "queued" | "running" | "completed" | "failed" | "aborted";
    startedAt?: number;
    endedAt?: number;
    stepCount?: number;
  }
) {
  return await t.run(async (ctx) =>
    await ctx.db.insert("chatTurns", {
      ...values,
      stepCount: values.stepCount ?? 0,
    })
  );
}

async function insertMappedThread(
  setupResult: Awaited<ReturnType<typeof setup>>,
  threadId: string
) {
  return await setupResult.t.run(async (ctx) =>
    ctx.db.insert("agentChatThreads", {
      projectId: setupResult.projectId,
      reportId: setupResult.reportId,
      agentThreadId: threadId,
      title: "Windowed chat",
      createdAt: Date.now(),
    })
  );
}

async function insertProposal(
  setupResult: Awaited<ReturnType<typeof setup>>,
  values: {
    agentThreadId: string;
    promptMessageId?: string;
    toolCallId: string;
  }
) {
  return await setupResult.t.run(async (ctx) =>
    ctx.db.insert("chatProposals", {
      agentThreadId: values.agentThreadId,
      promptMessageId: values.promptMessageId,
      toolCallId: values.toolCallId,
      projectId: setupResult.projectId,
      reportId: setupResult.reportId,
      kind: "references",
      references: [values.toolCallId],
      state: "applied",
      createdAt: Date.now(),
    })
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-25T12:00:00.000Z"));
  vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("bounded chat context", () => {
  test("keeps the newest 30 non-tool messages without a provider call", async () => {
    const t = createTest();
    const userId = "context-window-user";
    const { threadId } = await t.run(async (ctx) =>
      reportChatAgent.createThread(ctx, { userId })
    );
    // Five tool-classified rows of both flavours (assistant tool-call and
    // tool result) among alternating user and assistant text rows.
    let toolRows = 0;
    const messages: ModelMessage[] = Array.from({ length: 35 }, (_, index) => {
      if ((index + 1) % 7 === 0) {
        toolRows += 1;
        if (toolRows % 2 === 0) {
          return {
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId: `context-tool-${index - 7}`,
                toolName: "searchBrain",
                output: { type: "text", value: `result ${index}` },
              },
            ],
          } satisfies ModelMessage;
        }
        return {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: `context-tool-${index}`,
              toolName: "searchBrain",
              input: { query: `context ${index}` },
            },
          ],
        } satisfies ModelMessage;
      }
      if (index % 2 === 1) {
        return {
          role: "assistant",
          content: `Assistant reply ${index}`,
        } satisfies ModelMessage;
      }
      return {
        role: "user",
        content: `Context message ${index}`,
      } satisfies ModelMessage;
    });

    const stored = await t.run(async (ctx) =>
      reportChatAgent.saveMessages(ctx, {
        threadId,
        userId,
        messages,
        skipEmbeddings: true,
      })
    );
    expect(stored.messages).toHaveLength(35);
    expect(stored.messages.filter((message) => message.tool)).toHaveLength(5);
    expect(CHAT_CONTEXT_OPTIONS).toEqual({
      recentMessages: 30,
      excludeToolMessages: true,
    });
    expect(Object.isFrozen(CHAT_CONTEXT_OPTIONS)).toBe(true);

    const contextAtLimit = await t.run(async (ctx) =>
      reportChatAgent.fetchContextMessages(ctx, {
        userId,
        threadId,
        contextOptions: CHAT_CONTEXT_OPTIONS,
      })
    );
    expect(contextAtLimit).toHaveLength(30);
    expect(contextAtLimit.every((message) => !message.tool)).toBe(true);

    const oldestNonTool = stored.messages.find((message) => !message.tool);
    if (!oldestNonTool) throw new Error("oldest non-tool message missing");
    const newest = await t.run(async (ctx) =>
      reportChatAgent.saveMessages(ctx, {
        threadId,
        userId,
        messages: [{ role: "user", content: "Newest context message" }],
        skipEmbeddings: true,
      })
    );
    const newestMessage = newest.messages[0];
    if (!newestMessage) throw new Error("newest message missing");

    const boundedContext = await t.run(async (ctx) =>
      reportChatAgent.fetchContextMessages(ctx, {
        userId,
        threadId,
        contextOptions: CHAT_CONTEXT_OPTIONS,
      })
    );
    expect(boundedContext).toHaveLength(30);
    expect(boundedContext.every((message) => !message.tool)).toBe(true);
    expect(
      boundedContext.some((message) => message._id === newestMessage._id)
    ).toBe(true);
    expect(
      boundedContext.some((message) => message._id === oldestNonTool._id)
    ).toBe(false);
  });

  test("streamChatReply passes the exact context options beside saveStreamDeltas", async () => {
    const setupResult = await setup();
    const { result, turn } = await sendQueuedTurn(setupResult);
    // Restored by afterEach; restoring earlier would clear the call record.
    const streamText = vi
      .spyOn(reportChatAgent, "streamText")
      .mockResolvedValue({
        consumeStream: async () => {},
      } as unknown as Awaited<ReturnType<typeof reportChatAgent.streamText>>);
    await setupResult.t.action(internal.ai.chatAgentV2.streamChatReply, {
      agentThreadId: result.threadId,
      promptMessageId: result.messageId,
      reportId: setupResult.reportId,
    });

    expect(streamText).toHaveBeenCalledTimes(1);
    const call = streamText.mock.calls[0];
    if (!call) throw new Error("streamText call missing");
    expect(call[1]).toEqual({ threadId: result.threadId });
    expect(call[2]).toMatchObject({ promptMessageId: result.messageId });
    expect(call[3]).toEqual({
      saveStreamDeltas: true,
      contextOptions: CHAT_CONTEXT_OPTIONS,
    });
    expect(call[3]?.contextOptions).toBe(CHAT_CONTEXT_OPTIONS);

    const finished = await setupResult.t.run(async (ctx) => ctx.db.get(turn._id));
    expect(finished?.status).toBe("completed");
  });

  /**
   * Story 4 (CAP-4): the boundary is a property of the request the action
   * actually issues, so it is asserted on the real payload. Source scanning
   * cannot see that `getChatContextV2` stopped returning `evidenceBudget` or a
   * document's `category`/`uploaderRole`: all three are optional, so the
   * builder would silently fall back to defaults and client trust with every
   * other test still green.
   */
  test("streamChatReply sends evidence in the user message and never in the system prompt", async () => {
    const setupResult = await setup();
    const reportBody = "The reactor seal failed at 400 kPa during cycle 12.";
    const analyzerFinding = "ANALYZER-JSON-FINDING";
    const documentBody = "NOTES-DOCUMENT-BODY";
    await setupResult.t.run(async (ctx) => {
      await ctx.db.patch(setupResult.reportId, {
        content: JSON.stringify({
          type: "doc",
          content: [
            { type: "paragraph", content: [{ type: "text", text: reportBody }] },
          ],
        }),
      });
      const transcriptId = await ctx.db.insert("transcripts", {
        projectId: setupResult.projectId,
        content: "Interview content",
        createdAt: Date.now(),
      });
      await ctx.db.insert("generations", {
        projectId: setupResult.projectId,
        transcriptId,
        status: "completed",
        agentOutputs: JSON.stringify({ analyzer: { finding: analyzerFinding } }),
        startedAt: Date.now(),
      });
      await ctx.db.insert("projectDocuments", {
        projectId: setupResult.projectId,
        fileName: "notes.md",
        fileType: "md",
        content: documentBody,
        category: "writer_notes",
        uploaderRole: "writer",
        source: "upload",
        uploadedBy: authId,
        createdAt: Date.now(),
      });
    });
    const { result, turn } = await sendQueuedTurn(setupResult);
    const decisionTarget = "PRIOR-DECISION-TARGET";
    await setupResult.t.run(async (ctx) => {
      await ctx.db.insert("chatProposals", {
        agentThreadId: result.threadId,
        toolCallId: "call-prior",
        projectId: setupResult.projectId,
        reportId: setupResult.reportId,
        kind: "edit",
        targetText: decisionTarget,
        newText: "PRIOR-DECISION-CANDIDATE",
        state: "rejected",
        createdAt: Date.now(),
      });
    });

    const streamText = vi
      .spyOn(reportChatAgent, "streamText")
      .mockResolvedValue({
        consumeStream: async () => {},
      } as unknown as Awaited<ReturnType<typeof reportChatAgent.streamText>>);
    await setupResult.t.action(internal.ai.chatAgentV2.streamChatReply, {
      agentThreadId: result.threadId,
      promptMessageId: result.messageId,
      reportId: setupResult.reportId,
    });

    const call = streamText.mock.calls[0];
    if (!call) throw new Error("streamText call missing");
    const system = String(call[2]?.system ?? "");
    const messages = call[2]?.messages ?? [];
    expect(messages).toHaveLength(1);
    const evidence = String(
      (messages[0] as { role: string; content: unknown }).content
    );
    expect((messages[0] as { role: string }).role).toBe("user");

    // Not one byte of client evidence carries system authority.
    for (const secret of [reportBody, analyzerFinding, documentBody, decisionTarget]) {
      expect(system).not.toContain(secret);
      expect(evidence).toContain(secret);
    }
    // The report arrives inside its own markers, under the guidance.
    expect(evidence).toContain(CHAT_EVIDENCE_GUIDANCE);
    const open = evidence.indexOf("--- BEGIN [CURRENT REPORT] ---");
    const close = evidence.indexOf("--- END [CURRENT REPORT] ---");
    expect(open).toBeGreaterThan(-1);
    expect(evidence.indexOf(reportBody)).toBeGreaterThan(open);
    expect(evidence.indexOf(reportBody)).toBeLessThan(close);
    // The document's stored provenance reached the marker line.
    expect(evidence).toContain(
      "--- BEGIN [WRITER'S NOTES (unreliable narrator)] notes.md ---"
    );

    const finished = await setupResult.t.run(async (ctx) => ctx.db.get(turn._id));
    expect(finished?.status).toBe("completed");
  });

  test("streamChatReply applies the evidence budget the query resolved", async () => {
    const setupResult = await setup();
    await setupResult.t.run(async (ctx) => {
      const adminId = await ctx.db.insert("users", {
        authId: `${authId}-budget-admin`,
        role: "admin",
      });
      // One document allowed; the second must never reach the provider.
      await ctx.db.insert("appSettings", {
        key: "ai.chatMaxEvidenceDocuments",
        value: "1",
        updatedBy: adminId,
        updatedAt: Date.now(),
      });
      for (const name of ["first.md", "second.md"]) {
        await ctx.db.insert("projectDocuments", {
          projectId: setupResult.projectId,
          fileName: name,
          fileType: "md",
          content: `Body of ${name}`,
          category: "other",
          source: "upload",
          uploadedBy: authId,
          createdAt: Date.now(),
        });
      }
    });
    const { result } = await sendQueuedTurn(setupResult);

    const streamText = vi
      .spyOn(reportChatAgent, "streamText")
      .mockResolvedValue({
        consumeStream: async () => {},
      } as unknown as Awaited<ReturnType<typeof reportChatAgent.streamText>>);
    // Captured, not silenced: the line is the story's only operator signal.
    const infoLines: string[] = [];
    const info = vi
      .spyOn(console, "info")
      .mockImplementation((...parts: unknown[]) => {
        infoLines.push(parts.map(String).join(" "));
      });
    try {
      await setupResult.t.action(internal.ai.chatAgentV2.streamChatReply, {
        agentThreadId: result.threadId,
        promptMessageId: result.messageId,
        reportId: setupResult.reportId,
      });
    } finally {
      info.mockRestore();
    }

    const call = streamText.mock.calls[0];
    if (!call) throw new Error("streamText call missing");
    const evidence = String(
      (call[2]?.messages?.[0] as { content: unknown }).content
    );
    expect(evidence).toContain("first.md");
    expect(evidence).not.toContain("Body of second.md");
    expect(evidence.match(/--- BEGIN \[OTHER SUPPORTING MATERIAL\]/g)).toHaveLength(1);
    // The dropped document is named in the message and in the cut log, so a
    // budget gap never reads as an interview gap.
    expect(evidence).toContain(
      "[1 further attached document(s) were omitted to fit the context budget.]"
    );
    const cutLine = infoLines.find((line) =>
      line.startsWith(`chat evidence ${result.threadId}`)
    );
    expect(cutLine).toBeDefined();
    expect(cutLine).toContain(setupResult.reportId);
    expect(cutLine).toContain("left out second.md");
  });

  test("streamChatReply keeps the sender's style preferences in the system prompt", async () => {
    const setupResult = await setup();
    const preferences = "PREFER-FIRST-PERSON-PLURAL";
    const userId = await setupResult.t.run(async (ctx) => {
      const user = await ctx.db
        .query("users")
        .withIndex("by_authId", (q) => q.eq("authId", authId))
        .unique();
      if (!user) throw new Error("writer missing");
      await ctx.db.insert("writerProfiles", {
        userId: user._id,
        customInstructions: preferences,
        enabled: true,
        styleOverrides: { bannedWords: true },
        updatedBy: user._id,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      return user._id;
    });
    const { result } = await sendQueuedTurn(setupResult);

    const streamText = vi
      .spyOn(reportChatAgent, "streamText")
      .mockResolvedValue({
        consumeStream: async () => {},
      } as unknown as Awaited<ReturnType<typeof reportChatAgent.streamText>>);
    await setupResult.t.action(internal.ai.chatAgentV2.streamChatReply, {
      agentThreadId: result.threadId,
      promptMessageId: result.messageId,
      reportId: setupResult.reportId,
      userId,
    });

    const call = streamText.mock.calls[0];
    if (!call) throw new Error("streamText call missing");
    const system = String(call[2]?.system ?? "");
    const evidence = String(
      (call[2]?.messages?.[0] as { content: unknown }).content
    );
    // The waiver footer points at these preferences; the action must forward
    // them so the reference is never dangling, and they are the writer's own
    // direction, so they stay out of the evidence message.
    expect(system).toContain("WRITER'S PERSONAL STYLE PREFERENCES");
    expect(system).toContain(preferences);
    expect(evidence).not.toContain(preferences);
  });
});

describe("chat turn lifecycle", () => {
  test("sendMessage inserts the queued shape addressable through both indexes", async () => {
    const setupResult = await setup();
    const { result, turn } = await sendQueuedTurn(setupResult);

    expect(result).toEqual({
      threadId: result.threadId,
      messageId: result.messageId,
    });
    expect(turn).toMatchObject({
      agentThreadId: result.threadId,
      promptMessageId: result.messageId,
      order: expect.any(Number),
      status: "queued",
      stepCount: 0,
    });
    expect(turn).not.toHaveProperty("startedAt");
    expect(turn).not.toHaveProperty("endedAt");

    const byOrder = await setupResult.t.run(async (ctx) =>
      await ctx.db
        .query("chatTurns")
        .withIndex("by_agentThreadId_and_order", (q) =>
          q
            .eq("agentThreadId", result.threadId)
            .eq("order", turn.order)
        )
        .unique()
    );
    expect(byOrder?._id).toBe(turn._id);
  });

  test("transitions queued to running to completed", async () => {
    const { t } = await setup();
    await insertTurn(t, {
      agentThreadId: "thread-lifecycle",
      promptMessageId: "prompt-lifecycle",
      order: 1,
      status: "queued",
    });

    await expect(
      t.mutation(internal.chatV2.markTurnStarted, {
        agentThreadId: "thread-lifecycle",
        promptMessageId: "prompt-lifecycle",
        startedAt: 1_000,
      })
    ).resolves.toEqual({ shouldRun: true, status: "running" });
    await expect(
      t.mutation(internal.chatV2.finishTurn, {
        agentThreadId: "thread-lifecycle",
        promptMessageId: "prompt-lifecycle",
        requestedStatus: "completed",
        endedAt: 4_000,
        stepCount: 3,
      })
    ).resolves.toEqual({ status: "completed" });

    const turn = await t.run(async (ctx) =>
      await ctx.db
        .query("chatTurns")
        .withIndex("by_agentThreadId_and_promptMessageId", (q) =>
          q
            .eq("agentThreadId", "thread-lifecycle")
            .eq("promptMessageId", "prompt-lifecycle")
        )
        .unique()
    );
    expect(turn).toMatchObject({
      status: "completed",
      startedAt: 1_000,
      endedAt: 4_000,
      stepCount: 3,
    });
  });

  test("repeated starts and finishes are idempotent", async () => {
    const { t } = await setup();
    await insertTurn(t, {
      agentThreadId: "thread-idempotent",
      promptMessageId: "prompt-idempotent",
      order: 2,
      status: "queued",
    });

    await t.mutation(internal.chatV2.markTurnStarted, {
      agentThreadId: "thread-idempotent",
      promptMessageId: "prompt-idempotent",
      startedAt: 1_000,
    });
    await expect(
      t.mutation(internal.chatV2.markTurnStarted, {
        agentThreadId: "thread-idempotent",
        promptMessageId: "prompt-idempotent",
        startedAt: 2_000,
      })
    ).resolves.toEqual({ shouldRun: true, status: "running" });
    await t.mutation(internal.chatV2.finishTurn, {
      agentThreadId: "thread-idempotent",
      promptMessageId: "prompt-idempotent",
      requestedStatus: "completed",
      endedAt: 4_000,
      stepCount: 2,
    });
    await expect(
      t.mutation(internal.chatV2.finishTurn, {
        agentThreadId: "thread-idempotent",
        promptMessageId: "prompt-idempotent",
        requestedStatus: "failed",
        endedAt: 9_000,
        stepCount: 8,
      })
    ).resolves.toEqual({ status: "completed" });
    await expect(
      t.mutation(internal.chatV2.markTurnStarted, {
        agentThreadId: "thread-idempotent",
        promptMessageId: "prompt-idempotent",
        startedAt: 10_000,
      })
    ).resolves.toEqual({ shouldRun: false, status: "completed" });

    const turn = await t.run(async (ctx) =>
      await ctx.db
        .query("chatTurns")
        .withIndex("by_agentThreadId_and_promptMessageId", (q) =>
          q
            .eq("agentThreadId", "thread-idempotent")
            .eq("promptMessageId", "prompt-idempotent")
        )
        .unique()
    );
    expect(turn).toMatchObject({
      status: "completed",
      startedAt: 1_000,
      endedAt: 4_000,
      stepCount: 2,
    });
  });

  test("finalizes a failed turn with a normalized step count", async () => {
    const { t } = await setup();
    await insertTurn(t, {
      agentThreadId: "thread-failed",
      promptMessageId: "prompt-failed",
      order: 3,
      status: "running",
      startedAt: 1_000,
    });

    await expect(
      t.mutation(internal.chatV2.finishTurn, {
        agentThreadId: "thread-failed",
        promptMessageId: "prompt-failed",
        requestedStatus: "failed",
        endedAt: 2_000,
        stepCount: 2.9,
      })
    ).resolves.toEqual({ status: "failed" });

    const turn = await t.run(async (ctx) =>
      await ctx.db
        .query("chatTurns")
        .withIndex("by_agentThreadId_and_promptMessageId", (q) =>
          q
            .eq("agentThreadId", "thread-failed")
            .eq("promptMessageId", "prompt-failed")
        )
        .unique()
    );
    expect(turn).toMatchObject({
      status: "failed",
      startedAt: 1_000,
      endedAt: 2_000,
      stepCount: 2,
    });
  });

  test("an abort before start fences the scheduled action", async () => {
    const setupResult = await setup();
    const { result, turn } = await sendQueuedTurn(setupResult);

    await expect(
      setupResult.actor.mutation(api.chatV2.abortStreaming, {
        threadId: result.threadId,
        order: turn.order,
      })
    ).resolves.toBe(true);
    await expect(
      setupResult.t.mutation(internal.chatV2.markTurnStarted, {
        agentThreadId: result.threadId,
        promptMessageId: result.messageId,
        startedAt: Date.now() + 1_000,
      })
    ).resolves.toEqual({ shouldRun: false, status: "aborted" });
  });

  test("an abort after start fences the action before it streams", async () => {
    const setupResult = await setup();
    const { result, turn } = await sendQueuedTurn(setupResult);

    await setupResult.t.mutation(internal.chatV2.markTurnStarted, {
      agentThreadId: result.threadId,
      promptMessageId: result.messageId,
      startedAt: Date.now(),
    });
    // Still active while the action loads report context.
    await expect(
      setupResult.t.query(internal.chatV2.isTurnActive, {
        agentThreadId: result.threadId,
        promptMessageId: result.messageId,
      })
    ).resolves.toBe(true);

    await setupResult.actor.mutation(api.chatV2.abortStreaming, {
      threadId: result.threadId,
      order: turn.order,
    });

    // The pre-stream fence must now stop it generating text or proposals.
    await expect(
      setupResult.t.query(internal.chatV2.isTurnActive, {
        agentThreadId: result.threadId,
        promptMessageId: result.messageId,
      })
    ).resolves.toBe(false);
  });

  test("a stopped turn cannot still create a proposal card", async () => {
    const setupResult = await setup();
    const { result, turn } = await sendQueuedTurn(setupResult);

    await setupResult.t.mutation(internal.chatV2.markTurnStarted, {
      agentThreadId: result.threadId,
      promptMessageId: result.messageId,
      startedAt: Date.now(),
    });

    // A tool call that wins the race against stop must still be refused: a
    // card appearing after the writer stopped the reply is the visible harm.
    await setupResult.actor.mutation(api.chatV2.abortStreaming, {
      threadId: result.threadId,
      order: turn.order,
    });

    await expect(
      setupResult.t.mutation(internal.chatV2.saveProposal, {
        agentThreadId: result.threadId,
        toolCallId: "call-after-stop",
        promptMessageId: result.messageId,
        kind: "references",
        references: ["anything"],
      })
    ).resolves.toEqual({
      ok: false,
      stopped: true,
      reason: "The writer stopped this reply.",
    });

    const proposals = await setupResult.t.run(async (ctx) =>
      ctx.db.query("chatProposals").collect()
    );
    expect(proposals).toHaveLength(0);

    // Control: the identical call on a live turn succeeds, proving the stop
    // fence refused it — not some unrelated downstream validation. The report
    // needs real text for the reference to resolve against.
    await setupResult.t.run(async (ctx) => {
      await ctx.db.patch(setupResult.reportId, {
        content: JSON.stringify({
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "A findable passage." }],
            },
          ],
        }),
      });
    });
    const live = await sendQueuedTurn(setupResult);
    await expect(
      setupResult.t.mutation(internal.chatV2.saveProposal, {
        agentThreadId: live.result.threadId,
        toolCallId: "call-while-live",
        promptMessageId: live.result.messageId,
        kind: "references",
        references: ["A findable passage."],
      })
    ).resolves.toMatchObject({ ok: true });
  });

  test("a turn with no metadata row is allowed to run", async () => {
    const setupResult = await setup();
    const { result } = await sendQueuedTurn(setupResult);

    await expect(
      setupResult.t.query(internal.chatV2.isTurnActive, {
        agentThreadId: result.threadId,
        promptMessageId: "message-from-before-chatTurns",
      })
    ).resolves.toBe(true);
  });

  test.each(["completed", "failed"] as const)(
    "an abort while running wins over later %s finalization",
    async (requestedStatus) => {
      const setupResult = await setup();
      const { result, turn } = await sendQueuedTurn(setupResult);
      await setupResult.t.mutation(internal.chatV2.markTurnStarted, {
        agentThreadId: result.threadId,
        promptMessageId: result.messageId,
        startedAt: Date.now(),
      });

      await expect(
        setupResult.actor.mutation(api.chatV2.abortStreaming, {
          threadId: result.threadId,
          order: turn.order,
        })
      ).resolves.toBe(true);
      await expect(
        setupResult.t.mutation(internal.chatV2.finishTurn, {
          agentThreadId: result.threadId,
          promptMessageId: result.messageId,
          requestedStatus,
          endedAt: Date.now() + 5_000,
          stepCount: 1,
        })
      ).resolves.toEqual({ status: "aborted" });

      const stored = await setupResult.t.run(async (ctx) =>
        await ctx.db
          .query("chatTurns")
          .withIndex("by_agentThreadId_and_promptMessageId", (q) =>
            q
              .eq("agentThreadId", result.threadId)
              .eq("promptMessageId", result.messageId)
          )
          .unique()
      );
      expect(stored?.status).toBe("aborted");
    }
  );

  test("late finalization can raise an aborted step count without moving its end", async () => {
    const setupResult = await setup();
    const { result, turn } = await sendQueuedTurn(setupResult);
    await setupResult.t.mutation(internal.chatV2.markTurnStarted, {
      agentThreadId: result.threadId,
      promptMessageId: result.messageId,
      startedAt: Date.now(),
    });
    await setupResult.actor.mutation(api.chatV2.abortStreaming, {
      threadId: result.threadId,
      order: turn.order,
    });
    const aborted = await setupResult.t.run(async (ctx) =>
      await ctx.db.get(turn._id)
    );
    if (!aborted?.endedAt) throw new Error("abort end time missing");

    await setupResult.t.mutation(internal.chatV2.finishTurn, {
      agentThreadId: result.threadId,
      promptMessageId: result.messageId,
      requestedStatus: "completed",
      endedAt: aborted.endedAt + 10_000,
      stepCount: 7,
    });
    await setupResult.t.mutation(internal.chatV2.finishTurn, {
      agentThreadId: result.threadId,
      promptMessageId: result.messageId,
      requestedStatus: "failed",
      endedAt: aborted.endedAt + 20_000,
      stepCount: 3,
    });

    const stored = await setupResult.t.run(async (ctx) =>
      await ctx.db.get(turn._id)
    );
    expect(stored).toMatchObject({
      status: "aborted",
      endedAt: aborted.endedAt,
      stepCount: 7,
    });
  });
});

describe("failStaleChatTurns", () => {
  const MINUTES = 60 * 1000;

  test("fails stuck queued/running turns past the cutoff, leaves fresh and terminal turns", async () => {
    const { t } = await setup();
    const base = Date.now();
    // Stale rows: created (and started) 20 minutes before the sweep runs. A
    // queued row has no startedAt — it ages from _creationTime.
    const staleQueuedId = await insertTurn(t, {
      agentThreadId: "thread-reaper",
      promptMessageId: "stale-queued",
      order: 1,
      status: "queued",
    });
    const staleRunningId = await insertTurn(t, {
      agentThreadId: "thread-reaper",
      promptMessageId: "stale-running",
      order: 2,
      status: "running",
      startedAt: base,
    });
    const completedId = await insertTurn(t, {
      agentThreadId: "thread-reaper",
      promptMessageId: "old-completed",
      order: 3,
      status: "completed",
      startedAt: base,
      endedAt: base + 1_000,
      stepCount: 2,
    });
    const abortedId = await insertTurn(t, {
      agentThreadId: "thread-reaper",
      promptMessageId: "old-aborted",
      order: 4,
      status: "aborted",
      startedAt: base,
      endedAt: base + 1_000,
    });

    vi.setSystemTime(base + 20 * MINUTES);
    const freshQueuedId = await insertTurn(t, {
      agentThreadId: "thread-reaper",
      promptMessageId: "fresh-queued",
      order: 5,
      status: "queued",
    });
    const freshRunningId = await insertTurn(t, {
      agentThreadId: "thread-reaper",
      promptMessageId: "fresh-running",
      order: 6,
      status: "running",
      startedAt: Date.now(),
    });

    await expect(
      t.mutation(internal.chatV2.failStaleChatTurns, { olderThanMinutes: 15 })
    ).resolves.toEqual({ failed: 2 });

    const statuses = await t.run(async (ctx) => ({
      staleQueued: (await ctx.db.get(staleQueuedId))?.status,
      staleRunning: await ctx.db.get(staleRunningId),
      completed: (await ctx.db.get(completedId))?.status,
      aborted: (await ctx.db.get(abortedId))?.status,
      freshQueued: (await ctx.db.get(freshQueuedId))?.status,
      freshRunning: (await ctx.db.get(freshRunningId))?.status,
    }));
    expect(statuses.staleQueued).toBe("failed");
    expect(statuses.staleRunning?.status).toBe("failed");
    expect(statuses.staleRunning?.endedAt).toBe(base + 20 * MINUTES);
    expect(statuses.completed).toBe("completed");
    expect(statuses.aborted).toBe("aborted");
    expect(statuses.freshQueued).toBe("queued");
    expect(statuses.freshRunning).toBe("running");
  });

  test("a reaped turn refuses late finalization and late tool writes", async () => {
    const setupResult = await setup();
    const { result, turn } = await sendQueuedTurn(setupResult);
    await setupResult.t.mutation(internal.chatV2.markTurnStarted, {
      agentThreadId: result.threadId,
      promptMessageId: result.messageId,
      startedAt: Date.now(),
    });

    vi.setSystemTime(Date.now() + 20 * MINUTES);
    await setupResult.t.mutation(internal.chatV2.failStaleChatTurns, {
      olderThanMinutes: 15,
    });
    const reaped = await setupResult.t.run(async (ctx) => await ctx.db.get(turn._id));
    expect(reaped?.status).toBe("failed");

    // A zombie action that somehow survives cannot resurrect the turn…
    await expect(
      setupResult.t.mutation(internal.chatV2.finishTurn, {
        agentThreadId: result.threadId,
        promptMessageId: result.messageId,
        requestedStatus: "completed",
        endedAt: Date.now(),
        stepCount: 1,
      })
    ).resolves.toEqual({ status: "failed" });
    // …and its tool calls hit the same stop fence as an aborted turn.
    await expect(
      setupResult.t.mutation(internal.chatV2.saveProposal, {
        agentThreadId: result.threadId,
        toolCallId: "call-after-reap",
        promptMessageId: result.messageId,
        kind: "references",
        references: ["anything"],
      })
    ).resolves.toEqual({
      ok: false,
      stopped: true,
      reason: "The writer stopped this reply.",
    });
  });
});

describe("listTurns", () => {
  test("returns the newest 200 authorized turns in ascending range order", async () => {
    const { t, actor, projectId, reportId } = await setup();
    const threadId = "thread-list";
    await t.run(async (ctx) => {
      await ctx.db.insert("agentChatThreads", {
        projectId,
        reportId,
        agentThreadId: threadId,
        title: "Timing list",
        createdAt: Date.now(),
      });
      for (let order = 1; order <= 240; order += 1) {
        await ctx.db.insert("chatTurns", {
          agentThreadId: threadId,
          promptMessageId: `prompt-${order}`,
          order,
          status: "completed",
          startedAt: order * 10,
          endedAt: order * 10 + 5,
          stepCount: order % 4,
        });
      }
    });

    const turns = await actor.query(api.chatV2.listTurns, {
      threadId,
      startOrder: 10,
      endOrder: 230,
    });
    expect(turns).toHaveLength(200);
    expect(turns[0]?.order).toBe(31);
    expect(turns.at(-1)?.order).toBe(230);
    expect(turns.map((turn) => turn.order)).toEqual(
      [...turns].map((turn) => turn.order).sort((a, b) => a - b)
    );
    await expect(
      actor.query(api.chatV2.listTurns, {
        threadId,
        startOrder: 20,
        endOrder: 19,
      })
    ).resolves.toEqual([]);
  });

  test("returns no metadata for an inaccessible thread", async () => {
    const { t, projectId, reportId, rolelessActor } = await setup();
    const threadId = "thread-private";
    await t.run(async (ctx) => {
      await ctx.db.insert("agentChatThreads", {
        projectId,
        reportId,
        agentThreadId: threadId,
        title: "Private timing",
        createdAt: Date.now(),
      });
      await ctx.db.insert("chatTurns", {
        agentThreadId: threadId,
        promptMessageId: "private-prompt",
        order: 1,
        status: "completed",
        stepCount: 0,
      });
    });

    await expect(
      t.query(api.chatV2.listTurns, {
        threadId,
        startOrder: 1,
        endOrder: 1,
      })
    ).resolves.toEqual([]);
    await expect(
      t.withIdentity({ subject: "unmapped-user" }).query(api.chatV2.listTurns, {
        threadId,
        startOrder: 1,
        endOrder: 1,
      })
    ).resolves.toEqual([]);
    await expect(
      rolelessActor.query(api.chatV2.listTurns, {
        threadId,
        startOrder: 1,
        endOrder: 1,
      })
    ).resolves.toEqual([]);
  });
});

describe("bounded turn and proposal reads", () => {
  test("shares explicit and one-sided inclusive windows while preserving proposal creation order", async () => {
    const setupResult = await setup();
    const threadId = "thread-shared-window";
    await insertMappedThread(setupResult, threadId);
    for (let order = 1; order <= 5; order += 1) {
      await insertTurn(setupResult.t, {
        agentThreadId: threadId,
        promptMessageId: `window-prompt-${order}`,
        order,
        status: "completed",
      });
    }

    const proposalCreationOrder = [
      { order: 4, toolCallId: "window-proposal-4-first" },
      { order: 2, toolCallId: "window-proposal-2" },
      { order: 4, toolCallId: "window-proposal-4-second" },
      { order: 5, toolCallId: "window-proposal-5" },
      { order: 1, toolCallId: "window-proposal-1" },
      { order: 3, toolCallId: "window-proposal-3" },
    ];
    const baseTime = Date.now();
    for (const [index, proposal] of proposalCreationOrder.entries()) {
      vi.setSystemTime(baseTime + index + 1);
      await insertProposal(setupResult, {
        agentThreadId: threadId,
        promptMessageId: `window-prompt-${proposal.order}`,
        toolCallId: proposal.toolCallId,
      });
    }
    await insertProposal(setupResult, {
      agentThreadId: threadId,
      toolCallId: "legacy-without-prompt",
    });
    await insertProposal(setupResult, {
      agentThreadId: threadId,
      promptMessageId: "prompt-without-turn",
      toolCallId: "orphan-prompt",
    });

    const cases: Array<{
      args: { threadId: string; startOrder?: number; endOrder?: number };
      expectedOrders: number[];
    }> = [
      {
        args: { threadId, startOrder: 2, endOrder: 4 },
        expectedOrders: [2, 3, 4],
      },
      {
        args: { threadId, startOrder: 4 },
        expectedOrders: [4, 5],
      },
      {
        args: { threadId, endOrder: 2 },
        expectedOrders: [1, 2],
      },
      {
        args: { threadId },
        expectedOrders: [1, 2, 3, 4, 5],
      },
    ];

    for (const { args, expectedOrders } of cases) {
      const turns = await setupResult.actor.query(api.chatV2.listTurns, args);
      const proposals = await setupResult.actor.query(
        api.chatV2.listProposals,
        args
      );
      expect(turns.map((turn) => turn.order)).toEqual(expectedOrders);
      const returnedPrompts = new Set(
        turns.map((turn) => turn.promptMessageId)
      );
      expect(
        proposals.every(
          (proposal) =>
            proposal.promptMessageId !== undefined &&
            returnedPrompts.has(proposal.promptMessageId)
        )
      ).toBe(true);
      expect(proposals.map((proposal) => proposal.toolCallId)).toEqual(
        proposalCreationOrder
          .filter((proposal) => expectedOrders.includes(proposal.order))
          .map((proposal) => proposal.toolCallId)
      );
    }

    await expect(
      setupResult.actor.query(api.chatV2.listTurns, {
        threadId,
        startOrder: 5,
        endOrder: 4,
      })
    ).resolves.toEqual([]);
    await expect(
      setupResult.actor.query(api.chatV2.listProposals, {
        threadId,
        startOrder: 5,
        endOrder: 4,
      })
    ).resolves.toEqual([]);
  });

  test("keeps the existing thread-only calls inside the newest 200 turns", async () => {
    const setupResult = await setup();
    const threadId = "thread-default-window";
    await insertMappedThread(setupResult, threadId);
    await setupResult.t.run(async (ctx) => {
      for (let order = 1; order <= 201; order += 1) {
        const promptMessageId = `default-prompt-${order}`;
        await ctx.db.insert("chatTurns", {
          agentThreadId: threadId,
          promptMessageId,
          order,
          status: "completed",
          stepCount: 0,
        });
        await ctx.db.insert("chatProposals", {
          agentThreadId: threadId,
          promptMessageId,
          toolCallId: `default-proposal-${order}`,
          projectId: setupResult.projectId,
          reportId: setupResult.reportId,
          kind: "references",
          references: [`default-proposal-${order}`],
          state: "applied",
          createdAt: Date.now(),
        });
      }
    });

    const turns = await setupResult.actor.query(api.chatV2.listTurns, {
      threadId,
    });
    const proposals = await setupResult.actor.query(api.chatV2.listProposals, {
      threadId,
    });
    expect(turns).toHaveLength(200);
    expect(turns[0]?.order).toBe(2);
    expect(turns.at(-1)?.order).toBe(201);
    expect(proposals).toHaveLength(200);
    expect(
      proposals.some(
        (proposal) => proposal.promptMessageId === "default-prompt-1"
      )
    ).toBe(false);
    expect(
      proposals.every((proposal) =>
        turns.some(
          (turn) => turn.promptMessageId === proposal.promptMessageId
        )
      )
    ).toBe(true);
  });

  test("returns a proposal saved for a real queued turn through the default window", async () => {
    const setupResult = await setup();
    await setupResult.t.run(async (ctx) => {
      await ctx.db.patch(setupResult.reportId, {
        content: JSON.stringify({
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "A findable passage." }],
            },
          ],
        }),
      });
    });
    const { result, turn } = await sendQueuedTurn(setupResult);

    // The tools call saveProposal with the promptMessageId the agent library
    // places on the tool context, which is the turn's prompt message id.
    const saved = await setupResult.t.mutation(internal.chatV2.saveProposal, {
      agentThreadId: result.threadId,
      toolCallId: "real-turn-call",
      promptMessageId: result.messageId,
      kind: "references",
      references: ["A findable passage."],
    });
    expect(saved).toMatchObject({ ok: true });

    const proposals = await setupResult.actor.query(api.chatV2.listProposals, {
      threadId: result.threadId,
    });
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({
      toolCallId: "real-turn-call",
      promptMessageId: result.messageId,
    });
    const windowed = await setupResult.actor.query(api.chatV2.listProposals, {
      threadId: result.threadId,
      startOrder: turn.order,
      endOrder: turn.order,
    });
    expect(windowed.map((proposal) => proposal._id)).toEqual([
      proposals[0]?._id,
    ]);
    await expect(
      setupResult.actor.query(api.chatV2.listProposals, {
        threadId: result.threadId,
        startOrder: turn.order + 1,
      })
    ).resolves.toEqual([]);
  });

  test("includes order zero in the default thread-only window", async () => {
    const setupResult = await setup();
    const threadId = "thread-order-zero";
    await insertMappedThread(setupResult, threadId);
    await insertTurn(setupResult.t, {
      agentThreadId: threadId,
      promptMessageId: "order-zero-prompt",
      order: 0,
      status: "completed",
    });
    await insertProposal(setupResult, {
      agentThreadId: threadId,
      promptMessageId: "order-zero-prompt",
      toolCallId: "order-zero-proposal",
    });

    const turns = await setupResult.actor.query(api.chatV2.listTurns, {
      threadId,
    });
    const proposals = await setupResult.actor.query(api.chatV2.listProposals, {
      threadId,
    });
    expect(turns.map((turn) => turn.order)).toEqual([0]);
    expect(proposals.map((proposal) => proposal.toolCallId)).toEqual([
      "order-zero-proposal",
    ]);
  });

  test("does not duplicate proposals when turns share a prompt anchor", async () => {
    const setupResult = await setup();
    const threadId = "thread-duplicate-prompt";
    await insertMappedThread(setupResult, threadId);
    await insertTurn(setupResult.t, {
      agentThreadId: threadId,
      promptMessageId: "duplicate-prompt",
      order: 1,
      status: "completed",
    });
    await insertTurn(setupResult.t, {
      agentThreadId: threadId,
      promptMessageId: "duplicate-prompt",
      order: 2,
      status: "completed",
    });
    await insertProposal(setupResult, {
      agentThreadId: threadId,
      promptMessageId: "duplicate-prompt",
      toolCallId: "deduplicated-proposal",
    });

    const proposals = await setupResult.actor.query(api.chatV2.listProposals, {
      threadId,
    });
    expect(proposals.map((proposal) => proposal.toolCallId)).toEqual([
      "deduplicated-proposal",
    ]);
  });

  test("preserves deterministic creation order when proposal times tie", async () => {
    const setupResult = await setup();
    const threadId = "thread-tied-proposal-times";
    await insertMappedThread(setupResult, threadId);
    await insertTurn(setupResult.t, {
      agentThreadId: threadId,
      promptMessageId: "tie-prompt-one",
      order: 1,
      status: "completed",
    });
    await insertTurn(setupResult.t, {
      agentThreadId: threadId,
      promptMessageId: "tie-prompt-two",
      order: 2,
      status: "completed",
    });

    // convex-test normally advances equal timestamps by 0.001. At this
    // magnitude that increment rounds away, allowing an exact timestamp tie.
    vi.setSystemTime(2 ** 44);
    const insertedIds = await setupResult.t.run(async (ctx) => {
      const addProposal = async (values: {
        promptMessageId: string;
        toolCallId: string;
      }) =>
        ctx.db.insert("chatProposals", {
          agentThreadId: threadId,
          promptMessageId: values.promptMessageId,
          toolCallId: values.toolCallId,
          projectId: setupResult.projectId,
          reportId: setupResult.reportId,
          kind: "references",
          references: [values.toolCallId],
          state: "applied",
          createdAt: Date.now(),
        });
      const first = await addProposal({
        promptMessageId: "tie-prompt-two",
        toolCallId: "tie-proposal-two-first",
      });
      const second = await addProposal({
        promptMessageId: "tie-prompt-one",
        toolCallId: "tie-proposal-one",
      });
      const third = await addProposal({
        promptMessageId: "tie-prompt-two",
        toolCallId: "tie-proposal-two-second",
      });
      return [first, second, third];
    });
    const creationOrdered = await setupResult.t.run(async (ctx) =>
      ctx.db
        .query("chatProposals")
        .withIndex("by_agentThreadId", (q) =>
          q.eq("agentThreadId", threadId)
        )
        .order("asc")
        .collect()
    );
    const expectedIds = [...insertedIds].sort((left, right) =>
      left === right ? 0 : left < right ? -1 : 1
    );
    expect(
      new Set(creationOrdered.map((proposal) => proposal._creationTime))
    ).toHaveLength(1);
    expect(creationOrdered.map((proposal) => proposal._id)).toEqual(expectedIds);

    const proposals = await setupResult.actor.query(api.chatV2.listProposals, {
      threadId,
    });
    const repeated = await setupResult.actor.query(api.chatV2.listProposals, {
      threadId,
    });
    expect(proposals.map((proposal) => proposal._id)).toEqual(expectedIds);
    expect(repeated.map((proposal) => proposal._id)).toEqual(expectedIds);
  });

  test.each([
    { label: "never existed", deleteMapping: false },
    { label: "was deleted", deleteMapping: true },
  ])(
    "returns terminal empty reads when the mapping $label",
    async ({ deleteMapping }) => {
      const setupResult = await setup();
      const componentUserId = deleteMapping
        ? "deleted-mapping-user"
        : "missing-mapping-user";
      const { threadId } = await setupResult.t.run(async (ctx) =>
        reportChatAgent.createThread(ctx, { userId: componentUserId })
      );
      const componentMessages = await setupResult.t.run(async (ctx) =>
        reportChatAgent.saveMessages(ctx, {
          threadId,
          userId: componentUserId,
          messages: [{ role: "user", content: "Orphan component message" }],
          skipEmbeddings: true,
        })
      );
      expect(componentMessages.messages).toHaveLength(1);
      const mappingId = deleteMapping
        ? await insertMappedThread(setupResult, threadId)
        : undefined;
      await insertTurn(setupResult.t, {
        agentThreadId: threadId,
        promptMessageId: "orphan-turn-prompt",
        order: 1,
        status: "completed",
      });
      await insertProposal(setupResult, {
        agentThreadId: threadId,
        promptMessageId: "orphan-turn-prompt",
        toolCallId: "orphan-proposal",
      });
      if (mappingId) {
        await setupResult.t.run(async (ctx) => ctx.db.delete(mappingId));
      }

      const emptyPage = {
        page: [],
        isDone: true,
        continueCursor: "",
        streams: undefined,
      };
      for (const reader of [setupResult.actor, setupResult.rolelessActor]) {
        await expect(
          reader.query(api.chatV2.listMessages, {
            threadId,
            paginationOpts: { numItems: 10, cursor: null },
          })
        ).resolves.toEqual(emptyPage);
        await expect(
          reader.query(api.chatV2.listProposals, { threadId })
        ).resolves.toEqual([]);
      }
    }
  );

  test("throws NOT_AUTHORIZED for existing role-less message and proposal reads", async () => {
    const setupResult = await setup();
    const threadId = "thread-roleless-window";
    await insertMappedThread(setupResult, threadId);

    await expect(
      setupResult.rolelessActor.query(api.chatV2.listMessages, {
        threadId,
        paginationOpts: { numItems: 10, cursor: null },
      })
    ).rejects.toMatchObject({ data: { code: "NOT_AUTHORIZED" } });
    await expect(
      setupResult.rolelessActor.query(api.chatV2.listProposals, { threadId })
    ).rejects.toMatchObject({ data: { code: "NOT_AUTHORIZED" } });
    await expect(
      setupResult.rolelessActor.query(api.chatV2.listProposals, {
        threadId,
        startOrder: 2,
        endOrder: 1,
      })
    ).rejects.toMatchObject({ data: { code: "NOT_AUTHORIZED" } });
  });

  test("throws NOT_AUTHENTICATED for existing unauthenticated message and proposal reads", async () => {
    const setupResult = await setup();
    const threadId = "thread-anonymous-window";
    await insertMappedThread(setupResult, threadId);

    await expect(
      setupResult.t.query(api.chatV2.listMessages, {
        threadId,
        paginationOpts: { numItems: 10, cursor: null },
      })
    ).rejects.toMatchObject({ data: { code: "NOT_AUTHENTICATED" } });
    await expect(
      setupResult.t.query(api.chatV2.listProposals, { threadId })
    ).rejects.toMatchObject({ data: { code: "NOT_AUTHENTICATED" } });
  });
});


describe("CAP-11 chat admission", () => {
  async function recordCost(s: Awaited<ReturnType<typeof setup>>, costUsd: number, createdAt = Date.now(), projectId = s.projectId, callSite = "generation:242") {
    await s.t.mutation(internal.aiUsage.logUsage, {
      projectId, callSite, model: "test", inputTokens: 0, outputTokens: 0, costUsd, createdAt,
    });
  }

  async function state(s: Awaited<ReturnType<typeof setup>>) {
    const app = await s.t.run(async (ctx) => ({
      threads: await ctx.db.query("agentChatThreads").collect(),
      turns: await ctx.db.query("chatTurns").collect(),
      jobs: await ctx.db.system.query("_scheduled_functions").collect(),
    }));
    const threads = await s.t.query(components.agent.threads.listThreadsByUserId, { userId: s.userId });
    const messages = await Promise.all(app.threads.map((thread) => s.actor.query(api.chatV2.listMessages, {
      threadId: thread.agentThreadId, paginationOpts: { cursor: null, numItems: 100 },
    })));
    return { app, threads, messages };
  }

  test("admits exactly the default budget, sums all call sites, and rejects without side effects", async () => {
    const s = await setup();
    await recordCost(s, 25);
    await recordCost(s, 25, Date.now(), s.projectId, "chat");
    const { turn, result } = await sendQueuedTurn(s);
    expect(turn.userId).toBe(s.userId);
    await recordCost(s, 0.01);
    const before = await state(s);
    for (const target of [{ newThread: true }, { newThread: false }, { threadId: result.threadId }]) {
      await expect(s.actor.mutation(api.chatV2.sendMessage, { reportId: s.reportId, content: "refused", ...target }))
        .rejects.toMatchObject({ data: { code: "CHAT_SPEND_BUDGET_EXCEEDED" } });
      expect(await state(s)).toEqual(before);
    }
  });

  test("includes both window endpoints and excludes old, future, and other-project cost", async () => {
    const s = await setup();
    const other = await s.t.run(async (ctx) => {
      const project = await ctx.db.get(s.projectId);
      if (!project) throw new Error("missing project");
      return ctx.db.insert("projects", { title: "Other", clientName: "Client", status: "review", createdBy: s.userId, shareToken: "other", createdAt: Date.now(), updatedAt: Date.now() });
    });
    const start = Date.now() - 24 * 60 * 60 * 1000;
    await recordCost(s, 100, start - 1);
    await recordCost(s, 100, Date.now() + 1);
    await recordCost(s, 100, Date.now(), other);
    await recordCost(s, 25, start);
    await recordCost(s, 25, Date.now());
    await sendQueuedTurn(s);
    await recordCost(s, 0.01, start);
    await expect(sendQueuedTurn(s)).rejects.toMatchObject({ data: { code: "CHAT_SPEND_BUDGET_EXCEEDED" } });
  });

  test("counts queued turns across projects and releases capacity on start", async () => {
    const s = await setup();
    const otherReport = await s.t.run(async (ctx) => {
      const projectId = await ctx.db.insert("projects", { title: "Other", clientName: "Client", status: "review", createdBy: s.userId, shareToken: "other", createdAt: Date.now(), updatedAt: Date.now() });
      return ctx.db.insert("reports", { projectId, content: "{}", version: 1, generatedAt: Date.now(), updatedAt: Date.now() });
    });
    const first = await sendQueuedTurn(s);
    const other = await sendQueuedTurn({ ...s, reportId: otherReport });
    await sendQueuedTurn(s);
    const before = await state(s);
    for (const target of [{ newThread: true }, { newThread: false }, { threadId: other.result.threadId }]) {
      await expect(s.actor.mutation(api.chatV2.sendMessage, { reportId: otherReport, content: "full", ...target }))
        .rejects.toMatchObject({ data: { code: "CHAT_QUEUE_LIMIT_EXCEEDED" } });
    }
    expect(await state(s)).toEqual(before);
    await s.t.run(async (ctx) => { await ctx.db.insert("users", { authId: "other-sender", role: "writer" }); });
    await s.t.withIdentity({ subject: "other-sender" }).mutation(api.chatV2.sendMessage, { reportId: s.reportId, content: "another sender", threadId: first.result.threadId });
    await s.t.mutation(internal.chatV2.markTurnStarted, { agentThreadId: first.result.threadId, promptMessageId: first.result.messageId, startedAt: Date.now() });
    await sendQueuedTurn(s);
  });

  test("running and all terminal states do not consume queued slots", async () => {
    const s = await setup();
    for (const status of ["running", "completed", "failed", "aborted"] as const) {
      const { turn } = await sendQueuedTurn(s);
      await s.t.run(async (ctx) => ctx.db.patch(turn._id, { status }));
    }
    for (let i = 0; i < 3; i++) await sendQueuedTurn(s);
    await expect(sendQueuedTurn(s)).rejects.toMatchObject({ data: { code: "CHAT_QUEUE_LIMIT_EXCEEDED" } });
  });

  test("legacy shared turns use prompt sender and tolerate missing prompt ownership", async () => {
    const s = await setup();
    const { threadId } = await s.t.run(async (ctx) => reportChatAgent.createThread(ctx, { userId: "other-creator" }));
    await insertMappedThread(s, threadId);
    for (const userId of [undefined, "other-sender", s.userId, s.userId, s.userId]) {
      const saved = await s.t.run(async (ctx) => reportChatAgent.saveMessages(ctx, {
        threadId, userId, messages: [{ role: "user", content: "legacy" }], skipEmbeddings: true,
      }));
      const message = saved.messages[0];
      if (!message) throw new Error("missing prompt");
      await insertTurn(s.t, { agentThreadId: threadId, promptMessageId: message._id, order: message.order, status: "queued" });
    }
    const before = await state(s);
    await expect(sendQueuedTurn(s)).rejects.toMatchObject({ data: { code: "CHAT_QUEUE_LIMIT_EXCEEDED" } });
    expect(await state(s)).toEqual(before);
  });

  test("legacy prompts without this sender never inherit the thread creator", async () => {
    const s = await setup();
    const { threadId } = await s.t.run(async (ctx) => reportChatAgent.createThread(ctx, { userId: s.userId }));
    await insertMappedThread(s, threadId);
    for (const owner of [undefined, "someone-else", "deleted-prompt"]) {
      const promptThreadId = owner === undefined
        ? (await s.t.run(async (ctx) => reportChatAgent.createThread(ctx, {}))).threadId
        : threadId;
      const saved = await s.t.run(async (ctx) => reportChatAgent.saveMessages(ctx, {
        threadId: promptThreadId, userId: owner,
        messages: [{ role: "user", content: "legacy" }], skipEmbeddings: true,
      }));
      const message = saved.messages[0];
      if (!message) throw new Error("missing prompt");
      expect(message.userId).toBe(owner);
      await insertTurn(s.t, { agentThreadId: promptThreadId, promptMessageId: message._id, order: message.order, status: "queued" });
      if (owner === "deleted-prompt") {
        await s.t.mutation(components.agent.messages.deleteByIds, { messageIds: [message._id] });
      }
    }
    const { turn } = await sendQueuedTurn(s);
    await s.t.run(async (ctx) => ctx.db.patch(turn._id, { userId: undefined }));
    await sendQueuedTurn(s);
    await sendQueuedTurn(s);
    await expect(sendQueuedTurn(s)).rejects.toMatchObject({ data: { code: "CHAT_QUEUE_LIMIT_EXCEEDED" } });
  });

  async function admin(s: Awaited<ReturnType<typeof setup>>) {
    await s.t.run(async (ctx) => { await ctx.db.insert("users", { authId: "admission-admin", role: "admin" }); });
    return s.t.withIdentity({ subject: "admission-admin" });
  }

  test("administrator settings immediately control both limits", async () => {
    const s = await setup();
    const actor = await admin(s);
    await actor.mutation(api.appSettings.setChatAdmissionLimits, { dailyBudgetUsd: 0.5, maxQueuedTurns: 1 });
    await recordCost(s, 0.5);
    await sendQueuedTurn(s);
    await expect(sendQueuedTurn(s)).rejects.toMatchObject({ data: { code: "CHAT_QUEUE_LIMIT_EXCEEDED" } });
    await recordCost(s, 0.01);
    await expect(sendQueuedTurn(s)).rejects.toMatchObject({ data: { code: "CHAT_SPEND_BUDGET_EXCEEDED" } });
  });

  test("invalid and unauthorized setting updates preserve both values atomically", async () => {
    const s = await setup();
    const actor = await admin(s);
    const valid = { dailyBudgetUsd: 1.5, maxQueuedTurns: 2 };
    await actor.mutation(api.appSettings.setChatAdmissionLimits, valid);
    const before = await s.t.run(async (ctx) => ctx.db.query("appSettings").collect());
    for (const dailyBudgetUsd of [0, -1, NaN, Infinity, -Infinity]) {
      await expect(actor.mutation(api.appSettings.setChatAdmissionLimits, { ...valid, dailyBudgetUsd }))
        .rejects.toMatchObject({ data: { code: "INVALID_INPUT" } });
    }
    for (const maxQueuedTurns of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(actor.mutation(api.appSettings.setChatAdmissionLimits, { dailyBudgetUsd: 99, maxQueuedTurns }))
        .rejects.toMatchObject({ data: { code: "INVALID_INPUT" } });
    }
    await s.t.run(async (ctx) => { await ctx.db.insert("users", { authId: "anonymous-admin", role: "admin", isAnonymous: true }); });
    for (const reader of [s.actor, s.rolelessActor, s.t.withIdentity({ subject: "anonymous-admin" })]) {
      await expect(reader.mutation(api.appSettings.setChatAdmissionLimits, valid)).rejects.toMatchObject({ data: { code: "NOT_AUTHORIZED" } });
    }
    await expect(s.t.mutation(api.appSettings.setChatAdmissionLimits, valid)).rejects.toMatchObject({ data: { code: "NOT_AUTHENTICATED" } });
    expect(await s.t.run(async (ctx) => ctx.db.query("appSettings").collect())).toEqual(before);
  });

  test.each([
    { budget: "bad", queue: "1", admitted: 1 },
    { budget: "50", queue: "1.5", admitted: 3 },
    { budget: "Infinity", queue: "9007199254740992", admitted: 3 },
    { budget: "0", queue: "-1", admitted: 3 },
  ])("stale settings fall back independently: $budget / $queue", async ({ budget, queue, admitted }) => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      for (const [key, value] of [["ai.chatDailyBudgetUsd", budget], ["ai.chatMaxQueuedTurns", queue]]) {
        await ctx.db.insert("appSettings", { key, value, updatedBy: s.userId, updatedAt: Date.now() });
      }
    });
    await recordCost(s, 50);
    for (let i = 0; i < admitted; i++) await sendQueuedTurn(s);
    await expect(sendQueuedTurn(s)).rejects.toMatchObject({ data: { code: "CHAT_QUEUE_LIMIT_EXCEEDED" } });
  });

  test("compares exact decimal costs at a fractional budget", async () => {
    const s = await setup();
    const actor = await admin(s);
    await actor.mutation(api.appSettings.setChatAdmissionLimits, { dailyBudgetUsd: 0.3, maxQueuedTurns: 3 });
    await recordCost(s, 0.1);
    await recordCost(s, 0.2, Date.now(), s.projectId, "chat");
    await sendQueuedTurn(s);
    await recordCost(s, 0.000001, Date.now(), s.projectId, "financial");
    const before = await state(s);
    await expect(sendQueuedTurn(s)).rejects.toMatchObject({ data: { code: "CHAT_SPEND_BUDGET_EXCEEDED" } });
    expect(await state(s)).toEqual(before);
  });

  test.each([1e-20, Number.MIN_VALUE])("preserves scientific-notation cost %s without rounding away an excess", async (extra) => {
    const s = await setup();
    const actor = await admin(s);
    await actor.mutation(api.appSettings.setChatAdmissionLimits, { dailyBudgetUsd: 0.3, maxQueuedTurns: 3 });
    await recordCost(s, 0.3);
    await recordCost(s, extra);
    await expect(sendQueuedTurn(s)).rejects.toMatchObject({ data: { code: "CHAT_SPEND_BUDGET_EXCEEDED" } });
  });

  test.each([1e21, Number.MAX_VALUE])("admits exact large budget %s and rejects a tiny excess", async (dailyBudgetUsd) => {
    const s = await setup();
    const actor = await admin(s);
    await actor.mutation(api.appSettings.setChatAdmissionLimits, { dailyBudgetUsd, maxQueuedTurns: 3 });
    await recordCost(s, dailyBudgetUsd);
    await sendQueuedTurn(s);
    await recordCost(s, Number.MIN_VALUE);
    const before = await state(s);
    await expect(sendQueuedTurn(s)).rejects.toMatchObject({ data: { code: "CHAT_SPEND_BUDGET_EXCEEDED" } });
    expect(await state(s)).toEqual(before);
  });

  test("reads whitespace-padded scientific budget from stored settings", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => ctx.db.insert("appSettings", {
      key: "ai.chatDailyBudgetUsd", value: "  5E-1  ", updatedBy: s.userId, updatedAt: Date.now(),
    }));
    await recordCost(s, 0.5);
    await sendQueuedTurn(s);
    await recordCost(s, 0.01);
    await expect(sendQueuedTurn(s)).rejects.toMatchObject({ data: { code: "CHAT_SPEND_BUDGET_EXCEEDED" } });
  });

  test("sums 10000 fractional rows exactly and includes the decisive last range row", async () => {
    const s = await setup();
    const actor = await admin(s);
    await actor.mutation(api.appSettings.setChatAdmissionLimits, { dailyBudgetUsd: 0.3, maxQueuedTurns: 3 });
    for (let batch = 0; batch < 20; batch++) {
      await s.t.run(async (ctx) => {
        for (let offset = 0; offset < 500; offset++) {
          await ctx.db.insert("aiUsage", {
            projectId: s.projectId, callSite: offset % 2 ? "chat" : "financial", model: "test",
            inputTokens: 0, outputTokens: 0, costUsd: 0.00003,
            createdAt: Date.now() - 10000 + batch * 500 + offset,
          });
        }
      });
    }
    await sendQueuedTurn(s);
    await recordCost(s, 0.00001);
    const before = await state(s);
    await expect(sendQueuedTurn(s)).rejects.toMatchObject({ data: { code: "CHAT_SPEND_BUDGET_EXCEEDED" } });
    expect(await state(s)).toEqual(before);
  });

  test("readmits a blocked project after recorded usage expires", async () => {
    const s = await setup();
    await recordCost(s, 51);
    await expect(sendQueuedTurn(s)).rejects.toMatchObject({ data: { code: "CHAT_SPEND_BUDGET_EXCEEDED" } });
    vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1000 + 1);
    await sendQueuedTurn(s);
  });

  test("updates both existing settings without duplicate keys and immediately raises or lowers admission", async () => {
    const s = await setup();
    const actor = await admin(s);
    const setLimits = (dailyBudgetUsd: number, maxQueuedTurns: number) => actor.mutation(
      api.appSettings.setChatAdmissionLimits, { dailyBudgetUsd, maxQueuedTurns }
    );
    await setLimits(0.5, 3);
    await recordCost(s, 0.4);
    await sendQueuedTurn(s);
    await setLimits(0.3, 3);
    await expect(sendQueuedTurn(s)).rejects.toMatchObject({ data: { code: "CHAT_SPEND_BUDGET_EXCEEDED" } });
    await setLimits(0.5, 3);
    await sendQueuedTurn(s);
    await setLimits(0.5, 1);
    await expect(sendQueuedTurn(s)).rejects.toMatchObject({ data: { code: "CHAT_QUEUE_LIMIT_EXCEEDED" } });
    await setLimits(0.5, 3);
    await sendQueuedTurn(s);
    const rows = await s.t.run(async (ctx) => ctx.db.query("appSettings").collect());
    expect(rows.map(({ key, value }) => ({ key, value })).sort((a, b) => a.key.localeCompare(b.key))).toEqual([
      { key: "ai.chatDailyBudgetUsd", value: "0.5" },
      { key: "ai.chatMaxQueuedTurns", value: "3" },
    ]);
  });

  test.each(["bad", "Infinity", "0", "-1", "0x10", "", "   "])("malformed budget %s rejects over default with free queue and no side effects", async (value) => {
    const s = await setup();
    await s.t.run(async (ctx) => ctx.db.insert("appSettings", {
      key: "ai.chatDailyBudgetUsd", value, updatedBy: s.userId, updatedAt: Date.now(),
    }));
    await recordCost(s, 50.01);
    const before = await state(s);
    await expect(sendQueuedTurn(s)).rejects.toMatchObject({ data: { code: "CHAT_SPEND_BUDGET_EXCEEDED" } });
    expect(await state(s)).toEqual(before);
  });

  test("keeps a valid fractional budget while a malformed queue independently defaults to three", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      for (const [key, value] of [["ai.chatDailyBudgetUsd", "0.3"], ["ai.chatMaxQueuedTurns", "bad"]]) {
        await ctx.db.insert("appSettings", { key, value, updatedBy: s.userId, updatedAt: Date.now() });
      }
    });
    await recordCost(s, 0.3);
    const { turn } = await sendQueuedTurn(s);
    await sendQueuedTurn(s);
    await sendQueuedTurn(s);
    await expect(sendQueuedTurn(s)).rejects.toMatchObject({ data: { code: "CHAT_QUEUE_LIMIT_EXCEEDED" } });
    await s.t.run(async (ctx) => ctx.db.patch(turn._id, { status: "completed" }));
    await recordCost(s, 0.01);
    const before = await state(s);
    await expect(sendQueuedTurn(s)).rejects.toMatchObject({ data: { code: "CHAT_SPEND_BUDGET_EXCEEDED" } });
    expect(await state(s)).toEqual(before);
  });

});
