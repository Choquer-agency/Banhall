import { afterEach, expect, it, vi } from "vitest";
import type { UIMessageChunk } from "ai";
import type { StreamMessage } from "@convex-dev/agent/validators";
import { deriveUIMessagesFromDeltas } from "./agentInternal";
import { createPersistentProjection } from "./persistentProjection";

const row = { streamId: "stream", format: "UIMessageChunk", status: "streaming", order: 0, stepOrder: 0 } satisfies StreamMessage;
afterEach(() => vi.restoreAllMocks());

it("matches every SDK prefix for standard framing, metadata, reasoning, partial tool JSON and transient data", async () => {
  vi.spyOn(Date, "now").mockReturnValue(123);
  const parts: UIMessageChunk[] = [
    { type: "start" }, { type: "start-step" },
    { type: "reasoning-start", id: "r" },
    { type: "reasoning-delta", id: "r", delta: "thought", providerMetadata: { a: { one: 1 } } },
    { type: "reasoning-end", id: "r", providerMetadata: { b: { two: 2 } } },
    { type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: "hello" },
    { type: "finish-step" }, { type: "start-step" },
    { type: "tool-input-start", toolCallId: "tool", toolName: "lookup" },
    { type: "tool-input-delta", toolCallId: "tool", inputTextDelta: '{"x":' },
    { type: "tool-input-delta", toolCallId: "tool", inputTextDelta: "1}" },
    { type: "tool-input-available", toolCallId: "tool", toolName: "lookup", input: { x: 1 } },
    { type: "tool-output-available", toolCallId: "tool", output: { ok: true } },
    { type: "data-progress", transient: true, data: { percent: 50 } },
    { type: "message-metadata", messageMetadata: { nested: { a: 1 } } },
    { type: "message-metadata", messageMetadata: { nested: { b: 2 } } },
    { type: "text-start", id: "t2" }, { type: "text-delta", id: "t2", delta: "second" },
    { type: "text-end", id: "t2" }, { type: "finish-step" }, { type: "finish", finishReason: "stop" },
  ];
  const projection = createPersistentProjection("thread", row);
  try {
    for (let index = 0; index < parts.length; index++) {
      await projection.append([parts[index]]);
      const [expected] = await deriveUIMessagesFromDeltas("thread", [row], [{ streamId: row.streamId, start: 0, end: index + 1, parts: parts.slice(0, index + 1) }]);
      expect(projection.snapshot(), `prefix ${index}: ${parts[index].type}`).toEqual(expected);
    }
    projection.updateStream({ ...row, status: "finished" });
    expect(projection.snapshot().status).toBe("success");
  } finally { await projection.dispose(); }
});

it("settles pending acknowledgments and drains disposal", async () => {
  const projection = createPersistentProjection("thread", row);
  const pending = projection.append([{ type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: "late" }]);
  await projection.dispose();
  await pending;
  await projection.append([{ type: "text-delta", id: "t", delta: "ignored" }]);
  expect(projection.snapshot().text).toBe("");
});

it.each(([
  [{ type: "text-delta", id: "missing", delta: "invalid" }],
  [{ type: "error", errorText: "failed provider" }],
] satisfies UIMessageChunk[][]).map(parts => ({ parts })))("rejects the same invalid sequence as authoritative derivation: %j", async ({ parts }) => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const projection = createPersistentProjection("thread", row);
  try {
    await expect(projection.append(parts)).rejects.toBeInstanceOf(Error);
    await expect(deriveUIMessagesFromDeltas("thread", [row], [{ streamId: row.streamId, start: 0, end: parts.length, parts }])).rejects.toBeInstanceOf(Error);
  } finally { await projection.dispose(); }
});

it("matches missing-tool suppression and ignores the remainder after terminal SDK suppression", async () => {
  const parts: UIMessageChunk[] = [{ type: "tool-output-available", toolCallId: "missing", output: {} }];
  vi.spyOn(Date, "now").mockReturnValue(123);
  const projection = createPersistentProjection("thread", row);
  try {
    await projection.append(parts);
    const [expected] = await deriveUIMessagesFromDeltas("thread", [row], [{ streamId: row.streamId, start: 0, end: 1, parts }]);
    expect(projection.snapshot()).toEqual(expected);
  } finally { await projection.dispose(); }
});

it("rejects a changed ID without cancelling the SDK output consumer", async () => {
  const projection = createPersistentProjection("thread", row);
  try {
    await projection.append([{ type: "text-start", id: "t" }]);
    await expect(projection.append([{ type: "start", messageId: "changed" }])).rejects.toThrow("Expecting to only make one UIMessage in a stream");
  } finally { await projection.dispose(); }
});

it("does not publish partial content from a failed batch", async () => {
  const projection = createPersistentProjection("thread", row);
  try {
    await projection.append([{ type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: "kept" }]);
    await expect(projection.append([{ type: "text-delta", id: "t", delta: "must not publish" }, { type: "error", errorText: "broken" }])).rejects.toBeInstanceOf(Error);
    expect(projection.snapshot().text).toBe("kept");
  } finally { await projection.dispose(); }
});

it("consumes concurrently queued batches in order with exact authoritative final output", async () => {
  vi.spyOn(Date, "now").mockReturnValue(123);
  const batches: UIMessageChunk[][] = [
    [{ type: "start" }, { type: "start-step" }, { type: "text-start", id: "t" }],
    [{ type: "text-delta", id: "t", delta: "A" }, { type: "text-delta", id: "t", delta: "B" }],
    [{ type: "text-delta", id: "t", delta: "C" }, { type: "text-end", id: "t" }, { type: "finish-step" }, { type: "finish", finishReason: "stop" }],
  ];
  const projection = createPersistentProjection("thread", row);
  try {
    const settled = await Promise.allSettled(batches.map(parts => projection.append(parts)));
    expect(settled.map(result => result.status)).toEqual(["fulfilled", "fulfilled", "fulfilled"]);
    const parts = batches.flat();
    const [expected] = await deriveUIMessagesFromDeltas("thread", [row], [{ streamId: row.streamId, start: 0, end: parts.length, parts }]);
    expect(projection.snapshot()).toEqual(expected);
    expect(projection.snapshot().text).toBe("ABC");
  } finally { await projection.dispose(); }
});

it("settles all queued callers after a middle-batch error and preserves the preceding published snapshot", async () => {
  const projection = createPersistentProjection("thread", row);
  try {
    await projection.append([{ type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: "kept" }]);
    const settled = await Promise.allSettled([
      projection.append([{ type: "text-delta", id: "t", delta: " A" }]),
      projection.append([{ type: "text-delta", id: "t", delta: " discarded" }, { type: "error", errorText: "middle batch failed" }]),
      projection.append([{ type: "text-delta", id: "t", delta: " never consumed" }]),
    ]);
    expect(settled.map(result => result.status)).toEqual(["fulfilled", "rejected", "rejected"]);
    expect(projection.snapshot().text).toBe("kept A");
  } finally { await projection.dispose(); }
});

it("settles queued appends on immediate disposal without changing the last published snapshot", async () => {
  const projection = createPersistentProjection("thread", row);
  await projection.append([{ type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: "kept" }]);
  const appends = Promise.allSettled([
    projection.append([{ type: "text-delta", id: "t", delta: " A" }]),
    projection.append([{ type: "text-delta", id: "t", delta: " B" }]),
    projection.append([{ type: "text-delta", id: "t", delta: " C" }]),
  ]);
  await projection.dispose();
  expect((await appends).map(result => result.status)).toEqual(["fulfilled", "fulfilled", "fulfilled"]);
  expect(projection.snapshot().text).toBe("kept");
});
