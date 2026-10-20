/**
 * Chat parity Phase B, package W2 (spec-chat-parity-phase-b): the automatic
 * link chip, author labels, the Stop confirmation, the skip note, the
 * thread starter, the notification opt-in, and the page-level reply signal
 * (ring, dot, tab title). All data is fictional.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { UIMessage } from "@convex-dev/agent";
import type { Id } from "../../../../convex/_generated/dataModel";
import { __resetAuthState } from "$lib/test/convex-auth-stub";
import { __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import {
  __mutationCalls,
  __resetConvexStub,
  __setMutationResult,
  __setPaginatedRows,
  __setQueryData,
  __setQueryDataForArgs,
} from "$lib/test/convex-svelte-stub.svelte";
import {
  NOTIFY_REPLIES_KEY,
  REPLY_READY_TITLE_PREFIX,
  assistantSignal,
  seenKey,
} from "$lib/chat/replySignal.svelte";
import AgentChatPanel from "./AgentChatPanel.svelte";
import ReplySignalFixture from "./ReplySignalFixture.svelte";

const sonner = vi.hoisted(() => ({
  error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn(),
}));
vi.mock("svelte-sonner", () => ({ toast: sonner }));

const CAPTURES = "../../../../.vitest-attachments/chat-parity-phase-b";
const reportId = "report-1" as Id<"reports">;
const projectId = "project-1" as Id<"projects">;

function row(id: string, text: string, order: number, role: UIMessage["role"]): UIMessage {
  return {
    id, key: id, order, stepOrder: role === "user" ? 0 : 1, role, status: "success", text,
    _creationTime: 1000 + order, parts: [{ type: "text", text }],
  } as UIMessage;
}

type TurnRow = Record<string, unknown> & { order: number };
function turn(order: number, extra: Record<string, unknown> = {}): TurnRow {
  return {
    _id: `turn-${order}`, promptMessageId: `q${order}`, order, status: "completed",
    startedAt: 1, endedAt: 2, stepCount: 0, userId: "writer-1", senderName: "Avery Lane", fromCurrentUser: true,
    ...extra,
  };
}

function seedThread(threads: Array<Record<string, unknown>> = [{
  _id: "mapping-1", agentThreadId: "thread-1", title: "Deviation fixes", createdAt: 1,
  startedByCurrentUser: true, createdByName: "Avery Lane",
}]) {
  __setQueryData("chatV2:listThreads", threads);
}

beforeEach(() => {
  __resetConvexStub(); __resetAuthState(); localStorage.clear(); sessionStorage.clear();
  __resetPage(); __setPageUrl("/project/project-1");
  for (const fn of Object.values(sonner)) fn.mockClear();
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe("automatic links", () => {
  it("render as a muted chip, not as a writer message", async () => {
    seedThread();
    __setPaginatedRows("chatV2:listMessages", [
      row("q1", "Fix the deviations in every Line.", 1, "user"),
      row("a1", "Line 242 is proposed.", 1, "assistant"),
      row("q2", "Continue with Line 244.", 2, "user"),
      row("a2", "Line 244 is proposed.", 2, "assistant"),
      row("q3", "Continue.", 3, "user"),
      row("a3", "Done.", 3, "assistant"),
    ]);
    __setQueryData("chatV2:listTurns", [
      turn(1, { continuation: { reason: "lines_left", nextSection: "244", remaining: 2 } }),
      turn(2, { origin: "auto_continue", continuation: { reason: "step_limit" } }),
      turn(3, { origin: "auto_continue" }),
    ]);
    const { container } = await render(AgentChatPanel, { reportId, projectId });
    await expect.element(page.getByText("Continuing with Line 244", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Continuing", { exact: true })).toBeVisible();
    const chips = [...container.querySelectorAll("[data-auto-continue-chip]")].map((el) => el.textContent?.trim());
    expect(chips).toEqual(["Continuing with Line 244", "Continuing"]);
    // The link's own text never shows as something the writer wrote.
    expect(page.getByText("Continue with Line 244.", { exact: true }).elements()).toHaveLength(0);
    await expect.element(page.getByText("Fix the deviations in every Line.", { exact: true })).toBeVisible();
    await page.viewport(480, 760);
    await page.screenshot({ path: `${CAPTURES}/auto-continue-chip.png` });
  });
});

describe("authors", () => {
  it("label writer messages when more than one person wrote in the conversation", async () => {
    seedThread();
    __setPaginatedRows("chatV2:listMessages", [
      row("q1", "List the deviations in Line 242.", 1, "user"),
      row("a1", "Two Deviations.", 1, "assistant"),
      row("q2", "Fix the first one.", 2, "user"),
      row("a2", "Proposed.", 2, "assistant"),
    ]);
    __setQueryData("chatV2:listTurns", [
      turn(1),
      turn(2, { userId: "writer-2", senderName: "Jordan Reyes", fromCurrentUser: false }),
    ]);
    const { container } = await render(AgentChatPanel, { reportId, projectId });
    await expect.element(page.getByText("Jordan Reyes", { exact: true })).toBeVisible();
    const labels = [...container.querySelectorAll("[data-message-author]")].map((el) => el.textContent?.trim());
    expect(labels).toEqual(["You", "Jordan Reyes"]);
    await page.viewport(480, 760);
    await page.screenshot({ path: `${CAPTURES}/author-labels.png` });
  });

  it("show no labels when one person wrote everything", async () => {
    seedThread();
    __setPaginatedRows("chatV2:listMessages", [
      row("q1", "List the deviations in Line 242.", 1, "user"),
      row("a1", "Two Deviations.", 1, "assistant"),
      row("q2", "Fix the first one.", 2, "user"),
      row("a2", "Proposed.", 2, "assistant"),
    ]);
    __setQueryData("chatV2:listTurns", [turn(1), turn(2)]);
    const { container } = await render(AgentChatPanel, { reportId, projectId });
    await expect.element(page.getByText("Fix the first one.", { exact: true })).toBeVisible();
    expect(container.querySelectorAll("[data-message-author]")).toHaveLength(0);
  });

  it("the conversation menu says who started a conversation someone else started", async () => {
    seedThread([
      { _id: "mapping-1", agentThreadId: "thread-1", title: "My questions", createdAt: 1, startedByCurrentUser: true, createdByName: "Avery Lane" },
      { _id: "mapping-2", agentThreadId: "thread-2", title: "Line 246 review", createdAt: 1, startedByCurrentUser: false, createdByName: "Jordan Reyes" },
    ]);
    await render(AgentChatPanel, { reportId, projectId });
    await page.getByRole("button", { name: "Conversation menu" }).click();
    await expect.element(page.getByText("Started by Jordan Reyes", { exact: true })).toBeVisible();
    expect(page.getByText("Started by Avery Lane").elements()).toHaveLength(0);
    await page.viewport(480, 760);
    await page.screenshot({ path: `${CAPTURES}/thread-started-by.png` });
  });
});

describe("Stop confirmation", () => {
  function seedRunning(extra: Record<string, unknown>) {
    seedThread();
    __setPaginatedRows("chatV2:listMessages", [row("q1", "Fix the deviations in Line 244.", 1, "user")]);
    __setQueryData("chatV2:listTurns", [turn(1, { status: "running", endedAt: undefined, startedAt: Date.now(), ...extra })]);
    __setMutationResult("chatV2:abortStreaming", true);
  }

  it("asks before stopping someone else's reply, and Keep going keeps it", async () => {
    seedRunning({ userId: "writer-2", senderName: "Jordan Reyes", fromCurrentUser: false });
    await render(AgentChatPanel, { reportId, projectId });
    await page.getByRole("button", { name: "Stop generating", exact: true }).click();
    const dialog = page.getByRole("alertdialog");
    await expect.element(dialog).toBeVisible();
    await expect.element(dialog.getByText("Stop Jordan Reyes's reply?")).toBeVisible();
    await expect.element(dialog.getByText("Jordan Reyes started this reply. Stopping it ends it for everyone.")).toBeVisible();
    await page.viewport(480, 760);
    await page.screenshot({ path: `${CAPTURES}/stop-confirmation.png` });
    await page.getByRole("button", { name: "Keep going", exact: true }).click();
    await expect.element(dialog).not.toBeInTheDocument();
    expect(__mutationCalls("chatV2:abortStreaming")).toHaveLength(0);

    await page.getByRole("button", { name: "Stop generating", exact: true }).click();
    await page.getByRole("button", { name: "Stop reply", exact: true }).click();
    await expect.poll(() => __mutationCalls("chatV2:abortStreaming")).toHaveLength(1);
    expect(__mutationCalls("chatV2:abortStreaming")[0]).toEqual({ threadId: "thread-1", order: 1 });
  });

  it("stops your own reply at once", async () => {
    seedRunning({});
    await render(AgentChatPanel, { reportId, projectId });
    await page.getByRole("button", { name: "Stop generating", exact: true }).click();
    await expect.poll(() => __mutationCalls("chatV2:abortStreaming")).toHaveLength(1);
    expect(page.getByRole("alertdialog").elements()).toHaveLength(0);
  });

  it("asks without a name when none is on record", async () => {
    seedRunning({ userId: "writer-3", senderName: undefined, fromCurrentUser: false });
    await render(AgentChatPanel, { reportId, projectId });
    await page.getByRole("button", { name: "Stop generating", exact: true }).click();
    await expect.element(page.getByText("Stop this reply?", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Someone else started this reply. Stopping it ends it for everyone.")).toBeVisible();
  });
});

describe("skip note", () => {
  it.each([
    ["budget", "Stopped continuing automatically: this project's daily chat budget is used up."],
    ["no_progress", "Stopped continuing automatically because the last reply made no progress."],
  ])("explains a %s skip beside Continue", async (reason, copy) => {
    seedThread();
    __setPaginatedRows("chatV2:listMessages", [
      row("q1", "Fix the deviations.", 1, "user"),
      row("a1", "Line 242 is proposed.", 1, "assistant"),
    ]);
    __setQueryData("chatV2:listTurns", [turn(1, {
      continuation: { reason: "lines_left", nextSection: "244", remaining: 2 }, autoContinueSkipped: reason,
    })]);
    await render(AgentChatPanel, { reportId, projectId });
    await expect.element(page.getByRole("button", { name: "Continue with Line 244" })).toBeVisible();
    await expect.element(page.getByText(copy, { exact: true })).toBeVisible();
    if (reason === "budget") {
      await page.viewport(480, 760);
      await page.screenshot({ path: `${CAPTURES}/skip-note.png` });
    }
  });

  it("says nothing when an admin turned it off", async () => {
    seedThread();
    __setPaginatedRows("chatV2:listMessages", [row("q1", "Fix.", 1, "user"), row("a1", "Proposed.", 1, "assistant")]);
    __setQueryData("chatV2:listTurns", [turn(1, { continuation: { reason: "step_limit" }, autoContinueSkipped: "off" })]);
    const { container } = await render(AgentChatPanel, { reportId, projectId });
    await expect.element(page.getByRole("button", { name: "Continue", exact: true })).toBeVisible();
    expect(container.querySelectorAll("[data-auto-continue-skip]")).toHaveLength(0);
  });
});

describe("notification opt-in", () => {
  function fakeNotification(permission: NotificationPermission, answer: NotificationPermission) {
    const shown: Array<[string, NotificationOptions | undefined]> = [];
    class FakeNotification {
      static permission = permission;
      static requestPermission = vi.fn(async () => {
        FakeNotification.permission = answer;
        return answer;
      });
      constructor(title: string, options?: NotificationOptions) {
        shown.push([title, options]);
      }
    }
    vi.stubGlobal("Notification", FakeNotification);
    return { shown, FakeNotification };
  }

  it("asks the browser on opt-in and remembers a yes", async () => {
    const { FakeNotification } = fakeNotification("default", "granted");
    await render(AgentChatPanel, { reportId, projectId });
    await page.getByRole("button", { name: "Conversation menu" }).click();
    const item = page.getByRole("menuitemcheckbox", { name: "Notify me when a reply is ready" });
    await expect.element(item).toHaveAttribute("aria-checked", "false");
    await item.click();
    await expect.element(item).toHaveAttribute("aria-checked", "true");
    expect(FakeNotification.requestPermission).toHaveBeenCalledOnce();
    expect(localStorage.getItem(NOTIFY_REPLIES_KEY)).toBe("1");
  });

  it("stays off when the browser says no", async () => {
    fakeNotification("default", "denied");
    await render(AgentChatPanel, { reportId, projectId });
    await page.getByRole("button", { name: "Conversation menu" }).click();
    const item = page.getByRole("menuitemcheckbox", { name: "Notify me when a reply is ready" });
    await item.click();
    await expect.element(item).toHaveAttribute("aria-checked", "false");
    expect(localStorage.getItem(NOTIFY_REPLIES_KEY)).toBeNull();
  });
});

describe("reply signal", () => {
  it("decides the launcher state from activity and what was seen", () => {
    const base = { active: false, mineActive: false, mineLastFinishedAt: 200, seen: 100, panelOpen: false };
    expect(assistantSignal({ ...base, active: true })).toBe("working");
    expect(assistantSignal(base)).toBe("ready");
    expect(assistantSignal({ ...base, panelOpen: true })).toBeNull();
    expect(assistantSignal({ ...base, seen: 200 })).toBeNull();
    expect(assistantSignal({ ...base, mineLastFinishedAt: null })).toBeNull();
  });

  it("shows a working ring on the Assistant toggle while a reply runs", async () => {
    __setQueryData("chatV2:reportChatActivity", { active: true, mineActive: false, mineLastFinishedAt: null });
    const { container } = await render(ReplySignalFixture, { reportId });
    await expect.element(page.getByRole("button", { name: "Assistant, writing a reply" })).toBeVisible();
    expect(container.querySelector("[data-assistant-working]")).not.toBeNull();
    await page.screenshot({ path: `${CAPTURES}/assistant-working.png` });
  });

  it("shows a dot for your reply that finished while the panel was closed, until you open it", async () => {
    __setQueryData("chatV2:reportChatActivity", { active: false, mineActive: false, mineLastFinishedAt: 100 });
    const screen = await render(ReplySignalFixture, { reportId });
    // A reply from before this page ever looked counts as seen.
    await expect.poll(() => localStorage.getItem(seenKey(reportId))).toBe("100");
    expect(screen.container.querySelector("[data-assistant-ready-dot]")).toBeNull();

    __setQueryData("chatV2:reportChatActivity", { active: false, mineActive: false, mineLastFinishedAt: 200 });
    await expect.element(page.getByRole("button", { name: "Assistant, your reply is ready" })).toBeVisible();
    expect(screen.container.querySelector("[data-assistant-ready-dot]")).not.toBeNull();
    await page.screenshot({ path: `${CAPTURES}/assistant-ready-dot.png` });

    await screen.rerender({ panelOpen: true });
    await expect.element(page.getByRole("button", { name: "Assistant", exact: true })).toBeVisible();
    expect(localStorage.getItem(seenKey(reportId))).toBe("200");
    await screen.rerender({ panelOpen: false });
    expect(screen.container.querySelector("[data-assistant-ready-dot]")).toBeNull();
  });

  it("prefixes the tab title only while the tab is hidden, and notifies with generic text", async () => {
    const shown: Array<[string, NotificationOptions | undefined]> = [];
    class FakeNotification {
      static permission: NotificationPermission = "granted";
      static requestPermission = vi.fn(async () => "granted" as const);
      constructor(title: string, options?: NotificationOptions) {
        shown.push([title, options]);
      }
    }
    vi.stubGlobal("Notification", FakeNotification);
    localStorage.setItem(NOTIFY_REPLIES_KEY, "1");
    let visibility: DocumentVisibilityState = "hidden";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
    document.title = "Banhall";

    __setQueryData("chatV2:reportChatActivity", { active: true, mineActive: true, mineLastFinishedAt: 100 });
    await render(ReplySignalFixture, { reportId });
    __setQueryData("chatV2:reportChatActivity", { active: false, mineActive: false, mineLastFinishedAt: 200 });
    await expect.poll(() => document.title, { timeout: 6_000 }).toBe(`${REPLY_READY_TITLE_PREFIX}Banhall`);
    expect(shown).toEqual([["Banhall", { body: "Your reply is ready." }]]);

    visibility = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    await expect.poll(() => document.title).toBe("Banhall");
  });

  // Review R2 P3-7a: a page that moves to another report starts over.
  it("never signals one report's reply on another report", async () => {
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => "hidden");
    document.title = "Banhall";
    const other = "report-2" as Id<"reports">;
    __setQueryDataForArgs("chatV2:reportChatActivity", { reportId }, { active: false, mineActive: false, mineLastFinishedAt: 100 });
    __setQueryDataForArgs("chatV2:reportChatActivity", { reportId: other }, { active: false, mineActive: false, mineLastFinishedAt: 500 });
    const screen = await render(ReplySignalFixture, { reportId });
    await expect.poll(() => localStorage.getItem(seenKey(reportId))).toBe("100");

    // The first report's reply finishes, and the page moves on before the
    // title would change.
    __setQueryDataForArgs("chatV2:reportChatActivity", { reportId }, { active: false, mineActive: false, mineLastFinishedAt: 200 });
    await screen.rerender({ reportId: other });
    // The other report's newer reply was never watched finishing here.
    await expect.poll(() => localStorage.getItem(seenKey(other))).toBe("500");
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    expect(document.title).toBe("Banhall");
    expect(screen.container.querySelector("[data-assistant-ready-dot]")).toBeNull();
    // The first report keeps its own seen time.
    expect(localStorage.getItem(seenKey(reportId))).toBe("100");
  });

  it("leaves the title alone while the tab is visible, and while a next link runs", async () => {
    let visibility: DocumentVisibilityState = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
    document.title = "Banhall";
    __setQueryData("chatV2:reportChatActivity", { active: true, mineActive: true, mineLastFinishedAt: 100 });
    await render(ReplySignalFixture, { reportId });
    __setQueryData("chatV2:reportChatActivity", { active: false, mineActive: false, mineLastFinishedAt: 200 });
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    expect(document.title).toBe("Banhall");

    // Hidden, but the job's next link starts within the settle time.
    visibility = "hidden";
    __setQueryData("chatV2:reportChatActivity", { active: false, mineActive: false, mineLastFinishedAt: 300 });
    __setQueryData("chatV2:reportChatActivity", { active: true, mineActive: true, mineLastFinishedAt: 300 });
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    expect(document.title).toBe("Banhall");
  });
});
