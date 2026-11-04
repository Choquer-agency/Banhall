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
  __setQueryDataForArgs,
  __setQueryError,
} from "$lib/test/convex-svelte-stub.svelte";
import type { TurnWebSearch } from "$lib/chat/webSources";
import AgentChatPanel from "./AgentChatPanel.svelte";
import ComposerOptionsPanel from "./ComposerOptionsPanel.svelte";
import ProposedEditCard from "./ProposedEditCard.svelte";
import ResearchFeed from "$lib/components/research/ResearchFeed.svelte";
import { VET_LABEL, VET_NOTE_MAX_CHARS } from "../../../../shared/researchPresets";
import { clipboardFragment, safeHref } from "$lib/chat/richCopy";
import { buildTiptapDocument } from "../../../../convex/lib/tiptapReport";

const sonner = vi.hoisted(() => ({
  error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn(),
}));
vi.mock("svelte-sonner", () => ({ toast: sonner }));

const CAPTURES = "../../../../.vitest-attachments/chat-parity-phase-c";
const reportId = "report-1" as Id<"reports">;
const projectId = "project-1" as Id<"projects">;
const composer = () => page.getByRole("textbox", { name: "Message the report assistant" });
const menu = () => page.getByRole("button", { name: "Chat history", exact: true });

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

/**
 * Whether a person can see and click a menu item where it is drawn: it is on
 * top at its own centre. Automation scrolls a clipped item into view before
 * it clicks, so a click alone does not prove this.
 */
function onTop(name: string) {
  const item = [...document.querySelectorAll<HTMLElement>("[role=menuitem]")].find((el) => el.textContent?.trim() === name);
  if (!item) return false;
  const box = item.getBoundingClientRect();
  const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
  return Boolean(hit && item.contains(hit));
}

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
    // The capture size is set before anything is focused: resizing the test
    // frame between focusing the field and pressing a key can move keyboard
    // focus out of the frame in a long suite run.
    await page.viewport(480, 760);
    seedConversation();
    await render(AgentChatPanel, { reportId, projectId });
    await menu().click();
    await page.getByRole("menuitem", { name: "Conversation actions", exact: true }).first().click();
    await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
    const name = page.getByRole("textbox", { name: "Conversation name", exact: true });
    await expect.element(name).toHaveValue("Kiln drying review");
    await expect.element(name).toHaveFocus();
    await page.screenshot({ path: `${CAPTURES}/rename-inline.png` });
    await userEvent.keyboard("{Escape}");
    // The viewport change and capture above can keep a busy browser behind
    // the key for over a second in the full suite; the wait allows for it.
    await expect.poll(() => document.querySelector("[data-rename-conversation]"), { timeout: 5000 }).toBeNull();
    expect(__mutationCalls("chatV2:renameThread")).toEqual([]);
    // Review R2 P3-3: focus returns to the menu button, never the page.
    await expect.element(menu()).toHaveFocus();

    await menu().click();
    await page.getByRole("menuitem", { name: "Conversation actions", exact: true }).first().click();
    await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
    await name.fill("  Kiln   moisture review ");
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => __mutationCalls("chatV2:renameThread"), { timeout: 5000 }).toEqual([{ threadId: "thread-1", title: "Kiln moisture review" }]);
    await expect.poll(() => document.querySelector("[data-rename-conversation]"), { timeout: 5000 }).toBeNull();
    await expect.element(menu()).toHaveFocus();
  });

  it("Escape from the rename buttons cancels too", async () => {
    seedConversation();
    await render(AgentChatPanel, { reportId, projectId });
    await menu().click();
    await page.getByRole("menuitem", { name: "Conversation actions", exact: true }).first().click();
    await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
    await expect.element(page.getByRole("textbox", { name: "Conversation name", exact: true })).toHaveFocus();
    await userEvent.keyboard("{Tab}");
    await expect.element(page.getByRole("button", { name: "Save", exact: true })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => document.querySelector("[data-rename-conversation]")).toBeNull();
    await expect.element(menu()).toHaveFocus();
  });

  // Owner hand test 2026-10-21: the actions submenu was drawn inside the
  // scrolling conversation menu, which clipped it out of sight. Automation
  // scrolls a clipped item into view before it clicks, so this checks what a
  // person sees: each item on top at its own centre, nothing scrolled.
  it("shows a conversation's actions where a person can click them", async () => {
    await page.viewport(1024, 760);
    seedConversation();
    await render(AgentChatPanel, { reportId, projectId });
    await menu().click();
    await userEvent.hover(page.getByRole("menuitem", { name: "Conversation actions", exact: true }).first());
    await expect.poll(() => onTop("Rename"), { timeout: 5000 }).toBe(true);
    expect(onTop("Archive")).toBe(true);
    for (const scroller of document.querySelectorAll<HTMLElement>("[role=menu]")) expect(scroller.scrollLeft).toBe(0);
  });

  // Fable 5.1 review P3-1: the row stayed open, naming the conversation left behind.
  it("closes the rename row when the writer moves to another conversation", async () => {
    seedConversation();
    await render(AgentChatPanel, { reportId, projectId });
    const name = page.getByRole("textbox", { name: "Conversation name", exact: true });
    for (const destination of ["Line 244 order", "New conversation"]) {
      await menu().click();
      await page.getByRole("menuitem", { name: "Conversation actions", exact: true }).first().click();
      await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
      await expect.element(name).toHaveFocus();
      if (destination === "New conversation") {
        await page.getByRole("button", { name: "New conversation", exact: true }).click();
      } else {
        await menu().click();
        await page.getByRole("menuitem", { name: destination }).first().click();
      }
      await expect.poll(() => document.querySelector("[data-rename-conversation]"), { timeout: 5000 }).toBeNull();
    }
    expect(__mutationCalls("chatV2:renameThread")).toEqual([]);
  });

  it("leaves a conversation someone else deleted (review R2 P3-2)", async () => {
    seedConversation();
    await render(AgentChatPanel, { reportId, projectId });
    await expect.element(page.getByText("It drifts under load.")).toBeVisible();
    await expect.poll(() => __activeQueryArgs("chatV2:listProposals")).toEqual([{ threadId: "thread-1" }]);
    expect(__activeQueryArgs("chatV2:threadStatus")).toEqual([]);
    // Another admin deletes it: it leaves both lists, and its own status
    // (read by id only now) says it is being deleted.
    __setQueryDataForArgs("chatV2:threadStatus", { threadId: "thread-1" }, "deleting");
    __setQueryData("chatV2:listThreads", THREADS.slice(1));
    await expect.poll(() => __activeQueryArgs("chatV2:listProposals")).toEqual([{ threadId: "thread-2" }]);
    expect(Object.values({ ...sessionStorage }).join(" ")).not.toContain("thread-1");
    // With nothing left (this one gone outright), the panel starts a new one.
    __setQueryDataForArgs("chatV2:threadStatus", { threadId: "thread-2" }, "missing");
    __setQueryData("chatV2:listThreads", []);
    await expect.poll(() => __activeQueryArgs("chatV2:listProposals")).toEqual([]);
  });

  it.each(["open", "archived"] as const)("stays on a conversation that only dropped out of the bounded lists (%s, round 2 N2)", async (status) => {
    seedConversation();
    __setQueryDataForArgs("chatV2:threadStatus", { threadId: "thread-1" }, status);
    await render(AgentChatPanel, { reportId, projectId });
    await expect.element(page.getByText("It drifts under load.")).toBeVisible();
    // Fifty newer conversations push it out of the open list.
    __setQueryData("chatV2:listThreads", Array.from({ length: 50 }, (_, i) => ({
      _id: `mapping-n${i}`, agentThreadId: `thread-n${i}`, title: `Newer ${i}`, createdAt: 10 + i, startedByCurrentUser: true, webSearch: true,
    })));
    await expect.poll(() => __activeQueryArgs("chatV2:threadStatus")).toEqual([{ threadId: "thread-1" }]);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(__activeQueryArgs("chatV2:listProposals")).toEqual([{ threadId: "thread-1" }]);
    await expect.element(page.getByText("It drifts under load.")).toBeVisible();
  });

  it("keeps a conversation that is not listed yet (its first send)", async () => {
    __setQueryData("chatV2:listThreads", []);
    __setMutationResult("chatV2:sendMessage", { threadId: "thread-new", messageId: "m-1" });
    await render(AgentChatPanel, { reportId, projectId });
    await composer().fill("A fresh question");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect.poll(() => __activeQueryArgs("chatV2:listProposals")).toEqual([{ threadId: "thread-new" }]);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(__activeQueryArgs("chatV2:listProposals")).toEqual([{ threadId: "thread-new" }]);
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
    // The archived list renders outside the scrolling menu, as the actions do.
    await expect.poll(() => onTop("Restore"), { timeout: 5000 }).toBe(true);
    for (const scroller of document.querySelectorAll<HTMLElement>("[role=menu]")) expect(scroller.scrollLeft).toBe(0);
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
    await expect.element(menu()).toHaveFocus();

    await menu().click();
    await page.getByRole("menuitem", { name: "Conversation actions", exact: true }).first().click();
    await page.getByRole("menuitem", { name: "Delete permanently", exact: true }).click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect.poll(() => __mutationCalls("chatV2:deleteThread")).toEqual([{ threadId: "thread-1" }]);
    await expect.element(menu()).toHaveFocus();
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
    const props = (wording: string[], extra: { state: "pending" | "applied" | "stale" }) => ({
      options: [wording], changesFor: () => [], onReview: vi.fn(), onStopReview: vi.fn(), onAccept: vi.fn(async () => {}), ...extra,
    });
    const mounted = await render(ProposedEditCard, props(["The kiln dried the birch to 8% moisture."], { state: "pending" }));
    await page.getByRole("button", { name: "Show the suggestion" }).click();
    await page.getByRole("button", { name: "More actions for this suggestion", exact: true }).click();
    await page.getByRole("menuitem", { name: "Copy wording", exact: true }).click();
    await expect.poll(() => writeText.mock.calls).toEqual([["The kiln dried the birch to 8% moisture."]]);
    await expect.poll(() => document.querySelector("[data-copy-wording-announcement]")?.textContent?.trim()).toBe("Copied");
    await mounted.unmount();

    for (const state of ["applied", "stale"] as const) {
      const card = await render(ProposedEditCard, props(["drying kiln", "white birch"], { state }));
      if (state === "applied") await page.getByRole("button", { name: "Show what was accepted" }).click();
      await page.getByRole("button", { name: "More actions for this suggestion", exact: true }).click();
      await page.getByRole("menuitem", { name: "Copy wording", exact: true }).click();
      await expect.poll(() => writeText.mock.lastCall).toEqual(["drying kiln\n\nwhite birch"]);
      await card.unmount();
    }
  });
});

// Owner 2026-10-28: every card names its Line; a find/replace card says it
// replaces every match inside that Line.
describe("a card names its Line", () => {
  it("labels a passage set and a find set by their Line", async () => {
    const props = (everyMatch: boolean) => ({
      line: "242", options: [["The kiln dried birch.", "The press shaped panels."]], changesFor: () => [], everyMatch,
      state: "pending" as const, onReview: vi.fn(), onStopReview: vi.fn(), onAccept: vi.fn(async () => {}),
    });
    const set = await render(ProposedEditCard, props(false));
    await expect.poll(() => document.querySelector("[data-proposed-edit-label]")?.textContent?.trim()).toBe("Line 242");
    await page.getByRole("button", { name: "Show the suggestion" }).click();
    expect(document.body.textContent).not.toContain("Replaces every match");
    await set.unmount();
    await render(ProposedEditCard, props(true));
    await expect.poll(() => document.querySelector("[data-proposed-edit-label]")?.textContent?.trim()).toBe("Line 242");
    await page.getByRole("button", { name: "Show the suggestion" }).click();
    expect(document.body.textContent).toContain("Replaces every match in Line 242.");
  });
});

describe("rich copy keeps only text, structure and safe links (review R2 P3-6)", () => {
  it("drops scripts, styles, handlers and unsafe links", () => {
    const answer = document.createElement("div");
    answer.setAttribute("onclick", "alert(1)");
    answer.innerHTML = [
      '<p style="color:red" onclick="alert(2)" class="chat-p" data-x="1">Kiln <strong id="s1" onmouseover="alert(3)">drift</strong> rises.</p>',
      '<script>window.__copied = 1</script><style>p { color: red }</style>',
      '<a href="https://example.org/kiln" target="_blank" rel="noopener" onclick="alert(4)">Kiln source</a>',
      '<a href="javascript:alert(5)">bad</a> <a href="data:text/html,hi">worse</a> <a href="/relative">rel</a>',
      '<img src="https://outside.example/x.png" onerror="alert(6)"><svg><script>alert(7)</script></svg>',
      '<custom-tag foo="bar">kept text</custom-tag><!-- private note -->',
    ].join("");
    const fragment = clipboardFragment(answer);
    const html = fragment.innerHTML;
    for (const banned of ["<script", "<style", "style=", "onclick", "onmouseover", "onerror", "javascript:", "data:", "class=", "data-x", "id=", "target=", "<img", "<svg", "custom-tag", "private note", "alert("]) {
      expect(html, banned).not.toContain(banned);
    }
    expect(html).toContain('<a href="https://example.org/kiln">Kiln source</a>');
    expect(html).toContain("<strong>drift</strong>");
    expect(html).toContain("<a>bad</a>");
    expect(html).toContain("kept text");
    expect(fragment.getAttributeNames()).toEqual([]);
    expect(safeHref("mailto:writer@example.com")).toBe("mailto:writer@example.com");
    expect(safeHref("  JavaScript:alert(1)")).toBeNull();
  });
});

// Owner 2026-10-28 (row 37): options take the message box's place. A new
// conversation offers one "Shorten Line N" option for each Line over its CRA
// limit; the AI's question offers its own. A pick is sent at once.
describe("options above the message box", () => {
  const words = (count: number) => Array.from({ length: count }, (_, index) => `word${index}`).join(" ");
  const overLimit = JSON.stringify(buildTiptapDocument("Report", words(385), words(20), words(30)));
  // Every Line fits and none is under half its word limit.
  const settled = JSON.stringify(buildTiptapDocument("Report", words(200), words(400), words(200)));

  it("offers a new conversation one Shorten option per Line over its limit, and sends a pick at once", async () => {
    __setMutationResult("chatV2:sendMessage", { threadId: "thread-new", messageId: "q-new" });
    await page.viewport(480, 760);
    await render(AgentChatPanel, { reportId, projectId, reportContent: overLimit });
    await expect.element(page.getByText("Get started", { exact: true })).toBeVisible();
    await expect.element(page.getByText("What should we work on?", { exact: true })).toBeVisible();
    await expect.element(page.getByRole("option", { name: /Shorten Line 242 to 350 words/ })).toBeVisible();
    await expect.element(page.getByRole("option", { name: /Something else/ })).toBeVisible();
    expect(page.getByText("New conversation", { exact: true }).elements().length).toBeGreaterThan(0);
    await page.screenshot({ path: `${CAPTURES}/get-started.png` });
    await page.getByRole("option", { name: /Shorten Line 242 to 350 words/ }).click();
    await expect.poll(() => (__mutationCalls("chatV2:sendMessage")[0] as { content?: string } | undefined)?.content).toBe("Shorten Line 242 to 350 words");
  });

  // Owner 2026-10-29: options in every new conversation, built from the report.
  it("offers the source check when nothing needs work, the QA run's issues, and the message box after Skip", async () => {
    const first = await render(AgentChatPanel, { reportId, projectId, reportContent: settled });
    await expect.element(page.getByText("Get started", { exact: true })).toBeVisible();
    await expect.element(page.getByRole("option", { name: /Check the report for claims the source files don't support/ })).toBeVisible();
    expect(page.getByRole("option").elements()).toHaveLength(2);
    await page.getByRole("button", { name: /Skip/ }).click();
    await expect.element(composer()).toBeVisible();
    expect(__mutationCalls("chatV2:sendMessage")).toEqual([]);
    first.unmount();

    await render(AgentChatPanel, {
      reportId, projectId, reportContent: settled,
      qaIssues: [{ line: "244", text: "No baseline is stated for the first experiment." }],
    });
    await expect.element(page.getByRole("option", { name: /Fix the QA issue in Line 244: No baseline is stated/ })).toBeVisible();
    expect(page.getByRole("option", { name: /Check the report for claims/ }).elements()).toHaveLength(0);
  });

  it("goes to the message box with what is typed on Get started, digits included, and never sends", async () => {
    await render(AgentChatPanel, { reportId, projectId, reportContent: settled });
    await expect.element(page.getByText("Get started", { exact: true })).toBeVisible();
    await userEvent.keyboard("2 things to fix");
    await expect.element(composer()).toHaveValue("2 things to fix");
    expect(page.getByText("Get started", { exact: true }).elements()).toHaveLength(0);
    expect(__mutationCalls("chatV2:sendMessage")).toEqual([]);
  });

  it("keeps the message box once it has held a selection, after the selection is cleared", async () => {
    // Typing on the panel already skips it; a selection sent from the page
    // is the path only the message box's own record covers.
    const view = await render(AgentChatPanel, {
      reportId, projectId, reportContent: settled,
      pendingHighlight: { from: 1, to: 12, text: "word0 word1" },
    });
    await expect.element(composer()).toBeVisible();
    expect(page.getByText("Get started", { exact: true }).elements()).toHaveLength(0);
    await view.rerender({ pendingHighlight: null });
    await new Promise((resolve) => setTimeout(resolve, 200));
    await expect.element(composer()).toBeVisible();
    expect(page.getByText("Get started", { exact: true }).elements()).toHaveLength(0);
  });

  it("offers no options while research the writer started is being published, here or in a new conversation", async () => {
    __setMutationResult("research:startResearch", "session-1");
    const view = await render(AgentChatPanel, {
      reportId, projectId, reportContent: settled,
      pendingResearch: { from: 1, to: 20, text: "Kiln drying above 80 C warps birch.", context: "", preset: "vet" },
    });
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect.poll(() => __mutationCalls("research:startResearch").length).toBe(1);
    // The page clears the selection once research starts.
    await view.rerender({ pendingResearch: null });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(page.getByText("Get started", { exact: true }).elements()).toHaveLength(0);
    await page.getByRole("button", { name: "New conversation", exact: true }).click();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(page.getByText("Get started", { exact: true }).elements()).toHaveLength(0);
    await expect.element(composer()).toBeVisible();
  });

  it("keeps the message box where research was sent once it finishes, and offers Get started in a fresh conversation", async () => {
    __setMutationResult("research:startResearch", "session-1");
    const view = await render(AgentChatPanel, {
      reportId, projectId, reportContent: settled,
      pendingResearch: { from: 1, to: 20, text: "Kiln drying above 80 C warps birch.", context: "", preset: "vet" },
    });
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect.poll(() => __mutationCalls("research:startResearch").length).toBe(1);
    await view.rerender({ pendingResearch: null });
    // The research finishes: the hold ends.
    __setQueryData("research:getSessionDetails", null);
    __setQueryData("research:listSessions", [{ _id: "session-1", selectedText: "Kiln drying above 80 C warps birch.", instruction: "", preset: "vet", status: "completed", createdAt: 1 }]);
    await expect.poll(() => page.getByRole("button", { name: "Send message", exact: true }).elements().length).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(page.getByText("Get started", { exact: true }).elements()).toHaveLength(0);
    await expect.element(composer()).toBeVisible();
    await page.getByRole("button", { name: "New conversation", exact: true }).click();
    await expect.element(page.getByText("Get started", { exact: true })).toBeVisible();
  });

  it("shows no options over a conversation list that could not load", async () => {
    // The list failed before any data (this file's setup seeds an empty one).
    __setQueryData("chatV2:listThreads", undefined);
    __setQueryError("chatV2:listThreads", new Error("Threads unavailable"));
    await render(AgentChatPanel, { reportId, projectId, reportContent: settled });
    await expect.element(page.getByRole("alert")).toHaveTextContent("Your conversations could not load.");
    await expect.element(composer()).toBeVisible();
    expect(page.getByText("Get started", { exact: true }).elements()).toHaveLength(0);
  });

  it("shows no options over a conversation that could not load", async () => {
    __setQueryData("chatV2:listThreads", THREADS);
    __setQueryError("chatV2:listMessages", new Error("Thread unavailable"));
    await render(AgentChatPanel, { reportId, projectId, reportContent: settled });
    await expect.element(page.getByRole("alert")).toHaveTextContent("This conversation could not load.");
    expect(page.getByText("Get started", { exact: true }).elements()).toHaveLength(0);
  });

  it("waits for the page's QA reads before showing Get started", async () => {
    const view = await render(AgentChatPanel, { reportId, projectId, reportContent: settled, qaLoading: true });
    await expect.element(composer()).toBeVisible();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(page.getByText("Get started", { exact: true }).elements()).toHaveLength(0);
    await view.rerender({ qaLoading: false, qaIssues: [{ line: "246", text: "Advancement is vague." }] });
    await expect.element(page.getByRole("option", { name: /Fix the QA issue in Line 246: Advancement is vague\./ })).toBeVisible();
  });

  it("keeps the highlighted option inside the list when the options shrink", async () => {
    const picked: unknown[] = [];
    const view = await render(ComposerOptionsPanel, {
      label: "Get started", question: "What should we work on?", options: ["First", "Second", "Third"],
      onSelect: (text: string) => picked.push(text), onSkip: () => {}, onType: () => {},
    });
    const list = document.querySelector<HTMLElement>("[role=listbox]")!;
    list.focus();
    for (let step = 0; step < 3; step++) await userEvent.keyboard("{ArrowDown}");
    await view.rerender({ options: ["First"] });
    await userEvent.keyboard("{Enter}");
    expect(picked).toEqual(["First"]);
  });

  it("never picks an option on Ctrl, Cmd or Alt with a digit", async () => {
    await render(AgentChatPanel, { reportId, projectId, reportContent: settled });
    await expect.element(page.getByText("Get started", { exact: true })).toBeVisible();
    // Ctrl and Cmd are shortcuts: the panel stays and nothing is sent.
    for (const modifier of ["Control", "Meta"]) await userEvent.keyboard(`{${modifier}>}1{/${modifier}}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(__mutationCalls("chatV2:sendMessage")).toEqual([]);
    await expect.element(page.getByText("Get started", { exact: true })).toBeVisible();
    // Alt is a shortcut outside a Mac and types on one (this browser says
    // Mac): either way it never picks.
    await userEvent.keyboard("{Alt>}1{/Alt}");
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(__mutationCalls("chatV2:sendMessage")).toEqual([]);
  });

  it("offers Get started in a new conversation on a report with research sessions", async () => {
    __setQueryData("research:listSessions", [{ _id: "session-1", selectedText: "Kiln drying above 80 C warps birch.", instruction: "", preset: "vet", status: "completed", createdAt: 1 }]);
    __setQueryData("research:getSessionDetails", null);
    await render(AgentChatPanel, { reportId, projectId, reportContent: settled });
    await expect.element(page.getByText("Get started", { exact: true })).toBeVisible();
  });

  it("moves to the message box on a space, a dead key or a paste, and lands the pasted text", async () => {
    for (const key of [" ", "Dead"]) {
      const view = await render(AgentChatPanel, { reportId, projectId, reportContent: settled });
      await expect.element(page.getByText("Get started", { exact: true })).toBeVisible();
      const list = document.querySelector<HTMLElement>("[data-composer-options] [role=listbox]")!;
      list.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
      await expect.element(composer()).toHaveValue("");
      await expect.element(composer()).toHaveFocus();
      view.unmount();
    }
    await render(AgentChatPanel, { reportId, projectId, reportContent: settled });
    await expect.element(page.getByText("Get started", { exact: true })).toBeVisible();
    const data = new DataTransfer();
    data.setData("text/plain", "Pasted request");
    document.querySelector<HTMLElement>("[data-composer-options] [role=listbox]")!
      .dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    await expect.element(composer()).toHaveValue("Pasted request");
    expect(__mutationCalls("chatV2:sendMessage")).toEqual([]);
  });

  it("shows the AI's question with its options, and sends the writer's own answer", async () => {
    __setQueryData("chatV2:listThreads", THREADS);
    __setPaginatedRows("chatV2:listMessages", [
      row("q1", "Shorten Line 242.", 1, "user"),
      row("a1", "Line 242 is 35 words over. I can cut from a few places.", 1, "assistant", {
        parts: [
          { type: "text", text: "Line 242 is 35 words over. I can cut from a few places." },
          { type: "tool-askWriter", toolCallId: "ask-1", state: "output-available",
            input: { question: "What should I cut first?", options: ["The company background", "The repeated door detail"] }, output: "Shown." },
        ],
      } as Partial<UIMessage>),
    ]);
    __setQueryData("chatV2:listTurns", [{ _id: "turn-1", promptMessageId: "q1", order: 1, status: "completed", startedAt: 1, endedAt: 2, stepCount: 1 }]);
    __setMutationResult("chatV2:sendMessage", { threadId: "thread-1", messageId: "q2" });
    await page.viewport(480, 760);
    await render(AgentChatPanel, { reportId, projectId });
    await expect.element(page.getByText("Assistant needs you", { exact: true })).toBeVisible();
    await expect.element(page.getByText("What should I cut first?", { exact: true })).toBeVisible();
    await expect.element(page.getByRole("option", { name: /The repeated door detail/ })).toBeVisible();
    await page.screenshot({ path: `${CAPTURES}/assistant-needs-you.png` });
    // Letters on the AI's question are not a message: it stays up.
    (document.querySelector("[data-composer-options] [role=listbox]") as HTMLElement).focus();
    await userEvent.keyboard("x");
    await expect.element(page.getByText("Assistant needs you", { exact: true })).toBeVisible();
    expect(composer().elements()).toHaveLength(0);
    expect(__mutationCalls("chatV2:sendMessage")).toEqual([]);

    await page.getByRole("option", { name: /Something else/ }).click();
    const own = page.getByRole("textbox", { name: "Your own answer" });
    await expect.element(own).toHaveFocus();
    // Review 2026-10-28 (finding 2): digits typed here are the writer's words.
    await userEvent.keyboard("Cut to 300 words");
    expect(__mutationCalls("chatV2:sendMessage")).toEqual([]);
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => (__mutationCalls("chatV2:sendMessage")[0] as { content?: string } | undefined)?.content).toBe("Cut to 300 words");
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
    await expect.poll(() => document.querySelector("[data-feedback-status]")?.textContent).toBe("Feedback recorded. You can change it.");
    // Review R2 P3-3 and P3-4: the pressed vote keeps focus (aria-disabled,
    // not disabled), and the recorded state is said in a polite live region.
    await expect.element(unhelpful).toHaveFocus();
    await expect.element(unhelpful).toHaveAttribute("aria-disabled", "true");
    const live = document.querySelector("[data-feedback-announcement]");
    expect(live?.getAttribute("aria-live")).toBe("polite");
    await expect.poll(() => live?.textContent).toBe("Feedback recorded. You can change it.");
    expect(document.querySelector("[data-feedback-status]")?.getAttribute("aria-live")).toBeNull();
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

  it("announces only a vote made here, never the votes loaded with the page (round 2 N1)", async () => {
    __setQueryData("chatV2:listThreads", THREADS);
    __setPaginatedRows("chatV2:listMessages", [1, 2, 3].flatMap((i) => [
      row(`q${i}`, `Question ${i}`, i, "user"), row(`a${i}`, `Answer ${i}.`, i, "assistant"),
    ]));
    __setQueryData("chatV2:listTurns", [1, 2, 3].map((i) => ({ _id: `turn-${i}`, promptMessageId: `q${i}`, order: i, status: "completed", startedAt: 1, endedAt: 2, stepCount: 1 })));
    __setQueryData("chatFeedback:getViewerVotes", undefined);
    __setMutationResult("chatFeedback:submitFeedback", 1);
    await render(AgentChatPanel, { reportId, projectId });
    await expect.element(page.getByText("Answer 3.")).toBeVisible();
    const live = () => [...document.querySelectorAll("[data-feedback-announcement]")].map((node) => node.textContent);
    // The saved votes arrive after the page: shown, not announced.
    __setQueryData("chatFeedback:getViewerVotes", [{ turnId: "turn-1", vote: 1 }, { turnId: "turn-2", vote: -1 }]);
    await expect.poll(() => [...document.querySelectorAll("[data-feedback-status]")].filter((node) => node.textContent === "Feedback recorded. You can change it.").length).toBe(2);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(live()).toEqual(["", "", ""]);
    // A vote made here is announced, once, in its own bar.
    await page.getByRole("button", { name: "Mark response helpful", exact: true }).nth(2).click();
    await expect.poll(live).toEqual(["", "", "Feedback recorded. You can change it."]);
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

  it("counts the note against its own limit and holds a note that is too long", async () => {
    await render(AgentChatPanel, {
      reportId, projectId,
      pendingResearch: { from: 1, to: 20, text: "Kiln drying above 80 C warps birch.", context: "", preset: "vet" },
    });
    const send = page.getByRole("button", { name: "Send message", exact: true });
    await composer().fill("x".repeat(VET_NOTE_MAX_CHARS));
    await expect.element(page.getByText(`${VET_NOTE_MAX_CHARS.toLocaleString("en-US")} / ${VET_NOTE_MAX_CHARS.toLocaleString("en-US")}`)).toBeVisible();
    await expect.element(send).toBeEnabled();
    await composer().fill("x".repeat(VET_NOTE_MAX_CHARS + 1));
    await expect.element(send).toBeDisabled();
    await expect.element(page.getByText("characters. This note is too long to send.")).toBeInTheDocument();
    expect(__mutationCalls("research:startResearch")).toEqual([]);
  });

  it("labels a vet session in the research feed", async () => {
    __setQueryData("research:listSessions", [{ _id: "session-1", selectedText: "Kiln drying above 80 C warps birch.", instruction: "", preset: "vet", status: "queued", createdAt: 1 }]);
    __setQueryData("research:getSessionDetails", null);
    await render(ResearchFeed, { reportId });
    await expect.element(page.getByText(VET_LABEL, { exact: true })).toBeVisible();
    expect(document.body.textContent).not.toContain("Research this passage");
  });
});
