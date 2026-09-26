import { beforeEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import NewProjectPage from "./+page.svelte";
import { __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __navigationCalls, __resetNavigation } from "$lib/test/app-navigation-stub";
import {
  __activeQueryArgs,
  __resetConvexStub,
  __setQueryData,
  __setQueryDataForArgs,
} from "$lib/test/convex-svelte-stub.svelte";
import { takeProjectStart } from "$lib/workspace/projectIntentHandoff";
import { fillBasics, setInputValue } from "./newProjectTestSupport";

/**
 * Board E6: the same client, title and fiscal year as an existing project.
 * The check runs 400ms after typing stops (projects.findSameProject); the
 * warning box offers "Open that project" and "It is a different project".
 */
const text = (node: Element | null | undefined) => (node?.textContent ?? "").replace(/\s+/g, " ").trim();
const ARGS = { clientName: "Cedarline Systems", title: "Adaptive cold storage controls" };
const MATCH = {
  projectId: "project-existing",
  title: "Adaptive cold storage controls",
  clientName: "Cedarline Systems",
  workflowStage: "drafting",
  ownerName: "Larry Moss",
  updatedAt: Date.now() - 12 * 60_000,
};

beforeEach(async () => {
  await page.viewport(1440, 900);
  localStorage.clear();
  __resetPage();
  __resetNavigation();
  __resetConvexStub();
  takeProjectStart();
  __setPageUrl("/project/new");
  __setQueryData("users:getCurrentUser", { _id: "user-1", role: "writer", firstName: "Wendy" });
  __setQueryData("tags:listTags", []);
});

describe("E6 project already exists", () => {
  it("asks only after typing stops for 400ms", async () => {
    await render(NewProjectPage, {});
    await fillBasics("Adaptive", "Cedarline Systems");
    setInputValue("#title", "Adaptive cold");
    setInputValue("#title", "Adaptive cold storage controls");
    expect(__activeQueryArgs("projects:findSameProject")).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(__activeQueryArgs("projects:findSameProject")).toEqual([]);
    await expect.poll(() => __activeQueryArgs("projects:findSameProject")).toEqual([ARGS]);
  });

  it("warns with the project, opens it, and marks the title and the checklist", async () => {
    __setQueryDataForArgs("projects:findSameProject", ARGS, MATCH);
    await render(NewProjectPage, {});
    await fillBasics(ARGS.title, ARGS.clientName);

    await expect.poll(() => document.querySelector("[data-same-project]")).not.toBeNull();
    const box = document.querySelector<HTMLElement>("[data-same-project]")!;
    expect(text(box)).toContain("Cedarline Systems already has this project");
    expect(text(box)).toContain("Adaptive cold storage controls, Drafting, owned by Larry Moss, edited 12 min ago.");
    expect(text(box)).not.toMatch(/[‐-―·]/);
    // The title field takes the 1.5px warning line (inset, as every field).
    const title = document.querySelector<HTMLElement>("#title")!;
    expect(title.dataset.sameName).toBe("true");
    await expect.poll(() => getComputedStyle(title).boxShadow).toContain("rgb(217, 119, 6)");
    expect(title.style.boxShadow).toContain("1.5px");

    const row = document.querySelector<HTMLElement>('[data-checklist-row="duplicate"]')!;
    expect(text(row)).toContain("Same name as an existing project");
    expect(text(row.querySelector("[data-checklist-action]"))).toBe("Check");

    [...box.querySelectorAll("button")].find((button) => text(button) === "Open that project")!.click();
    await expect.poll(() => __navigationCalls.map((call) => call.url)).toContain("/project/project-existing");
  });

  it("names the fiscal year when one is set", async () => {
    // The page stores the picked day at local midnight.
    const local = new Date(2026, 5, 30).getTime();
    __setQueryDataForArgs("projects:findSameProject", { ...ARGS, fiscalYearEnd: local }, MATCH);
    __setPageUrl("/project/new?fye=2026-06-30");
    await render(NewProjectPage, {});
    await fillBasics(ARGS.title, ARGS.clientName);
    await expect
      .poll(() => text(document.querySelector("[data-same-project]")))
      .toContain("Cedarline Systems already has this project for FY 2026");
  });

  it("dismisses for this client and title with It is a different project", async () => {
    __setQueryDataForArgs("projects:findSameProject", ARGS, MATCH);
    await render(NewProjectPage, {});
    await fillBasics(ARGS.title, ARGS.clientName);
    await expect.poll(() => document.querySelector("[data-same-project]")).not.toBeNull();
    [...document.querySelectorAll<HTMLButtonElement>("[data-same-project] button")]
      .find((button) => text(button) === "It is a different project")!
      .click();
    await expect.poll(() => document.querySelector("[data-same-project]")).toBeNull();
    expect(document.querySelector('[data-checklist-row="duplicate"]')).toBeNull();
    expect(text(document.querySelector('[data-checklist-row="client-title"]'))).toContain("Client and title");
  });

  it("never asks on a duplicate, whose title already says copy", async () => {
    __setPageUrl("/project/new?from=project-1");
    __setQueryData("projects:getProject", { _id: "project-1", title: "Alloy", clientName: "Forge", mode: "generate" });
    await render(NewProjectPage, {});
    await expect.poll(() => document.querySelector<HTMLInputElement>("#title")?.value).toBe("Alloy (copy)");
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(__activeQueryArgs("projects:findSameProject")).toEqual([]);
  });
});
