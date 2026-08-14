import { beforeEach, describe, expect, it } from "vitest";
import { page as browserPage } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import ProjectsTableView from "./ProjectsTableView.svelte";
import { __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import {
  __navigationCalls,
  __resetNavigation,
  __setGotoUpdatesPageUrl,
} from "$lib/test/app-navigation-stub";
import {
  __activeQueryCount,
  __resetConvexStub,
  __setPaginatedRows,
  __setQueryData,
} from "$lib/test/convex-svelte-stub.svelte";

const PREFS_KEY = "banhall.projectsTablePreferences";

/**
 * Live Board/List switch behavior in the real container component, with the
 * $app stubs faithful to SvelteKit: shallow replaceState never updates the
 * reactive page.url; goto updates it asynchronously. The 2026-08-06 live QA
 * failure — URL changes while the rendered layout and pressed state stay
 * stale until reload — reproduces here whenever the loaded URL already
 * carries a `layout` param, so these tests always mount with one.
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
}

async function mountView(url: string) {
  __setPageUrl(url);
  seedQueries();
  await browserPage.viewport(1280, 800);
  const screen = await render(ProjectsTableView, {});
  screen.container.style.cssText = "display:flex;flex-direction:column;height:700px;overflow:hidden;";
  return screen;
}

const boardRegion = () =>
  document.querySelector<HTMLElement>('[role="region"][aria-label^="Projects board"]');
const listRegion = () =>
  document.querySelector<HTMLElement>('[role="region"][aria-label="Projects list"]');
const modeButton = (mode: "board" | "list") =>
  document.querySelector<HTMLButtonElement>(`[data-view-mode="${mode}"]`);
const storedLayout = () =>
  JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}").layout as string | undefined;

describe("ProjectsTableView Board/List switch", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetPage();
    __resetNavigation();
    __resetConvexStub();
  });

  it("renders List immediately when List is clicked while the URL already carries layout=board (live-QA regression)", async () => {
    await mountView("/dashboard?layout=board&group=none");
    await expect.poll(() => boardRegion()).not.toBeNull();
    expect(modeButton("board")?.getAttribute("aria-pressed")).toBe("true");

    modeButton("list")?.click();

    await expect.poll(() => listRegion()).not.toBeNull();
    expect(boardRegion()).toBeNull();
    expect(modeButton("list")?.getAttribute("aria-pressed")).toBe("true");
    expect(modeButton("board")?.getAttribute("aria-pressed")).toBe("false");
    // Preference persisted as the user's choice, never reverted by the
    // URL-sync effect while navigation is in flight.
    expect(storedLayout()).toBe("list");
    // The switch navigates (goto keeps page.url truthful) rather than using
    // shallow replaceState, and the URL carries the layout deep link.
    const lastNav = __navigationCalls.at(-1);
    expect(lastNav?.kind).toBe("goto");
    expect(lastNav?.url).toContain("layout=list");
  });

  it("still switches back to Board even if page.url never catches up (worst-case shallow-routing staleness)", async () => {
    __setGotoUpdatesPageUrl(false);
    await mountView("/dashboard?layout=list&group=none");
    await expect.poll(() => listRegion()).not.toBeNull();

    modeButton("board")?.click();

    await expect.poll(() => boardRegion()).not.toBeNull();
    expect(listRegion()).toBeNull();
    expect(modeButton("board")?.getAttribute("aria-pressed")).toBe("true");
    expect(storedLayout()).toBe("board");
  });

  it("applies genuine URL changes and migrates the retired grid param to board", async () => {
    await mountView("/dashboard?layout=board&group=none");
    await expect.poll(() => boardRegion()).not.toBeNull();

    // External navigation (back/forward) to layout=list applies and persists.
    __setPageUrl("/dashboard?layout=list&group=none");
    await expect.poll(() => listRegion()).not.toBeNull();
    expect(storedLayout()).toBe("list");

    // The retired `grid` value keeps migrating to board.
    __setPageUrl("/dashboard?layout=grid&group=none");
    await expect.poll(() => boardRegion()).not.toBeNull();
    expect(storedLayout()).toBe("board");
  });
});

describe("ProjectsTableView workspace search debounce", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetPage();
    __resetNavigation();
    __resetConvexStub();
  });

  async function mountWithExternalSearch(externalSearch: string) {
    __setPageUrl("/projects?layout=list&group=none");
    seedQueries();
    __setPaginatedRows("dashboard:searchProjects", [flatRow("s1")]);
    await browserPage.viewport(1280, 800);
    const screen = await render(ProjectsTableView, { externalSearch });
    screen.container.style.cssText =
      "display:flex;flex-direction:column;height:700px;overflow:hidden;";
    return screen;
  }

  it("settles the header (external) search through the debounce — one query transition per settled query, not per keystroke", async () => {
    const screen = await mountWithExternalSearch("");
    await expect.poll(() => __activeQueryCount("dashboard:listFlatProjects")).toBe(1);
    expect(__activeQueryCount("dashboard:searchProjects")).toBe(0);

    // Three rapid keystrokes from the workspace header.
    await screen.rerender({ externalSearch: "s" });
    await screen.rerender({ externalSearch: "so" });
    await screen.rerender({ externalSearch: "sol" });
    // Inside the debounce window nothing has swapped to the search query.
    expect(__activeQueryCount("dashboard:searchProjects")).toBe(0);
    expect(__activeQueryCount("dashboard:listFlatProjects")).toBe(1);

    // After the window settles, exactly one live search subscription exists
    // and the unfiltered flat query has been released.
    await expect.poll(() => __activeQueryCount("dashboard:searchProjects")).toBe(1);
    expect(__activeQueryCount("dashboard:listFlatProjects")).toBe(0);
  });

  it("seeds an already-typed external query so the first subscription is the search", async () => {
    await mountWithExternalSearch("solar");
    // No unfiltered flat page is ever requested for a handed-off query.
    await expect.poll(() => __activeQueryCount("dashboard:searchProjects")).toBe(1);
    expect(__activeQueryCount("dashboard:listFlatProjects")).toBe(0);
  });
});
