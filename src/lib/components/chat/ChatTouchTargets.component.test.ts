/**
 * Chat parity Phase C, package W3: 44 px touch targets in the report chat,
 * measured (review R2: matching class names proves nothing). This suite runs
 * twice, in the pointer instances of vitest.component.config.ts: with a
 * coarse pointer every listed control measures at least 44 px; with a fine
 * pointer the controls keep their board sizes. All data is fictional.
 */
import { beforeEach, describe, expect, inject, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { UIMessage } from "@convex-dev/agent";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";
import { __resetAuthState } from "$lib/test/convex-auth-stub";
import { __resetConvexStub, __setPaginatedRows, __setQueryData } from "$lib/test/convex-svelte-stub.svelte";
import AgentChatPanel from "./AgentChatPanel.svelte";

declare module "vitest" {
  export interface ProvidedContext {
    expectedPointer: "fine" | "coarse";
  }
}

vi.mock("svelte-sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() } }));

const reportId = "report-1" as Id<"reports">;
const projectId = "project-1" as Id<"projects">;
const pointer = inject("expectedPointer");
const coarse = pointer === "coarse";
const TOUCH = 44;

function row(id: string, text: string, order: number, role: UIMessage["role"]): UIMessage {
  return {
    id, key: id, order, stepOrder: role === "user" ? 0 : 1, role, status: "success", text,
    _creationTime: 1000 + order, parts: [{ type: "text", text }],
  } as UIMessage;
}

function seed() {
  for (const name of ["chatV2:listTurnWebSources", "chatV2:listArchivedThreads", "research:listSessions", "chatFeedback:getViewerVotes"]) {
    __setQueryData(name, []);
  }
  __setQueryData("chatV2:listThreads", [{ _id: "mapping-1", agentThreadId: "thread-1", title: "Kiln drying review", createdAt: 1, startedByCurrentUser: true, webSearch: true }]);
  __setQueryData("chatV2:listMessages", { streams: { kind: "list", messages: [] } });
  __setPaginatedRows("chatV2:listMessages", [row("q1", "How does the kiln drift?", 1, "user"), row("a1", "It drifts under load.", 1, "assistant")]);
  __setQueryData("chatV2:listTurns", [{ _id: "turn-1", promptMessageId: "q1", order: 1, status: "completed", startedAt: 1, endedAt: 2, stepCount: 1 }]);
  __setQueryData("chatV2:listProposals", [{
    _id: "proposal-1", _creationTime: 1001, agentThreadId: "thread-1", projectId, reportId, kind: "edit",
    targetText: "It drifts.", newText: "It drifts under load.", state: "pending", createdAt: 1001, promptMessageId: "q1",
  } as unknown as Doc<"chatProposals">]);
  __setQueryData("users:getCurrentUser", { _id: "writer-1", role: "writer" });
  __setQueryData("projects:getProjectEditAccess", { canEditDetails: true });
  __setQueryData("documents:listDocuments", [{
    _id: "doc-rig", fileName: "rig-notes.txt", fileType: "txt", source: "context_input", category: "other", createdAt: 1,
    sizeChars: 10, wordCount: 2, hasFile: true, mimeType: null, url: null, archived: false, processingStatus: "ready", processingDetail: null,
  }]);
}

const button = (name: string) => page.getByRole("button", { name, exact: true }).element() as HTMLElement;
const box = (element: Element) => element.getBoundingClientRect();

/**
 * Whether a tap `offset` px left of the control's centre lands on it: the
 * chip removers keep a 16 px icon and widen only their hit area.
 */
function hitAt(element: HTMLElement, offset: number): boolean {
  const rect = box(element);
  const hit = document.elementFromPoint(rect.left + rect.width / 2 - offset, rect.top + rect.height / 2);
  return !!hit && (hit === element || element.contains(hit));
}

beforeEach(() => {
  __resetConvexStub(); __resetAuthState(); localStorage.clear(); sessionStorage.clear();
  seed();
});

describe(`report chat touch targets (${pointer} pointer)`, () => {
  it("runs under the pointer this instance declares", async () => {
    await expect.poll(() => window.matchMedia(`(pointer: ${pointer})`).matches).toBe(true);
  });

  it("sizes the answer, card and feedback controls", async () => {
    await page.viewport(480, 900);
    await render(AgentChatPanel, { reportId, projectId });
    await expect.element(page.getByRole("button", { name: "Copy", exact: true })).toBeVisible();
    const square = ["Copy", "Mark response helpful", "Mark response not helpful", "More actions for this suggestion"];
    const tall = ["Regenerate", "Apply", "Dismiss"];
    await expect.poll(() => square.map((name) => Math.round(box(button(name)).height)))
      .toEqual(coarse ? square.map(() => TOUCH) : [28, 28, 28, 28]);
    for (const name of square) expect(Math.round(box(button(name)).width), name).toBe(coarse ? TOUCH : Math.round(box(button(name)).height));
    for (const name of tall) {
      const height = box(button(name)).height;
      if (coarse) expect(height, name).toBeGreaterThanOrEqual(TOUCH);
      else expect(height, name).toBeLessThan(TOUCH);
    }
  });

  it("widens the composer chip removers' hit area, not their icon", async () => {
    await page.viewport(480, 900);
    await render(AgentChatPanel, { reportId, projectId });
    await page.getByRole("button", { name: "Message options", exact: true }).click();
    await page.getByRole("menuitemcheckbox", { name: "Use Brain examples for this message" }).click();
    await userEvent.keyboard("{Escape}");
    // The closed menu stops blocking the page's pointer events.
    await expect.poll(() => document.body.style.pointerEvents).not.toBe("none");
    // Owner, 2026-10-21: web search has no chip, so Brain's is the only one.
    for (const name of ["Stop using Brain examples for this message"]) {
      const remover = button(name);
      expect(Math.round(box(remover).width), name).toBe(16);
      // 18 px from the centre: outside the icon, inside a 44 px hit area.
      expect(hitAt(remover, 18), name).toBe(coarse);
      expect(hitAt(remover, 30), name).toBe(false);
    }
  });

  it("sizes the conversation menu's items", async () => {
    await page.viewport(480, 900);
    await render(AgentChatPanel, { reportId, projectId });
    await page.getByRole("button", { name: "Conversation menu", exact: true }).click();
    const items = [
      page.getByRole("menuitem", { name: "New conversation" }).element(),
      page.getByRole("menuitem", { name: "Kiln drying review" }).element(),
      page.getByRole("menuitem", { name: "Conversation actions", exact: true }).element(),
    ];
    // Measured once the menu's open animation has settled.
    await expect.poll(() => items.map((item) => Math.round(box(item).height)), { timeout: 2000 })
      .toEqual(items.map(() => (coarse ? TOUCH : 32)));
  });

  // W1's two composer controls: "Read a file in full" and a pinned file's
  // remove button (review R2 P3-5).
  (coarse ? it : it.skip)("the pin controls meet the coarse floor", async () => {
    await page.viewport(480, 900);
    await render(AgentChatPanel, { reportId, projectId });
    await page.getByRole("button", { name: "Message options", exact: true }).click();
    const readInFull = page.getByRole("menuitem", { name: "Read a file in full" }).element();
    await new Promise((resolve) => setTimeout(resolve, 400));
    const readHeight = Math.round(box(readInFull).height);
    await page.getByRole("menuitem", { name: "Read a file in full" }).click();
    await page.getByRole("checkbox", { name: "rig-notes.txt", exact: true }).click();
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => document.body.style.pointerEvents).not.toBe("none");
    // Closing the picker hands keyboard focus back to Message options, whose
    // tooltip then opens above it and covers the pinned chips row. A second
    // Escape closes the tooltip, so the tap below reaches the chip.
    await expect.element(page.getByRole("button", { name: "Message options", exact: true })).toHaveFocus();
    await expect.poll(() => document.querySelector("[data-tooltip-content]")).not.toBeNull();
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => document.querySelector("[data-tooltip-content]")).toBeNull();
    const remove = button("Remove rig-notes.txt");
    expect(readHeight).toBeGreaterThanOrEqual(TOUCH);
    expect(hitAt(remove, 18)).toBe(true);
  });
});
