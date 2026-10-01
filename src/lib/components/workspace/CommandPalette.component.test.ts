import { beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import CommandPalette from "./CommandPalette.svelte";
import { __resetPage } from "$lib/test/app-state-stub.svelte";
import { __navigationCalls, __resetNavigation } from "$lib/test/app-navigation-stub";
import { __resetConvexStub, __setQueryData } from "$lib/test/convex-svelte-stub.svelte";
import { viewAs } from "$lib/shell/viewAs.svelte";

vi.mock("$lib/authClient", () => ({ authClient: { signOut: vi.fn() } }));

const labels = () =>
  Array.from(document.querySelectorAll<HTMLElement>("[data-command-item]")).map((item) =>
    item.textContent?.replace(/\s+/g, " ").trim()
  );

async function open(user: Record<string, unknown>) {
  __setQueryData("users:getCurrentUser", user);
  await render(CommandPalette, {
    open: true,
    myWorkHref: "/my-work",
    projectsHref: "/projects",
    currentDashboardHref: "/dashboard?workspace=current",
  });
  await expect.poll(() => document.querySelectorAll("[data-command-item]").length).toBeGreaterThan(3);
}

describe("CommandPalette (round 2 additions)", () => {
  beforeEach(() => {
    __resetPage();
    __resetNavigation();
    __resetConvexStub();
    sessionStorage.clear();
    viewAs.clear();
  });

  it("a Consultant gets Home, Projects, Settings, Keyboard shortcuts and Flag an issue, no Team or admin pages", async () => {
    await open({ _id: "c", role: "writer" });
    expect(labels()).toEqual([
      "Home",
      "Projects",
      "Settings",
      "Keyboard shortcuts",
      "New project Opens the wizard",
      "Flag an issue",
    ]);
  });

  it("a Manager also gets Team", async () => {
    await open({ _id: "m", role: "manager" });
    expect(labels()).toContain("Team");
    expect(labels()).not.toContain("House rules");
  });

  it("an Admin gets every admin page, palette-only ones included", async () => {
    await open({ _id: "a", role: "admin" });
    for (const label of ["Team", "House rules", "OneDrive import", "AI usage and cost", "Paired comparisons", "Ownership review", "Users and roles"]) {
      expect(labels()).toContain(label);
    }
    expect(labels()).not.toContain("Current dashboard");
  });

  it("a developer gets the Current dashboard escape; View as hides admin pages and the escape", async () => {
    const dev = { _id: "d", role: "admin", isDeveloper: true };
    await open(dev);
    expect(labels()).toContain("Current dashboard");
    await page.getByText("Current dashboard").click();
    await expect.poll(() => __navigationCalls.map((call) => call.url)).toEqual(["/dashboard?workspace=current"]);
  });

  it("while viewing as a Consultant, the palette follows that view", async () => {
    viewAs.enter("consultant");
    await open({ _id: "d", role: "admin", isDeveloper: true });
    expect(labels()).not.toContain("House rules");
    expect(labels()).not.toContain("Team");
    expect(labels()).not.toContain("Current dashboard");
  });

  it("Flag an issue dispatches the flag event", async () => {
    await open({ _id: "c", role: "writer" });
    const flagged = vi.fn();
    window.addEventListener("banhall:flag-issue", flagged, { once: true });
    await page.getByText("Flag an issue").click();
    expect(flagged).toHaveBeenCalledOnce();
  });
});
