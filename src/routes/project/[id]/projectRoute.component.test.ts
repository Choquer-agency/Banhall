import { beforeEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import ProjectPage from "./+page.svelte";
import { __resetPage, __setPageParams, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __navigationCalls, __resetNavigation } from "$lib/test/app-navigation-stub";
import { __resetConvexStub, __setQueryData } from "$lib/test/convex-svelte-stub.svelte";

/**
 * Route-shape test for the real /project/[id] page (not gate mark snippets):
 * the 18-line route must keep `currentWhileLoading={false}` and wire
 * CurrentProjectPage into the `current` snippet and PreviewProjectPage into
 * `preview`. An edit that drops the prop or swaps the snippets passes every
 * other check — these cases fail it.
 *
 * Both report pages are query-heavy; unseeded stub queries hold them in
 * their loading states, which is all this test needs. Assertions stay at the
 * boundary: `[data-dashboard-experience]` and the gate's neutral
 * `aria-label="Loading workspace"` surface — no deep page internals.
 * `$app/environment` is stubbed dev=false so the real decision path runs.
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
const gotoUrls = () => __navigationCalls.filter((call) => call.kind === "goto").map((call) => call.url);
const settle = () => new Promise((resolveSettle) => setTimeout(resolveSettle, 50));

describe("/project/[id] route shape", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetPage();
    __resetNavigation();
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
  });

  it("renders exactly the current report when access is unavailable", async () => {
    __setPageUrl("/project/project-1");
    __setQueryData("workspaceRollout:getAccess", { available: false });
    await render(ProjectPage, {});

    await expect.poll(() => experience("current")).not.toBeNull();
    expect(experience("preview")).toBeNull();
    // The mounted component must be the rollback CurrentProjectPage, not a
    // swapped-in preview page under the current wrapper.
    expect(previewCohortMark()).toBeNull();
  });

  it("lets ?workspace=current win immediately for a flagged user, with no navigation", async () => {
    __setPageUrl("/project/project-1?workspace=current");
    __setQueryData("workspaceRollout:getAccess", { available: true });
    await render(ProjectPage, {});

    await expect.poll(() => experience("current")).not.toBeNull();
    expect(experience("preview")).toBeNull();
    expect(previewCohortMark()).toBeNull();
    await settle();
    expect(gotoUrls()).toHaveLength(0);
  });

  it("renders exactly the preview workbench when access is available", async () => {
    __setPageUrl("/project/project-1");
    __setQueryData("workspaceRollout:getAccess", { available: true });
    await render(ProjectPage, {});

    await expect.poll(() => experience("preview")).not.toBeNull();
    expect(experience("current")).toBeNull();
    // And the component under the preview wrapper is really the preview page.
    await expect.poll(() => previewCohortMark()).not.toBeNull();
  });
});
