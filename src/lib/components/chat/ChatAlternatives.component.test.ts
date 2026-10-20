import { beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { ConvexError } from "convex/values";
import type { UIMessage } from "@convex-dev/agent";
import type { Id } from "../../../../convex/_generated/dataModel";
import AgentChatPanel from "./AgentChatPanel.svelte";
import { __resetAuthState } from "$lib/test/convex-auth-stub";
import {
  __mutationCalls,
  __resetConvexStub,
  __setMutationResult,
  __setPaginatedRows,
  __setQueryData,
} from "$lib/test/convex-svelte-stub.svelte";

/**
 * Report chat parity, Phase C (2026-10-20), W2: Edit, the alternatives
 * switcher, author lines and Regenerate as an alternative. Fictional data.
 */

const reportId = "report-1" as Id<"reports">;
const projectId = "project-1" as Id<"projects">;

function row(id: string, text: string, order: number, role: UIMessage["role"]): UIMessage {
  return {
    id, key: id, order, stepOrder: role === "user" ? 0 : 1, role, status: "success", text,
    _creationTime: 1000 + order, parts: [{ type: "text", text }],
  } as UIMessage;
}

type Turn = Record<string, unknown> & { order: number; promptMessageId: string };
function turn(promptMessageId: string, order: number, extra: Record<string, unknown> = {}): Turn {
  return { _id: `turn-${order}`, promptMessageId, order, status: "completed", startedAt: 1, endedAt: 2, stepCount: 0, fromCurrentUser: true, ...extra };
}

function seed(turns: Turn[] = [turn("q1", 1), turn("q2", 2)]) {
  __setQueryData("chatV2:listThreads", [{ _id: "mapping-1", agentThreadId: "thread-1", title: "Conversation" }]);
  __setQueryData("chatV2:listMessages", { streams: { kind: "list", messages: [] } });
  __setPaginatedRows("chatV2:listMessages", [
    row("q1", "Summarize Line 242.", 1, "user"), row("a1", "A summary.", 1, "assistant"),
    row("q2", "Now make it shorter.", 2, "user"), row("a2", "A shorter summary.", 2, "assistant"),
  ]);
  __setQueryData("chatV2:listTurns", turns);
  __setQueryData("chatV2:listProposals", []);
  __setQueryData("research:listSessions", []);
  __setQueryData("users:getCurrentUser", { _id: "writer-1", role: "writer" });
  __setQueryData("chatFeedback:getViewerVotes", []);
  __setMutationResult("chatV2:sendAlternative", { threadId: "thread-1", messageId: "alt" });
  __setMutationResult("chatV2:setActiveAlternative", { tipPromptMessageId: "q2" });
}

const editButtons = () => page.getByRole("button", { name: "Edit", exact: true });

beforeEach(() => {
  __resetConvexStub(); __resetAuthState(); localStorage.clear(); sessionStorage.clear();
  seed();
});

describe("Edit", () => {
  it("opens an inline editor with the message; Escape cancels without sending or closing anything", async () => {
    const outside = vi.fn();
    document.addEventListener("keydown", outside);
    await render(AgentChatPanel, { reportId, projectId });
    await expect.poll(() => editButtons().elements().length).toBe(2);
    await editButtons().nth(1).click();
    const editor = page.getByRole("textbox", { name: "Edit your message" });
    await expect.element(editor).toHaveValue("Now make it shorter.");
    await expect.element(editor).toHaveFocus();
    await expect.element(page.getByRole("button", { name: "Send", exact: true })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => page.getByRole("textbox", { name: "Edit your message" }).elements().length).toBe(0);
    expect(__mutationCalls("chatV2:sendAlternative")).toHaveLength(0);
    // The report page's Escape handler skips an event already handled.
    expect(outside.mock.calls.every(([event]) => (event as KeyboardEvent).key !== "Escape" || (event as KeyboardEvent).defaultPrevented)).toBe(true);
    await expect.element(page.getByText("Now make it shorter.", { exact: true })).toBeVisible();
    document.removeEventListener("keydown", outside);
  });

  it("Enter sends the edited text as an alternative of that turn", async () => {
    await render(AgentChatPanel, { reportId, projectId });
    await editButtons().nth(0).click();
    const editor = page.getByRole("textbox", { name: "Edit your message" });
    await editor.fill("Summarize Line 242 in two sentences.");
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => __mutationCalls("chatV2:sendAlternative")).toEqual([{
      threadId: "thread-1", ofPromptMessageId: "q1", kind: "edit", content: "Summarize Line 242 in two sentences.",
    }]);
    expect(__mutationCalls("chatV2:sendMessage")).toHaveLength(0);
    await expect.poll(() => page.getByRole("textbox", { name: "Edit your message" }).elements().length).toBe(0);
  });

  it("is not offered on an automatic Continue link or a turn still running", async () => {
    seed([turn("q1", 1, { origin: "auto_continue" }), turn("q2", 2, { status: "running", endedAt: undefined })]);
    __setPaginatedRows("chatV2:listMessages", [
      row("q1", "Continue with Line 244.", 1, "user"), row("a1", "Line 244 done.", 1, "assistant"),
      row("q2", "Now make it shorter.", 2, "user"),
    ]);
    await render(AgentChatPanel, { reportId, projectId });
    await expect.element(page.getByText("Continuing with Line 244", { exact: true })).toBeVisible();
    expect(editButtons().elements()).toHaveLength(0);
  });
});

describe("the switcher and author lines", () => {
  it("shows 2 / 3 with arrows, and switches for the conversation", async () => {
    seed([turn("q1", 1), turn("q2", 2, {
      alternatives: { index: 2, count: 3, previousPromptMessageId: "q2-first", nextPromptMessageId: "q2-third" },
      alternativeKind: "edit", alternativeAuthorName: "Avery Lane",
    })]);
    await render(AgentChatPanel, { reportId, projectId });
    const switcher = page.getByRole("group", { name: "Response 2 of 3", exact: true });
    await expect.element(switcher).toBeVisible();
    await expect.element(switcher).toHaveTextContent("2 / 3");
    await expect.element(page.getByText("Edited by you", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Previous response", exact: true }).click();
    await expect.poll(() => __mutationCalls("chatV2:setActiveAlternative")).toEqual([{ threadId: "thread-1", promptMessageId: "q2-first" }]);
    await page.getByRole("button", { name: "Next response", exact: true }).click();
    await expect.poll(() => __mutationCalls("chatV2:setActiveAlternative")).toEqual([
      { threadId: "thread-1", promptMessageId: "q2-first" }, { threadId: "thread-1", promptMessageId: "q2-third" },
    ]);
  });

  it("disables an arrow with nowhere to go, names someone else's alternative, and explains a refused switch", async () => {
    seed([turn("q1", 1), turn("q2", 2, {
      alternatives: { index: 2, count: 2, previousPromptMessageId: "q2-first" },
      alternativeKind: "regenerate", alternativeAuthorName: "Jordan Reyes", fromCurrentUser: false,
    })]);
    const error = new ConvexError({ code: "CHAT_TURN_ACTIVE", message: "busy" });
    __setMutationResult("chatV2:setActiveAlternative", { then(_resolve: unknown, reject: (reason: unknown) => void) { reject(error); } });
    await render(AgentChatPanel, { reportId, projectId });
    await expect.element(page.getByText("Regenerated by Jordan Reyes", { exact: true })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Next response", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Previous response", exact: true }).click();
    await expect.element(page.getByRole("alert")).toHaveTextContent("Wait for the reply to finish, then switch responses.");
  });

  it("shows no switcher for a turn with one response", async () => {
    await render(AgentChatPanel, { reportId, projectId });
    await expect.element(page.getByText("A shorter summary.", { exact: true })).toBeVisible();
    expect(page.getByRole("button", { name: "Previous response", exact: true }).elements()).toHaveLength(0);
  });
});

describe("Regenerate and short pages", () => {
  it("Regenerate makes an alternative instead of resending the text", async () => {
    await render(AgentChatPanel, { reportId, projectId });
    await page.getByRole("button", { name: "Regenerate", exact: true }).nth(1).click();
    await expect.poll(() => __mutationCalls("chatV2:sendAlternative")).toEqual([
      { threadId: "thread-1", ofPromptMessageId: "q2", kind: "regenerate" },
    ]);
    expect(__mutationCalls("chatV2:sendMessage")).toHaveLength(0);
  });

  it("a page holding only other alternatives' rows is not shown as an empty conversation", async () => {
    __setPaginatedRows("chatV2:listMessages", [], { more: true });
    __setQueryData("chatV2:listTurns", []);
    await render(AgentChatPanel, { reportId, projectId });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(page.getByText("How can I help with this report?", { exact: true }).elements()).toHaveLength(0);
  });
});
