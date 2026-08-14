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
  // killSwitch keeps My Work unavailable so the Projects repository renders.
  __setQueryData("myWork:getViewConfig", { killSwitch: true, ready: false });
  __setQueryData("dashboard:getFacets", {
    total: 30,
    truncated: false,
    stageCounts: { drafting: 28, intake: 2 },
  });
  __setPaginatedRows("dashboard:listFlatProjects", [
    ...Array.from({ length: 28 }, (_, index) => flatRow(`d${index}`, "drafting")),
    ...Array.from({ length: 2 }, (_, index) => flatRow(`i${index}`, "intake")),
  ]);
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
const boardRegion = () =>
  document.querySelector<HTMLElement>('[role="region"][aria-label^="Projects board"]');
const listRegion = () =>
  document.querySelector<HTMLElement>('[role="region"][aria-label="Projects list"]');

function columnBody(stageId: string): HTMLElement {
  const body = document
    .querySelector(`section[aria-labelledby="project-board-${stageId}"]`)
    ?.querySelector<HTMLElement>('[class*="overflow-y-auto"]');
  if (!body) throw new Error(`column body for ${stageId} not rendered`);
  return body;
}

describe("WorkspaceDashboard viewport containment (real +layout flex context)", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetPage();
    __resetNavigation();
    __resetConvexStub();
  });

  it("binds the shell to the viewport on Board: no document scroll, lanes own vertical scroll independently", async () => {
    await mountShell("/dashboard?layout=board&group=none");
    await expect.poll(() => boardRegion()).not.toBeNull();

    const root = shellRoot();
    if (!root) throw new Error("workspace shell root not rendered");
    // Light-plane smoke (2026-08-06 redesign): the content plane mounts the
    // LIGHT scope, never the dark one — the dark scope remains only for the
    // drawer/WorkspaceChrome surfaces.
    expect(root.getAttribute("data-workspace-theme")).toBe("light");
    // The shell is exactly viewport-height even though its board content is
    // several times taller (28 drafting cards).
    expect(Math.round(root.getBoundingClientRect().height)).toBe(window.innerHeight);
    expect(document.documentElement.scrollHeight).toBeLessThanOrEqual(window.innerHeight);

    const region = boardRegion()!;
    const regionStyle = getComputedStyle(region);
    expect(regionStyle.overflowX).toBe("auto");
    expect(regionStyle.overflowY).toBe("hidden");
    expect(region.getBoundingClientRect().bottom).toBeLessThanOrEqual(window.innerHeight + 1);

    // The tall lane overflows internally and scrolls without moving the
    // page, its sibling lane, or its own pinned header.
    const drafting = columnBody("drafting");
    const intake = columnBody("intake");
    expect(drafting.scrollHeight).toBeGreaterThan(drafting.clientHeight);
    drafting.scrollTop = 300;
    expect(drafting.scrollTop).toBeGreaterThan(0);
    expect(intake.scrollTop).toBe(0);
    expect(window.scrollY).toBe(0);
    expect(document.documentElement.scrollTop).toBe(0);
    const header = document.getElementById("project-board-drafting");
    const headerTop = header?.getBoundingClientRect().top ?? -1;
    expect(headerTop).toBeGreaterThanOrEqual(0);
    expect(headerTop).toBeLessThan(window.innerHeight);
  });

  it("binds the shell on List: the list region owns vertical scroll, the document does not grow", async () => {
    await mountShell("/dashboard?layout=list&group=none");
    await expect.poll(() => listRegion()).not.toBeNull();

    // Covers the sr-only phantom-scroll hazard: the rows' absolutely
    // positioned screen-reader labels must stay contained (positioned scroll
    // owner), or they extend the document past the bounded shell.
    expect(document.documentElement.scrollHeight).toBeLessThanOrEqual(window.innerHeight);

    const region = listRegion()!;
    expect(getComputedStyle(region).overflowY).toBe("auto");
    expect(region.getBoundingClientRect().bottom).toBeLessThanOrEqual(window.innerHeight + 1);
    // 30 rows do not fit in the bounded region — it scrolls internally.
    expect(region.scrollHeight).toBeGreaterThan(region.clientHeight);
    region.scrollTop = 200;
    expect(region.scrollTop).toBeGreaterThan(0);
    expect(window.scrollY).toBe(0);
  });

  it("honors an explicit route view prop over ?view and gives the rail canonical links carrying ?layout", async () => {
    // A stale ?view=my_work param must not beat the canonical route's view.
    await mountShell("/projects?layout=list&group=none&view=my_work", { view: "all_projects" });
    await expect.poll(() => listRegion()).not.toBeNull();

    const heading = document.querySelector("header h1");
    expect(heading?.textContent).toBe("Projects");

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
