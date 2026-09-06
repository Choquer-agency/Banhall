import { beforeEach, describe, expect, it, vi } from "vitest";
import { goto } from "$app/navigation";
import { page } from "$app/state";
import { tick } from "svelte";
import { render } from "vitest-browser-svelte";
import { createRawSnippet } from "svelte";
import WorkspaceGate from "./WorkspaceGate.svelte";
import { __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __resetNavigation } from "$lib/test/app-navigation-stub";
import { __resetConvexStub, __setQueryData, __setQueryError, __activeQueryCount, __activeQueryArgs } from "$lib/test/convex-svelte-stub.svelte";
import { __resetAuthState, __setAuthState } from "$lib/test/convex-auth-stub";

vi.mock("$app/navigation", { spy: true });

/**
 * The shared rollout gate is the single branch point for /dashboard,
 * /projects, and /my-work. These tests drive it in both route shapes:
 * canonical routes (preview snippet + currentHref redirect) and the
 * compatibility route (current snippet + previewHref redirect). The auth
 * stub defaults to a settled, authenticated session.
 */
const previewMark = createRawSnippet(() => ({
  render: () => `<div data-testid="preview-mark">preview subtree</div>`,
}));
const currentMark = createRawSnippet(() => ({
  render: () => `<div data-testid="current-mark">current subtree</div>`,
}));

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


describe("WorkspaceGate — canonical route shape (preview snippet + currentHref)", () => {
  beforeEach(() => {
    __resetAuthState();
    __resetPage();
    __resetNavigation();
    vi.mocked(goto).mockClear();
    // Assert the requested navigation; this fixture does not mount destination routes.
    vi.mocked(goto).mockResolvedValue(undefined);
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
    await tick();
    expect(gotoUrls()).toHaveLength(0);
  });

  it("waits for auth, then replaces the URL with login without a subtree or access subscription", async () => {
    __setPageUrl("/projects");
    __setAuthState({ isLoading: true, isAuthenticated: false });
    await render(WorkspaceGate, { preview: previewMark, current: currentMark });

    await expect.poll(() => document.querySelector('[data-workspace-gate-pending="auth"]')).not.toBeNull();
    expect(gotoUrls()).toEqual([]);
    expect(__activeQueryCount("workspaceRollout:getAccess")).toBe(0);
    expect(__activeQueryArgs("workspaceRollout:getAccess")).toEqual([]);
    expect(document.querySelector('[data-dashboard-experience]')).toBeNull();

    __setAuthState({ isLoading: false, isAuthenticated: false });
    await expectSoftNavigation("/login");
    expect(document.querySelector('[data-workspace-gate-pending="redirect"]')).not.toBeNull();
    expect(document.querySelector('[data-dashboard-experience]')).toBeNull();
    expect(document.body.textContent).not.toContain("Sign in to continue");
    expect(__activeQueryCount("workspaceRollout:getAccess")).toBe(0);
    expect(__activeQueryArgs("workspaceRollout:getAccess")).toEqual([]);
  });

  it("renders a neutral loading state while the decision is pending — no redirect, no preview flash", async () => {
    __setPageUrl("/projects?layout=board");
    await render(WorkspaceGate, {
      preview: previewMark,
      currentHref: "/dashboard?layout=board&view=all_projects",
    });

    await expect.poll(() => document.querySelector('[aria-label="Loading workspace"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="preview-mark"]')).toBeNull();
    await tick();
    expect(gotoUrls()).toHaveLength(0);
  });

  it("soft-redirects to the compatibility entry once the decision is genuinely current", async () => {
    __setPageUrl("/projects?layout=board");
    __setQueryData("workspaceRollout:getAccess", { available: true });
    __setQueryError("workspaceRollout:getAccess", new Error("Access denied"));
    await render(WorkspaceGate, {
      preview: previewMark,
      currentHref: "/dashboard?layout=board&view=all_projects",
    });

    await expectSoftNavigation("/dashboard?layout=board&view=all_projects");
    expect(document.querySelector('[data-testid="preview-mark"]')).toBeNull();
  });

  it("lets ?workspace=current win immediately, even while the access query would still be loading", async () => {
    __setPageUrl("/projects?workspace=current");
    await render(WorkspaceGate, {
      preview: previewMark,
      currentHref: "/dashboard?workspace=current&view=all_projects",
    });

    await expectSoftNavigation("/dashboard?workspace=current&view=all_projects");
    expect(document.querySelector('[data-testid="preview-mark"]')).toBeNull();
  });
});

describe("WorkspaceGate — compatibility route shape (current snippet + previewHref)", () => {
  beforeEach(() => {
    __resetAuthState();
    __resetPage();
    __resetNavigation();
    vi.mocked(goto).mockClear();
    // Assert the requested navigation; this fixture does not mount destination routes.
    vi.mocked(goto).mockResolvedValue(undefined);
    __resetConvexStub();
  });

  it("mounts the current subtree immediately while the decision loads (fail-closed rollback surface)", async () => {
    __setPageUrl("/dashboard");
    await render(WorkspaceGate, { current: currentMark, previewHref: "/my-work" });

    await expect.poll(() => document.querySelector('[data-testid="current-mark"]')).not.toBeNull();
    expect(document.querySelector('[data-dashboard-experience="current"]')).not.toBeNull();
    await tick();
    expect(gotoUrls()).toHaveLength(0);
  });

  it("keeps the current subtree mounted on an error despite stale available data", async () => {
    __setPageUrl("/dashboard");
    __setQueryData("workspaceRollout:getAccess", { available: true });
    __setQueryError("workspaceRollout:getAccess", new Error("Access denied"));
    await render(WorkspaceGate, { current: currentMark, previewHref: "/my-work" });

    await expect.poll(() => document.querySelector('[data-testid="current-mark"]')).not.toBeNull();
    await tick();
    expect(gotoUrls()).toHaveLength(0);
  });

  it("soft-navigates authorized users to their canonical URL, preserving params via the caller's href", async () => {
    __setPageUrl("/dashboard?layout=board");
    __setQueryData("workspaceRollout:getAccess", { available: true });
    await render(WorkspaceGate, { current: currentMark, previewHref: "/my-work?layout=board" });

    await expectSoftNavigation("/my-work?layout=board");
  });

  it("keeps ?workspace=current on the current subtree with no navigation at all", async () => {
    __setPageUrl("/dashboard?workspace=current");
    __setQueryData("workspaceRollout:getAccess", { available: true });
    await render(WorkspaceGate, { current: currentMark, previewHref: "/my-work" });

    await expect.poll(() => document.querySelector('[data-testid="current-mark"]')).not.toBeNull();
    await tick();
    expect(gotoUrls()).toHaveLength(0);
  });
});

describe("WorkspaceGate — two-subtree report shape", () => {
  beforeEach(() => {
    __resetAuthState();
    __resetPage();
    __resetNavigation();
    vi.mocked(goto).mockClear();
    // Assert the requested navigation; this fixture does not mount destination routes.
    vi.mocked(goto).mockResolvedValue(undefined);
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

  it("reactively skips access on override, retains skipped errors, and recovers on the same mount", async () => {
    __setPageUrl("/project/project-1?note=caf%C3%A9&tag=a&tag=b");
    await render(WorkspaceGate, {
      current: currentMark, preview: previewMark, currentWhileLoading: false,
    });
    await expect.poll(() => document.querySelector('[data-workspace-gate-route-state="loading"]')).not.toBeNull();
    expect(__activeQueryCount("workspaceRollout:getAccess")).toBe(1);
    expect(__activeQueryArgs("workspaceRollout:getAccess")).toEqual([{}]);
    expect(gotoUrls()).toEqual([]);

    __setPageUrl("/project/project-1?note=caf%C3%A9&tag=a&tag=b&workspace=current");
    await expect.poll(() => document.querySelector('[data-testid="current-mark"]')).not.toBeNull();
    expect(__activeQueryCount("workspaceRollout:getAccess")).toBe(0);
    expect(__activeQueryArgs("workspaceRollout:getAccess")).toEqual([]);
    __setQueryData("workspaceRollout:getAccess", { available: true });
    __setQueryError("workspaceRollout:getAccess", new Error("Access denied"));
    await tick();
    expect(document.querySelector('[data-testid="current-mark"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="preview-mark"]')).toBeNull();
    expect(__activeQueryCount("workspaceRollout:getAccess")).toBe(0);
    expect(__activeQueryArgs("workspaceRollout:getAccess")).toEqual([]);

    __setPageUrl("/project/project-1?note=caf%C3%A9&tag=a&tag=b");
    await tick();
    expect(__activeQueryCount("workspaceRollout:getAccess")).toBe(1);
    expect(__activeQueryArgs("workspaceRollout:getAccess")).toEqual([{}]);
    expect(document.querySelector('[data-testid="current-mark"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="preview-mark"]')).toBeNull();

    __setQueryData("workspaceRollout:getAccess", { available: true });
    await expect.poll(() => document.querySelector('[data-testid="preview-mark"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="current-mark"]')).toBeNull();
    expect(gotoUrls()).toEqual([]);
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

  it("renders only current when the report access query fails", async () => {
    __setPageUrl("/project/project-1");
    __setQueryData("workspaceRollout:getAccess", { available: true });
    __setQueryError("workspaceRollout:getAccess", new Error("Access denied"));
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
