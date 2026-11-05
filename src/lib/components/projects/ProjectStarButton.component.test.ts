import { beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { toast } from "svelte-sonner";
import ProjectStarButton from "./ProjectStarButton.svelte";
import ProjectTopBar from "$lib/components/project/shell/ProjectTopBar.svelte";
import { __resetPage } from "$lib/test/app-state-stub.svelte";
import {
  __mutationCalls,
  __resetConvexStub,
  __setMutationError,
  __setMutationResult,
  __setQueryData,
} from "$lib/test/convex-svelte-stub.svelte";

/** The private project star (2026-11-02): the toggle on cards and the project top bar. */
const button = () => document.querySelector<HTMLButtonElement>("[data-project-star]")!;

beforeEach(async () => {
  __resetPage();
  __resetConvexStub();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  await page.viewport(1440, 900);
});

describe("ProjectStarButton", () => {
  it("is a toggle button whose name stays put; the pressed state and the tooltip say which", async () => {
    __setMutationResult("projects:setProjectStar", { starred: true });
    await render(ProjectStarButton, { projectId: "p1", projectTitle: "Pump control", starred: false, variant: "bar" });
    const star = page.getByRole("button", { name: "Star project" });
    await expect.element(star).toHaveAttribute("aria-pressed", "false");
    expect(button().getAttribute("title")).toBe("Star project");
    expect(button().getAttribute("type")).toBe("button");
    // 30px at rest, 44px on touch screens.
    expect(button().getBoundingClientRect().width).toBeGreaterThan(0);
    expect(button().className).toContain("pointer-coarse:size-11");

    await userEvent.click(star);
    expect(__mutationCalls("projects:setProjectStar")).toEqual([{ projectId: "p1", starred: true }]);
  });

  it("names the project on a card, and grows its touch area to 44px without moving the band", async () => {
    await render(ProjectStarButton, { projectId: "p1", projectTitle: "Pump control", starred: true });
    await expect.element(page.getByRole("button", { name: "Star Pump control" })).toHaveAttribute("aria-pressed", "true");
    expect(button().getAttribute("title")).toBe("Unstar project");
    expect(button().className).toContain("pointer-coarse:before:-inset-[0.625rem]");
    expect(button().className).toContain("relative z-10");
  });

  it("fills a starred star in the slightly darker yellow, fading its colour (owner, 2026-11-05)", async () => {
    await render(ProjectStarButton, { projectId: "p1", projectTitle: "Pump control", starred: true, variant: "bar" });
    expect(button().className).toContain("text-star");
    expect(getComputedStyle(button()).color).toBe("rgb(234, 179, 8)");
    expect(getComputedStyle(button()).transitionDuration).toContain("0.2s");
  });

  it("pops once when starred, then settles", async () => {
    __setMutationResult("projects:setProjectStar", { starred: true });
    await render(ProjectStarButton, { projectId: "p1", projectTitle: "Pump control", starred: false, variant: "bar" });
    expect(button().querySelector("[data-star-pop]")).toBeNull();
    await userEvent.click(page.getByRole("button", { name: "Star project" }));
    // The pop runs for 260ms and clears itself when it ends.
    expect(button().querySelector(".star-pop")).not.toBeNull();
    expect(getComputedStyle(button().querySelector(".star-pop")!).animationName).toBe("star-pop");
    await expect.poll(() => button().querySelector("[data-star-pop]")).toBeNull();
  });

  it("does not pop when unstarring", async () => {
    __setMutationResult("projects:setProjectStar", { starred: false });
    await render(ProjectStarButton, { projectId: "p1", projectTitle: "Pump control", starred: true, variant: "bar" });
    await userEvent.click(page.getByRole("button", { name: "Star project" }));
    expect(button().querySelector("[data-star-pop]")).toBeNull();
  });

  it("puts the saved state back with a toast when the star is refused", async () => {
    const errorToast = vi.spyOn(toast, "error").mockImplementation(() => "star-toast");
    __setMutationError("projects:setProjectStar", {
      data: { code: "INVALID_STATE", message: "You can star up to 200 projects. Unstar one first." },
    });
    await render(ProjectStarButton, { projectId: "p1", projectTitle: "Pump control", starred: false, variant: "bar" });
    await userEvent.click(page.getByRole("button", { name: "Star project" }));
    await expect.poll(() => errorToast.mock.calls.length).toBe(1);
    expect(errorToast).toHaveBeenCalledWith("You can star up to 200 projects. Unstar one first.");
    expect(button().getAttribute("aria-pressed")).toBe("false");
  });
});

describe("The project top bar's star", () => {
  it("sits right after the title with the saved state, only when a project is named", async () => {
    __setQueryData("changelog:unseenCount", 0);
    __setQueryData("projects:isProjectStarred", true);
    const view = await render(ProjectTopBar, {
      title: "Pump control",
      projectId: "p1",
      projectsHref: "/projects",
      onOpenNavigation: () => {},
    });
    await expect.element(page.getByRole("button", { name: "Star project" })).toHaveAttribute("aria-pressed", "true");
    const heading = document.querySelector<HTMLElement>("[data-project-heading]")!;
    expect(heading.nextElementSibling).toBe(button());
    view.unmount();

    await render(ProjectTopBar, { title: "Pump control", projectsHref: "/projects", onOpenNavigation: () => {} });
    await expect.element(page.getByRole("heading", { name: "Pump control" })).toBeVisible();
    expect(document.querySelector("[data-project-star]")).toBeNull();
  });
});
