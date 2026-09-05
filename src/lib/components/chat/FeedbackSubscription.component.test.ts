import { beforeEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { tick } from "svelte";
import type { UIMessage } from "@convex-dev/agent";
import type { Id } from "../../../../convex/_generated/dataModel";
import FeedbackSubscriptionHarness from "$lib/test/FeedbackSubscriptionHarness.svelte";
import { __resetAuthState } from "$lib/test/convex-auth-stub";
import { __resetConvexStub, __setPaginatedRows, __setQueryData, __useRealQuery } from "$lib/test/convex-svelte-stub.svelte";

function message(order: number, text: string, status: UIMessage["status"]): UIMessage {
  return { id: `answer-${order}`, key: `answer-${order}`, order, stepOrder: 1,
    role: "assistant", status, text, _creationTime: order,
    parts: [{ type: "text", text }] };
}

beforeEach(() => {
  __resetConvexStub();
  __resetAuthState();
  localStorage.clear();
});

it("retains the real feedback subscription while another answer streams, and cleans it up on unmount", async () => {
  // Transport fixtures use the same opaque IDs as the existing panel suites.
  const reportId = "report-1" as Id<"reports">;
  const projectId = "project-1" as Id<"projects">;
  __setQueryData("chatV2:listThreads", [{ agentThreadId: "thread-1", title: "Review" }]);
  __setQueryData("chatV2:listMessages", { streams: { kind: "list", messages: [] } });
  __setQueryData("chatV2:listTurns", [
    { _id: "turn-1", order: 1, status: "completed", stepCount: 1 },
    { _id: "turn-2", order: 2, status: "running", stepCount: 1 },
  ]);
  __setQueryData("chatV2:listProposals", []);
  __setQueryData("research:listSessions", []);
  __setQueryData("users:getCurrentUser", { _id: "writer-1", role: "writer" });
  __useRealQuery("chatFeedback:getViewerVotes");
  const completed = message(1, "Completed measurable answer.", "success");
  __setPaginatedRows("chatV2:listMessages", [completed, message(2, "Starting", "streaming")]);
  const events: Array<"subscribe" | "unsubscribe"> = [];
  const mounted = await render(FeedbackSubscriptionHarness, { props: { reportId, projectId, events } });
  await expect.element(page.getByRole("button", { name: "Mark response helpful", exact: true })).toBeEnabled();
  expect(events).toEqual(["subscribe"]);
  for (const text of ["First streamed update", "Second streamed update", "Third streamed update"]) {
    __setPaginatedRows("chatV2:listMessages", [completed, message(2, text, "streaming")]);
    await tick();
    await expect.element(page.getByText(text, { exact: true })).toBeVisible();
    expect(events).toEqual(["subscribe"]);
  }
  // A genuine change in eligible turn IDs must be observable by this harness.
  __setQueryData("chatV2:listTurns", [
    { _id: "turn-1", order: 1, status: "completed", stepCount: 1 },
    { _id: "turn-2", order: 2, status: "completed", stepCount: 1 },
  ]);
  __setPaginatedRows("chatV2:listMessages", [completed, message(2, "Second completed answer.", "success")]);
  await tick();
  await expect.element(page.getByText("Second completed answer.", { exact: true })).toBeVisible();
  expect(events).toEqual(["subscribe", "unsubscribe", "subscribe"]);
  await mounted.unmount();
  expect(events).toEqual(["subscribe", "unsubscribe", "subscribe", "unsubscribe"]);
});
