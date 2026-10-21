/**
 * Chat parity Phase A, package W3 (spec-chat-parity-phase-a): the report
 * chat's refusals, Apply gating, live progress, reasoning summaries, the
 * Continue offer, the context-loss divider, drafts, the connection state,
 * the composer limits and the bulk card's Completion Report. All data is
 * fictional.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { ConvexError } from "convex/values";
import type { UIMessage } from "@convex-dev/agent";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";
import { __resetAuthState } from "$lib/test/convex-auth-stub";
import { __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import {
  __mutationCalls,
  __resetConvexStub,
  __setMutationError,
  __setMutationResult,
  __setPaginatedRows,
  __setQueryData,
  __setQueryError,
} from "$lib/test/convex-svelte-stub.svelte";
import ErrorMonitor from "$lib/components/errors/ErrorMonitor.svelte";
import ResearchFeed from "$lib/components/research/ResearchFeed.svelte";
import AgentChatPanel from "./AgentChatPanel.svelte";
import AssistantTurn from "./AssistantTurn.svelte";
import ProposalCard from "./ProposalCard.svelte";
import TurnTrace from "./TurnTrace.svelte";
import ChatKeepInPlaceHarness from "$lib/test/ChatKeepInPlaceHarness.svelte";

const sonner = vi.hoisted(() => ({
  error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn(),
}));
vi.mock("svelte-sonner", () => ({ toast: sonner }));

// The Convex client is a stub here, so the connection is driven directly.
const connection = vi.hoisted(() => ({ offline: null as null | { value: boolean } }));
vi.mock("$lib/chat/connectionState.svelte", async () => {
  const { reactiveValue } = await import("$lib/test/reactiveValue.svelte");
  const offline = reactiveValue(false);
  connection.offline = offline;
  const { OFFLINE_MESSAGE } = await import("$lib/chat/connection");
  return {
    OFFLINE_MESSAGE,
    useChatConnection: () => ({ get offline() { return offline.value; } }),
  };
});

const CAPTURES = "../../../../.vitest-attachments/chat-parity-phase-a";
const reportId = "report-1" as Id<"reports">;
const projectId = "project-1" as Id<"projects">;
const sendName = "chatV2:sendMessage";
const composer = () => page.getByRole("textbox", { name: "Message the report assistant" });
const send = () => page.getByRole("button", { name: "Send message", exact: true });
const crashToasts = () => sonner.error.mock.calls.filter(([text]) => text === "We noticed an error.");

function row(id: string, text: string, order: number, role: UIMessage["role"], extra: Partial<UIMessage> = {}): UIMessage {
  return {
    id, key: id, order, stepOrder: role === "user" ? 0 : 1, role, status: "success", text,
    _creationTime: 1000 + order, parts: [{ type: "text", text }], ...extra,
  } as UIMessage;
}

function seedThreads(threads = [{ _id: "mapping-1", agentThreadId: "thread-1", title: "Original conversation" }]) {
  __setQueryData("chatV2:listThreads", threads);
}

/** The Convex client logs a refused call before the caller's catch runs. */
function convexLog(path: string, data: Record<string, unknown>) {
  return `[CONVEX M(${path})] [Request ID: 7c1e] Server Error\nUncaught ConvexError: ${JSON.stringify(data)}\n    at handler (../convex/chatV2.ts:455:7)`;
}

/**
 * A refused call as the real client delivers it: logged through console.error
 * (request_manager's logForFunction), then thrown with data.
 */
function refusedCall(path: string, data: Record<string, string | number>) {
  const error = new ConvexError(data);
  error.message = convexLog(path, data);
  return { then(_resolve: unknown, reject: (reason: unknown) => void) { console.error(error.message); reject(error); } };
}
const refusedSend = (data: Record<string, string | number>) => refusedCall(sendName, data);

let quiet: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  __resetConvexStub(); __resetAuthState(); localStorage.clear(); sessionStorage.clear();
  __resetPage(); __setPageUrl("/project/project-1");
  for (const fn of Object.values(sonner)) fn.mockClear();
  connection.offline && (connection.offline.value = false);
  quiet = vi.spyOn(console, "error").mockImplementation(() => {});
  __setQueryData("chatV2:listThreads", []);
  __setQueryData("chatV2:listMessages", { streams: { kind: "list", messages: [] } });
  __setPaginatedRows("chatV2:listMessages", []);
  __setQueryData("chatV2:listTurns", []);
  __setQueryData("chatV2:listProposals", []);
  __setQueryData("research:listSessions", []);
  __setQueryData("users:getCurrentUser", { _id: "writer-1", role: "writer" });
  __setQueryData("projects:getProjectEditAccess", { canEditDetails: true });
});

afterEach(() => {
  quiet.mockRestore();
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe("task 1: refusals", () => {
  it.each([
    [{ code: "CHAT_TURN_ACTIVE", message: "A reply is still being written", senderName: "Avery Lane" },
      "The assistant is still answering Avery Lane in this conversation. Wait for it to finish, or press Stop, then send again."],
    [{ code: "CHAT_SPEND_BUDGET_EXCEEDED", message: "Project AI spending budget exceeded; chat is unavailable", retryAfterMs: 2 * 3600_000 },
      "This project has reached its daily AI spending limit, so the assistant is paused. Try again in about 2 hours."],
    [{ code: "CHAT_QUEUE_LIMIT_EXCEEDED", message: "Your queued chat turn limit has been reached" },
      "You have too many messages waiting for a reply. Wait for one to finish, then send again."],
    [{ code: "CHAT_MESSAGE_TOO_LONG", message: "Message too long", maxChars: 20_000 },
      "This message is too long to send. It can be up to 20,000 characters."],
    [{ code: "CHAT_MESSAGE_TOO_LONG", message: "Highlight too long", maxChars: 12_000 },
      "The selected text is too long to send. Select up to 12,000 characters."],
  ])("explains %o in plain words, with no crash toast", async (data, copy) => {
    const monitor = await render(ErrorMonitor);
    __setMutationResult(sendName, refusedSend(data));
    await render(AgentChatPanel, { reportId, projectId });
    await composer().fill("Tighten the uncertainty in Line 242.");
    await send().click();
    const alert = page.getByRole("alert");
    await expect.element(alert).toHaveTextContent(copy);
    expect(alert.element().textContent).not.toContain("CONVEX");
    expect(alert.element().textContent).not.toContain("Request ID");
    await expect.element(page.getByRole("button", { name: "Retry", exact: true })).toBeEnabled();
    expect(crashToasts()).toHaveLength(0);
    if (data.code === "CHAT_TURN_ACTIVE") {
      await page.viewport(480, 760);
      await page.screenshot({ path: `${CAPTURES}/refusal-turn-active.png` });
    }
    monitor.unmount();
  });

  it("says a refused Stop in the panel, with no crash toast from the client's log line", async () => {
    const monitor = await render(ErrorMonitor);
    seedThreads();
    __setPaginatedRows("chatV2:listMessages", [row("q", "List the deviations in Line 244.", 1, "user")]);
    __setQueryData("chatV2:listTurns", [{ _id: "turn-1", promptMessageId: "q", order: 1, status: "running", startedAt: Date.now(), stepCount: 0 }]);
    __setMutationResult("chatV2:abortStreaming", refusedCall("chatV2:abortStreaming", {
      code: "NOT_AUTHORIZED", message: "You no longer have access to this project.",
    }));
    await render(AgentChatPanel, { reportId, projectId });
    await page.getByRole("button", { name: "Stop generating", exact: true }).click();
    await expect.element(page.getByRole("alert")).toHaveTextContent("You no longer have access to this project.");
    // Only the client's own log line; the panel adds none.
    expect(quiet).toHaveBeenCalledTimes(1);
    expect(crashToasts()).toHaveLength(0);
    monitor.unmount();
  });

  it("says a Stop that never reached the server in the panel", async () => {
    const monitor = await render(ErrorMonitor);
    seedThreads();
    __setPaginatedRows("chatV2:listMessages", [row("q", "List the deviations in Line 244.", 1, "user")]);
    __setQueryData("chatV2:listTurns", [{ _id: "turn-1", promptMessageId: "q", order: 1, status: "running", startedAt: Date.now(), stepCount: 0 }]);
    __setMutationError("chatV2:abortStreaming", new Error("[CONVEX M(chatV2:abortStreaming)] [Request ID: 9] Server Error"));
    await render(AgentChatPanel, { reportId, projectId });
    await page.getByRole("button", { name: "Stop generating", exact: true }).click();
    await expect.element(page.getByRole("alert")).toHaveTextContent("The reply could not be stopped. Try again.");
    expect(quiet).not.toHaveBeenCalled();
    expect(crashToasts()).toHaveLength(0);
    monitor.unmount();
  });

  it("says a blocked copy on the button, never through console.error", async () => {
    const monitor = await render(ErrorMonitor);
    seedThreads();
    __setPaginatedRows("chatV2:listMessages", [
      row("q", "Summarize Line 242.", 1, "user"), row("a", "Line 242 states the uncertainty.", 1, "assistant"),
    ]);
    __setQueryData("chatV2:listTurns", [{ _id: "turn-1", promptMessageId: "q", order: 1, status: "completed", startedAt: 1, endedAt: 2, stepCount: 0 }]);
    vi.spyOn(navigator.clipboard, "write").mockRejectedValue(new Error("Write permission denied."));
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("Write permission denied."));
    await render(AgentChatPanel, { reportId, projectId });
    await page.getByRole("button", { name: "Copy", exact: true }).click();
    await expect.element(page.getByRole("button", { name: "Couldn't copy. Try again.", exact: true })).toBeVisible();
    expect(quiet).not.toHaveBeenCalled();
    expect(crashToasts()).toHaveLength(0);
    monitor.unmount();
  });
});

describe("task 3: favicons", () => {
  it("asks the favicon service for the hostname only", async () => {
    __setQueryData("research:listSessions", [{ _id: "research-1", status: "completed", selectedText: "Thermal trials", createdAt: 1 }]);
    __setQueryData("research:getSessionDetails", {
      session: { _id: "research-1", status: "completed", selectedText: "Thermal trials", answer: "CRA guidance applies.", createdAt: 1 },
      claims: [], runs: [], proposal: null,
      sources: [{ _id: "source-1", kind: "external", title: "SR&ED guidance", canonicalUrl: "https://www.canada.ca/en/revenue-agency/sred.html?ref=client-file-42#eligibility" }],
    });
    const { container } = await render(ResearchFeed, { reportId });
    await expect.poll(() => container.querySelector("img")?.getAttribute("src")).toBe(
      "https://www.google.com/s2/favicons?sz=64&domain=www.canada.ca"
    );
    expect(container.querySelector("a[href]")?.getAttribute("href")).toContain("/en/revenue-agency/sred.html");
  });
});

const proposal = (extra: Partial<Doc<"chatProposals">> = {}): Doc<"chatProposals"> => ({
  _id: "proposal-1" as Id<"chatProposals">, _creationTime: 1000, agentThreadId: "thread-1",
  projectId, reportId, kind: "edit", targetText: "Old wording", newText: "Clearer wording",
  state: "pending", createdAt: 1000, ...extra,
});

describe("task 4: Apply gating", () => {
  it("hides Apply, Dismiss and Edit wording from someone who cannot edit the report", async () => {
    __setQueryData("projects:getProjectEditAccess", { canEditDetails: false });
    await page.viewport(480, 520);
    await render(ProposalCard, { proposal: proposal(), onRefine: vi.fn() });
    await expect.element(page.getByText("Only people who can edit this report can apply or dismiss suggestions.")).toBeVisible();
    for (const name of ["Apply", "Apply all", "Dismiss", "Review individually"]) {
      expect(page.getByRole("button", { name, exact: true }).elements(), name).toHaveLength(0);
    }
    await page.getByRole("button", { name: "More actions for this suggestion", exact: true }).click();
    await expect.element(page.getByRole("menuitem", { name: "Refine with AI", exact: true })).toBeVisible();
    expect(page.getByRole("menuitem", { name: "Edit wording", exact: true }).elements()).toHaveLength(0);
    await page.screenshot({ path: `${CAPTURES}/apply-hidden-for-viewer.png` });
  });

  it("shows nothing to act on while access loads, then Apply for an editor", async () => {
    __resetConvexStub();
    const { unmount } = await render(ProposalCard, { proposal: proposal() });
    await expect.element(page.getByText("Clearer wording", { exact: true })).toBeVisible();
    expect(page.getByRole("button", { name: "Apply", exact: true }).elements()).toHaveLength(0);
    expect(page.getByText("Only people who can edit", { exact: false }).elements()).toHaveLength(0);
    __setQueryData("projects:getProjectEditAccess", { canEditDetails: true });
    await expect.element(page.getByRole("button", { name: "Apply", exact: true })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Dismiss", exact: true })).toBeVisible();
    unmount();
  });

  it("treats a failed access read as unknown, never as a refusal", async () => {
    __setQueryError("projects:getProjectEditAccess", new Error("[CONVEX Q(projects:getProjectEditAccess)] Server Error"));
    await render(ProposalCard, { proposal: proposal(), onRefine: vi.fn() });
    await expect.element(page.getByText("Clearer wording", { exact: true })).toBeVisible();
    for (const name of ["Apply", "Dismiss"]) {
      expect(page.getByRole("button", { name, exact: true }).elements(), name).toHaveLength(0);
    }
    expect(page.getByText("Only people who can edit", { exact: false }).elements()).toHaveLength(0);
    __setQueryData("projects:getProjectEditAccess", { canEditDetails: true });
    await expect.element(page.getByRole("button", { name: "Apply", exact: true })).toBeVisible();
  });
});

describe("task 5: live progress", () => {
  // Owner, 2026-10-21: no timer; the label and the quiet hint stay.
  it("reads the label from the turn's progress, with no timer, and the thinking hint", async () => {
    const now = 1_000_000;
    await page.viewport(480, 300);
    const { container, rerender } = await render(TurnTrace, {
      nodes: [], now,
      timing: { status: "running", startedAt: now - 30_000, stepCount: 1, progress: { phase: "thinking", step: 1, since: now - 30_000 } },
    });
    const status = () => container.querySelector("[data-turn-status]")?.textContent;
    expect(status()).toBe("Thinking…");
    expect(container.textContent).not.toMatch(/\d+\s*s\b/);
    expect(container.querySelector("[data-turn-status]")?.className).toContain("text-shimmer");
    expect(container.querySelector("[data-thinking-hint]")).toBeNull();
    // The minute counts from when the browser first saw this phase.
    await rerender({ now: now + 59_000 });
    expect(container.querySelector("[data-thinking-hint]")).toBeNull();
    await rerender({ now: now + 60_000 });
    await expect.poll(() => container.querySelector("[data-thinking-hint]")?.textContent)
      .toBe("Big requests can take a few minutes. You can stop and ask for one Line at a time.");
    // The hint is quiet: it is not inside the announced status line.
    expect(container.querySelector("[aria-live] [data-thinking-hint]")).toBeNull();
    await page.screenshot({ path: `${CAPTURES}/thinking-hint.png` });
    // A new thinking phase starts the minute again.
    await rerender({ timing: { status: "running", startedAt: now - 30_000, stepCount: 2, progress: { phase: "thinking", step: 2, since: now + 50_000 } } });
    await expect.poll(() => container.querySelector("[data-thinking-hint]")).toBeNull();
  });

  it.each([
    ["ten minutes ahead of", 600_000],
    ["an hour behind", -3_600_000],
  ])("times the hint on the browser clock when the server's clock runs %s it", async (_label, skew) => {
    const now = 5_000_000;
    const { container, rerender } = await render(TurnTrace, {
      nodes: [], now,
      timing: { status: "running", startedAt: now + skew, stepCount: 1, progress: { phase: "thinking", step: 1, since: now + skew } },
    });
    expect(container.querySelector("[data-thinking-hint]")).toBeNull();
    await rerender({ now: now + 30_000 });
    expect(container.querySelector("[data-thinking-hint]")).toBeNull();
    await rerender({ now: now + 60_000 });
    await expect.poll(() => container.querySelector("[data-thinking-hint]")).not.toBeNull();
  });

  it("holds each label at least 1.5 seconds", async () => {
    const start = Date.now();
    const { container, rerender } = await render(TurnTrace, {
      nodes: [],
      timing: { status: "running", startedAt: start, stepCount: 0, progress: { phase: "reading", step: 0, since: start } },
    });
    const status = () => container.querySelector("[data-turn-status]")?.textContent;
    expect(status()).toBe("Reading the report…");
    await rerender({ timing: { status: "running", startedAt: start, stepCount: 1, progress: { phase: "tool", tool: "deviationInventory", section: "244", step: 1, since: start + 100 } } });
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(status()).toBe("Reading the report…");
    await expect.poll(() => status(), { timeout: 2500 }).toBe("Listing the deviations in Line 244…");
    expect(Date.now() - start).toBeGreaterThanOrEqual(1400);
  });

  it("shows the label in the panel for a running turn", async () => {
    seedThreads();
    __setPaginatedRows("chatV2:listMessages", [row("q", "Fix the deviations in Line 244.", 1, "user")]);
    __setQueryData("chatV2:listTurns", [{
      _id: "turn-1", promptMessageId: "q", order: 1, status: "running", startedAt: Date.now() - 5000, stepCount: 1,
      progress: { phase: "tool", tool: "proposeBulkEdits", section: "244", step: 2, since: Date.now() - 1000 },
    }]);
    await render(AgentChatPanel, { reportId, projectId });
    await expect.element(page.getByText("Writing suggestions for Line 244…", { exact: true })).toBeVisible();
  });
});

describe("task 6: reasoning summaries and announcements", () => {
  const streamingReply = (status: UIMessage["status"]) => ({
    ...row("a", "Here is the plan", 1, "assistant"),
    status,
    parts: [
      { type: "reasoning", text: "**Planning the edits**\nI will list the deviations in Line 244 first.", state: status === "streaming" ? "streaming" : "done" },
      { type: "text", text: "Here is the plan", state: status === "streaming" ? "streaming" : "done" },
    ],
  }) as UIMessage;

  // Owner, 2026-10-21: an item id never shows, in the answer, the thought
  // block's second line or the reasoning; the place it names shows instead.
  it("shows item ids as the places they name", async () => {
    const message = {
      ...row("a", "One item stays blocked: r-244-4-2, the test count.", 1, "assistant"),
      parts: [
        { type: "reasoning", text: "For r-242-4-1, I am rewriting the first sentence.", state: "done" },
        { type: "text", text: "One item stays blocked: r-244-4-2, the test count.", state: "done" },
      ],
    } as UIMessage;
    const { container } = await render(AssistantTurn, {
      message, timing: { status: "completed", startedAt: 1_000, endedAt: 5_000, stepCount: 0 }, onRefine: vi.fn(),
    });
    await expect.element(page.getByText("One item stays blocked: Line 244, paragraph 4, the test count.")).toBeVisible();
    expect(container.querySelector("[data-turn-status]")?.textContent).toBe("Thought for 4s");
    await page.getByText("Thought for 4s", { exact: true }).click();
    expect(container.querySelector("[data-turn-headline]")?.textContent?.trim()).toBe("For Line 242, paragraph 4, I am rewriting the first sentence.");
    expect(container.querySelector("[data-reasoning-summary]")?.textContent).toContain("For Line 242, paragraph 4, I am rewriting");
    expect(container.textContent).not.toMatch(/\b[rcx]-\d{3}-\d+-\d+\b/);
  });

  // Owner, 2026-10-21: a short headline when closed, the full reasoning when
  // opened; hovering the status row fades the label up and shows the chevron,
  // with no fill.
  it("keeps the closed headline short, and hover is an opacity change with the chevron", async () => {
    const long = "All three Lines have been applied, but one item (Line 244, paragraph 4) remains blocked since the evidence does not support it.";
    const message = {
      ...row("a", "All done.", 1, "assistant"),
      parts: [
        { type: "reasoning", text: long, state: "done" },
        { type: "text", text: "All done.", state: "done" },
      ],
    } as UIMessage;
    const { container } = await render(AssistantTurn, {
      message, timing: { status: "completed", startedAt: 1_000, endedAt: 13_000, stepCount: 0 }, onRefine: vi.fn(),
    });
    await expect.element(page.getByText("Thought for 12s", { exact: true })).toBeVisible();
    // Closed, only the first line shows; the headline belongs to the open block.
    const headline = container.querySelector<HTMLElement>("[data-turn-headline]")!;
    await expect.element(page.elementLocator(headline)).not.toBeVisible();
    expect(headline.textContent?.trim()).toBe("All three Lines have been applied");
    const status = container.querySelector<HTMLElement>("[data-turn-status]")!;
    const chevron = container.querySelector<SVGElement>("[data-turn-chevron]")!;
    const summaryEl = container.querySelector<HTMLElement>("summary")!;
    expect(getComputedStyle(chevron).opacity).toBe("0");
    expect(Number(getComputedStyle(status).opacity)).toBeCloseTo(0.65, 2);
    await userEvent.hover(status);
    await expect.poll(() => getComputedStyle(chevron).opacity).toBe("1");
    await expect.poll(() => getComputedStyle(status).opacity).toBe("1");
    expect(getComputedStyle(summaryEl).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    await page.getByText("Thought for 12s", { exact: true }).click();
    await expect.element(page.elementLocator(headline)).toBeVisible();
    expect(container.querySelector("[data-reasoning-summary]")?.textContent?.trim()).toBe(long);
  });

  // Owner, 2026-10-21: opening the thought block opens it from where it is;
  // nothing moves the bar out from under the pointer, at the bottom of the
  // chat or mid-thread.
  it.each([
    ["at the bottom of the chat", 0],
    ["mid-thread", 30],
  ])("opens and closes the thought block without moving it, %s", async (_where, after) => {
    // Its own window, so the page itself never scrolls; positions are read
    // against the chat's viewport.
    await page.viewport(900, 900);
    const long = Array.from({ length: 12 }, (_, i) => `Reasoning sentence ${i + 1} about Line 244 and its evidence.`).join(" ");
    const message = {
      ...row("a", "All done.", 1, "assistant"),
      parts: [
        { type: "reasoning", text: long, state: "done" },
        { type: "text", text: "All done.", state: "done" },
      ],
    } as UIMessage;
    await render(ChatKeepInPlaceHarness, {
      message, timing: { status: "completed", startedAt: 1_000, endedAt: 13_000, stepCount: 0 }, after,
    });
    const bar = page.getByText("Thought for 12s", { exact: true });
    await expect.element(bar).toBeInTheDocument();
    const summaryEl = (bar.element() as HTMLElement).closest("summary")!;
    const viewport = summaryEl.closest<HTMLElement>('[role="log"]')!;
    // Let the chat's first pin to the bottom settle before scrolling up.
    await new Promise((done) => setTimeout(done, 300));
    if (after > 0) {
      viewport.scrollTop += summaryEl.getBoundingClientRect().top - viewport.getBoundingClientRect().top - 80;
      await new Promise((done) => setTimeout(done, 300));
    }
    // The bar is on screen, where the writer can click it.
    expect(summaryEl.getBoundingClientRect().top).toBeGreaterThanOrEqual(viewport.getBoundingClientRect().top);
    expect(summaryEl.getBoundingClientRect().bottom).toBeLessThanOrEqual(viewport.getBoundingClientRect().bottom);
    const offset = () => summaryEl.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
    const before = offset();
    await bar.click();
    await expect.element(page.elementLocator(document.querySelector("[data-reasoning-summary]")!)).toBeVisible();
    await new Promise((done) => setTimeout(done, 100));
    expect(Math.abs(offset() - before)).toBeLessThan(1);
    if (after > 0) {
      // Closing mid-thread holds it too (at the very bottom the browser must
      // pull the content down as it shrinks).
      await bar.click();
      await new Promise((done) => setTimeout(done, 100));
      expect(Math.abs(offset() - before)).toBeLessThan(1);
    }
  });

  // Owner, 2026-10-21: the block opens with a subtle transition (the
  // content grows from the bar down and fades in, layout ease).
  it("opens the thought block with a height and fade transition", async () => {
    await page.viewport(900, 900);
    const long = Array.from({ length: 10 }, (_, i) => `Reasoning sentence ${i + 1} about Line 244.`).join(" ");
    const message = {
      ...row("a", "All done.", 1, "assistant"),
      parts: [
        { type: "reasoning", text: long, state: "done" },
        { type: "text", text: "All done.", state: "done" },
      ],
    } as UIMessage;
    const { container } = await render(AssistantTurn, {
      message, timing: { status: "completed", startedAt: 1_000, endedAt: 13_000, stepCount: 0 }, onRefine: vi.fn(),
    });
    const details = container.querySelector<HTMLDetailsElement>("details")!;
    const content = getComputedStyle(details, "::details-content");
    expect(content.transitionDuration).toContain("0.35s");
    expect(content.transitionTimingFunction).toContain("cubic-bezier(0.16, 1, 0.3, 1)");
    const closedHeight = details.getBoundingClientRect().height;
    await page.getByText("Thought for 12s", { exact: true }).click();
    // Part way through, the block is taller than closed but not yet open.
    await new Promise((done) => setTimeout(done, 60));
    const midHeight = details.getBoundingClientRect().height;
    await new Promise((done) => setTimeout(done, 500));
    const openHeight = details.getBoundingClientRect().height;
    expect(midHeight).toBeGreaterThan(closedHeight);
    expect(midHeight).toBeLessThan(openHeight);
    expect(Number(getComputedStyle(details, "::details-content").opacity)).toBe(1);
  });

  // Owner, 2026-10-21: the thought block leaves out the step whose card is
  // under the reply, and its thinking follows the dash rule.
  it("leaves the edit step out of the thought block and reads a dash pause as a comma", async () => {
    const message = {
      ...row("a", "Proposed dropping the gap note.", 1, "assistant"),
      parts: [
        { type: "reasoning", text: "I'm checking the paragraph - it covers the hinge.", state: "done" },
        { type: "tool-readDocument", toolCallId: "read-1", state: "output-available", input: {}, output: "Step completed." },
        { type: "tool-proposeEdit", toolCallId: "edit-1", state: "output-available", input: {}, output: "Proposal created." },
        { type: "text", text: "Proposed dropping the gap note.", state: "done" },
      ],
    } as UIMessage;
    const { container } = await render(AssistantTurn, {
      message, timing: { status: "completed", startedAt: 1_000, endedAt: 5_000, stepCount: 2 }, onRefine: vi.fn(),
    });
    const bar = container.querySelector<HTMLElement>("[data-turn-status]")!;
    await expect.element(page.elementLocator(bar)).toBeVisible();
    bar.click();
    const reasoning = container.querySelector<HTMLElement>("[data-reasoning-summary]")!;
    await expect.element(page.elementLocator(reasoning)).toBeVisible();
    expect(reasoning.textContent?.trim()).toBe("I'm checking the paragraph, it covers the hinge.");
    expect(container.querySelector("[data-turn-headline]")?.textContent?.trim()).toBe("I'm checking the paragraph, it covers the hinge.");
    const trace = container.querySelector('[aria-label="Thought process"]')!;
    expect(trace.textContent).not.toContain("Suggested an edit");
    expect(trace.querySelectorAll("[data-trace-step]")).toHaveLength(1);
  });

  it("shows the summary under Thinking while it streams, and marks the answer busy", async () => {
    await page.viewport(480, 520);
    const { container, rerender } = await render(AssistantTurn, {
      message: streamingReply("streaming"),
      timing: { status: "running", startedAt: Date.now(), stepCount: 1 },
      onRefine: vi.fn(),
    });
    // Owner, 2026-10-21 (as Claude shows its thought process): the block is
    // folded while live, showing only its first line; opening it shows the
    // newest reasoning heading beside the clock, then the reasoning as text.
    const summary = container.querySelector("[data-reasoning-summary]")!;
    const headline = container.querySelector<HTMLElement>("[data-turn-headline]")!;
    await expect.element(page.elementLocator(summary)).not.toBeVisible();
    await expect.element(page.elementLocator(headline)).not.toBeVisible();
    await page.getByText("Working…", { exact: true }).click();
    await expect.element(page.elementLocator(summary)).toBeVisible();
    await expect.element(page.elementLocator(headline)).toBeVisible();
    expect(headline.textContent?.trim()).toBe("Planning the edits");
    expect([...summary.querySelectorAll("p")].map((line) => line.textContent)).toEqual([
      "Planning the edits",
      "I will list the deviations in Line 244 first.",
    ]);
    expect(summary.getAttribute("aria-busy")).toBe("true");
    const answer = container.querySelector("[id$='-answer']")!;
    expect(answer.getAttribute("aria-busy")).toBe("true");
    await page.screenshot({ path: `${CAPTURES}/reasoning-summary-streaming.png` });
    await rerender({ message: streamingReply("success"), timing: { status: "completed", startedAt: 1, endedAt: 2, stepCount: 1 } });
    await expect.poll(() => container.querySelector("[id$='-answer']")?.getAttribute("aria-busy")).toBe("false");
  });

  it("keeps the transcript out of the live region and announces a finished reply once", async () => {
    seedThreads();
    __setPaginatedRows("chatV2:listMessages", [row("q", "Summarize Line 242.", 1, "user")]);
    __setQueryData("chatV2:listTurns", [{ _id: "turn-1", promptMessageId: "q", order: 1, status: "running", startedAt: Date.now(), stepCount: 0 }]);
    await render(AgentChatPanel, { reportId, projectId });
    const log = page.getByRole("log", { name: "Conversation" });
    await expect.element(log).toHaveAttribute("aria-live", "off");
    const announcement = () => document.querySelector("[data-reply-announcement]")?.textContent;
    expect(announcement()).toBe("");
    __setPaginatedRows("chatV2:listMessages", [row("q", "Summarize Line 242.", 1, "user"), row("a", "Line 242 states the uncertainty.", 1, "assistant")]);
    __setQueryData("chatV2:listTurns", [{ _id: "turn-1", promptMessageId: "q", order: 1, status: "completed", startedAt: 1, endedAt: 2, stepCount: 0 }]);
    await expect.poll(announcement).toBe("The assistant's reply is ready.");
  });

  it("scrolls without animation when the writer asks for reduced motion", async () => {
    const matchMedia = window.matchMedia.bind(window);
    vi.spyOn(window, "matchMedia").mockImplementation((query: string) =>
      query.includes("prefers-reduced-motion") ? ({ ...matchMedia(query), matches: true, media: query }) : matchMedia(query));
    const scrollTo = vi.spyOn(Element.prototype, "scrollTo");
    seedThreads();
    __setPaginatedRows("chatV2:listMessages", [row("q", "Tighten 242.", 1, "user"), row("a", "Here is a tighter version.", 1, "assistant")]);
    __setQueryData("chatV2:listTurns", [{ _id: "turn-1", promptMessageId: "q", order: 1, status: "completed", startedAt: 1, endedAt: 2, stepCount: 0 }]);
    __setQueryData("chatV2:listProposals", [proposal()]);
    await render(AgentChatPanel, { reportId, projectId });
    await page.getByRole("button", { name: "More actions for this suggestion", exact: true }).click();
    await page.getByRole("menuitem", { name: "Refine with AI", exact: true }).click();
    await expect.poll(() => scrollTo.mock.calls.length).toBeGreaterThan(0);
    for (const [options] of scrollTo.mock.calls) {
      expect((options as ScrollToOptions).behavior).not.toBe("smooth");
    }
  });
});

describe("task 7: Continue offer", () => {
  function seedFinishedTurn(continuation: Record<string, unknown> | undefined, status = "completed") {
    seedThreads();
    __setPaginatedRows("chatV2:listMessages", [
      row("q0", "Fix the deviations.", 0, "user"), row("a0", "Done with Line 242.", 0, "assistant"),
      row("q1", "Continue.", 1, "user"), row("a1", "Line 242 is revised. Line 244 still has 5 deviations.", 1, "assistant"),
    ]);
    __setQueryData("chatV2:listTurns", [
      { _id: "turn-0", promptMessageId: "q0", order: 0, status: "completed", startedAt: 1, endedAt: 2, stepCount: 2,
        continuation: { reason: "lines_left", nextSection: "242" } },
      { _id: "turn-1", promptMessageId: "q1", order: 1, status, startedAt: 3, endedAt: 4, stepCount: 2,
        ...(continuation ? { continuation } : {}) },
    ]);
  }

  it("offers one Continue on the newest turn and sends it once, however fast the clicks", async () => {
    seedFinishedTurn({ reason: "lines_left", nextSection: "244", remaining: 5 });
    let settle!: (value: unknown) => void;
    __setMutationResult(sendName, new Promise((resolve) => { settle = resolve; }));
    await page.viewport(480, 760);
    await render(AgentChatPanel, { reportId, projectId });
    const offer = page.getByRole("button", { name: "Continue with Line 244", exact: true });
    await expect.element(offer).toBeVisible();
    // The older turn's offer is spent: only the newest turn offers one.
    expect(document.querySelectorAll("[data-continue-offer]")).toHaveLength(1);
    await composer().fill("A draft the offer must not touch");
    await page.screenshot({ path: `${CAPTURES}/continue-offer.png` });
    const button = offer.element() as HTMLButtonElement;
    // Two clicks before Svelte can re-render: the guard, not the disabled
    // state, has to stop the second one.
    button.click();
    button.click();
    await expect.poll(() => __mutationCalls(sendName).length).toBe(1);
    expect(__mutationCalls(sendName)[0]).toEqual({ reportId, content: "Continue with Line 244.", threadId: "thread-1" });
    await expect.element(composer()).toHaveValue("A draft the offer must not touch");
    settle({ threadId: "thread-1", messageId: "q2" });
    await expect.poll(() => document.querySelectorAll("[data-continue-offer]").length).toBe(0);
    expect(__mutationCalls(sendName)).toHaveLength(1);
  });

  it("offers Continue on a reply cut off (a failed turn), and nothing after a Stop or without an offer", async () => {
    // The engine ends a cut-off reply "failed" with continuation { reason: "cut_off" }.
    seedFinishedTurn({ reason: "cut_off" }, "failed");
    const view = await render(AgentChatPanel, { reportId, projectId });
    await expect.element(page.getByRole("button", { name: "Continue", exact: true })).toBeVisible();
    view.unmount();
    seedFinishedTurn({ reason: "cut_off" }, "aborted");
    const stopped = await render(AgentChatPanel, { reportId, projectId });
    await expect.element(page.getByText("Line 242 is revised.", { exact: false })).toBeVisible();
    expect(document.querySelectorAll("[data-continue-offer]")).toHaveLength(0);
    stopped.unmount();
    seedFinishedTurn(undefined);
    await render(AgentChatPanel, { reportId, projectId });
    await expect.element(page.getByText("Line 242 is revised.", { exact: false })).toBeVisible();
    expect(document.querySelectorAll("[data-continue-offer]")).toHaveLength(0);
  });
});

describe("task 7: Continue offer after a failed send", () => {
  it("keeps the offer when its send fails, so the writer can try again", async () => {
    seedThreads();
    __setPaginatedRows("chatV2:listMessages", [
      row("q1", "Fix the deviations.", 1, "user"), row("a1", "Line 242 is revised.", 1, "assistant"),
    ]);
    __setQueryData("chatV2:listTurns", [{ _id: "turn-1", promptMessageId: "q1", order: 1, status: "completed",
      startedAt: 3, endedAt: 4, stepCount: 2, continuation: { reason: "lines_left", nextSection: "244" } }]);
    __setMutationError(sendName, new Error("Connection unavailable"));
    await render(AgentChatPanel, { reportId, projectId });
    const offer = page.getByRole("button", { name: "Continue with Line 244", exact: true });
    await offer.click();
    await expect.element(page.getByRole("alert")).toHaveTextContent("Connection unavailable");
    // The unsent message offers Retry; the offer waits behind it.
    expect(document.querySelectorAll("[data-continue-offer]")).toHaveLength(0);
    await page.getByRole("button", { name: "Dismiss send error", exact: true }).click();
    await expect.element(offer).toBeVisible();
    __setMutationResult(sendName, { threadId: "thread-1", messageId: "q2" });
    await offer.click();
    expect(__mutationCalls(sendName)).toHaveLength(2);
  });

  it("says an old message cannot be resent when it is now too long", async () => {
    seedThreads();
    __setPaginatedRows("chatV2:listMessages", [
      row("q1", "A very long old prompt.", 1, "user"), row("a1", "An answer.", 1, "assistant"),
    ]);
    __setQueryData("chatV2:listTurns", [{ _id: "turn-1", promptMessageId: "q1", order: 1, status: "completed", startedAt: 3, endedAt: 4, stepCount: 0 }]);
    // Phase C (W2): Regenerate of a durable turn makes an alternative.
    __setMutationResult("chatV2:sendAlternative", refusedSend({ code: "CHAT_MESSAGE_TOO_LONG", message: "x", maxChars: 128_000 }));
    await render(AgentChatPanel, { reportId, projectId });
    await page.getByRole("button", { name: "Regenerate", exact: true }).click();
    await expect.element(page.getByRole("alert"))
      .toHaveTextContent("The original message is too long to send again. Write a new, shorter message instead.");
  });
});

describe("task 8: context-loss divider", () => {
  function seedLongThread() {
    seedThreads();
    const rows: UIMessage[] = [];
    for (let order = 0; order < 4; order += 1) {
      rows.push(row(`q${order}`, `Question ${order}`, order, "user"), row(`a${order}`, `Answer ${order}`, order, "assistant"));
    }
    __setPaginatedRows("chatV2:listMessages", rows);
    __setQueryData("chatV2:listTurns", [
      { _id: "turn-2", promptMessageId: "q2", order: 2, status: "completed", startedAt: 1, endedAt: 2, stepCount: 0, historyStartOrder: 1 },
      { _id: "turn-3", promptMessageId: "q3", order: 3, status: "completed", startedAt: 3, endedAt: 4, stepCount: 0, historyStartOrder: 2 },
    ]);
  }

  it("draws the divider above the first message the assistant still reads, with a one-time notice", async () => {
    seedLongThread();
    await page.viewport(480, 900);
    const view = await render(AgentChatPanel, { reportId, projectId });
    const divider = page.getByRole("separator", { name: "The assistant no longer reads messages above this line." });
    await expect.element(divider).toBeVisible();
    const question = (n: number) => page.getByText(`Question ${n}`, { exact: true }).element();
    const dividerEl = divider.element();
    expect(question(1).compareDocumentPosition(dividerEl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(dividerEl.compareDocumentPosition(question(2)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.querySelectorAll("[data-context-divider]")).toHaveLength(1);
    const notice = page.getByText("This conversation is long, so the assistant now reads only its newest messages.", { exact: false });
    await expect.element(notice).toBeVisible();
    await page.screenshot({ path: `${CAPTURES}/context-divider.png` });
    await page.getByRole("button", { name: "Dismiss this notice", exact: true }).click();
    await expect.poll(() => notice.elements().length).toBe(0);
    view.unmount();
    await render(AgentChatPanel, { reportId, projectId });
    await expect.element(divider).toBeVisible();
    expect(notice.elements()).toHaveLength(0);
  });

  it("draws nothing while the assistant reads the whole conversation", async () => {
    seedThreads();
    __setPaginatedRows("chatV2:listMessages", [row("q0", "Question 0", 0, "user"), row("a0", "Answer 0", 0, "assistant")]);
    __setQueryData("chatV2:listTurns", [{ _id: "turn-0", promptMessageId: "q0", order: 0, status: "completed", startedAt: 1, endedAt: 2, stepCount: 0 }]);
    await render(AgentChatPanel, { reportId, projectId });
    await expect.element(page.getByText("Answer 0", { exact: true })).toBeVisible();
    expect(document.querySelectorAll("[data-context-divider], [data-context-notice]")).toHaveLength(0);
  });
});

describe("task 9: drafts", () => {
  const threads = [
    { _id: "mapping-1", agentThreadId: "thread-1", title: "Original conversation" },
    { _id: "mapping-2", agentThreadId: "thread-2", title: "Second conversation" },
  ];
  async function navigate(name: string) {
    await page.getByRole("button", { name: "Conversation menu", exact: true }).click();
    await page.getByRole("menuitem", { name, exact: false }).click();
  }

  it("keeps each conversation's draft, restores it on select and reload, and clears it on send", async () => {
    seedThreads(threads);
    const first = await render(AgentChatPanel, { reportId, projectId });
    await composer().fill("Draft for the original conversation");
    await navigate("Second conversation");
    await expect.element(composer()).toHaveValue("");
    await composer().fill("Draft for the second conversation");
    await navigate("Original conversation");
    await expect.element(composer()).toHaveValue("Draft for the original conversation");
    await navigate("Second conversation");
    await expect.element(composer()).toHaveValue("Draft for the second conversation");
    first.unmount();

    // A reload reopens the conversation last used (not the newest) and its draft.
    const second = await render(AgentChatPanel, { reportId, projectId });
    await expect.element(composer()).toHaveValue("Draft for the second conversation");
    __setMutationResult(sendName, { threadId: "thread-2", messageId: "sent" });
    await send().click();
    expect(__mutationCalls(sendName)[0]).toMatchObject({ content: "Draft for the second conversation", threadId: "thread-2" });
    await expect.element(composer()).toHaveValue("");
    expect(Object.keys(sessionStorage).filter((key) => key.includes("thread:thread-2"))).toEqual([]);
    second.unmount();

    const third = await render(AgentChatPanel, { reportId, projectId });
    await expect.element(composer()).toHaveValue("");
    await navigate("Original conversation");
    await expect.element(composer()).toHaveValue("Draft for the original conversation");
    third.unmount();
  });

  it("keeps a new conversation's draft across a reload before its first send, and clears it on send", async () => {
    // No conversation yet: the panel is a new conversation from the start.
    const first = await render(AgentChatPanel, { reportId, projectId });
    await composer().fill("First question for this report");
    first.unmount();
    const second = await render(AgentChatPanel, { reportId, projectId });
    await expect.element(composer()).toHaveValue("First question for this report");
    // One stable key per report, never a fresh random one per mount.
    expect(Object.keys(sessionStorage).filter((key) => key.startsWith("banhall.chat.draft."))).toEqual(["banhall.chat.draft.report-1.new"]);
    __setMutationResult(sendName, { threadId: "thread-new", messageId: "first" });
    await send().click();
    expect(__mutationCalls(sendName)[0]).toMatchObject({ content: "First question for this report", newThread: true });
    await expect.element(composer()).toHaveValue("");
    expect(Object.keys(sessionStorage).filter((key) => key.startsWith("banhall.chat.draft."))).toEqual([]);
    second.unmount();
  });

  it("keeps a draft typed after New conversation, and reopens that conversation on reload", async () => {
    seedThreads(threads);
    const first = await render(AgentChatPanel, { reportId, projectId });
    await composer().fill("Draft for the original conversation");
    await navigate("New conversation");
    await expect.element(composer()).toHaveValue("");
    await composer().fill("A fresh question");
    first.unmount();
    const second = await render(AgentChatPanel, { reportId, projectId });
    await expect.element(composer()).toHaveValue("A fresh question");
    expect(__mutationCalls(sendName)).toHaveLength(0);
    await navigate("Original conversation");
    await expect.element(composer()).toHaveValue("Draft for the original conversation");
    await navigate("New conversation");
    await expect.element(composer()).toHaveValue("A fresh question");
    second.unmount();
  });

  it("keeps the Assistant's draft per report", async () => {
    seedThreads(threads);
    const first = await render(AgentChatPanel, { reportId, projectId });
    await composer().fill("Report one draft");
    first.unmount();
    await render(AgentChatPanel, { reportId: "report-2" as Id<"reports">, projectId });
    await expect.element(composer()).toHaveValue("");
  });
});

describe("task 10: connection state", () => {
  // Owner, 2026-10-21: the status line shows no timer, offline or not.
  it("says the connection is lost until it is back, with no timer", async () => {
    seedThreads();
    __setPaginatedRows("chatV2:listMessages", [row("q", "List the deviations in Line 244.", 1, "user")]);
    __setQueryData("chatV2:listTurns", [{ _id: "turn-1", promptMessageId: "q", order: 1, status: "running", startedAt: Date.now() - 4000, stepCount: 0 }]);
    await page.viewport(480, 760);
    const { container } = await render(AgentChatPanel, { reportId, projectId });
    const banner = page.getByText("Connection lost. Your message will send when you're back online.", { exact: true });
    expect(banner.elements()).toHaveLength(0);
    const status = () => container.querySelector("[data-turn-status]")?.textContent;
    await expect.poll(status).toBe("Working…");
    connection.offline!.value = true;
    await expect.element(banner).toBeVisible();
    await page.screenshot({ path: `${CAPTURES}/offline-banner.png` });
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(status()).toBe("Working…");
    expect(container.querySelector("[data-turn-status]")?.parentElement?.textContent).not.toMatch(/\d+\s*s\b/);
    connection.offline!.value = false;
    await expect.poll(() => banner.elements().length).toBe(0);
  });
});

describe("task 11: composer limits and labels", () => {
  it("counts characters near the limit and refuses a message over it", async () => {
    await page.viewport(480, 760);
    await render(AgentChatPanel, { reportId, projectId });
    await composer().fill("a".repeat(15_999));
    expect(document.querySelector("[data-composer-counter]")).toBeNull();
    await composer().fill("a".repeat(16_000));
    await expect.poll(() => document.querySelector("[data-composer-counter]")?.textContent?.replace(/\s+/g, " ").trim())
      .toBe("16,000 / 20,000 characters");
    await expect.element(send()).toBeEnabled();
    // The composer sends trimmed text, so spaces around it are not counted.
    await composer().fill(`   ${"a".repeat(20_000)}\n\n  `);
    await expect.poll(() => document.querySelector("[data-composer-counter]")?.textContent).toContain("20,000 / 20,000");
    await expect.element(send()).toBeEnabled();
    await composer().fill("a".repeat(20_001));
    const counter = document.querySelector("[data-composer-counter]")!;
    await expect.poll(() => counter.textContent).toContain("20,001 / 20,000");
    expect(counter.className).toContain("text-red-600");
    await expect.element(send()).toBeDisabled();
    await page.screenshot({ path: `${CAPTURES}/composer-counter.png` });
    await userEvent.keyboard("{Enter}");
    expect(__mutationCalls(sendName)).toHaveLength(0);
  });

  it("labels a report selection as selected text and refuses one over the highlight limit", async () => {
    const view = await render(AgentChatPanel, { reportId, projectId, pendingHighlight: { from: 1, to: 40, text: "The prototype failed at 80 C." } });
    await expect.element(page.getByText("Selected text", { exact: true })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Remove selected text", exact: true })).toBeVisible();
    expect(page.getByText("Pasted text", { exact: false }).elements()).toHaveLength(0);
    await view.rerender({ pendingHighlight: { from: 1, to: 12_002, text: "b".repeat(12_001) } });
    await expect.element(page.getByText("The selected text is 12,001 characters. Select up to 12,000 characters to send it.")).toBeVisible();
    await expect.element(send()).toBeDisabled();
  });
});

describe("task 12: bulk card Completion Report", () => {
  const bulkId = "proposal-bulk" as Id<"chatProposals">;
  const items = [
    { _id: "item-1", _creationTime: 1, proposalId: bulkId, projectId, itemId: "r-244-2-1", status: "resolved",
      reason: "Paragraph 2 now names the measured result.", section: "244", paragraphNumber: 2, kind: "rule", createdAt: 1 },
    { _id: "item-2", _creationTime: 2, proposalId: bulkId, projectId, itemId: "c-244-3-1", status: "blocked",
      reason: "The draft cannot state the cycle count.", missingFact: "The number of fatigue cycles.",
      missingFactSource: "The March interview.", section: "244", paragraphNumber: 3, kind: "content", createdAt: 2 },
  ];

  it("folds the checklist under its counts on the suggestion card", async () => {
    __setQueryData("chatV2:listProposalItems", items);
    await page.viewport(480, 760);
    const { container } = await render(ProposalCard, {
      proposal: proposal({ _id: bulkId, kind: "replacements", targetText: undefined, newText: undefined,
        replacements: [{ find: "An old passage.", replaceWith: "A corrected passage." }], requireUniqueTargets: true }),
    });
    await expect.element(page.getByRole("button", { name: "Apply", exact: true })).toBeVisible();
    const report = container.querySelector("[data-completion-report]") as HTMLDetailsElement;
    expect(report.querySelector("summary")?.textContent?.replace(/\s+/g, " ").trim()).toBe("Completion Report 1 resolved, 1 blocked");
    expect(report.open).toBe(false);
    await page.getByText("Completion Report", { exact: true }).click();
    // Owner direction 2026-10-21: only the place, never the id or a kind.
    await expect.element(page.getByText("Line 244, paragraph 2", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Line 244, paragraph 3", { exact: true })).toBeVisible();
    expect(report.textContent).not.toMatch(/\b(Rule|Your request)\b/);
    expect(container.textContent).not.toContain("r-244-2-1");
    expect(container.textContent).not.toContain("c-244-3-1");
    expect(container.querySelector('[data-checklist-item="r-244-2-1"]')).not.toBeNull();
    expect(container.textContent).toContain("Paragraph 2 now names the measured result.");
    expect(container.textContent).toContain("Missing fact: The number of fatigue cycles.");
    await page.screenshot({ path: `${CAPTURES}/bulk-completion-report.png` });
    for (const element of container.querySelectorAll("*")) {
      expect(Number.parseInt(getComputedStyle(element).fontWeight, 10)).toBeLessThanOrEqual(500);
    }
  });

  it("leaves an ordinary suggestion without a report", async () => {
    __setQueryData("chatV2:listProposalItems", items);
    const { container } = await render(ProposalCard, { proposal: proposal() });
    await expect.element(page.getByRole("button", { name: "Apply", exact: true })).toBeVisible();
    expect(container.querySelector("[data-completion-report]")).toBeNull();
  });
});
