import { beforeEach, describe, expect, it } from "vitest";
import { page as browserPage } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import WorkspaceDashboard from "./WorkspaceDashboard.svelte";
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
const clientListScroll = () => document.querySelector<HTMLElement>("[data-client-list-scroll]");
const clientAreaScroll = () => document.querySelector<HTMLElement>("[data-client-area-scroll]");

describe("WorkspaceDashboard viewport containment (real +layout flex context)", () => {
  beforeEach(() => {
    localStorage.clear();
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

  it("honors an explicit route view prop over ?view and gives the rail canonical links carrying ?layout", async () => {
    // A stale ?view=my_work param must not beat the canonical route's view.
    await mountShell("/projects?layout=list&group=none&view=my_work", { view: "all_projects" });
    // Was the old List region; the redesigned page mounts instead.
    await expect.poll(() => projectsPage()).not.toBeNull();

    const heading = document.querySelector("header h1");
    expect(heading?.textContent).toBe("Projects");
    const pageHeader = document.querySelector<HTMLElement>("[data-workspace-page-header]");
    expect(pageHeader).not.toBeNull();
    expect(pageHeader?.className).toContain("h-[3.0625rem]");
    expect(pageHeader?.querySelector('a[href="/project/new"]')).not.toBeNull();
    expect(
      document.querySelector('[data-projects-page] a[href="/project/new"]')
    ).toBeNull();
    // The page carries its own searches, so the top bar hides its field.
    expect(pageHeader?.querySelector('input[type="search"]')).toBeNull();
    expect(pageHeader?.querySelector('button[aria-label="Search projects"]')).toBeNull();

    const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>("nav a"));
    const projectsLink = anchors.find((a) => a.textContent?.trim() === "Projects");
    // 2026-08-08 amendment: rail label is "Home"; canonical URL unchanged.
    const myWorkLink = anchors.find((a) => a.textContent?.trim() === "Home");
    // Typed canonical routes; ?layout carries through; ?view never leaks
    // onto the canonical URLs (the path encodes the view).
    expect(projectsLink?.getAttribute("href")).toBe("/projects?layout=list&group=none");
    expect(myWorkLink?.getAttribute("href")).toBe("/my-work?layout=list&group=none");
    expect(projectsLink?.getAttribute("aria-current")).toBe("page");
  });
});
