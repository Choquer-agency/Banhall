import { beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { toast } from "svelte-sonner";
import ProjectBoardCard from "./ProjectBoardCard.svelte";
import type { ProjectsTableRow } from "./ProjectsTable.svelte";
import { __resetPage } from "$lib/test/app-state-stub.svelte";
import { __navigationCalls, __resetNavigation } from "$lib/test/app-navigation-stub";
import {
  __mutationCalls,
  __resetConvexStub,
  __setMutationError,
  __setQueryData,
} from "$lib/test/convex-svelte-stub.svelte";

/**
 * Delete on a project card (Paper K1, K2, K3 and K4, 2026-10-07). The card
 * renders the Projects list and every board column. Delete is offered only
 * to the project's creator or an admin, asks before deleting, and shows the
 * server's own refusal (open work) without deleting anything.
 */
function row(overrides: Partial<ProjectsTableRow> = {}): ProjectsTableRow {
  return {
    id: "p1",
    title: "Northline Labs narrative",
    clientName: "Northline Labs",
    workflowStage: "drafting",
    legacyStatus: "draft",
    owner: { kind: "canonical", label: "Olivia Owner" },
    generationActivity: null,
    createdDate: "Mar 10, 2026",
    updatedDate: "Jul 29, 2026",
    createdBy: "u-1",
    ...overrides,
  };
}

const deleteButton = () => document.querySelector<HTMLButtonElement>('[data-delete-project="p1"]');
const dialog = () => page.getByRole("dialog");

async function mountCard(overrides: Partial<ProjectsTableRow> = {}) {
  await page.viewport(1280, 800);
  const screen = await render(ProjectBoardCard, { row: row(overrides) });
  screen.container.style.cssText = "width:320px;padding:24px;";
  return screen;
}

beforeEach(() => {
  __resetPage();
  __resetNavigation();
  __resetConvexStub();
  vi.restoreAllMocks();
  __setQueryData("users:getCurrentUser", { _id: "u-1", role: "writer" });
});

describe("Delete on a project card", () => {
  it("is offered to the creator and to an admin, and to no one else", async () => {
    const screen = await mountCard();
    await expect.poll(() => deleteButton()).not.toBeNull();
    expect(deleteButton()?.getAttribute("aria-label")).toBe("Delete Northline Labs narrative");
    screen.unmount();

    __setQueryData("users:getCurrentUser", { _id: "u-2", role: "manager" });
    const other = await mountCard();
    await expect.element(page.getByRole("link", { name: "Northline Labs narrative" })).toBeVisible();
    expect(deleteButton()).toBeNull();
    other.unmount();

    __setQueryData("users:getCurrentUser", { _id: "u-9", role: "admin" });
    await mountCard();
    await expect.poll(() => deleteButton()).not.toBeNull();
  });

  it("is never offered for a project already being deleted, or a row that does not say who created it", async () => {
    const deleting = await mountCard({ deleting: true });
    await expect.element(page.getByRole("link", { name: "Northline Labs narrative" })).toBeVisible();
    expect(deleteButton()).toBeNull();
    deleting.unmount();
    await mountCard({ createdBy: undefined });
    await expect.element(page.getByRole("link", { name: "Northline Labs narrative" })).toBeVisible();
    expect(deleteButton()).toBeNull();
  });

  it("asks first, and Keep project deletes nothing and never opens the project", async () => {
    await mountCard();
    await expect.poll(() => deleteButton()).not.toBeNull();
    await userEvent.click(deleteButton()!);
    await expect.element(dialog()).toBeVisible();
    await expect.element(page.getByRole("heading", { name: "Delete Northline Labs narrative?" })).toBeVisible();
    await expect.element(page.getByText("This permanently deletes the project's report, transcripts, files and history. You can't undo this.")).toBeVisible();
    // Keep project has focus, so Enter cannot delete by accident.
    await expect.element(page.getByRole("button", { name: "Keep project" })).toHaveFocus();
    await page.getByRole("button", { name: "Keep project" }).click();
    await expect.poll(() => dialog().elements().length).toBe(0);
    expect(__mutationCalls("projects:deleteProject")).toHaveLength(0);
    expect(__navigationCalls).toEqual([]);
  });

  it("deletes once on Delete project and says so", async () => {
    const success = vi.spyOn(toast, "success").mockImplementation(() => "toast");
    await mountCard();
    await expect.poll(() => deleteButton()).not.toBeNull();
    await userEvent.click(deleteButton()!);
    await page.getByRole("button", { name: "Delete project" }).click();
    await expect.poll(() => __mutationCalls("projects:deleteProject")).toEqual([{ projectId: "p1" }]);
    await expect.poll(() => dialog().elements().length).toBe(0);
    expect(success).toHaveBeenCalledWith("Deleted Northline Labs narrative.");
    expect(__navigationCalls).toEqual([]);
  });

  it("shows the server's refusal and dims Delete until the dialog opens again", async () => {
    __setMutationError("projects:deleteProject", {
      data: { code: "INVALID_STATE", message: "Complete, decline, or cancel open work before deleting this project" },
    });
    await mountCard();
    await expect.poll(() => deleteButton()).not.toBeNull();
    await userEvent.click(deleteButton()!);
    await page.getByRole("button", { name: "Delete project" }).click();
    await expect.element(page.getByRole("alert")).toHaveTextContent("Complete, decline, or cancel open work before deleting this project");
    await expect.element(page.getByRole("button", { name: "Delete project" })).toBeDisabled();
    // The disabled Delete button gives focus to Keep project, inside the dialog.
    await expect.element(page.getByRole("button", { name: "Keep project" })).toHaveFocus();
    await page.getByRole("button", { name: "Keep project" }).click();
    await userEvent.click(deleteButton()!);
    await expect.element(page.getByRole("button", { name: "Delete project" })).toBeEnabled();
    expect(page.getByRole("alert").elements()).toHaveLength(0);
  });
});
