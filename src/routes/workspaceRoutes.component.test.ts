import { beforeEach, describe, expect, it } from "vitest";
import { page as browserPage } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import ProjectsPage from "./projects/+page.svelte";
import MyWorkPage from "./my-work/+page.svelte";
import DashboardPage from "./dashboard/+page.svelte";
import { __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __navigationCalls, __resetNavigation } from "$lib/test/app-navigation-stub";
import {
  __resetConvexStub,
  __setPaginatedRows,
  __setQueryData,
} from "$lib/test/convex-svelte-stub.svelte";

/**
 * Route wiring for the canonical workspace URLs (product-domain amendment
 * 2026-08-06): /projects and /my-work render the workspace for flagged
 * users and soft-redirect everyone else to the /dashboard compatibility
 * entry with `view` set and every other param preserved; the flagged
 * /dashboard soft-navigates to the canonical URL. `$app/environment` is
 * stubbed dev=false so the real gate decision path runs.
 */
function seedWorkspaceQueries() {
  __setQueryData("myWork:getViewConfig", { killSwitch: true, ready: false });
  __setQueryData("dashboard:getFacets", { total: 0, truncated: false, stageCounts: {} });
  __setPaginatedRows("dashboard:listFlatProjects", []);
}

const gotoUrls = () => __navigationCalls.filter((call) => call.kind === "goto").map((call) => call.url);

describe("canonical workspace routes", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetPage();
    __resetNavigation();
    __resetConvexStub();
  });

  it.each([
    ["layout=board&utm=x", "layout=board&utm=x&group=client"],
    ["layout=board&group=status&utm=x", "layout=board&group=status&utm=x"],
    ["utm=x", "utm=x&layout=list&group=client"],
    ["group=status&utm=x", "group=status&utm=x&layout=list"],
    ["utm=first&utm=second&note=R%26D%20%2B%20caf%C3%A9", "utm=first&utm=second&note=R%26D%20%2B%20caf%C3%A9&layout=list&group=client"],
  ])("/projects preserves query %s and supplies missing Projects defaults", async (query, projectsQuery) => {
    __setPageUrl(`/projects?${query}`);
    __setQueryData("workspaceRollout:getAccess", { available: true });
    seedWorkspaceQueries();
    await browserPage.viewport(1440, 900);
    const screen = await render(ProjectsPage, {});
    screen.container.style.cssText = "display:flex;flex-direction:column;min-height:100vh;";

    await expect
      .poll(() => document.querySelector("div[data-workspace-shell]"))
      .not.toBeNull();
    expect(document.querySelector('[data-dashboard-experience="preview"]')).not.toBeNull();
    // 0b094ed4: Home preserves params; Projects adds only absent defaults.
    const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>("nav a"));
    for (const [pathname, expectedQuery] of [["/my-work", query], ["/projects", projectsQuery]]) {
      const link = anchors.find((anchor) => new URL(anchor.href).pathname === pathname);
      expect(link).toBeDefined();
      const actual = new URL(link!.href);
      const expected = new URLSearchParams(expectedQuery);
      expect([...actual.searchParams.keys()]).toEqual([...expected.keys()]);
      for (const key of new Set(expected.keys())) {
        expect(actual.searchParams.getAll(key)).toEqual(expected.getAll(key));
      }
    }
    expect(gotoUrls()).toHaveLength(0);
  });

  it("/projects sends a non-flagged user to /dashboard?view=all_projects preserving params", async () => {
    __setPageUrl("/projects?layout=list&utm=x");
    __setQueryData("workspaceRollout:getAccess", { available: false });
    await render(ProjectsPage, {});

    await expect.poll(() => gotoUrls()).toContain("/dashboard?layout=list&utm=x&view=all_projects");
  });

  it("/my-work sends a non-flagged user to /dashboard?view=my_work preserving workspace=current", async () => {
    __setPageUrl("/my-work?workspace=current");
    await render(MyWorkPage, {});

    // ?workspace=current wins even mid-load — the access query is skipped.
    await expect.poll(() => gotoUrls()).toContain("/dashboard?workspace=current&view=my_work");
  });

  it("/my-work shows a neutral loading state (no redirect, no preview flash) while the decision loads", async () => {
    __setPageUrl("/my-work");
    await render(MyWorkPage, {});

    await expect.poll(() => document.querySelector('[aria-label="Loading workspace"]')).not.toBeNull();
    expect(document.querySelector("[data-workspace-shell]")).toBeNull();
    await new Promise((resolveSettle) => setTimeout(resolveSettle, 50));
    expect(gotoUrls()).toHaveLength(0);
  });

  it("/dashboard soft-navigates a flagged user to the canonical URL, mapping ?view and keeping other params", async () => {
    __setPageUrl("/dashboard?view=all_projects&layout=board");
    __setQueryData("workspaceRollout:getAccess", { available: true });
    await render(DashboardPage, {});

    await expect.poll(() => gotoUrls()).toContain("/projects?layout=board");
  });

  it("/dashboard defaults the flagged redirect to /my-work", async () => {
    __setPageUrl("/dashboard");
    __setQueryData("workspaceRollout:getAccess", { available: true });
    await render(DashboardPage, {});

    await expect.poll(() => gotoUrls()).toContain("/my-work");
  });

  it("/dashboard keeps the current experience mounted for non-flagged users — no navigation", async () => {
    __setPageUrl("/dashboard");
    __setQueryData("workspaceRollout:getAccess", { available: false });
    seedWorkspaceQueries();
    await render(DashboardPage, {});

    await expect
      .poll(() => document.querySelector('[data-dashboard-experience="current"]'))
      .not.toBeNull();
    await new Promise((resolveSettle) => setTimeout(resolveSettle, 50));
    expect(gotoUrls()).toHaveLength(0);
  });
});
