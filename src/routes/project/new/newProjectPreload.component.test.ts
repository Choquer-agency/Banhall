import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import NewProjectPage from "./+page.svelte";
import { __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __resetNavigation } from "$lib/test/app-navigation-stub";
import { __resetConvexStub, __setQueryData } from "$lib/test/convex-svelte-stub.svelte";
import { takeProjectStart } from "$lib/workspace/projectIntentHandoff";
import { loadOnce, preloadProjectPage } from "$lib/components/project/projectPageModules";

/**
 * Live test 2026-09-26 (P2): after a prepared start the project opened with
 * its seed stage already open, yet showed only "Loading report workspace..."
 * for 10 s while the project page's own code loaded. New project now loads
 * that code while the writer fills it in, so the plan with its first step
 * writing ideas shows as soon as the project opens.
 */
const preload = vi.hoisted(() => ({ calls: 0, cancels: 0 }));
vi.mock("$lib/components/project/projectPageModules", async (importOriginal) => {
  const actual = await importOriginal<typeof import("$lib/components/project/projectPageModules")>();
  return {
    ...actual,
    preloadProjectPage: (load?: () => Promise<unknown>) => {
      // The page's own call is counted and never loads the real page here;
      // the direct calls below exercise the real scheduler.
      if (!load) {
        preload.calls += 1;
        return () => void (preload.cancels += 1);
      }
      return actual.preloadProjectPage(load);
    },
  };
});

beforeEach(async () => {
  preload.calls = 0;
  preload.cancels = 0;
  localStorage.clear();
  __resetPage();
  __resetNavigation();
  __resetConvexStub();
  takeProjectStart();
  __setPageUrl("/project/new");
  __setQueryData("users:getCurrentUser", { _id: "user-1", role: "writer", firstName: "Wendy" });
  __setQueryData("tags:listTags", []);
  await page.viewport(1440, 900);
});

describe("the project page loads before a start opens it", () => {
  it("New project starts loading the project page when it opens and stops if it closes first", async () => {
    const screen = await render(NewProjectPage, {});
    await expect.poll(() => document.querySelector("[data-right-column]")).not.toBeNull();
    expect(preload.calls).toBe(1);
    screen.unmount();
    expect(preload.cancels).toBe(1);
  });

  it("the preload runs the loader once the browser is idle", async () => {
    const load = vi.fn(async () => ({ default: null }));
    preloadProjectPage(load);
    await expect.poll(() => load.mock.calls.length, { timeout: 3000 }).toBe(1);
  });

  it("the route reuses the load New project started, and asks again after a failed one", async () => {
    let attempt = 0;
    const load = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("offline");
      return { default: "The plan" };
    });
    const shared = loadOnce(load);
    await expect(shared()).rejects.toThrow("offline");
    const preloaded = shared();
    expect(shared()).toBe(preloaded);
    await expect(preloaded).resolves.toEqual({ default: "The plan" });
    expect(load).toHaveBeenCalledTimes(2);
  });
});
