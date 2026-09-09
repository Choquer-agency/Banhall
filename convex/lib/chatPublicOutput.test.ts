import { describe, expect, it } from "vitest";
import type { UIMessage } from "@convex-dev/agent";
import { publicChatDelta, publicChatMessage } from "./chatPublicOutput";
import { readUIMessageStream } from "ai";

describe("browser chat output boundary", () => {
  it("keeps a sanitized tool stream readable by the official SDK", async () => {
    const delta = publicChatDelta({ streamId: "s", start: 0, end: 7, parts: [
      { type: "start", messageId: "m" },
      { type: "tool-input-start", toolCallId: "c", toolName: "proposeBulkEdits", dynamic: true },
      { type: "tool-input-delta", toolCallId: "c", inputTextDelta: '{"private":"CANARY"}' },
      { type: "tool-input-available", toolCallId: "c", toolName: "proposeBulkEdits", dynamic: true, input: { private: "CANARY" } },
      { type: "tool-output-available", toolCallId: "c", output: "CANARY" },
      { type: "finish-step" }, { type: "finish" },
    ] });
    const stream = new ReadableStream({ start(controller) {
      delta.parts.forEach(part => controller.enqueue(part)); controller.close();
    } });
    let final;
    for await (const message of readUIMessageStream({ stream, terminateOnError: true })) final = message;
    expect(final?.parts).toContainEqual(expect.objectContaining({ toolCallId: "c", state: "output-available", input: {} }));
    expect(JSON.stringify(final)).not.toContain("CANARY");
  });
  it("removes reasoning and raw retrieval results while retaining tool IDs for proposal cards", () => {
    const message: UIMessage = {
      id: "a", key: "a", role: "assistant", status: "success", order: 1,
      stepOrder: 1, _creationTime: 0, text: "A visible answer.", parts: [
        { type: "text", text: "A visible answer." },
        { type: "reasoning", text: "PRIVATE_REASONING_CANARY" },
        { type: "dynamic-tool", toolName: "searchBrain", toolCallId: "call-1",
          state: "output-available", input: { query: "PRIVATE_ARGUMENT_CANARY" }, output: "PRIVATE_BRAIN_CANARY" },
      ],
    };
    const failed: UIMessage["parts"][number] = { type: "dynamic-tool", toolName: "searchBrain", toolCallId: "failed",
      state: "output-error", input: { private: "PRIVATE_INPUT" }, errorText: "PRIVATE_ERROR" };
    // The pinned component mapper includes output on this state at runtime,
    // although the AI SDK's narrower UI type does not declare it.
    Reflect.set(failed, "output", "PRIVATE_OUTPUT");
    message.parts.push(failed);
    const visible = publicChatMessage(message);
    expect(JSON.stringify(visible)).not.toContain("PRIVATE_");
    expect(visible.text).toBe(message.text);
    expect(visible.parts[1]).toMatchObject({ toolCallId: "call-1", state: "output-available" });
    expect(message.parts).toHaveLength(4);
  });

  it("filters both SDK stream formats without changing their cursors", () => {
    const output = publicChatDelta({ streamId: "s", start: 4, end: 9, parts: [
      { type: "reasoning-start", id: "r" },
      { type: "reasoning-delta", id: "r", delta: "PRIVATE_THOUGHT" },
      { type: "reasoning-end", id: "r" },
      { type: "tool-input-delta", toolCallId: "t", inputTextDelta: "PRIVATE_ARGUMENT_CHUNK" },
      { type: "tool-input-available", toolCallId: "t", toolName: "searchBrain", input: { query: "PRIVATE_ARGUMENT" } },
      { type: "tool-result", toolCallId: "t", result: "PRIVATE_LEGACY_RESULT" },
      { type: "tool-output-available", toolCallId: "t2", output: "PRIVATE_RESULT" },
      { type: "tool-output-error", toolCallId: "t3", errorText: "PRIVATE_PROVIDER_ERROR" },
      { type: "tool-input-error", toolCallId: "t4", input: { private: "PRIVATE_INPUT" }, errorText: "PRIVATE_INPUT_ERROR" },
      { type: "text-delta", id: "a", delta: "Visible answer" },
    ] });
    expect(output).toMatchObject({ streamId: "s", start: 4, end: 9 });
    expect(JSON.stringify(output)).not.toContain("PRIVATE_");
    expect(output.parts.at(-1)).toEqual({ type: "text-delta", id: "a", delta: "Visible answer" });
    expect(publicChatDelta({ streamId: "s", start: 9, end: 10, parts: [{ type: "reasoning-delta", delta: "private" }] }))
      .toEqual({ streamId: "s", start: 9, end: 10, parts: [] });
  });
});
