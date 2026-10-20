import { beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { Id } from "../../../../convex/_generated/dataModel";
import AgentChatPanel from "./AgentChatPanel.svelte";
import { __resetAuthState } from "$lib/test/convex-auth-stub";
import { __resetConvexStub, __setPaginatedRows, __setQueryData, __setMutationResult, __mutationCalls, __callOrder } from "$lib/test/convex-svelte-stub.svelte";

// Owner, 2026-10-19: the chat reads only typed text, so the composer offers
// no way to add a file and nothing in it hints that it could.
const reportId = "report-1" as Id<"reports">;
const projectId = "project-1" as Id<"projects">;
const options = () => page.getByRole("button", { name: "Message options", exact: true });
const brain = () => page.getByRole("menuitemcheckbox", { name: "Use Brain examples for this message" });
const brainChip = () => page.getByText("Brain examples", { exact: true });
const web = () => page.getByRole("menuitemcheckbox", { name: "Search the web for this message" });
const webChip = () => page.getByText("Web search", { exact: true });
const composer = () => page.getByRole("textbox", { name: "Message the report assistant" });
const uploadCalls = () => __callOrder().filter(name => name.startsWith("documents:") || name.startsWith("uploadAttempts:"));

beforeEach(() => {
  __resetConvexStub(); __resetAuthState(); localStorage.clear(); sessionStorage.clear();
  for (const name of ["chatV2:listThreads", "chatV2:listTurns", "chatV2:listProposals", "research:listSessions"]) __setQueryData(name, []);
  __setQueryData("chatV2:listMessages", { streams: { kind: "list", messages: [] } });
  __setPaginatedRows("chatV2:listMessages", []);
});

it("has no file input and no way to add a document", async () => {
  await render(AgentChatPanel, { reportId, projectId });
  await expect.element(composer()).toBeVisible();
  expect(document.querySelector('input[type="file"]')).toBeNull();
  expect(page.getByRole("button", { name: "Add to message", exact: true }).elements()).toHaveLength(0);
  await options().click();
  await expect.element(brain()).toBeVisible();
  // The Brain and web search choices are the menu's only entries.
  await expect.element(web()).toBeVisible();
  expect(page.getByRole("menuitem").elements()).toHaveLength(0);
  expect(page.getByRole("menuitemcheckbox").elements()).toHaveLength(2);
  expect(page.getByText("Add a document", { exact: false }).elements()).toHaveLength(0);
  expect(page.getByText("Project context", { exact: true }).elements()).toHaveLength(0);
  expect(page.getByRole("region", { name: "Uploads", exact: true }).elements()).toHaveLength(0);
  expect(document.querySelector('input[type="file"]')).toBeNull();
});

it("uploads nothing when a file is dropped or pasted on the composer", async () => {
  await render(AgentChatPanel, { reportId, projectId });
  const field = composer().element() as HTMLTextAreaElement;
  const files = new DataTransfer();
  files.items.add(new File(["Field notes"], "field-notes.txt", { type: "text/plain" }));
  field.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: files }));
  field.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: files }));
  field.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: files }));
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(uploadCalls()).toEqual([]);
  expect(page.getByText("field-notes.txt", { exact: false }).elements()).toHaveLength(0);
  expect(page.getByText("Pick a category", { exact: false }).elements()).toHaveLength(0);
});

it("keeps the Brain choice working from the keyboard", async () => {
  __setMutationResult("chatV2:sendMessage", { threadId: "thread-1", messageId: "prompt-1" });
  await render(AgentChatPanel, { reportId, projectId });
  (options().element() as HTMLElement).focus();
  await userEvent.keyboard("{Enter}");
  await expect.element(brain()).toHaveFocus();
  await expect.element(brain()).toHaveAttribute("aria-checked", "false");
  await userEvent.keyboard(" ");
  // The menu stays open so the writer sees the choice take effect.
  await expect.element(brain()).toHaveAttribute("aria-checked", "true");
  await userEvent.keyboard("{Escape}");
  await expect.element(brain()).not.toBeInTheDocument();
  await expect.element(options()).toHaveFocus();
  await expect.element(brainChip()).toBeVisible();
  await page.getByRole("button", { name: "Stop using Brain examples for this message", exact: true }).click();
  expect(brainChip().elements()).toHaveLength(0);
  await options().click();
  await expect.element(brain()).toHaveAttribute("aria-checked", "false");
  await brain().click();
  await userEvent.keyboard("{Escape}");
  await composer().fill("Use a past report as a structure example.");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect.poll(() => __mutationCalls("chatV2:sendMessage").length).toBe(1);
  expect(__mutationCalls("chatV2:sendMessage")[0]).toMatchObject({ allowBrain: true });
  expect(brainChip().elements()).toHaveLength(0);
  expect(uploadCalls()).toEqual([]);
});

// 2026-10-19: "Search the web" (terms and CRA only) mirrors the Brain choice.
it("offers web search for one message, shows its chip, and sends allowWeb only while on", async () => {
  __setMutationResult("chatV2:sendMessage", { threadId: "thread-1", messageId: "prompt-1" });
  await render(AgentChatPanel, { reportId, projectId });
  await options().click();
  await expect.element(web()).toHaveAttribute("aria-checked", "false");
  await web().click();
  // The menu stays open so the writer sees the choice take effect.
  await expect.element(web()).toHaveAttribute("aria-checked", "true");
  await expect.element(brain()).toHaveAttribute("aria-checked", "false");
  await userEvent.keyboard("{Escape}");
  await expect.element(webChip()).toBeVisible();
  expect(brainChip().elements()).toHaveLength(0);
  await page.getByRole("button", { name: "Stop searching the web for this message", exact: true }).click();
  expect(webChip().elements()).toHaveLength(0);
  await options().click();
  await expect.element(web()).toHaveAttribute("aria-checked", "false");
  await web().click();
  await userEvent.keyboard("{Escape}");
  await composer().fill("What does CRA mean by technological uncertainty?");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect.poll(() => __mutationCalls("chatV2:sendMessage").length).toBe(1);
  const sent = __mutationCalls("chatV2:sendMessage")[0] as Record<string, unknown>;
  expect(sent).toMatchObject({ allowWeb: true });
  expect(sent).not.toHaveProperty("allowBrain");
  // Cleared after the send, like the Brain choice.
  expect(webChip().elements()).toHaveLength(0);
  await options().click();
  await expect.element(web()).toHaveAttribute("aria-checked", "false");
  expect(uploadCalls()).toEqual([]);
});

it("hides message options while a research selection fills the composer", async () => {
  await render(AgentChatPanel, { reportId, projectId, pendingResearch: { from: 1, to: 2, text: "Passage", context: "Context" } });
  await expect.element(composer()).toHaveAttribute("placeholder", "What should the research verify?");
  expect(options().elements()).toHaveLength(0);
  expect(webChip().elements()).toHaveLength(0);
  expect(document.querySelector('input[type="file"]')).toBeNull();
});
