import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import UIMessagesHarness from "$lib/test/UIMessagesHarness.svelte";
import { __activeQueryArgs, __resetConvexStub, __setPaginatedRows, __setQueryDataForArgs } from "$lib/test/convex-svelte-stub.svelte";
import type { StreamDelta, StreamMessage } from "@convex-dev/agent/validators";
const query = "chatV2:listMessages";
const stream = (id: string, order = 0): StreamMessage => ({ streamId: id, order, stepOrder: 0, format: "UIMessageChunk", status: "streaming" });
function list(threadId: string, messages: StreamMessage[]) {
  __setQueryDataForArgs(query, { threadId, paginationOpts: { cursor: null, numItems: 0 }, streamArgs: { kind: "list", startOrder: 0 } }, { streams: { kind: "list", messages } });
}
function deltas(threadId: string, cursors: Array<{ streamId: string; cursor: number }>, values: StreamDelta[]) {
  __setQueryDataForArgs(query, { threadId, paginationOpts: { cursor: null, numItems: 0 }, streamArgs: { kind: "deltas", cursors } }, { streams: { kind: "deltas", deltas: values } });
}
const output = () => page.getByTestId("projection");
beforeEach(() => { __resetConvexStub(); __setPaginatedRows(query, []); });
afterEach(() => { vi.restoreAllMocks(); });

it("accepts contiguous batches once, waits for gaps, handles interleaving/status/removal and persisted authority", async () => {
  list("one", [stream("a"), stream("b", 1)]);
  deltas("one", [{ streamId: "a", cursor: 0 }, { streamId: "b", cursor: 0 }], [
    { streamId: "a", start: 0, end: 2, parts: [{ type: "start-step" }, { type: "text-start", id: "t" }] },
    { streamId: "b", start: 0, end: 2, parts: [{ type: "text-start", id: "b" }, { type: "text-delta", id: "b", delta: "other" }] },
  ]);
  await render(UIMessagesHarness, { threadId: "one" });
  await expect.element(output()).toHaveTextContent("other");
  const cursors = [{ streamId: "a", cursor: 2 }, { streamId: "b", cursor: 2 }];
  deltas("one", cursors, [
    { streamId: "a", start: 0, end: 2, parts: [{ type: "text-delta", id: "t", delta: "duplicate" }] },
    { streamId: "a", start: 3, end: 4, parts: [{ type: "text-delta", id: "t", delta: "gap" }] },
  ]);
  await new Promise(resolve => setTimeout(resolve, 40));
  await expect.element(output()).not.toHaveTextContent("duplicate");
  await expect.element(output()).not.toHaveTextContent("gap");
  expect(__activeQueryArgs(query)).toContainEqual(expect.objectContaining({ streamArgs: { kind: "deltas", cursors } }));
  deltas("one", cursors, [{ streamId: "a", start: 2, end: 3, parts: [{ type: "text-delta", id: "t", delta: "accepted" }] }]);
  await expect.poll(() => __activeQueryArgs(query)).toContainEqual(expect.objectContaining({ streamArgs: { kind: "deltas", cursors: [{ streamId: "a", cursor: 3 }, { streamId: "b", cursor: 2 }] } }));
  await expect.element(output()).toHaveTextContent("accepted");
  list("one", [{ ...stream("a"), status: "finished" }]);
  await expect.element(output()).not.toHaveTextContent("other");
  await expect.element(output()).toHaveTextContent('"status":"success"');
  __setPaginatedRows(query, [{ id: "saved", key: "saved", order: 0, stepOrder: 0, status: "success", role: "assistant", parts: [{ type: "text", text: "persisted final", state: "done" }], text: "persisted final", _creationTime: 1 }]);
  await expect.element(output()).toHaveTextContent("persisted final");
  await expect.element(output()).not.toHaveTextContent("accepted");
});

it("drops pending old-thread publication on thread switch and skip", async () => {
  list("one", [stream("a")]);
  deltas("one", [{ streamId: "a", cursor: 0 }], [{ streamId: "a", start: 0, end: 2, parts: [{ type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: "old thread" }] }]);
  list("two", []);
  const view = await render(UIMessagesHarness, { threadId: "one" });
  await view.rerender({ threadId: "two" });
  await expect.element(output()).toHaveTextContent("[]");
  await new Promise(resolve => setTimeout(resolve, 40));
  await expect.element(output()).not.toHaveTextContent("old thread");
  await view.rerender({ threadId: null });
  await expect.element(output()).toHaveTextContent("[]");
  expect(__activeQueryArgs(query)).toEqual([]);
});

it("keeps text and cursor through a loading list, then prunes a confirmed empty list", async () => {
  list("one", [stream("a")]);
  deltas("one", [{ streamId: "a", cursor: 0 }], [{ streamId: "a", start: 0, end: 2, parts: [{ type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: "retained" }] }]);
  await render(UIMessagesHarness, { threadId: "one" });
  await expect.element(output()).toHaveTextContent("retained");
  __setQueryDataForArgs(query, { threadId: "one", paginationOpts: { cursor: null, numItems: 0 }, streamArgs: { kind: "list", startOrder: 0 } }, undefined);
  await new Promise(resolve => setTimeout(resolve, 40));
  await expect.element(output()).toHaveTextContent("retained");
  list("one", [stream("a")]);
  await expect.poll(() => __activeQueryArgs(query)).toContainEqual(expect.objectContaining({ streamArgs: { kind: "deltas", cursors: [{ streamId: "a", cursor: 2 }] } }));
  deltas("one", [{ streamId: "a", cursor: 2 }], [{ streamId: "a", start: 2, end: 3, parts: [{ type: "text-delta", id: "t", delta: " plus new" }] }]);
  await expect.element(output()).toHaveTextContent("retained plus new");
  list("one", []);
  await expect.element(output()).toHaveTextContent("[]");
});

it("keeps healthy streams working beside an unsupported format and acknowledges only persisted user messages", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  list("one", [{ ...stream("old"), format: "TextStreamPart" }, stream("a", 1)]);
  deltas("one", [{ streamId: "old", cursor: 0 }, { streamId: "a", cursor: 0 }], [{ streamId: "a", start: 0, end: 2, parts: [{ type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: "healthy" }] }]);
  await render(UIMessagesHarness, { threadId: "one" });
  await expect.element(output()).toHaveTextContent("healthy");
  expect(error).toHaveBeenCalled();
  await expect.element(page.getByTestId("ack")).toHaveTextContent("false");
  __setPaginatedRows(query, [{ id: "persisted-user", key: "persisted-user", order: 0, stepOrder: 0, status: "success", role: "user", parts: [{ type: "text", text: "saved request" }], text: "saved request", _creationTime: 1 }]);
  await expect.element(page.getByTestId("ack")).toHaveTextContent("true");
});

it("consumes multiple contiguous deltas for one stream from a single subscription response", async () => {
  list("one", [stream("a")]);
  deltas("one", [{ streamId: "a", cursor: 0 }], [
    { streamId: "a", start: 3, end: 4, parts: [{ type: "text-delta", id: "t", delta: "C" }] },
    { streamId: "a", start: 0, end: 2, parts: [{ type: "start-step" }, { type: "text-start", id: "t" }] },
    { streamId: "a", start: 2, end: 3, parts: [{ type: "text-delta", id: "t", delta: "AB" }] },
  ]);
  await render(UIMessagesHarness, { threadId: "one" });
  await expect.element(output()).toHaveTextContent('"text":"ABC"');
  expect(__activeQueryArgs(query)).toContainEqual(expect.objectContaining({ streamArgs: { kind: "deltas", cursors: [{ streamId: "a", cursor: 4 }] } }));
});
