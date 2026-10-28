import { describe, expect, it } from "vitest";
import { askedWriter, stopAfterQuestion } from "./chatAgentV2";

// Owner 2026-10-28: the AI's question ends the reply only once it reached the writer.
const step = (content: unknown[]) => ({ finishReason: "tool-calls", content });
const asked = step([
  { type: "tool-call", toolCallId: "ask-1", toolName: "askWriter", input: {} },
  { type: "tool-result", toolCallId: "ask-1", toolName: "askWriter", output: "Shown." },
]);
const refused = step([
  { type: "tool-call", toolCallId: "ask-2", toolName: "askWriter", input: {}, invalid: true },
  { type: "tool-error", toolCallId: "ask-2", toolName: "askWriter", error: "Too many options." },
]);

describe("askWriter ends the reply", () => {
  it("stops after a question that reached the writer", () => {
    expect(askedWriter(asked)).toBe(true);
    expect(stopAfterQuestion({ steps: [asked] })).toBe(true);
  });

  it("carries on after a refused question or any other tool", () => {
    expect(askedWriter(refused)).toBe(false);
    expect(stopAfterQuestion({ steps: [refused] })).toBe(false);
    expect(stopAfterQuestion({ steps: [step([{ type: "tool-result", toolName: "proposeEdit", toolCallId: "e" }])] })).toBe(false);
    expect(stopAfterQuestion({ steps: [] })).toBe(false);
  });
});
