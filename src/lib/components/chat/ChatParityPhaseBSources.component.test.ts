/**
 * Chat parity Phase B, package W3 (spec-chat-parity-phase-b): web sources
 * (numbered citations, the Sources row, the trace line), the
 * per-conversation web search switch, and Undo on an applied card. All data
 * is fictional.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { ConvexError } from "convex/values";
import type { UIMessage } from "@convex-dev/agent";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";
import { __resetAuthState } from "$lib/test/convex-auth-stub";
import {
  __callOrder,
  __mutationCalls,
  __resetConvexStub,
  __setMutationError,
  __setMutationResult,
  __setPaginatedRows,
  __setQueryData,
} from "$lib/test/convex-svelte-stub.svelte";
import type { TurnWebSearch } from "$lib/chat/webSources";
import { Streamdown } from "svelte-streamdown";
import ErrorMonitor from "$lib/components/errors/ErrorMonitor.svelte";
import AgentChatPanel from "./AgentChatPanel.svelte";
import AssistantTurn from "./AssistantTurn.svelte";
import ProposalCard from "./ProposalCard.svelte";

const sonner = vi.hoisted(() => ({
  error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn(),
}));
vi.mock("svelte-sonner", () => ({ toast: sonner }));

const CAPTURES = "../../../../.vitest-attachments/chat-parity-phase-b";
const reportId = "report-1" as Id<"reports">;
const projectId = "project-1" as Id<"projects">;
const crashToasts = () => sonner.error.mock.calls.filter(([text]) => text === "We noticed an error.");

function reply(text: string, extraParts: unknown[] = []): UIMessage {
  return {
    id: "a1", key: "a1", order: 1, stepOrder: 1, role: "assistant", status: "success", text,
    _creationTime: 1001, parts: [...extraParts, { type: "text", text }],
  } as UIMessage;
}

const SEARCHES: TurnWebSearch[] = [
  {
    promptMessageId: "q1", toolCallId: "toolu_1", query: "How does a Coriolis meter drift at low flow?", status: "ok",
    sources: [
      { n: 1, url: "https://example.org/coriolis?page=2", title: "Coriolis flow meters", domain: "example.org" },
      { n: 2, url: "https://www.canada.ca/en/revenue-agency/sred.html", title: "SR&ED guidance", domain: "canada.ca" },
    ],
  },
  {
    promptMessageId: "q1", toolCallId: "toolu_2", query: "What is zero drift?", status: "ok",
    sources: [
      { n: 2, url: "https://www.canada.ca/en/revenue-agency/sred.html", title: "SR&ED guidance", domain: "canada.ca" },
      { n: 3, url: "https://example.net/zero-drift", title: "Zero drift explained", domain: "example.net" },
    ],
  },
];

let quiet: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  __resetConvexStub(); __resetAuthState(); localStorage.clear(); sessionStorage.clear();
  for (const fn of Object.values(sonner)) fn.mockClear();
  quiet = vi.spyOn(console, "error").mockImplementation(() => {});
  for (const name of ["chatV2:listThreads", "chatV2:listTurns", "chatV2:listProposals", "research:listSessions", "chatV2:listTurnWebSources"]) {
    __setQueryData(name, []);
  }
  __setQueryData("chatV2:listMessages", { streams: { kind: "list", messages: [] } });
  __setPaginatedRows("chatV2:listMessages", []);
  __setQueryData("users:getCurrentUser", { _id: "writer-1", role: "writer" });
  __setQueryData("projects:getProjectEditAccess", { canEditDetails: true });
});

afterEach(() => {
  quiet.mockRestore();
  vi.restoreAllMocks();
});

describe("citations and sources", () => {
  const TEXT = "A Coriolis meter measures mass flow [1]. CRA asks for the uncertainty [2][3]. Add [GAP: need 2 load results] and item [r-242-3] here [9].";

  it("numbers the turn's citations and leaves every other bracket as plain text", async () => {
    await page.viewport(560, 640);
    const { container } = await render(AssistantTurn, { message: reply(TEXT), webSearches: SEARCHES, showSources: true, onRefine: vi.fn() });
    await expect.element(page.getByRole("button", { name: "Source 1", exact: true })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Source 2, 3", exact: true })).toBeVisible();
    const answer = container.querySelector(".chat-markdown")!;
    const shown = answer.textContent!.replace(/\s+/g, " ");
    expect(shown).toContain("[GAP: need 2 load results]");
    expect(shown).toContain("item [r-242-3] here [9].");
    // Only the two citations became pills.
    expect(answer.querySelectorAll("[data-streamdown-citation-preview]")).toHaveLength(2);
    await page.screenshot({ path: `${CAPTURES}/citations-and-sources.png` });

    await page.getByRole("button", { name: "Source 2, 3", exact: true }).click();
    const popover = page.getByRole("dialog");
    await expect.element(popover).toBeVisible();
    const links = [...popover.element().querySelectorAll("a")];
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "https://www.canada.ca/en/revenue-agency/sred.html",
      "https://example.net/zero-drift",
    ]);
    for (const link of links) {
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noopener noreferrer");
      expect(link.getAttribute("referrerpolicy")).toBe("no-referrer");
    }
    // Past the popover's opening transition.
    await new Promise((resolve) => setTimeout(resolve, 300));
    await page.screenshot({ path: `${CAPTURES}/citation-popover.png` });
  });

  it("renders brackets exactly as before, with and without sources", async () => {
    const plain = await render(AssistantTurn, { message: reply(TEXT), onRefine: vi.fn() });
    const answer = plain.container.querySelector(".chat-markdown")!;
    expect(answer.querySelectorAll("[data-streamdown-citation-preview]")).toHaveLength(0);
    // Svelte's template whitespace between nodes aside, the text is as written.
    expect(answer.textContent!.replace(/\s+/g, "")).toBe(TEXT.replace(/\s+/g, ""));
    expect(document.querySelector("[data-web-sources]")).toBeNull();
    plain.unmount();
    // Review R2 P3-2: compared with Streamdown as the reply was rendered
    // before Phase B (no sources, no snippets, no theme). A gap that holds
    // one of the turn's numbers, and words an object inherits, stay text.
    const GAPS = "Add [GAP: need 2 load results] and [GAP: 1 more test] to item [r-242-3]. Then [call toString first] and [constructor] [__proto__] here.";
    // Svelte's anchors and Streamdown's per-instance block ids aside.
    const markup = (element: Element) =>
      element.innerHTML.replace(/<!--[\s\S]*?-->/g, "").replace(/ data-streamdown-[a-z-]+="[^"]*"/g, "").trim();
    const baseline = await render(Streamdown, { content: GAPS, allowedImagePrefixes: [] });
    const before = markup(baseline.container);
    baseline.unmount();
    expect(before).toContain("[GAP: 1 more test]");
    expect(before).toContain("[call toString first]");
    for (const webSearches of [undefined, SEARCHES]) {
      const turn = await render(AssistantTurn, { message: reply(GAPS), ...(webSearches ? { webSearches } : {}), onRefine: vi.fn() });
      const markdown = turn.container.querySelector(".chat-markdown")!;
      expect(markup(markdown)).toBe(before);
      expect(markdown.querySelectorAll("[data-streamdown-citation-preview]")).toHaveLength(0);
      turn.unmount();
    }
  });

  it("lists the sources under the reply with safe links and hostname-only favicons", async () => {
    await render(AssistantTurn, { message: reply("A Coriolis meter measures mass flow [1]."), webSearches: SEARCHES, showSources: true, onRefine: vi.fn() });
    const row = page.getByRole("region", { name: "Sources", exact: true });
    await expect.element(row).toBeVisible();
    const items = [...row.element().querySelectorAll("a")];
    expect(items.map((item) => item.textContent?.replace(/\s+/g, " ").trim())).toEqual([
      "1 Coriolis flow meters example.org",
      "2 SR&ED guidance canada.ca",
      "3 Zero drift explained example.net",
    ]);
    for (const item of items) {
      expect(item.getAttribute("target")).toBe("_blank");
      expect(item.getAttribute("rel")).toBe("noopener noreferrer");
      expect(item.getAttribute("referrerpolicy")).toBe("no-referrer");
    }
    const favicon = items[0]!.querySelector("img")!;
    expect(favicon.getAttribute("src")).toBe("https://www.google.com/s2/favicons?sz=64&domain=example.org");
    expect(favicon.getAttribute("referrerpolicy")).toBe("no-referrer");
  });

  it("shows no Sources row on a row that is not the turn's last", async () => {
    await render(AssistantTurn, { message: reply("Cited [1]."), webSearches: SEARCHES, showSources: false, onRefine: vi.fn() });
    await expect.element(page.getByRole("button", { name: "Source 1", exact: true })).toBeVisible();
    expect(document.querySelector("[data-web-sources]")).toBeNull();
  });

  it("names each search in the trace by the query it sent", async () => {
    const parts = [
      { type: "tool-searchWeb", toolCallId: "toolu_1", state: "output-available", input: {}, output: "Step completed." },
      { type: "tool-searchWeb", toolCallId: "toolu_refused", state: "output-available", input: {}, output: "Step completed." },
    ];
    const { container } = await render(AssistantTurn, {
      message: reply("Cited [1].", parts), webSearches: SEARCHES, timing: { status: "completed", startedAt: 1, endedAt: 9_000, stepCount: 2 }, onRefine: vi.fn(),
    });
    (container.querySelector("summary") as HTMLElement).click();
    await expect.element(page.getByText("Searched the web: How does a Coriolis meter drift at low flow?", { exact: true })).toBeVisible();
    // A search that sent nothing keeps the plain label.
    await expect.element(page.getByRole("list", { name: "Thought process" }).getByText("Searched the web", { exact: true })).toBeVisible();
  });

  it("joins a conversation's searches to their reply in the panel", async () => {
    __setQueryData("chatV2:listThreads", [{ _id: "mapping-1", agentThreadId: "thread-1", title: "Coriolis", webSearch: true, createdAt: 1 }]);
    __setPaginatedRows("chatV2:listMessages", [
      { id: "q1", key: "q1", order: 1, stepOrder: 0, role: "user", status: "success", text: "What is drift?", _creationTime: 1000, parts: [{ type: "text", text: "What is drift?" }] },
      reply("Drift is a slow offset [3]."),
    ]);
    __setQueryData("chatV2:listTurns", [{ _id: "turn-1", promptMessageId: "q1", order: 1, status: "completed", startedAt: 1, endedAt: 2, stepCount: 1 }]);
    __setQueryData("chatV2:listTurnWebSources", SEARCHES);
    await render(AgentChatPanel, { reportId, projectId });
    await expect.element(page.getByRole("button", { name: "Source 3", exact: true })).toBeVisible();
    await expect.element(page.getByRole("region", { name: "Sources", exact: true })).toBeVisible();
  });
});

// Owner, 2026-10-21: no "Web search on" label in the chat; Message options
// shows the setting and switches it.
describe("the web search switch", () => {
  const options = () => page.getByRole("button", { name: "Message options", exact: true });
  const web = () => page.getByRole("menuitemcheckbox", { name: "Search the web in this conversation" });
  const label = () => page.getByText("Web search on", { exact: true });
  /** Message options says whether web search is on; the menu is closed again after. */
  async function shownAs(checked: "true" | "false") {
    await options().click();
    await expect.element(web()).toHaveAttribute("aria-checked", checked);
    await userEvent.keyboard("{Escape}");
    await expect.element(web()).not.toBeInTheDocument();
  }
  const composer = () => page.getByRole("textbox", { name: "Message the report assistant" });
  const send = () => page.getByRole("button", { name: "Send message", exact: true });

  it("is on for a new conversation, stays as set after a send, and seeds the conversation", async () => {
    __setMutationResult("chatV2:sendMessage", { threadId: "thread-new", messageId: "prompt-1" });
    await render(AgentChatPanel, { reportId, projectId });
    await expect.element(composer()).toBeVisible();
    expect(label().elements()).toHaveLength(0);
    await options().click();
    await expect.element(web()).toHaveAttribute("aria-checked", "true");
    await web().click();
    await expect.element(web()).toHaveAttribute("aria-checked", "false");
    await userEvent.keyboard("{Escape}");
    // An unsaved conversation keeps it locally.
    expect(__mutationCalls("chatV2:setThreadWebSearch")).toEqual([]);
    await composer().fill("Explain the uncertainty in Line 242.");
    await send().click();
    await expect.poll(() => __mutationCalls("chatV2:sendMessage").length).toBe(1);
    expect(__mutationCalls("chatV2:sendMessage")[0]).toMatchObject({ allowWeb: false, newThread: true });
    // Not cleared by the send.
    await options().click();
    await expect.element(web()).toHaveAttribute("aria-checked", "false");
  });

  it("belongs to each conversation and is saved when switched", async () => {
    __setQueryData("chatV2:listThreads", [
      { _id: "mapping-1", agentThreadId: "thread-1", title: "Off conversation", webSearch: false, createdAt: 2 },
      { _id: "mapping-2", agentThreadId: "thread-2", title: "On conversation", webSearch: true, createdAt: 1 },
    ]);
    __setMutationResult("chatV2:setThreadWebSearch", null);
    __setMutationResult("chatV2:sendMessage", { threadId: "thread-1", messageId: "prompt-1" });
    await render(AgentChatPanel, { reportId, projectId });
    await expect.element(composer()).toBeVisible();
    await shownAs("false");

    await page.getByRole("button", { name: "Conversation menu", exact: true }).click();
    await page.getByRole("menuitem", { name: "On conversation", exact: false }).click();
    await shownAs("true");

    await page.getByRole("button", { name: "Conversation menu", exact: true }).click();
    await page.getByRole("menuitem", { name: "Off conversation", exact: false }).click();
    await shownAs("false");
    await options().click();
    await web().click();
    await expect.element(web()).toHaveAttribute("aria-checked", "true");
    expect(__mutationCalls("chatV2:setThreadWebSearch")).toEqual([{ threadId: "thread-1", enabled: true }]);
    await userEvent.keyboard("{Escape}");
    await composer().fill("What does CRA mean by uncertainty?");
    await send().click();
    await expect.poll(() => __mutationCalls("chatV2:sendMessage").length).toBe(1);
    // The switch saved it; a send in a saved conversation uses what is stored.
    expect(__mutationCalls("chatV2:sendMessage")[0]).toMatchObject({ threadId: "thread-1" });
    expect(__mutationCalls("chatV2:sendMessage")[0]).not.toHaveProperty("allowWeb");
    expect(__callOrder().filter((name) => name === "chatV2:setThreadWebSearch" || name === "chatV2:sendMessage")).toEqual([
      "chatV2:setThreadWebSearch",
      "chatV2:sendMessage",
    ]);
    await shownAs("true");

    // Message options turns it off for the conversation.
    await options().click();
    await web().click();
    await expect.element(web()).toHaveAttribute("aria-checked", "false");
    expect(__mutationCalls("chatV2:setThreadWebSearch").at(-1)).toEqual({ threadId: "thread-1", enabled: false });
    expect(label().elements()).toHaveLength(0);
  });

  // Review R2 P3-6: an unknown setting is never shown as on.
  it("shows it off and waits while the conversation's setting is unknown", async () => {
    __setQueryData("chatV2:listThreads", [{ _id: "mapping-1", agentThreadId: "thread-1", title: "Off conversation", webSearch: false, createdAt: 1 }]);
    await render(AgentChatPanel, { reportId, projectId });
    await expect.element(composer()).toBeVisible();
    await options().click();
    await expect.element(web()).toHaveAttribute("aria-checked", "false");
    await expect.element(web()).not.toHaveAttribute("data-disabled");
    await userEvent.keyboard("{Escape}");
    // The list no longer holds the open conversation (51 newer ones, say).
    __setQueryData("chatV2:listThreads", [{ _id: "mapping-2", agentThreadId: "thread-2", title: "Newer", webSearch: true, createdAt: 2 }]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await options().click();
    await expect.element(web()).toHaveAttribute("aria-checked", "false");
    await expect.element(web()).toHaveAttribute("data-disabled");
    expect(__mutationCalls("chatV2:setThreadWebSearch")).toEqual([]);
  });

  it("says when the switch could not be saved, and shows the stored setting again", async () => {
    const monitor = await render(ErrorMonitor);
    __setQueryData("chatV2:listThreads", [{ _id: "mapping-1", agentThreadId: "thread-1", title: "Conversation", webSearch: true, createdAt: 1 }]);
    const data = { code: "NOT_FOUND", message: "This conversation no longer exists" };
    const error = new ConvexError(data);
    error.message = `[CONVEX M(chatV2:setThreadWebSearch)] [Request ID: 1] Server Error\nUncaught ConvexError: ${JSON.stringify(data)}`;
    __setMutationResult("chatV2:setThreadWebSearch", { then(_resolve: unknown, reject: (reason: unknown) => void) { console.error(error.message); reject(error); } });
    await render(AgentChatPanel, { reportId, projectId });
    await expect.element(composer()).toBeVisible();
    await options().click();
    await expect.element(web()).toHaveAttribute("aria-checked", "true");
    await web().click();
    await expect.element(page.getByRole("alert")).toHaveTextContent("This conversation no longer exists");
    await expect.element(web()).toHaveAttribute("aria-checked", "true");
    expect(crashToasts()).toHaveLength(0);
    monitor.unmount();
  });
});

describe("Undo on an applied card", () => {
  const applied = (extra: Partial<Doc<"chatProposals"> & { undoable: boolean }> = {}) => ({
    _id: "proposal-1" as Id<"chatProposals">, _creationTime: 0,
    projectId, reportId, agentThreadId: "thread-1",
    kind: "edit" as const, targetText: "The team tested the coupon.", newText: "The team cycled the coupon to failure.",
    state: "applied" as const, createdAt: 0, undoable: true, ...extra,
  });
  const undo = () => page.getByRole("button", { name: "Undo", exact: true });

  it("is offered on an undoable applied card to people who may apply", async () => {
    const card = await render(ProposalCard, { proposal: applied() });
    await expect.element(undo()).toBeVisible();
    await expect.element(page.getByText("Replaced in report", { exact: true })).toBeVisible();
    card.unmount();

    for (const proposal of [applied({ undoable: false }), applied({ state: "pending" })]) {
      const other = await render(ProposalCard, { proposal });
      await expect.element(page.getByText(proposal.state === "pending" ? "Suggested edit" : "Replaced in report", { exact: true })).toBeVisible();
      expect(undo().elements()).toHaveLength(0);
      other.unmount();
    }

    __setQueryData("projects:getProjectEditAccess", { canEditDetails: false });
    await render(ProposalCard, { proposal: applied() });
    await expect.element(page.getByText("Replaced in report", { exact: true })).toBeVisible();
    expect(undo().elements()).toHaveLength(0);
  });

  it("saves the editor first, then undoes the card", async () => {
    __setMutationResult("chatV2:undoProposal", { undone: true, revisionNumber: 2 });
    const undoCallsBeforeSave: number[] = [];
    const onBeforeApply = vi.fn(async () => {
      undoCallsBeforeSave.push(__callOrder().filter((name) => name === "chatV2:undoProposal").length);
    });
    await render(ProposalCard, { proposal: applied(), onBeforeApply });
    await undo().click();
    await expect.poll(() => __mutationCalls("chatV2:undoProposal")).toEqual([{ proposalId: "proposal-1" }]);
    expect(onBeforeApply).toHaveBeenCalledTimes(1);
    expect(undoCallsBeforeSave).toEqual([0]);
  });

  it("explains a conflict on the card, with no crash toast", async () => {
    const monitor = await render(ErrorMonitor);
    const data = { code: "PROPOSAL_UNDO_CONFLICT", message: "This passage changed after it was applied, so it can't be undone here. Use Version history to go back." };
    const error = new ConvexError(data);
    error.message = `[CONVEX M(chatV2:undoProposal)] [Request ID: 2] Server Error\nUncaught ConvexError: ${JSON.stringify(data)}`;
    __setMutationResult("chatV2:undoProposal", { then(_resolve: unknown, reject: (reason: unknown) => void) { console.error(error.message); reject(error); } });
    await page.viewport(480, 360);
    await render(ProposalCard, { proposal: applied() });
    await undo().click();
    await expect.element(page.getByRole("alert")).toHaveTextContent(
      "This passage changed after it was applied, so it can't be undone here. Use Version history to go back."
    );
    expect(crashToasts()).toHaveLength(0);
    await page.screenshot({ path: `${CAPTURES}/undo-conflict.png` });
    monitor.unmount();
  });

  it("says a failed Undo in plain words", async () => {
    __setMutationError("chatV2:undoProposal", new Error("[CONVEX M(chatV2:undoProposal)] [Request ID: 3] Server Error"));
    await render(ProposalCard, { proposal: applied() });
    await undo().click();
    await expect.element(page.getByRole("alert")).toHaveTextContent("This suggestion could not be undone. Try again.");
  });
});
