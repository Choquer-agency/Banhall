import { beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { UIMessage } from "@convex-dev/agent";
import type { Id } from "../../../../convex/_generated/dataModel";
import AgentChatPanel from "./AgentChatPanel.svelte";
import MessageContent from "./primitives/MessageContent.svelte";
import { __resetAuthState } from "$lib/test/convex-auth-stub";
import { __mutationCalls, __resetConvexStub, __setPaginatedRows, __setQueryData, __setQueryError } from "$lib/test/convex-svelte-stub.svelte";

// 2026-10-06: the Assistant shows one loading skeleton until its first data
// lands. The welcome and its starters never flash for a report that already
// has conversations, and Send waits for the conversation list, so a message
// never starts a new conversation by accident.
const ids = { reportId: "report-1" as Id<"reports">, projectId: "project-1" as Id<"projects"> };
const welcome = () => page.getByRole("heading", { name: "How can I help with this report?" });
const loading = () => page.getByRole("status", { name: "Loading assistant", exact: true });
const composer = () => page.getByRole("textbox", { name: "Message the report assistant" });
const rows: UIMessage[] = (["user", "assistant"] as const).map((role) => ({
  id: role, key: role, order: 1, stepOrder: role === "user" ? 0 : 1,
  role, status: "success", text: role === "user" ? "Stored prompt" : "Stored answer",
  parts: [{ type: "text", text: role === "user" ? "Stored prompt" : "Stored answer" }], _creationTime: 1000,
}));

/** Records whether the welcome heading was ever in the document. */
function watchWelcome() {
  const seen = { welcome: false };
  const check = () => {
    if ([...document.querySelectorAll("h2")].some((h) => h.textContent?.includes("How can I help with this report?"))) seen.welcome = true;
  };
  const observer = new MutationObserver(check);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  return { seen, stop: () => observer.disconnect() };
}

beforeEach(() => {
  __resetConvexStub(); __resetAuthState(); localStorage.clear();
  __setQueryData("chatV2:listMessages", { streams: { kind: "list", messages: [] } });
  __setQueryData("chatV2:listTurns", []);
  __setQueryData("chatV2:listProposals", []);
  __setQueryData("research:listSessions", []);
  __setQueryData("users:getCurrentUser", { _id: "writer-1", role: "writer" });
  __setQueryData("chatFeedback:getViewerVotes", []);
});

it("shows the skeleton, not the welcome, and holds Send until the conversation list arrives", async () => {
  const watch = watchWelcome();
  await render(AgentChatPanel, ids);
  await expect.element(loading()).toBeInTheDocument();
  await expect.element(composer()).toBeVisible();
  await composer().fill("Continue where we left off");
  await userEvent.keyboard("{Enter}");
  await expect.element(page.getByRole("button", { name: "Send message", exact: true })).toBeDisabled();
  expect(__mutationCalls("chatV2:sendMessage")).toHaveLength(0);
  expect(watch.seen.welcome).toBe(false);

  // An empty list: now the welcome is true, and Send works.
  __setQueryData("chatV2:listThreads", []);
  await expect.element(welcome()).toBeVisible();
  expect(loading().elements()).toHaveLength(0);
  await expect.element(page.getByRole("button", { name: "Send message", exact: true })).toBeEnabled();
  watch.stop();
});

it("never shows the welcome to a report with a conversation while it loads", async () => {
  const watch = watchWelcome();
  __setQueryData("chatV2:listThreads", [{ _id: "mapping-1", agentThreadId: "thread-1", title: "Earlier" }]);
  await render(AgentChatPanel, ids);
  // Threads are here but the conversation's first page is not.
  await expect.element(loading()).toBeInTheDocument();
  __setPaginatedRows("chatV2:listMessages", rows);
  await expect.element(page.getByText("Stored answer", { exact: true })).toBeVisible();
  expect(loading().elements()).toHaveLength(0);
  expect(watch.seen.welcome).toBe(false);
  watch.stop();
});

it("says a conversation could not load instead of loading forever, and holds Send", async () => {
  const watch = watchWelcome();
  __setQueryData("chatV2:listThreads", [{ _id: "mapping-1", agentThreadId: "thread-1", title: "Earlier" }]);
  __setQueryError("chatV2:listMessages", new Error("Thread unavailable"));
  await render(AgentChatPanel, ids);
  await expect.element(page.getByRole("alert")).toHaveTextContent("This conversation could not load.");
  expect(loading().elements()).toHaveLength(0);
  await composer().fill("Hello");
  await userEvent.keyboard("{Enter}");
  await expect.element(page.getByRole("button", { name: "Send message", exact: true })).toBeDisabled();
  expect(__mutationCalls("chatV2:sendMessage")).toHaveLength(0);
  expect(watch.seen.welcome).toBe(false);
  watch.stop();
});

it("never loads an image from a reply", async () => {
  await render(MessageContent, { markdown: true, text: "Here ![chart](https://outside.example/p.png?d=secret) it is." });
  await expect.element(page.getByText(/Image blocked/)).toBeVisible();
  expect(document.querySelector('img[src*="outside.example"]')).toBeNull();
});
