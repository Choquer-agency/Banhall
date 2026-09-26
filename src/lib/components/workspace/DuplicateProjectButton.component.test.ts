import { beforeEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import ProjectBoardCard from "./ProjectBoardCard.svelte";
import ProjectsBoard from "./ProjectsBoard.svelte";
import type { ProjectsTableRow } from "./ProjectsTable.svelte";
import { __resetPage } from "$lib/test/app-state-stub.svelte";
import { __navigationCalls, __resetNavigation } from "$lib/test/app-navigation-stub";
import { __resetConvexStub, __setQueryData } from "$lib/test/convex-svelte-stub.svelte";

/**
 * Duplicate on a project card (owner request 2026-09-25). The same cards
 * render the Projects list (grouped and flat) and every board column, so
 * the card is the unit under test: hidden until the card is hovered or
 * holds focus, a real button in the tab order, and a click that opens the
 * New project wizard for this project, never the card's own link.
 */

function row(overrides: Partial<ProjectsTableRow> = {}): ProjectsTableRow {
  return {
    id: "p1",
    title: "Northline Labs narrative",
    clientName: "Northline Labs",
    workflowStage: "drafting",
    legacyStatus: "draft",
    owner: { kind: "canonical", label: "Olivia Owner" },
    generationActivity: null,
    createdDate: "Mar 10, 2026",
    updatedDate: "Jul 29, 2026",
    ...overrides,
  };
}

const duplicateButton = (id = "p1") =>
  document.querySelector<HTMLButtonElement>(`[data-duplicate-project="${id}"]`);
const opacity = (element: Element | null) => (element ? getComputedStyle(element).opacity : null);

/** True when a pointer at the button's centre lands on the button itself,
 * not on the card's stretched title link painted over the card. */
function buttonIsHitTarget(button: HTMLElement) {
  const box = button.getBoundingClientRect();
  const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
  return hit !== null && button.contains(hit);
}

async function mountCard(overrides: Partial<ProjectsTableRow> = {}) {
  await page.viewport(1280, 800);
  const screen = await render(ProjectBoardCard, { row: row(overrides) });
  screen.container.style.cssText = "width:320px;padding:24px;";
  return screen;
}

beforeEach(() => {
  __resetPage();
  __resetNavigation();
  __resetConvexStub();
  __setQueryData("users:getCurrentUser", { _id: "u-1", role: "writer" });
});

describe("Duplicate on a project card", () => {
  it("stays hidden until the card is hovered or holds focus", async () => {
    await mountCard();

    await expect.poll(duplicateButton).not.toBeNull();
    const button = duplicateButton()!;
    const card = document.querySelector<HTMLElement>("[data-project-board-card]")!;
    const title = card.querySelector<HTMLAnchorElement>("header a")!;
    expect(button.getAttribute("aria-label")).toBe("Duplicate Northline Labs narrative");
    expect(button.type).toBe("button");
    expect(opacity(button)).toBe("0");

    // It keeps its place while hidden: showing it moves nothing.
    const titleBefore = title.getBoundingClientRect();
    const headerBefore = card.querySelector("header")!.getBoundingClientRect().height;

    await userEvent.hover(card);
    await expect.poll(() => opacity(button)).toBe("1");
    expect(title.getBoundingClientRect().width).toBe(titleBefore.width);
    expect(card.querySelector("header")!.getBoundingClientRect().height).toBe(headerBefore);

    await userEvent.unhover(card);
    await expect.poll(() => opacity(button)).toBe("0");

    // Keyboard: focus on the title reveals it, and Tab reaches it next.
    title.focus();
    await expect.poll(() => opacity(button)).toBe("1");
    await userEvent.tab();
    expect(document.activeElement).toBe(button);
    expect(opacity(button)).toBe("1");
  });

  it("shows a Duplicate tooltip and stays on touch screens", async () => {
    await mountCard();
    await expect.poll(duplicateButton).not.toBeNull();
    const button = duplicateButton()!;
    // Touch devices have no hover: the coarse-pointer rule keeps it shown.
    expect(button.className).toContain("pointer-coarse:opacity-100");

    await userEvent.hover(button);
    await expect
      .poll(() => document.querySelector('[data-tooltip-content], [role="tooltip"]')?.textContent?.trim(), {
        timeout: 3000,
      })
      .toBe("Duplicate");
  });

  it("opens the wizard for this project with Step by step, not the card", async () => {
    await mountCard();
    await expect.poll(duplicateButton).not.toBeNull();
    const card = document.querySelector<HTMLElement>("[data-project-board-card]")!;
    const title = card.querySelector<HTMLAnchorElement>("header a")!;
    const titleClicks: Event[] = [];
    title.addEventListener("click", (event) => {
      titleClicks.push(event);
      event.preventDefault();
    });

    await userEvent.hover(card);
    // Fully shown (opacity 1 no longer lifts it into its own layer), the
    // button must still sit above the stretched link.
    await expect.poll(() => opacity(duplicateButton())).toBe("1");
    expect(buttonIsHitTarget(duplicateButton()!)).toBe(true);
    await userEvent.click(duplicateButton()!);

    await expect.poll(() => __navigationCalls.length).toBe(1);
    expect(__navigationCalls[0]).toEqual({
      kind: "goto",
      url: "/project/new?from=p1&drafts=iterative",
    });
    expect(titleClicks).toHaveLength(0);
  });

  it("activates from the keyboard with Enter and Space", async () => {
    await mountCard();
    await expect.poll(duplicateButton).not.toBeNull();

    duplicateButton()!.focus();
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => __navigationCalls.length).toBe(1);

    duplicateButton()!.focus();
    await userEvent.keyboard(" ");
    await expect.poll(() => __navigationCalls.length).toBe(2);
    expect(__navigationCalls.map((call) => call.url)).toEqual([
      "/project/new?from=p1&drafts=iterative",
      "/project/new?from=p1&drafts=iterative",
    ]);
  });

  it("is withheld from people who cannot create projects and from a project being deleted", async () => {
    __setQueryData("users:getCurrentUser", { _id: "u-2" });
    const roleless = await mountCard();
    await expect.poll(() => document.querySelector("[data-project-board-card]")).not.toBeNull();
    expect(duplicateButton()).toBeNull();
    roleless.unmount();

    __setQueryData("users:getCurrentUser", { _id: "u-3", role: "writer", isAnonymous: true });
    const anonymous = await mountCard();
    await expect.poll(() => document.querySelector("[data-project-board-card]")).not.toBeNull();
    expect(duplicateButton()).toBeNull();
    anonymous.unmount();

    __setQueryData("users:getCurrentUser", { _id: "u-1", role: "writer" });
    await mountCard({ deleting: true });
    await expect.poll(() => document.querySelector("[data-project-board-card]")).not.toBeNull();
    expect(duplicateButton()).toBeNull();
  });
});

describe("Duplicate on the Projects board", () => {
  it("is on every card and never starts a drag of the card", async () => {
    await page.viewport(1280, 800);
    const screen = await render(ProjectsBoard, {
      rows: [row({ id: "p1" }), row({ id: "p2", title: "Second project", workflowStage: "intake" })],
    });
    screen.container.style.cssText = "display:flex;flex-direction:column;height:700px;overflow:hidden;";

    await expect.poll(() => duplicateButton("p1")).not.toBeNull();
    expect(duplicateButton("p2")).not.toBeNull();
    // Board cards are navigation, not drag handles.
    for (const card of document.querySelectorAll("[data-project-board-card]")) {
      expect(card.getAttribute("draggable")).not.toBe("true");
    }

    const drags: Event[] = [];
    document.addEventListener("dragstart", (event) => drags.push(event), true);
    const target = document.querySelector<HTMLElement>('[data-board-column="intake"]')!;
    const card = duplicateButton("p1")!.closest<HTMLElement>("[data-project-board-card]")!;
    await userEvent.hover(card);
    await expect.poll(() => opacity(duplicateButton("p1"))).toBe("1");
    expect(buttonIsHitTarget(duplicateButton("p1")!)).toBe(true);
    expect(duplicateButton("p1")!.getAttribute("draggable")).toBe("false");
    await userEvent.dragAndDrop(duplicateButton("p1")!, target);

    expect(drags).toHaveLength(0);
    expect(__navigationCalls).toEqual([]);
  });
});
