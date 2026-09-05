import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Id, TableNames } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";

const providerMocks = vi.hoisted(() => ({
  createAnthropicClient: vi.fn(),
}));

vi.mock("./providers", () => ({
  createAnthropicClient: providerMocks.createAnthropicClient,
}));

import { instrumentedAnthropic } from "./instrument";
import { generateStructured } from "./structured";

type HandoffOrder = "digest-union" | "provider" | "usage-scheduled";

function testId<TableName extends TableNames>(value: string): Id<TableName> {
  return value as Id<TableName>;
}

function fakeCtx(order: HandoffOrder[] = []) {
  const runAfter = vi.fn(async (..._args: unknown[]) => {
    order.push("usage-scheduled");
  });
  const runMutation = vi.fn(async (..._args: unknown[]) => {
    order.push("digest-union");
  });
  const ctx = {
    scheduler: { runAfter },
    runMutation,
  } as unknown as ActionCtx;
  return { ctx, runAfter, runMutation };
}

function textResponse(usage?: unknown) {
  return {
    content: [{ type: "text", text: "provider response" }],
    ...(usage === undefined ? {} : { usage }),
  };
}

function toolResponse(input: unknown, usage: unknown) {
  return {
    content: [
      {
        type: "tool_use",
        id: "tool-1",
        name: "submit",
        input,
      },
    ],
    usage,
  };
}

const request = {
  model: "claude-sonnet-5",
  max_tokens: 100,
  messages: [{ role: "user" as const, content: "Generate" }],
};

beforeEach(() => {
  providerMocks.createAnthropicClient.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("instrumentedAnthropic generation attribution", () => {
  it("awaits the digest union before handoff and preserves explicit-zero candidate usage", async () => {
    const order: HandoffOrder[] = [];
    const providerCreate = vi.fn(async () => {
      order.push("provider");
      return textResponse({
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      });
    });
    providerMocks.createAnthropicClient.mockReturnValue({
      messages: { create: providerCreate },
    });
    const { ctx, runAfter, runMutation } = fakeCtx(order);
    const generationId = testId<"generations">("generation-1");
    const candidateRunId = testId<"generationCandidateRuns">("candidate-1");
    const digestId = testId<"learningDigests">("digest-1");
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(145)
      .mockReturnValueOnce(146);

    const client = instrumentedAnthropic(ctx, {
      callSite: "generation:candidate:242",
      attribution: {
        generationId,
        candidateRunId,
        learningDigestIds: [digestId],
      },
    });
    await client.messages.create(request);

    expect(order).toEqual(["digest-union", "provider", "usage-scheduled"]);
    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runMutation.mock.calls[0][1]).toEqual({
      generationId,
      digestIds: [digestId],
    });
    expect(runAfter).toHaveBeenCalledTimes(1);
    expect(runAfter.mock.calls[0][2]).toMatchObject({
      generationId,
      candidateRunId,
      durationMs: 45,
      callSite: "generation:candidate:242",
      model: "claude-sonnet-5",
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    });
  });

  it.each([
    ["absent", undefined],
    ["empty", {}],
    ["wholly malformed", { input_tokens: "bad", output_tokens: -1 }],
    ["cache-only", { cache_read_input_tokens: 12, cache_creation_input_tokens: 0 }],
  ])("does not synthesize an aiUsage row for %s usage", async (_label, usage) => {
    const providerCreate = vi.fn(async () => textResponse(usage));
    providerMocks.createAnthropicClient.mockReturnValue({
      messages: { create: providerCreate },
    });
    const { ctx, runAfter } = fakeCtx();
    const client = instrumentedAnthropic(ctx, {
      callSite: "generation:no-usage",
      attribution: {
        generationId: testId<"generations">("generation-no-usage"),
      },
    });

    await client.messages.create(request);

    expect(providerCreate).toHaveBeenCalledTimes(1);
    expect(runAfter).not.toHaveBeenCalled();
  });

  it("attributes both genuine-usage calls made by structured-output repair", async () => {
    const providerCreate = vi
      .fn()
      .mockResolvedValueOnce(
        toolResponse(
          { other: "missing" },
          { input_tokens: 10, output_tokens: 2 },
        ),
      )
      .mockResolvedValueOnce(
        toolResponse(
          { required: "repaired" },
          { input_tokens: 12, output_tokens: 3 },
        ),
      );
    providerMocks.createAnthropicClient.mockReturnValue({
      messages: { create: providerCreate },
    });
    const { ctx, runAfter, runMutation } = fakeCtx();
    const generationId = testId<"generations">("generation-repair");
    const candidateRunId = testId<"generationCandidateRuns">("candidate-repair");
    const digestId = testId<"learningDigests">("digest-repair");
    const client = instrumentedAnthropic(ctx, {
      callSite: "generation:candidate:analysis",
      attribution: {
        generationId,
        candidateRunId,
        learningDigestIds: [digestId],
      },
    });

    const result = await generateStructured(client, {
      system: "System",
      user: "User",
      toolName: "submit",
      description: "Submit output",
      validate: z.object({ required: z.string() }),
    });

    expect(result).toEqual({ required: "repaired" });
    expect(providerCreate).toHaveBeenCalledTimes(2);
    expect(runMutation).toHaveBeenCalledTimes(2);
    expect(runAfter).toHaveBeenCalledTimes(2);
    for (const call of runAfter.mock.calls) {
      const event = call[2];
      expect(event).toMatchObject({
        generationId,
        candidateRunId,
        callSite: "generation:candidate:analysis",
      });
      if (
        !event ||
        typeof event !== "object" ||
        !("durationMs" in event) ||
        typeof event.durationMs !== "number"
      ) {
        throw new Error("scheduled usage did not include a numeric duration");
      }
      expect(event.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("schedules returned usage before a later structured validation failure", async () => {
    const providerCreate = vi
      .fn()
      .mockResolvedValueOnce(
        toolResponse({ wrong: 1 }, { input_tokens: 7, output_tokens: 1 }),
      )
      .mockResolvedValueOnce(
        toolResponse({ stillWrong: 2 }, { input_tokens: 9, output_tokens: 2 }),
      );
    providerMocks.createAnthropicClient.mockReturnValue({
      messages: { create: providerCreate },
    });
    const { ctx, runAfter } = fakeCtx();
    const generationId = testId<"generations">("generation-invalid-output");
    const client = instrumentedAnthropic(ctx, {
      callSite: "generation:post-qa",
      attribution: { generationId },
    });

    await expect(
      generateStructured(client, {
        system: "System",
        user: "User",
        toolName: "submit",
        description: "Submit output",
        validate: z.object({ required: z.string() }),
      }),
    ).rejects.toThrow(/required/);

    expect(runAfter).toHaveBeenCalledTimes(2);
    for (const call of runAfter.mock.calls) {
      const event = call[2];
      expect(event).toMatchObject({ generationId });
      expect(event).not.toHaveProperty("candidateRunId");
      if (
        !event ||
        typeof event !== "object" ||
        !("durationMs" in event) ||
        typeof event.durationMs !== "number"
      ) {
        throw new Error("downstream-failure usage lacked elapsed time");
      }
      expect(event.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("retains the handed-off digest but writes no usage when transport fails", async () => {
    const providerCreate = vi.fn(async () => {
      throw new Error("transport failed");
    });
    providerMocks.createAnthropicClient.mockReturnValue({
      messages: { create: providerCreate },
    });
    const order: HandoffOrder[] = [];
    const { ctx, runAfter, runMutation } = fakeCtx(order);
    const generationId = testId<"generations">("generation-failed-transport");
    const digestId = testId<"learningDigests">("digest-failed-transport");
    const client = instrumentedAnthropic(ctx, {
      callSite: "generation:failed-transport",
      attribution: { generationId, learningDigestIds: [digestId] },
    });

    await expect(client.messages.create(request)).rejects.toThrow(
      "transport failed",
    );

    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runAfter).not.toHaveBeenCalled();
  });

  it("does not hand the payload to Anthropic when the required digest union fails", async () => {
    const providerCreate = vi.fn(async () =>
      textResponse({ input_tokens: 1, output_tokens: 1 }),
    );
    providerMocks.createAnthropicClient.mockReturnValue({
      messages: { create: providerCreate },
    });
    const { ctx, runAfter, runMutation } = fakeCtx();
    runMutation.mockRejectedValueOnce(new Error("digest union unavailable"));
    const client = instrumentedAnthropic(ctx, {
      callSite: "generation:union-failure",
      attribution: {
        generationId: testId<"generations">("generation-union-failure"),
        learningDigestIds: [
          testId<"learningDigests">("digest-union-failure"),
        ],
      },
    });

    await expect(client.messages.create(request)).rejects.toThrow(
      "digest union unavailable",
    );

    expect(providerCreate).not.toHaveBeenCalled();
    expect(runAfter).not.toHaveBeenCalled();
  });
});

describe("generation prefix caching at the SDK boundary", () => {
  function setup(generationOwned = true) {
    const providerCreate = vi.fn(async (..._args: unknown[]) => textResponse({
      input_tokens: 4,
      output_tokens: 2,
      cache_creation_input_tokens: 20,
      cache_read_input_tokens: 80,
    }));
    providerMocks.createAnthropicClient.mockReturnValue({ messages: { create: providerCreate } });
    const { ctx, runAfter } = fakeCtx();
    const client = instrumentedAnthropic(ctx, {
      callSite: generationOwned ? "generation:analyzer" : "chat:test",
      ...(generationOwned ? {
        attribution: { generationId: testId<"generations">("cached-generation") },
      } : {}),
    });
    return { client, providerCreate, runAfter };
  }

  it("marks the exact system and transcript bytes while preserving options and usage", async () => {
    const { client, providerCreate, runAfter } = setup();
    const params = {
      ...request,
      system: "Stable policy\nSecond line",
      messages: [
        { role: "user" as const, content: "BEGIN TRANSCRIPT\nEvidence\nEND TRANSCRIPT" },
        { role: "assistant" as const, content: "Prior response" },
        { role: "user" as const, content: "Follow-up instruction" },
      ],
    };
    const original = structuredClone(params);
    const options = { timeout: 1234 };
    await client.messages.create(params, options);
    expect(providerCreate).toHaveBeenCalledExactlyOnceWith({
      ...params,
      system: [{ type: "text", text: params.system, cache_control: { type: "ephemeral" } }],
      messages: [
        { role: "user", content: [{
          type: "text", text: params.messages[0].content, cache_control: { type: "ephemeral" },
        }] },
        ...params.messages.slice(1),
      ],
    }, options);
    expect(params).toEqual(original);
    expect(runAfter.mock.calls[0][2]).toMatchObject({
      generationId: "cached-generation",
      cacheCreationInputTokens: 20,
      cacheReadInputTokens: 80,
    });
  });

  it("leaves non-generation traffic unchanged", async () => {
    const { client, providerCreate } = setup(false);
    const params = { ...request, system: "Chat policy" };
    await client.messages.create(params);
    expect(providerCreate.mock.calls[0][0]).toBe(params);
  });

  it.each(["system", "message", "tool", "top-level", "later-message"] as const)(
    "preserves explicit %s cache policy without adding breakpoints",
    async (location) => {
      const { client, providerCreate } = setup();
      const textBlock = {
        type: "text" as const,
        text: "Existing prefix",
        cache_control: { type: "ephemeral" as const, ttl: "1h" as const },
      };
      const params = {
        ...request,
        system: location === "system" ? [textBlock] : "Policy",
        messages: [
          { role: "user" as const, content: location === "message" ? [textBlock] : "Transcript" },
          ...(location === "later-message" ? [
            { role: "assistant" as const, content: "Prior response" },
            { role: "user" as const, content: [textBlock] },
          ] : []),
        ],
        ...(location === "top-level" ? { cache_control: { type: "ephemeral" as const } } : {}),
        ...(location === "tool" ? {
          tools: [{ name: "submit", input_schema: { type: "object" as const }, cache_control: { type: "ephemeral" as const } }],
        } : {}),
      };
      const original = structuredClone(params);
      await client.messages.create(params);
      expect(providerCreate.mock.calls[0][0]).toBe(params);
      expect(params).toEqual(original);
    },
  );

  it("does not mark an empty prefix or replace multimodal blocks", async () => {
    const { client, providerCreate } = setup();
    const params = {
      ...request,
      system: "",
      messages: [{ role: "user", content: [
        { type: "text", text: "Multimodal input" },
        { type: "image", source: { type: "base64", media_type: "image/png",
          data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGxQAAAAASUVORK5CYII=" } },
        { type: "document", source: { type: "text", media_type: "text/plain", data: "Frozen evidence document" } },
      ] }],
    } satisfies Anthropic.MessageCreateParamsNonStreaming;
    await client.messages.create(params);
    expect(providerCreate.mock.calls[0][0]).toEqual(params);
  });
});
