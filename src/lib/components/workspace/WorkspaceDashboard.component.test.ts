import { beforeEach, describe, expect, it } from "vitest";
import { page as browserPage } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import WorkspaceDashboard from "./WorkspaceDashboard.svelte";
import { board } from "$lib/test/boardScale";
import { userEvent } from "vitest/browser";
import { reloadSectionSidebar } from "$lib/workspace/sectionSidebar.svelte";
import { __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __resetNavigation } from "$lib/test/app-navigation-stub";
import {
  __resetConvexStub,
  __setPaginatedRows,
  __setQueryData,
} from "$lib/test/convex-svelte-stub.svelte";

/**
 * Viewport containment of the whole workspace shell in the REAL route parent
 * context. The dashboard route renders WorkspaceDashboard (via a
 * display:contents wrapper) as a flex item of +layout's
 * `flex min-h-screen flex-col` AUTO-HEIGHT container — the context where the
 * first fix silently failed: `flex-1` (flex-basis:0%) supersedes `h-dvh` for
 * the main-axis size, so the auto-height flex parent sized the shell from its
 * content (~3000px) and the document scrolled. The harness below replicates
 * that exact parent, which a fixed-height harness can never catch.
 */
function flatRow(id: string, stage: string) {
  return {
    _id: id,
    title: `Project ${id} — quarterly SR&ED interview synthesis`,
    clientName: "Northline Labs",
    workflowStage: stage,
    status: "draft",
    ownerId: "user-1",
    ownerLabel: "Olivia Owner",
    writer: undefined,
    generationActivity: null,
    updatedAt: 1753747200000,
  };
}

function seedQueries() {
  // killSwitch keeps My Work unavailable so the Projects page renders.
  __setQueryData("myWork:getViewConfig", { killSwitch: true, ready: false });
  __setQueryData("dashboard:getFacets", {
    total: 30,
    truncated: false,
    stageCounts: { drafting: 28, intake: 2 },
  });
  // 2026-10-14 redesign: the page lists clients on the left and the
  // selected client's (or every client's recent) projects on the right.
  __setQueryData("clients:listClients", {
    clients: Array.from({ length: 60 }, (_, index) => ({
      key: `client ${String(index).padStart(2, "0")}`,
      clientId: null,
      name: `Client ${String(index).padStart(2, "0")}`,
      projectCount: 1,
    })),
    truncated: false,
  });
  const rows = [
    ...Array.from({ length: 28 }, (_, index) => flatRow(`d${index}`, "drafting")),
    ...Array.from({ length: 2 }, (_, index) => flatRow(`i${index}`, "intake")),
  ];
  __setPaginatedRows("dashboard:listFlatProjects", rows);
  __setPaginatedRows("dashboard:listCompanyProjects", rows);
}

async function mountShell(url = "/dashboard", props: Record<string, unknown> = {}) {
  __setPageUrl(url);
  seedQueries();
  await browserPage.viewport(1440, 900);
  const screen = await render(WorkspaceDashboard, props);
  // Replica of src/routes/+layout.svelte's root: an auto-height flex column
  // with only a viewport min-height. Do NOT give it a fixed height — the
  // regression only reproduces against an auto-height flex parent.
  screen.container.style.cssText = "display:flex;flex-direction:column;min-height:100vh;";
  return screen;
}

const shellRoot = () => document.querySelector<HTMLElement>("div[data-workspace-shell]");
const projectsPage = () => document.querySelector<HTMLElement>("[data-projects-page]");
const clientListScroll = () => document.querySelector<HTMLElement>('[data-section-sidebar="projects"] [data-section-sidebar-scroll]');
const clientAreaScroll = () => document.querySelector<HTMLElement>("[data-client-area-scroll]");

describe("WorkspaceDashboard viewport containment (real +layout flex context)", () => {
  beforeEach(() => {
    localStorage.clear();
    reloadSectionSidebar();
    __resetPage();
    __resetNavigation();
    __resetConvexStub();
  });

  // 2026-10-14 redesign: the Board and List layouts left /projects (they stay
  // in the repository, unmounted), so the two layout-specific containment
  // tests became one for the new page. The contract is unchanged: the shell
  // is exactly viewport-high in the auto-height +layout parent, the document
  // never scrolls, and each column owns its own vertical scroll.
  it("binds the shell to the viewport on Projects: the client list and the client area each own their scroll", async () => {
    await mountShell("/projects?client=client+03", { view: "all_projects" });
    await expect.poll(() => document.querySelectorAll("[data-project-board-card]").length).toBe(30);

    const root = shellRoot();
    if (!root) throw new Error("workspace shell root not rendered");
    // Light-plane smoke (2026-08-06 redesign): the content plane mounts the
    // LIGHT scope, never the dark one.
    expect(root.getAttribute("data-workspace-theme")).toBe("light");
    expect(Math.round(root.getBoundingClientRect().height)).toBe(window.innerHeight);
    expect(document.documentElement.scrollHeight).toBeLessThanOrEqual(window.innerHeight);
    expect(projectsPage()!.getBoundingClientRect().bottom).toBeLessThanOrEqual(window.innerHeight + 1);

    // 60 clients and 30 cards both overflow; each scrolls on its own.
    const list = clientListScroll()!;
    const area = clientAreaScroll()!;
    expect(getComputedStyle(list).overflowY).toBe("auto");
    expect(getComputedStyle(area).overflowY).toBe("auto");
    expect(list.scrollHeight).toBeGreaterThan(list.clientHeight);
    expect(area.scrollHeight).toBeGreaterThan(area.clientHeight);
    area.scrollTop = 300;
    expect(area.scrollTop).toBeGreaterThan(0);
    expect(list.scrollTop).toBe(0);
    list.scrollTop = 200;
    expect(list.scrollTop).toBeGreaterThan(0);
    expect(window.scrollY).toBe(0);
    expect(document.documentElement.scrollTop).toBe(0);
  });

  it("honors an explicit route view prop over ?view and gives the rail and sidebar canonical links carrying ?layout", async () => {
    // A stale ?view=my_work param must not beat the canonical route's view.
    await mountShell("/projects?layout=list&group=none&view=my_work", { view: "all_projects" });
    // Was the old List region; the redesigned page mounts instead.
    await expect.poll(() => projectsPage()).not.toBeNull();

    // The page frame (owner, 2026-10-28; Paper S9): the sidebar names the
    // section and holds New project; the company header is the 64px bar.
    const sidebar = document.querySelector<HTMLElement>('[data-section-sidebar="projects"]')!;
    expect(sidebar.querySelector("[data-section-sidebar-title]")?.textContent).toBe("Projects");
    expect(sidebar.querySelector("[data-section-sidebar-action]")?.getAttribute("href")).toBe("/project/new");
    await expect.poll(() => sidebar.querySelector('[data-client-row="all"] [data-section-sidebar-count]')?.textContent).toBe("30");
    expect(sidebar.querySelector('[data-client-row="all"]')?.getAttribute("aria-current")).toBe("page");
    const header = document.querySelector<HTMLElement>("[data-client-header]")!;
    expect(header.getBoundingClientRect().height).toBe(board(64));
    expect(header.querySelector("[data-client-title]")?.textContent).toBe("All projects");
    expect(header.querySelector("[data-client-count]")?.textContent).toBe("30 projects");
    // The phone bar (hamburger, "Projects", count, New project) is hidden from 768px.
    const phoneBar = document.querySelector<HTMLElement>("[data-projects-frame] > [data-page-top-bar]")!;
    expect(phoneBar.getBoundingClientRect().height).toBe(0);
    expect(phoneBar.querySelector("h1")?.textContent).toBe("Projects");
    expect(phoneBar.querySelector("[data-page-count]")?.textContent).toBe("30");

    const projectsLink = document.querySelector<HTMLAnchorElement>('[data-frame-rail] [data-rail-item="projects"]');
    // 2026-08-08 amendment: the label is "Home"; canonical URL unchanged. It
    // lives in the Projects sidebar now (the page frame).
    const myWorkLink = document.querySelector<HTMLAnchorElement>("[data-projects-sidebar-home]");
    expect(myWorkLink?.textContent?.trim()).toBe("Home");
    // Typed canonical routes; ?layout carries through; ?view never leaks
    // onto the canonical URLs (the path encodes the view).
    expect(projectsLink?.getAttribute("href")).toBe("/projects?layout=list&group=none");
    expect(myWorkLink?.getAttribute("href")).toBe("/my-work?layout=list&group=none");
    expect(projectsLink?.getAttribute("aria-current")).toBe("page");
  });

  it("at 1440 Projects has one banner, one main and one h1: the company header (review round 1, finding 4)", async () => {
    await mountShell("/projects?client=client+03", { view: "all_projects" });
    await expect.poll(() => document.querySelector("[data-client-title]")?.textContent).toBe("Client 03");
    const visible = (element: Element) => element.getClientRects().length > 0;
    const banners = [...document.querySelectorAll("header")].filter((header) => visible(header) && !header.closest("main, aside, nav, section, article"));
    expect(banners.map((header) => header.hasAttribute("data-global-bar"))).toEqual([true]);
    const mains = [...document.querySelectorAll("main")].filter(visible);
    expect(mains).toHaveLength(1);
    expect(mains[0].contains(document.querySelector("[data-client-header]"))).toBe(true);
    expect([...document.querySelectorAll("h1")].filter(visible).map((h1) => h1.textContent)).toEqual(["Client 03"]);
  });

  it("collapsed (Mod \\), Projects shows New project in the company header (review round 1, finding 2)", async () => {
    await mountShell("/projects", { view: "all_projects" });
    await expect.poll(() => document.querySelector("[data-section-sidebar-toggle]")).not.toBeNull();
    expect(document.querySelector("[data-client-header] [data-top-bar-primary]")).toBeNull();
    await userEvent.keyboard("{Meta>}\\{/Meta}");
    await expect.poll(() => document.querySelector("[data-client-header] [data-top-bar-primary]")).not.toBeNull();
    const button = document.querySelector<HTMLAnchorElement>("[data-client-header] [data-top-bar-primary]")!;
    expect([button.textContent?.trim(), button.getAttribute("href")]).toEqual(["New project", "/project/new"]);
    expect(button.getBoundingClientRect().width).toBeGreaterThan(0);
  });
});
