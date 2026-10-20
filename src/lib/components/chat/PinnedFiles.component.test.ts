/**
 * Chat parity Phase C, package W1 (spec-chat-parity-phase-c): "Read a file
 * in full" in Message options pins up to 5 of the project's files to the next
 * message. It picks files already in the project and uploads nothing. Writer
 * messages show the files they pinned. All data is fictional.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { UIMessage } from "@convex-dev/agent";
import type { Id } from "../../../../convex/_generated/dataModel";
import AgentChatPanel from "./AgentChatPanel.svelte";
import { __resetAuthState } from "$lib/test/convex-auth-stub";
import {
  __callOrder,
  __mutationCalls,
  __queryArgsHistory,
  __resetConvexStub,
  __setMutationResult,
  __setPaginatedRows,
  __setQueryData,
} from "$lib/test/convex-svelte-stub.svelte";

const sonner = vi.hoisted(() => ({
  error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn(),
}));
vi.mock("svelte-sonner", () => ({ toast: sonner }));

const CAPTURES = "../../../../.vitest-attachments/chat-parity-phase-c";
const reportId = "report-1" as Id<"reports">;
const projectId = "project-1" as Id<"projects">;

const options = () => page.getByRole("button", { name: "Message options", exact: true });
const readInFull = () => page.getByRole("menuitem", { name: "Read a file in full" });
const heading = () => page.getByText("Choose up to 5 project files to read with this message", { exact: true });
const fileOption = (name: string) => page.getByRole("checkbox", { name, exact: true });
const composer = () => page.getByRole("textbox", { name: "Message the report assistant" });
const uploadCalls = () =>
  __callOrder().filter((name) => name.startsWith("uploadAttempts:") || (name.startsWith("documents:") && name !== "documents:listDocuments"));

function projectFile(name: string, extra: Record<string, unknown> = {}) {
  return {
    _id: `doc-${name}`, fileName: name, fileType: name.endsWith(".pdf") ? "pdf" : name.endsWith(".png") ? "image" : "txt",
    source: "context_input", category: "other", createdAt: 1, sizeChars: 10, wordCount: 2, hasFile: true,
    mimeType: null, url: null, archived: false, processingStatus: "ready", processingDetail: null, ...extra,
  };
}

const FILES = [
  "rig-notes.txt", "loop-figure.png", "scan.pdf", "budget.xlsx", "minutes.docx", "plan.md",
].map((name) => projectFile(name));

function row(id: string, text: string, order: number, role: UIMessage["role"]): UIMessage {
  return {
    id, key: id, order, stepOrder: role === "user" ? 0 : 1, role, status: "success", text,
    _creationTime: 1000 + order, parts: [{ type: "text", text }],
  } as UIMessage;
}

beforeEach(() => {
  __resetConvexStub(); __resetAuthState(); localStorage.clear(); sessionStorage.clear();
  for (const fn of Object.values(sonner)) fn.mockClear();
  for (const name of ["chatV2:listThreads", "chatV2:listTurns", "chatV2:listProposals", "research:listSessions"]) __setQueryData(name, []);
  __setQueryData("chatV2:listMessages", { streams: { kind: "list", messages: [] } });
  __setPaginatedRows("chatV2:listMessages", []);
  __setQueryData("documents:listDocuments", [...FILES, projectFile("old-notes.txt", { archived: true })]);
});

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/**
 * Waits until `target` has focus and keeps it across three animation frames.
 * bits-ui's DropdownMenu moves focus to its first item twice as it opens, a
 * frame apart (its focus scope mounts, then mounts again), so a key pressed
 * between the two passes is undone. Waiting for focus to hold, not just to
 * arrive, makes the next key land on a settled menu.
 */
async function focusSettlesOn(target: ReturnType<typeof page.getByRole>) {
  await expect
    .poll(async () => {
      const element = target.query();
      if (!element || document.activeElement !== element) return false;
      for (let frame = 0; frame < 3; frame += 1) await nextFrame();
      return document.activeElement === element;
    })
    .toBe(true);
}

async function openPicker() {
  await options().click();
  await readInFull().click();
  await expect.element(heading()).toBeVisible();
}

describe("Read a file in full", () => {
  it("lists the project's files, not archived ones, and subscribes only once options open", async () => {
    await render(AgentChatPanel, { reportId, projectId });
    await expect.element(composer()).toBeVisible();
    // Nothing is subscribed before Message options is opened.
    expect(__queryArgsHistory("documents:listDocuments").filter((args) => args !== "skip")).toEqual([]);
    await openPicker();
    expect(__queryArgsHistory("documents:listDocuments")).toContainEqual({ projectId });
    for (const file of FILES) await expect.element(fileOption(file.fileName)).toBeVisible();
    expect(fileOption("old-notes.txt").elements()).toHaveLength(0);
    // Picking files never offers an upload.
    expect(document.querySelector('input[type="file"]')).toBeNull();
    await page.viewport(480, 760);
    await page.screenshot({ path: `${CAPTURES}/pin-picker.png` });
  });

  it("pins up to 5 files as chips, sends them with the message, then clears them", async () => {
    __setMutationResult("chatV2:sendMessage", { threadId: "thread-1", messageId: "prompt-1" });
    await render(AgentChatPanel, { reportId, projectId });
    await openPicker();
    for (const file of FILES.slice(0, 5)) await fileOption(file.fileName).click();
    // The picker stays open; a sixth file cannot be added.
    await expect.element(fileOption("rig-notes.txt")).toHaveAttribute("aria-checked", "true");
    await expect.element(fileOption("plan.md")).toBeDisabled();
    await userEvent.keyboard("{Escape}");
    await expect.element(heading()).not.toBeInTheDocument();
    const chips = () => [...document.querySelectorAll("[data-pinned-chip]")].map((el) => el.textContent?.trim());
    await expect.poll(chips).toEqual(FILES.slice(0, 5).map((file) => file.fileName));
    await page.viewport(480, 760);
    await page.screenshot({ path: `${CAPTURES}/pinned-chips.png` });

    // A chip comes off with its own button.
    await page.getByRole("button", { name: "Remove budget.xlsx", exact: true }).click();
    await expect.poll(chips).toEqual(["rig-notes.txt", "loop-figure.png", "scan.pdf", "minutes.docx"]);

    await composer().fill("Compare the figure with the notes.");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect.poll(() => __mutationCalls("chatV2:sendMessage").length).toBe(1);
    expect(__mutationCalls("chatV2:sendMessage")[0]).toMatchObject({
      content: "Compare the figure with the notes.",
      pinnedDocumentIds: ["doc-rig-notes.txt", "doc-loop-figure.png", "doc-scan.pdf", "doc-minutes.docx"],
    });
    // Cleared after the send, like a per-message option.
    await expect.poll(chips).toEqual([]);
    expect(uploadCalls()).toEqual([]);
  });

  it("works from the keyboard", async () => {
    await render(AgentChatPanel, { reportId, projectId });
    (options().element() as HTMLElement).focus();
    await expect.element(options()).toHaveFocus();
    // The menu focuses its first item twice as it opens (see focusSettlesOn);
    // an arrow pressed in between was lost, which made this test flaky.
    await userEvent.keyboard("{Enter}");
    await focusSettlesOn(page.getByRole("menuitemcheckbox", { name: "Use Brain examples for this message" }));
    await userEvent.keyboard("{ArrowDown}");
    await expect.element(page.getByRole("menuitemcheckbox", { name: "Search the web in this conversation" })).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    await expect.element(readInFull()).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await expect.element(heading()).toBeVisible();
    await expect.element(fileOption("rig-notes.txt")).toHaveFocus();
    await userEvent.keyboard(" ");
    await expect.element(fileOption("rig-notes.txt")).toHaveAttribute("aria-checked", "true");
    await userEvent.keyboard("{Tab}");
    await expect.element(fileOption("loop-figure.png")).toHaveFocus();
    // Escape closes the picker and gives focus back to Message options.
    await userEvent.keyboard("{Escape}");
    await expect.element(heading()).not.toBeInTheDocument();
    await expect.element(options()).toHaveFocus();
    await expect.element(page.getByRole("button", { name: "Remove rig-notes.txt", exact: true })).toBeInTheDocument();
  });

  it("drops a pinned file archived meanwhile", async () => {
    await render(AgentChatPanel, { reportId, projectId });
    await openPicker();
    await fileOption("scan.pdf").click();
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByRole("button", { name: "Remove scan.pdf", exact: true })).toBeInTheDocument();
    __setQueryData("documents:listDocuments", FILES.map((file) => (file.fileName === "scan.pdf" ? { ...file, archived: true } : file)));
    await expect.element(page.getByRole("button", { name: "Remove scan.pdf", exact: true })).not.toBeInTheDocument();
  });

  // Review R2 P3-5: 44 px on a coarse pointer for the menu item and each chip's remove button.
  it("gives its controls a 44 px touch area on a coarse pointer", async () => {
    await render(AgentChatPanel, { reportId, projectId });
    await openPicker();
    const rows = document.querySelectorAll("[data-file-option]");
    expect(rows.length).toBe(FILES.length);
    for (const row of rows) expect(row.className).toContain("pointer-coarse:min-h-11");
    await fileOption("scan.pdf").click();
    await userEvent.keyboard("{Escape}");
    const remove = page.getByRole("button", { name: "Remove scan.pdf", exact: true });
    await expect.element(remove).toBeInTheDocument();
    expect((remove.element() as HTMLElement).className).toContain("pointer-coarse:before:-inset-3.5");
    expect((remove.element() as HTMLElement).className).toContain("relative");
    await options().click();
    await expect.element(readInFull()).toBeVisible();
    expect((readInFull().element() as HTMLElement).className).toContain("pointer-coarse:min-h-11");
  });

  it("says when the project has no files", async () => {
    __setQueryData("documents:listDocuments", []);
    await render(AgentChatPanel, { reportId, projectId });
    await openPicker();
    await expect.element(page.getByText("No files in this project yet. Add them in the Files panel.", { exact: true })).toBeVisible();
  });
});

describe("writer messages", () => {
  it("show the files they pinned", async () => {
    __setQueryData("chatV2:listThreads", [{
      _id: "mapping-1", agentThreadId: "thread-1", title: "Figure check", createdAt: 1,
      startedByCurrentUser: true, createdByName: "Avery Lane",
    }]);
    __setPaginatedRows("chatV2:listMessages", [
      row("q1", "Compare the figure with the notes.", 1, "user"),
      row("a1", "They agree.", 1, "assistant"),
    ]);
    __setQueryData("chatV2:listTurns", [{
      _id: "turn-1", promptMessageId: "q1", order: 1, status: "completed", startedAt: 1, endedAt: 2, stepCount: 0,
      userId: "writer-1", fromCurrentUser: true,
      pinnedDocumentIds: ["doc-loop-figure.png", "doc-rig-notes.txt"],
      pinnedFiles: [
        { documentId: "doc-loop-figure.png", name: "loop-figure.png" },
        { documentId: "doc-rig-notes.txt", name: "rig-notes.txt" },
      ],
    }]);
    const { container } = await render(AgentChatPanel, { reportId, projectId });
    const list = page.getByRole("list", { name: "Files read in full with this message" });
    await expect.element(list).toBeVisible();
    const names = [...container.querySelectorAll("[data-pinned-files] li")].map((el) => el.textContent?.trim());
    expect(names).toEqual(["loop-figure.png", "rig-notes.txt"]);
    await page.viewport(480, 760);
    await page.screenshot({ path: `${CAPTURES}/pinned-on-message.png` });
  });
});
