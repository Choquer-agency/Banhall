import { beforeEach, describe, expect, it } from "vitest";
import { page as browserPage } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import ProjectsTableView from "./ProjectsTableView.svelte";
import { __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __resetNavigation } from "$lib/test/app-navigation-stub";
import {
  __activeQueryArgs,
  __resetConvexStub,
  __setPaginatedRows,
  __setQueryData,
} from "$lib/test/convex-svelte-stub.svelte";

const PREFS_KEY = "banhall.projectsTablePreferences";

/**
 * Client → Status wiring (2026-08-06 second amendment; Focus drill-in
 * retired 2026-08-12): the grouping is valid on BOTH layouts. List = client
 * sections → status sub-headers; Board = stacked client lanes (each a
 * horizontal row of all loaded project cards), folding to the grouped List
 * below `md`. The recorded-name caveat remains screen-reader context without
 * visible toolbar chrome. The `?client=` board param is retired and ignored;
 * `/project/new?client=` remains the wizard's own prefill param.
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

  it("renders the grouped List without a visible grouping context band", async () => {
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
    expect(document.querySelector("[data-client-grouping-qualifier]")).toBeNull();
    expect(document.querySelector("[data-client-grouping-backfill-notice]")).toBeNull();
    // Deep-link contract (same as `layout`): the initial URL drives the view
    // without being written back as a stored preference.
    expect(JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}").group).toBeUndefined();
  });

  it("keeps Filters available in the grouped List and applies Stage to expanded client queries", async () => {
    await mountView("/dashboard?layout=list&group=client");
    await expect.poll(() => groupedListRegion()).not.toBeNull();

    const filters = document.querySelector<HTMLButtonElement>("[data-board-filters-trigger]");
    expect(filters).not.toBeNull();
    pointerActivate(filters!);
    await expect.poll(() =>
      document.querySelector<HTMLElement>('[data-filter-field="stage"]')
    ).not.toBeNull();
    pointerActivate(document.querySelector<HTMLElement>('[data-filter-field="stage"]')!);

    await expect.poll(() =>
      document.querySelector<HTMLButtonElement>('[data-active-filter-id="stage"] [data-filter-pill-value]')?.textContent?.trim()
    ).toBe("Select…");
    pointerActivate(
      document.querySelector<HTMLButtonElement>('[data-active-filter-id="stage"] [data-filter-pill-value]')!
    );
    await expect.poll(() =>
      document.querySelector<HTMLElement>('[data-filter-value="drafting"]')
    ).not.toBeNull();
    pointerActivate(document.querySelector<HTMLElement>('[data-filter-value="drafting"]')!);

    document.querySelector<HTMLButtonElement>("[data-client-group-trigger]")?.click();
    await expect.poll(() =>
      __activeQueryArgs("dashboard:listCompanyProjectsByStageRank")
    ).toContainEqual(expect.objectContaining({ companyKey: "northline", stage: "drafting" }));
    expect(document.querySelector('[data-active-filter="Stage"]')?.textContent).toContain("Drafting");
  });

  it("applies a genuine URL group change after mount and persists it", async () => {
    await mountView("/dashboard?layout=list&group=none");
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
    // Client rows stay focused on hierarchy; creation lives in the global
    // toolbar and the board's stage footers. Focus remains retired.
    expect(document.querySelector("[data-client-new-project]")).toBeNull();
    expect(document.querySelector("[data-client-focus]")).toBeNull();
    // Each expanded lane renders the standard stage-column board scoped to
    // that client (same anatomy as the ungrouped board).
    await expect.poll(() =>
      document.querySelector(
        '[data-client-group-presentation="lane"] [data-board-column="drafting"]'
      )
    ).not.toBeNull();
    // Labeled grouping chip: faint label + ink value while grouping is on.
    expect(groupTrigger()?.textContent?.replace(/\s+/g, " ").trim()).toBe("Client");
    // The Display menu stays available (the client hide-empty switch
    // governs the per-client boards' stage columns).
    expect(displayTrigger()).not.toBeNull();
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

  it("ignores the retired ?client= board param: no focused board, the stored default view renders", async () => {
    await mountView("/dashboard?layout=board&client=northline");

    // The param is inert (retired 2026-08-12): the default view (client-
    // grouped board since 2026-08-13) renders and nothing resembling a
    // focused client surface mounts.
    await expect.poll(() => groupedBoardRegion()).not.toBeNull();
    expect(document.querySelector("[data-client-focus-board]")).toBeNull();
    expect(document.querySelector("[data-focus-breadcrumb]")).toBeNull();
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

  it("offers the board hide-empty switch on the flat stage-first board, default ON, URL-backed", async () => {
    await mountView("/dashboard?layout=board&group=none");
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
    ).toBe(11);

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
    expect(JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}").hideEmptyBoard).toBe(true);
    // Inline disclosure removed (2026-08-12): the Display menu switch is the
    // only reveal control for hidden stages.
    expect(document.querySelector("[data-hidden-stages-disclosure]")).toBeNull();
  });

  it("applies a deep-linked ?hideEmpty=1 without persisting it as a preference", async () => {
    await mountView("/dashboard?layout=board&group=none&hideEmpty=1");
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
    // Labeled-control chip while grouped, panel options are the bare values.
    expect(groupTrigger()?.textContent?.replace(/\s+/g, " ").trim()).toBe("Client");
    await chooseGroupOption("None");

    await expect.poll(() => listRegion()).not.toBeNull();
    expect(groupedListRegion()).toBeNull();
    expect(JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}").group).toBe("none");
    // Off state: the chip reads as the bare control label.
    expect(groupTrigger()?.textContent?.replace(/\s+/g, " ").trim()).toBe("Group");
  });
});
