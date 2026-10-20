/**
 * Chat parity Phase C, package W3 (spec-chat-parity-phase-c): conversation
 * management (rename, archive, restore, admin delete), rich Copy, Copy
 * wording, starters that fill the composer, changeable feedback with
 * reasons, the Vet preset and the 44 px coarse-pointer floors. All data is
 * fictional.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { UIMessage } from "@convex-dev/agent";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";
import { __resetAuthState, __setAuthState } from "$lib/test/convex-auth-stub";
import {
  __activeQueryArgs,
  __mutationCalls,
  __resetConvexStub,
  __setMutationResult,
  __setPaginatedRows,
  __setQueryData,
} from "$lib/test/convex-svelte-stub.svelte";
import type { TurnWebSearch } from "$lib/chat/webSources";
import AgentChatPanel from "./AgentChatPanel.svelte";
import ProposedEditCard from "./ProposedEditCard.svelte";
import ResearchFeed from "$lib/components/research/ResearchFeed.svelte";
import { VET_LABEL } from "../../../../shared/researchPresets";

const sonner = vi.hoisted(() => ({
  error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn(),
}));
vi.mock("svelte-sonner", () => ({ toast: sonner }));

const CAPTURES = "../../../../.vitest-attachments/chat-parity-phase-c";
const reportId = "report-1" as Id<"reports">;
const projectId = "project-1" as Id<"projects">;
const composer = () => page.getByRole("textbox", { name: "Message the report assistant" });
const menu = () => page.getByRole("button", { name: "Conversation menu", exact: true });

function row(id: string, text: string, order: number, role: UIMessage["role"], extra: Partial<UIMessage> = {}): UIMessage {
  return {
    id, key: id, order, stepOrder: role === "user" ? 0 : 1, role, status: "success", text,
    _creationTime: 1000 + order, parts: [{ type: "text", text }], ...extra,
  } as UIMessage;
}

const THREADS = [
  { _id: "mapping-1", agentThreadId: "thread-1", title: "Kiln drying review", createdAt: 1, lastActivityAt: 5, startedByCurrentUser: true, webSearch: true },
  { _id: "mapping-2", agentThreadId: "thread-2", title: "Line 244 order", createdAt: 2, startedByCurrentUser: true, webSearch: true },
];

function seedConversation() {
  __setQueryData("chatV2:listThreads", THREADS);
  __setPaginatedRows("chatV2:listMessages", [
    row("q1", "How does the kiln drift?", 1, "user"),
    row("a1", "It drifts under load.", 1, "assistant"),
  ]);
  __setQueryData("chatV2:listTurns", [{ _id: "turn-1", promptMessageId: "q1", order: 1, status: "completed", startedAt: 1, endedAt: 2, stepCount: 1 }]);
}

beforeEach(() => {
  __resetConvexStub(); __resetAuthState(); localStorage.clear(); sessionStorage.clear();
  for (const fn of Object.values(sonner)) fn.mockClear();
  for (const name of ["chatV2:listThreads", "chatV2:listTurns", "chatV2:listProposals", "research:listSessions", "chatV2:listTurnWebSources", "chatV2:listArchivedThreads"]) {
    __setQueryData(name, []);
  }
  __setQueryData("chatV2:listMessages", { streams: { kind: "list", messages: [] } });
  __setPaginatedRows("chatV2:listMessages", []);
  __setQueryData("users:getCurrentUser", { _id: "writer-1", role: "writer" });
  __setQueryData("projects:getProjectEditAccess", { canEditDetails: true });
  __setQueryData("chatFeedback:getViewerVotes", []);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("conversation menu", () => {
  it("renames inline: Enter saves, Escape cancels", async () => {
    seedConversation();
    await render(AgentChatPanel, { reportId, projectId });
    await menu().click();
    await page.getByRole("menuitem", { name: "Conversation actions", exact: true }).first().click();
    await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
    const name = page.getByRole("textbox", { name: "Conversation name", exact: true });
    await expect.element(name).toHaveValue("Kiln drying review");
    await expect.element(name).toHaveFocus();
    await page.viewport(480, 760);
    await page.screenshot({ path: `${CAPTURES}/rename-inline.png` });
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => document.querySelector("[data-rename-conversation]")).toBeNull();
    expect(__mutationCalls("chatV2:renameThread")).toEqual([]);

    await menu().click();
    await page.getByRole("menuitem", { name: "Conversation actions", exact: true }).first().click();
    await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
    await name.fill("  Kiln   moisture review ");
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => __mutationCalls("chatV2:renameThread")).toEqual([{ threadId: "thread-1", title: "Kiln moisture review" }]);
    await expect.poll(() => document.querySelector("[data-rename-conversation]")).toBeNull();
  });

  it("archives a conversation, moves to the next one, and restores it from the archived list", async () => {
    seedConversation();
    __setQueryData("chatV2:listArchivedThreads", [
      { _id: "mapping-9", agentThreadId: "thread-9", title: "Old prototype notes", createdAt: 0, archivedAt: 3, webSearch: true },
    ]);
    await render(AgentChatPanel, { reportId, projectId });
    await expect.element(page.getByText("It drifts under load.")).toBeVisible();
    await menu().click();
    await page.getByRole("menuitem", { name: "Conversation actions", exact: true }).first().click();
    await page.getByRole("menuitem", { name: "Archive", exact: true }).click();
    await expect.poll(() => __mutationCalls("chatV2:archiveThread")).toEqual([{ threadId: "thread-1" }]);
    // The panel moves to the next open conversation.
    await expect.poll(() => __activeQueryArgs("chatV2:listProposals")).toEqual([{ threadId: "thread-2" }]);

    await menu().click();
    await page.getByRole("menuitem", { name: "Archived conversations", exact: true }).click();
    await expect.element(page.getByRole("menuitem", { name: "Old prototype notes", exact: true })).toBeVisible();
    await page.screenshot({ path: `${CAPTURES}/archived-conversations.png` });
    await page.getByRole("menuitem", { name: "Restore", exact: true }).click();
    await expect.poll(() => __mutationCalls("chatV2:restoreThread")).toEqual([{ threadId: "thread-9" }]);
  });

  it("opens an archived conversation to read, with a notice and Restore", async () => {
    seedConversation();
    __setQueryData("chatV2:listArchivedThreads", [
      { _id: "mapping-9", agentThreadId: "thread-9", title: "Old prototype notes", createdAt: 0, archivedAt: 3, webSearch: false },
    ]);
    await render(AgentChatPanel, { reportId, projectId });
    await menu().click();
    await page.getByRole("menuitem", { name: "Archived conversations", exact: true }).click();
    await page.getByRole("menuitem", { name: "Old prototype notes", exact: true }).click();
    await expect.element(page.getByText("This conversation is archived. Sending a message restores it.")).toBeVisible();
    await page.getByRole("button", { name: "Restore", exact: true }).click();
    await expect.poll(() => __mutationCalls("chatV2:restoreThread")).toEqual([{ threadId: "thread-9" }]);
  });

  it("offers Delete permanently to admins only, confirmed by Delete or Keep", async () => {
    seedConversation();
    const mounted = await render(AgentChatPanel, { reportId, projectId });
    await menu().click();
    await page.getByRole("menuitem", { name: "Conversation actions", exact: true }).first().click();
    await expect.element(page.getByRole("menuitem", { name: "Archive", exact: true })).toBeVisible();
    expect(page.getByRole("menuitem", { name: "Delete permanently" }).elements()).toHaveLength(0);
    await userEvent.keyboard("{Escape}");
    await userEvent.keyboard("{Escape}");
    await mounted.unmount();

    __setQueryData("users:getCurrentUser", { _id: "admin-1", role: "admin" });
    await render(AgentChatPanel, { reportId, projectId });
    await menu().click();
    await page.getByRole("menuitem", { name: "Conversation actions", exact: true }).first().click();
    await page.getByRole("menuitem", { name: "Delete permanently", exact: true }).click();
    const dialog = page.getByRole("alertdialog");
    await expect.element(dialog).toHaveTextContent("Delete this conversation for everyone? This can't be undone.");
    await expect.element(page.getByRole("button", { name: "Keep", exact: true })).toHaveFocus();
    await page.screenshot({ path: `${CAPTURES}/delete-conversation.png` });
    await page.getByRole("button", { name: "Keep", exact: true }).click();
    expect(__mutationCalls("chatV2:deleteThread")).toEqual([]);

    await menu().click();
    await page.getByRole("menuitem", { name: "Conversation actions", exact: true }).first().click();
    await page.getByRole("menuitem", { name: "Delete permanently", exact: true }).click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect.poll(() => __mutationCalls("chatV2:deleteThread")).toEqual([{ threadId: "thread-1" }]);
  });
});

describe("copy", () => {
  const SEARCHES: TurnWebSearch[] = [{
    promptMessageId: "q1", toolCallId: "toolu_1", query: "kiln drift", status: "ok",
    sources: [{ n: 1, url: "https://example.org/kiln", title: "Kiln drift", domain: "example.org" }],
  }];

  it("copies the rendered answer as HTML and plain text, citations as [n]", async () => {
    __setQueryData("chatV2:listThreads", THREADS);
    __setPaginatedRows("chatV2:listMessages", [
      row("q1", "How does the kiln drift?", 1, "user"),
      row("a1", "**Drift** rises under load [1].\n\n- First trial\n- Second trial", 1, "assistant"),
    ]);
    __setQueryData("chatV2:listTurns", [{ _id: "turn-1", promptMessageId: "q1", order: 1, status: "completed", startedAt: 1, endedAt: 2, stepCount: 1 }]);
    __setQueryData("chatV2:listTurnWebSources", SEARCHES);
    const items: Array<Record<string, Blob>> = [];
    class FakeClipboardItem {
      constructor(public data: Record<string, Blob>) { items.push(data); }
    }
    vi.stubGlobal("ClipboardItem", FakeClipboardItem);
    const write = vi.spyOn(navigator.clipboard, "write").mockResolvedValue();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    await render(AgentChatPanel, { reportId, projectId });
    await expect.element(page.getByRole("button", { name: "Source 1", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Copy", exact: true }).click();
    await expect.poll(() => write.mock.calls.length).toBe(1);
    expect(writeText).not.toHaveBeenCalled();
    const html = await items[0]["text/html"].text();
    const plain = await items[0]["text/plain"].text();
    expect(html).toContain("<strong");
    expect(html).toContain("<li");
    expect(html).toContain("[1]");
    expect(html).not.toContain("<button");
    expect(plain).toContain("Drift rises under load [1].");
    expect(plain).toContain("First trial");
    expect(plain).not.toContain("**");
    expect(plain).not.toContain("Source");
    await expect.element(page.getByRole("button", { name: "Copied", exact: true })).toBeVisible();
    await expect.poll(() => document.querySelector("[data-copy-announcement]")?.textContent?.trim()).toBe("Copied");
  });

  it("falls back to plain text when the browser has no ClipboardItem", async () => {
    seedConversation();
    vi.stubGlobal("ClipboardItem", undefined);
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    await render(AgentChatPanel, { reportId, projectId });
    await page.getByRole("button", { name: "Copy", exact: true }).click();
    await expect.poll(() => writeText.mock.calls).toEqual([["It drifts under load."]]);
  });

  it("Copy wording copies a card's proposed text, on pending, applied and stale cards", async () => {
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    const base = { targetText: "The kiln dried.", newText: "The kiln dried the birch to 8% moisture.", onReplace: vi.fn(), onReject: vi.fn() };
    const mounted = await render(ProposedEditCard, { ...base, state: "pending" });
    await page.getByRole("button", { name: "More actions for this suggestion", exact: true }).click();
    await page.getByRole("menuitem", { name: "Copy wording", exact: true }).click();
    await expect.poll(() => writeText.mock.calls).toEqual([["The kiln dried the birch to 8% moisture."]]);
    await expect.poll(() => document.querySelector("[data-copy-wording-announcement]")?.textContent?.trim()).toBe("Copied");
    await mounted.unmount();

    for (const state of ["applied", "stale"] as const) {
      const card = await render(ProposedEditCard, {
        ...base, state,
        replacements: [{ find: "kiln", replaceWith: "drying kiln" }, { find: "birch", replaceWith: "white birch" }],
        newText: undefined, targetText: undefined,
      });
      await page.getByRole("button", { name: "More actions for this suggestion", exact: true }).click();
      await page.getByRole("menuitem", { name: "Copy wording", exact: true }).click();
      await expect.poll(() => writeText.mock.lastCall).toEqual(["drying kiln\n\nwhite birch"]);
      await card.unmount();
    }
  });
});

describe("starters", () => {
  it("fill the empty composer and focus it without sending", async () => {
    await render(AgentChatPanel, { reportId, projectId });
    const starter = page.getByRole("button", { name: "Tighten the uncertainty framing in Line 242", exact: true });
    await expect.element(starter).toBeVisible();
    for (const text of ["Find every mention of the prototype", "Check this report for banned words", "Make Line 244 (work performed) more chronological"]) {
      await expect.element(page.getByRole("button", { name: text, exact: true })).toBeVisible();
    }
    await page.viewport(480, 760);
    await page.screenshot({ path: `${CAPTURES}/starters.png` });
    await starter.click();
    await expect.element(composer()).toHaveValue("Tighten the uncertainty framing in Line 242");
    await expect.element(composer()).toHaveFocus();
    expect(__mutationCalls("chatV2:sendMessage")).toEqual([]);
    // With text in the composer the starters step aside.
    await expect.poll(() => document.querySelector("[data-starters]")).toBeNull();
  });
});

describe("feedback", () => {
  it("can change a vote, offers reasons on thumbs down, and drops them on thumbs up", async () => {
    seedConversation();
    __setMutationResult("chatFeedback:submitFeedback", -1);
    await render(AgentChatPanel, { reportId, projectId });
    const helpful = page.getByRole("button", { name: "Mark response helpful", exact: true });
    const unhelpful = page.getByRole("button", { name: "Mark response not helpful", exact: true });
    await unhelpful.click();
    await expect.element(unhelpful).toHaveAttribute("aria-pressed", "true");
    await expect.element(page.getByText("Feedback recorded. You can change it.")).toBeVisible();
    for (const label of ["Wrong", "Didn't follow my request", "Made something up", "Too long", "Other"]) {
      await expect.element(page.getByRole("button", { name: label, exact: true })).toBeVisible();
    }
    const reasonText = page.getByRole("textbox", { name: "What went wrong? (optional)", exact: true });
    await expect.element(reasonText).toHaveAttribute("placeholder", "What went wrong? (optional)");
    await page.viewport(480, 760);
    await page.screenshot({ path: `${CAPTURES}/feedback-reasons.png` });

    await page.getByRole("button", { name: "Made something up", exact: true }).click();
    await expect.element(page.getByRole("button", { name: "Made something up", exact: true })).toHaveAttribute("aria-pressed", "true");
    await reasonText.fill("It named a standard that does not exist.");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect.poll(() => __mutationCalls("chatFeedback:submitFeedback")).toEqual([
      { turnId: "turn-1", vote: -1 },
      { turnId: "turn-1", vote: -1, reasonCode: "made_up" },
      { turnId: "turn-1", vote: -1, reasonCode: "made_up", reasonText: "It named a standard that does not exist." },
    ]);

    __setMutationResult("chatFeedback:submitFeedback", 1);
    await helpful.click();
    await expect.element(helpful).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => __mutationCalls("chatFeedback:submitFeedback").at(-1)).toEqual({ turnId: "turn-1", vote: 1 });
    await expect.poll(() => document.querySelector("[data-feedback-reasons]")).toBeNull();
  });

  it("shows a saved reason after reload", async () => {
    seedConversation();
    __setQueryData("chatFeedback:getViewerVotes", [{ turnId: "turn-1", vote: -1, reasonCode: "too_long", reasonText: "Half the length would do." }]);
    await render(AgentChatPanel, { reportId, projectId });
    await expect.element(page.getByRole("button", { name: "Too long", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect.element(page.getByRole("textbox", { name: "What went wrong? (optional)", exact: true })).toHaveValue("Half the length would do.");
  });
});

describe("Vet against public sources", () => {
  it("starts research with the preset, and the writer's text only as a note", async () => {
    __setMutationResult("research:startResearch", "session-1");
    await render(AgentChatPanel, {
      reportId, projectId,
      pendingResearch: { from: 1, to: 20, text: "Kiln drying above 80 C warps birch.", context: "", preset: "vet" },
    });
    await expect.element(page.getByText("Vet: Kiln drying above 80 C warps birch.")).toBeVisible();
    await expect.element(composer()).toHaveAttribute("placeholder", "Anything to focus on? (optional)");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect.poll(() => __mutationCalls("research:startResearch")).toEqual([{
      reportId, selectedText: "Kiln drying above 80 C warps birch.", selectionFrom: 1, selectionTo: 20,
      surroundingContext: "", instruction: "", preset: "vet",
    }]);
  });

  it("labels a vet session in the research feed", async () => {
    __setQueryData("research:listSessions", [{ _id: "session-1", selectedText: "Kiln drying above 80 C warps birch.", instruction: "", preset: "vet", status: "queued", createdAt: 1 }]);
    __setQueryData("research:getSessionDetails", null);
    await render(ResearchFeed, { reportId });
    await expect.element(page.getByText(VET_LABEL, { exact: true })).toBeVisible();
    expect(document.body.textContent).not.toContain("Research this passage");
  });
});

describe("44 px floors on a coarse pointer", () => {
  it("every listed chat control carries its pointer-coarse floor", async () => {
    seedConversation();
    __setQueryData("chatV2:listProposals", [{
      _id: "proposal-1", _creationTime: 1001, agentThreadId: "thread-1", projectId, reportId, kind: "edit",
      targetText: "It drifts.", newText: "It drifts under load.", state: "pending", createdAt: 1001, promptMessageId: "q1",
    } as unknown as Doc<"chatProposals">]);
    await render(AgentChatPanel, { reportId, projectId });
    const floor = /pointer-coarse:(min-h-11|h-11|size-11)/;
    const control = (name: string) => page.getByRole("button", { name, exact: true }).element() as HTMLElement;
    await expect.element(page.getByRole("button", { name: "Copy", exact: true })).toBeVisible();
    for (const name of ["Copy", "Mark response helpful", "Mark response not helpful", "Regenerate", "More actions for this suggestion", "Apply", "Dismiss"]) {
      expect(control(name).className, name).toMatch(floor);
    }
    // The Brain and web search chip removers widen their hit area, not the icon.
    await page.getByRole("button", { name: "Message options", exact: true }).click();
    await page.getByRole("menuitemcheckbox", { name: "Use Brain examples for this message" }).click();
    await userEvent.keyboard("{Escape}");
    for (const name of ["Stop using Brain examples for this message", "Turn off web search in this conversation"]) {
      const remover = control(name);
      expect(remover.className).toContain("size-4");
      expect(remover.className).toContain("pointer-coarse:before:-inset-3.5");
    }
    await menu().click();
    for (const item of [page.getByRole("menuitem", { name: "New conversation" }), page.getByRole("menuitem", { name: "Conversation actions", exact: true }).first()]) {
      expect((item.element() as HTMLElement).className).toMatch(floor);
    }
  });
});
