import { beforeEach, describe, expect, it, vi } from "vitest";
import { page as browserPage } from "vitest/browser";
import { goto } from "$app/navigation";
import { page } from "$app/state";
import { tick } from "svelte";
import { render } from "vitest-browser-svelte";
import { __resetAuthState } from "$lib/test/convex-auth-stub";
import ProjectsPage from "./projects/+page.svelte";
import MyWorkPage from "./my-work/+page.svelte";
import DashboardPage from "./dashboard/+page.svelte";
import { __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __resetNavigation } from "$lib/test/app-navigation-stub";
import {
  __resetConvexStub,
  __setPaginatedRows,
  __setQueryData,
  __setQueryError,
  __activeQueryCount,
  __activeQueryArgs,
} from "$lib/test/convex-svelte-stub.svelte";

vi.mock("$app/navigation", { spy: true });

/** Canonical routes preserve params through successful access, error, and override. */
function seedWorkspaceQueries() {
  __setQueryData("myWork:getViewConfig", { killSwitch: true, ready: false });
  __setQueryData("dashboard:getFacets", { total: 0, truncated: false, stageCounts: {} });
  __setPaginatedRows("dashboard:listFlatProjects", []);
}

async function expectSoftNavigation(href: string) {
  const expected = new URL(href, page.url);
  await expect.poll(() => vi.mocked(goto).mock.calls.find(([url]) =>
    new URL(String(url), expected).pathname === expected.pathname
  )).toBeDefined();
  await tick();
  expect(vi.mocked(goto).mock.calls).toHaveLength(1);
  const call = vi.mocked(goto).mock.calls[0];
  if (!call) throw new Error(`Missing navigation to ${expected.pathname}`);
  const actual = new URL(String(call[0]), expected);
  expect(actual.origin).toBe(expected.origin);
  expect(actual.pathname).toBe(expected.pathname);
  expect([...new Set(actual.searchParams.keys())].sort()).toEqual([...new Set(expected.searchParams.keys())].sort());
  for (const key of new Set(expected.searchParams.keys())) {
    expect(actual.searchParams.getAll(key)).toEqual(expected.searchParams.getAll(key));
  }
  expect(call[1]).toEqual({ replaceState: true });
}

const gotoUrls = () => vi.mocked(goto).mock.calls.map(([url]) => String(url));

describe("canonical workspace routes", () => {
  beforeEach(() => {
    __resetAuthState();
    localStorage.clear();
    __resetPage();
    __resetNavigation();
    vi.mocked(goto).mockClear();
    // Assert the requested navigation; this fixture does not mount destination routes.
    vi.mocked(goto).mockResolvedValue(undefined);
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
      expect([...new Set(actual.searchParams.keys())].sort()).toEqual([...new Set(expected.keys())].sort());
      for (const key of new Set(expected.keys())) {
        expect(actual.searchParams.getAll(key)).toEqual(expected.getAll(key));
      }
    }
    expect(gotoUrls()).toHaveLength(0);
  });

  it.each([
    "/projects?layout=board&group=status&utm=x",
    "/projects?utm=first&utm=second&note=R%26D%20%2B%20caf%C3%A9",
    "/my-work?layout=list&group=client&utm=x",
    "/my-work?utm=first&utm=second&note=R%26D%20%2B%20caf%C3%A9",
  ])("%s falls back on query error with all params preserved", async (href) => {
    __setPageUrl(href);
    __setQueryData("workspaceRollout:getAccess", { available: true });
    __setQueryError("workspaceRollout:getAccess", new Error("Access denied"));
    const expected = new URL(href, page.url);
    const projects = expected.pathname === "/projects";
    expected.pathname = "/dashboard";
    expected.searchParams.set("view", projects ? "all_projects" : "my_work");
    if (projects) await render(ProjectsPage, {});
    else await render(MyWorkPage, {});

    await expectSoftNavigation(`${expected.pathname}${expected.search}`);
    expect(document.querySelector('[data-workspace-gate-route-state="current"]')).not.toBeNull();
    expect(document.querySelector('[data-dashboard-experience="preview"]')).toBeNull();
  });

  it("/my-work preserves the current override and skips access during navigation", async () => {
    __setPageUrl("/my-work?workspace=current&utm=first&utm=second&note=caf%C3%A9");
    await render(MyWorkPage, {});

    await expectSoftNavigation("/dashboard?workspace=current&utm=first&utm=second&note=caf%C3%A9&view=my_work");
    expect(__activeQueryCount("workspaceRollout:getAccess")).toBe(0);
    expect(__activeQueryArgs("workspaceRollout:getAccess")).toEqual([]);
    expect(document.querySelector('[data-workspace-gate-route-state="current"]')).not.toBeNull();
  });

  it("/my-work shows a neutral loading state (no redirect, no preview flash) while the decision loads", async () => {
    __setPageUrl("/my-work");
    await render(MyWorkPage, {});

    await expect.poll(() => document.querySelector('[aria-label="Loading workspace"]')).not.toBeNull();
    expect(document.querySelector("[data-workspace-shell]")).toBeNull();
    await tick();
    expect(gotoUrls()).toHaveLength(0);
  });

  it("/dashboard soft-navigates an authorized user to the canonical URL, mapping ?view and keeping other params", async () => {
    __setPageUrl("/dashboard?view=all_projects&layout=board");
    __setQueryData("workspaceRollout:getAccess", { available: true });
    await render(DashboardPage, {});

    await expectSoftNavigation("/projects?layout=board");
  });

  it("/dashboard defaults the preview redirect to /my-work", async () => {
    __setPageUrl("/dashboard");
    __setQueryData("workspaceRollout:getAccess", { available: true });
    await render(DashboardPage, {});

    await expectSoftNavigation("/my-work");
  });

  it("/dashboard keeps the current experience mounted for users with access errors — no navigation", async () => {
    __setPageUrl("/dashboard");
    __setQueryData("workspaceRollout:getAccess", { available: true });
    __setQueryError("workspaceRollout:getAccess", new Error("Access denied"));
    seedWorkspaceQueries();
    await render(DashboardPage, {});

    await expect
      .poll(() => document.querySelector('[data-dashboard-experience="current"]'))
      .not.toBeNull();
    await tick();
    expect(gotoUrls()).toHaveLength(0);
  });
});
