import { beforeEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import LazyAssistantHarness from "$lib/test/LazyAssistantHarness.svelte";
import type { Id } from "../../../../convex/_generated/dataModel";
import { __resetAuthState } from "$lib/test/convex-auth-stub";
import { __resetConvexStub, __setQueryData, __setPaginatedRows, __setMutationResult, __mutationCalls } from "$lib/test/convex-svelte-stub.svelte";
const ids = { reportId: "report-1" as Id<"reports">, projectId: "project-1" as Id<"projects"> };
beforeEach(() => {
  __resetAuthState(); __resetConvexStub(); localStorage.clear();
  for (const name of ["chatV2:listThreads", "chatV2:listTurns", "chatV2:listProposals", "research:listSessions"]) __setQueryData(name, []);
  __setQueryData("chatV2:listMessages", { streams: { kind: "list", messages: [] } });
  __setPaginatedRows("chatV2:listMessages", []);
});
it("does not request inactive code, offers retry, and keeps the mounted assistant after activation", async () => {
  const load = vi.fn<() => Promise<typeof import("$lib/components/chat/AgentChatPanel.svelte")>>()
    .mockRejectedValueOnce(new Error("Module fetch failed"))
    .mockImplementation(() => import("$lib/components/chat/AgentChatPanel.svelte"));
  const view = await render(LazyAssistantHarness, { ...ids, load, active: false });
  expect(load).not.toHaveBeenCalled();
  await view.rerender({ active: true });
  await expect.element(page.getByRole("alert")).toHaveTextContent("Could not load assistant");
  await page.getByRole("button", { name: "Retry assistant" }).click();
  const composer = page.getByRole("textbox", { name: "Message the report assistant" });
  await expect.element(composer).toBeVisible();
  const node = composer.element();
  await composer.fill("Retained after retry");
  await view.rerender({ active: false });
  await view.rerender({ active: true });
  expect(composer.element()).toBe(node);
  await expect.element(composer).toHaveValue("Retained after retry");
  expect(load).toHaveBeenCalledTimes(2);
});

it.each(["highlight", "research"])("delivers pending %s set while the real assistant module is still loading", async kind => {
  let release!: (module: typeof import("$lib/components/chat/AgentChatPanel.svelte")) => void;
  const load = () => new Promise<typeof import("$lib/components/chat/AgentChatPanel.svelte")>(resolve => { release = resolve; });
  const view = await render(LazyAssistantHarness, { ...ids, load });
  await expect.element(page.getByRole("status", { name: "Loading assistant", exact: true })).toBeVisible();
  const selection = { from: 5, to: 20, text: "Selected thermal evidence", context: "The report surroundings" };
  await view.rerender(kind === "highlight" ? { pendingHighlight: selection } : { pendingResearch: selection });
  release(await import("$lib/components/chat/AgentChatPanel.svelte"));
  const composer = page.getByRole("textbox", { name: "Message the report assistant" });
  await expect.element(composer).toBeVisible();
  await expect.element(page.getByRole("button", { name: kind === "highlight" ? "Remove pasted text" : "Remove research selection" })).toBeVisible();
  await composer.fill("Verify the measurement");
  __setMutationResult("chatV2:sendMessage", { threadId: "thread-1", messageId: "prompt-1" });
  __setMutationResult("research:startResearch", "research-1");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  if (kind === "highlight") {
    expect(__mutationCalls("chatV2:sendMessage")[0]).toMatchObject({ highlight: selection, content: "Verify the measurement" });
  } else {
    expect(__mutationCalls("research:startResearch")).toEqual([{ reportId: ids.reportId, selectedText: selection.text, selectionFrom: 5, selectionTo: 20, surroundingContext: selection.context, instruction: "Verify the measurement" }]);
  }
});
