import { beforeEach, describe, expect, it, vi } from "vitest";
import { goto } from "$app/navigation";
import { tick } from "svelte";
import { render } from "vitest-browser-svelte";
import { __resetAuthState, __setAuthState } from "$lib/test/convex-auth-stub";
import ProjectPage from "./+page.svelte";
import { __resetPage, __setPageParams, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __resetNavigation } from "$lib/test/app-navigation-stub";
import { __resetConvexStub, __setQueryData, __setQueryError, __activeQueryCount, __activeQueryArgs } from "$lib/test/convex-svelte-stub.svelte";
import { RECENT_PROJECTS_KEY } from "$lib/workspace/recentProjects";

vi.mock("$app/navigation", { spy: true });

/**
 * Route-shape test for the real /project/[id] page (not gate mark snippets):
 * the route must keep `currentWhileLoading={false}` and wire
 * CurrentProjectPage into the `current` snippet and PreviewProjectPage into
 * `preview`. An edit that drops the prop or swaps the snippets passes every
 * other check — these cases fail it.
 *
 * Dynamic imports can compile the full report graph on first use in the test
 * dev server, so completion polls allow that cold compilation explicitly.
 * Both report pages are query-heavy; unseeded stub queries hold them in
 * their loading states, which is all this test needs. Assertions stay at the
 * boundary: `[data-dashboard-experience]` and the gate's neutral
 * `aria-label="Loading workspace"` surface — no deep page internals.
 */
const experience = (name: "current" | "preview") =>
  document.querySelector(`[data-dashboard-experience="${name}"]`);
/**
 * PreviewProjectPage marks all of its top-level states with
 * data-report-cohort="preview"; the frozen CurrentProjectPage never does.
 * Asserting on it detects a snippet/import swap even though both pages sit
 * in otherwise-identical loading DOM.
 */
const previewCohortMark = () => document.querySelector('[data-report-cohort="preview"]');
const gotoUrls = () => vi.mocked(goto).mock.calls.map(([url]) => String(url));


describe("/project/[id] route shape", () => {
  beforeEach(() => {
    __resetAuthState();
    localStorage.clear();
    __resetPage();
    __resetNavigation();
    vi.mocked(goto).mockClear();
    __resetConvexStub();
    __setPageParams({ id: "project-1" });
  });

  it("mounts neither report cohort while the access decision is pending (currentWhileLoading=false)", async () => {
    __setPageUrl("/project/project-1");
    await render(ProjectPage, {});

    await expect.poll(() => document.querySelector('[aria-label="Loading workspace"]')).not.toBeNull();
    expect(experience("current")).toBeNull();
    expect(experience("preview")).toBeNull();
    expect(previewCohortMark()).toBeNull();
    expect(__activeQueryCount("projects:getProject")).toBe(0);
  }, 60000);

  it("renders exactly the current report when the access query fails", async () => {
    __setPageUrl("/project/project-1");
    __setQueryData("workspaceRollout:getAccess", { available: true });
    __setQueryError("workspaceRollout:getAccess", new Error("Access denied"));
    await render(ProjectPage, {});

    await expect.poll(() => __activeQueryCount("projects:getProject"), { timeout: 30000 }).toBe(1);
    await expect.poll(() => experience("current")).not.toBeNull();
    expect(experience("preview")).toBeNull();
    // The mounted component must be the rollback CurrentProjectPage, not a
    // swapped-in preview page under the current wrapper.
    expect(previewCohortMark()).toBeNull();
  }, 60000);

  it("lets ?workspace=current win immediately for an authorized user, with no navigation", async () => {
    __setPageUrl("/project/project-1?workspace=current");
    __setQueryData("workspaceRollout:getAccess", { available: true });
    await render(ProjectPage, {});

    await expect.poll(() => __activeQueryCount("projects:getProject"), { timeout: 30000 }).toBe(1);
    await expect.poll(() => experience("current")).not.toBeNull();
    expect(experience("preview")).toBeNull();
    expect(previewCohortMark()).toBeNull();
    expect(__activeQueryCount("workspaceRollout:getAccess")).toBe(0);
    expect(__activeQueryArgs("workspaceRollout:getAccess")).toEqual([]);
    await tick();
    expect(gotoUrls()).toHaveLength(0);
  }, 60000);

  it("renders exactly the preview workbench when access is available", async () => {
    __setPageUrl("/project/project-1");
    __setQueryData("workspaceRollout:getAccess", { available: true });
    await render(ProjectPage, {});

    await expect.poll(() => experience("preview")).not.toBeNull();
    expect(experience("current")).toBeNull();
    // And the component under the preview wrapper is really the preview page.
    await expect.poll(() => previewCohortMark(), { timeout: 30000 }).not.toBeNull();
    expect(__activeQueryCount("projects:getProject")).toBe(1);
  }, 60000);

  it("waits during the session check, then sends a signed-out visitor to login with the project as next", async () => {
    // A full load after the 15-minute Convex JWT lapsed starts in the session
    // check (no server auth state). That must not redirect or lose the page.
    __setPageUrl("/project/project-1?tab=report#seed-2");
    __setAuthState({ isLoading: true, isAuthenticated: false });
    await render(ProjectPage, {});

    await expect.poll(() => document.querySelector('[data-workspace-gate-pending="auth"]')).not.toBeNull();
    await tick();
    expect(gotoUrls()).toEqual([]);
    expect(__activeQueryCount("projects:getProject")).toBe(0);

    __setAuthState({ isLoading: false, isAuthenticated: false });
    await expect.poll(gotoUrls).toEqual(["/login?next=%2Fproject%2Fproject-1%3Ftab%3Dreport%23seed-2"]);
    expect(experience("current")).toBeNull();
    expect(experience("preview")).toBeNull();
  }, 60000);
});

/**
 * Broken behaviour #5: opening a project page records it in this browser's
 * recents however it was reached (typed URL, back and forward, a redirect),
 * once per open, and only for a signed-in person.
 */
describe("/project/[id] recents", () => {
  const storedRecents = () =>
    JSON.parse(localStorage.getItem(RECENT_PROJECTS_KEY) ?? "[]") as Array<{
      id: string;
      title: string;
      client?: string;
      openedAt?: number;
    }>;
  const recentWrites = (spy: { mock: { calls: unknown[][] } }) =>
    spy.mock.calls.filter(([key]) => key === RECENT_PROJECTS_KEY).length;

  beforeEach(() => {
    __resetAuthState();
    localStorage.clear();
    __resetPage();
    __resetNavigation();
    vi.mocked(goto).mockClear();
    __resetConvexStub();
  });

  it("records a project opened by URL, and each project the page moves to, once per open", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    try {
      __setPageParams({ id: "project-1" });
      __setPageUrl("/project/project-1");
      await render(ProjectPage, {});

      await expect.poll(() => storedRecents().map((entry) => entry.id)).toEqual(["project-1"]);
      expect(storedRecents()[0].openedAt).toBeGreaterThan(0);
      expect(recentWrites(setItem)).toBe(1);

      // Unrelated page updates on the same project write nothing more.
      __setPageUrl("/project/project-1?tab=report");
      __setPageParams({ id: "project-1" });
      await tick();
      expect(recentWrites(setItem)).toBe(1);

      // Back or forward to another project reuses the page and records it first.
      __setPageParams({ id: "project-2" });
      __setPageUrl("/project/project-2");
      await expect.poll(() => storedRecents().map((entry) => entry.id)).toEqual(["project-2", "project-1"]);
      expect(recentWrites(setItem)).toBe(2);
    } finally {
      setItem.mockRestore();
    }
  }, 60000);

  it("keeps the title and client a link click already recorded", async () => {
    localStorage.setItem(
      RECENT_PROJECTS_KEY,
      JSON.stringify([{ id: "project-1", title: "Adaptive cold storage controls", client: "Northwind", openedAt: 5 }])
    );
    __setPageParams({ id: "project-1" });
    __setPageUrl("/project/project-1");
    await render(ProjectPage, {});

    await expect.poll(() => storedRecents()[0]?.openedAt).toBeGreaterThan(5);
    expect(storedRecents()).toEqual([
      expect.objectContaining({ id: "project-1", title: "Adaptive cold storage controls", client: "Northwind" }),
    ]);
  }, 60000);

  it("records nothing for a signed-out visitor, then records once they are signed in", async () => {
    __setAuthState({ isLoading: false, isAuthenticated: false });
    __setPageParams({ id: "project-1" });
    __setPageUrl("/project/project-1");
    await render(ProjectPage, {});

    await expect.poll(gotoUrls).toEqual(["/login?next=%2Fproject%2Fproject-1"]);
    expect(localStorage.getItem(RECENT_PROJECTS_KEY)).toBeNull();

    __setAuthState({ isAuthenticated: true });
    await expect.poll(() => storedRecents().map((entry) => entry.id)).toEqual(["project-1"]);
  }, 60000);
});
