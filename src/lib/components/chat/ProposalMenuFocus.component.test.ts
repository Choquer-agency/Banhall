import { beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { UIMessage } from "@convex-dev/agent";
import type { Id } from "../../../../convex/_generated/dataModel";
import AgentChatPanel from "./AgentChatPanel.svelte";
import { __resetAuthState } from "$lib/test/convex-auth-stub";
import { __resetConvexStub, __setPaginatedRows, __setQueryData } from "$lib/test/convex-svelte-stub.svelte";

/** Review f2 #2: the suggested-edit More menu must hand focus to the field the action opens. */
const reportId = "report-1" as Id<"reports">;
const projectId = "project-1" as Id<"projects">;
function row(id: string, text: string, role: UIMessage["role"]): UIMessage {
  return { id, key: id, order: 1, stepOrder: role === "user" ? 0 : 1, role, status: "success", text, _creationTime: 1000, parts: [{ type: "text", text }] };
}
beforeEach(() => {
  __resetConvexStub(); __resetAuthState(); localStorage.clear();
  __setQueryData("chatV2:listThreads", [{ _id: "m1", agentThreadId: "thread-1", title: "Conversation" }]);
  __setQueryData("chatV2:listMessages", { streams: { kind: "list", messages: [] } });
  __setPaginatedRows("chatV2:listMessages", [row("q", "Tighten 242.", "user"), row("a", "Here is a tighter version.", "assistant")]);
  __setQueryData("chatV2:listTurns", []);
  __setQueryData("research:listSessions", []);
  __setQueryData("users:getCurrentUser", { _id: "writer-1", role: "writer" });
  __setQueryData("chatV2:listProposals", [{ _id: "proposal-1", _creationTime: 1000, agentThreadId: "thread-1", projectId, reportId, kind: "edit", targetText: "Old wording", newText: "Candidate wording", state: "pending", createdAt: 1000 }]);
});

const focusedLabel = () => document.activeElement?.getAttribute("aria-label");

it("leaves focus in the composer after Refine with AI", async () => {
  await render(AgentChatPanel, { reportId, projectId });
  await page.getByRole("button", { name: "More actions for this suggestion", exact: true }).click();
  await page.getByRole("menuitem", { name: "Refine with AI", exact: true }).click();
  await expect.element(page.getByText("Refining suggestion", { exact: true })).toBeVisible();
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(focusedLabel()).toBe("Message the report assistant");
});

it("focuses the wording field after Edit wording", async () => {
  await render(AgentChatPanel, { reportId, projectId });
  await page.getByRole("button", { name: "More actions for this suggestion", exact: true }).click();
  await page.getByRole("menuitem", { name: "Edit wording", exact: true }).click();
  await expect.element(page.getByRole("textbox", { name: "Edit replacement wording 1" })).toBeVisible();
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(focusedLabel()).toBe("Edit replacement wording 1");
});

it("leaves focus in the composer after Refine with AI chosen from the keyboard", async () => {
  await render(AgentChatPanel, { reportId, projectId });
  const trigger = page.getByRole("button", { name: "More actions for this suggestion", exact: true });
  (trigger.element() as HTMLElement).focus();
  await userEvent.keyboard("{Enter}");
  await expect.element(page.getByRole("menuitem", { name: "Refine with AI", exact: true })).toBeVisible();
  (page.getByRole("menuitem", { name: "Refine with AI", exact: true }).element() as HTMLElement).focus();
  await userEvent.keyboard("{Enter}");
  await expect.element(page.getByText("Refining suggestion", { exact: true })).toBeVisible();
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(focusedLabel()).toBe("Message the report assistant");
});

it("returns focus to the More button when the menu is dismissed with Escape", async () => {
  await render(AgentChatPanel, { reportId, projectId });
  const trigger = page.getByRole("button", { name: "More actions for this suggestion", exact: true });
  await trigger.click();
  await expect.element(page.getByRole("menuitem", { name: "Edit wording", exact: true })).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => document.activeElement).toBe(trigger.element());
});
