import { beforeEach, describe, expect, it } from "vitest";
import { page as browserPage } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import ProjectsTableView from "./ProjectsTableView.svelte";
import { __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __resetNavigation } from "$lib/test/app-navigation-stub";
import {
  __resetConvexStub,
  __setPaginatedRows,
  __setQueryData,
} from "$lib/test/convex-svelte-stub.svelte";

const PREFS_KEY = "banhall.projectsTablePreferences";

/**
 * Client → Status wiring (2026-08-06 second amendment): the grouping is
 * valid on BOTH layouts. List = client sections → status sub-headers;
 * Board = stacked client lanes with a focused single-client board drill-in
 * (`?client=`), folding to the grouped List below `md`. The recorded-name
 * caveat renders on every client-grouped surface.
 */
function flatRow(id: string) {
  return {
    _id: id,
    title: `Project ${id}`,
    clientName: "Northline Labs",
    workflowStage: "drafting",
    status: "draft",
    ownerId: "user-1",
    ownerLabel: "Olivia Owner",
    writer: undefined,
    generationActivity: null,
    updatedAt: 1753747200000,
  };
}

function seedQueries(count = 3) {
  __setQueryData("dashboard:getFacets", {
    total: count,
    truncated: false,
    stageCounts: { drafting: count },
  });
  __setPaginatedRows(
    "dashboard:listFlatProjects",
    Array.from({ length: count }, (_, index) => flatRow(`p${index}`))
  );
  __setPaginatedRows("dashboard:listCompanies", [
    {
      companyKey: "northline",
      clientName: "Northline Labs",
      projectCount: count,
      stageCounts: { drafting: count },
      updatedAt: 1,
    },
  ]);
  __setQueryData("dashboard:getCompany", {
    companyKey: "northline",
    clientName: "Northline Labs",
    projectCount: count,
    stageCounts: { drafting: count },
    updatedAt: 1,
  });
  __setPaginatedRows("dashboard:listCompanyProjectsByStageRank", [flatRow("g1")]);
}

async function mountView(url: string, { width = 1280, height = 800 } = {}) {
  __setPageUrl(url);
  seedQueries();
  await browserPage.viewport(width, height);
  const screen = await render(ProjectsTableView, {});
  screen.container.style.cssText = "display:flex;flex-direction:column;height:700px;overflow:hidden;";
  return screen;
}

const groupedListRegion = () =>
  document.querySelector<HTMLElement>('[role="region"][aria-label="Projects grouped by client name"]');
const groupedBoardRegion = () =>
  document.querySelector<HTMLElement>('[role="region"][aria-label="Projects board grouped by client name"]');
const listRegion = () =>
  document.querySelector<HTMLElement>('[role="region"][aria-label="Projects list"]');
const boardRegion = () =>
  document.querySelector<HTMLElement>('[role="region"][aria-label^="Projects board."]');
const focusRegion = () =>
  document.querySelector<HTMLElement>("[data-client-focus-board]");
// The grouping control is ui/GhostPopover — a bits-ui Popover (2026-08-10
// primitive-first direction): chip trigger opening a portaled option list
// with the Filters-popover panel anatomy.
const groupTrigger = () =>
  document.querySelector<HTMLButtonElement>('[data-ghost-select][aria-label="Group projects"]');
/** bits-ui opens/selects on pointer events, not synthetic click(). */
function pointerActivate(el: HTMLElement) {
  el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
  el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true }));
  el.click();
}
async function chooseGroupOption(label: string) {
  pointerActivate(groupTrigger()!);
  await expect.poll(() =>
    [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (option) => option.textContent?.trim() === label
    )
  ).toBeDefined();
  pointerActivate(
    [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (option) => option.textContent?.trim() === label
    )!
  );
}
const displayTrigger = () =>
  document.querySelector<HTMLButtonElement>("[data-projects-display-trigger]");

async function openDisplayMenu() {
  displayTrigger()?.click();
  await expect.poll(() => document.querySelector('[role="menu"]')).not.toBeNull();
}

describe("ProjectsTableView client-name grouping", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetPage();
    __resetNavigation();
    __resetConvexStub();
  });

  it("renders the grouped List with the exact qualifier when the URL carries layout=list&group=client", async () => {
    await mountView("/dashboard?layout=list&group=client");

    await expect.poll(() => groupedListRegion()).not.toBeNull();
    expect(listRegion()).toBeNull();
    expect(boardRegion()).toBeNull();
    expect(groupedListRegion()?.textContent).toContain(
      "Grouped by recorded client name as entered on projects. Durable client records are not yet modelled."
    );
    expect(groupedListRegion()?.textContent).toContain(
      "Projects created before grouping was enabled may not appear here."
    );
    // Deep-link contract (same as `layout`): the initial URL drives the view
    // without being written back as a stored preference.
    expect(JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}").group).toBeUndefined();
  });

  it("applies a genuine URL group change after mount and persists it", async () => {
    await mountView("/dashboard?layout=list");
    await expect.poll(() => listRegion()).not.toBeNull();

    // External navigation (back/forward, shared link) to group=client.
    __setPageUrl("/dashboard?layout=list&group=client");
    await expect.poll(() => groupedListRegion()).not.toBeNull();
    expect(JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}").group).toBe("client");
  });

  it("renders stacked client lanes with the caveat when the Board is grouped by client on desktop", async () => {
    await mountView("/dashboard?layout=board&group=client");

    await expect.poll(() => groupedBoardRegion()).not.toBeNull();
    expect(boardRegion()).toBeNull();
    // Lane presentation with the recorded-name caveat verbatim.
    expect(groupedBoardRegion()?.textContent).toContain(
      "Grouped by recorded client name as entered on projects. Durable client records are not yet modelled."
    );
    await expect.poll(
      () => document.querySelectorAll('[data-client-group-presentation="lane"]').length
    ).toBe(1);
    // Lane header offers the Focus drill-in and client-scoped creation.
    expect(document.querySelector("[data-client-focus]")).not.toBeNull();
    expect(document.querySelector("[data-client-new-project]")).not.toBeNull();
  });

  it("folds the grouped Board to the grouped List below md — no mobile swimlanes", async () => {
    await mountView("/dashboard?layout=board&group=client", { width: 390, height: 844 });

    await expect.poll(() => groupedListRegion()).not.toBeNull();
    expect(groupedBoardRegion()).toBeNull();
    expect(document.querySelector('[data-client-group-presentation="lane"]')).toBeNull();
    // Truthful state (live QA 2026-08-07): the view-mode control keeps the
    // stored Board preference pressed, so an explicit status names what
    // actually renders — never a silent contradiction, never a discarded
    // preference.
    const foldNote = document.querySelector("[data-grouped-board-fold-note]");
    expect(foldNote?.textContent).toContain("Board grouping uses the list layout on small screens.");
    expect(foldNote?.getAttribute("role")).toBe("status");
    expect(JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}").layout ?? "board").toBe("board");
  });

  it("keeps the fold status off the desktop grouped List (it states a below-md truth only)", async () => {
    await mountView("/dashboard?layout=list&group=client");

    await expect.poll(() => groupedListRegion()).not.toBeNull();
    expect(document.querySelector("[data-grouped-board-fold-note]")).toBeNull();
  });

  it("opens the focused single-client board from ?client= with breadcrumb, caveat, and client-prefilled intake footer", async () => {
    await mountView("/dashboard?layout=board&group=client&client=northline");

    await expect.poll(() => focusRegion()).not.toBeNull();
    expect(groupedBoardRegion()).toBeNull();
    expect(focusRegion()?.textContent).toContain("Northline Labs");
    // Breadcrumb back to all clients (drops only the client param).
    const breadcrumb = document.querySelector<HTMLAnchorElement>("[data-focus-breadcrumb]");
    expect(breadcrumb?.textContent).toContain("All clients");
    expect(breadcrumb?.getAttribute("href")).toContain("group=client");
    expect(breadcrumb?.getAttribute("href")).not.toContain("client=northline");
    // Recorded-name caveat carries onto the focused surface.
    expect(focusRegion()?.textContent).toContain(
      "Grouped by recorded client name as entered on projects."
    );
    // Hide-empty ON by default from exact stageCounts: only drafting renders.
    await expect.poll(
      () => document.querySelectorAll('section[aria-labelledby^="project-board-"]').length
    ).toBe(1);
    // Intake column is hidden here (exact 0) — the creation affordance is
    // the client-scoped header/lane link semantics; when intake shows, its
    // footer carries the client prefill (covered by the board suite).
    expect(document.querySelector("[data-hidden-stages-disclosure]")?.textContent).toContain(
      "9 empty stages hidden"
    );
  });

  it("offers the grouping control on the Board toolbar and the client hide-empty switch when grouped", async () => {
    await mountView("/dashboard?layout=board&group=client");
    await expect.poll(() => groupedBoardRegion()).not.toBeNull();

    expect(groupTrigger()).not.toBeNull();
    await openDisplayMenu();
    // Verified stageCounts exist on the loaded client → the option is live.
    await expect.poll(() =>
      document.querySelector('[data-hide-empty-switch-disabled="true"]')
    ).toBeNull();
    const clientSwitch = document.querySelector<HTMLDivElement>('[data-hide-empty-switch="client"]');
    expect(clientSwitch?.getAttribute("role")).toBe("menuitemcheckbox");
    // Client surfaces default hide-empty ON (structural sparsity).
    expect(clientSwitch?.getAttribute("aria-checked")).toBe("true");
    clientSwitch?.click();
    await expect.poll(() =>
      document.querySelector('[data-hide-empty-switch="client"]')?.getAttribute("aria-checked")
    ).toBe("false");
    // Multi-setting display menus stay open so another field/density/display
    // option can be changed without reopening the control.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    expect(JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}").hideEmptyClientGroups).toBe(false);
  });

  it("disables the client hide-empty switch honestly before verified counts exist", async () => {
    __setPageUrl("/dashboard?layout=board&group=client");
    seedQueries();
    // Pre-backfill: no client has stageCounts — the switch cannot take
    // effect, so it must not look enabled while hiding nothing.
    __setPaginatedRows("dashboard:listCompanies", [
      { companyKey: "northline", clientName: "Northline Labs", projectCount: 3, updatedAt: 1 },
    ]);
    await browserPage.viewport(1280, 800);
    const screen = await render(ProjectsTableView, {});
    screen.container.style.cssText = "display:flex;flex-direction:column;height:700px;overflow:hidden;";

    await expect.poll(() => groupedBoardRegion()).not.toBeNull();
    await openDisplayMenu();
    await expect.poll(() =>
      document.querySelector('[data-hide-empty-switch-disabled="true"]')
    ).not.toBeNull();
    const clientSwitch = document.querySelector<HTMLDivElement>('[data-hide-empty-switch="client"]');
    expect(clientSwitch?.hasAttribute("data-disabled")).toBe(true);
    expect(document.getElementById("hide-empty-client-note")?.textContent).toContain(
      "Available after client counts finish backfilling."
    );
    expect(displayTrigger()?.textContent).not.toContain("Empty stages hidden");
    // Clicking the disabled control changes nothing (preference preserved).
    clientSwitch?.click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(clientSwitch?.getAttribute("aria-checked")).toBe("true");
    expect(JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}").hideEmptyClientGroups).toBeUndefined();
  });

  it("keeps the client hide-empty control present (honestly stated) in focus mode", async () => {
    await mountView("/dashboard?layout=board&group=client&client=northline");
    await expect.poll(() => focusRegion()).not.toBeNull();
    // Focus mode no longer hides the option irrecoverably: it stays in the
    // display menu, live because this client has verified counts.
    await openDisplayMenu();
    await expect.poll(() =>
      document.querySelector('[data-hide-empty-switch="client"]')
    ).not.toBeNull();
    await expect.poll(() =>
      document.querySelector('[data-hide-empty-switch-disabled="true"]')
    ).toBeNull();
  });

  it("renders the focused board from a bare ?client= deep link instead of staying inert", async () => {
    await mountView("/dashboard?client=northline");
    await expect.poll(() => focusRegion()).not.toBeNull();
    expect(focusRegion()?.textContent).toContain("Northline Labs");
  });

  it("gives the mobile focused board an explicit Stage N of M indicator and an accessible stage selector", async () => {
    __setPageUrl("/dashboard?layout=board&group=client&client=northline");
    seedQueries();
    // Un-backfilled company: nothing hides, so all ten canonical stages
    // render and the selector navigates the full track.
    __setQueryData("dashboard:getCompany", {
      companyKey: "northline",
      clientName: "Northline Labs",
      projectCount: 3,
      updatedAt: 1,
    });
    await browserPage.viewport(390, 844);
    const screen = await render(ProjectsTableView, {});
    screen.container.style.cssText = "display:flex;flex-direction:column;height:700px;overflow:hidden;";

    await expect.poll(() => focusRegion()).not.toBeNull();
    await expect.poll(
      () => document.querySelectorAll("[data-board-column]").length
    ).toBe(10);
    const nav = document.querySelector<HTMLElement>("[data-focus-stage-nav]");
    expect(nav).not.toBeNull();
    // Mobile-only presentation nav (the desktop board scrolls freely).
    expect(nav?.className).toContain("md:hidden");
    await expect.poll(() =>
      document.querySelector("[data-focus-stage-indicator]")?.textContent?.trim()
    ).toBe("Stage 1 of 10");
    const select = document.querySelector<HTMLSelectElement>("[data-focus-stage-select]");
    expect(select).not.toBeNull();
    expect(select!.options).toHaveLength(10);
    // Selecting a stage scrolls/focuses that column — pure presentation, no
    // mutation (nothing here calls the server).
    select!.value = "3";
    select!.dispatchEvent(new Event("change", { bubbles: true }));
    await expect.poll(() =>
      document.querySelector("[data-focus-stage-indicator]")?.textContent?.trim()
    ).toBe("Stage 4 of 10");
    const fourth = document.querySelectorAll<HTMLElement>("[data-board-column]")[3];
    await expect.poll(() => document.activeElement).toBe(fourth.querySelector("header"));
  });

  it("offers the board hide-empty switch on the flat stage-first board, default ON, URL-backed", async () => {
    await mountView("/dashboard?layout=board");
    await expect.poll(() => boardRegion()).not.toBeNull();

    await openDisplayMenu();
    const boardSwitch = document.querySelector<HTMLDivElement>('[data-hide-empty-switch="board"]');
    expect(boardSwitch?.getAttribute("role")).toBe("menuitemcheckbox");
    // 2026-08-10 owner direction: empty stages hide by default (the visible
    // disclosure keeps hidden stages reachable). Toggle OFF first to verify
    // all ten canonical stages, then back ON.
    expect(boardSwitch?.getAttribute("aria-checked")).toBe("true");
    boardSwitch?.click();
    await expect.poll(() =>
      document.querySelector('[data-hide-empty-switch="board"]')?.getAttribute("aria-checked")
    ).toBe("false");
    await expect.poll(
      () => document.querySelectorAll('section[aria-labelledby^="project-board-"]').length
    ).toBe(10);

    boardSwitch?.click();
    await expect.poll(() =>
      document.querySelector('[data-hide-empty-switch="board"]')?.getAttribute("aria-checked")
    ).toBe("true");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    // Facet-count-zero stages collapse; drafting (count 3) stays.
    await expect.poll(
      () => document.querySelectorAll('section[aria-labelledby^="project-board-"]').length
    ).toBe(1);
    expect(document.querySelector("[data-hidden-stages-disclosure]")?.textContent).toContain(
      "9 empty stages hidden"
    );
    expect(JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}").hideEmptyBoard).toBe(true);
    // The board's disclosure reveals by turning the option off.
    (document.querySelector("[data-hidden-stages-disclosure]") as HTMLButtonElement)?.click();
    await expect.poll(
      () => document.querySelectorAll('section[aria-labelledby^="project-board-"]').length
    ).toBe(10);
  });

  it("applies a deep-linked ?hideEmpty=1 without persisting it as a preference", async () => {
    await mountView("/dashboard?layout=board&hideEmpty=1");
    await expect.poll(() => boardRegion()).not.toBeNull();
    await expect.poll(
      () => document.querySelectorAll('section[aria-labelledby^="project-board-"]').length
    ).toBe(1);
    expect(JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}").hideEmptyBoard).toBeUndefined();
  });

  it("returns to the flat List when grouping is turned off", async () => {
    await mountView("/dashboard?layout=list&group=client");
    await expect.poll(() => groupedListRegion()).not.toBeNull();

    expect(groupTrigger()).not.toBeNull();
    await chooseGroupOption("No grouping");

    await expect.poll(() => listRegion()).not.toBeNull();
    expect(groupedListRegion()).toBeNull();
    expect(JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}").group).toBe("none");
  });
});
