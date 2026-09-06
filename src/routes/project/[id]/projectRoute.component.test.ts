import { beforeEach, describe, expect, it, vi } from "vitest";
import { goto } from "$app/navigation";
import { tick } from "svelte";
import { render } from "vitest-browser-svelte";
import { __resetAuthState } from "$lib/test/convex-auth-stub";
import ProjectPage from "./+page.svelte";
import { __resetPage, __setPageParams, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __resetNavigation } from "$lib/test/app-navigation-stub";
import { __resetConvexStub, __setQueryData, __setQueryError, __activeQueryCount, __activeQueryArgs } from "$lib/test/convex-svelte-stub.svelte";

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
});
