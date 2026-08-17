import { beforeEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import { createRawSnippet } from "svelte";
import WorkspaceGate from "./WorkspaceGate.svelte";
import { __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __navigationCalls, __resetNavigation } from "$lib/test/app-navigation-stub";
import { __resetConvexStub, __setQueryData } from "$lib/test/convex-svelte-stub.svelte";
import { __resetAuthState, __setAuthState } from "$lib/test/convex-auth-stub";

/**
 * The shared rollout gate is the single branch point for /dashboard,
 * /projects, and /my-work. These tests drive it in both route shapes:
 * canonical routes (preview snippet + currentHref redirect) and the
 * compatibility route (current snippet + previewHref redirect). The auth
 * stub is a settled, authenticated session; `$app/environment` is stubbed
 * dev=false so the production decision path is the one under test.
 */
const previewMark = createRawSnippet(() => ({
  render: () => `<div data-testid="preview-mark">preview subtree</div>`,
}));
const currentMark = createRawSnippet(() => ({
  render: () => `<div data-testid="current-mark">current subtree</div>`,
}));

const gotoUrls = () => __navigationCalls.filter((call) => call.kind === "goto").map((call) => call.url);
const settle = () => new Promise((resolveSettle) => setTimeout(resolveSettle, 50));

describe("WorkspaceGate — canonical route shape (preview snippet + currentHref)", () => {
  beforeEach(() => {
    __resetAuthState();
    __resetPage();
    __resetNavigation();
    __resetConvexStub();
  });

  it("renders the preview subtree when the server says available, without navigating", async () => {
    __setPageUrl("/projects?layout=board");
    __setQueryData("workspaceRollout:getAccess", { available: true });
    await render(WorkspaceGate, {
      preview: previewMark,
      currentHref: "/dashboard?layout=board&view=all_projects",
    });

    await expect.poll(() => document.querySelector('[data-testid="preview-mark"]')).not.toBeNull();
    expect(document.querySelector('[data-dashboard-experience="preview"]')).not.toBeNull();
    await settle();
    expect(gotoUrls()).toHaveLength(0);
  });

  it("redirects signed-out users without rendering an intermediate sign-in page", async () => {
    __setPageUrl("/projects");
    __setAuthState({ isAuthenticated: false });
    await render(WorkspaceGate, {
      preview: previewMark,
      currentHref: "/dashboard?view=all_projects",
    });

    await expect.poll(() => gotoUrls()).toContain("/login");
    expect(document.body.textContent).not.toContain("Sign in to continue");
    expect(document.querySelector('[data-workspace-gate-pending="redirect"]')).not.toBeNull();
  });

  it("renders a neutral loading state while the decision is pending — no redirect, no preview flash", async () => {
    __setPageUrl("/projects?layout=board");
    await render(WorkspaceGate, {
      preview: previewMark,
      currentHref: "/dashboard?layout=board&view=all_projects",
    });

    await expect.poll(() => document.querySelector('[aria-label="Loading workspace"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="preview-mark"]')).toBeNull();
    await settle();
    expect(gotoUrls()).toHaveLength(0);
  });

  it("soft-redirects to the compatibility entry once the decision is genuinely current", async () => {
    __setPageUrl("/projects?layout=board");
    __setQueryData("workspaceRollout:getAccess", { available: false });
    await render(WorkspaceGate, {
      preview: previewMark,
      currentHref: "/dashboard?layout=board&view=all_projects",
    });

    await expect.poll(() => gotoUrls()).toContain("/dashboard?layout=board&view=all_projects");
    expect(document.querySelector('[data-testid="preview-mark"]')).toBeNull();
  });

  it("lets ?workspace=current win immediately, even while the access query would still be loading", async () => {
    __setPageUrl("/projects?workspace=current");
    await render(WorkspaceGate, {
      preview: previewMark,
      currentHref: "/dashboard?workspace=current&view=all_projects",
    });

    await expect.poll(() => gotoUrls()).toContain("/dashboard?workspace=current&view=all_projects");
    expect(document.querySelector('[data-testid="preview-mark"]')).toBeNull();
  });
});

describe("WorkspaceGate — compatibility route shape (current snippet + previewHref)", () => {
  beforeEach(() => {
    __resetAuthState();
    __resetPage();
    __resetNavigation();
    __resetConvexStub();
  });

  it("mounts the current subtree immediately while the decision loads (fail-closed rollback surface)", async () => {
    __setPageUrl("/dashboard");
    await render(WorkspaceGate, { current: currentMark, previewHref: "/my-work" });

    await expect.poll(() => document.querySelector('[data-testid="current-mark"]')).not.toBeNull();
    expect(document.querySelector('[data-dashboard-experience="current"]')).not.toBeNull();
    await settle();
    expect(gotoUrls()).toHaveLength(0);
  });

  it("keeps the current subtree mounted on error and on an unavailable decision", async () => {
    __setPageUrl("/dashboard");
    __setQueryData("workspaceRollout:getAccess", { available: false });
    await render(WorkspaceGate, { current: currentMark, previewHref: "/my-work" });

    await expect.poll(() => document.querySelector('[data-testid="current-mark"]')).not.toBeNull();
    await settle();
    expect(gotoUrls()).toHaveLength(0);
  });

  it("soft-navigates flagged users to their canonical URL, preserving params via the caller's href", async () => {
    __setPageUrl("/dashboard?layout=board");
    __setQueryData("workspaceRollout:getAccess", { available: true });
    await render(WorkspaceGate, { current: currentMark, previewHref: "/my-work?layout=board" });

    await expect.poll(() => gotoUrls()).toContain("/my-work?layout=board");
  });

  it("keeps ?workspace=current on the current subtree with no navigation at all", async () => {
    __setPageUrl("/dashboard?workspace=current");
    __setQueryData("workspaceRollout:getAccess", { available: true });
    await render(WorkspaceGate, { current: currentMark, previewHref: "/my-work" });

    await expect.poll(() => document.querySelector('[data-testid="current-mark"]')).not.toBeNull();
    await settle();
    expect(gotoUrls()).toHaveLength(0);
  });
});

describe("WorkspaceGate — two-subtree report shape", () => {
  beforeEach(() => {
    __resetAuthState();
    __resetPage();
    __resetNavigation();
    __resetConvexStub();
  });

  it("mounts neither query-heavy subtree while access loads when currentWhileLoading is false", async () => {
    __setPageUrl("/project/project-1");
    await render(WorkspaceGate, {
      current: currentMark,
      preview: previewMark,
      currentWhileLoading: false,
    });

    await expect.poll(() => document.querySelector('[aria-label="Loading workspace"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="current-mark"]')).toBeNull();
    expect(document.querySelector('[data-testid="preview-mark"]')).toBeNull();
  });

  it("renders exactly the resolved subtree after the report decision settles", async () => {
    __setPageUrl("/project/project-1");
    __setQueryData("workspaceRollout:getAccess", { available: true });
    await render(WorkspaceGate, {
      current: currentMark,
      preview: previewMark,
      currentWhileLoading: false,
    });

    await expect.poll(() => document.querySelector('[data-testid="preview-mark"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="current-mark"]')).toBeNull();
  });

  it("renders only current when report access is unavailable", async () => {
    __setPageUrl("/project/project-1");
    __setQueryData("workspaceRollout:getAccess", { available: false });
    await render(WorkspaceGate, {
      current: currentMark,
      preview: previewMark,
      currentWhileLoading: false,
    });

    await expect.poll(() => document.querySelector('[data-testid="current-mark"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="preview-mark"]')).toBeNull();
  });

  it("lets ?workspace=current select current immediately without access data", async () => {
    __setPageUrl("/project/project-1?workspace=current");
    await render(WorkspaceGate, {
      current: currentMark,
      preview: previewMark,
      currentWhileLoading: false,
    });

    await expect.poll(() => document.querySelector('[data-testid="current-mark"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="preview-mark"]')).toBeNull();
  });
});
