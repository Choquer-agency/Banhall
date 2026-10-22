import { describe, expect, it } from "vitest";
import type { UIMessage } from "@convex-dev/agent";
import {
  MAX_PUBLIC_REASONING_CHARS,
  deltaHasReasoning,
  messageHasReasoning,
  publicChatDelta,
  publicChatMessage,
} from "./chatPublicOutput";
import { readUIMessageStream } from "ai";

function assistant(parts: unknown[]): UIMessage {
  return {
    id: "a", key: "a", role: "assistant", status: "success", order: 1,
    stepOrder: 1, _creationTime: 0, text: "A visible answer.", parts: parts as UIMessage["parts"],
  };
}

async function readStream(parts: unknown[]) {
  const stream = new ReadableStream({ start(controller) {
    parts.forEach(part => controller.enqueue(part)); controller.close();
  } });
  let final;
  for await (const message of readUIMessageStream({ stream: stream as never, terminateOnError: true })) final = message;
  return final;
}

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
    const final = await readStream(delta.parts);
    expect(final?.parts).toContainEqual(expect.objectContaining({ toolCallId: "c", state: "output-available", input: {} }));
    expect(JSON.stringify(final)).not.toContain("CANARY");
  });

  it("keeps thinking summaries and drops raw retrieval results while retaining tool IDs for proposal cards", () => {
    const message = assistant([
      { type: "text", text: "A visible answer.", providerMetadata: { anthropic: { private: "PRIVATE_TEXT_METADATA" } } },
      { type: "reasoning", text: "Checking Line 244 first.", state: "done",
        providerMetadata: { anthropic: { signature: "PRIVATE_SIGNATURE" } } },
      { type: "dynamic-tool", toolName: "deviationInventory", toolCallId: "call-1",
        state: "output-available", input: { query: "PRIVATE_ARGUMENT_CANARY" }, output: "PRIVATE_INVENTORY_CANARY",
        callProviderMetadata: { anthropic: { private: "PRIVATE_CALL_METADATA" } } },
    ]);
    const failed: UIMessage["parts"][number] = { type: "dynamic-tool", toolName: "proposeEdit", toolCallId: "failed",
      state: "output-error", input: { private: "PRIVATE_INPUT" }, errorText: "PRIVATE_ERROR" };
    // The pinned component mapper includes output on this state at runtime,
    // although the AI SDK's narrower UI type does not declare it.
    Reflect.set(failed, "output", "PRIVATE_OUTPUT");
    message.parts.push(failed);
    const visible = publicChatMessage(message);
    expect(JSON.stringify(visible)).not.toContain("PRIVATE_");
    expect(visible.text).toBe(message.text);
    expect(visible.parts[1]).toEqual({ type: "reasoning", text: "Checking Line 244 first.", state: "done" });
    expect(visible.parts[2]).toMatchObject({ toolCallId: "call-1", state: "output-available", input: {} });
    expect(visible.parts[3]).toMatchObject({ toolCallId: "failed", state: "output-error", errorText: "This step could not finish." });
    expect(message.parts).toHaveLength(4);
  });

  it("caps each saved reasoning part", () => {
    const long = "a".repeat(MAX_PUBLIC_REASONING_CHARS + 500);
    const visible = publicChatMessage(assistant([{ type: "reasoning", text: long }]));
    expect(visible.parts[0]).toEqual({ type: "reasoning", text: "a".repeat(MAX_PUBLIC_REASONING_CHARS) });
  });

  it("drops saved reasoning after a searchBrain call, and all of it for a Brain turn without the call", () => {
    const parts = [
      { type: "step-start" },
      { type: "reasoning", text: "Before the search." },
      { type: "tool-searchBrain", toolCallId: "b", state: "output-available", input: { query: "PRIVATE_QUERY" }, output: "PRIVATE_BRAIN_RESULT" },
      { type: "step-start" },
      { type: "reasoning", text: "PRIVATE_AFTER_BRAIN_SUMMARY" },
      { type: "text", text: "Here is a pattern." },
    ];
    const visible = publicChatMessage(assistant(parts), { brainSearched: true });
    expect(JSON.stringify(visible)).not.toContain("PRIVATE_");
    expect(visible.parts.map((part) => part.type)).toEqual(["step-start", "reasoning", "tool-searchBrain", "step-start", "text"]);
    expect(visible.parts[2]).toEqual({ type: "tool-searchBrain", toolCallId: "b", state: "output-available", input: {}, output: "Step completed. Review any proposed changes before applying." });
    // The same part order without the flag still hides what follows the call.
    expect(JSON.stringify(publicChatMessage(assistant(parts)))).not.toContain("PRIVATE_AFTER_BRAIN_SUMMARY");
    // A page that split the turn holds only later steps: nothing shows.
    const later = publicChatMessage(assistant([{ type: "reasoning", text: "PRIVATE_LATER" }, { type: "text", text: "Answer." }]), { brainSearched: true });
    expect(later.parts).toEqual([{ type: "text", text: "Answer." }]);
  });

  it("drops every part type it does not name (deny by default)", () => {
    const visible = publicChatMessage(assistant([
      { type: "text", text: "Kept." },
      { type: "file", mediaType: "application/pdf", url: "https://example.org/PRIVATE_FILE" },
      { type: "source-url", sourceId: "s", url: "https://example.org/PRIVATE_SOURCE" },
      { type: "source-document", sourceId: "d", mediaType: "text/plain", title: "PRIVATE_DOC" },
      { type: "data-progress", data: { private: "PRIVATE_DATA" } },
      { type: "future-kind", text: "PRIVATE_FUTURE" },
    ]));
    expect(visible.parts).toEqual([{ type: "text", text: "Kept." }]);
    expect(visible.metadata).toBeUndefined();
  });

  it("filters both SDK stream formats without changing their cursors", () => {
    const output = publicChatDelta({ streamId: "s", start: 4, end: 9, parts: [
      { type: "reasoning-start", id: "r", providerMetadata: { anthropic: { signature: "PRIVATE_SIGNATURE" } } },
      { type: "reasoning-delta", id: "r", delta: "Public summary." },
      { type: "reasoning-end", id: "r", providerMetadata: { anthropic: { signature: "PRIVATE_SIGNATURE" } } },
      { type: "tool-input-delta", toolCallId: "t", inputTextDelta: "PRIVATE_ARGUMENT_CHUNK" },
      { type: "tool-input-available", toolCallId: "t", toolName: "deviationInventory", input: { query: "PRIVATE_ARGUMENT" } },
      { type: "tool-result", toolCallId: "t", result: "PRIVATE_LEGACY_RESULT" },
      { type: "tool-output-available", toolCallId: "t2", output: "PRIVATE_RESULT" },
      { type: "tool-output-error", toolCallId: "t3", errorText: "PRIVATE_PROVIDER_ERROR" },
      { type: "tool-input-error", toolCallId: "t4", input: { private: "PRIVATE_INPUT" }, errorText: "PRIVATE_INPUT_ERROR" },
      { type: "source-url", sourceId: "x", url: "https://example.org/PRIVATE_SOURCE" },
      { type: "text-delta", id: "a", delta: "Visible answer" },
    ] });
    expect(output).toMatchObject({ streamId: "s", start: 4, end: 9 });
    expect(JSON.stringify(output)).not.toContain("PRIVATE_");
    expect(output.parts.slice(0, 3)).toEqual([
      { type: "reasoning-start", id: "r" },
      { type: "reasoning-delta", id: "r", delta: "Public summary." },
      { type: "reasoning-end", id: "r" },
    ]);
    expect(output.parts.at(-1)).toEqual({ type: "text-delta", id: "a", delta: "Visible answer" });
    // The TextStreamPart format carries `text`.
    expect(publicChatDelta({ streamId: "s", start: 9, end: 10, parts: [{ type: "reasoning-delta", id: "r", text: "Also public." }] }))
      .toEqual({ streamId: "s", start: 9, end: 10, parts: [{ type: "reasoning-delta", id: "r", text: "Also public." }] });
  });

  it("caps each streamed reasoning delta", () => {
    const output = publicChatDelta({ streamId: "s", start: 0, end: 1, parts: [
      { type: "reasoning-delta", id: "r", delta: "b".repeat(MAX_PUBLIC_REASONING_CHARS + 1) },
    ] });
    expect(output.parts).toEqual([{ type: "reasoning-delta", id: "r", delta: "b".repeat(MAX_PUBLIC_REASONING_CHARS) }]);
  });

  it("drops streamed reasoning after a searchBrain call, and all of it once the turn searched the Brain", async () => {
    const parts = [
      { type: "start", messageId: "m" },
      { type: "start-step" },
      { type: "reasoning-start", id: "r1" },
      { type: "reasoning-delta", id: "r1", delta: "Before the search." },
      { type: "reasoning-end", id: "r1" },
      { type: "tool-input-start", toolCallId: "b", toolName: "searchBrain" },
      { type: "tool-input-available", toolCallId: "b", toolName: "searchBrain", input: { query: "PRIVATE_QUERY" } },
      { type: "tool-output-available", toolCallId: "b", output: "PRIVATE_BRAIN_RESULT" },
      { type: "finish-step" },
      { type: "start-step" },
      { type: "reasoning-start", id: "r2" },
      { type: "reasoning-delta", id: "r2", delta: "PRIVATE_AFTER_BRAIN_SUMMARY" },
      { type: "reasoning-end", id: "r2" },
      { type: "text-start", id: "t" },
      { type: "text-delta", id: "t", delta: "Here is a pattern." },
      { type: "text-end", id: "t" },
      { type: "finish-step" },
      { type: "finish" },
    ];
    const same = publicChatDelta({ streamId: "s", start: 0, end: parts.length, parts });
    expect(JSON.stringify(same)).not.toContain("PRIVATE_");
    expect(JSON.stringify(same)).toContain("Before the search.");
    // The browser's own stream reader still accepts what is left.
    const final = await readStream(same.parts);
    expect(final?.parts.filter((part) => part.type === "reasoning")).toEqual([
      expect.objectContaining({ type: "reasoning", text: "Before the search." }),
    ]);

    const flagged = publicChatDelta({ streamId: "s", start: 0, end: parts.length, parts }, { brainSearched: true });
    expect(JSON.stringify(flagged)).not.toContain("reasoning");
    expect(JSON.stringify(flagged)).toContain("Here is a pattern.");
    expect(flagged).toMatchObject({ start: 0, end: parts.length });
  });

  it("says which deltas and messages hold reasoning", () => {
    expect(deltaHasReasoning({ streamId: "s", start: 0, end: 1, parts: [{ type: "reasoning-delta", id: "r", delta: "x" }] })).toBe(true);
    expect(deltaHasReasoning({ streamId: "s", start: 0, end: 1, parts: [{ type: "text-delta", id: "t", delta: "x" }] })).toBe(false);
    expect(messageHasReasoning(assistant([{ type: "reasoning", text: "x" }]))).toBe(true);
    expect(messageHasReasoning(assistant([{ type: "text", text: "x" }]))).toBe(false);
  });
});
