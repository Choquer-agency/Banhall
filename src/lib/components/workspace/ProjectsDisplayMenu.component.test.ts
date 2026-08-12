import { beforeEach, describe, expect, it, vi } from "vitest";
import { page as browserPage } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import ProjectsDisplayMenu from "./ProjectsDisplayMenu.svelte";
import { parseProjectsTablePreferences } from "$lib/dashboard/projectsTablePreferences";

const sortOptions = [
  { value: "updated" as const, label: "Recently edited" },
  { value: "created" as const, label: "Recently created" },
  { value: "viewed" as const, label: "Recently viewed" },
];
const columnOptions = [
  { id: "clientName" as const, label: "Client name" },
  { id: "stage" as const, label: "Stage" },
  { id: "owner" as const, label: "Owner" },
  { id: "generationActivity" as const, label: "AI activity" },
  { id: "updated" as const, label: "Updated" },
];

function props(overrides: Record<string, unknown> = {}) {
  return {
    preferences: parseProjectsTablePreferences(null),
    sortBy: "updated" as const,
    sortOptions,
    columnOptions,
    showSort: true,
    showBoardOptions: false,
    showClientOptions: false,
    clientCountsAvailable: true,
    boardCountsLimited: false,
    onSortChange: vi.fn(),
    onToggleColumn: vi.fn(),
    onDensityChange: vi.fn(),
    onHideEmptyBoardChange: vi.fn(),
    onHideEmptyClientGroupsChange: vi.fn(),
    ...overrides,
  };
}

async function openMenu() {
  document.querySelector<HTMLButtonElement>("[data-projects-display-trigger]")?.click();
  await expect.poll(() => document.querySelector('[role="menu"]')).not.toBeNull();
}

describe("ProjectsDisplayMenu", () => {
  beforeEach(async () => {
    await browserPage.viewport(1280, 800);
  });

  it("changes multiple list options without closing the display menu", async () => {
    const onToggleColumn = vi.fn();
    const onDensityChange = vi.fn();
    await render(
      ProjectsDisplayMenu,
      props({
        preferences: { ...parseProjectsTablePreferences(null), layout: "list" },
        onToggleColumn,
        onDensityChange,
      })
    );
    await openMenu();

    document.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')[1]?.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    expect(onToggleColumn).toHaveBeenCalledOnce();

    const radioItems = document.querySelectorAll<HTMLElement>('[role="menuitemradio"]');
    radioItems[radioItems.length - 1]?.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    expect(onDensityChange).toHaveBeenCalledWith("compact");
  });

  it("dismisses after choosing a sort order", async () => {
    const onSortChange = vi.fn();
    await render(
      ProjectsDisplayMenu,
      props({
        preferences: { ...parseProjectsTablePreferences(null), layout: "board" },
        onSortChange,
      })
    );
    await openMenu();

    document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')[1]?.click();
    await expect.poll(() => document.querySelector('[role="menu"]')).toBeNull();
    expect(onSortChange).toHaveBeenCalledWith("created");
  });

  it("does not claim client stages are hidden until verified counts are available", async () => {
    const preferences = {
      ...parseProjectsTablePreferences(null),
      layout: "board" as const,
      group: "client" as const,
      hideEmptyClientGroups: true,
    };
    await render(
      ProjectsDisplayMenu,
      props({
        preferences,
        showSort: false,
        showClientOptions: true,
        clientCountsAvailable: false,
      })
    );

    const trigger = document.querySelector("[data-projects-display-trigger]");
    expect(trigger?.textContent).not.toContain("Empty stages hidden");
    await openMenu();
    const option = document.querySelector<HTMLElement>('[data-hide-empty-switch="client"]');
    expect(option?.getAttribute("aria-checked")).toBe("true");
    expect(option?.hasAttribute("data-disabled")).toBe(true);
    expect(option?.querySelector("svg")).not.toBeNull();
  });
});
